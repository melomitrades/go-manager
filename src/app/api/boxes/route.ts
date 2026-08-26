import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

let migDone = false
async function ensureTables() {
  if (migDone) return
  migDone = true
  await Promise.all([
    query(`CREATE TABLE IF NOT EXISTS box_joiner_shares (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      box_id UUID REFERENCES boxes(id) ON DELETE CASCADE,
      joiner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
      ems_paid BOOLEAN DEFAULT false,
      customs_paid BOOLEAN DEFAULT false,
      UNIQUE(box_id, joiner_id)
    )`).catch(() => {}),
    query(`CREATE TABLE IF NOT EXISTS box_orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      box_id UUID REFERENCES boxes(id) ON DELETE CASCADE,
      order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
      UNIQUE(box_id, order_id)
    )`).catch(() => {}),
    query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS item_type TEXT DEFAULT 'photocard'`).catch(() => {}),
    query(`ALTER TABLE box_joiner_shares ADD COLUMN IF NOT EXISTS excluded BOOLEAN DEFAULT false`).catch(() => {}),
    query(`ALTER TABLE box_joiner_shares ADD COLUMN IF NOT EXISTS ems_amount_eur NUMERIC(10,2)`).catch(() => {}),
    query(`ALTER TABLE box_joiner_shares ADD COLUMN IF NOT EXISTS customs_amount_eur NUMERIC(10,2)`).catch(() => {}),
    query(`ALTER TABLE box_joiner_shares ADD COLUMN IF NOT EXISTS proof_url TEXT`).catch(() => {}),
    query(`ALTER TABLE box_joiner_shares ADD COLUMN IF NOT EXISTS proof_submitted BOOLEAN DEFAULT false`).catch(() => {}),
    query(`ALTER TABLE box_joiner_shares ADD COLUMN IF NOT EXISTS proof_submitted_at TIMESTAMPTZ`).catch(() => {}),
    query(`ALTER TABLE box_joiner_shares ADD COLUMN IF NOT EXISTS customs_proof_url TEXT`).catch(() => {}),
    query(`ALTER TABLE box_joiner_shares ADD COLUMN IF NOT EXISTS customs_proof_submitted BOOLEAN DEFAULT false`).catch(() => {}),
    query(`ALTER TABLE box_joiner_shares ADD COLUMN IF NOT EXISTS customs_proof_submitted_at TIMESTAMPTZ`).catch(() => {}),
    query(`ALTER TABLE boxes ADD COLUMN IF NOT EXISTS payment_requested BOOLEAN DEFAULT false`).catch(() => {}),
    query(`ALTER TABLE boxes ADD COLUMN IF NOT EXISTS ems_payment_requested BOOLEAN DEFAULT false`).catch(() => {}),
    query(`ALTER TABLE boxes ADD COLUMN IF NOT EXISTS customs_payment_requested BOOLEAN DEFAULT false`).catch(() => {}),
    query(`ALTER TABLE boxes ADD COLUMN IF NOT EXISTS payment_info TEXT`).catch(() => {}),
    query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS inclusions_count INTEGER DEFAULT 0`).catch(() => {}),
    query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS weight_g NUMERIC(10,2)`).catch(() => {}),
  ])
}

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  await ensureTables()

  const box = await queryOne('SELECT * FROM boxes WHERE id=$1', [params.id])
  if (!box) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const boxItemTypes = await query('SELECT * FROM box_item_types WHERE box_id=$1', [params.id]).catch(() => [] as any[]) as any[]

  // weightByType keyed by item_type (e.g. 'photocard', 'album'), also by custom_label
  const weightByType: Record<string, number> = {}
  const weightByItemType: Record<string, number> = {}
  for (const it of boxItemTypes) {
    const key = it.item_type === 'custom' ? (it.custom_label || 'custom') : it.item_type
    weightByType[key] = parseFloat(it.weight_g || 0)
    if (!weightByItemType[it.item_type]) weightByItemType[it.item_type] = parseFloat(it.weight_g || 0)
  }

  const linkedOrderRows = await query('SELECT order_id FROM box_orders WHERE box_id=$1', [params.id]).catch(() => [] as any[]) as any[]
  let orderIds: string[] = linkedOrderRows.map((r: any) => r.order_id)
  if (orderIds.length === 0 && (box as any).order_id) orderIds.push((box as any).order_id)

  let allItems: any[] = []
  for (const oid of orderIds) {
    const items = await query(`
      SELECT oi.*,
        COALESCE(oi.joiner_id, o.personal_joiner_id) AS joiner_id,
        p.id as pid, p.display_name, p.username,
        COALESCE(oi.item_type, 'photocard') as item_type,
        COALESCE(oi.inclusions_count, 0) as inclusions_count,
        m.name as member_name,
        s.name as shop_name, g.name as group_name, o.round_number, o.type as order_type
      FROM order_items oi
      LEFT JOIN orders o ON o.id = oi.order_id
      LEFT JOIN profiles p ON p.id = COALESCE(oi.joiner_id, o.personal_joiner_id)
      LEFT JOIN members m ON m.id = oi.member_id
      LEFT JOIN shops s ON s.id = o.shop_id
      LEFT JOIN groups g ON g.id = o.group_id
      WHERE oi.order_id = $1
        AND (oi.joiner_id IS NOT NULL OR (oi.joiner_id IS NULL AND o.personal_joiner_id IS NOT NULL AND o.type = 'personal'))
        AND COALESCE(oi.joiner_id, o.personal_joiner_id) IS NOT NULL
    `, [oid]).catch(() => [] as any[])
    allItems = allItems.concat(items as any[])
  }

  const joinerMap: Record<string, {
    joiner_id: string; display_name: string; username: string
    weight_g: number; item_count: number; total_inclusions: number; items: any[]
  }> = {}

  for (const item of allItems) {
    const jid = item.joiner_id
    if (!joinerMap[jid]) {
      joinerMap[jid] = { joiner_id: jid, display_name: item.display_name, username: item.username, weight_g: 0, item_count: 0, total_inclusions: 0, items: [] }
    }
    // Skip late fees from EMS/customs weight calculation
    const isLateFee = /late.?fee/i.test(item.description || '')
    const typeKey = item.item_type || 'photocard'
    const claimed = item.amount_claimed || 1
    const inclusions = typeKey === 'photocard' ? (parseInt(item.inclusions_count) || 0) : 0
    const effectiveCount = claimed + inclusions
    const unitWeight = isLateFee ? 0 : (weightByItemType[typeKey] ?? weightByType[typeKey] ?? 0)
    const wg = unitWeight * effectiveCount
    joinerMap[jid].weight_g += wg
    joinerMap[jid].item_count += isLateFee ? 0 : claimed
    joinerMap[jid].total_inclusions += parseInt(item.inclusions_count) || 0
    joinerMap[jid].items.push({
      id: item.id, description: item.description, member_name: item.member_name,
      amount_claimed: item.amount_claimed, price_eur: item.price_eur, item_type: item.item_type,
      inclusions_count: parseInt(item.inclusions_count) || 0, weight_g: wg,
      shop_name: item.shop_name, group_name: item.group_name, round_number: item.round_number,
    })
  }

  const shares = await query(
    'SELECT joiner_id, ems_paid, customs_paid, excluded, ems_amount_eur, customs_amount_eur, proof_url, proof_submitted, proof_submitted_at, customs_proof_url, customs_proof_submitted, customs_proof_submitted_at FROM box_joiner_shares WHERE box_id=$1',
    [params.id]
  ).catch(() => [] as any[]) as any[]
  const paidMap: Record<string, any> = {}
  for (const s of shares) paidMap[s.joiner_id] = s

  // Total weight excluding excluded joiners (for correct fraction)
  const totalWeightActive = Object.values(joinerMap).reduce((s, j) => {
    return (paidMap[j.joiner_id]?.excluded) ? s : s + j.weight_g
  }, 0)
  const totalWeight = Object.values(joinerMap).reduce((s, j) => s + j.weight_g, 0)
  const joinerCount = Object.keys(joinerMap).length

  const b = box as any
  const joiners = Object.values(joinerMap).map(j => {
    const isExcluded = paidMap[j.joiner_id]?.excluded || false
    const fraction = (!isExcluded && totalWeightActive > 0) ? j.weight_g / totalWeightActive : 0
    const ems_share_eur = parseFloat(b.ems_total_eur || 0) * fraction
    const customs_share_eur = parseFloat(b.customs_total_eur || 0) * fraction
    return {
      ...j, fraction, ems_share_eur, customs_share_eur,
      ems_share_krw: parseFloat(b.ems_total_krw || 0) * fraction,
      customs_share_krw: parseFloat(b.customs_total_krw || 0) * fraction,
      total_share_eur: ems_share_eur + customs_share_eur,
      total_share_krw: (parseFloat(b.ems_total_krw || 0) + parseFloat(b.customs_total_krw || 0)) * fraction,
      ems_paid: paidMap[j.joiner_id]?.ems_paid || false,
      customs_paid: paidMap[j.joiner_id]?.customs_paid || false,
      excluded: isExcluded,
      ems_amount_eur: paidMap[j.joiner_id]?.ems_amount_eur ?? null,
      customs_amount_eur: paidMap[j.joiner_id]?.customs_amount_eur ?? null,
      proof_url: paidMap[j.joiner_id]?.proof_url || null,
      proof_submitted: paidMap[j.joiner_id]?.proof_submitted || false,
      customs_proof_url: paidMap[j.joiner_id]?.customs_proof_url || null,
      customs_proof_submitted: paidMap[j.joiner_id]?.customs_proof_submitted || false,
    }
  }).sort((a, b) => b.weight_g - a.weight_g)

  const viewAs = new URL(req.url).searchParams.get('viewAs')
  if (user.role === 'joiner' || viewAs === 'joiner') {
    const ems_requested = b.ems_payment_requested || false
    const customs_requested = b.customs_payment_requested || false
    if (!ems_requested && !customs_requested) {
      return NextResponse.json({ box, joiners: [], itemTypes: boxItemTypes, totalWeight, weightByType, weightByItemType, ems_payment_requested: false, customs_payment_requested: false })
    }
    const mine = joiners.find(j => j.joiner_id === user.id)
    if (mine) {
      const m = mine as any
      const ceil2 = (n: number) => Math.ceil(n * 100) / 100
      // Always ceil-round live share
      m.ems_share_eur = ceil2(m.ems_share_eur)
      m.customs_share_eur = ceil2(m.customs_share_eur)
      // Prefer locked amount; if null try direct DB lookup
      if (m.ems_amount_eur == null) {
        const row = await queryOne('SELECT ems_amount_eur, customs_amount_eur FROM box_joiner_shares WHERE box_id=$1 AND joiner_id=$2', [params.id, user.id]).catch(() => null) as any
        m.ems_amount_eur = row?.ems_amount_eur != null ? parseFloat(row.ems_amount_eur) : m.ems_share_eur
        m.customs_amount_eur = row?.customs_amount_eur != null ? parseFloat(row.customs_amount_eur) : m.customs_share_eur
      } else {
        m.ems_amount_eur = parseFloat(m.ems_amount_eur)
        m.customs_amount_eur = m.customs_amount_eur != null ? parseFloat(m.customs_amount_eur) : m.customs_share_eur
      }
    }
    return NextResponse.json({ box, joiners: mine ? [mine] : [], itemTypes: boxItemTypes, totalWeight, weightByType, weightByItemType, ems_payment_requested: ems_requested, customs_payment_requested: customs_requested })
  }

  return NextResponse.json({ box, joiners, itemTypes: boxItemTypes, totalWeight, weightByType, weightByItemType, ems_payment_requested: b.ems_payment_requested || false, customs_payment_requested: b.customs_payment_requested || false })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  await ensureTables()

  const body = await req.json()

  // Toggle excluded
  if (body.action === 'exclude') {
    const { joiner_id, excluded } = body
    await query(
      `INSERT INTO box_joiner_shares (box_id, joiner_id, excluded) VALUES ($1,$2,$3)
       ON CONFLICT (box_id, joiner_id) DO UPDATE SET excluded=$3`,
      [params.id, joiner_id, excluded]
    )
    return NextResponse.json({ ok: true })
  }

  // Publish EMS — lock each joiner's ceil-rounded amount
  if (body.action === 'publish_ems') {
    if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { joiner_shares } = body // [{ joiner_id, ems_amount_eur }]
    for (const js of joiner_shares) {
      await query(
        `INSERT INTO box_joiner_shares (box_id, joiner_id, ems_amount_eur) VALUES ($1,$2,$3)
         ON CONFLICT (box_id, joiner_id) DO UPDATE SET ems_amount_eur=$3`,
        [params.id, js.joiner_id, js.ems_amount_eur]
      )
    }
    await query(`UPDATE boxes SET ems_payment_requested=true, payment_requested=true WHERE id=$1`, [params.id])
    return NextResponse.json({ ok: true })
  }

  // Publish Customs
  if (body.action === 'publish_customs') {
    if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { joiner_shares } = body
    for (const js of joiner_shares) {
      await query(
        `INSERT INTO box_joiner_shares (box_id, joiner_id, customs_amount_eur) VALUES ($1,$2,$3)
         ON CONFLICT (box_id, joiner_id) DO UPDATE SET customs_amount_eur=$3`,
        [params.id, js.joiner_id, js.customs_amount_eur]
      )
    }
    await query(`UPDATE boxes SET customs_payment_requested=true WHERE id=$1`, [params.id])
    return NextResponse.json({ ok: true })
  }

  // Joiner: submit EMS proof
  if (body.action === 'submit_proof') {
    const { proof_url } = body
    await query(
      `INSERT INTO box_joiner_shares (box_id, joiner_id, proof_url, proof_submitted, proof_submitted_at) VALUES ($1,$2,$3,true,now())
       ON CONFLICT (box_id, joiner_id) DO UPDATE SET proof_url=$3, proof_submitted=true, proof_submitted_at=now()`,
      [params.id, user.id, proof_url]
    )
    return NextResponse.json({ ok: true })
  }

  // Joiner: submit customs proof
  if (body.action === 'submit_customs_proof') {
    const { proof_url } = body
    await query(
      `INSERT INTO box_joiner_shares (box_id, joiner_id, customs_proof_url, customs_proof_submitted, customs_proof_submitted_at) VALUES ($1,$2,$3,true,now())
       ON CONFLICT (box_id, joiner_id) DO UPDATE SET customs_proof_url=$3, customs_proof_submitted=true, customs_proof_submitted_at=now()`,
      [params.id, user.id, proof_url]
    )
    return NextResponse.json({ ok: true })
  }

  // Legacy: toggle paid fields
  const { joiner_id, field, value } = body
  if (joiner_id && field) {
    await query(
      `INSERT INTO box_joiner_shares (box_id, joiner_id, ${field}) VALUES ($1,$2,$3)
       ON CONFLICT (box_id, joiner_id) DO UPDATE SET ${field}=$3`,
      [params.id, joiner_id, value]
    )
  }
  return NextResponse.json({ ok: true })
}
