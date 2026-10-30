import type { PoolClient } from 'pg'
import { pool } from '../connector/db' // sesuaikan: file tempat Pool dibuat

export class ApprovalError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type Db = Pick<PoolClient, 'query'>
export type Json = Record<string, any>

export type ApprovalRow = {
  id: string
  type_id: string
  type_code: string
  status: 'pending' | 'approved' | 'rejected'
  subject: string
  payload: Json
  requested_by: string | null
}

export interface ApprovalHandler {
  code: string
  /** Validasi input pengajuan dan bentuk datanya. Lempar ApprovalError kalau tidak valid. */
  prepare(input: unknown, db: Db): Promise<{ subject: string; uniqueKey?: string; payload: Json }>
  /** Dijalankan DI DALAM transaksi saat disetujui. Lempar error = batal semua. */
  onApprove(ctx: {
    db: Db
    request: ApprovalRow
    decision: Json
    approverId: string
    approverGroup: string
  }): Promise<void>
  /** Buang field rahasia sebelum payload dikirim ke browser. */
  redact?(payload: Json): Json
}

const handlers = new Map<string, ApprovalHandler>()
export function registerHandler(h: ApprovalHandler) {
  handlers.set(h.code, h)
}

// user ini termasuk group approver untuk jenis dari r.type_id ($1 = user id)
const CAN_DECIDE = `EXISTS (
  SELECT 1 FROM portal.approval_type_approvers a
  JOIN portal.user_groups ug ON ug.group_id = a.group_id
  JOIN portal.groups g ON g.id = ug.group_id AND g.status = 'active'
  WHERE a.type_id = r.type_id AND ug.user_id = $1)`

/** Buat pengajuan. requestedBy = null untuk pengaju publik (belum login). */
export async function createRequest(code: string, input: unknown, requestedBy: string | null) {
  const h = handlers.get(code)
  if (!h) throw new ApprovalError(500, 'Handler approval belum terdaftar')

  const { rows: [type] } = await pool.query<{ id: string; is_public: boolean }>(
    `SELECT id, is_public FROM portal.approval_types WHERE code = $1 AND status = 'active'`,
    [code],
  )
  if (!type) throw new ApprovalError(404, 'Jenis approval tidak aktif')
  if (!requestedBy && !type.is_public) throw new ApprovalError(401, 'Silakan login terlebih dahulu')

  const p = await h.prepare(input, pool)
  try {
    const { rows: [row] } = await pool.query<{ id: string }>(
      `INSERT INTO portal.approval_requests (type_id, subject, unique_key, payload, requested_by)
       VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
      [type.id, p.subject, p.uniqueKey ?? null, JSON.stringify(p.payload), requestedBy],
    )
    return row.id
  } catch (e: any) {
    if (e?.code === '23505') throw new ApprovalError(409, 'Pengajuan yang sama masih menunggu persetujuan')
    throw e
  }
}

/** Daftar pengajuan yang boleh dilihat/diputuskan user ini. */
export async function listRequests(userId: string, status?: string) {
  if (status && !['pending', 'approved', 'rejected'].includes(status)) {
    throw new ApprovalError(400, 'Status tidak valid')
  }
  const { rows } = await pool.query(
    `SELECT r.id, t.code AS type_code, t."name" AS type_name, r.status, r.subject, r.payload,
            r.decided_at, r.note, r.created_at, u."full_name" AS decided_by_name
       FROM portal.approval_requests r
       JOIN portal.approval_types t ON t.id = r.type_id
       LEFT JOIN portal.users u ON u.id = r.decided_by
      WHERE ${CAN_DECIDE}
        AND ($2::text IS NULL OR r.status::text = $2)
      ORDER BY (r.status = 'pending') DESC, r.created_at DESC
      LIMIT 200`,
    [userId, status ?? null],
  )
  return rows.map((r) => ({
    ...r,
    payload: handlers.get(r.type_code)?.redact?.(r.payload) ?? r.payload,
  }))
}

export async function countPending(userId: string) {
  const { rows: [row] } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM portal.approval_requests r
      WHERE r.status = 'pending' AND ${CAN_DECIDE}`,
    [userId],
  )
  return row.n
}

/** Pilihan group untuk user baru. Group ADMIN hanya muncul bagi approver ADMIN. */
export async function groupOptions(userId: string) {
  const { rows } = await pool.query<{ id: string; code: string; name: string }>(
    `SELECT g.id, g.code, g."name" FROM portal.groups g
      WHERE g.status = 'active'
        AND EXISTS (SELECT 1 FROM portal.approval_type_approvers a
                    JOIN portal.user_groups ug ON ug.group_id = a.group_id
                    WHERE ug.user_id = $1)
        AND (g.code <> 'ADMIN' OR EXISTS (
              SELECT 1 FROM portal.user_groups ug2
              JOIN portal.groups mg ON mg.id = ug2.group_id
              WHERE ug2.user_id = $1 AND mg.code = 'ADMIN'))
      ORDER BY g."name"`,
    [userId],
  )
  return rows
}

export async function decide(
  id: string,
  userId: string,
  action: 'approve' | 'reject',
  body: { decision?: Json; note?: string },
) {
  if (!/^\d+$/.test(id)) throw new ApprovalError(400, 'ID tidak valid')
  const note = (body.note ?? '').trim()
  if (action === 'reject' && !note) throw new ApprovalError(400, 'Alasan penolakan wajib diisi')
  if (note.length > 500) throw new ApprovalError(400, 'Catatan maksimal 500 karakter')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: [r] } = await client.query<ApprovalRow>(
      `SELECT r.id, r.type_id, r.status, r.subject, r.payload, r.requested_by, t.code AS type_code
         FROM portal.approval_requests r
         JOIN portal.approval_types t ON t.id = r.type_id
        WHERE r.id = $1
          FOR UPDATE OF r`,
      [id],
    )
    if (!r) throw new ApprovalError(404, 'Pengajuan tidak ditemukan')
    if (r.status !== 'pending') throw new ApprovalError(409, 'Pengajuan sudah diputuskan')

    const { rows: [ag] } = await client.query<{ code: string }>(
      `SELECT g.code FROM portal.approval_type_approvers a
         JOIN portal.user_groups ug ON ug.group_id = a.group_id
         JOIN portal.groups g ON g.id = ug.group_id AND g.status = 'active'
        WHERE a.type_id = $1 AND ug.user_id = $2
        LIMIT 1`,
      [r.type_id, userId],
    )
    if (!ag) throw new ApprovalError(403, 'Anda tidak berwenang memutuskan pengajuan ini')
    if (r.requested_by !== null && r.requested_by === userId) {
      throw new ApprovalError(403, 'Tidak boleh memutuskan pengajuan sendiri')
    }

    const h = handlers.get(r.type_code)
    if (!h) throw new ApprovalError(500, 'Handler approval belum terdaftar')

    const decision = body.decision ?? {}
    if (action === 'approve') {
      await h.onApprove({ db: client, request: r, decision, approverId: userId, approverGroup: ag.code })
    }

    await client.query(
      `UPDATE portal.approval_requests
          SET status = $2::portal.approval_status, decision = $3::jsonb,
              decided_by = $4, decided_at = now(), note = $5, updated_at = now()
        WHERE id = $1`,
      [id, action === 'approve' ? 'approved' : 'rejected',
       action === 'approve' ? JSON.stringify(decision) : null, userId, note || null],
    )
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}