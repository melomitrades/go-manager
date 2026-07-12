import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

async function ensureTables() {
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
  await query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS item_type TEXT DEFAULT 'photocard'`).catch(() => {})
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  await ensureTables()

  const box = await queryOne('SELECT * FROM boxes WHERE id=$1', [params.id])
  if (!box) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Get item type weights configured FOR THIS BOX
  const boxItemTypes = await query('SELECT * FROM box_item_types WHERE box_id=$1', [params.id]).catch(() => [] as any[]) as any[]
  const weightByType: Record<string, number> = {}
  for (const it of boxItemTypes) {
    const key = it.item_type === 'custom' ? (it.custom_label || 'custom') : it.item_type
    weightByType[key] = parseFloat(it.weight_g || 0)
  }

  // Get all linked order IDs
  const linkedOrderRows = await query('SELECT order_id FROM box_orders WHERE box_id=$1', [params.id]).catch(() => [] as any[]) as any[]
  let orderIds: string[] = linkedOrderRows.map((r: any) => r.order_id)
  if (orderIds.length === 0 && (box as any).order_id) orderIds.push((box as any).order_id)

  // Get all items across linked orders with full detail
  let allItems: any[] = []
  for (const oid of orderIds) {
    const items = await query(`
      SELECT oi.*,
        p.id as pid, p.display_name, p.username,
        COALESCE(oi.item_type, 'photocard') as item_type,
        COALESCE(oi.inclusions_count, 0) as inclusions_count,
        m.name as member_name,
        o.id as oid,
        s.name as shop_name,
        g.name as group_name,
        o.round_number
      FROM order_items oi
      LEFT JOIN profiles p ON p.id = oi.joiner_id
      LEFT JOIN members m ON m.id = oi.member_id
      LEFT JOIN orders o ON o.id = oi.order_id
      LEFT JOIN shops s ON s.id = o.shop_id
      LEFT JOIN groups g ON g.id = o.group_id
      WHERE oi.order_id = $1 AND oi.joiner_id IS NOT NULL
    `, [oid]).catch(() => [] as any[])
    allItems = allItems.concat(items as any[])
  }

  // Compute weight per joiner using box item type weights
  const joinerMap: Record<string, {
    joiner_id: string; display_name: string; username: string
    weight_g: number; item_count: number; total_inclusions: number; items: any[]
  }> = {}

  for (const item of allItems) {
    const jid = item.joiner_id
    if (!joinerMap[jid]) {
      joinerMap[jid] = {
        joiner_id: jid,
        display_name: item.display_name,
        username: item.username,
        weight_g: 0,
        item_count: 0,
        total_inclusions: 0,
        items: [],
      }
    }
    const typeKey = item.item_type || 'photocard'
    const wg = (weightByType[typeKey] || 0) * (item.amount_claimed || 1)
    joinerMap[jid].weight_g += wg
    joinerMap[jid].item_count += item.amount_claimed || 1
    joinerMap[jid].total_inclusions += parseInt(item.inclusions_count) || 0
    joinerMap[jid].items.push({
      id: item.id,
      description: item.description,
      member_name: item.member_name,
      amount_claimed: item.amount_claimed,
      price_eur: item.price_eur,
      item_type: item.item_type,
      shop_name: item.shop_name,
      group_name: item.group_name,
      round_number: item.round_number,
    })
  }

  const totalWeight = Object.values(joinerMap).reduce((s, j) => s + j.weight_g, 0)
  const joinerCount = Object.keys(joinerMap).length

  // Get paid status
  const shares = await query('SELECT joiner_id, ems_paid, customs_paid FROM box_joiner_shares WHERE box_id=$1', [params.id]).catch(() => [] as any[]) as any[]
  const paidMap: Record<string, any> = {}
  for (const s of shares) paidMap[s.joiner_id] = s

  const b = box as any
  const joiners = Object.values(joinerMap).map(j => {
    const fraction = totalWeight > 0 ? j.weight_g / totalWeight : (joinerCount > 0 ? 1 / joinerCount : 0)
    const ems_share_eur = parseFloat(b.ems_total_eur || 0) * fraction
    const customs_share_eur = parseFloat(b.customs_total_eur || 0) * fraction
    const ems_share_krw = parseFloat(b.ems_total_krw || 0) * fraction
    const customs_share_krw = parseFloat(b.customs_total_krw || 0) * fraction
    return {
      ...j,
      fraction,
      ems_share_eur,
      customs_share_eur,
      ems_share_krw,
      customs_share_krw,
      total_share_eur: ems_share_eur + customs_share_eur,
      total_share_krw: ems_share_krw + customs_share_krw,
      ems_paid: paidMap[j.joiner_id]?.ems_paid || false,
      customs_paid: paidMap[j.joiner_id]?.customs_paid || false,
    }
  }).sort((a, b) => b.weight_g - a.weight_g)

  // If requested joiner (joiner role), filter to just their data
  if (user.role === 'joiner') {
    const mine = joiners.find(j => j.joiner_id === user.id)
    return NextResponse.json({ box, joiners: mine ? [mine] : [], itemTypes: boxItemTypes, totalWeight })
  }

  return NextResponse.json({ box, joiners, itemTypes: boxItemTypes, totalWeight })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTables()

  const { joiner_id, field, value } = await req.json()
  await query(
    `INSERT INTO box_joiner_shares (box_id, joiner_id, ${field}) VALUES ($1,$2,$3)
     ON CONFLICT (box_id, joiner_id) DO UPDATE SET ${field}=$3`,
    [params.id, joiner_id, value]
  )
  return NextResponse.json({ ok: true })
}
