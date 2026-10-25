import { query, queryOne } from './db'
import { EVENT_TYPES, EVENT_RESULTS, eventTypeText } from './eventTypes'

// ============================================================
// EVENTS (fansigns, fancalls, DIY events, lucky draws, VCE, POB events…)
//
// Every event the GOM enters is recorded, won or not: result is Pending → Won / Lost ("Lost" = we
// didn't get any winner item). Winner items (src/lib/winnerItems.ts) hang off a WON event: an item's
// era, order, source and event date always come from its event (copied onto the item and kept in
// sync here, so shipping / joiner views keep reading the item alone).
//
// Rules
//   - era required, type required (Other → custom name), order optional (at most one, of that era)
//   - fields: date & time (Paris), shop, entered by, entries / albums used, winner spots, note
//   - raffle winner: Fancall events only (same raffle as before, run on the linked order)
//   - an event with winner items can't be set to Lost or deleted
//   - "Received" is tracked on the winner items only
//
// Old system (before events): the `fancalls` table and winner items without an event are the
// ARCHIVE. They stay fully editable (Events → Archive, and the era page's archive group).
// New fancall orders in an era create a Fancall event; orders without an era still create an
// archive fancall row (an event needs an era).
//
// Table era_events, TEXT ids with ::text comparisons (no FKs), like eras.
// ============================================================

