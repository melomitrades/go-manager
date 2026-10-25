import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import {
  ensureEventsSchema, listEvents, getEvent, eventTotals, buildEventValues, EVENT_COLS, colExpr, syncItemsFromEvent,
} from '@/lib/events'
import { ensureWinnerItemsSchema } from '@/lib/winnerItems'

export const dynamic = 'force-dynamic'
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })

async function gom() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: bad('Unauthorized', 401) }
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return { error: bad('Forbidden', 403) }
  return { user }
}

// GET                 → every event + totals
// GET ?era_id=        → one era's events + totals
// GET ?order_id=      → one order's events
// GET ?results_due=1  → pending events whose date has passed (dashboard)
export async function GET(req: NextRequest) {
  const { error } = await gom(); if (error) return error
  await ensureEventsSchema()
  const sp = new URL(req.url).searchParams
  const events = await listEvents({
    eraId: sp.get('era_id') || undefined, orderId: sp.get('order_id') || undefined, resultsDue: !!sp.get('results_due'),
  })
  return NextResponse.json({ events, totals: eventTotals(events) })
}

// POST { action, ... }
//   create        { era_id, type, type_label?, event_local?, shop_id?, entered_by?, order_id?, entries_count?, winner_spots?, result?, note? }
//   update        { id, ...same }
//   set_result    { id, result }
//   raffle_winner { id, raffle_winner_id }    (Fancall events)
//   delete        { id }                      (refused while it has winner items)
export async function POST(req: NextRequest) {
  const { user, error } = await gom(); if (error) return error
  await ensureEventsSchema()
  await ensureWinnerItemsSchema()
  const b = await req.json().catch(() => ({}))

  switch (b.action) {
    case 'create': {
      const { values, error } = await buildEventValues(b, null)
      if (error) return bad(error)
      const row = await queryOne<any>(
        `INSERT INTO era_events (${EVENT_COLS.join(', ')}, created_by) VALUES (${EVENT_COLS.map((c, i) => colExpr(c, i + 1)).join(', ')}, $${EVENT_COLS.length + 1}) RETURNING id`,
        [...EVENT_COLS.map(c => values![c]), user.id])
      return NextResponse.json({ event: await getEvent(row.id) }, { status: 201 })
    }
    case 'update':
    case 'set_result': {
      if (!b.id) return bad('Missing id')
      const existing = await getEvent(b.id)
      if (!existing) return bad('Event not found', 404)
      const input = b.action === 'set_result' ? { result: b.result } : b
      const { values, error } = await buildEventValues(input, existing)
      if (error) return bad(error)
      await query(`UPDATE era_events SET ${EVENT_COLS.map((c, i) => `${c} = ${colExpr(c, i + 1)}`).join(', ')}, updated_at = now() WHERE id = $${EVENT_COLS.length + 1}`,
        [...EVENT_COLS.map(c => values![c]), b.id])
      await syncItemsFromEvent(b.id)
      return NextResponse.json({ event: await getEvent(b.id) })
    }
    case 'raffle_winner': {
      if (!b.id) return bad('Missing id')
      const ev = await queryOne<any>(`SELECT type FROM era_events WHERE id = $1`, [b.id])
      if (!ev) return bad('Event not found', 404)
      if (ev.type !== 'fancall') return bad('Only fancall events have a raffle')
      await query(`UPDATE era_events SET raffle_winner_id = $2, updated_at = now() WHERE id = $1`, [b.id, b.raffle_winner_id || null])
      return NextResponse.json({ event: await getEvent(b.id) })
    }
    case 'delete': {
      if (!b.id) return bad('Missing id')
      const n = await queryOne<any>(`SELECT COUNT(*)::int AS n FROM winner_items WHERE event_id = $1`, [b.id])
      if (n?.n) return bad(`This event has ${n.n} winner item${n.n === 1 ? '' : 's'}. Delete or move them first.`)
      await query(`DELETE FROM era_events WHERE id = $1`, [b.id])
      return NextResponse.json({ ok: true })
    }
    default:
      return bad('Unknown action')
  }
}
