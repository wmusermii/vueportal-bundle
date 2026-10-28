import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { pool } from '../connector/db'
import { HttpError, badRequest, sendError } from '../lib/helpers'
import type {} from '../middleware/auth'

export const profileRouter = Router()

const profileSchema = z.object({
  fullName: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(150),
})

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(100),
})

// batasi tebakan password saat ini (mis. dari sesi yang dicuri)
const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
})

profileRouter.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id::text AS id, u.username, u.email, u.full_name AS "fullName", u.status,
            u.last_login_at AS "lastLoginAt",
            COALESCE(
              json_agg(json_build_object('id', g.id::text, 'code', g.code, 'name', g.name) ORDER BY g.name)
                FILTER (WHERE g.id IS NOT NULL),
              '[]'
            ) AS groups
       FROM portal.users u
       LEFT JOIN portal.user_groups ug ON ug.user_id = u.id
       LEFT JOIN portal.groups g ON g.id = ug.group_id
      WHERE u.id = $1
      GROUP BY u.id`,
    [req.user!.id],
  )
  res.json(rows[0])
})

profileRouter.put('/', async (req, res) => {
  const p = profileSchema.safeParse(req.body)
  if (!p.success) {
    badRequest(res, p.error)
    return
  }
  try {
    await pool.query('UPDATE portal.users SET email = $2, full_name = $3 WHERE id = $1', [
      req.user!.id,
      p.data.email,
      p.data.fullName,
    ])
    res.json({ ok: true })
  } catch (e) {
    sendError(res, e)
  }
})

profileRouter.put('/password', passwordLimiter, async (req, res) => {
  const p = passwordSchema.safeParse(req.body)
  if (!p.success) {
    badRequest(res, p.error)
    return
  }
  try {
    const { rows } = await pool.query('SELECT password_hash FROM portal.users WHERE id = $1', [req.user!.id])
    const ok = rows[0] && (await bcrypt.compare(p.data.currentPassword, rows[0].password_hash))
    if (!ok) throw new HttpError(400, 'Password saat ini salah')
    if (p.data.currentPassword === p.data.newPassword) {
      throw new HttpError(400, 'Password baru harus berbeda dari password saat ini')
    }
    const hash = await bcrypt.hash(p.data.newPassword, 10)
    await pool.query('UPDATE portal.users SET password_hash = $2 WHERE id = $1', [req.user!.id, hash])
    res.json({ ok: true })
  } catch (e) {
    sendError(res, e)
  }
})