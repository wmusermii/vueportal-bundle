import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../connector/db'
import { requirePermission } from '../middleware/permission'
import { HttpError, badRequest, idParam, isSystemMember, isSystemUser, sendError, withTx } from '../lib/helpers'
import type {} from '../middleware/auth'
import { changeOrQueue } from '../approval/change'
import {
  assertCanGrant,
  applyMembers,
  currentGroupRecord,
  menuCodeMap,
  permsToRecord,
  planMembers,
  resolveFlags,
  savePermissions,
} from '../services/groupsOps'

export const groupsRouter = Router()

// ---------- validasi ----------
const permSchema = z
  .object({
    menuId: z.string().regex(/^\d+$/),
    create: z.boolean(),
    read: z.boolean(),
    update: z.boolean(),
    delete: z.boolean(),
    needsApproval: z.boolean().default(false), // hanya Administrator yang bisa mengubahnya (lihat resolveFlags)
  })
  .refine((p) => p.read || !(p.create || p.update || p.delete), {
    message: 'izin tambah, ubah, atau hapus mengharuskan izin lihat',
  })

const groupSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'huruf besar, angka, atau _ (2-30 karakter, diawali huruf)'),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(255).default(''),
  status: z.enum(['active', 'inactive']),
  permissions: z.array(permSchema).max(200),
})

const queued = (res: import('express').Response, requestId: string, message: string) =>
  res.status(202).json({ queued: true, message, requestId })

// ---------- route ----------
groupsRouter.get('/', requirePermission('groups', 'read'), async (req, res) => {
  const sys = await isSystemUser(req.user!.id)
  const { rows } = await pool.query(
    `SELECT g.id::text AS id, g.code, g.name, g.description,
            g.is_system AS "isSystem", g.status,
            (SELECT count(*)::int FROM user_groups ug WHERE ug.group_id = g.id) AS "memberCount"
       FROM groups g
      WHERE $1::boolean OR NOT g.is_system
      ORDER BY g.is_system DESC, g.name`,
    [sys],
  )
  res.json(rows)
})

