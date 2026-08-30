import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

let migDone = false
async function ensureTable() {
  if (migDone) return
  migDone = true
  await query(`CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`).catch(() => {})
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTable()
  const key = new URL(req.url).searchParams.get('key')
  const row = await queryOne('SELECT value FROM app_settings WHERE key=$1', [key]).catch(() => null)
  return NextResponse.json({ value: row?.value ?? null })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTable()
  const { key, value } = await req.json()
  await query(`INSERT INTO app_settings (key, value) VALUES ($1,$2)
    ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()`, [key, value])
  return NextResponse.json({ ok: true })
}
