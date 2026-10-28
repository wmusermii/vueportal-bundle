import { Router } from 'express'
import type { PoolClient } from 'pg'
import { z } from 'zod'
import { pool } from '../connector/db'
import { requirePermission } from '../middleware/permission'
import { HttpError, badRequest, idParam, isSystemMember,isSystemUser, sendError, withTx } from '../lib/helpers'
import type {} from '../middleware/auth'

export const groupsRouter = Router()

// ---------- validasi ----------
const permSchema = z
  .object({
    menuId: z.string().regex(/^\d+$/),
    create: z.boolean(),
    read: z.boolean(),
    update: z.boolean(),
    delete: z.boolean(),
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
type PermInput = z.infer<typeof permSchema>

// ---------- helper ----------
const ACTIONS = ['create', 'read', 'update', 'delete'] as const

// user non-admin hanya boleh memberi izin yang dia sendiri punya
async function assertCanGrant(c: PoolClient, actorId: string, perms: PermInput[]) {
  if (await isSystemMember(c, actorId)) return
  const { rows } = await c.query(
    `SELECT p.menu_id::text AS "menuId",
            bool_or(p.can_create) AS "create", bool_or(p.can_read) AS "read",
            bool_or(p.can_update) AS "update", bool_or(p.can_delete) AS "delete"
       FROM portal.user_groups ug
       JOIN portal.groups g ON g.id = ug.group_id AND g.status = 'active'
       JOIN portal.group_menu_permissions p ON p.group_id = g.id
      WHERE ug.user_id = $1
      GROUP BY p.menu_id`,
    [actorId],
  )
  const mine = new Map<string, Record<string, boolean>>(rows.map((r) => [r.menuId, r]))
  for (const p of perms) {
    for (const a of ACTIONS) {
      if (p[a] && !mine.get(p.menuId)?.[a]) {
        throw new HttpError(403, 'Tidak boleh memberi izin yang tidak Anda miliki')
      }
    }
  }
}

async function savePermissions(c: PoolClient, groupId: string, perms: PermInput[]) {
  const unique = [...new Map(perms.map((p) => [p.menuId, p])).values()]
  const active = unique.filter((p) => p.create || p.read || p.update || p.delete)
  await c.query('DELETE FROM portal.group_menu_permissions WHERE group_id = $1', [groupId])
  if (active.length === 0) return
  await c.query(
    `INSERT INTO portal.group_menu_permissions
       (group_id, menu_id, can_create, can_read, can_update, can_delete)
     SELECT $1::bigint, t.menu_id, t.c, t.r, t.u, t.d
       FROM unnest($2::bigint[], $3::boolean[], $4::boolean[], $5::boolean[], $6::boolean[])
            AS t(menu_id, c, r, u, d)`,
    [
      groupId,
      active.map((p) => p.menuId),
      active.map((p) => p.create),
      active.map((p) => p.read),
      active.map((p) => p.update),
      active.map((p) => p.delete),
    ],
  )
}

// ---------- route ----------
groupsRouter.get('/', requirePermission('groups', 'read'), async (req, res) => {
  const sys = await isSystemUser(req.user!.id)
  const { rows } = await pool.query(
    `SELECT g.id::text AS id, g.code, g.name, g.description,
            g.is_system AS "isSystem", g.status,
            (SELECT count(*)::int FROM portal.user_groups ug WHERE ug.group_id = g.id) AS "memberCount"
       FROM portal.groups g
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
      FROM portal.menus m
      LEFT JOIN portal.menus p  ON p.id  = m.parent_id
      LEFT JOIN portal.menus gp ON gp.id = p.parent_id
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
         FROM portal.groups WHERE id = $1`,
      [id],
    )
    if (!g.rows[0] || (g.rows[0].isSystem && !(await isSystemUser(req.user!.id)))) {
  throw new HttpError(404, 'Group tidak ditemukan')
}
    const p = await pool.query(
      `SELECT menu_id::text AS "menuId", can_create AS "create", can_read AS "read",
              can_update AS "update", can_delete AS "delete"
         FROM portal.group_menu_permissions WHERE group_id = $1`,
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
    const id = await withTx(async (c) => {
      await assertCanGrant(c, req.user!.id, p.data.permissions)
      const { rows } = await c.query(
        `INSERT INTO portal.groups (code, name, description, status)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [p.data.code, p.data.name, p.data.description || null, p.data.status],
      )
      const newId = String(rows[0].id)
      await savePermissions(c, newId, p.data.permissions)
      return newId
    })
    res.status(201).json({ id })
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
    await withTx(async (c) => {
      const cur = await c.query('SELECT is_system FROM portal.groups WHERE id = $1 FOR UPDATE', [id])
      if (!cur.rows[0]) throw new HttpError(404, 'Group tidak ditemukan')

      if (cur.rows[0].is_system) {
        if (!(await isSystemMember(c, req.user!.id))) {
          throw new HttpError(403, 'Hanya admin yang boleh mengubah group sistem')
        }
        // kode, status, dan izin group sistem dikunci
        await c.query('UPDATE portal.groups SET name = $2, description = $3 WHERE id = $1', [
          id,
          p.data.name,
          p.data.description || null,
        ])
        return
      }

      await assertCanGrant(c, req.user!.id, p.data.permissions)
      await c.query(
        `UPDATE portal.groups SET code = $2, name = $3, description = $4, status = $5 WHERE id = $1`,
        [id, p.data.code, p.data.name, p.data.description || null, p.data.status],
      )
      await savePermissions(c, id, p.data.permissions)
    })
    res.json({ ok: true })
  } catch (e) {
    sendError(res, e)
  }
})

groupsRouter.delete('/:id', requirePermission('groups', 'delete'), async (req, res) => {
  try {
    const id = idParam(String(req.params.id))
    await withTx(async (c) => {
      const cur = await c.query('SELECT is_system FROM portal.groups WHERE id = $1 FOR UPDATE', [id])
      if (!cur.rows[0]) throw new HttpError(404, 'Group tidak ditemukan')
      if (cur.rows[0].is_system) throw new HttpError(403, 'Group sistem tidak boleh dihapus')
      await c.query('DELETE FROM portal.groups WHERE id = $1', [id]) // gagal jika masih ada anggota
    })
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
         FROM portal.users u
         LEFT JOIN portal.user_groups ug ON ug.user_id = u.id
         LEFT JOIN portal.groups og ON og.id = ug.group_id
        WHERE $2::boolean OR NOT EXISTS (
          SELECT 1 FROM portal.user_groups x
            JOIN portal.groups xg ON xg.id = x.group_id
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
    const actorId = req.user!.id
    await withTx(async (c) => {
      const g = await c.query('SELECT is_system, status FROM portal.groups WHERE id = $1 FOR UPDATE', [id])
      if (!g.rows[0]) throw new HttpError(404, 'Group tidak ditemukan')

      const actorIsSystem = await isSystemMember(c, actorId)
      if (g.rows[0].is_system && !actorIsSystem) {
        throw new HttpError(403, 'Hanya admin yang boleh mengatur anggota group sistem')
      }

      const wanted = new Set(p.data.userIds)
      const cur = await c.query('SELECT user_id::text AS id FROM portal.user_groups WHERE group_id = $1', [id])
      const have = new Set<string>(cur.rows.map((r) => r.id))
      const added = [...wanted].filter((u) => !have.has(u))
      const removed = [...have].filter((u) => !wanted.has(u))
      if (added.length === 0 && removed.length === 0) return

      if ([...added, ...removed].includes(actorId)) {
        throw new HttpError(403, 'Tidak boleh mengubah keanggotaan akun sendiri')
      }
      if (added.length > 0) {
        if (g.rows[0].status !== 'active') {
          throw new HttpError(400, 'Group nonaktif tidak bisa diberi anggota baru')
        }
        const ok = await c.query('SELECT count(*)::int AS n FROM portal.users WHERE id = ANY($1::bigint[])', [added])
        if (ok.rows[0].n !== added.length) throw new HttpError(400, 'Ada user yang tidak ditemukan')
      }
      if (!actorIsSystem) {
        const adm = await c.query(
          `SELECT EXISTS (
             SELECT 1 FROM portal.user_groups ug
               JOIN portal.groups sg ON sg.id = ug.group_id
              WHERE ug.user_id = ANY($1::bigint[]) AND sg.is_system
           ) AS yes`,
          [[...added, ...removed]],
        )
        if (adm.rows[0].yes) throw new HttpError(403, 'Hanya admin yang boleh mengubah keanggotaan user admin')
      }

      if (removed.length > 0) {
        await c.query('DELETE FROM portal.user_groups WHERE group_id = $1 AND user_id = ANY($2::bigint[])', [
          id,
          removed,
        ])
      }
      if (added.length > 0) {
        // satu user hanya boleh punya satu group: lepas dulu dari group lain
        await c.query('DELETE FROM portal.user_groups WHERE user_id = ANY($1::bigint[]) AND group_id <> $2', [
          added,
          id,
        ])
      }
      if (added.length > 0) {
        await c.query(
          `INSERT INTO portal.user_groups (user_id, group_id, assigned_by)
           SELECT u, $1::bigint, $3::bigint FROM unnest($2::bigint[]) AS u
           ON CONFLICT (user_id, group_id) DO NOTHING`,
          [id, added, actorId],
        )
      }
    })
    res.json({ ok: true })
  } catch (e) {
    sendError(res, e)
  }
})