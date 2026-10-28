import { query } from './db'
import { ensureShipmentsSchema } from './shipments'

// ============================================================
// PACKING STATS — per GOM, for the Sending Out › Packing stats page.
//
// Who packed a parcel = the GOM assigned on its shipping FORM (shipping_forms.gom_id), read
// through the form so assigning a GOM to an old form counts all of its past shipments too.
// Shipments on a form without a GOM are grouped under "Not assigned".
//
//  - Volume: parcels in total / packed / shipped / received, joiners served, and the checklist
//    rows confirmed in the Pack wizard (claims, sorted photocards, winner items).
//    "Packed" = status moved past 'pending' (packed → payment → shipped → complete). Resetting
//    packing rolls a shipment back to 'pending', so it stops counting.
//  - Backlog: where the GOM's open parcels sit right now.
//  - Monthly: parcels packed per month over the last 12 months, dated by packed_at (falling back
//    to shipped/completed time for shipments whose status was set by hand without packing).
// ============================================================

export const NO_GOM = '__none__'

export type GomPackingStats = {
  gom_id: string
  gom_name: string
  forms: number
  parcels: number
  packed: number
  shipped: number
  received: number
  joiners: number
  claims: number
  sorted_pcs: number
  winner_items: number
  backlog: { to_pack: number; packed_no_payment: number; awaiting_payment: number; ready_to_ship: number }
}

export async function getPackingStats() {
  await ensureShipmentsSchema()

  const [perGom, items, monthly] = await Promise.all([
    query<any>(`
      SELECT COALESCE(f.gom_id::text, '${NO_GOM}') AS gom_id,
        MAX(COALESCE(gp.display_name, gp.username)) AS gom_name,
        COUNT(DISTINCT f.id)::int AS forms,
        COUNT(sh.id)::int AS parcels,
        COUNT(sh.id) FILTER (WHERE sh.status <> 'pending')::int AS packed,
        COUNT(sh.id) FILTER (WHERE sh.status IN ('shipped','complete'))::int AS shipped,
        COUNT(sh.id) FILTER (WHERE sh.status = 'complete')::int AS received,
        COUNT(DISTINCT sh.joiner_id) FILTER (WHERE sh.status <> 'pending')::int AS joiners,
        COUNT(sh.id) FILTER (WHERE sh.status = 'pending')::int AS to_pack,
        COUNT(sh.id) FILTER (WHERE sh.status = 'packed')::int AS packed_no_payment,
        COUNT(sh.id) FILTER (WHERE sh.status = 'payment_requested')::int AS awaiting_payment,
        COUNT(sh.id) FILTER (WHERE sh.status = 'payment_complete')::int AS ready_to_ship
      FROM shipments sh
      JOIN shipping_forms f ON f.id = sh.form_id
      LEFT JOIN profiles gp ON gp.id = f.gom_id
      GROUP BY 1
    `),
    query<any>(`
      SELECT COALESCE(f.gom_id::text, '${NO_GOM}') AS gom_id, si.source_type, COUNT(*)::int AS n
      FROM shipment_items si
      JOIN shipments sh ON sh.id = si.shipment_id
      JOIN shipping_forms f ON f.id = sh.form_id
      WHERE si.confirmed
      GROUP BY 1, 2
    `),
    query<any>(`
      SELECT COALESCE(f.gom_id::text, '${NO_GOM}') AS gom_id,
        to_char(date_trunc('month', COALESCE(sh.packed_at, sh.shipped_at, sh.completed_at) AT TIME ZONE 'Europe/Paris'), 'YYYY-MM') AS month,
        COUNT(*)::int AS n
      FROM shipments sh
      JOIN shipping_forms f ON f.id = sh.form_id
      WHERE sh.status <> 'pending'
        AND (COALESCE(sh.packed_at, sh.shipped_at, sh.completed_at) AT TIME ZONE 'Europe/Paris') >= date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - interval '11 months'
      GROUP BY 1, 2
    `),
  ])

  const overall = await query<any>(`SELECT COUNT(DISTINCT joiner_id)::int AS n FROM shipments WHERE status <> 'pending'`).catch(() => [] as any[])

  // GOMs with a form but no shipments yet still get a (zero) row, so they show up.
  const formOnly = await query<any>(`
    SELECT f.gom_id::text AS gom_id, MAX(COALESCE(gp.display_name, gp.username)) AS gom_name, COUNT(*)::int AS forms
    FROM shipping_forms f JOIN profiles gp ON gp.id = f.gom_id
    WHERE NOT EXISTS (SELECT 1 FROM shipments sh WHERE sh.form_id = f.id)
    GROUP BY 1
  `).catch(() => [] as any[])

  const byGom = new Map<string, GomPackingStats>()
  const blank = (id: string, name: string): GomPackingStats => ({
    gom_id: id, gom_name: name, forms: 0, parcels: 0, packed: 0, shipped: 0, received: 0, joiners: 0,
    claims: 0, sorted_pcs: 0, winner_items: 0,
    backlog: { to_pack: 0, packed_no_payment: 0, awaiting_payment: 0, ready_to_ship: 0 },
  })
  for (const r of perGom) {
    const g = blank(r.gom_id, r.gom_id === NO_GOM ? 'Not assigned' : (r.gom_name || 'Unknown GOM'))
    Object.assign(g, { forms: r.forms, parcels: r.parcels, packed: r.packed, shipped: r.shipped, received: r.received, joiners: r.joiners })
    g.backlog = { to_pack: r.to_pack, packed_no_payment: r.packed_no_payment, awaiting_payment: r.awaiting_payment, ready_to_ship: r.ready_to_ship }
    byGom.set(r.gom_id, g)
  }
  for (const r of formOnly) {
    const g = byGom.get(r.gom_id) || blank(r.gom_id, r.gom_name || 'Unknown GOM')
    g.forms += r.forms
    byGom.set(r.gom_id, g)
  }
  for (const r of items) {
    const g = byGom.get(r.gom_id)
    if (!g) continue
    if (r.source_type === 'order_item') g.claims += r.n
    else if (r.source_type === 'pc_assignment') g.sorted_pcs += r.n
    else if (r.source_type === 'winner_item') g.winner_items += r.n
  }

  // Assigned GOMs alphabetically, "Not assigned" last.
  const goms = [...byGom.values()].sort((a, b) =>
    (a.gom_id === NO_GOM ? 1 : 0) - (b.gom_id === NO_GOM ? 1 : 0) || a.gom_name.localeCompare(b.gom_name, undefined, { sensitivity: 'base' }))

  // Last 12 months, oldest first, every month present even when empty.
  const months: string[] = []
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }))
  for (let k = 11; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const monthlyOut = months.map(m => ({
    month: m,
    counts: Object.fromEntries(goms.map(g => [g.gom_id, monthly.find(r => r.month === m && r.gom_id === g.gom_id)?.n || 0])),
  }))

  return { goms, monthly: monthlyOut, overall_joiners: overall[0]?.n ?? 0 }
}
