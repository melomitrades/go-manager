import { query, queryOne } from './db'

// ============================================================
// SHIPPING FORMS + SHIPMENTS
//
// Replaces the old single global `sending_out` table/toggle. Shape:
//  - A `shipping_form` is a named, box-scoped submission window a GOM opens
//    (e.g. "FR boxes" covering EMS box FR1 + FR2). Several can be open at once,
//    each covering a different set of boxes.
//  - A `shipment` is one joiner's package for one form — created either by the
//    joiner submitting that form, or by a GOM manual entry. One per
//    (form, joiner) — resubmitting updates the existing row instead of
//    duplicating it.
//  - `shipment_items` is the packing checklist: one row per claimed order_item
//    or sorted pc_assignment that belongs to this joiner within the form's
//    boxes, with a confirmed/skipped flag the "Pack" wizard walks through
//    one at a time. Rows are (re)computed lazily and upserted so opening the
//    wizard again after new claims were added never wipes prior confirmations.
//
// The old `sending_out` table is left in place, untouched and unused — no
// migration of old rows, no more auto-inserts into it (see src/app/api/orders/route.ts).
// ============================================================

export const SHIPMENT_STATUSES = ['pending', 'packed', 'payment_requested', 'payment_complete', 'shipped', 'complete'] as const
export type ShipmentStatus = typeof SHIPMENT_STATUSES[number]

export const SHIPPING_TYPES = ['stamped_letter', 'tracked_letter', 'package', 'inpost_mondial', 'vinted_go', 'vinted'] as const

let shipmentsMigDone = false
export async function ensureShipmentsSchema() {
  if (shipmentsMigDone) return
  shipmentsMigDone = true

  await Promise.all([
    query(`CREATE TABLE IF NOT EXISTS shipping_forms (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      form_open BOOLEAN NOT NULL DEFAULT false,
      deadline TIMESTAMPTZ,
      created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )`).catch(err => console.error('[shipments migration]', err)),
  ])

  await Promise.all([
    query(`CREATE TABLE IF NOT EXISTS shipping_form_boxes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      form_id UUID REFERENCES shipping_forms(id) ON DELETE CASCADE,
      box_id UUID REFERENCES boxes(id) ON DELETE CASCADE,
      UNIQUE(form_id, box_id)
    )`).catch(err => console.error('[shipments migration]', err)),
    query(`CREATE TABLE IF NOT EXISTS shipments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      form_id UUID REFERENCES shipping_forms(id) ON DELETE CASCADE,
      joiner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
      full_name TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      shipping_type TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      price_eur NUMERIC(10,2),
      payment_info TEXT,
      paid BOOLEAN NOT NULL DEFAULT false,
      paid_at TIMESTAMPTZ,
      proof_url TEXT,
      proof_submitted BOOLEAN NOT NULL DEFAULT false,
      proof_submitted_at TIMESTAMPTZ,
      tracking_code TEXT,
      notes TEXT,
      packed_at TIMESTAMPTZ,
      payment_requested_at TIMESTAMPTZ,
      shipped_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(form_id, joiner_id)
    )`).catch(err => console.error('[shipments migration]', err)),
  ])

  await query(`CREATE TABLE IF NOT EXISTS shipment_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_id UUID NOT NULL,
    confirmed BOOLEAN NOT NULL DEFAULT false,
    skipped BOOLEAN NOT NULL DEFAULT false,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(shipment_id, source_type, source_id)
  )`).catch(err => console.error('[shipments migration]', err))
}

export async function getFormBoxIds(formId: string): Promise<string[]> {
  const rows = await query<{ box_id: string }>('SELECT box_id FROM shipping_form_boxes WHERE form_id=$1', [formId])
  return rows.map(r => r.box_id)
}

