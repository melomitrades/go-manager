import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import {
  ensureWinnerItemsSchema, listWinnerItems, getWinnerItem, forJoiner, totalsOf, winnerCountsByEra,
  buildItemValues, notifyRecipient, getRawWinnerItem,
} from '@/lib/winnerItems'
import { ensureEventsSchema } from '@/lib/events'

export const dynamic = 'force-dynamic'

const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })

// Adding an item to a Pending event means it was won.
async function markEventWon(eventId: string) {
  await query(`UPDATE era_events SET result = 'won', updated_at = now() WHERE id = $1 AND result = 'pending'`, [eventId]).catch(() => {})
}

// GET ?era_id=        → GOM: every item of the era + totals
// GET ?order_id=      → GOM: items of that order + totals · joiner: only their own (sold/given) ones
// GET ?mine=1         → the signed-in user's sold/given items (joiner My Orders)
// GET ?era_counts=1   → GOM: { era_id: count } for the Eras list
// Add viewAs=joiner to see what a joiner sees (GOM previewing joiner pages).
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return bad('Unauthorized', 401)
  const user = session.user as any
  await ensureWinnerItemsSchema()
  const sp = new URL(req.url).searchParams
  const isGom = ['gom', 'admin'].includes(user.role) && sp.get('viewAs') !== 'joiner'

  if (sp.get('mine')) {
    const items = await listWinnerItems({ recipientId: user.id })
    return NextResponse.json(items.map(forJoiner))
  }
  const orderId = sp.get('order_id')
  if (orderId) {
    if (!isGom) {
      const items = (await listWinnerItems({ orderId })).filter(i => i.recipient_id === user.id && ['sold', 'given'].includes(i.status))
      return NextResponse.json({ items: items.map(forJoiner) })
    }
    const items = await listWinnerItems({ orderId })
    return NextResponse.json({ items, totals: totalsOf(items) })
  }
  if (!isGom) return bad('Forbidden', 403)
  if (sp.get('era_counts')) return NextResponse.json(await winnerCountsByEra())
  const eraId = sp.get('era_id')
  if (!eraId) return bad('era_id required')
  const items = await listWinnerItems({ eraId })
  return NextResponse.json({ items, totals: totalsOf(items) })
}

const COLS = ['event_id', 'era_id', 'order_id', 'order_section', 'type_id', 'member_ids', 'version_id', 'source', 'source_label', 'fancall_id',
  'event_date', 'received_date', 'status', 'kept_by', 'recipient_id', 'sale_price_eur', 'sale_price_krw', 'sale_date', 'ship_box_id', 'note', 'photo_url']

// POST { action, ... }  (GOM / admin only)
//   create      { ...fields, count?: 1–50 }   one row per physical item
//   update      { id, ...fields }             photo_url: undefined keeps it, null removes it
//   duplicate   { id, count?: 1 }             copies everything but the person / sale (back to its pre-handover status)
//   delete      { id }
//   type_add    { name }
//   type_update { id, name?, archived? }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return bad('Unauthorized', 401)
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return bad('Forbidden', 403)
  await ensureWinnerItemsSchema()
  await ensureEventsSchema()
  const b = await req.json().catch(() => ({}))

  switch (b.action) {
    case 'create': {
      const { values, error } = await buildItemValues(b, null)
      if (error) return bad(error)
      const count = Math.min(50, Math.max(1, parseInt(b.count) || 1))
      const cols = COLS.filter(c => values![c] !== undefined)
      const ids: string[] = []
      for (let n = 0; n < count; n++) {
        const row = await queryOne<any>(
          `INSERT INTO winner_items (${cols.join(', ')}, created_by) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1}) RETURNING id`,
          [...cols.map(c => values![c]), user.id])
        ids.push(row.id)
      }
      if (values!.event_id) await markEventWon(values!.event_id)
      const first = await getWinnerItem(ids[0])
      if (first) await notifyRecipient(null, first)
      return NextResponse.json({ ids, item: first }, { status: 201 })
    }
    case 'update': {
      if (!b.id) return bad('Missing id')
      const existing = await getRawWinnerItem(b.id)
      if (!existing) return bad('Item not found', 404)
      const before = await getWinnerItem(b.id)
      const { values, error } = await buildItemValues(b, existing)
      if (error) return bad(error)
      const cols = COLS.filter(c => values![c] !== undefined)
      await query(`UPDATE winner_items SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = now() WHERE id = $${cols.length + 1}`,
        [...cols.map(c => values![c]), b.id])
      if (values!.event_id) await markEventWon(values!.event_id)
      const item = await getWinnerItem(b.id)
      await notifyRecipient(before, item)
      return NextResponse.json({ item })
    }
    case 'duplicate': {
      if (!b.id) return bad('Missing id')
      const count = Math.min(50, Math.max(1, parseInt(b.count) || 1))
      const src = await getRawWinnerItem(b.id)
      if (!src) return bad('Item not found', 404)
      // A copy is a separate physical item: it isn't kept/sold to anyone yet.
      const status = ['kept', 'sold', 'given', 'missing'].includes(src.status) ? (src.received_date ? 'received' : 'won') : src.status
      for (let n = 0; n < count; n++) {
        await query(`INSERT INTO winner_items (event_id, era_id, order_id, order_section, type_id, member_ids, version_id, source, source_label, fancall_id,
            event_date, received_date, status, photo_url, note, created_by)
          SELECT event_id, era_id, order_id, order_section, type_id, member_ids, version_id, source, source_label, fancall_id,
            event_date, received_date, $2, photo_url, note, $3 FROM winner_items WHERE id = $1`, [b.id, status, user.id])
      }
      return NextResponse.json({ ok: true, count })
    }
    case 'delete': {
      if (!b.id) return bad('Missing id')
      await query(`DELETE FROM winner_items WHERE id = $1`, [b.id])
      await query(`DELETE FROM shipment_items WHERE source_type = 'winner_item' AND source_id::text = $1`, [b.id]).catch(() => {})
      return NextResponse.json({ ok: true })
    }
    case 'type_add': {
      const name = String(b.name || '').trim()
      if (!name) return bad('Give the type a name')
      const existing = await queryOne<any>(`SELECT * FROM winner_item_types WHERE LOWER(name) = LOWER($1)`, [name])
      if (existing) {
        if (existing.archived) await query(`UPDATE winner_item_types SET archived = false WHERE id = $1`, [existing.id])
        return NextResponse.json({ ...existing, archived: false })
      }
      const t = await queryOne(`INSERT INTO winner_item_types (name) VALUES ($1) RETURNING *`, [name])
      return NextResponse.json(t, { status: 201 })
    }
    case 'type_update': {
      if (!b.id) return bad('Missing id')
      const name = b.name !== undefined ? String(b.name).trim() : null
      if (name === '') return bad('Give the type a name')
      if (name) {
        const clash = await queryOne<any>(`SELECT id FROM winner_item_types WHERE LOWER(name) = LOWER($1) AND id <> $2`, [name, b.id])
        if (clash) return bad('Another type already has that name')
      }
      const t = await queryOne(`UPDATE winner_item_types SET name = COALESCE($2, name), archived = COALESCE($3, archived) WHERE id = $1 RETURNING *`,
        [b.id, name, typeof b.archived === 'boolean' ? b.archived : null])
      return t ? NextResponse.json(t) : bad('Type not found', 404)
    }
    default:
      return bad('Unknown action')
  }
}
