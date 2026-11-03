import { Router } from 'express'
import bcrypt from 'bcryptjs'
import type { PoolClient } from 'pg'
import { z } from 'zod'
import { pool } from '../connector/db'
import { requirePermission } from '../middleware/permission'
import { HttpError, badRequest, idParam, isSystemMember, sendError, withTx } from '../lib/helpers'
import type {} from '../middleware/auth'
import { assertPasswordPolicy } from '../services/passwordPolicy'
import { changeOrQueue } from '../approval/change'
export const usersRouter = Router()

// ---------- validasi ----------
const shared = {
  email: z.string().trim().toLowerCase().email().max(150),
  fullName: z.string().trim().min(1).max(100),
  status: z.enum(['active', 'inactive']),
}
const createSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.]{3,50}$/, 'huruf kecil, angka, _ atau . (3-50 karakter)'),
  password: z.string().min(1).max(128),
  ...shared,
})
const updateSchema = z.object({
  password: z.string().min(1).max(128).optional(),
  ...shared,
})

// akun sendiri dan akun admin tidak dikelola dari halaman Pengguna
async function assertManageable(c: PoolClient, targetId: string, actorId: string) {
  if (targetId === actorId) throw new HttpError(400, 'Ubah akun sendiri lewat halaman Profil')
  if (await isSystemMember(c, targetId)) throw new HttpError(404, 'User tidak ditemukan')
}

// ---------- route ----------
usersRouter.get('/', requirePermission('users', 'read'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.email, u.full_name AS "fullName", u.status,
            u.last_login_at AS "lastLoginAt",
            COALESCE(
              json_agg(json_build_object('id', g.id::text, 'code', g.code, 'name', g.name) ORDER BY g.name)
                FILTER (WHERE g.id IS NOT NULL),
              '[]'
            ) AS groups
       FROM users u
       LEFT JOIN user_groups ug ON ug.user_id = u.id
       LEFT JOIN groups g ON g.id = ug.group_id
      WHERE u.id <> $1
        AND NOT EXISTS (
          SELECT 1 FROM user_groups x
            JOIN groups xg ON xg.id = x.group_id
           WHERE x.user_id = u.id AND xg.is_system
        )
      GROUP BY u.id
      ORDER BY u.id`,
    [req.user!.id],
  )
  res.json(rows)
})

usersRouter.post('/', requirePermission('users', 'create'), async (req, res) => {
  const p = createSchema.safeParse(req.body)
  if (!p.success) {
    badRequest(res, p.error)
    return
  }
  try {
    await assertPasswordPolicy(p.data.password)
    const hash = await bcrypt.hash(p.data.password, 10)
    const out = await changeOrQueue(
      { userId: req.user!.id, menu: 'users', type: 'USERS_CHANGE', action: 'create' },
      {
        // jalur langsung (Administrator / group tanpa centang "Butuh approval"): kode lama
        runNow: async () => {
          const { rows } = await pool.query(
            `INSERT INTO users (username, email, full_name, password_hash, status)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [p.data.username, p.data.email, p.data.fullName, hash, p.data.status],
          )
          return String(rows[0].id)
        },
        // jalur approval: hanya dipanggil bila diantrekan
        describe: async () => {
          const dup = await pool.query('SELECT 1 FROM users WHERE username = $1 OR email = $2', [
            p.data.username,
            p.data.email,
          ])
          if (dup.rowCount) throw new HttpError(409, 'Username atau email sudah dipakai')
          return {
            title: `${p.data.username} (${p.data.fullName})`,
            uniqueKey: `create:${p.data.username}`,
            newRecord: {
              username: p.data.username,
              email: p.data.email,
              fullName: p.data.fullName,
              status: p.data.status,
            },
            secret: { passwordHash: hash },
          }
        },
      },
    )
    if (out.queued) {
      res.status(202).json({
        queued: true,
        message: 'Penambahan pengguna diajukan dan menunggu persetujuan',
        requestId: out.requestId,
      })
      return
    }
    res.status(201).json({ id: out.result })
  } catch (e) {
    sendError(res, e)
  }
})

