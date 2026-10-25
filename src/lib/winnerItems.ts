import { query, queryOne } from './db'

// ============================================================
// WINNER ITEMS
//
// Physical items won through events (fansign, fancall, DIY event, lucky draw, VCE, POB event…):
// polaroids, signed PCs, or any custom type. ONE ROW PER PHYSICAL ITEM, because each one can be
// kept or sold separately ("Duplicate ×N" makes entering identical ones quick).
//
// Every item belongs to an ERA (required). It can also be linked to ONE order of that era (and,
// optionally, to a part of it: a version / VCE / Fansign section — same keys as eraAlbums.ts).
// When an order is linked, the item's era always follows the order's era (self-healed on read).
//
// EVENTS: every new item belongs to a WON event (src/lib/events.ts) and takes its era, order, source
// and event date from it. Items created before events existed have no event_id: they're the ARCHIVE
// and keep their own order / source / fancall / date fields (still editable).
//
// Lifecycle (status):  won → received → listed → kept | sold | given | missing
//   kept   → kept_by: a GOM/admin profile
//   sold   → recipient_id (any user) + sale price (€ and/or ₩) + sale date. Tracking only: no joiner
//            payment is created and it never counts in GOM payments coverage.
//   given  → recipient_id (any user)
//
// Joiner visibility: the recipient of a SOLD or GIVEN item sees it on My Orders (and in that
// order's detail) with type, members, source + date, version, photo, price paid and the order.
// GOM notes, kept_by and other people's items are never sent to joiners.
//
// Shipping: a sold/given item goes into the recipient's packing checklist ("🏆 Winner items" step,
// after claimed items and sorted photocards) when it's in one of the form's boxes — through its
// order (box_orders), or, for items without an order, through ship_box_id — AND it's physically
// at the GOM: the linked order is At GOM, or the item has a received date.
//
// Item types: two built-in (polaroid, signed_pc), plus custom ones in a shared list (rename /
// archive). Archived types stay on existing items but aren't offered for new ones.
//
// Id columns are TEXT with ::text comparisons (no FKs), like eras / era albums.
// ============================================================

export const WINNER_STATUSES = ['won', 'received', 'listed', 'kept', 'sold', 'given', 'missing'] as const
export type WinnerStatus = typeof WINNER_STATUSES[number]
export const WINNER_STATUS_LABELS: Record<WinnerStatus, string> = {
  won: 'Won (pending)', received: 'Received', listed: 'Listed for sale', kept: 'Kept', sold: 'Sold', given: 'Given away', missing: 'Missing',
}

export const WINNER_SOURCES = ['fansign', 'fancall', 'diy_event', 'lucky_draw', 'vce', 'pob_event', 'other'] as const
export type WinnerSource = typeof WINNER_SOURCES[number]
export const WINNER_SOURCE_LABELS: Record<WinnerSource, string> = {
  fansign: 'Fansign', fancall: 'Fancall', diy_event: 'DIY event', lucky_draw: 'Lucky draw', vce: 'VCE', pob_event: 'POB / pre-order event', other: 'Other',
}

// Statuses where the item goes to someone (recipient visible + shipped).
export const HANDED_OVER: WinnerStatus[] = ['sold', 'given']

