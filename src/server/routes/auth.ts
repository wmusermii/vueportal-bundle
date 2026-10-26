import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { pool } from '../connector/db'

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) throw new Error('JWT_SECRET belum diisi di .env')

import { COOKIE_NAME, requireAuth } from '../middleware/auth'
import { getPermissions } from '../services/permissions'
const MAX_AGE_MS = 8 * 60 * 60 * 1000

const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.COOKIE_SECURE === 'true',
  path: '/',
}

// hash palsu, supaya waktu respons sama walau username tidak ada
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10)

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
})

const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(3).max(50),
  password: z.string().min(1).max(200),
})

export const authRouter = Router()
authRouter.post('/login', loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ message: 'Data tidak valid' })
    return
  }
  const { username, password } = parsed.data
  const { rows } = await pool.query(
    `SELECT id, username, full_name, password_hash
       FROM portal.users
      WHERE username = $1 AND status = 'active'`,
    [username],
  )
  const user = rows[0]
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH)
  if (!user || !ok) {
    res.status(401).json({ message: 'Username atau password salah' })
    return
  }
  await pool.query('UPDATE portal.users SET last_login_at = now() WHERE id = $1', [user.id])
  const token = jwt.sign({ sub: String(user.id) }, JWT_SECRET, { expiresIn: '8h' })
  res.cookie(COOKIE_NAME, token, { ...cookieOpts, maxAge: MAX_AGE_MS })
  res.json({ user: { id: user.id, username: user.username, fullName: user.full_name } })
})

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, cookieOpts)
  res.json({ ok: true })
})

authRouter.get('/me', requireAuth, async (req, res) => {
  const permissions = await getPermissions(req.user!.id)
  res.json({ user: req.user, permissions })
})