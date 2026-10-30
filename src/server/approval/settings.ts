import { pool } from '../connector/db' // sesuaikan: file tempat Pool dibuat
import { ApprovalError } from './service'

const isId = (x: unknown) => /^\d+$/.test(String(x ?? ''))

/** Semua jenis approval beserta penugasannya. */
export async function listTypes() {
  const { rows } = await pool.query(
    `SELECT t.id, t.code, t."name", t.description, t.is_public AS "isPublic",
            COALESCE((
              SELECT json_agg(json_build_object(
                       'id', a.id::text, 'role', a.role, 'level', a.level,
                       'kind', CASE WHEN a.group_id IS NOT NULL THEN 'group' ELSE 'user' END,
                       'refId', COALESCE(a.group_id, a.user_id)::text,
                       'label', COALESCE(g."name", u.full_name),
                       'sub', COALESCE(g.code, u.username))
                     ORDER BY a.role, a.level, COALESCE(g."name", u.full_name))
                FROM portal.approval_assignments a
                LEFT JOIN portal.groups g ON g.id = a.group_id
                LEFT JOIN portal.users u ON u.id = a.user_id
               WHERE a.type_id = t.id), '[]'::json) AS assignments
       FROM portal.approval_types t
      WHERE t.status = 'active'
      ORDER BY t."name"`,
  )
  return rows
}

/** Pilihan penerima. Administrator tidak ditawarkan: dia selalu boleh dan tidak perlu ditugaskan. */
export async function listOptions() {
  const groups = await pool.query(
    `SELECT id, code, "name" FROM portal.groups
      WHERE status = 'active' AND code <> 'ADMIN' ORDER BY "name"`,
  )
  const users = await pool.query(
    `SELECT u.id, u.username, u.full_name AS "fullName" FROM portal.users u
      WHERE u.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM portal.user_groups ug
                          JOIN portal.groups g ON g.id = ug.group_id
                         WHERE ug.user_id = u.id AND g.code = 'ADMIN')
      ORDER BY u.full_name`,
  )
  return { groups: groups.rows, users: users.rows }
}

export async function addAssignment(body: any, createdBy: string) {
  const role = body?.role
  if (role !== 'approver' && role !== 'editor') throw new ApprovalError(400, 'Peran tidak valid')
  const level = role === 'editor' ? 0 : Number(body?.level)
  if (role === 'approver' && !(Number.isInteger(level) && level >= 1 && level <= 5)) {
    throw new ApprovalError(400, 'Level approver harus 1 sampai 5')
  }
  if (!isId(body?.typeId)) throw new ApprovalError(400, 'Jenis approval tidak valid')
  const hasGroup = isId(body?.groupId)
  const hasUser = isId(body?.userId)
  if (hasGroup === hasUser) throw new ApprovalError(400, 'Pilih satu group atau satu user')

  const { rows: [type] } = await pool.query<{ id: string; is_public: boolean }>(
    `SELECT id, is_public FROM portal.approval_types WHERE id = $1 AND status = 'active'`,
    [String(body.typeId)],
  )
  if (!type) throw new ApprovalError(404, 'Jenis approval tidak ditemukan')
  if (role === 'editor' && type.is_public) {
    throw new ApprovalError(400, 'Jenis publik tidak memerlukan Editor')
  }

  if (hasGroup) {
    const { rows: [g] } = await pool.query<{ code: string }>(
      `SELECT code FROM portal.groups WHERE id = $1 AND status = 'active'`,
      [String(body.groupId)],
    )
    if (!g) throw new ApprovalError(400, 'Group tidak valid')
    if (g.code === 'ADMIN') throw new ApprovalError(400, 'Administrator tidak perlu ditugaskan')
  } else {
    const { rows: [u] } = await pool.query(
      `SELECT 1 FROM portal.users u
        WHERE u.id = $1 AND u.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM portal.user_groups ug
                            JOIN portal.groups g ON g.id = ug.group_id
                           WHERE ug.user_id = u.id AND g.code = 'ADMIN')`,
      [String(body.userId)],
    )
    if (!u) throw new ApprovalError(400, 'User tidak valid atau Administrator')
  }

  // level harus berurutan: level N hanya boleh ada kalau level 1..N-1 sudah punya approver
  if (role === 'approver' && level > 1) {
    const { rows: [c] } = await pool.query<{ n: number }>(
      `SELECT count(DISTINCT level)::int AS n FROM portal.approval_assignments
        WHERE type_id = $1 AND role = 'approver' AND level < $2`,
      [type.id, level],
    )
    if (c.n !== level - 1) throw new ApprovalError(400, `Isi approver level ${level - 1} terlebih dahulu`)
  }

  try {
    await pool.query(
      `INSERT INTO portal.approval_assignments (type_id, role, level, group_id, user_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [type.id, role, level, hasGroup ? String(body.groupId) : null, hasUser ? String(body.userId) : null, createdBy],
    )
  } catch (e: any) {
    if (e?.code === '23505') throw new ApprovalError(409, 'Penugasan yang sama sudah ada')
    throw e
  }
}

export async function removeAssignment(id: string) {
  if (!isId(id)) throw new ApprovalError(400, 'ID tidak valid')
  const { rows: [a] } = await pool.query<{ role: string; same_level: number; has_higher: boolean }>(
    `SELECT a.role,
            (SELECT count(*) FROM portal.approval_assignments b
              WHERE b.type_id = a.type_id AND b.role = a.role AND b.level = a.level)::int AS same_level,
            EXISTS (SELECT 1 FROM portal.approval_assignments b
                     WHERE b.type_id = a.type_id AND b.role = 'approver' AND b.level > a.level) AS has_higher
       FROM portal.approval_assignments a WHERE a.id = $1`,
    [id],
  )
  if (!a) throw new ApprovalError(404, 'Penugasan tidak ditemukan')
  // jangan sisakan level kosong di tengah
  if (a.role === 'approver' && a.same_level === 1 && a.has_higher) {
    throw new ApprovalError(409, 'Level ini masih punya level di atasnya. Hapus level di atasnya terlebih dahulu')
  }
  await pool.query(`DELETE FROM portal.approval_assignments WHERE id = $1`, [id])
}