let schemaPromise: Promise<void> | null = null
export function ensureEventsSchema() {
  if (!schemaPromise) schemaPromise = migrate().catch(err => { schemaPromise = null; throw err })
  return schemaPromise
}
async function migrate() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS era_events (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      era_id TEXT NOT NULL,
      type TEXT NOT NULL,
      type_label TEXT,
      event_at TIMESTAMPTZ,
      shop_id TEXT,
      entered_by TEXT,
      order_id TEXT,
      entries_count INTEGER,
      winner_spots INTEGER,
      result TEXT NOT NULL DEFAULT 'pending',
      raffle_winner_id TEXT,
      note TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_era_events_era ON era_events(era_id)`,
    `CREATE INDEX IF NOT EXISTS idx_era_events_order ON era_events(order_id)`,
  ]
  for (const sql of stmts) await query(sql).catch(err => console.error('[events migration]', sql.slice(0, 60), err?.message))
}

// Items linked to an event follow the event's order era (same self-heal as winner items).
async function syncEventEras() {
  await query(`UPDATE era_events ev SET era_id = o.era_id::text
               FROM orders o WHERE o.id::text = ev.order_id AND o.era_id IS NOT NULL AND o.era_id::text <> ev.era_id`).catch(() => {})
}

const SELECT = `
  SELECT ev.id, ev.era_id, ev.type, ev.type_label, ev.event_at,
    to_char(ev.event_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI') AS event_local,
    (ev.event_at AT TIME ZONE 'Europe/Paris')::date::text AS event_day,
    ev.shop_id, ev.entered_by, ev.order_id, ev.entries_count, ev.winner_spots, ev.result, ev.raffle_winner_id, ev.note,
    ev.created_at, ev.updated_at,
    e.name AS era_name, e.status AS era_status, e.group_id, g.name AS group_name,
    s.name AS shop_name,
    COALESCE(p.display_name, p.username) AS entered_by_name,
    o.round_number AS order_round, o.status::text AS order_status, os.name AS order_shop_name,
    COALESCE(w.display_name, w.username) AS raffle_winner_name,
    (SELECT COUNT(*)::int FROM winner_items wi WHERE wi.event_id = ev.id) AS item_count
  FROM era_events ev
  LEFT JOIN eras e ON e.id::text = ev.era_id
  LEFT JOIN groups g ON g.id::text = e.group_id::text
  LEFT JOIN shops s ON s.id::text = ev.shop_id
  LEFT JOIN profiles p ON p.id::text = ev.entered_by
  LEFT JOIN orders o ON o.id::text = ev.order_id
  LEFT JOIN shops os ON os.id::text = o.shop_id::text
  LEFT JOIN profiles w ON w.id::text = ev.raffle_winner_id
`

function decorate(r: any) {
  const orderGone = r.order_id && r.order_status == null
  return { ...r, order_id: orderGone ? null : r.order_id, type_text: eventTypeText(r) }
}

export async function listEvents(where: { eraId?: string; orderId?: string; resultsDue?: boolean; id?: string } = {}) {
  await ensureEventsSchema()
  const { ensureWinnerItemsSchema } = await import('./winnerItems')
  await ensureWinnerItemsSchema()
  await syncEventEras()
  const conds: string[] = []
  const params: any[] = []
  if (where.id) { params.push(where.id); conds.push(`ev.id = $${params.length}`) }
  if (where.eraId) { params.push(where.eraId); conds.push(`ev.era_id = $${params.length}`) }
  if (where.orderId) { params.push(where.orderId); conds.push(`ev.order_id = $${params.length}`) }
  if (where.resultsDue) conds.push(`ev.result = 'pending' AND ev.event_at IS NOT NULL AND ev.event_at < now()`)
  const rows = await query<any>(`${SELECT} ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
    ORDER BY ev.event_at DESC NULLS FIRST, ev.created_at DESC`, params)
  return rows.map(decorate)
}

export async function getEvent(id: string) {
  return (await listEvents({ id }))[0] || null
}

export function eventTotals(events: any[]) {
  const won = events.filter(e => e.result === 'won').length
  const lost = events.filter(e => e.result === 'lost').length
  const pending = events.filter(e => e.result === 'pending').length
  return { count: events.length, won, lost, pending, win_rate: won + lost > 0 ? Math.round(won / (won + lost) * 100) : null }
}

const intOrNull = (v: any) => (v === '' || v == null || isNaN(parseInt(v)) ? null : Math.max(0, parseInt(v)))

// Normalise + validate. Returns { values } (column → value; event_at is a Paris local 'YYYY-MM-DDTHH:MM' string) or { error }.
export async function buildEventValues(b: any, existing: any | null): Promise<{ values?: Record<string, any>; error?: string }> {
  const pick = (k: string) => (b[k] !== undefined ? b[k] : existing ? existing[k] : undefined)

  let orderId: string | null = pick('order_id') || null
  let eraId: string | null = pick('era_id') || null
  if (orderId) {
    const o = await queryOne<any>(`SELECT era_id::text AS era_id FROM orders WHERE id::text = $1`, [orderId])
    if (!o) return { error: 'That order no longer exists' }
    if (o.era_id) eraId = o.era_id
    else if (eraId) return { error: "That order isn't linked to an era. Link it to this era first." }
  }
  if (!eraId) return { error: 'Pick an era' }
  const era = await queryOne<any>(`SELECT id FROM eras WHERE id::text = $1`, [eraId])
  if (!era) return { error: 'Era not found' }

  const type = pick('type')
  if (!EVENT_TYPES.includes(type)) return { error: 'Pick the event type' }
  const typeLabel = type === 'other' ? String(pick('type_label') || '').trim() : ''
  if (type === 'other' && !typeLabel) return { error: 'Give the event type a name' }

  const result = pick('result') || 'pending'
  if (!EVENT_RESULTS.includes(result)) return { error: 'Invalid result' }
  if (result === 'lost' && existing) {
    const n = await queryOne<any>(`SELECT COUNT(*)::int AS n FROM winner_items WHERE event_id = $1`, [existing.id])
    if (n?.n) return { error: `This event has ${n.n} winner item${n.n === 1 ? '' : 's'}. Delete or move them before marking it Lost.` }
  }

  // Date & time as typed (Paris local). '' clears it.
  let eventAt: string | null = null
  const rawAt = b.event_local !== undefined ? b.event_local : existing?.event_local
  if (rawAt) {
    const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(String(rawAt))
    if (!m) return { error: 'Invalid date' }
    eventAt = `${m[1]} ${m[2] || '00:00'}`
  }

  return {
    values: {
      era_id: eraId, type, type_label: typeLabel || null, event_at: eventAt,
      shop_id: pick('shop_id') || null, entered_by: pick('entered_by') || null, order_id: orderId,
      entries_count: intOrNull(pick('entries_count')), winner_spots: intOrNull(pick('winner_spots')),
      result, raffle_winner_id: type === 'fancall' ? (pick('raffle_winner_id') || null) : null,
      note: String(pick('note') || '').trim().slice(0, 2000) || null,
    },
  }
}

export const EVENT_COLS = ['era_id', 'type', 'type_label', 'event_at', 'shop_id', 'entered_by', 'order_id', 'entries_count', 'winner_spots', 'result', 'raffle_winner_id', 'note']
// event_at is stored from a Paris local time
export const colExpr = (c: string, i: number) => (c === 'event_at' ? `($${i}::timestamp AT TIME ZONE 'Europe/Paris')` : `$${i}`)

// Copy the event's era / order / type / date onto its winner items.
export async function syncItemsFromEvent(eventId: string) {
  await query(`
    UPDATE winner_items wi SET
      era_id = ev.era_id,
      order_section = CASE WHEN wi.order_id IS NOT DISTINCT FROM ev.order_id THEN wi.order_section ELSE NULL END,
      order_id = ev.order_id,
      ship_box_id = CASE WHEN ev.order_id IS NOT NULL THEN NULL ELSE wi.ship_box_id END,
      source = ev.type, source_label = ev.type_label, fancall_id = NULL,
      event_date = COALESCE((ev.event_at AT TIME ZONE 'Europe/Paris')::date, wi.event_date),
      updated_at = now()
    FROM era_events ev WHERE ev.id = wi.event_id AND ev.id = $1`, [eventId])
}

// A fancall order in an era gets a Fancall event (once). Returns true when the order is covered by
// the new system (so the caller doesn't create an archive fancall row).
export async function ensureFancallEventForOrder(orderId: string, shopId: string | null, userId: string | null): Promise<boolean> {
  await ensureEventsSchema()
  const o = await queryOne<any>(`SELECT era_id::text AS era_id, shop_id::text AS shop_id FROM orders WHERE id::text = $1`, [orderId])
  if (!o?.era_id) return false
  const existing = await queryOne<any>(`SELECT id FROM era_events WHERE order_id = $1 AND type = 'fancall'`, [orderId])
  if (!existing) {
    await query(`INSERT INTO era_events (era_id, type, order_id, shop_id, created_by) VALUES ($1, 'fancall', $2, $3, $4)`,
      [o.era_id, orderId, shopId || o.shop_id || null, userId])
  }
  return true
}
