import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { ensureShipmentsSchema, getFormBoxIds, buildShipmentItems, getShipmentChecklist } from '@/lib/shipments'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  await ensureShipmentsSchema()

  const shipment = await queryOne<any>('SELECT * FROM shipments WHERE id=$1', [params.id])
  if (!shipment) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (user.role === 'joiner' && shipment.joiner_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const boxIds = await getFormBoxIds(shipment.form_id)
  await buildShipmentItems(shipment.id, shipment.joiner_id, boxIds)
  const { items, previewImages } = await getShipmentChecklist(shipment.id)

  const confirmed = items.filter(i => i.confirmed).length
  const skipped = items.filter(i => i.skipped).length

  return NextResponse.json({
    shipment, items, previewImages,
    progress: { total: items.length, confirmed, skipped, remaining: items.length - confirmed - skipped },
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await ensureShipmentsSchema()

  const shipment = await queryOne<any>('SELECT * FROM shipments WHERE id=$1', [params.id])
  if (!shipment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { action, item_id } = await req.json()

  if (action === 'confirm' || action === 'skip' || action === 'unconfirm') {
    if (!item_id) return NextResponse.json({ error: 'item_id required' }, { status: 400 })
    const confirmed = action === 'confirm'
    const skipped = action === 'skip'
    await query(
      `UPDATE shipment_items SET confirmed=$1, skipped=$2, confirmed_at=CASE WHEN $1 OR $2 THEN now() ELSE NULL END
       WHERE id=$3 AND shipment_id=$4`,
      [confirmed, skipped, item_id, shipment.id]
    )
    return NextResponse.json({ ok: true })
  }

  if (action === 'finalize') {
    const remaining = await queryOne<{ count: number }>(
      `SELECT count(*)::int FROM shipment_items WHERE shipment_id=$1 AND NOT confirmed AND NOT skipped`,
      [shipment.id]
    )
    if ((remaining?.count || 0) > 0) {
      return NextResponse.json({ error: `${remaining!.count} item(s) still need to be confirmed or skipped` }, { status: 400 })
    }
    const row = await queryOne('UPDATE shipments SET status=$1, packed_at=now(), updated_at=now() WHERE id=$2 RETURNING *', ['packed', shipment.id])
    return NextResponse.json(row)
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
