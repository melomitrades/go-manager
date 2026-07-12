import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query } from '@/lib/db'

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
      read BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `).catch(() => {})
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  await ensureTable()
  const rows = await query(
    `SELECT n.id, n.message, n.order_id, n.created_at
     FROM notifications n
     WHERE n.user_id = $1 AND n.read = false
     ORDER BY n.created_at DESC LIMIT 50`,
    [user.id]
  )
  return NextResponse.json(Array.isArray(rows) ? rows : [])
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  await ensureTable()
  const { id, read_all } = await req.json()
  if (read_all) {
    await query('UPDATE notifications SET read=true WHERE user_id=$1', [user.id])
  } else if (id) {
    await query('UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2', [id, user.id])
  }
  return NextResponse.json({ ok: true })
}
