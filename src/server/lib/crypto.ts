import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { HttpError } from './helpers'

function key(): Buffer {
  const hex = process.env.PARAM_ENC_KEY
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new HttpError(500, 'PARAM_ENC_KEY belum diisi (64 karakter hex) di .env server')
  }
  return Buffer.from(hex, 'hex')
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

// dipakai nanti oleh layanan email
export function decryptSecret(stored: string): string {
  if (!stored) return ''
  const [v, iv, tag, data] = stored.split(':')
  if (v !== 'v1') throw new Error('Format rahasia tidak dikenal')
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8')
}