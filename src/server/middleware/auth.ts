import type { NextFunction, Request, Response } from 'express'
// import jwt from 'jsonwebtoken'
// import { pool } from '../connector/db'

// import { isSystemUser } from '../lib/helpers'
// import { getBool, getNumber } from '../services/params'

import { resolveSession } from '../services/session'

export const COOKIE_NAME = 'token'

export interface AuthUser {
  id: string
  username: string
  fullName: string
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

// export async function requireAuth(req: Request, res: Response, next: NextFunction) {
//   try {
//     const token = req.cookies?.[COOKIE_NAME]
//     if (!token) {
//       res.status(401).json({ message: 'Belum login' })
//       return
//     }
//     const payload = jwt.verify(token, process.env.JWT_SECRET as string, {
//       algorithms: ['HS256'],
//     }) as jwt.JwtPayload

//     // masa berlaku sesi mengikuti parameter, termasuk untuk sesi yang sudah berjalan
//     const hours = await getNumber('session', 'duration_hours', 8)
//     if (!payload.iat || Date.now() / 1000 > payload.iat + hours * 3600) {
//       res.status(401).json({ message: 'Sesi telah berakhir. Silakan masuk lagi.', expired: true })
//       return
//     }

//     // user dicek ke DB tiap request: user yang dinonaktifkan langsung tidak bisa masuk
//     const { rows } = await pool.query(
//       `SELECT id, username, full_name
//          FROM users
//         WHERE id = $1 AND status = 'active'`,
//       [payload.sub],
//     )
//     if (!rows[0]) {
//       res.status(401).json({ message: 'Sesi tidak valid' })
//       return
//     }

//     // mode pemeliharaan: hanya admin yang boleh lanjut
//     if (await getBool('portal', 'maintenance_mode', false)) {
//       if (!(await isSystemUser(String(rows[0].id)))) {
//         res.status(401).json({ message: 'Portal sedang dalam pemeliharaan.', maintenance: true })
//         return
//       }
//     }

//     req.user = {
//       id: String(rows[0].id),
//       username: rows[0].username,
//       fullName: rows[0].full_name,
//     }
//     next()
//   } catch {
//     res.status(401).json({ message: 'Sesi tidak valid' })
//   }
// }

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const r = await resolveSession(req.cookies?.[COOKIE_NAME])
  if (!r.ok) {
    res.status(401).json({ message: r.message, expired: r.expired, maintenance: r.maintenance })
    return
  }
  req.user = r.user
  next()
}