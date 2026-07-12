let jpMigDone = false
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

async function ensureTables() {
  await query(`CREATE TABLE IF NOT EXISTS order_joiner_paid (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    joiner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    paid BOOLEAN DEFAULT false,
    paid_at TIMESTAMPTZ,
    proof_url TEXT,
    UNIQUE(order_id, joiner_id)
  )`).catch(() => {})
  if (!jpMigDone) { jpMigDone = true; await Promise.all([query('ALTER TABLE order_joiner_paid ADD COLUMN IF NOT EXISTS proof_url TEXT').catch(()=>{}), query('ALTER TABLE order_joiner_paid ADD COLUMN IF NOT EXISTS full_name TEXT').catch(()=>{})]) }
  await query(`CREATE TABLE IF NOT EXISTS box_joiner_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    box_id UUID REFERENCES boxes(id) ON DELETE CASCADE,
    joiner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    ems_paid BOOLEAN DEFAULT false,
    customs_paid BOOLEAN DEFAULT false,
    UNIQUE(box_id, joiner_id)
  )`).catch(() => {})
  await query(`CREATE TABLE IF NOT EXISTS box_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    box_id UUID REFERENCES boxes(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    UNIQUE(box_id, order_id)
  )`).catch(() => {})
  await query(`CREATE TABLE IF NOT EXISTS box_item_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    box_id UUID REFERENCES boxes(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    custom_label TEXT,
    weight_g NUMERIC(10,2) NOT NULL DEFAULT 0
  )`).catch(() => {})
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const userId = user.id
  const fetchAll = new URL(req.url).searchParams.get('all') === 'true' && ['gom','admin'].includes(user.role)
  await ensureTables()

  // GOM fetching all joiner items with proofs
  if (fetchAll) {
    // Get all joiner payment rows that have a proof submitted
    const rows = await query(`
      SELECT
        ojp.id,
        ojp.order_id,
        ojp.joiner_id,
        ojp.paid,
        ojp.paid_at,
        ojp.proof_submitted,
        ojp.full_name,
        p.display_name as joiner_name,
        p.username as joiner_username,
        concat(
          COALESCE(s.name, '?'),
          CASE WHEN g.name IS NOT NULL THEN concat(' · ', g.name) ELSE '' END,
          CASE WHEN o.round_number IS NOT NULL THEN concat(' · ', o.round_number) ELSE '' END
        ) as label,
        COALESCE(agg.amount_eur, 0) as amount_eur,
        o.deadline,
        'order' as type,
        NULL::uuid as box_id
      FROM order_joiner_paid ojp
      JOIN orders o ON o.id = ojp.order_id
      LEFT JOIN shops s ON s.id = o.shop_id
      LEFT JOIN groups g ON g.id = o.group_id
      LEFT JOIN profiles p ON p.id = ojp.joiner_id
      LEFT JOIN (
        SELECT order_id, joiner_id, SUM(price_eur * amount_claimed) as amount_eur
        FROM order_items GROUP BY order_id, joiner_id
      ) agg ON agg.order_id = ojp.order_id AND agg.joiner_id = ojp.joiner_id
      WHERE ojp.proof_submitted = true
      ORDER BY ojp.paid ASC NULLS FIRST
    `).catch(() => [] as any[])

    const [emsRows, customsRows] = await Promise.all([
      query(`
        SELECT bjs.id, bjs.joiner_id, bjs.ems_paid as paid, bjs.proof_submitted,
          NULL as full_name, p.display_name as joiner_name, p.username as joiner_username,
          concat(b.label, ' — EMS') as label, bjs.ems_amount_eur as amount_eur,
          NULL as deadline, 'ems' as type, b.id as box_id
        FROM box_joiner_shares bjs
        JOIN boxes b ON b.id = bjs.box_id
        JOIN profiles p ON p.id = bjs.joiner_id
        WHERE bjs.proof_submitted = true
      `).catch(() => [] as any[]),
      query(`
        SELECT bjs.id, bjs.joiner_id, bjs.customs_paid as paid, bjs.customs_proof_submitted as proof_submitted,
          NULL as full_name, p.display_name as joiner_name, p.username as joiner_username,
          concat(b.label, ' — Customs') as label, bjs.customs_amount_eur as amount_eur,
          NULL as deadline, 'customs' as type, b.id as box_id
        FROM box_joiner_shares bjs
        JOIN boxes b ON b.id = bjs.box_id
        JOIN profiles p ON p.id = bjs.joiner_id
        WHERE bjs.customs_proof_submitted = true
      `).catch(() => [] as any[]),
    ])

    const all = [
      ...(rows as any[]).map(r => ({ ...r, amount_eur: parseFloat(r.amount_eur) || 0 })),
      ...(emsRows as any[]).map(r => ({ ...r, amount_eur: parseFloat(r.amount_eur) || 0 })),
      ...(customsRows as any[]).map(r => ({ ...r, amount_eur: parseFloat(r.amount_eur) || 0 })),
    ].sort((a, b) => (a.paid === b.paid ? 0 : a.paid ? 1 : -1))
    return NextResponse.json(all)
  }

  const items: any[] = []

  // 1. Order items — group by order, show total owed
  try {
    const rows = await query(`
      SELECT
        o.id as order_id,
        o.status as order_status,
        o.deadline,
        o.payment_info,
        s.name as shop_name,
        g.name as group_name,
        o.round_number,
        COALESCE(SUM(oi.price_eur * oi.amount_claimed), 0) as amount_eur,
        ojp.paid,
        ojp.paid_at,
        ojp.proof_url,
        ojp.proof_submitted
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN shops s ON s.id = o.shop_id
      LEFT JOIN groups g ON g.id = o.group_id
      LEFT JOIN order_joiner_paid ojp ON ojp.order_id = o.id AND ojp.joiner_id = $1
      WHERE oi.joiner_id = $1 AND oi.price_eur IS NOT NULL AND oi.price_eur > 0
      GROUP BY o.id, s.name, g.name, o.round_number, o.status, o.deadline, o.payment_info, ojp.paid, ojp.paid_at, ojp.proof_url, ojp.proof_submitted
      ORDER BY o.created_at DESC
    `, [userId])

    for (const row of rows as any[]) {
      const amt = parseFloat(row.amount_eur) || 0
      if (amt <= 0) continue
      items.push({
        id: `order-${row.order_id}`,
        type: 'order',
        label: [row.shop_name, row.group_name, row.round_number ? `Round ${row.round_number}` : null].filter(Boolean).join(' · '),
        amount_eur: amt,
        deadline: row.deadline,
        payment_info: row.payment_info || null,
        paid: row.paid || false,
        paid_at: row.paid_at,
        proof_url: row.proof_url || null,
        proof_submitted: row.proof_submitted || false,
        order_id: row.order_id,
      })
    }
  } catch (e) { console.error('order items error', e) }

  // 2. EMS and Customs shares from boxes
  try {
    const boxes = await query('SELECT * FROM boxes ORDER BY created_at DESC') as any[]

    for (const box of boxes) {
      if (!box.ems_payment_requested && !box.customs_payment_requested) continue

      const allItems = await query(`
        SELECT oi.joiner_id, COALESCE(oi.item_type, 'photocard') as item_type, oi.amount_claimed
        FROM order_items oi
        JOIN box_orders bo ON bo.order_id = oi.order_id
        WHERE bo.box_id = $1 AND oi.joiner_id IS NOT NULL
      `, [box.id]).catch(() => [] as any[]) as any[]

      if (!allItems.some((r: any) => r.joiner_id === userId)) continue

      const itemTypes = await query('SELECT item_type, custom_label, weight_g FROM box_item_types WHERE box_id=$1', [box.id]).catch(() => [] as any[]) as any[]
      const weightByType: Record<string, number> = {}
      for (const it of itemTypes) {
        const key = it.item_type === 'custom' ? (it.custom_label || 'custom') : it.item_type
        weightByType[key] = parseFloat(it.weight_g) || 0
      }

      let myWeight = 0, totalWeight = 0
      for (const item of allItems) {
        const w = (weightByType[item.item_type] || 0) * (item.amount_claimed || 1)
        totalWeight += w
        if (item.joiner_id === userId) myWeight += w
      }

      const uniqueJoiners = new Set(allItems.map((r: any) => r.joiner_id)).size
      const fraction = totalWeight > 0 ? (myWeight / totalWeight) : (uniqueJoiners > 0 ? 1 / uniqueJoiners : 0)
      if (fraction === 0) continue

      const share = await queryOne(
        'SELECT ems_paid, customs_paid, ems_amount_eur, customs_amount_eur, proof_url, proof_submitted, customs_proof_url, customs_proof_submitted FROM box_joiner_shares WHERE box_id=$1 AND joiner_id=$2',
        [box.id, userId]
      ).catch(() => null) as any

      const boxLabel = box.label || 'Box'
      const ceil2 = (n: number) => Math.ceil(n * 100) / 100

      // Use the saved published amount only — this is locked when GOM clicks "Ask EMS/Customs"
      // Never recompute from weights here (that causes amount drift when orders change)
      if (box.ems_payment_requested && share?.ems_amount_eur != null) {
        const emsAmt = parseFloat(share.ems_amount_eur)
        if (emsAmt > 0.01) items.push({ id: `ems-${box.id}`, type: 'ems', label: `${boxLabel} — EMS`, amount_eur: emsAmt, deadline: box.ems_deadline, payment_info: box.payment_info || null, paid: share?.ems_paid || false, proof_url: share?.proof_url || null, proof_submitted: share?.proof_submitted || false, box_id: box.id })
      }

      if (box.customs_payment_requested && share?.customs_amount_eur != null) {
        const customsAmt = parseFloat(share.customs_amount_eur)
        if (customsAmt > 0.01) items.push({ id: `customs-${box.id}`, type: 'customs', label: `${boxLabel} — Customs`, amount_eur: customsAmt, deadline: box.customs_deadline, payment_info: box.payment_info || null, paid: share?.customs_paid || false, proof_url: share?.customs_proof_url || null, proof_submitted: share?.customs_proof_submitted || false, box_id: box.id })
      }
    }
  } catch (e) { console.error('box shares error', e) }

  return NextResponse.json(items)
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const userId = user.id
  await ensureTables()

  const { type, order_id, box_id, paid, proof_url, full_name, validated_by_gom, joiner_id: targetJoinerId } = await req.json()

  if (type === 'order' && order_id) {
    if (validated_by_gom && ['gom', 'admin'].includes(user.role)) {
      // GOM validating a specific joiner's payment
      if (targetJoinerId) {
        await query(`UPDATE order_joiner_paid SET paid=true, paid_at=now() WHERE order_id=$1 AND joiner_id=$2`, [order_id, targetJoinerId])
      } else {
        await query(`UPDATE order_joiner_paid SET paid=true, paid_at=now() WHERE order_id=$1`, [order_id])
      }
    } else {
      // Joiner submitting proof — upsert then explicitly update proof_url + full_name
      await query(`
        INSERT INTO order_joiner_paid (order_id, joiner_id, paid, paid_at, proof_url, full_name)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (order_id, joiner_id) DO UPDATE
          SET paid = EXCLUDED.paid,
              paid_at = EXCLUDED.paid_at,
              proof_url = CASE WHEN EXCLUDED.proof_url IS NOT NULL THEN EXCLUDED.proof_url ELSE order_joiner_paid.proof_url END,
              full_name = CASE WHEN EXCLUDED.full_name IS NOT NULL THEN EXCLUDED.full_name ELSE order_joiner_paid.full_name END
      `, [order_id, userId, paid ?? false, paid ? new Date().toISOString() : null, proof_url ?? null, full_name ?? null])
    }
  } else if (type === 'ems' && box_id) {
    if (proof_url) {
      // Joiner submitting EMS proof
      await query(`
        INSERT INTO box_joiner_shares (box_id, joiner_id, proof_url, proof_submitted, proof_submitted_at)
        VALUES ($1, $2, $3, true, now())
        ON CONFLICT (box_id, joiner_id) DO UPDATE
          SET proof_url = EXCLUDED.proof_url,
              proof_submitted = true,
              proof_submitted_at = now()
      `, [box_id, userId, proof_url])
    } else {
      const targetId = (validated_by_gom && targetJoinerId) ? targetJoinerId : userId
      await query(`
        INSERT INTO box_joiner_shares (box_id, joiner_id, ems_paid)
        VALUES ($1, $2, $3)
        ON CONFLICT (box_id, joiner_id) DO UPDATE SET ems_paid=$3
      `, [box_id, targetId, paid])
    }
  } else if (type === 'customs' && box_id) {
    if (proof_url) {
      // Joiner submitting customs proof
      await query(`
        INSERT INTO box_joiner_shares (box_id, joiner_id, customs_proof_url, customs_proof_submitted, customs_proof_submitted_at)
        VALUES ($1, $2, $3, true, now())
        ON CONFLICT (box_id, joiner_id) DO UPDATE
          SET customs_proof_url = EXCLUDED.customs_proof_url,
              customs_proof_submitted = true,
              customs_proof_submitted_at = now()
      `, [box_id, userId, proof_url])
    } else {
      const targetId = (validated_by_gom && targetJoinerId) ? targetJoinerId : userId
      await query(`
        INSERT INTO box_joiner_shares (box_id, joiner_id, customs_paid)
        VALUES ($1, $2, $3)
        ON CONFLICT (box_id, joiner_id) DO UPDATE SET customs_paid=$3
      `, [box_id, targetId, paid])
    }
  }

  return NextResponse.json({ ok: true })
}
