import 'dotenv/config'
import { Pool } from 'pg'

// Schema database dibaca dari .env (DB_SCHEMA). Bawaan: portal.
// Nama divalidasi ketat karena dipakai pada search_path.
export const DB_SCHEMA = (process.env.DB_SCHEMA ?? 'portal').trim()
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(DB_SCHEMA)) {
  throw new Error(
    `DB_SCHEMA "${DB_SCHEMA}" tidak valid: gunakan huruf kecil, angka, _ (diawali huruf atau _), maksimal 63 karakter`,
  )
}

// Semua koneksi memakai search_path = DB_SCHEMA, jadi query cukup menulis nama tabel
// tanpa prefix schema (SELECT ... FROM users). Jika memakai PgBouncer mode transaction,
// isi ignore_startup_parameters = options, atau jalankan:
//   ALTER ROLE <user> SET search_path = <DB_SCHEMA>;
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  options: `-c search_path=${DB_SCHEMA}`,
})

pool.on('error', (err) => console.error('Error pada koneksi DB:', err.message))

// Dipanggil saat server start: gagal cepat dengan pesan jelas bila schema belum ada.
export async function assertSchema(): Promise<void> {
  const { rows } = await pool.query('SELECT 1 FROM information_schema.schemata WHERE schema_name = $1', [DB_SCHEMA])
  if (!rows[0]) {
    throw new Error(`Schema "${DB_SCHEMA}" tidak ditemukan di database. Jalankan "npm run db:install" atau periksa DB_SCHEMA di .env`)
  }
}