// Whether a joiner has any At-GOM claim (regular order item or sorted photocard) in any of
// the given boxes — used to scope which open forms a joiner sees, and to let a GOM's manual
// entry know which joiners are actually relevant to a form.
export async function joinerEligibleForBoxes(joinerId: string, boxIds: string[]): Promise<boolean> {
  if (boxIds.length === 0) return false
  const row = await queryOne<{ found: boolean }>(`
    SELECT (
      EXISTS (
        SELECT 1 FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN box_orders bo ON bo.order_id = o.id
        WHERE bo.box_id = ANY($2::uuid[])
          AND COALESCE(oi.joiner_id, o.personal_joiner_id) = $1
      )
      OR EXISTS (
        SELECT 1 FROM pc_assignments a
        JOIN pc_sorting_sessions s ON s.id = a.session_id
        WHERE s.box_id = ANY($2::uuid[]) AND a.joiner_id = $1
      )
    ) AS found
  `, [joinerId, boxIds])
  return !!row?.found
}

// Assemble (and persist, via upsert) the packing checklist for one shipment: every At-GOM
// order_item and every sorted pc_assignment belonging to this shipment's joiner, scoped to
// the shipment's form's boxes. Existing confirmed/skipped state is preserved across calls —
// only genuinely new items get inserted.
export async function buildShipmentItems(shipmentId: string, joinerId: string, boxIds: string[]) {
  await ensureShipmentsSchema()
  if (boxIds.length === 0) return

  const orderItems = await query<any>(`
    SELECT oi.id
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN box_orders bo ON bo.order_id = o.id
    WHERE bo.box_id = ANY($1::uuid[])
      AND o.status = 'at_gom'
      AND COALESCE(oi.joiner_id, o.personal_joiner_id) = $2
  `, [boxIds, joinerId]).catch(() => [] as any[])

  // Only pull in sorted photocards once the GOM has LOCKED the sorting session's results
  // (pc_sorting_sessions.locked_at) — the same "this is final, ready to physically deal with"
  // gate the order_items query above applies via o.status='at_gom'. Before a session is locked,
  // the GOM can still rerun the sort — which deletes every pc_assignments row for that session
  // and reinserts fresh ones with brand-new ids — or hand-edit quantities/inclusions. Pulling
  // assignments into a packing checklist before that settles is what produced "ghost" sorted
  // items: an item added to the checklist (and maybe already confirmed) from a sort that was
  // later rerun, left behind once the rerun produced a different id for what was conceptually
  // the same item.
  const pcAssignments = await query<any>(`
    SELECT a.id
    FROM pc_assignments a
    JOIN pc_sorting_sessions s ON s.id = a.session_id
    WHERE s.box_id = ANY($1::uuid[]) AND a.joiner_id = $2 AND s.locked_at IS NOT NULL
  `, [boxIds, joinerId]).catch(() => [] as any[])

  const validOrderItemIds = orderItems.map(r => r.id)
  const validPcAssignmentIds = pcAssignments.map(r => r.id)

  // Prune any shipment_items row whose source no longer matches the current valid set — the
  // claim was edited/unclaimed, the order moved off At-GOM, or (the case behind the "sorted
  // items" bug) a sort was rerun (or a locked session got unlocked again) after this joiner's
  // assignment was already added to the checklist. This function used to only ever INSERT, so a
  // stale row lingered forever — showing as a blank "Sorted item" once its join target vanished
  // — sitting right alongside the freshly-inserted replacement. Deleting it here means the
  // checklist self-heals the next time it's opened instead of accumulating ghosts.
  await query(
    `DELETE FROM shipment_items
     WHERE shipment_id = $1
       AND (
         (source_type = 'order_item' AND NOT (source_id = ANY($2::uuid[])))
         OR (source_type = 'pc_assignment' AND NOT (source_id = ANY($3::uuid[])))
       )`,
    [shipmentId, validOrderItemIds, validPcAssignmentIds]
  ).catch(err => console.error('[shipments prune]', err))

  const rows: { source_type: string; source_id: string }[] = [
    ...orderItems.map(r => ({ source_type: 'order_item', source_id: r.id })),
    ...pcAssignments.map(r => ({ source_type: 'pc_assignment', source_id: r.id })),
  ]
  if (rows.length === 0) return

  await query(
    `INSERT INTO shipment_items (shipment_id, source_type, source_id)
     SELECT $1, t.source_type, t.source_id
     FROM UNNEST($2::text[], $3::uuid[]) AS t(source_type, source_id)
     ON CONFLICT (shipment_id, source_type, source_id) DO NOTHING`,
    [shipmentId, rows.map(r => r.source_type), rows.map(r => r.source_id)]
  )
}

