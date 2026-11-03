import type { PoolClient } from 'pg'
import { HttpError } from '../lib/helpers'

/*
 * Operasi Group & Hak Akses yang dipakai bersama oleh:
 *   - routes/groups.ts                  (jalur langsung)
 *   - approval/handlers/groupsChange.ts (jalur persetujuan)
 * Semua fungsi menerima `db` = client transaksi, supaya bisa ikut transaksi pemanggilnya.
 */
type Db = Pick<PoolClient, 'query'>
type Json = Record<string, any>

export const ACTIONS = ['create', 'read', 'update', 'delete'] as const
export type PermInput = {
  menuId: string
  create: boolean
  read: boolean
  update: boolean
  delete: boolean
  needsApproval: boolean
}

async function isSystemMemberDb(db: Db, userId: string) {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM user_groups ug
         JOIN groups g ON g.id = ug.group_id
        WHERE ug.user_id = $1 AND g.is_system
     ) AS yes`,
    [userId],
  )
  return rows[0].yes as boolean
}

// user non-admin hanya boleh memberi izin yang dia sendiri punya
export async function assertCanGrant(db: Db, actorId: string, perms: PermInput[]) {
  if (await isSystemMemberDb(db, actorId)) return
  const { rows } = await db.query(
    `SELECT p.menu_id::text AS "menuId",
            bool_or(p.can_create) AS "create", bool_or(p.can_read) AS "read",
            bool_or(p.can_update) AS "update", bool_or(p.can_delete) AS "delete"
       FROM user_groups ug
       JOIN groups g ON g.id = ug.group_id AND g.status = 'active'
       JOIN group_menu_permissions p ON p.group_id = g.id
      WHERE ug.user_id = $1
      GROUP BY p.menu_id`,
    [actorId],
  )
  const mine = new Map<string, Record<string, boolean>>(rows.map((r) => [r.menuId, r]))
  for (const p of perms) {
    for (const a of ACTIONS) {
      if (p[a] && !mine.get(p.menuId)?.[a]) {
        throw new HttpError(403, 'Tidak boleh memberi izin yang tidak Anda miliki')
      }
    }
  }
}

/**
 * Menentukan nilai "Butuh approval" yang akan disimpan per halaman.
 *  - Administrator: memakai pilihan di form (bermakna hanya jika halaman punya izin tambah/ubah/hapus).
 *  - Non-admin: TIDAK boleh mengubah. Nilai lama dipertahankan; izin tulis yang baru diberikan
 *    otomatis butuh approval (supaya tidak ada cara melepas kontrol ini lewat halaman Group).
 */
export async function resolveFlags(
  db: Db,
  actorId: string,
  groupId: string | null,
  perms: PermInput[],
): Promise<PermInput[]> {
  const admin = await isSystemMemberDb(db, actorId)
  let prev = new Map<string, { write: boolean; needs: boolean }>()
  if (!admin && groupId) {
    const { rows } = await db.query(
      `SELECT menu_id::text AS "menuId",
              (can_create OR can_update OR can_delete) AS write, needs_approval AS needs
         FROM group_menu_permissions WHERE group_id = $1`,
      [groupId],
    )
    prev = new Map(rows.map((r) => [r.menuId, { write: r.write, needs: r.needs }]))
  }
  return perms.map((p) => {
    const write = p.create || p.update || p.delete
    if (!write) return { ...p, needsApproval: false }
    if (admin) return p
    const old = prev.get(p.menuId)
    return { ...p, needsApproval: old?.write ? old.needs : true }
  })
}

export async function savePermissions(db: Db, groupId: string, perms: PermInput[]) {
  const unique = [...new Map(perms.map((p) => [p.menuId, p])).values()]
  const active = unique.filter((p) => p.create || p.read || p.update || p.delete)
  await db.query('DELETE FROM group_menu_permissions WHERE group_id = $1', [groupId])
  if (active.length === 0) return
  await db.query(
    `INSERT INTO group_menu_permissions
       (group_id, menu_id, can_create, can_read, can_update, can_delete, needs_approval)
     SELECT $1::bigint, t.menu_id, t.c, t.r, t.u, t.d, t.n
       FROM unnest($2::bigint[], $3::boolean[], $4::boolean[], $5::boolean[], $6::boolean[], $7::boolean[])
            AS t(menu_id, c, r, u, d, n)`,
    [
      groupId,
      active.map((p) => p.menuId),
      active.map((p) => p.create),
      active.map((p) => p.read),
      active.map((p) => p.update),
      active.map((p) => p.delete),
      active.map((p) => p.needsApproval),
    ],
  )
}

/**
 * Merencanakan perubahan anggota (hanya MEMERIKSA, tidak menulis).
 * Mengembalikan siapa yang ditambah / dikeluarkan dan jumlah anggota saat ini.
 */
export async function planMembers(db: Db, groupId: string, actorId: string, userIds: string[]) {
  const g = await db.query('SELECT is_system, status FROM groups WHERE id = $1 FOR UPDATE', [groupId])
  if (!g.rows[0]) throw new HttpError(404, 'Group tidak ditemukan')

  const actorIsSystem = await isSystemMemberDb(db, actorId)
  if (g.rows[0].is_system && !actorIsSystem) {
    throw new HttpError(403, 'Hanya admin yang boleh mengatur anggota group sistem')
  }

  const wanted = new Set(userIds)
  const cur = await db.query('SELECT user_id::text AS id FROM user_groups WHERE group_id = $1', [groupId])
  const have = new Set<string>(cur.rows.map((r) => r.id))
  const added = [...wanted].filter((u) => !have.has(u))
  const removed = [...have].filter((u) => !wanted.has(u))
  if (added.length === 0 && removed.length === 0) return { added, removed, current: have.size }

  if ([...added, ...removed].includes(actorId)) {
    throw new HttpError(403, 'Tidak boleh mengubah keanggotaan akun sendiri')
  }
  if (added.length > 0) {
    if (g.rows[0].status !== 'active') {
      throw new HttpError(400, 'Group nonaktif tidak bisa diberi anggota baru')
    }
    const ok = await db.query('SELECT count(*)::int AS n FROM users WHERE id = ANY($1::bigint[])', [added])
    if (ok.rows[0].n !== added.length) throw new HttpError(400, 'Ada user yang tidak ditemukan')
  }
  if (!actorIsSystem) {
    const adm = await db.query(
      `SELECT EXISTS (
         SELECT 1 FROM user_groups ug
           JOIN groups sg ON sg.id = ug.group_id
          WHERE ug.user_id = ANY($1::bigint[]) AND sg.is_system
       ) AS yes`,
      [[...added, ...removed]],
    )
    if (adm.rows[0].yes) throw new HttpError(403, 'Hanya admin yang boleh mengubah keanggotaan user admin')
  }
  return { added, removed, current: have.size }
}

/** Menulis perubahan anggota yang sudah direncanakan oleh planMembers. */
export async function applyMembers(db: Db, groupId: string, added: string[], removed: string[], assignedBy: string) {
  if (removed.length > 0) {
    await db.query('DELETE FROM user_groups WHERE group_id = $1 AND user_id = ANY($2::bigint[])', [
      groupId,
      removed,
    ])
  }
  if (added.length > 0) {
    // satu user hanya boleh punya satu group: lepas dulu dari group lain
    await db.query('DELETE FROM user_groups WHERE user_id = ANY($1::bigint[]) AND group_id <> $2', [
      added,
      groupId,
    ])
    await db.query(
      `INSERT INTO user_groups (user_id, group_id, assigned_by)
       SELECT u, $1::bigint, $3::bigint FROM unnest($2::bigint[]) AS u
       ON CONFLICT (user_id, group_id) DO NOTHING`,
      [groupId, added, assignedBy],
    )
  }
}

// ---------- representasi JSON untuk halaman Persetujuan (Record lama / baru) ----------

export async function menuCodeMap(db: Db) {
  const { rows } = await db.query('SELECT id::text AS id, code FROM menus')
  return new Map<string, string>(rows.map((r) => [r.id, r.code]))
}

/** Izin per halaman sebagai pasangan kunci "izin:<kode menu>" -> teks, agar selisihnya terbaca per halaman. */
export function permsToRecord(perms: PermInput[], codes: Map<string, string>): Json {
  const out: Json = {}
  const rows = perms
    .map((p) => {
      const parts = [p.read && 'lihat', p.create && 'tambah', p.update && 'ubah', p.delete && 'hapus'].filter(Boolean)
      return { key: `izin:${codes.get(p.menuId) ?? p.menuId}`, text: parts.join(', '), needs: p.needsApproval }
    })
    .filter((r) => r.text)
    .sort((a, b) => a.key.localeCompare(b.key))
  for (const r of rows) out[r.key] = r.text + (r.needs ? ' · butuh approval' : '')
  return out
}

/** Keadaan group saat ini dalam bentuk record yang sama dengan permsToRecord. */
export async function currentGroupRecord(db: Db, groupId: string) {
  const g = await db.query(
    `SELECT code, name, COALESCE(description, '') AS description, status, is_system AS "isSystem"
       FROM groups WHERE id = $1`,
    [groupId],
  )
  if (!g.rows[0]) return null
  const p = await db.query(
    `SELECT menu_id::text AS "menuId", can_create AS "create", can_read AS "read",
            can_update AS "update", can_delete AS "delete", needs_approval AS "needsApproval"
       FROM group_menu_permissions WHERE group_id = $1`,
    [groupId],
  )
  const { isSystem, ...rest } = g.rows[0]
  return {
    isSystem: isSystem as boolean,
    record: { ...rest, ...permsToRecord(p.rows as PermInput[], await menuCodeMap(db)) } as Json,
  }
}