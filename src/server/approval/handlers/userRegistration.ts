import { ApprovalError, type ApprovalHandler, type Db } from '../service'
import { hashPassword } from '../../lib/password'
import { assertPasswordPolicy } from '../../services/passwordPolicy'

/** Validasi pilihan group untuk user baru. Group ADMIN hanya boleh dipilih Administrator. */
async function checkGroup(db: Db, groupId: unknown, approverGroup: string): Promise<string> {
  const id = String(groupId ?? '')
  if (!/^\d+$/.test(id)) throw new ApprovalError(400, 'Group untuk user baru wajib dipilih')
  const { rows: [g] } = await db.query(
    `SELECT id, code FROM groups WHERE id = $1 AND status = 'active'`,
    [id],
  )
  if (!g) throw new ApprovalError(400, 'Group tidak valid')
  if (g.code === 'ADMIN' && approverGroup !== 'ADMIN') {
    throw new ApprovalError(403, 'Hanya Administrator yang boleh memberi group ADMIN')
  }
  return id
}

export const userRegistration: ApprovalHandler = {
  code: 'USER_REGISTRATION',

  async prepare(input, db) {
    const i = (input ?? {}) as Record<string, unknown>
    const username = String(i.username ?? '').trim().toLowerCase()
    const email = String(i.email ?? '').trim().toLowerCase()
    const fullName = String(i.fullName ?? '').trim()
    const password = String(i.password ?? '')

    if (!/^[a-z0-9_.]{3,50}$/.test(username)) {
      throw new ApprovalError(400, 'Username 3-50 karakter: huruf kecil, angka, titik, underscore')
    }
    if (email.length > 150 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new ApprovalError(400, 'Format email tidak valid')
    }
    if (!fullName || fullName.length > 100) {
      throw new ApprovalError(400, 'Nama lengkap wajib diisi (maks. 100 karakter)')
    }
    try {
      await assertPasswordPolicy(password)
    } catch (e) {
      throw new ApprovalError(400, e instanceof Error ? e.message : 'Password tidak memenuhi aturan')
    }

    const { rows } = await db.query(
      `SELECT 1 FROM users WHERE username = $1 OR email = $2
       UNION ALL
       SELECT 1 FROM approval_requests r
         JOIN approval_types t ON t.id = r.type_id
        WHERE t.code = 'USER_REGISTRATION' AND r.status = 'pending'
          AND (r.unique_key = $1 OR r.payload->>'email' = $2)
       LIMIT 1`,
      [username, email],
    )
    if (rows.length) {
      throw new ApprovalError(409, 'Username atau email sudah terdaftar atau sedang menunggu persetujuan')
    }

    return {
      subject: `Registrasi: ${username} (${fullName})`,
      uniqueKey: username,
      payload: { username, email, fullName, passwordHash: await hashPassword(password) },
    }
  },

  // approver boleh memilih group di tahap mana pun; kalau diisi, langsung diperiksa
  async validateStep({ db, data, approverGroup }) {
    if (data.groupId !== undefined && data.groupId !== null && data.groupId !== '') {
      await checkGroup(db, data.groupId, approverGroup)
    }
  },

  // dijalankan saat tahap terakhir disetujui; groupId harus sudah dipilih di salah satu tahap
  async onApprove({ db, request, decision, approverId, approverGroup }) {
    const groupId = await checkGroup(db, decision.groupId, approverGroup)

    const p = request.payload
    try {
      const { rows: [u] } = await db.query(
        `INSERT INTO users (username, email, full_name, password_hash)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [p.username, p.email, p.fullName, p.passwordHash],
      )
      await db.query(
        `INSERT INTO user_groups (user_id, group_id, assigned_by) VALUES ($1, $2, $3)`,
        [u.id, groupId, approverId],
      )
    } catch (e: any) {
      if (e?.code === '23505') {
        throw new ApprovalError(409, 'Username atau email sudah dipakai akun lain. Tolak pengajuan ini.')
      }
      throw e
    }
  },

  redact({ passwordHash: _hidden, ...rest }) {
    return rest
  },
}