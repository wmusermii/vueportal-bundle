import { Router, type Response } from 'express'
import { z } from 'zod'
import { pool } from '../connector/db'
import { requirePermission } from '../middleware/permission'
import { encryptSecret } from '../lib/crypto'
import { HttpError, badRequest, idParam, sendError, withTx } from '../lib/helpers'
import type {} from '../middleware/auth'

export const parametersRouter = Router()

const PARAM_ERRORS: Record<string, string> = {
  uq_parameters_key: 'Parameter dengan group dan key itu sudah ada',
  ck_parameters_group: 'Group: huruf kecil, angka, _ (2-30 karakter, diawali huruf)',
  ck_parameters_key: 'Key: huruf kecil, angka, _ (2-60 karakter, diawali huruf)',
  ck_parameters_number: 'Nilai angka tidak valid atau di luar batas min/maks',
  ck_parameters_boolean: 'Nilai harus true atau false',
  ck_parameters_select: 'Nilai harus salah satu dari pilihan yang tersedia',
  ck_parameters_range: 'Batas min/maks hanya untuk tipe angka, dan min tidak boleh lebih besar dari maks',
  ck_parameters_options: 'Pilihan hanya untuk tipe teks',
}

function fail(res: Response, e: unknown) {
  const c = (e as { constraint?: string }).constraint
  if (c && PARAM_ERRORS[c]) {
    res.status(c === 'uq_parameters_key' ? 409 : 400).json({ message: PARAM_ERRORS[c] })
    return
  }
  sendError(res, e)
}

const INT = z.number().int().min(-999999999).max(999999999)
const optionsSchema = z.array(z.string().trim().min(1).max(60)).max(20)

const createSchema = z.object({
  groupCode: z.string().trim(),
  key: z.string().trim(),
  valueType: z.enum(['text', 'number', 'boolean', 'secret']),
  value: z.string().max(1000).default(''),
  options: optionsSchema.nullable().default(null),
  numMin: INT.nullable().default(null),
  numMax: INT.nullable().default(null),
  description: z.string().trim().max(255).default(''),
})

const updateSchema = z.object({
  value: z.string().max(1000).nullish(), // rahasia: kosong/null = nilai lama dipertahankan
  clearSecret: z.boolean().optional(),
  description: z.string().trim().max(255),
  options: optionsSchema.nullable().optional(),
  numMin: INT.nullable().optional(),
  numMax: INT.nullable().optional(),
})

// nilai rahasia tidak pernah dikirim ke browser
parametersRouter.get('/', requirePermission('portal', 'read'), async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT id::text AS id, group_code AS "groupCode", param_key AS "key",
           CASE WHEN value_type = 'secret' THEN NULL ELSE value END AS value,
           (value <> '') AS "hasValue",
           value_type AS "valueType", options, num_min AS "numMin", num_max AS "numMax",
           description, is_system AS "isSystem", updated_at AS "updatedAt"
      FROM portal.parameters
     ORDER BY group_code, id
  `)
  res.json(rows)
})

parametersRouter.post('/', requirePermission('portal', 'create'), async (req, res) => {
  const p = createSchema.safeParse(req.body)
  if (!p.success) {
    badRequest(res, p.error)
    return
  }
  try {
    const d = p.data
    const value = d.valueType === 'secret' && d.value ? encryptSecret(d.value) : d.value
    const { rows } = await pool.query(
      `INSERT INTO portal.parameters
         (group_code, param_key, value, value_type, options, num_min, num_max, description, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id::text AS id`,
      [d.groupCode, d.key, value, d.valueType, d.options?.length ? d.options : null, d.numMin, d.numMax, d.description, req.user!.id],
    )
    res.status(201).json({ id: rows[0].id })
  } catch (e) {
    fail(res, e)
  }
})

parametersRouter.put('/:id', requirePermission('portal', 'update'), async (req, res) => {
  const p = updateSchema.safeParse(req.body)
  if (!p.success) {
    badRequest(res, p.error)
    return
  }
  try {
    const id = idParam(String(req.params.id))
    await withTx(async (c) => {
      const cur = await c.query(
        `SELECT is_system, value_type, value, options, num_min, num_max
           FROM portal.parameters WHERE id = $1 FOR UPDATE`,
        [id],
      )
      const row = cur.rows[0]
      if (!row) throw new HttpError(404, 'Parameter tidak ditemukan')
      const d = p.data

      let value: string = row.value
      if (row.value_type === 'secret') {
        if (d.clearSecret) value = ''
        else if (d.value) value = encryptSecret(d.value)
      } else if (typeof d.value === 'string') {
        value = d.value
      }

      // batas dan pilihan hanya bisa diubah pada parameter buatan sendiri
      const custom = !row.is_system
      const options = custom && d.options !== undefined ? (d.options?.length ? d.options : null) : row.options
      const numMin = custom && d.numMin !== undefined ? d.numMin : row.num_min
      const numMax = custom && d.numMax !== undefined ? d.numMax : row.num_max

      await c.query(
        `UPDATE portal.parameters
            SET value = $2, description = $3, options = $4, num_min = $5, num_max = $6, updated_by = $7
          WHERE id = $1`,
        [id, value, d.description, options, numMin, numMax, req.user!.id],
      )
    })
    res.json({ ok: true })
  } catch (e) {
    fail(res, e)
  }
})

parametersRouter.delete('/:id', requirePermission('portal', 'delete'), async (req, res) => {
  try {
    const id = idParam(String(req.params.id))
    const cur = await pool.query('SELECT is_system FROM portal.parameters WHERE id = $1', [id])
    if (!cur.rows[0]) throw new HttpError(404, 'Parameter tidak ditemukan')
    if (cur.rows[0].is_system) throw new HttpError(403, 'Parameter sistem tidak boleh dihapus')
    await pool.query('DELETE FROM portal.parameters WHERE id = $1', [id])
    res.json({ ok: true })
  } catch (e) {
    fail(res, e)
  }
})