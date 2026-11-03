import type { Request } from 'express'
import { pool } from '../connector/db'
import { getNumber, getString } from './params'

export interface LoginSecurity {
  maxAttempts: number
  windowMin: number
  blockMin: number
  blockBy: 'ip' | 'username' | 'both'
}

export async function getLoginSecurity(): Promise<LoginSecurity> {
  const [maxAttempts, windowMin, blockMin, blockBy] = await Promise.all([
    getNumber('login', 'max_attempts', 5),
    getNumber('login', 'window_minutes', 15),
    getNumber('login', 'block_minutes', 15),
    getString('login', 'block_by', 'ip'),
  ])
  return {
    maxAttempts,
    windowMin,
    blockMin,
    blockBy: blockBy === 'username' || blockBy === 'both' ? blockBy : 'ip',
  }
}

export function clientIp(req: Request): string {
  return (req.ip ?? req.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, '').slice(0, 64)
}

export function formatWait(sec: number): string {
  return sec >= 90 ? `${Math.ceil(sec / 60)} menit` : `${Math.max(1, sec)} detik`
}

// IP: semua kegagalan dalam jendela waktu.
// Username: hanya kegagalan setelah login sukses terakhir (login sukses mereset hitungan username).
async function failureState(scope: 'ip' | 'username', value: string, s: LoginSecurity) {
  const sql =
    scope === 'ip'
      ? `SELECT count(*)::int AS fails,
                COALESCE(ceil(extract(epoch FROM (max(created_at) + make_interval(mins => $3) - now()))), 0)::int AS retry_sec
           FROM login_attempts
          WHERE NOT success AND ip = $1
            AND created_at > now() - make_interval(mins => $2)`
      : `SELECT count(*)::int AS fails,
                COALESCE(ceil(extract(epoch FROM (max(a.created_at) + make_interval(mins => $3) - now()))), 0)::int AS retry_sec
           FROM login_attempts a
          WHERE NOT a.success AND a.username = $1
            AND a.created_at > now() - make_interval(mins => $2)
            AND a.created_at > COALESCE(
                  (SELECT max(x.created_at) FROM login_attempts x WHERE x.success AND x.username = $1),
                  '-infinity'::timestamptz)`
  const { rows } = await pool.query(sql, [value, s.windowMin, s.blockMin])
  return rows[0] as { fails: number; retry_sec: number }
}

export async function checkLoginBlock(username: string, ip: string, s: LoginSecurity) {
  const scopes: { scope: 'ip' | 'username'; value: string }[] = []
  if (s.blockBy !== 'username') scopes.push({ scope: 'ip', value: ip })
  if (s.blockBy !== 'ip') scopes.push({ scope: 'username', value: username })

  let retry = 0
  for (const sc of scopes) {
    const r = await failureState(sc.scope, sc.value, s)
    if (r.fails >= s.maxAttempts && r.retry_sec > 0) retry = Math.max(retry, r.retry_sec)
  }
  return retry > 0 ? { retrySec: retry } : null
}

export async function recordLoginAttempt(username: string, ip: string, success: boolean) {
  await pool.query('INSERT INTO login_attempts (username, ip, success) VALUES ($1, $2, $3)', [
    username,
    ip,
    success,
  ])
}

// bersihkan catatan lama sekali sejam
export function startLoginAttemptCleanup() {
  const run = () =>
    pool
      .query(`DELETE FROM login_attempts WHERE created_at < now() - interval '30 days'`)
      .catch((e) => console.error('Pembersihan login_attempts gagal:', e.message))
  run()
  setInterval(run, 60 * 60 * 1000).unref()
}