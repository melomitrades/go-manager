let payMigDone = false
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

async function ensurePaymentColumns() {
  if (!payMigDone) { payMigDone = true; await Promise.all([query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS proof_url TEXT').catch(()=>{}), query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS joiner_submitted BOOLEAN DEFAULT false').catch(()=>{})]) }
}

export async function GET() {
  await ensurePaymentColumns()
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const payments = await query(`
    SELECT p.*, row_to_json(s) as shop,
      (SELECT row_to_json(cl) FROM covering_log cl WHERE cl.payment_id = p.id LIMIT 1) as covering_log
    FROM payments p LEFT JOIN shops s ON s.id = p.shop_id
    ORDER BY p.created_at DESC
  `)
  return NextResponse.json(payments)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom','admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { recipient_type, amount_eur, amount_krw, shop_id, order_id, payment_method, deadline, notes } = await req.json()
  const p = await queryOne(
    `INSERT INTO payments (recipient_type, amount_eur, amount_krw, shop_id, order_id, payment_method, deadline, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [recipient_type, amount_eur, amount_krw||null, shop_id||null, order_id||null, payment_method||null, deadline||null, notes||null, user.id]
  )
  return NextResponse.json(p, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, recipient_type, amount_eur, amount_krw, shop_id, order_id, payment_method, deadline, notes, proof_url, joiner_submitted } = await req.json()
  // Joiner submitting proof only
  if (proof_url !== undefined && !recipient_type) {
    const p = await queryOne('UPDATE payments SET proof_url=$1, joiner_submitted=$2 WHERE id=$3 RETURNING *', [proof_url, joiner_submitted ?? true, id])
    return NextResponse.json(p)
  }
  const p = await queryOne(
    `UPDATE payments SET recipient_type=$1, amount_eur=$2, amount_krw=$3, shop_id=$4, order_id=$5, payment_method=$6, deadline=$7, notes=$8, proof_url=COALESCE($9,proof_url)
     WHERE id=$10 RETURNING *`,
    [recipient_type, amount_eur, amount_krw||null, shop_id||null, order_id||null, payment_method||null, deadline||null, notes||null, proof_url||null, id]
  )
  return NextResponse.json(p)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json()
  await query('DELETE FROM payments WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