let schemaPromise: Promise<void> | null = null
export function ensureWinnerItemsSchema() {
  if (!schemaPromise) schemaPromise = migrate().catch(err => { schemaPromise = null; throw err })
  return schemaPromise
}
async function migrate() {
  // Dynamic import: eraAlbums → lostClaims → shipments → winnerItems would otherwise be a cycle.
  const { ensureEraAlbumsSchema } = await import('./eraAlbums')
  await ensureEraAlbumsSchema()
  const stmts = [
    `CREATE TABLE IF NOT EXISTS winner_item_types (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name TEXT NOT NULL,
      builtin BOOLEAN NOT NULL DEFAULT false,
      archived BOOLEAN NOT NULL DEFAULT false,
      sort_order INTEGER NOT NULL DEFAULT 100,
      created_at TIMESTAMPTZ DEFAULT now()
    )`,
    `INSERT INTO winner_item_types (id, name, builtin, sort_order) VALUES ('polaroid', 'Polaroid', true, 0), ('signed_pc', 'Signed PC', true, 1)
     ON CONFLICT (id) DO NOTHING`,
    `CREATE TABLE IF NOT EXISTS winner_items (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      era_id TEXT NOT NULL,
      order_id TEXT,
      order_section TEXT,
      type_id TEXT NOT NULL,
      member_ids JSONB NOT NULL DEFAULT '[]',
      version_id TEXT,
      source TEXT NOT NULL,
      source_label TEXT,
      fancall_id TEXT,
      event_date DATE,
      received_date DATE,
      status TEXT NOT NULL DEFAULT 'won',
      kept_by TEXT,
      recipient_id TEXT,
      sale_price_eur NUMERIC(10,2),
      sale_price_krw NUMERIC(12,0),
      sale_date DATE,
      ship_box_id TEXT,
      photo_url TEXT,
      note TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_winner_items_era ON winner_items(era_id)`,
    `CREATE INDEX IF NOT EXISTS idx_winner_items_order ON winner_items(order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_winner_items_recipient ON winner_items(recipient_id)`,
    // Events (src/lib/events.ts): new items belong to an event. Items without one are the archive.
    `ALTER TABLE winner_items ADD COLUMN IF NOT EXISTS event_id TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_winner_items_event ON winner_items(event_id)`,
    // "Lost" now means an event we didn't win; a physically lost item is "Missing".
    `UPDATE winner_items SET status = 'missing' WHERE status = 'lost'`,
  ]
  for (const sql of stmts) {
    await query(sql).catch(err => console.error('[winner-items migration]', sql.slice(0, 60), err?.message))
  }
}

const parseJson = (v: any) => {
  if (v == null) return null
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch { return null }
}

// Items linked to an order follow that order's era (an order can be moved to another era).
export async function syncWinnerEras() {
  await query(`UPDATE winner_items wi SET era_id = o.era_id::text
               FROM orders o WHERE o.id::text = wi.order_id AND o.era_id IS NOT NULL AND o.era_id::text <> wi.era_id`).catch(() => {})
}

// Base select: every display field, never the photo itself (base64, loaded from /api/winner-items/[id]/photo).
const SELECT = `
  SELECT wi.id, wi.event_id, wi.era_id, wi.order_id, wi.order_section, wi.type_id, wi.member_ids, wi.version_id,
    wi.source, wi.source_label, wi.fancall_id, wi.event_date::text AS event_date, wi.received_date::text AS received_date, wi.status,
    wi.kept_by, wi.recipient_id, wi.sale_price_eur, wi.sale_price_krw, wi.sale_date::text AS sale_date, wi.ship_box_id,
    (wi.photo_url IS NOT NULL AND wi.photo_url <> '') AS has_photo, wi.note, wi.created_at, wi.updated_at,
    t.name AS type_name,
    e.name AS era_name, e.group_id AS era_group_id,
    v.name AS version_name,
    o.round_number AS order_round, o.status::text AS order_status, s.name AS order_shop_name,
    COALESCE(kp.display_name, kp.username) AS kept_by_name,
    COALESCE(rp.display_name, rp.username) AS recipient_name, rp.role::text AS recipient_role,
    b.label AS ship_box_label,
    ev.type AS event_type, ev.type_label AS event_type_label, ev.result AS event_result,
    (ev.event_at AT TIME ZONE 'Europe/Paris')::date::text AS event_day, evs.name AS event_shop_name
  FROM winner_items wi
  LEFT JOIN winner_item_types t ON t.id = wi.type_id
  LEFT JOIN eras e ON e.id::text = wi.era_id
  LEFT JOIN era_versions v ON v.id::text = wi.version_id
  LEFT JOIN orders o ON o.id::text = wi.order_id
  LEFT JOIN shops s ON s.id::text = o.shop_id::text
  LEFT JOIN profiles kp ON kp.id::text = wi.kept_by
  LEFT JOIN profiles rp ON rp.id::text = wi.recipient_id
  LEFT JOIN boxes b ON b.id::text = wi.ship_box_id
  LEFT JOIN era_events ev ON ev.id = wi.event_id
  LEFT JOIN shops evs ON evs.id::text = ev.shop_id
`

