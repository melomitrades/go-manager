import { query, queryOne } from './db'
import { winnerItemIdsForShipment, winnerChecklistLines, ensureWinnerItemsSchema } from './winnerItems'

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

  // Claim-member override (added after the initial rework): while packing, the GOM can swap the
  // member a joiner's claim ends up being packed as — e.g. the joiner claimed Karina but not
  // enough copies were bought to guarantee it. This lives ONLY on the checklist row: the order's
  // own claim (order_items.member_id) is never touched, so Boxes/weights/inclusions keep reading
  // the original, and the original is always recoverable. `original_member_id` snapshots what the
  // joiner claimed at override time so the trace survives even if the order is edited later.
  await Promise.all([
    query(`ALTER TABLE shipment_items ADD COLUMN IF NOT EXISTS override_member_id UUID REFERENCES members(id) ON DELETE SET NULL`),
    query(`ALTER TABLE shipment_items ADD COLUMN IF NOT EXISTS original_member_id UUID REFERENCES members(id) ON DELETE SET NULL`),
    query(`ALTER TABLE shipment_items ADD COLUMN IF NOT EXISTS override_reason TEXT`),
    query(`ALTER TABLE shipment_items ADD COLUMN IF NOT EXISTS overridden_at TIMESTAMPTZ`),
    // Leftover marker from lost claims (see src/lib/lostClaims.ts) — the checklist queries below
    // filter on it, so it has to exist before they run, whichever module migrates first.
    query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS lost_claim_id UUID`),
    // Claim-member override now lives on the CLAIM itself (one shared change, set from the
    // Orders detail panel or from the packing wizard). member_id stays the joiner's original
    // claim; override_member_id is what actually gets packed. Leftover maths (Albums Bought,
    // guaranteed slots) count the overridden member.
    query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS override_member_id UUID REFERENCES members(id) ON DELETE SET NULL`),
    query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS override_reason TEXT`),
    query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS overridden_at TIMESTAMPTZ`),
  ]).catch(err => console.error('[shipments migration]', err))

  // Carry over overrides made while packing before they moved to order_items (shipment_items
  // columns above are kept for history but no longer read). Only fills claims without one yet.
  await query(`
    UPDATE order_items oi SET override_member_id = si.override_member_id, override_reason = si.override_reason, overridden_at = si.overridden_at
    FROM shipment_items si
    WHERE si.source_type = 'order_item' AND si.source_id = oi.id AND si.override_member_id IS NOT NULL AND oi.override_member_id IS NULL
  `).catch(err => console.error('[shipments migration] override carry-over', err))
}

// Statuses after which the physical package is gone / done, so a claim can no longer be changed.
const OVERRIDE_LOCKED_STATUSES = ['shipped', 'complete']

// Set (or clear, when memberId is null / equals the original claim) which member a claimed order
// item is actually packed as. Stored on the claim itself, so the Orders detail panel and the
// packing wizard always show the same change. Returns { ok } or { error, status }.
export async function setOrderItemOverride(orderItemId: string, memberId: string | null, reason: string | null) {
  await ensureShipmentsSchema()
  const item = await queryOne<any>(
    `SELECT oi.id, oi.member_id AS claimed_member_id, oi.joiner_id, o.group_id
     FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id=$1`,
    [orderItemId]
  )
  if (!item) return { error: 'Claim not found', status: 404 }
  const shipped = await queryOne<any>(
    `SELECT 1 AS x FROM shipment_items si JOIN shipments sh ON sh.id = si.shipment_id
     WHERE si.source_type='order_item' AND si.source_id=$1 AND sh.status = ANY($2::text[]) LIMIT 1`,
    [orderItemId, OVERRIDE_LOCKED_STATUSES]
  )
  if (shipped) return { error: 'This claim was already shipped — it can no longer be changed', status: 400 }

  if (!memberId || memberId === item.claimed_member_id) {
    await query(`UPDATE order_items SET override_member_id=NULL, override_reason=NULL, overridden_at=NULL WHERE id=$1`, [orderItemId])
    return { ok: true, cleared: true }
  }
  const member = await queryOne<any>('SELECT id, group_id FROM members WHERE id=$1', [memberId])
  if (!member) return { error: 'Member not found', status: 404 }
  if (item.group_id && member.group_id !== item.group_id) return { error: "That member isn't in this order's group", status: 400 }

  await query(
    `UPDATE order_items SET override_member_id=$1, override_reason=$2, overridden_at=now() WHERE id=$3`,
    [memberId, reason || null, orderItemId]
  )
  if (item.joiner_id) {
    await query(`INSERT INTO notifications (user_id, order_id, message)
      SELECT $1, oi.order_id, 'Your GOM changed one of your claims (not enough copies to guarantee it). See My Orders.' FROM order_items oi WHERE oi.id=$2`,
      [item.joiner_id, orderItemId]).catch(() => {})
  }
  return { ok: true, cleared: false }
}

