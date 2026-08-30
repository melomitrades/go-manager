import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

// Schema migrations only need to run once per cold start — previously these 6 ALTERs plus the
// order_joiner_paid CREATE TABLE ran unconditionally on every single order view, which is by far
// the most frequently hit endpoint in the app (every OrderDetail open, every edit-form open).
let migDone = false
async function ensureOrderDetailSchema() {
  if (migDone) return
  migDone = true
  await Promise.all([
    query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS inclusions_count INTEGER DEFAULT 0').catch(() => {}),
    query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS entries_count INTEGER DEFAULT 0').catch(() => {}),
    query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_multi_version BOOLEAN DEFAULT false').catch(() => {}),
    query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS version_names JSONB DEFAULT NULL').catch(() => {}),
    query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS version_options JSONB DEFAULT NULL').catch(() => {}),
    query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS price_krw NUMERIC(12,0)').catch(() => {}),
    query(`
      CREATE TABLE IF NOT EXISTS order_joiner_paid (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
        joiner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
        paid BOOLEAN DEFAULT false,
        paid_at TIMESTAMPTZ,
        UNIQUE(order_id, joiner_id)
      )
    `).catch(() => {}),
  ])
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any

  await ensureOrderDetailSchema()

  const isGom = ['gom', 'admin'].includes(user.role) && new URL(req.url).searchParams.get('viewAs') !== 'joiner'

  // order, items, and paidRows are all independent reads keyed only on params.id (and isGom/user.id,
  // which are already known before any query runs) — no need to wait on one before starting the
  // next, so fetch them concurrently instead of as three sequential round trips.
  const [order, items, paidRows] = await Promise.all([
    queryOne(`
      SELECT o.*, row_to_json(s) as shop,
        json_build_object(
          'id', g.id, 'name', g.name,
          'members', (SELECT json_agg(m ORDER BY m.sort_order NULLS LAST, m.name) FROM members m WHERE m.group_id = g.id)
        ) as "group",
        f.raffle_winner_id,
        w.display_name as raffle_winner_name
      FROM orders o
      LEFT JOIN shops s ON s.id = o.shop_id
      LEFT JOIN groups g ON g.id = o.group_id
      LEFT JOIN fancalls f ON f.order_id = o.id
      LEFT JOIN profiles w ON w.id = f.raffle_winner_id
      WHERE o.id = $1
    `, [params.id]),
    // GOM: fetch ALL items. Joiner (or admin in joiner view): fetch ONLY their items.
    // Parameterized instead of interpolating user.id directly into the SQL string.
    query(`
      SELECT oi.*,
        row_to_json(p) as joiner,
        row_to_json(m) as member
      FROM order_items oi
      LEFT JOIN profiles p ON p.id = oi.joiner_id
      LEFT JOIN members m ON m.id = oi.member_id
      WHERE oi.order_id = $1
      ${isGom ? '' : 'AND oi.joiner_id = $2'}
      ORDER BY p.display_name NULLS LAST, m.sort_order NULLS LAST, m.name
    `, isGom ? [params.id] : [params.id, user.id]),
    query('SELECT joiner_id, paid, paid_at FROM order_joiner_paid WHERE order_id=$1', [params.id]).catch(() => [] as any[]),
  ])

  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const paidMap: Record<string, any> = {}
  paidRows.forEach((p: any) => { paidMap[p.joiner_id] = p })

  // Group by joiner
  const byJoiner: Record<string, any> = {}
  for (const item of items) {
    const key = item.joiner_id || '__none__'
    if (!byJoiner[key]) {
      byJoiner[key] = {
        joiner_id: item.joiner_id,
        joiner: item.joiner,
        items: [],
        paid: paidMap[item.joiner_id]?.paid || false,
        paid_at: paidMap[item.joiner_id]?.paid_at || null,
      }
    }
    byJoiner[key].items.push(item)
  }

  const joiners = Object.values(byJoiner)
  const totalItems = items.reduce((s: number, i: any) => s + (i.amount_claimed || 1), 0)
  const totalPrice = items.reduce((s: number, i: any) => s + (parseFloat(i.price_eur) || 0) * (i.amount_claimed || 1), 0)
  const totalKrw = items.reduce((s: number, i: any) => s + (parseFloat(i.price_krw) || 0) * (i.amount_claimed || 1), 0)

  return NextResponse.json({ order, joiners, totalItems, totalPrice, totalKrw })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { joiner_id, paid } = await req.json()
  await ensureOrderDetailSchema()
  await query(`
    INSERT INTO order_joiner_paid (order_id, joiner_id, paid, paid_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (order_id, joiner_id) DO UPDATE SET paid=$3, paid_at=$4
  `, [params.id, joiner_id, paid, paid ? new Date().toISOString() : null])
  return NextResponse.json({ ok: true })
}
// Leftover calculation is done client-side in OrderDetail component
