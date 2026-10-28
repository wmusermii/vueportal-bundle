import { Router } from 'express'
import bcrypt from 'bcryptjs'
import type { PoolClient } from 'pg'
import { z } from 'zod'
import { pool } from '../connector/db'
import { requirePermission } from '../middleware/permission'
import { HttpError, badRequest, idParam, isSystemMember, sendError, withTx } from '../lib/helpers'
import type {} from '../middleware/auth'

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
  password: z.string().min(8).max(100),
  ...shared,
})
const updateSchema = z.object({
  password: z.string().min(8).max(100).optional(),
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
       FROM portal.users u
       LEFT JOIN portal.user_groups ug ON ug.user_id = u.id
       LEFT JOIN portal.groups g ON g.id = ug.group_id
      WHERE u.id <> $1
        AND NOT EXISTS (
          SELECT 1 FROM portal.user_groups x
            JOIN portal.groups xg ON xg.id = x.group_id
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
    const hash = await bcrypt.hash(p.data.password, 10)
    const { rows } = await pool.query(
      `INSERT INTO portal.users (username, email, full_name, password_hash, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [p.data.username, p.data.email, p.data.fullName, hash, p.data.status],
    )
    res.status(201).json({ id: String(rows[0].id) })
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
    const id = idParam(String(req.params.id))
    await withTx(async (c) => {
      const found = await c.query('SELECT 1 FROM portal.users WHERE id = $1 FOR UPDATE', [id])
      if (found.rowCount === 0) throw new HttpError(404, 'User tidak ditemukan')
      await assertManageable(c, id, req.user!.id)

      const hash = p.data.password ? await bcrypt.hash(p.data.password, 10) : null
      await c.query(
        `UPDATE portal.users
            SET email = $2, full_name = $3, status = $4,
                password_hash = COALESCE($5, password_hash)
          WHERE id = $1`,
        [id, p.data.email, p.data.fullName, p.data.status, hash],
      )
    })
    res.json({ ok: true })
  } catch (e) {
    sendError(res, e)
  }
})

usersRouter.delete('/:id', requirePermission('users', 'delete'), async (req, res) => {
  try {
    const id = idParam(String(req.params.id))
    await withTx(async (c) => {
      await assertManageable(c, id, req.user!.id)
      const r = await c.query('DELETE FROM portal.users WHERE id = $1', [id])
      if (r.rowCount === 0) throw new HttpError(404, 'User tidak ditemukan')
    })
    res.json({ ok: true })
  } catch (e) {
    sendError(res, e)
  }
})