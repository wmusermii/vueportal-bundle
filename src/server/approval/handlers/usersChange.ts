import { ApprovalError } from '../service'
import { makeChangeHandler } from '../change'

/**
 * Handler persetujuan untuk halaman Pengguna (menu 'users', jenis approval 'USERS_CHANGE').
 * Dijalankan di dalam transaksi persetujuan saat tahap terakhir disetujui.
 * Aturan dari routes/users.ts diperiksa ULANG di sini karena data bisa berubah sejak diajukan.
 */
export const usersChange = makeChangeHandler({
  code: 'USERS_CHANGE',

  async apply({ db, action, targetId, record }) {
    if (action === 'create') {
      try {
        await db.query(
          `INSERT INTO portal.users (username, email, full_name, password_hash, status)
           VALUES ($1, $2, $3, $4, $5)`,
          [record.username, record.email, record.fullName, record.passwordHash, record.status],
        )
      } catch (e: any) {
        if (e?.code === '23505') {
          throw new ApprovalError(409, 'Username atau email sudah dipakai akun lain. Tolak pengajuan ini.')
        }
        throw e
      }
      return
    }

    if (!targetId) throw new ApprovalError(500, 'Pengajuan tidak memiliki target')
    const found = await db.query('SELECT 1 FROM portal.users WHERE id = $1 FOR UPDATE', [targetId])
    if (found.rowCount === 0) throw new ApprovalError(409, 'User sudah tidak ada. Tolak pengajuan ini.')
    // akun admin tidak dikelola dari halaman Pengguna (sama seperti assertManageable di route)
    const sys = await db.query(
      `SELECT EXISTS (SELECT 1 FROM portal.user_groups ug JOIN portal.groups g ON g.id = ug.group_id
                       WHERE ug.user_id = $1 AND g.is_system) AS yes`,
      [targetId],
    )
    if (sys.rows[0].yes) {
      throw new ApprovalError(409, 'User ini sekarang termasuk akun admin dan tidak dapat dikelola. Tolak pengajuan ini.')
    }

    if (action === 'update') {
      try {
        await db.query(
          `UPDATE portal.users
              SET email = $2, full_name = $3, status = $4,
                  password_hash = COALESCE($5, password_hash)
            WHERE id = $1`,
          [targetId, record.email, record.fullName, record.status, record.passwordHash ?? null],
        )
      } catch (e: any) {
        if (e?.code === '23505') throw new ApprovalError(409, 'Email sudah dipakai akun lain. Tolak pengajuan ini.')
        throw e
      }
      return
    }

    try {
      await db.query('DELETE FROM portal.users WHERE id = $1', [targetId])
    } catch (e: any) {
      if (e?.code === '23503') {
        throw new ApprovalError(409, 'User tidak dapat dihapus karena masih dipakai data lain. Tolak pengajuan ini.')
      }
      throw e
    }
  },
})