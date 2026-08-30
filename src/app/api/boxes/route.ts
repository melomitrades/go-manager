let boxMigDone = false
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

// Gate ALL migration DDL (the 2 ALTERs + both CREATE TABLEs) behind the once-per-cold-start flag —
// previously only the 2 ALTERs were gated while the CREATE TABLE IF NOT EXISTS calls still ran on
// every request.
async function ensureTables() {
  if (boxMigDone) return
  boxMigDone = true
  await Promise.all([
    query('ALTER TABLE boxes ADD COLUMN IF NOT EXISTS ems_deadline TIMESTAMPTZ').catch(() => {}),
    query('ALTER TABLE boxes ADD COLUMN IF NOT EXISTS customs_deadline TIMESTAMPTZ').catch(() => {}),
    query(`CREATE TABLE IF NOT EXISTS box_orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      box_id UUID REFERENCES boxes(id) ON DELETE CASCADE,
      order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
      UNIQUE(box_id, order_id)
    )`).catch(() => {}),
    query(`CREATE TABLE IF NOT EXISTS box_item_types (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      box_id UUID REFERENCES boxes(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL,
      custom_label TEXT,
      weight_g NUMERIC(10,2) NOT NULL DEFAULT 0
    )`).catch(() => {}),
  ])
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTables()

  const boxes = await query(`SELECT * FROM boxes ORDER BY created_at DESC`)

  // Enrich each box with linked orders and item types. Each box's enrichment is independent of
  // every other box's, and within one box the two lookups don't depend on each other either —
  // so run all of it concurrently instead of one box (and one query) at a time.
  await Promise.all((boxes as any[]).map(async (box) => {
    const [linkedOrders, itemTypes] = await Promise.all([
      query(`
        SELECT bo.order_id, o.*, row_to_json(s) as shop, row_to_json(g) as "group"
        FROM box_orders bo
        JOIN orders o ON o.id = bo.order_id
        LEFT JOIN shops s ON s.id = o.shop_id
        LEFT JOIN groups g ON g.id = o.group_id
        WHERE bo.box_id = $1
      `, [box.id]).catch(() => [] as any[]),
      query('SELECT * FROM box_item_types WHERE box_id=$1 ORDER BY item_type', [box.id]).catch(() => [] as any[]),
    ])

    // Fall back to legacy single order_id if no box_orders rows exist
    if (linkedOrders.length === 0 && box.order_id) {
      const legacyOrder = await queryOne(`
        SELECT o.*, row_to_json(s) as shop, row_to_json(g) as "group"
        FROM orders o LEFT JOIN shops s ON s.id = o.shop_id LEFT JOIN groups g ON g.id = o.group_id
        WHERE o.id = $1
      `, [box.order_id]).catch(() => null)
      if (legacyOrder) linkedOrders.push(legacyOrder)
    }

    // preview_image_url is a multi-MB base64 blob carried on every order row via `o.*` above —
    // nothing on the Boxes page (GOM or joiner) reads it, so strip it before it goes over the wire.
    for (const o of linkedOrders) o.preview_image_url = null

    box.linked_orders = linkedOrders
    box.item_types = itemTypes
    box.total_weight_g = itemTypes.reduce((s: number, t: any) => s + parseFloat(t.weight_g || 0), 0)
  }))

  return NextResponse.json(boxes)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTables()

  const { label, order_ids, ems_total_eur, ems_total_krw, customs_total_eur, customs_total_krw, item_types, ems_deadline, customs_deadline } = await req.json()

  const box = await queryOne(
    `INSERT INTO boxes (label, ems_total_eur, ems_total_krw, customs_total_eur, customs_total_krw, ems_deadline, customs_deadline)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [label || null, ems_total_eur || 0, ems_total_krw || 0, customs_total_eur || 0, customs_total_krw || 0, ems_deadline || null, customs_deadline || null]
  ) as any

  // Link orders
  for (const oid of (order_ids || [])) {
    await query('INSERT INTO box_orders (box_id, order_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [box.id, oid])
  }

  // Save item types
  for (const it of (item_types || [])) {
    await query(
      'INSERT INTO box_item_types (box_id, item_type, custom_label, weight_g) VALUES ($1,$2,$3,$4)',
      [box.id, it.item_type, it.custom_label || null, it.weight_g || 0]
    )
  }

  return NextResponse.json(box, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTables()

  const { id, label, order_ids, ems_total_eur, ems_total_krw, customs_total_eur, customs_total_krw, item_types, ems_deadline, customs_deadline } = await req.json()

  const box = await queryOne(
    `UPDATE boxes SET label=$1, ems_total_eur=$2, ems_total_krw=$3, customs_total_eur=$4, customs_total_krw=$5, ems_deadline=$6, customs_deadline=$7, updated_at=now()
     WHERE id=$8 RETURNING *`,
    [label || null, ems_total_eur || 0, ems_total_krw || 0, customs_total_eur || 0, customs_total_krw || 0, ems_deadline || null, customs_deadline || null, id]
  )

  // Replace linked orders
  if (order_ids !== undefined) {
    await query('DELETE FROM box_orders WHERE box_id=$1', [id])
    for (const oid of order_ids) {
      await query('INSERT INTO box_orders (box_id, order_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, oid])
    }
  }

  // Replace item types
  if (item_types !== undefined) {
    await query('DELETE FROM box_item_types WHERE box_id=$1', [id])
    for (const it of item_types) {
      await query(
        'INSERT INTO box_item_types (box_id, item_type, custom_label, weight_g) VALUES ($1,$2,$3,$4)',
        [id, it.item_type, it.custom_label || null, it.weight_g || 0]
      )
    }
  }

  return NextResponse.json(box)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json()
  await query('DELETE FROM boxes WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
