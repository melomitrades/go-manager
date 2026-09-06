import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { ensureShipmentsSchema, SHIPMENT_STATUSES } from '@/lib/shipments'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  await ensureShipmentsSchema()

  const { searchParams } = new URL(req.url)
  const viewAsJoiner = searchParams.get('viewAs') === 'joiner'
  const asJoiner = user.role === 'joiner' || (['gom', 'admin'].includes(user.role) && viewAsJoiner)
  const status = searchParams.get('status')
  const shippingType = searchParams.get('shipping_type')
  const formId = searchParams.get('form_id')

  let sql = `
    SELECT sh.*, row_to_json(p) as joiner, f.title as form_title
    FROM shipments sh
    LEFT JOIN profiles p ON p.id = sh.joiner_id
    LEFT JOIN shipping_forms f ON f.id = sh.form_id
    WHERE 1=1
  `
  const params: any[] = []
  let i = 1
  if (asJoiner) { sql += ` AND sh.joiner_id = $${i++}`; params.push(user.id) }
  if (status) { sql += ` AND sh.status = $${i++}`; params.push(status) }
  if (shippingType) { sql += ` AND sh.shipping_type = $${i++}`; params.push(shippingType) }
  if (formId) { sql += ` AND sh.form_id = $${i++}`; params.push(formId) }
  sql += ' ORDER BY sh.created_at DESC'

  return NextResponse.json(await query(sql, params))
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  await ensureShipmentsSchema()

  const body = await req.json()
  const { form_id, full_name, email, phone, address, shipping_type, notes } = body
  if (!form_id) return NextResponse.json({ error: 'form_id required' }, { status: 400 })

  // A joiner (including gom/admin previewing their own Shipping page) can only ever submit for
  // themselves. Only an explicit GOM/admin manual entry may target a different joiner.
  let joinerId = user.id
  if (body.manual && body.joiner_id && ['gom', 'admin'].includes(user.role)) joinerId = body.joiner_id

  const row = await queryOne<any>(`
    INSERT INTO shipments (form_id, joiner_id, full_name, email, phone, address, shipping_type, notes, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
    ON CONFLICT (form_id, joiner_id) DO UPDATE SET
      full_name = EXCLUDED.full_name, email = EXCLUDED.email, phone = EXCLUDED.phone,
      address = EXCLUDED.address, shipping_type = EXCLUDED.shipping_type, notes = EXCLUDED.notes,
      updated_at = now()
    RETURNING *
  `, [form_id, joinerId, full_name || null, email || null, phone || null, address || null, shipping_type || null, notes || null])

  return NextResponse.json(row, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  await ensureShipmentsSchema()

  const body = await req.json()
  const { id } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const existing = await queryOne<any>('SELECT * FROM shipments WHERE id=$1', [id])
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isGom = ['gom', 'admin'].includes(user.role)
  const isOwner = existing.joiner_id === user.id

  // A joiner may only ever self-confirm receipt on their own shipment. Everything else
  // (status changes, packing, payment requests, edits) is GOM/admin-only.
  if (body.mark_complete) {
    if (!isOwner && !isGom) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (existing.status !== 'shipped') return NextResponse.json({ error: 'Can only confirm receipt once shipped' }, { status: 400 })
    const row = await queryOne('UPDATE shipments SET status=$1, completed_at=now(), updated_at=now() WHERE id=$2 RETURNING *', ['complete', id])
    return NextResponse.json(row)
  }

  if (!isGom) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sets: string[] = []
  const params: any[] = []
  let i = 1
  const set = (col: string, val: any) => { sets.push(`${col} = $${i++}`); params.push(val) }

  for (const field of ['full_name', 'email', 'phone', 'address', 'shipping_type', 'notes', 'tracking_code'] as const) {
    if (body[field] !== undefined) set(field, body[field] || null)
  }

  // Requesting payment: sets/refreshes the amount and resets any stale proof/paid state from a
  // previous payment cycle so the joiner-payments feed reflects the new request cleanly.
  if (body.request_payment) {
    set('price_eur', body.price_eur != null && body.price_eur !== '' ? body.price_eur : null)
    set('payment_info', body.payment_info || null)
    set('paid', false)
    set('paid_at', null)
    set('proof_url', null)
    set('proof_submitted', false)
    set('payment_requested_at', new Date())
    set('status', 'payment_requested')
  } else if (body.status) {
    if (!SHIPMENT_STATUSES.includes(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    set('status', body.status)
    if (body.status === 'packed') set('packed_at', new Date())
    if (body.status === 'shipped') set('shipped_at', new Date())
    if (body.status === 'complete') set('completed_at', new Date())
    if (body.status === 'payment_complete') { set('paid', true); set('paid_at', new Date()) }
  }

  if (sets.length === 0) return NextResponse.json(existing)

  set('updated_at', new Date())
  params.push(id)
  const row = await queryOne(`UPDATE shipments SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params)
  return NextResponse.json(row)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await req.json()
  await query('DELETE FROM shipments WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
