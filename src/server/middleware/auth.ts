import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { pool } from '../connector/db'

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

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE_NAME]
    if (!token) {
      res.status(401).json({ message: 'unauthorized!, User are not login yet!' })
      return
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET as string, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload

    // user dicek ke DB tiap request: user yang dinonaktifkan langsung tidak bisa masuk
    const { rows } = await pool.query(
      `SELECT id, username, full_name
         FROM portal.users
        WHERE id = $1 AND status = 'active'`,
      [payload.sub],
    )
    if (!rows[0]) {
      res.status(401).json({ message: 'Sesi tidak valid' })
      return
    }

    req.user = {
      id: String(rows[0].id),
      username: rows[0].username,
      fullName: rows[0].full_name,
    }
    next()
  } catch {
    res.status(401).json({ message: 'Sesi tidak valid' })
  }
}