// A stored row as-is (dates as YYYY-MM-DD text), for updates.
export async function getRawWinnerItem(id: string) {
  return queryOne<any>(`SELECT id, event_id, era_id, order_id, order_section, type_id, member_ids, version_id, source, source_label, fancall_id,
      event_date::text AS event_date, received_date::text AS received_date, status, kept_by, recipient_id,
      sale_price_eur, sale_price_krw, sale_date::text AS sale_date, ship_box_id, note
    FROM winner_items WHERE id = $1`, [id])
}

// Attach member names, and drop dangling order links (deleted order) from the result.
async function decorate(rows: any[]) {
  const ids = Array.from(new Set(rows.flatMap(r => (parseJson(r.member_ids) || []) as string[])))
  const members = ids.length ? await query<any>(`SELECT id::text AS id, name FROM members WHERE id::text = ANY($1::text[])`, [ids]).catch(() => [] as any[]) : []
  const nameById = new Map(members.map(m => [m.id, m.name]))
  return rows.map(r => {
    const member_ids: string[] = parseJson(r.member_ids) || []
    const orderGone = r.order_id && r.order_status == null
    return {
      ...r,
      order_id: orderGone ? null : r.order_id,
      order_section: orderGone ? null : r.order_section,
      member_ids,
      member_names: member_ids.map(id => nameById.get(id)).filter(Boolean),
      sale_price_eur: r.sale_price_eur != null ? parseFloat(r.sale_price_eur) : null,
      sale_price_krw: r.sale_price_krw != null ? parseFloat(r.sale_price_krw) : null,
    }
  })
}

export function sourceText(r: { source: string; source_label?: string | null }) {
  if (r.source === 'other') return r.source_label || 'Other'
  return WINNER_SOURCE_LABELS[r.source as WinnerSource] || r.source
}

async function ensureEvents() {
  const { ensureEventsSchema } = await import('./events')
  await ensureEventsSchema()
}

export async function listWinnerItems(where: { eraId?: string; orderId?: string; recipientId?: string }) {
  await ensureWinnerItemsSchema()
  await ensureEvents()
  await syncWinnerEras()
  const conds: string[] = []
  const params: any[] = []
  if (where.eraId) { params.push(where.eraId); conds.push(`wi.era_id = $${params.length}`) }
  if (where.orderId) { params.push(where.orderId); conds.push(`wi.order_id = $${params.length}`) }
  if (where.recipientId) { params.push(where.recipientId); conds.push(`wi.recipient_id = $${params.length} AND wi.status = ANY('{sold,given}'::text[])`) }
  const rows = await query<any>(`${SELECT} ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
    ORDER BY wi.event_date DESC NULLS LAST, wi.created_at DESC`, params)
  const items = await decorate(rows)
  // 📦 / ✉️ / ✅ per item from the Sending Out packing checklist. Dynamic import: shipments.ts
  // already imports this module.
  try {
    const { getPackMarks } = await import('./shipments')
    const marks = await getPackMarks('winner_item', items.map((i: any) => String(i.id)))
    for (const i of items as any[]) i.pack_mark = marks[String(i.id)] || null
  } catch (err: any) { console.error('[winner pack marks]', err?.message) }
  return items
}

export async function getWinnerItem(id: string) {
  await ensureWinnerItemsSchema()
  await ensureEvents()
  const rows = await query<any>(`${SELECT} WHERE wi.id = $1`, [id])
  return rows.length ? (await decorate(rows))[0] : null
}

