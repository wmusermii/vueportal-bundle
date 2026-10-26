import { Pool } from 'pg'

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
})

pool.on('error', (err) => console.error('Error pada koneksi DB:', err.message))