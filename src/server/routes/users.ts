import { Router } from 'express'
import { pool } from '../connector/db'
import { requirePermission } from '../middleware/permission'

export const usersRouter = Router()

usersRouter.get('/', requirePermission('users', 'read'), async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.username, u.email, u.full_name AS "fullName", u.status,
           COALESCE(array_agg(g.code ORDER BY g.code) FILTER (WHERE g.code IS NOT NULL), '{}') AS groups
      FROM portal.users u
      LEFT JOIN portal.user_groups ug ON ug.user_id = u.id
      LEFT JOIN portal.groups g ON g.id = ug.group_id
     GROUP BY u.id
     ORDER BY u.id
  `)
  res.json(rows)
})

// kerangka dulu, hapus sungguhan nanti di langkah CRUD
usersRouter.delete('/:id', requirePermission('users', 'delete'), (req, res) => {
  res.json({ ok: true, note: `lolos izin delete untuk id ${req.params.id}, belum menghapus apa pun` })
})