// What a joiner may see of an item handed over to them.
export function forJoiner(r: any) {
  return {
    id: r.id, type_name: r.type_name, member_names: r.member_names, version_name: r.version_name,
    source: r.source, source_text: sourceText(r), event_date: r.event_date, status: r.status,
    sale_price_eur: r.status === 'sold' ? r.sale_price_eur : null,
    sale_price_krw: r.status === 'sold' ? r.sale_price_krw : null,
    sale_date: r.status === 'sold' ? r.sale_date : null,
    has_photo: r.has_photo, era_name: r.era_name,
    order_id: r.order_id, order_shop_name: r.order_shop_name, order_round: r.order_round,
    pack_mark: r.pack_mark || null,
  }
}

export function totalsOf(items: any[]) {
  const by = (s: string) => items.filter(i => i.status === s).length
  const sold = items.filter(i => i.status === 'sold')
  return {
    count: items.length,
    won: by('won'), received: by('received'), listed: by('listed'), kept: by('kept'),
    sold: sold.length, given: by('given'), missing: by('missing'),
    sold_eur: sold.reduce((s, i) => s + (i.sale_price_eur || 0), 0),
    sold_krw: sold.reduce((s, i) => s + (i.sale_price_krw || 0), 0),
  }
}

// Era id → number of winner items (Eras list cards).
export async function winnerCountsByEra(): Promise<Record<string, number>> {
  await ensureWinnerItemsSchema()
  await syncWinnerEras()
  const rows = await query<any>(`SELECT era_id, COUNT(*)::int AS n FROM winner_items GROUP BY era_id`).catch(() => [] as any[])
  return Object.fromEntries(rows.map(r => [r.era_id, r.n]))
}

// ---------- Shipping ----------

// SQL fragment: winner items for joiner $2 inside boxes $1 (uuid[]) that are at the GOM.
export const WINNER_IN_BOXES_SQL = `
  SELECT wi.id FROM winner_items wi
  LEFT JOIN orders o ON o.id::text = wi.order_id
  WHERE wi.recipient_id = $2::text AND wi.status = ANY('{sold,given}'::text[])
    AND (
      (o.id IS NOT NULL AND EXISTS (SELECT 1 FROM box_orders bo WHERE bo.order_id::text = o.id::text AND bo.box_id::text = ANY($1::text[]))
        AND (o.status::text = 'at_gom' OR wi.received_date IS NOT NULL))
      OR (o.id IS NULL AND wi.ship_box_id = ANY($1::text[]) AND wi.received_date IS NOT NULL)
    )
`

export async function winnerItemIdsForShipment(joinerId: string, boxIds: string[]): Promise<string[]> {
  if (!boxIds.length) return []
  await ensureWinnerItemsSchema()
  const rows = await query<any>(WINNER_IN_BOXES_SQL, [boxIds, joinerId]).catch(err => { console.error('[winner-items shipping]', err?.message); return [] as any[] })
  return rows.map(r => r.id)
}

// Checklist lines for winner items (already box-scoped by the caller's id list).
export async function winnerChecklistLines(ids: string[], boxIds: string[], joinerId: string) {
  if (!ids.length) return [] as any[]
  await ensureEvents()
  const valid = new Set(await winnerItemIdsForShipment(joinerId, boxIds))
  const rows = (await decorate(await query<any>(`${SELECT} WHERE wi.id = ANY($1::text[])`, [ids]))).filter(r => valid.has(r.id))
  return rows.map(r => ({
    id: r.id,
    label: r.type_name || 'Winner item',
    member_name: r.member_names.length ? r.member_names.join(' + ') : 'Not revealed',
    version_name: r.version_name || null,
    source_text: sourceText(r),
    event_date: r.event_date,
    status: r.status,
    has_photo: r.has_photo,
    order_label: r.order_id ? [r.order_shop_name, r.order_round ? `#${r.order_round}` : null].filter(Boolean).join(' ') : null,
  }))
}

// ---------- Validation / save ----------

const dateOrNull = (v: any) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null)
const numOrNull = (v: any) => (v === '' || v == null || isNaN(parseFloat(v)) ? null : Math.max(0, parseFloat(v)))