usersRouter.put('/:id', requirePermission('users', 'update'), async (req, res) => {
  const p = updateSchema.safeParse(req.body)
  if (!p.success) {
    badRequest(res, p.error)
    return
  }
  try {
    if (p.data.password) await assertPasswordPolicy(p.data.password)
    const id = idParam(String(req.params.id))
    const hash = p.data.password ? await bcrypt.hash(p.data.password, 10) : null
    const out = await changeOrQueue(
      { userId: req.user!.id, menu: 'users', type: 'USERS_CHANGE', action: 'update' },
      {
        // jalur langsung: kode lama
        runNow: () =>
          withTx(async (c) => {
            const found = await c.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [id])
            if (found.rowCount === 0) throw new HttpError(404, 'User tidak ditemukan')
            await assertManageable(c, id, req.user!.id)
            await c.query(
              `UPDATE users
                  SET email = $2, full_name = $3, status = $4,
                      password_hash = COALESCE($5, password_hash)
                WHERE id = $1`,
              [id, p.data.email, p.data.fullName, p.data.status, hash],
            )
          }),
        // jalur approval: catat data lama & baru sebagai JSON
        describe: () =>
          withTx(async (c) => {
            const cur = await c.query(
              `SELECT username, email, full_name AS "fullName", status FROM users WHERE id = $1`,
              [id],
            )
            if (cur.rowCount === 0) throw new HttpError(404, 'User tidak ditemukan')
            await assertManageable(c, id, req.user!.id)
            const before = cur.rows[0]
            return {
              title: `${before.username} (${before.fullName})`,
              targetId: id,
              oldRecord: before,
              newRecord: {
                username: before.username,
                email: p.data.email,
                fullName: p.data.fullName,
                status: p.data.status,
                ...(hash ? { password: '(diganti)' } : {}), // hanya penanda; hash ada di secret
              },
              secret: hash ? { passwordHash: hash } : {},
            }
          }),
      },
    )
    if (out.queued) {
      res.status(202).json({
        queued: true,
        message: 'Perubahan pengguna diajukan dan menunggu persetujuan',
        requestId: out.requestId,
      })
      return
    }
    res.json({ ok: true })
  } catch (e) {
    sendError(res, e)
  }
})

usersRouter.delete('/:id', requirePermission('users', 'delete'), async (req, res) => {
  try {
    const id = idParam(String(req.params.id))
    const out = await changeOrQueue(
      { userId: req.user!.id, menu: 'users', type: 'USERS_CHANGE', action: 'delete' },
      {
        // jalur langsung: kode lama
        runNow: () =>
          withTx(async (c) => {
            await assertManageable(c, id, req.user!.id)
            const r = await c.query('DELETE FROM users WHERE id = $1', [id])
            if (r.rowCount === 0) throw new HttpError(404, 'User tidak ditemukan')
          }),
        // jalur approval
        describe: () =>
          withTx(async (c) => {
            await assertManageable(c, id, req.user!.id)
            const cur = await c.query(
              `SELECT username, email, full_name AS "fullName", status FROM users WHERE id = $1`,
              [id],
            )
            if (cur.rowCount === 0) throw new HttpError(404, 'User tidak ditemukan')
            const before = cur.rows[0]
            return {
              title: `${before.username} (${before.fullName})`,
              targetId: id,
              oldRecord: before,
              newRecord: null,
            }
          }),
      },
    )
    if (out.queued) {
      res.status(202).json({
        queued: true,
        message: 'Penghapusan pengguna diajukan dan menunggu persetujuan',
        requestId: out.requestId,
      })
      return
    }
    res.json({ ok: true })
  } catch (e) {
    sendError(res, e)
  }
})