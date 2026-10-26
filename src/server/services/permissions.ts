import { pool } from '../connector/db'

export interface MenuPermission {
  menu: string
  create: boolean
  read: boolean
  update: boolean
  delete: boolean
}

export async function getPermissions(userId: string): Promise<MenuPermission[]> {
  const { rows } = await pool.query(
    `SELECT m.code AS menu,
            bool_or(p.can_create) AS "create",
            bool_or(p.can_read)   AS "read",
            bool_or(p.can_update) AS "update",
            bool_or(p.can_delete) AS "delete"
       FROM portal.user_groups ug
       JOIN portal.groups g ON g.id = ug.group_id AND g.status = 'active'
       JOIN portal.group_menu_permissions p ON p.group_id = g.id
       JOIN portal.menus m ON m.id = p.menu_id AND m.status = 'active'
      WHERE ug.user_id = $1
      GROUP BY m.id, m.code
      ORDER BY m.code`,
    [userId],
  )
  return rows
}