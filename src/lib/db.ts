import { Pool } from 'pg'

declare global {
  var _pgPool: Pool | undefined
}

function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
  })
}

// Reuse pool in dev (hot reload safe)
const pool = global._pgPool ?? createPool()
if (process.env.NODE_ENV !== 'production') global._pgPool = pool

export default pool

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const { rows } = await pool.query(text, params)
  return rows as T[]
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const { rows } = await pool.query(text, params)
  return rows[0] as T ?? null
}