// Packing wizard entry point: a checklist row id → its claim.
export async function setClaimOverride(shipmentId: string, shipmentItemId: string, memberId: string | null, reason: string | null) {
  await ensureShipmentsSchema()
  const item = await queryOne<any>(
    `SELECT si.source_type, si.source_id FROM shipment_items si WHERE si.id=$1 AND si.shipment_id=$2`,
    [shipmentItemId, shipmentId]
  )
  if (!item) return { error: 'Checklist item not found', status: 404 }
  if (item.source_type !== 'order_item') return { error: 'Only claimed order items can be overridden', status: 400 }
  return setOrderItemOverride(item.source_id, memberId, reason)
}

// Every active claim change on a joiner's claims, for the joiner-facing warnings (Shipping
// banner per shipment, Orders badge, Deadlines notice). shipment_id is set when the claim is on
// one of the joiner's shipments' packing lists.
export async function getJoinerClaimOverrides(joinerId: string) {
  await ensureShipmentsSchema()
  return query<any>(`
    SELECT DISTINCT ON (oi.id) oi.id, sh.id AS shipment_id, oi.override_reason, oi.overridden_at,
      sh.status AS shipment_status, f.title AS form_title,
      o.id AS order_id, o.round_number, s.name AS shop_name,
      oi.description AS item_label,
      cm.name AS original_member_name,
      nm.name AS new_member_name
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN shops s ON s.id = o.shop_id
    LEFT JOIN members cm ON cm.id = oi.member_id
    LEFT JOIN members nm ON nm.id = oi.override_member_id
    LEFT JOIN shipment_items si ON si.source_type = 'order_item' AND si.source_id = oi.id
    LEFT JOIN shipments sh ON sh.id = si.shipment_id AND sh.joiner_id = $1
    LEFT JOIN shipping_forms f ON f.id = sh.form_id
    WHERE COALESCE(oi.joiner_id, o.personal_joiner_id) = $1 AND oi.override_member_id IS NOT NULL AND oi.lost_claim_id IS NULL
    ORDER BY oi.id, sh.created_at DESC NULLS LAST
  `, [joinerId]).catch(() => [] as any[])
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
  // Sold / given winner items count too (see src/lib/winnerItems.ts).
  if ((await winnerItemIdsForShipment(joinerId, boxIds)).length > 0) return true
  const row = await queryOne<{ found: boolean }>(`
    SELECT (
      EXISTS (
        SELECT 1 FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN box_orders bo ON bo.order_id = o.id
        WHERE bo.box_id = ANY($2::uuid[])
          AND COALESCE(oi.joiner_id, o.personal_joiner_id) = $1
          AND oi.lost_claim_id IS NULL
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
  await ensureWinnerItemsSchema()
  if (boxIds.length === 0) {
    // A form with no boxes selected covers nothing — drop any checklist rows left over from
    // when it still had some, instead of leaving them behind.
    await query('DELETE FROM shipment_items WHERE shipment_id=$1', [shipmentId]).catch(() => {})
    return
  }

  const [orderItems, pcAssignments] = await Promise.all([query<any>(`
    SELECT oi.id
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN box_orders bo ON bo.order_id = o.id
    WHERE bo.box_id = ANY($1::uuid[])
      AND o.status = 'at_gom'
      AND COALESCE(oi.joiner_id, o.personal_joiner_id) = $2
      AND oi.lost_claim_id IS NULL
  `, [boxIds, joinerId]).catch(() => [] as any[]),

  // Only pull in sorted photocards once the GOM has LOCKED the sorting session's results
  // (pc_sorting_sessions.locked_at) — the same "this is final, ready to physically deal with"
  // gate the order_items query above applies via o.status='at_gom'. Before a session is locked,
  // the GOM can still rerun the sort — which deletes every pc_assignments row for that session
  // and reinserts fresh ones with brand-new ids — or hand-edit quantities/inclusions. Pulling
  // assignments into a packing checklist before that settles is what produced "ghost" sorted
  // items: an item added to the checklist (and maybe already confirmed) from a sort that was
  // later rerun, left behind once the rerun produced a different id for what was conceptually
  // the same item.
  query<any>(`
    SELECT a.id
    FROM pc_assignments a
    JOIN pc_sorting_sessions s ON s.id = a.session_id
    WHERE s.box_id = ANY($1::uuid[]) AND a.joiner_id = $2 AND s.locked_at IS NOT NULL
  `, [boxIds, joinerId]).catch(() => [] as any[])])

  const validOrderItemIds = orderItems.map(r => r.id)
  const validPcAssignmentIds = pcAssignments.map(r => r.id)
  // Winner items sold / given to this joiner, in these boxes and at the GOM (src/lib/winnerItems.ts).
  const validWinnerIds = await winnerItemIdsForShipment(joinerId, boxIds)

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
         OR (source_type = 'winner_item' AND NOT (source_id::text = ANY($4::text[])))
       )`,
    [shipmentId, validOrderItemIds, validPcAssignmentIds, validWinnerIds]
  ).catch(err => console.error('[shipments prune]', err))

  const rows: { source_type: string; source_id: string }[] = [
    ...orderItems.map(r => ({ source_type: 'order_item', source_id: r.id })),
    ...pcAssignments.map(r => ({ source_type: 'pc_assignment', source_id: r.id })),
    ...validWinnerIds.map(id => ({ source_type: 'winner_item', source_id: id })),
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
  const [allItems, formBoxRows] = await Promise.all([
    query<any>('SELECT * FROM shipment_items WHERE shipment_id=$1 ORDER BY created_at', [shipmentId]),
    query<{ box_id: string }>(
      'SELECT box_id FROM shipping_form_boxes WHERE form_id = (SELECT form_id FROM shipments WHERE id=$1)', [shipmentId]
    ).catch(() => [] as any[]),
  ])
  const boxIds: string[] = formBoxRows.map((r: any) => r.box_id)
  if (allItems.length === 0) return { items: [] as any[], previewImages: {} as Record<string, string> }
  // `items` is narrowed below (after the source queries) to rows that are actually inside this
  // shipping form's selected boxes — see the box-scope comment further down.
  let items = allItems

  const orderItemIds = allItems.filter(i => i.source_type === 'order_item').map(i => i.source_id)
  const pcAssignmentIds = allItems.filter(i => i.source_type === 'pc_assignment').map(i => i.source_id)
  const winnerIds = allItems.filter(i => i.source_type === 'winner_item').map(i => String(i.source_id))
  const shipmentJoiner = winnerIds.length ? await queryOne<any>('SELECT joiner_id FROM shipments WHERE id=$1', [shipmentId]) : null
  const winnerLines = winnerIds.length && shipmentJoiner
    ? await winnerChecklistLines(winnerIds, boxIds, String(shipmentJoiner.joiner_id)).catch(err => { console.error('[winner checklist]', err?.message); return [] as any[] })
    : []
  const winnerById = new Map(winnerLines.map(l => [l.id, l]))

  // One parallel round for everything the checklist needs. NOTE: preview images are deliberately
  // NOT selected here — preview_image_url is a multi-MB base64 blob, and this query used to pull
  // it once per order ITEM row (so N claims from one order = N copies) and ship it all to the
  // browser before the wizard could render anything. Now we only ask whether an order HAS one
  // (`has_preview`); the wizard loads the actual image lazily, one step at a time, from
  // GET /api/orders/[id]/preview (browser-cached).
  const [orderRows, pcRows, groupMemberRows] = await Promise.all([
    orderItemIds.length ? query<any>(`
      SELECT oi.id, oi.description, oi.item_type, oi.amount_claimed, oi.price_eur, oi.version_name,
        oi.member_id as claimed_member_id, o.group_id,
        oi.override_member_id, oi.override_reason, om.name as override_member_name,
        m.name as member_name, o.id as order_id, o.round_number,
        (o.preview_image_url IS NOT NULL AND o.preview_image_url <> '') AS has_preview,
        s.name as shop_name, g.name as group_name
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN members m ON m.id = oi.member_id
      LEFT JOIN members om ON om.id = oi.override_member_id
      LEFT JOIN shops s ON s.id = o.shop_id
      LEFT JOIN groups g ON g.id = o.group_id
      WHERE oi.id = ANY($1::uuid[])
        AND EXISTS (SELECT 1 FROM box_orders bo WHERE bo.order_id = o.id AND bo.box_id = ANY($2::uuid[]))
    `, [orderItemIds, boxIds]).catch(() => [] as any[]) : Promise.resolve([] as any[]),
    pcAssignmentIds.length ? query<any>(`
      SELECT a.id, a.pack_id, a.is_repeat, a.is_random, a.is_guaranteed,
        pk.name as pack_name, it.name as item_name, COALESCE(m.name, u.name) as member_name
      FROM pc_assignments a
      JOIN pc_sorting_sessions s ON s.id = a.session_id
      LEFT JOIN pc_packs pk ON pk.id = a.pack_id
      LEFT JOIN pc_items it ON it.id = a.item_id
      LEFT JOIN members m ON m.id = a.member_id
      LEFT JOIN pc_item_units u ON u.id = a.member_id
      WHERE a.id = ANY($1::uuid[]) AND s.box_id = ANY($2::uuid[])
    `, [pcAssignmentIds, boxIds]).catch(() => [] as any[]) : Promise.resolve([] as any[]),
    // Group rosters for the "change claim" dropdown (via subquery so it needn't wait on orderRows).
    orderItemIds.length ? query<any>(`
      SELECT id, name, group_id FROM members
      WHERE group_id IN (
        SELECT o.group_id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = ANY($1::uuid[])
      )
      ORDER BY sort_order, name
    `, [orderItemIds]).catch(() => [] as any[]) : Promise.resolve([] as any[]),
  ])

  const orderById = new Map(orderRows.map(r => [r.id, r]))
  const pcById = new Map(pcRows.map(r => [r.id, r]))

  // Box scope, enforced at READ time: a checklist row only shows if its order / sorting session
  // sits in one of the boxes this shipping form covers (both source queries above filter on the
  // form's boxes). Stale rows — e.g. left over from before the GOM removed a box from the form,
  // or from a since-deleted assignment — are simply never displayed, instead of relying solely
  // on buildShipmentItems having pruned them first.
  items = allItems.filter(it => it.source_type === 'order_item' ? orderById.has(it.source_id)
    : it.source_type === 'winner_item' ? winnerById.has(String(it.source_id))
    : pcById.has(it.source_id))
  if (items.length === 0) return { items: [] as any[], previewImages: {} as Record<string, string> }


  // Claimed order items are grouped BY ORDER: one checklist step per order, listing every claimed
  // line the joiner has in it (e.g. 3 POBs from the same order show up together in one pop-up
  // instead of three separate steps). Each line keeps its own shipment_items id so a single line
  // can still have its claim member changed; confirm/skip acts on the whole order step at once via
  // `item_ids`, same as the sorted-photocard pack groups below.
  type OrderGroup = { order_id: string; item_ids: string[]; created_at: any; confirmed_count: number; skipped_count: number; lines: any[]; d0: any }
  const orderGroups = new Map<string, OrderGroup>()
  for (const it of items) {
    if (it.source_type !== 'order_item') continue
    const d = orderById.get(it.source_id)
    const orderId = d?.order_id || `unknown:${it.id}`
    if (!orderGroups.has(orderId)) {
      orderGroups.set(orderId, { order_id: orderId, item_ids: [], created_at: it.created_at, confirmed_count: 0, skipped_count: 0, lines: [], d0: d })
    }
    const g = orderGroups.get(orderId)!
    g.item_ids.push(it.id)
    if (it.confirmed) g.confirmed_count += 1
    if (it.skipped) g.skipped_count += 1
    const overridden = !!d?.override_member_id
    g.lines.push({
      id: it.id,
      label: d?.description || d?.item_type || 'Item',
      version_name: d?.version_name || null,
      // member_name is what should physically be packed: the override when there is one,
      // otherwise the joiner's original claim.
      member_name: (overridden ? d?.override_member_name : null) || d?.member_name || null,
      claimed_member_id: d?.claimed_member_id || null,
      claimed_member_name: d?.member_name || null,
      override_member_id: d?.override_member_id || null,
      override_reason: d?.override_reason || null,
      group_members: groupMemberRows.filter((m: any) => m.group_id === d?.group_id).map((m: any) => ({ id: m.id, name: m.name })),
      amount_claimed: d?.amount_claimed || 1,
      price_eur: d?.price_eur || null,
    })
  }

  const orderOut = [...orderGroups.values()].map(g => {
    const d = g.d0
    const total = g.item_ids.length
    return {
      id: `order:${g.order_id}`, source_type: 'order_item_group', item_ids: g.item_ids,
      confirmed: total > 0 && g.confirmed_count === total,
      skipped: total > 0 && g.skipped_count === total,
      label: [d?.shop_name, d?.round_number ? `#${d.round_number}` : null].filter(Boolean).join(' ') || 'Order',
      member_name: null,
      sub_label: [d?.group_name, `${total} claimed item${total === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
      lines: g.lines,
      amount_claimed: total,
      price_eur: null,
      order_id: d?.order_id || null,
      has_preview: !!d?.has_preview,
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
    // Group by the pack's NAME (trimmed, case-insensitive), not its id: every PC Sorter session
    // creates its own pc_packs rows, so "Ver. A" from two different sessions are two different
    // pack ids that are physically the same album version and should be handed over together.
    // Falls back to the pack id when a pack somehow has no name.
    const nameKey = (d?.pack_name || '').trim().toLowerCase().replace(/\s+/g, ' ')
    const packId = nameKey ? `name:${nameKey}` : (d?.pack_id || 'unknown')
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

  // Winner items: one step for all of them, after claimed items and sorted photocards.
  const winnerRows = items.filter(it => it.source_type === 'winner_item')
  const winnerOut = winnerRows.length ? [{
    id: 'winner', source_type: 'winner_item_group', item_ids: winnerRows.map(r => r.id),
    confirmed: winnerRows.every(r => r.confirmed),
    skipped: winnerRows.every(r => r.skipped),
    label: '🏆 Winner items',
    member_name: null,
    sub_label: `${winnerRows.length} winner item${winnerRows.length === 1 ? '' : 's'}`,
    lines: winnerRows.map(r => ({ ...winnerById.get(String(r.source_id)), id: r.id, winner_item_id: String(r.source_id) })),
    amount_claimed: winnerRows.length,
    price_eur: null, order_id: null, has_preview: false,
  }] : []

  // previewImages is kept (empty) so existing consumers don't break — images load lazily now.
  return { items: [...orderOut, ...pcOut, ...winnerOut], previewImages: {} as Record<string, string> }
}