// daftar halaman untuk matriks izin
groupsRouter.get('/pages', requirePermission('groups', 'read'), async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT m.id::text AS id, m.code,
           concat_ws(' / ', gp.title, p.title, m.title) AS label
      FROM menus m
      LEFT JOIN menus p  ON p.id  = m.parent_id
      LEFT JOIN menus gp ON gp.id = p.parent_id
     WHERE m.type = 'page' AND m.status = 'active'
     ORDER BY label
  `)
  res.json(rows)
})

groupsRouter.get('/:id', requirePermission('groups', 'read'), async (req, res) => {
  try {
    const id = idParam(String(req.params.id))
    const g = await pool.query(
      `SELECT id::text AS id, code, name, COALESCE(description, '') AS description,
              is_system AS "isSystem", status
         FROM groups WHERE id = $1`,
      [id],
    )
    if (!g.rows[0] || (g.rows[0].isSystem && !(await isSystemUser(req.user!.id)))) {
      throw new HttpError(404, 'Group tidak ditemukan')
    }
    const p = await pool.query(
      `SELECT menu_id::text AS "menuId", can_create AS "create", can_read AS "read",
              can_update AS "update", can_delete AS "delete", needs_approval AS "needsApproval"
         FROM group_menu_permissions WHERE group_id = $1`,
      [id],
    )
    res.json({ ...g.rows[0], permissions: p.rows })
  } catch (e) {
    sendError(res, e)
  }
})

groupsRouter.post('/', requirePermission('groups', 'create'), async (req, res) => {
  const p = groupSchema.safeParse(req.body)
  if (!p.success) {
    badRequest(res, p.error)
    return
  }
  try {
    const actor = req.user!.id
    const out = await changeOrQueue(
      { userId: actor, menu: 'groups', type: 'GROUPS_CHANGE', action: 'create' },
      {
        // jalur langsung
        runNow: () =>
          withTx(async (c) => {
            await assertCanGrant(c, actor, p.data.permissions)
            const perms = await resolveFlags(c, actor, null, p.data.permissions)
            const { rows } = await c.query(
              `INSERT INTO groups (code, name, description, status)
               VALUES ($1, $2, $3, $4) RETURNING id`,
              [p.data.code, p.data.name, p.data.description || null, p.data.status],
            )
            const newId = String(rows[0].id)
            await savePermissions(c, newId, perms)
            return newId
          }),
        // jalur approval
        describe: () =>
          withTx(async (c) => {
            await assertCanGrant(c, actor, p.data.permissions)
            const dup = await c.query('SELECT 1 FROM groups WHERE code = $1 OR name = $2', [
              p.data.code,
              p.data.name,
            ])
            if (dup.rowCount) throw new HttpError(409, 'Kode atau nama group sudah dipakai')
            const perms = await resolveFlags(c, actor, null, p.data.permissions)
            return {
              title: `${p.data.code} (${p.data.name})`,
              uniqueKey: `create:${p.data.code}`,
              newRecord: {
                code: p.data.code,
                name: p.data.name,
                description: p.data.description,
                status: p.data.status,
                ...permsToRecord(perms, await menuCodeMap(c)),
              },
              secret: { entity: 'group', permissions: perms },
            }
          }),
      },
    )
    if (out.queued) {
      queued(res, out.requestId, 'Penambahan group diajukan dan menunggu persetujuan')
      return
    }
    res.status(201).json({ id: out.result })
  } catch (e) {
    sendError(res, e)
  }
})

groupsRouter.put('/:id', requirePermission('groups', 'update'), async (req, res) => {
  const p = groupSchema.safeParse(req.body)
  if (!p.success) {
    badRequest(res, p.error)
    return
  }
  try {
    const id = idParam(String(req.params.id))
    const actor = req.user!.id
    const out = await changeOrQueue(
      { userId: actor, menu: 'groups', type: 'GROUPS_CHANGE', action: 'update' },
      {
        // jalur langsung
        runNow: () =>
          withTx(async (c) => {
            const cur = await c.query('SELECT is_system FROM groups WHERE id = $1 FOR UPDATE', [id])
            if (!cur.rows[0]) throw new HttpError(404, 'Group tidak ditemukan')

            if (cur.rows[0].is_system) {
              if (!(await isSystemMember(c, actor))) {
                throw new HttpError(403, 'Hanya admin yang boleh mengubah group sistem')
              }
              // kode, status, dan izin group sistem dikunci
              await c.query('UPDATE groups SET name = $2, description = $3 WHERE id = $1', [
                id,
                p.data.name,
                p.data.description || null,
              ])
              return
            }

            await assertCanGrant(c, actor, p.data.permissions)
            const perms = await resolveFlags(c, actor, id, p.data.permissions)
            await c.query(
              `UPDATE groups SET code = $2, name = $3, description = $4, status = $5 WHERE id = $1`,
              [id, p.data.code, p.data.name, p.data.description || null, p.data.status],
            )
            await savePermissions(c, id, perms)
          }),
        // jalur approval (group sistem hanya boleh diubah admin, yang tidak pernah lewat sini)
        describe: () =>
          withTx(async (c) => {
            const before = await currentGroupRecord(c, id)
            if (!before) throw new HttpError(404, 'Group tidak ditemukan')
            if (before.isSystem) throw new HttpError(403, 'Hanya admin yang boleh mengubah group sistem')
            await assertCanGrant(c, actor, p.data.permissions)
            const perms = await resolveFlags(c, actor, id, p.data.permissions)
            return {
              title: `${before.record.code} (${before.record.name})`,
              targetId: id,
              oldRecord: before.record,
              newRecord: {
                code: p.data.code,
                name: p.data.name,
                description: p.data.description,
                status: p.data.status,
                ...permsToRecord(perms, await menuCodeMap(c)),
              },
              secret: { entity: 'group', permissions: perms },
            }
          }),
      },
    )
    if (out.queued) {
      queued(res, out.requestId, 'Perubahan group diajukan dan menunggu persetujuan')
      return
    }
    res.json({ ok: true })
  } catch (e) {
    sendError(res, e)
  }
})

groupsRouter.delete('/:id', requirePermission('groups', 'delete'), async (req, res) => {
  try {
    const id = idParam(String(req.params.id))
    const out = await changeOrQueue(
      { userId: req.user!.id, menu: 'groups', type: 'GROUPS_CHANGE', action: 'delete' },
      {
        // jalur langsung
        runNow: () =>
          withTx(async (c) => {
            const cur = await c.query('SELECT is_system FROM groups WHERE id = $1 FOR UPDATE', [id])
            if (!cur.rows[0]) throw new HttpError(404, 'Group tidak ditemukan')
            if (cur.rows[0].is_system) throw new HttpError(403, 'Group sistem tidak boleh dihapus')
            await c.query('DELETE FROM groups WHERE id = $1', [id]) // gagal jika masih ada anggota
          }),
        // jalur approval
        describe: () =>
          withTx(async (c) => {
            const before = await currentGroupRecord(c, id)
            if (!before) throw new HttpError(404, 'Group tidak ditemukan')
            if (before.isSystem) throw new HttpError(403, 'Group sistem tidak boleh dihapus')
            return {
              title: `${before.record.code} (${before.record.name})`,
              targetId: id,
              oldRecord: before.record,
              newRecord: null,
              secret: { entity: 'group' },
            }
          }),
      },
    )
    if (out.queued) {
      queued(res, out.requestId, 'Penghapusan group diajukan dan menunggu persetujuan')
      return
    }
    res.json({ ok: true })
  } catch (e) {
    sendError(res, e)
  }
})

const membersSchema = z.object({
  userIds: z.array(z.string().regex(/^\d+$/)).max(1000),
})

// semua user + penanda apakah sudah menjadi anggota group ini
groupsRouter.get('/:id/members', requirePermission('groups', 'update'), async (req, res) => {
  try {
    const id = idParam(String(req.params.id))
    const sys = await isSystemUser(req.user!.id)
    const { rows } = await pool.query(
      `SELECT u.id::text AS id, u.username, u.full_name AS "fullName", u.status,
              COALESCE(ug.group_id = $1::bigint, false) AS "isMember",
              CASE WHEN ug.group_id IS NOT NULL AND ug.group_id <> $1::bigint THEN og.name END AS "otherGroup"
         FROM users u
         LEFT JOIN user_groups ug ON ug.user_id = u.id
         LEFT JOIN groups og ON og.id = ug.group_id
        WHERE $2::boolean OR NOT EXISTS (
          SELECT 1 FROM user_groups x
            JOIN groups xg ON xg.id = x.group_id
           WHERE x.user_id = u.id AND xg.is_system
        )
        ORDER BY u.full_name`,
      [id, sys],
    )
    res.json(rows)
  } catch (e) {
    sendError(res, e)
  }
})

// ganti seluruh daftar anggota group
groupsRouter.put('/:id/members', requirePermission('groups', 'update'), async (req, res) => {
  const p = membersSchema.safeParse(req.body)
  if (!p.success) {
    badRequest(res, p.error)
    return
  }
  try {
    const id = idParam(String(req.params.id))
    const actor = req.user!.id
    const out = await changeOrQueue(
      { userId: actor, menu: 'groups', type: 'GROUPS_CHANGE', action: 'update' },
      {
        // jalur langsung
        runNow: () =>
          withTx(async (c) => {
            const { added, removed } = await planMembers(c, id, actor, p.data.userIds)
            if (added.length === 0 && removed.length === 0) return
            await applyMembers(c, id, added, removed, actor)
          }),
        // jalur approval: simpan daftar yang ditambah/dikeluarkan (bukan seluruh daftar)
        describe: () =>
          withTx(async (c) => {
            const { added, removed, current } = await planMembers(c, id, actor, p.data.userIds)
            if (added.length === 0 && removed.length === 0) throw new HttpError(400, 'Tidak ada perubahan anggota')
            const g = await c.query('SELECT code, name FROM groups WHERE id = $1', [id])
            const names = async (ids: string[]) => {
              if (ids.length === 0) return ''
              const r = await c.query(
                'SELECT username FROM users WHERE id = ANY($1::bigint[]) ORDER BY username',
                [ids],
              )
              return r.rows.map((x) => x.username).join(', ')
            }
            return {
              title: `Anggota ${g.rows[0].name}`,
              targetId: id,
              uniqueKey: `members:${id}`,
              oldRecord: { 'jumlah anggota': current },
              newRecord: {
                'jumlah anggota': current + added.length - removed.length,
                ...(added.length ? { ditambahkan: await names(added) } : {}),
                ...(removed.length ? { dikeluarkan: await names(removed) } : {}),
              },
              secret: { entity: 'members', added, removed },
            }
          }),
      },
    )
    if (out.queued) {
      queued(res, out.requestId, 'Perubahan anggota group diajukan dan menunggu persetujuan')
      return
    }
    res.json({ ok: true })
  } catch (e) {
    sendError(res, e)
  }
})