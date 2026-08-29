import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

let migrationsDone = false
async function ensureColumns() {
  if (migrationsDone) return
  migrationsDone = true
  await query(`ALTER TABLE sending_out ADD COLUMN IF NOT EXISTS shipping_type TEXT`).catch(() => {})
  await query(`ALTER TABLE sending_out ADD COLUMN IF NOT EXISTS email TEXT`).catch(() => {})
  await query(`ALTER TABLE sending_out ADD COLUMN IF NOT EXISTS phone TEXT`).catch(() => {})
  await query(`ALTER TABLE sending_out ADD COLUMN IF NOT EXISTS joiner_submitted BOOLEAN DEFAULT false`).catch(() => {})
  // Fix stale to_pack statuses
  await query(`UPDATE sending_out SET status='unpacked' WHERE status::text='to_pack'`).catch(() => {})
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  await ensureColumns()

  const joinerId = new URL(req.url).searchParams.get('joiner_id')

  // Special: get at_gom order items for a specific joiner (GOM viewing package detail)
  if (joinerId) {
    const items = await query(`
      SELECT oi.*, m.name as member_name, o.id as order_id,
        s.name as shop_name, g.name as group_name, o.round_number
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN shops s ON s.id = o.shop_id
      LEFT JOIN groups g ON g.id = o.group_id
      LEFT JOIN members m ON m.id = oi.member_id
      WHERE oi.joiner_id = $1 AND o.status = 'at_gom'
      ORDER BY o.created_at DESC, oi.created_at
    `, [joinerId])
    return NextResponse.json(items)
  }

  let sql = `
    SELECT so.*,
      row_to_json(o) as "order",
      row_to_json(p) as joiner
    FROM sending_out so
    LEFT JOIN orders o ON o.id = so.order_id
    LEFT JOIN profiles p ON p.id = so.joiner_id
    WHERE 1=1
  `
  // Same convention as pc-sorter/orders: the joiner-facing Shipping page always sends
  // ?viewAs=joiner, for every account, so a gom/admin viewing their own Shipping page sees only
  // their own submission — not everyone's — same as a real joiner always does regardless of
  // this param.
  const viewAsJoiner = new URL(req.url).searchParams.get('viewAs') === 'joiner'
  const params: any[] = []
  if (user.role === 'joiner' || (['gom', 'admin'].includes(user.role) && viewAsJoiner)) { sql += ` AND so.joiner_id = $1`; params.push(user.id) }
  sql += ' ORDER BY so.joiner_submitted DESC, so.created_at DESC'
  return NextResponse.json(await query(sql, params))
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  await ensureColumns()

  const body = await req.json()
  const { order_id, joiner_id, address, status, weight_g, shipping_deadline, notes, shipping_type, email, phone, joiner_submitted } = body

  const effectiveJoinerId = user.role === 'joiner' ? user.id : (joiner_id || null)
  const dbStatus = 'unpacked'

  const row = await queryOne(`
    INSERT INTO sending_out (order_id, joiner_id, address, status, weight_g, shipping_deadline, notes, shipping_type, email, phone, joiner_submitted)
    VALUES ($1,$2,$3,$4::shipping_status,$5,$6,$7,$8,$9,$10,$11) RETURNING *
  `, [order_id || null, effectiveJoinerId, address || null, dbStatus,
      weight_g || null, shipping_deadline || null, notes || null,
      shipping_type || null, email || null, phone || null, joiner_submitted ?? false])

  return NextResponse.json(row, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureColumns()

  const body = await req.json()
  const { id, status, joiner_id, address, weight_g, shipping_deadline, notes, shipping_type, email, phone } = body

  const row = await queryOne(`
    UPDATE sending_out SET
      status=COALESCE($1::shipping_status, status), joiner_id=$2, address=$3,
      weight_g=$4, shipping_deadline=$5, notes=$6,
      shipping_type=$7, email=$8, phone=$9, updated_at=now()
    WHERE id=$10 RETURNING *
  `, [status || null, joiner_id || null, address || null,
      weight_g || null, shipping_deadline || null, notes || null,
      shipping_type || null, email || null, phone || null, id])

  return NextResponse.json(row)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json()
  await query('DELETE FROM sending_out WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
