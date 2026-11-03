import { Router, type Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { pool } from '../connector/db'
import { isSystemUser } from '../lib/helpers'
import { COOKIE_NAME, requireAuth } from '../middleware/auth'
import { getPermissions,getGroup  } from '../services/permissions'
import { getBool, getNumber } from '../services/params'
import { getPasswordPolicy } from '../services/passwordPolicy'
import {
  checkLoginBlock,
  clientIp,
  formatWait,
  getLoginSecurity,
  recordLoginAttempt,
} from '../services/loginSecurity'

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) throw new Error('JWT_SECRET belum diisi di .env')

const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.COOKIE_SECURE === 'true',
  path: '/',
}

// hash palsu, supaya waktu respons sama walau username tidak ada
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10)

const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(3).max(50),
  password: z.string().min(1).max(200),
})

function tooMany(res: Response, retrySec: number) {
  res.set('Retry-After', String(retrySec))
  res.status(429).json({ message: `Terlalu banyak percobaan login. Coba lagi dalam ${formatWait(retrySec)}.` })
}

export const authRouter = Router()

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ message: 'Data tidak valid' })
    return
  }
  const { username, password } = parsed.data
  const ip = clientIp(req)
  const security = await getLoginSecurity()

  const blocked = await checkLoginBlock(username, ip, security)
  if (blocked) {
    tooMany(res, blocked.retrySec)
    return
  }

  const { rows } = await pool.query(
    `SELECT id, username, full_name, password_hash
       FROM users
      WHERE username = $1 AND status = 'active'`,
    [username],
  )
  const user = rows[0]
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH)

  if (!user || !ok) {
    await recordLoginAttempt(username, ip, false)
    const now = await checkLoginBlock(username, ip, security) // percobaan ini mungkin yang mencapai batas
    if (now) {
      tooMany(res, now.retrySec)
      return
    }
    res.status(401).json({ message: 'Username atau password salah' })
    return
  }

  await recordLoginAttempt(username, ip, true)

  // mode pemeliharaan: hanya admin yang boleh masuk
  if (await getBool('portal', 'maintenance_mode', false)) {
    if (!(await isSystemUser(String(user.id)))) {
      res.status(503).json({ message: 'Portal sedang dalam pemeliharaan. Hanya administrator yang dapat masuk.' })
      return
    }
  }

  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id])

  // token berlaku maksimal 30 hari (batas atas parameter); masa berlaku sebenarnya diperiksa di requireAuth
  const hours = await getNumber('session', 'duration_hours', 8)
  const token = jwt.sign({ sub: String(user.id) }, JWT_SECRET, { expiresIn: '30d' })
  res.cookie(COOKIE_NAME, token, { ...cookieOpts, maxAge: hours * 3600 * 1000 })
  res.json({ user: { id: user.id, username: user.username, fullName: user.full_name } })
})

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, cookieOpts)
  res.json({ ok: true })
})

// authRouter.get('/me', requireAuth, async (req, res) => {
//   const permissions = await getPermissions(req.user!.id)
//   res.json({ user: req.user, permissions })
// })
authRouter.get('/me', requireAuth, async (req, res) => {
  const [group, permissions] = await Promise.all([
    getGroup(req.user!.id),
    getPermissions(req.user!.id),
  ])
  res.json({ user: req.user, group, permissions })
})
// aturan password yang berlaku, untuk petunjuk di form
authRouter.get('/password-policy', requireAuth, async (_req, res) => {
  res.json(await getPasswordPolicy())
})