// Wipe a shipment's packing progress back to a clean slate — every checklist item's
// confirmed/skipped flag cleared. If the shipment had already been finalized as 'packed', its
// status reverts to 'pending' too (packed_at cleared), since a "packed" status is meaningless
// once the confirmations behind it are gone. A shipment further along than that (payment
// requested/complete, shipped, complete) keeps its status untouched — the GOM already has a
// fully free-form status dropdown for those cases, and silently rolling back a shipment that's
// already been paid for or shipped would be more surprising than helpful.
export async function resetShipmentPacking(shipmentId: string) {
  await ensureShipmentsSchema()
  await query(
    `UPDATE shipment_items SET confirmed=false, skipped=false, confirmed_at=NULL WHERE shipment_id=$1`,
    [shipmentId]
  )
  const shipment = await queryOne<any>('SELECT * FROM shipments WHERE id=$1', [shipmentId])
  if (shipment?.status === 'packed') {
    return queryOne(
      `UPDATE shipments SET status='pending', packed_at=NULL, updated_at=now() WHERE id=$1 RETURNING *`,
      [shipmentId]
    )
  }
  return shipment
}

// Full checklist for the Pack wizard: shipment_items joined back out to their display details,
// plus a map of order_id -> preview image (fetched once per distinct order, not per item, since
// preview_image_url is a multi-MB base64 blob).
//
// Claimed order items are returned one step per item, in shipment_items insertion order, exactly
// as before. Sorted photocards are returned AFTER every order item, grouped into one step PER
// ALBUM VERSION (pack) rather than one per individual assignment — a joiner's inclusions for a
// pack are physically handed over together, not counted out one photocard at a time, and
// stepping through every single assignment individually was both tedious and (per
// pc_assignments.id changing on every sort rerun — see buildShipmentItems) the shape of the
// "ghost item" bug. Each group step's `item_ids` carries every underlying shipment_items id it
// represents, so confirming/skipping the step acts on all of them at once; `members` carries one
// entry per distinct (item, member) combination in the pack with a `count`, for a "member pills
// with quantity" display instead of a flat list.
export async function getShipmentChecklist(shipmentId: string) {
  const items = await query<any>('SELECT * FROM shipment_items WHERE shipment_id=$1 ORDER BY created_at', [shipmentId])
  if (items.length === 0) return { items: [] as any[], previewImages: {} as Record<string, string> }

  const orderItemIds = items.filter(i => i.source_type === 'order_item').map(i => i.source_id)
  const pcAssignmentIds = items.filter(i => i.source_type === 'pc_assignment').map(i => i.source_id)

  const [orderRows, pcRows] = await Promise.all([
    orderItemIds.length ? query<any>(`
      SELECT oi.id, oi.description, oi.item_type, oi.amount_claimed, oi.price_eur, oi.version_name,
        m.name as member_name, o.id as order_id, o.round_number, o.preview_image_url,
        s.name as shop_name, g.name as group_name
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN members m ON m.id = oi.member_id
      LEFT JOIN shops s ON s.id = o.shop_id
      LEFT JOIN groups g ON g.id = o.group_id
      WHERE oi.id = ANY($1::uuid[])
    `, [orderItemIds]).catch(() => [] as any[]) : Promise.resolve([] as any[]),
    pcAssignmentIds.length ? query<any>(`
      SELECT a.id, a.pack_id, a.is_repeat, a.is_random, a.is_guaranteed,
        pk.name as pack_name, it.name as item_name, COALESCE(m.name, u.name) as member_name
      FROM pc_assignments a
      JOIN pc_sorting_sessions s ON s.id = a.session_id
      LEFT JOIN pc_packs pk ON pk.id = a.pack_id
      LEFT JOIN pc_items it ON it.id = a.item_id
      LEFT JOIN members m ON m.id = a.member_id
      LEFT JOIN pc_item_units u ON u.id = a.member_id
      WHERE a.id = ANY($1::uuid[])
    `, [pcAssignmentIds]).catch(() => [] as any[]) : Promise.resolve([] as any[]),
  ])

  const orderById = new Map(orderRows.map(r => [r.id, r]))
  const pcById = new Map(pcRows.map(r => [r.id, r]))
  const previewImages: Record<string, string> = {}
  for (const r of orderRows) {
    if (r.preview_image_url && !previewImages[r.order_id]) previewImages[r.order_id] = r.preview_image_url
  }

  const orderOut = items
    .filter(it => it.source_type === 'order_item')
    .map(it => {
      const d = orderById.get(it.source_id)
      return {
        id: it.id, source_type: it.source_type, item_ids: [it.id],
        confirmed: it.confirmed, skipped: it.skipped,
        label: d?.description || d?.item_type || 'Item',
        member_name: d?.member_name || null,
        sub_label: [d?.shop_name, d?.round_number ? `#${d.round_number}` : null, d?.group_name].filter(Boolean).join(' · '),
        amount_claimed: d?.amount_claimed || 1,
        price_eur: d?.price_eur || null,
        order_id: d?.order_id || null,
        has_preview: !!d?.preview_image_url,
      }
    })

  type PcMember = { member_name: string; item_name: string; count: number; is_repeat: boolean; is_random: boolean; is_guaranteed: boolean }
  type PcGroup = {
    pack_id: string; pack_name: string; item_ids: string[]; created_at: any
    confirmed_count: number; skipped_count: number; total: number
    members: Map<string, PcMember>
  }
  const groups = new Map<string, PcGroup>()
  for (const it of items) {
    if (it.source_type !== 'pc_assignment') continue
    const d = pcById.get(it.source_id)
    const packId = d?.pack_id || 'unknown'
    if (!groups.has(packId)) {
      groups.set(packId, {
        pack_id: packId, pack_name: d?.pack_name || 'Sorted items', item_ids: [], created_at: it.created_at,
        confirmed_count: 0, skipped_count: 0, total: 0, members: new Map(),
      })
    }
    const g = groups.get(packId)!
    g.item_ids.push(it.id)
    g.total += 1
    if (it.confirmed) g.confirmed_count += 1
    if (it.skipped) g.skipped_count += 1

    const memberName = d?.member_name || 'Random'
    const itemName = d?.item_name || 'Item'
    const memberKey = `${itemName}|${memberName}|${!!d?.is_repeat}|${!!d?.is_random}|${!!d?.is_guaranteed}`
    if (!g.members.has(memberKey)) {
      g.members.set(memberKey, { member_name: memberName, item_name: itemName, count: 0, is_repeat: !!d?.is_repeat, is_random: !!d?.is_random, is_guaranteed: !!d?.is_guaranteed })
    }
    g.members.get(memberKey)!.count += 1
  }

  const pcOut = [...groups.values()]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map(g => ({
      id: `pack:${g.pack_id}`, source_type: 'pc_assignment_group', item_ids: g.item_ids,
      confirmed: g.total > 0 && g.confirmed_count === g.total,
      skipped: g.total > 0 && g.skipped_count === g.total,
      label: g.pack_name,
      member_name: null,
      sub_label: `${g.total} sorted item${g.total === 1 ? '' : 's'}`,
      members: [...g.members.values()],
      amount_claimed: g.total,
      price_eur: null, order_id: null, has_preview: false,
    }))

  return { items: [...orderOut, ...pcOut], previewImages }
}