// Normalise + validate an item payload. `existing` is the stored row when updating.
// Returns { values } (column → value) or { error }.
export async function buildItemValues(b: any, existing: any | null): Promise<{ values?: Record<string, any>; error?: string }> {
  const pick = (k: string) => (b[k] !== undefined ? b[k] : existing ? existing[k] : undefined)

  // Event (new system) → era, order, source, date. Archive items (no event) keep their own fields.
  const eventId: string | null = pick('event_id') || null
  let ev: any = null
  if (eventId) {
    ev = await queryOne<any>(`SELECT id, era_id, order_id, type, type_label, result,
        (event_at AT TIME ZONE 'Europe/Paris')::date::text AS day FROM era_events WHERE id = $1`, [eventId])
    if (!ev) return { error: 'That event no longer exists' }
    if (ev.result === 'lost') return { error: 'That event is marked Lost. Set it to Won first.' }
    if (!ev.day) return { error: "That event has no date. Add it in the Events tab first." }
    if (ev.order_id && !(await queryOne<any>(`SELECT 1 AS x FROM orders WHERE id::text = $1`, [ev.order_id]))) ev.order_id = null
  } else if (!existing || existing.event_id) {
    return { error: 'Pick the event it was won at' }
  }

  // Order → era
  let orderId: string | null = ev ? ev.order_id : (pick('order_id') || null)
  let eraId: string | null = ev ? ev.era_id : (pick('era_id') || null)
  if (orderId && !ev) {
    const o = await queryOne<any>(`SELECT id::text AS id, era_id::text AS era_id FROM orders WHERE id::text = $1`, [orderId])
    if (!o) return { error: 'That order no longer exists' }
    if (!o.era_id) return { error: 'That order is not linked to an era. Link it to an era first.' }
    eraId = o.era_id
  }
  if (!eraId) return { error: 'Pick an era' }
  const era = await queryOne<any>(`SELECT id, group_id FROM eras WHERE id::text = $1`, [eraId])
  if (!era) return { error: 'Era not found' }

  // Type
  const typeId = pick('type_id')
  if (!typeId) return { error: 'Pick an item type' }
  const type = await queryOne<any>(`SELECT id, archived FROM winner_item_types WHERE id = $1`, [typeId])
  if (!type) return { error: 'Item type not found' }
  if (type.archived && (!existing || existing.type_id !== typeId)) return { error: 'That item type is archived' }

  // Members (empty = not revealed yet)
  const rawMembers = pick('member_ids')
  const memberIds: string[] = Array.isArray(rawMembers) ? Array.from(new Set(rawMembers.map(String))) : (parseJson(rawMembers) || [])
  if (memberIds.length && era.group_id) {
    const ok = await query<any>(`SELECT id::text AS id FROM members WHERE id::text = ANY($1::text[]) AND group_id::text = $2`, [memberIds, String(era.group_id)])
    if (ok.length !== memberIds.length) return { error: "Some members aren't in this era's group" }
  }

  // Version (optional, of this era)
  let versionId: string | null = pick('version_id') || null
  if (versionId) {
    const v = await queryOne<any>(`SELECT id FROM era_versions WHERE id::text = $1 AND era_id = $2`, [versionId, eraId])
    if (!v) versionId = null
  }

  // Source + fancall + date
  const source = ev ? ev.type : pick('source')
  if (!WINNER_SOURCES.includes(source)) return { error: 'Pick where it came from' }
  const sourceLabel = source === 'other' ? String((ev ? ev.type_label : pick('source_label')) || '').trim() : ''
  if (source === 'other' && !sourceLabel) return { error: 'Give the source a name' }
  let fancallId: string | null = !ev && source === 'fancall' ? (pick('fancall_id') || null) : null
  let eventDate = ev ? ev.day : dateOrNull(pick('event_date'))
  if (!ev && source === 'fancall') {
    if (!fancallId) return { error: 'Pick the fancall it came from' }
    const fc = await queryOne<any>(`SELECT id::text AS id, (fancall_datetime AT TIME ZONE 'Europe/Paris')::date::text AS day FROM fancalls WHERE id::text = $1`, [fancallId])
    if (!fc) return { error: 'That fancall no longer exists' }
    if (fc.day) eventDate = fc.day
  }
  if (!eventDate) return { error: source === 'fancall' ? 'That fancall has no date. Add it in Fancalls, or pick another source.' : 'Enter the event date' }

  // Status + people
  const status = pick('status') || 'won'
  if (!WINNER_STATUSES.includes(status)) return { error: 'Invalid status' }
  let keptBy: string | null = null, recipientId: string | null = null
  if (status === 'kept') {
    keptBy = pick('kept_by') || null
    if (!keptBy) return { error: 'Pick which GOM keeps it' }
    const p = await queryOne<any>(`SELECT role::text AS role FROM profiles WHERE id::text = $1`, [keptBy])
    if (!p || !['gom', 'admin'].includes(p.role)) return { error: 'Kept by must be a GOM or admin' }
  }
  if (HANDED_OVER.includes(status)) {
    recipientId = pick('recipient_id') || null
    if (!recipientId) return { error: status === 'sold' ? 'Pick who bought it' : 'Pick who it was given to' }
    const p = await queryOne<any>(`SELECT id FROM profiles WHERE id::text = $1`, [recipientId])
    if (!p) return { error: 'User not found' }
  }
  let receivedDate = dateOrNull(pick('received_date'))
  if (!receivedDate && status === 'received' && existing?.status !== 'received') receivedDate = new Date().toISOString().slice(0, 10)

  // Order section (optional, only with an order)
  const section = orderId ? (pick('order_section') || null) : null

  // Box to ship with: only for handed-over items without an order
  let shipBoxId: string | null = !orderId && HANDED_OVER.includes(status) ? (pick('ship_box_id') || null) : null
  if (shipBoxId) {
    const bx = await queryOne<any>(`SELECT id FROM boxes WHERE id::text = $1`, [shipBoxId])
    if (!bx) shipBoxId = null
  }

  const values: Record<string, any> = {
    event_id: eventId,
    era_id: eraId, order_id: orderId, order_section: section, type_id: typeId,
    member_ids: JSON.stringify(memberIds), version_id: versionId,
    source, source_label: sourceLabel || null, fancall_id: fancallId,
    event_date: eventDate, received_date: receivedDate, status,
    kept_by: keptBy, recipient_id: recipientId,
    sale_price_eur: status === 'sold' ? numOrNull(pick('sale_price_eur')) : null,
    sale_price_krw: status === 'sold' ? numOrNull(pick('sale_price_krw')) : null,
    sale_date: status === 'sold' ? (dateOrNull(pick('sale_date')) || new Date().toISOString().slice(0, 10)) : null,
    ship_box_id: shipBoxId,
    note: String(pick('note') || '').trim().slice(0, 2000) || null,
  }
  // Photo: undefined = keep, null/'' = remove, data URL = set
  if (b.photo_url !== undefined) {
    const p = b.photo_url
    if (p && (typeof p !== 'string' || !p.startsWith('data:image/') || p.length > 2_000_000)) return { error: 'Photo is too big or not an image' }
    values.photo_url = p || null
  }
  return { values }
}

// Tell a joiner when an item is newly handed over to them.
export async function notifyRecipient(before: any | null, after: any) {
  if (!after?.recipient_id || !HANDED_OVER.includes(after.status)) return
  if (before && before.recipient_id === after.recipient_id && HANDED_OVER.includes(before.status)) return
  const p = await queryOne<any>(`SELECT role::text AS role FROM profiles WHERE id::text = $1`, [after.recipient_id]).catch(() => null)
  if (!p || p.role !== 'joiner') return
  const what = after.status === 'sold' ? 'bought' : 'received'
  await query(`INSERT INTO notifications (user_id, message) VALUES ($1, $2)`,
    [after.recipient_id, `🏆 You ${what} a winner item (${after.type_name || 'item'}). See My Orders.`]).catch(() => {})
}
