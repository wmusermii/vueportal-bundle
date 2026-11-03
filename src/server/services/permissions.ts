import { pool } from '../connector/db'

export interface MenuPermission {
  menu: string
  create: boolean
  read: boolean
  update: boolean
  delete: boolean
}
export interface UserGroup { code: string; name: string }
export async function getPermissions(userId: string): Promise<MenuPermission[]> {
  const { rows } = await pool.query(
    `SELECT m.code AS menu,
            bool_or(p.can_create) AS "create",
            bool_or(p.can_read)   AS "read",
            bool_or(p.can_update) AS "update",
            bool_or(p.can_delete) AS "delete"
       FROM user_groups ug
       JOIN groups g ON g.id = ug.group_id AND g.status = 'active'
       JOIN group_menu_permissions p ON p.group_id = g.id
       JOIN menus m ON m.id = p.menu_id AND m.status = 'active'
      WHERE ug.user_id = $1
      GROUP BY m.id, m.code
      ORDER BY m.code`,
    [userId],
  )
  return rows
}
export async function getGroup(userId: string): Promise<UserGroup | null> {
  const { rows } = await pool.query(
    `SELECT g.code, g.name
       FROM user_groups ug
       JOIN groups g ON g.id = ug.group_id AND g.status = 'active'
      WHERE ug.user_id = $1
      LIMIT 1`,
    [userId],
  )
  return rows[0] ?? null
}