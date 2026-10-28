import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../connector/db'
import { requirePermission } from '../middleware/permission'
import { getMenuTree } from '../services/menus'
import { HttpError, badRequest, idParam, sendError } from '../lib/helpers'
import type {} from '../middleware/auth'

export const menusRouter = Router()

const menuSchema = z
  .object({
    parentId: z.string().regex(/^\d+$/).nullable(),
    code: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_.-]{1,59}$/, 'huruf kecil, angka, titik, _ atau - (2-60 karakter, diawali huruf)'),
    title: z.string().trim().min(1).max(100),
    type: z.enum(['folder', 'page']),
    path: z
      .string()
      .trim()
      .regex(/^\/[a-z0-9/_-]*$/, 'diawali / dan berisi huruf kecil, angka, / _ -')
      .max(150)
      .nullable(),
    icon: z.string().trim().regex(/^[a-z0-9-]{1,50}$/).nullable(),
    sortOrder: z.number().int().min(0).max(9999),
    status: z.enum(['active', 'inactive']),
  })
  .refine((m) => (m.type === 'page' ? m.path !== null : m.path === null), {
    message: 'halaman wajib memiliki path, folder tidak boleh',
    path: ['path'],
  })

// sidebar milik user yang sedang login (semua user login boleh)
menusRouter.get('/mine', async (req, res) => {
  res.json(await getMenuTree(req.user!.id))
})

// seluruh menu, berurutan seperti pohon (induk lalu anaknya)
menusRouter.get('/', requirePermission('menus', 'read'), async (_req, res) => {
  const { rows } = await pool.query(`
    WITH RECURSIVE t AS (
      SELECT m.*, ARRAY[m.sort_order::bigint, m.id] AS sort_key
        FROM portal.menus m
       WHERE m.parent_id IS NULL
      UNION ALL
      SELECT c.*, t.sort_key || ARRAY[c.sort_order::bigint, c.id]
        FROM portal.menus c
        JOIN t ON c.parent_id = t.id
    )
    SELECT id::text AS id, parent_id::text AS "parentId", code, title, type, path, icon,
           level, sort_order AS "sortOrder", status, is_system AS "isSystem"
      FROM t
     ORDER BY sort_key
  `)
  res.json(rows)
})

menusRouter.post('/', requirePermission('menus', 'create'), async (req, res) => {
  const p = menuSchema.safeParse(req.body)
  if (!p.success) {
    badRequest(res, p.error)
    return
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO portal.menus (parent_id, code, title, type, path, icon, sort_order, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text AS id`,
      [p.data.parentId, p.data.code, p.data.title, p.data.type, p.data.path, p.data.icon, p.data.sortOrder, p.data.status],
    )
    res.status(201).json({ id: rows[0].id })
  } catch (e) {
    sendError(res, e)
  }
})

menusRouter.put('/:id', requirePermission('menus', 'update'), async (req, res) => {
  const p = menuSchema.safeParse(req.body)
  if (!p.success) {
    badRequest(res, p.error)
    return
  }
  try {
    const id = idParam(String(req.params.id))
    const r = await pool.query(
      `UPDATE portal.menus
          SET parent_id = $2, code = $3, title = $4, type = $5,
              path = $6, icon = $7, sort_order = $8, status = $9
        WHERE id = $1`,
      [id, p.data.parentId, p.data.code, p.data.title, p.data.type, p.data.path, p.data.icon, p.data.sortOrder, p.data.status],
    )
    if (r.rowCount === 0) throw new HttpError(404, 'Menu tidak ditemukan')
    res.json({ ok: true })
  } catch (e) {
    sendError(res, e)
  }
})

menusRouter.delete('/:id', requirePermission('menus', 'delete'), async (req, res) => {
  try {
    const id = idParam(String(req.params.id))
    const r = await pool.query('DELETE FROM portal.menus WHERE id = $1', [id])
    if (r.rowCount === 0) throw new HttpError(404, 'Menu tidak ditemukan')
    res.json({ ok: true })
  } catch (e) {
    sendError(res, e)
  }
})