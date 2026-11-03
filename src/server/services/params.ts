import { pool } from '../connector/db'

let cache: Map<string, string> | null = null
let loadedAt = 0
const TTL_MS = 30_000

async function all(): Promise<Map<string, string>> {
  if (cache && Date.now() - loadedAt < TTL_MS) return cache
  const { rows } = await pool.query('SELECT group_code, param_key, value FROM parameters')
  cache = new Map(rows.map((r) => [`${r.group_code}.${r.param_key}`, r.value as string]))
  loadedAt = Date.now()
  return cache
}

// dipanggil setelah parameter diubah supaya nilai baru langsung berlaku
export function invalidateParams() {
  cache = null
}

// catatan: parameter bertipe rahasia dikembalikan apa adanya (terenkripsi); pakai decryptSecret
export async function getString(group: string, key: string, fallback = ''): Promise<string> {
  const v = (await all()).get(`${group}.${key}`)
  return v === undefined ? fallback : v
}

export async function getNumber(group: string, key: string, fallback: number): Promise<number> {
  const n = Number(await getString(group, key, String(fallback)))
  return Number.isFinite(n) ? n : fallback
}

export async function getBool(group: string, key: string, fallback: boolean): Promise<boolean> {
  return (await getString(group, key, String(fallback))) === 'true'
}