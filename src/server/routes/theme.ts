import { Router, raw } from 'express'
import { z } from 'zod'
import { pool } from '../connector/db'
import { requirePermission } from '../middleware/permission'
import { badRequest, HttpError, sendError, withTx } from '../lib/helpers'
import { invalidateParams } from '../services/params'

import type {} from '../middleware/auth'

const MAX_SIZE: Record<string, number> = {
  logo: 512 * 1024,
  favicon: 256 * 1024,
  login_image: 2 * 1024 * 1024,
}
const IMG_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/x-icon']
const isAssetKey = (k: string) => Object.prototype.hasOwnProperty.call(MAX_SIZE, k)

// Cek isi file (magic bytes), bukan hanya header Content-Type
function sniffOk(b: Buffer, mime: string): boolean {
  switch (mime) {
    case 'image/png':    return b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    case 'image/jpeg':   return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
    case 'image/webp':   return b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'
    case 'image/x-icon': return b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0
    default: return false
  }
}

/* ===== PUBLIK (tanpa login), dipasang di /api/public/theme ===== */
export const publicThemeRouter = Router()

publicThemeRouter.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT param_key, value FROM parameters WHERE group_code = 'themes'`)
    res.set('Cache-Control', 'no-store')
    res.json(Object.fromEntries(rows.map((r) => [r.param_key, r.value])))
  } catch (e) {
    sendError(res, e)
  }
})

publicThemeRouter.get('/asset/:key', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT mime_type, data FROM theme_assets WHERE asset_key = $1',
      [String(req.params.key)])
    if (!rows[0]) {
      res.sendStatus(404)
      return
    }
    res.set({
      'Content-Type': rows[0].mime_type,
      'Cache-Control': 'public, max-age=31536000, immutable', // URL membawa ?v=timestamp
      'X-Content-Type-Options': 'nosniff',
    })
    res.send(rows[0].data)
  } catch (e) {
    sendError(res, e)
  }
})

/* ===== ADMIN (wajib login), dipasang di /api/theme ===== */
export const themeRouter = Router()

const HEX = /^#[0-9a-fA-F]{6}$/
const hex = z.string().regex(HEX)
const saveSchema = z.object({
  primary_color: hex,
  primary_text_color: hex,
  accent_color: hex,
  sidebar_color: z.union([hex, z.literal('')]), // kosong = ikut warna utama
  sidebar_text_color: hex,
  background_color: hex,
  surface_color: hex,
  text_color: hex,
  text_muted_color: hex,
  border_color: hex,
  login_bg_color: hex,
  success_color: hex,
  warning_color: hex,
  danger_color: hex,
  border_radius: z.number().int().min(0).max(24),
})

// PUT /api/theme : simpan semua nilai warna/bentuk sekaligus (satu transaksi)
themeRouter.put('/', requirePermission('portal', 'update'), async (req, res) => {
  const p = saveSchema.safeParse(req.body)
  if (!p.success) {
    badRequest(res, p.error)
    return
  }
  try {
    await withTx(async (c) => {
      for (const [k, v] of Object.entries(p.data)) {
        const r = await c.query(
          `UPDATE parameters SET value = $1, updated_by = $2
            WHERE group_code = 'themes' AND param_key = $3`,
          [String(v), req.user!.id, k])
        if (r.rowCount === 0) {
          throw new HttpError(500, `Parameter themes.${k} belum ada di database. Jalankan seed Themes terbaru.`)
        }
      }
    })
    invalidateParams()
    res.json({ ok: true })
  } catch (e) {
    sendError(res, e)
  }
})

// PUT /api/theme/asset/:key : body = isi file mentah, Content-Type = tipe gambar
themeRouter.put(
  '/asset/:key',
  requirePermission('portal', 'update'),
  raw({ type: IMG_TYPES, limit: '2mb' }),
  async (req, res) => {
    const key = String(req.params.key)
    if (!isAssetKey(key)) {
      res.status(400).json({ message: 'Jenis gambar tidak dikenal' })
      return
    }
    const buf = req.body as Buffer
    const mime = String(req.headers['content-type'] || '').split(';')[0]
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      res.status(400).json({ message: 'File tidak valid' })
      return
    }
    if (buf.length > MAX_SIZE[key]) {
      res.status(413).json({ message: `Maksimal ${MAX_SIZE[key] / 1024} KB` })
      return
    }
    if (!sniffOk(buf, mime)) {
      res.status(400).json({ message: 'Isi file tidak sesuai format gambar' })
      return
    }
    const url = `/api/public/theme/asset/${key}?v=${Date.now()}`
    try {
      await withTx(async (c) => {
        await c.query(
          `INSERT INTO theme_assets (asset_key, mime_type, data, updated_by)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (asset_key) DO UPDATE
             SET mime_type = EXCLUDED.mime_type, data = EXCLUDED.data,
                 updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [key, mime, buf, req.user!.id])
        await c.query(
          `UPDATE parameters SET value = $1, updated_by = $2
            WHERE group_code = 'themes' AND param_key = $3`,
          [url, req.user!.id, `${key}_url`])
      })
      invalidateParams()
      res.json({ url })
    } catch (e) {
      sendError(res, e)
    }
  })

// DELETE /api/theme/asset/:key : kembali ke gambar bawaan
themeRouter.delete('/asset/:key', requirePermission('portal', 'update'), async (req, res) => {
  const key = String(req.params.key)
  if (!isAssetKey(key)) {
    res.status(400).json({ message: 'Jenis gambar tidak dikenal' })
    return
  }
  try {
    await withTx(async (c) => {
      await c.query('DELETE FROM theme_assets WHERE asset_key = $1', [key])
      await c.query(
        `UPDATE parameters SET value = '', updated_by = $1
          WHERE group_code = 'themes' AND param_key = $2`,
        [req.user!.id, `${key}_url`])
    })
    invalidateParams()
    res.json({ ok: true })
  } catch (e) {
    sendError(res, e)
  }
})