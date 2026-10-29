import jwt from 'jsonwebtoken'
import { pool } from '../connector/db'
import { isSystemUser } from '../lib/helpers'
import { getBool, getNumber } from './params'

export interface SessionUser {
  id: string
  username: string
  fullName: string
}

export type SessionResult =
  | { ok: true; user: SessionUser }
  | { ok: false; message: string; expired?: boolean; maintenance?: boolean }

export async function resolveSession(token: string | undefined | null): Promise<SessionResult> {
  if (!token) return { ok: false, message: 'Belum login' }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload

    // masa berlaku sesi mengikuti parameter, termasuk untuk sesi yang sudah berjalan
    const hours = await getNumber('session', 'duration_hours', 8)
    if (!payload.iat || Date.now() / 1000 > payload.iat + hours * 3600) {
      return { ok: false, message: 'Sesi telah berakhir. Silakan masuk lagi.', expired: true }
    }

    const { rows } = await pool.query(
      `SELECT id, username, full_name FROM portal.users WHERE id = $1 AND status = 'active'`,
      [payload.sub],
    )
    if (!rows[0]) return { ok: false, message: 'Sesi tidak valid' }
    const user: SessionUser = {
      id: String(rows[0].id),
      username: rows[0].username,
      fullName: rows[0].full_name,
    }

    // mode pemeliharaan: hanya admin yang boleh lanjut
    if ((await getBool('portal', 'maintenance_mode', false)) && !(await isSystemUser(user.id))) {
      return { ok: false, message: 'Portal sedang dalam pemeliharaan.', maintenance: true }
    }
    return { ok: true, user }
  } catch {
    return { ok: false, message: 'Sesi tidak valid' }
  }
}