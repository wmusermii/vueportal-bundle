import { ApprovalError } from '../service'
import { makeChangeHandler } from '../change'
import { applyMembers, assertCanGrant, savePermissions, type PermInput } from '../../services/groupsOps'

/**
 * Handler persetujuan untuk halaman Group & Hak Akses (menu 'groups', jenis approval 'GROUPS_CHANGE').
 * Satu jenis untuk dua hal, dibedakan oleh `record.entity` (disimpan di secret oleh routes/groups.ts):
 *   - 'group'   : tambah / ubah / hapus group beserta matriks izinnya
 *   - 'members' : mengganti anggota group (daftar yang ditambah & dikeluarkan sudah dihitung saat diajukan)
 * Aturan routes/groups.ts diperiksa ULANG di sini, memakai hak PENGAJU (bukan approver),
 * karena kondisi data bisa berubah sejak diajukan.
 */
export const groupsChange = makeChangeHandler({
  code: 'GROUPS_CHANGE',

  async apply({ db, action, targetId, record, requestedBy }) {
    if (!requestedBy) throw new ApprovalError(500, 'Pengajuan tidak memiliki pengaju')

    // ---------------- anggota group ----------------
    if (record.entity === 'members') {
      const added: string[] = record.added ?? []
      const removed: string[] = record.removed ?? []
      const g = await db.query('SELECT is_system, status FROM groups WHERE id = $1 FOR UPDATE', [targetId])
      if (!g.rows[0]) throw new ApprovalError(409, 'Group sudah tidak ada. Tolak pengajuan ini.')
      if (g.rows[0].is_system) {
        throw new ApprovalError(409, 'Anggota group sistem hanya boleh diubah admin langsung. Tolak pengajuan ini.')
      }
      if ([...added, ...removed].includes(requestedBy)) {
        throw new ApprovalError(409, 'Pengaju tidak boleh mengubah keanggotaan akunnya sendiri. Tolak pengajuan ini.')
      }
      if (added.length > 0) {
        if (g.rows[0].status !== 'active') {
          throw new ApprovalError(409, 'Group sekarang nonaktif dan tidak bisa diberi anggota. Tolak pengajuan ini.')
        }
        const ok = await db.query('SELECT count(*)::int AS n FROM users WHERE id = ANY($1::bigint[])', [added])
        if (ok.rows[0].n !== added.length) {
          throw new ApprovalError(409, 'Ada user yang sudah tidak ada. Tolak pengajuan ini.')
        }
      }
      const adm = await db.query(
        `SELECT EXISTS (SELECT 1 FROM user_groups ug JOIN groups sg ON sg.id = ug.group_id
                         WHERE ug.user_id = ANY($1::bigint[]) AND sg.is_system) AS yes`,
        [[...added, ...removed]],
      )
      if (adm.rows[0].yes) {
        throw new ApprovalError(409, 'Ada user admin di daftar ini; hanya admin langsung yang boleh. Tolak pengajuan ini.')
      }
      await applyMembers(db, targetId!, added, removed, requestedBy)
      return
    }

    // ---------------- group & izin ----------------
    const perms: PermInput[] = record.permissions ?? []

    if (action === 'create') {
      await assertCanGrant(db, requestedBy, perms)
      try {
        const { rows } = await db.query(
          `INSERT INTO groups (code, name, description, status) VALUES ($1, $2, $3, $4) RETURNING id`,
          [record.code, record.name, record.description || null, record.status],
        )
        await savePermissions(db, String(rows[0].id), perms)
      } catch (e: any) {
        if (e?.code === '23505') throw new ApprovalError(409, 'Kode atau nama group sudah dipakai. Tolak pengajuan ini.')
        throw e
      }
      return
    }

    if (!targetId) throw new ApprovalError(500, 'Pengajuan tidak memiliki target')
    const cur = await db.query('SELECT is_system FROM groups WHERE id = $1 FOR UPDATE', [targetId])
    if (!cur.rows[0]) throw new ApprovalError(409, 'Group sudah tidak ada. Tolak pengajuan ini.')
    if (cur.rows[0].is_system) {
      throw new ApprovalError(409, 'Group sistem tidak dapat diubah atau dihapus lewat pengajuan. Tolak pengajuan ini.')
    }

    if (action === 'update') {
      await assertCanGrant(db, requestedBy, perms)
      try {
        await db.query(
          `UPDATE groups SET code = $2, name = $3, description = $4, status = $5 WHERE id = $1`,
          [targetId, record.code, record.name, record.description || null, record.status],
        )
      } catch (e: any) {
        if (e?.code === '23505') throw new ApprovalError(409, 'Kode atau nama group sudah dipakai. Tolak pengajuan ini.')
        throw e
      }
      await savePermissions(db, targetId, perms)
      return
    }

    try {
      await db.query('DELETE FROM groups WHERE id = $1', [targetId])
    } catch (e: any) {
      if (e?.code === '23503') {
        if (e.constraint === 'fk_aa_group') {
          throw new ApprovalError(409, 'Group masih ditugaskan di Pengaturan Approval. Hapus penugasannya dulu, lalu tolak pengajuan ini.')
        }
        throw new ApprovalError(409, 'Group masih memiliki anggota. Pindahkan anggotanya dulu, lalu tolak pengajuan ini.')
      }
      throw e
    }
  },
})