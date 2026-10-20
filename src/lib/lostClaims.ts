import pool, { query } from './db'
import { ensureShipmentsSchema, buildShipmentItems } from './shipments'
import { ensurePcSorterSchema } from './pcSorter'
import { getSlotOptions, openSlotCount, type SlotOption } from './leftoverSlots'
import { randomUUID } from 'crypto'

// ============================================================
// LOST CLAIMS + LEFTOVERS
//
// When a joiner doesn't pay (order payment, EMS, customs or shipping), the GOM can mark some or
// all of that joiner's claims as LOST. One "mark lost" action is a `lost_claim_batches` row:
//
//  - Ownership release (order claims): every picked order_items row keeps existing (so the
//    order's member counts, albums-bought maths, weights etc. still see the physical item) but
//    its joiner_id is cleared and `lost_claim_id` points at a `lost_claims` snapshot. That row is
//    now a LEFTOVER: it no longer belongs to anyone, so it drops out of the joiner's order
//    payment, EMS/customs weight, packing checklist and PC Sorter auto-fill automatically.
//    The order edit form never shows/rewrites leftover rows (see /api/orders PATCH), so their
//    ids stay stable until they're reassigned or restored.
//  - Ownership release (sorted photocards): for every PC Sorter session that counts one of the
//    affected orders, the joiner's inclusions are recomputed WITHOUT the lost claims (same rules
//    as auto-fill). The difference is taken off their pc_pack_inclusions, and for each inclusion
//    removed, one card of every item in that pack is released — the most recently assigned
//    first, or the guaranteed unit card matching a lost version-specific claim. Released cards
//    go back into stock and are recorded in `lost_pc_items` as PC leftovers. Locked sessions are
//    edited in place without unlocking or re-running the sort, so nobody else's results move.
//  - EMS / customs: when the unpaid payment was the EMS share, the joiner is excluded from that
//    box's customs split (and an unpaid customs share is cancelled). A joiner left with no claim
//    at all in a box is fully removed from it the same way. Locked (published) EMS / customs
//    amounts of other joiners are never touched.
//  - Shipping: lost claims fall out of the packing checklist; a shipment left with nothing to
//    pack is flagged (not deleted) and its unpaid shipping payment cancelled.
//
// Every effect is recorded on the batch so "Restore" can undo exactly what this batch did.
// ============================================================

type Q = <T = any>(sql: string, params?: any[]) => Promise<T[]>

export class LostClaimError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}

export type TriggerType = 'order' | 'ems' | 'customs' | 'shipping'
export const TRIGGER_LABELS: Record<TriggerType, string> = {
  order: 'Order payment', ems: 'EMS', customs: 'Customs', shipping: 'Shipping',
}

async function withTx<T>(fn: (q: Q) => Promise<T>, rollback = false): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // One client = one connection: queries issued "in parallel" (Promise.all) inside a
    // transaction must still go out one at a time, so chain them.
    let chain: Promise<unknown> = Promise.resolve()
    const q: Q = (sql, params) => {
      const p = chain.then(() => client.query(sql, params))
      chain = p.catch(() => {})
      return p.then(r => r.rows)
    }
    const result = await fn(q)
    await client.query(rollback ? 'ROLLBACK' : 'COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

// ── Schema ─────────────────────────────────────────────────────────────────────

let lostMigDone = false
export async function ensureLostClaimsSchema() {
  if (lostMigDone) return
  let ok = true
  // Sequential on purpose: several of these CREATE TABLEs add foreign keys to the same parent
  // tables (profiles, orders, boxes…), and running them concurrently deadlocks on a fresh database.
  // This only runs once per cold start, so the extra round trips don't matter.
  const run = async (stmts: string[]) => {
    for (const sql of stmts) {
      await query(sql).catch(err => {
        ok = false
        console.error('[lost-claims migration failed]', sql.slice(0, 80).replace(/\s+/g, ' '), '—', err?.message)
      })
    }
  }

  await ensureShipmentsSchema()
  await ensurePcSorterSchema()

  // Phase 1: tables other modules normally create — repeated here (same definitions, IF NOT
  // EXISTS) so this module never depends on which page happened to load first.
  await run([
    `CREATE TABLE IF NOT EXISTS box_joiner_shares (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      box_id UUID REFERENCES boxes(id) ON DELETE CASCADE,
      joiner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
      ems_paid BOOLEAN DEFAULT false,
      customs_paid BOOLEAN DEFAULT false,
      UNIQUE(box_id, joiner_id)
    )`,
    `CREATE TABLE IF NOT EXISTS box_orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      box_id UUID REFERENCES boxes(id) ON DELETE CASCADE,
      order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
      UNIQUE(box_id, order_id)
    )`,
    `CREATE TABLE IF NOT EXISTS order_joiner_paid (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
      joiner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
      paid BOOLEAN DEFAULT false,
      paid_at TIMESTAMPTZ,
      UNIQUE(order_id, joiner_id)
    )`,
    `CREATE TABLE IF NOT EXISTS lost_claim_batches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      joiner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
      trigger_type TEXT NOT NULL,
      trigger_label TEXT,
      trigger_amount_eur NUMERIC(10,2),
      trigger_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
      trigger_box_id UUID REFERENCES boxes(id) ON DELETE SET NULL,
      trigger_shipment_id UUID REFERENCES shipments(id) ON DELETE SET NULL,
      reason TEXT,
      effects JSONB NOT NULL DEFAULT '{}',
      lost_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
      lost_at TIMESTAMPTZ DEFAULT now(),
      restored_at TIMESTAMPTZ,
      restored_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
      restore_note TEXT
    )`,
  ])

  // Phase 2: columns used by this feature on existing tables, + tables depending on phase 1.
  await run([
    `ALTER TABLE box_joiner_shares ADD COLUMN IF NOT EXISTS ems_amount_eur NUMERIC(10,2)`,
    `ALTER TABLE box_joiner_shares ADD COLUMN IF NOT EXISTS customs_amount_eur NUMERIC(10,2)`,
    `ALTER TABLE box_joiner_shares ADD COLUMN IF NOT EXISTS excluded BOOLEAN DEFAULT false`,
    `ALTER TABLE box_joiner_shares ADD COLUMN IF NOT EXISTS proof_submitted BOOLEAN DEFAULT false`,
    `ALTER TABLE box_joiner_shares ADD COLUMN IF NOT EXISTS customs_proof_submitted BOOLEAN DEFAULT false`,
    // Set when a lost-claims batch cancels this joiner's unpaid EMS / customs share — it stops
    // showing as owed (Payments, Unpaid list) but the locked amount stays on record.
    `ALTER TABLE box_joiner_shares ADD COLUMN IF NOT EXISTS ems_cancelled BOOLEAN DEFAULT false`,
    `ALTER TABLE box_joiner_shares ADD COLUMN IF NOT EXISTS customs_cancelled BOOLEAN DEFAULT false`,
    // Customs-only exclusion (the existing `excluded` flag removes a joiner from BOTH EMS and
    // customs). Set when the joiner lost their claims over an unpaid EMS share, or no longer has
    // any claim in the box: their weight is left out of the customs split.
    `ALTER TABLE box_joiner_shares ADD COLUMN IF NOT EXISTS customs_excluded BOOLEAN DEFAULT false`,
    `ALTER TABLE boxes ADD COLUMN IF NOT EXISTS ems_payment_requested BOOLEAN DEFAULT false`,
    `ALTER TABLE boxes ADD COLUMN IF NOT EXISTS customs_payment_requested BOOLEAN DEFAULT false`,
    `ALTER TABLE boxes ADD COLUMN IF NOT EXISTS ems_deadline TIMESTAMPTZ`,
    `ALTER TABLE boxes ADD COLUMN IF NOT EXISTS customs_deadline TIMESTAMPTZ`,
    `ALTER TABLE order_joiner_paid ADD COLUMN IF NOT EXISTS proof_submitted BOOLEAN DEFAULT false`,
    `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS payment_cancelled BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS lost_claims_note TEXT`,
    `CREATE TABLE IF NOT EXISTS lost_claims (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      batch_id UUID REFERENCES lost_claim_batches(id) ON DELETE CASCADE,
      order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
      original_joiner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
      original_item_joiner_id UUID,
      member_id UUID REFERENCES members(id) ON DELETE SET NULL,
      description TEXT,
      version_name TEXT,
      item_type TEXT,
      price_eur NUMERIC(10,2),
      price_krw NUMERIC(12,0),
      amount_claimed INTEGER NOT NULL DEFAULT 1,
      inclusions_count INTEGER NOT NULL DEFAULT 0,
      claim_group_id TEXT,
      order_was_paid BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'leftover',
      reassigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
      reassigned_at TIMESTAMPTZ,
      reassigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS lost_pc_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      batch_id UUID REFERENCES lost_claim_batches(id) ON DELETE CASCADE,
      session_id UUID REFERENCES pc_sorting_sessions(id) ON DELETE CASCADE,
      pack_id UUID REFERENCES pc_packs(id) ON DELETE CASCADE,
      item_id UUID REFERENCES pc_items(id) ON DELETE CASCADE,
      member_id UUID,
      original_joiner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
      round INTEGER NOT NULL DEFAULT 1,
      was_repeat BOOLEAN NOT NULL DEFAULT false,
      was_random BOOLEAN NOT NULL DEFAULT false,
      was_guaranteed BOOLEAN NOT NULL DEFAULT false,
      sort_method TEXT,
      status TEXT NOT NULL DEFAULT 'leftover',
      reassigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
      reassigned_at TIMESTAMPTZ,
      reassigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
      new_assignment_id UUID,
      created_at TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS lost_pc_inclusions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      batch_id UUID REFERENCES lost_claim_batches(id) ON DELETE CASCADE,
      session_id UUID REFERENCES pc_sorting_sessions(id) ON DELETE CASCADE,
      pack_id UUID REFERENCES pc_packs(id) ON DELETE CASCADE,
      joiner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
      count INTEGER NOT NULL DEFAULT 0
    )`,
  ])

  // Phase 3: depends on lost_claims / lost_pc_items.
  await run([
    `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS lost_claim_id UUID`,
    `CREATE TABLE IF NOT EXISTS leftover_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      joiner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      lost_claim_id UUID REFERENCES lost_claims(id) ON DELETE CASCADE,
      lost_pc_item_id UUID REFERENCES lost_pc_items(id) ON DELETE CASCADE,
      order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
      member_id UUID REFERENCES members(id) ON DELETE SET NULL,
      version_label TEXT,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      gom_note TEXT,
      decided_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
      decided_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_lost_claims_joiner ON lost_claims(original_joiner_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lost_claims_status ON lost_claims(status)`,
    `CREATE INDEX IF NOT EXISTS idx_lost_pc_items_status ON lost_pc_items(status)`,
  ])
  await run([
    `CREATE INDEX IF NOT EXISTS idx_order_items_lost_claim ON order_items(lost_claim_id)`,
    // Open-slot requests: the pricing option the joiner picked (snapshot, so the price they saw
    // is the price they get), and the claim row created when the GOM accepted.
    `ALTER TABLE leftover_requests ADD COLUMN IF NOT EXISTS slot_option JSONB`,
    `ALTER TABLE leftover_requests ADD COLUMN IF NOT EXISTS created_order_item_id UUID`,
    `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS entries_count INTEGER DEFAULT 0`,
    // The column may already have been added (without FK) by shipments.ts / pcSorter.ts.
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_lost_claim_id_fkey') THEN
         ALTER TABLE order_items ADD CONSTRAINT order_items_lost_claim_id_fkey
           FOREIGN KEY (lost_claim_id) REFERENCES lost_claims(id) ON DELETE SET NULL;
       END IF;
     END $$`,
  ])

  // Only remember success — if something failed (e.g. a table another module creates didn't
  // exist yet), try again on the next request instead of staying half-migrated until restart.
  lostMigDone = ok
}

// ── Small helpers ──────────────────────────────────────────────────────────────

function parseArr(v: any): string[] {
  try { if (!v) return []; return Array.isArray(v) ? v : JSON.parse(v) } catch { return [] }
}
function parseObj(v: any): Record<string, string[]> {
  try { if (!v) return {}; return typeof v === 'string' ? JSON.parse(v) : v } catch { return {} }
}
const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase()
const num = (v: any) => (v == null || v === '' ? 0 : parseFloat(v) || 0)

const ORDER_LABEL_SQL = `concat_ws(' · ', g.name, CASE WHEN o.round_number IS NOT NULL AND o.round_number::text <> '' THEN 'R' || o.round_number::text END, s.name)`

// Mirrors autoFillInclusions in pcSorter.ts exactly (explicit inclusions_count counted once per
// claim line via claim_group_id / legacy key, per order; "album" lines one per row), so the
// "before vs after" difference below is exactly what auto-fill would now compute differently.
export function countInclusions(rows: any[], orderIds: string[], orderVersions: Record<string, string[]>): number {
  let total = 0
  for (const oid of orderIds) {
    const versions = Object.prototype.hasOwnProperty.call(orderVersions, oid) ? orderVersions[oid] : null
    const seen = new Set<string>()
    for (const it of rows) {
      if (it.order_id !== oid) continue
      if (versions && !versions.includes(it.version_name)) continue
      const explicit = (parseInt(it.inclusions_count) || 0) > 0
      const amt = explicit
        ? (parseInt(it.inclusions_count) || 0)
        : (/album/i.test(it.description || '') ? (parseInt(it.amount_claimed) || 1) : 0)
      if (amt === 0) continue
      if (explicit) {
        const key = it.claim_group_id ? `cg:${it.claim_group_id}` : `${it.description || ''}|${it.price_eur ?? ''}|${it.version_name || ''}`
        if (seen.has(key)) continue
        seen.add(key)
      }
      total += amt
    }
  }
  return total
}

// Order ids that live in a box (box_orders, falling back to the legacy boxes.order_id).
async function boxOrderIds(q: Q, boxId: string): Promise<string[]> {
  const rows = await q(`SELECT order_id FROM box_orders WHERE box_id=$1`, [boxId])
  if (rows.length) return rows.map((r: any) => r.order_id)
  const b = await q(`SELECT order_id FROM boxes WHERE id=$1`, [boxId]).catch(() => [] as any[])
  return b[0]?.order_id ? [b[0].order_id] : []
}

async function boxesForOrders(q: Q, orderIds: string[]): Promise<any[]> {
  if (!orderIds.length) return []
  return q(`
    SELECT DISTINCT b.id, b.label, b.ems_payment_requested, b.customs_payment_requested
    FROM boxes b
    WHERE b.id IN (SELECT box_id FROM box_orders WHERE order_id = ANY($1::uuid[]))
       OR (b.order_id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM box_orders bo WHERE bo.box_id = b.id))
  `, [orderIds])
}

// ── Unpaid payments ────────────────────────────────────────────────────────────

export interface UnpaidPayment {
  key: string
  type: TriggerType
  joiner_id: string
  joiner_name: string
  label: string
  amount_eur: number
  deadline: string | null
  overdue: boolean
  proof_submitted: boolean
  order_id?: string | null
  box_id?: string | null
  shipment_id?: string | null
}

// Every payment that's currently owed and not validated as paid — order shares, published EMS /
// customs shares, and requested shipping. Cancelled shares (from an earlier lost-claims batch)
// are no longer owed and are left out.
export async function getUnpaidPayments(q: Q, joinerId: string | null = null): Promise<UnpaidPayment[]> {
  const [orders, ems, customs, shipping] = await Promise.all([
    q(`
      SELECT oi.order_id, oi.joiner_id, SUM(oi.price_eur * COALESCE(oi.amount_claimed, 1)) AS amount,
        o.deadline, ${ORDER_LABEL_SQL} AS label,
        COALESCE(p.display_name, p.username) AS joiner_name,
        COALESCE(bool_or(ojp.proof_submitted), false) AS proof_submitted
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN shops s ON s.id = o.shop_id
      LEFT JOIN groups g ON g.id = o.group_id
      LEFT JOIN profiles p ON p.id = oi.joiner_id
      LEFT JOIN order_joiner_paid ojp ON ojp.order_id = oi.order_id AND ojp.joiner_id = oi.joiner_id
      WHERE oi.joiner_id IS NOT NULL AND oi.price_eur > 0
        AND COALESCE(ojp.paid, false) = false
        AND ($1::uuid IS NULL OR oi.joiner_id = $1::uuid)
      GROUP BY oi.order_id, oi.joiner_id, o.deadline, o.created_at, g.name, o.round_number, s.name, p.display_name, p.username
      HAVING SUM(oi.price_eur * COALESCE(oi.amount_claimed, 1)) > 0.009
      ORDER BY o.created_at DESC
    `, [joinerId]).catch(() => [] as any[]),
    q(`
      SELECT bjs.box_id, bjs.joiner_id, bjs.ems_amount_eur AS amount, b.ems_deadline AS deadline, b.label,
        COALESCE(p.display_name, p.username) AS joiner_name, COALESCE(bjs.proof_submitted, false) AS proof_submitted
      FROM box_joiner_shares bjs
      JOIN boxes b ON b.id = bjs.box_id
      LEFT JOIN profiles p ON p.id = bjs.joiner_id
      WHERE b.ems_payment_requested AND bjs.ems_amount_eur > 0.01
        AND NOT COALESCE(bjs.ems_paid, false) AND NOT COALESCE(bjs.ems_cancelled, false)
        AND ($1::uuid IS NULL OR bjs.joiner_id = $1::uuid)
    `, [joinerId]).catch(() => [] as any[]),
    q(`
      SELECT bjs.box_id, bjs.joiner_id, bjs.customs_amount_eur AS amount, b.customs_deadline AS deadline, b.label,
        COALESCE(p.display_name, p.username) AS joiner_name, COALESCE(bjs.customs_proof_submitted, false) AS proof_submitted
      FROM box_joiner_shares bjs
      JOIN boxes b ON b.id = bjs.box_id
      LEFT JOIN profiles p ON p.id = bjs.joiner_id
      WHERE b.customs_payment_requested AND bjs.customs_amount_eur > 0.01
        AND NOT COALESCE(bjs.customs_paid, false) AND NOT COALESCE(bjs.customs_cancelled, false)
        AND ($1::uuid IS NULL OR bjs.joiner_id = $1::uuid)
    `, [joinerId]).catch(() => [] as any[]),
    q(`
      SELECT sh.id AS shipment_id, sh.joiner_id, sh.price_eur AS amount, f.title,
        COALESCE(p.display_name, p.username) AS joiner_name, COALESCE(sh.proof_submitted, false) AS proof_submitted
      FROM shipments sh
      LEFT JOIN shipping_forms f ON f.id = sh.form_id
      LEFT JOIN profiles p ON p.id = sh.joiner_id
      WHERE sh.price_eur > 0 AND NOT COALESCE(sh.paid, false) AND NOT COALESCE(sh.payment_cancelled, false)
        AND ($1::uuid IS NULL OR sh.joiner_id = $1::uuid)
    `, [joinerId]).catch(() => [] as any[]),
  ])

  const now = Date.now()
  const overdue = (d: any) => !!d && new Date(d).getTime() < now
  const out: UnpaidPayment[] = []
  for (const r of orders) out.push({
    key: `order:${r.order_id}:${r.joiner_id}`, type: 'order', joiner_id: r.joiner_id, joiner_name: r.joiner_name || '?',
    label: r.label || 'Order', amount_eur: num(r.amount), deadline: r.deadline, overdue: overdue(r.deadline),
    proof_submitted: !!r.proof_submitted, order_id: r.order_id,
  })
  for (const r of ems) out.push({
    key: `ems:${r.box_id}:${r.joiner_id}`, type: 'ems', joiner_id: r.joiner_id, joiner_name: r.joiner_name || '?',
    label: `${r.label || 'Box'} — EMS`, amount_eur: num(r.amount), deadline: r.deadline, overdue: overdue(r.deadline),
    proof_submitted: !!r.proof_submitted, box_id: r.box_id,
  })
  for (const r of customs) out.push({
    key: `customs:${r.box_id}:${r.joiner_id}`, type: 'customs', joiner_id: r.joiner_id, joiner_name: r.joiner_name || '?',
    label: `${r.label || 'Box'} — Customs`, amount_eur: num(r.amount), deadline: r.deadline, overdue: overdue(r.deadline),
    proof_submitted: !!r.proof_submitted, box_id: r.box_id,
  })
  for (const r of shipping) out.push({
    key: `shipping:${r.shipment_id}:${r.joiner_id}`, type: 'shipping', joiner_id: r.joiner_id, joiner_name: r.joiner_name || '?',
    label: `${r.title || 'Shipment'} — Shipping`, amount_eur: num(r.amount), deadline: null, overdue: false,
    proof_submitted: !!r.proof_submitted, shipment_id: r.shipment_id,
  })
  return out
}

// ── Candidate claims for the "Mark as lost" picker ─────────────────────────────

export type Scope = { order_id?: string | null; box_id?: string | null; shipment_id?: string | null }

async function scopeOrderIds(q: Q, scope: Scope): Promise<string[]> {
  if (scope.order_id) return [scope.order_id]
  if (scope.box_id) return boxOrderIds(q, scope.box_id)
  if (scope.shipment_id) {
    const boxes = await q(`SELECT box_id FROM shipping_form_boxes WHERE form_id = (SELECT form_id FROM shipments WHERE id=$1)`, [scope.shipment_id])
    const ids = new Set<string>()
    for (const b of boxes) for (const oid of await boxOrderIds(q, b.box_id)) ids.add(oid)
    return [...ids]
  }
  return []
}

export async function getLoseCandidates(joinerId: string, scope: Scope) {
  await ensureLostClaimsSchema()
  const q: Q = (sql, params) => query(sql, params)
  const orderIds = await scopeOrderIds(q, scope)

  const [joinerRows, rows, unpaidAll, boxes] = await Promise.all([
    q(`SELECT id, COALESCE(display_name, username) AS name FROM profiles WHERE id=$1`, [joinerId]),
    orderIds.length ? q(`
      SELECT oi.id, oi.order_id, oi.description, oi.version_name, oi.price_eur, oi.amount_claimed, oi.claim_group_id,
        COALESCE(oi.inclusions_count, 0) AS inclusions_count, m.name AS member_name,
        o.status AS order_status, ${ORDER_LABEL_SQL} AS order_label, COALESCE(ojp.paid, false) AS order_paid
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN members m ON m.id = COALESCE(oi.override_member_id, oi.member_id)
      LEFT JOIN shops s ON s.id = o.shop_id
      LEFT JOIN groups g ON g.id = o.group_id
      LEFT JOIN order_joiner_paid ojp ON ojp.order_id = o.id AND ojp.joiner_id = $2
      WHERE oi.order_id = ANY($1::uuid[]) AND oi.lost_claim_id IS NULL
        AND COALESCE(oi.joiner_id, o.personal_joiner_id) = $2
      ORDER BY o.created_at DESC, oi.created_at, m.sort_order NULLS LAST, m.name
    `, [orderIds, joinerId]) : Promise.resolve([] as any[]),
    getUnpaidPayments(q, joinerId),
    boxesForOrders(q, orderIds),
  ])

  // Unpaid payments relevant to what's in scope: the scoped orders' own payments, EMS/customs of
  // any box holding them, and shipping on any shipment whose form covers one of those boxes.
  const boxIds = new Set(boxes.map((b: any) => b.id))
  const shipmentRows = boxIds.size ? await q(`
    SELECT DISTINCT sh.id FROM shipments sh JOIN shipping_form_boxes sfb ON sfb.form_id = sh.form_id
    WHERE sh.joiner_id = $1 AND sfb.box_id = ANY($2::uuid[])
  `, [joinerId, [...boxIds]]) : []
  const shipmentIds = new Set(shipmentRows.map((r: any) => r.id))
  const orderSet = new Set(orderIds)
  const unpaid = unpaidAll.filter(u =>
    (u.type === 'order' && orderSet.has(u.order_id!)) ||
    ((u.type === 'ems' || u.type === 'customs') && boxIds.has(u.box_id!)) ||
    (u.type === 'shipping' && (shipmentIds.has(u.shipment_id!) || u.shipment_id === scope.shipment_id))
  )

  // Group rows into orders → claim lines (one line per claim_group_id, i.e. one line as typed in
  // the order form, possibly exploded into several member rows).
  const byOrder = new Map<string, any>()
  for (const r of rows) {
    if (!byOrder.has(r.order_id)) byOrder.set(r.order_id, { order_id: r.order_id, label: r.order_label || 'Order', status: r.order_status, paid: r.order_paid, lines: new Map<string, any>() })
    const o = byOrder.get(r.order_id)
    const key = r.claim_group_id ? `cg:${r.claim_group_id}` : `legacy:${r.description || ''}|${r.price_eur ?? ''}|${r.version_name || ''}`
    if (!o.lines.has(key)) o.lines.set(key, { key, description: r.description || 'Item', version_name: r.version_name, price_eur: r.price_eur != null ? num(r.price_eur) : null, inclusions_count: parseInt(r.inclusions_count) || 0, rows: [] as any[] })
    o.lines.get(key).rows.push({ id: r.id, member_name: r.member_name, amount_claimed: r.amount_claimed || 1 })
  }

  return {
    joiner: joinerRows[0] || { id: joinerId, name: '?' },
    unpaid,
    orders: [...byOrder.values()].map(o => ({ ...o, lines: [...o.lines.values()] })),
  }
}

// ── Mark lost ──────────────────────────────────────────────────────────────────

export interface MarkLostInput {
  joinerId: string
  orderItemIds: string[]
  triggerKey: string           // an UnpaidPayment.key
  reason?: string | null
  userId: string
  dryRun?: boolean
}

interface PcPlan {
  session: any
  inclDec: Map<string, number>                 // pack_id -> inclusions removed
  releases: any[]                              // pc_assignments rows to release
}

async function planPcRelease(q: Q, joinerId: string, lostRows: any[], lostIds: Set<string>, sessionsCache: any[]): Promise<PcPlan[]> {
  const affectedOrders = new Set(lostRows.map(r => r.order_id))
  const plans: PcPlan[] = []

  for (const session of sessionsCache) {
    const orderIds = parseArr(session.order_ids)
    if (!orderIds.some(id => affectedOrders.has(id))) continue
    const orderVersions = parseObj(session.order_versions)

    const rows = await q(`
      SELECT oi.id, oi.order_id, oi.description, oi.version_name, oi.price_eur, oi.claim_group_id,
        COALESCE(oi.inclusions_count, 0) AS inclusions_count, oi.amount_claimed
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.order_id = ANY($1::uuid[]) AND oi.lost_claim_id IS NULL
        AND COALESCE(oi.joiner_id, o.personal_joiner_id) = $2
    `, [orderIds, joinerId])
    const before = countInclusions(rows, orderIds, orderVersions)
    const after = countInclusions(rows.filter((r: any) => !lostIds.has(r.id)), orderIds, orderVersions)
    let delta = before - after
    if (delta <= 0) continue

    // Version names of lost claims inside this session — used to pick the matching guaranteed
    // unit card first (a version-specific claim's guaranteed ID card set goes with it).
    const lostVersions = new Set(
      lostRows.filter(r => orderIds.includes(r.order_id) && r.version_name).map(r => norm(r.version_name))
    )

    const packs = await q(`SELECT id, name, sort_order FROM pc_packs WHERE session_id=$1 ORDER BY sort_order, created_at`, [session.id])
    if (!packs.length) continue
    const packIds = packs.map((p: any) => p.id)
    const [incl, items, assigns] = await Promise.all([
      q(`SELECT pack_id, inclusions_assigned FROM pc_pack_inclusions WHERE session_id=$1 AND joiner_id=$2`, [session.id, joinerId]),
      q(`SELECT id, pack_id, name, is_unit FROM pc_items WHERE pack_id = ANY($1::uuid[]) ORDER BY sort_order, created_at`, [packIds]),
      q(`
        SELECT a.*, COALESCE(m.name, u.name) AS member_name
        FROM pc_assignments a
        LEFT JOIN members m ON m.id = a.member_id
        LEFT JOIN pc_item_units u ON u.id = a.member_id
        WHERE a.session_id=$1 AND a.joiner_id=$2
        ORDER BY a.created_at DESC, a.round DESC, a.id DESC
      `, [session.id, joinerId]),
    ])

    const inclMap = new Map<string, number>()
    for (const r of incl) inclMap.set(r.pack_id, parseInt(r.inclusions_assigned) || 0)
    const remaining = [...assigns]
    const inclDec = new Map<string, number>()
    const releases: any[] = []
    const ts = (a: any) => new Date(a.created_at).getTime()

    while (delta > 0) {
      const candidates = packs
        .map((p: any, idx: number) => ({ p, idx }))
        .filter(({ p }: any) => (inclMap.get(p.id) || 0) > 0)
      if (!candidates.length) break
      // "Most recently assigned first": take the inclusion off the pack holding the joiner's
      // newest card; with no cards (sort never ran), the last pack auto-fill would have filled.
      const scored = candidates.map(({ p, idx }: any) => {
        const newest = remaining.find(a => a.pack_id === p.id)
        return { p, idx, t: newest ? ts(newest) : -Infinity }
      }).sort((a: any, b: any) => (b.t - a.t) || (b.idx - a.idx))
      const pack = scored[0].p
      inclMap.set(pack.id, (inclMap.get(pack.id) || 0) - 1)
      inclDec.set(pack.id, (inclDec.get(pack.id) || 0) + 1)
      delta--

      for (const item of items.filter((i: any) => i.pack_id === pack.id)) {
        const list = remaining.filter(a => a.item_id === item.id)
        if (!list.length) continue
        let chosen = item.is_unit && lostVersions.size
          ? list.find(a => a.is_guaranteed && lostVersions.has(norm(a.member_name)))
          : undefined
        if (!chosen) chosen = list[0]
        remaining.splice(remaining.indexOf(chosen), 1)
        releases.push({ ...chosen, pack_name: pack.name, item_name: item.name })
      }
    }

    if (inclDec.size || releases.length) plans.push({ session, inclDec, releases })
  }
  return plans
}

// Does this joiner still own anything (claim or sorted card) in any of these boxes?
async function joinerStillInBoxes(q: Q, joinerId: string, boxIds: string[]): Promise<boolean> {
  if (!boxIds.length) return false
  const r = await q(`
    SELECT (
      EXISTS (
        SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.lost_claim_id IS NULL
          AND COALESCE(oi.joiner_id, o.personal_joiner_id) = $1
          AND (oi.order_id IN (SELECT order_id FROM box_orders WHERE box_id = ANY($2::uuid[]))
               OR oi.order_id IN (SELECT order_id FROM boxes WHERE id = ANY($2::uuid[]) AND order_id IS NOT NULL))
      ) OR EXISTS (
        SELECT 1 FROM pc_assignments a JOIN pc_sorting_sessions s ON s.id = a.session_id
        WHERE a.joiner_id = $1 AND s.box_id = ANY($2::uuid[])
      )
    ) AS found
  `, [joinerId, boxIds])
  return !!r[0]?.found
}

async function joinerHasClaimsInBox(q: Q, joinerId: string, boxId: string): Promise<boolean> {
  const orderIds = await boxOrderIds(q, boxId)
  if (!orderIds.length) return false
  const r = await q(`
    SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE oi.order_id = ANY($1::uuid[]) AND oi.lost_claim_id IS NULL
      AND COALESCE(oi.joiner_id, o.personal_joiner_id) = $2 LIMIT 1
  `, [orderIds, joinerId])
  return r.length > 0
}

export async function markClaimsLost(input: MarkLostInput) {
  await ensureLostClaimsSchema()
  const { joinerId, reason, userId, dryRun } = input
  const ids = [...new Set(input.orderItemIds || [])]
  if (!ids.length) throw new LostClaimError('Pick at least one claim to mark as lost')

  const shipmentsToRebuild: { id: string; boxIds: string[] }[] = []

  const result = await withTx(async (q) => {
    // 1. The trigger must be a payment this joiner currently owes.
    const unpaid = await getUnpaidPayments(q, joinerId)
    const trigger = unpaid.find(u => u.key === input.triggerKey)
    if (!trigger) throw new LostClaimError("That payment isn't unpaid anymore (or doesn't belong to this joiner) — refresh and try again")

    // 2. Lock + validate the claims.
    const rows = await q(`
      SELECT oi.*, o.personal_joiner_id, ${ORDER_LABEL_SQL} AS order_label, m.name AS member_name,
        COALESCE(oi.joiner_id, o.personal_joiner_id) AS owner_id
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN shops s ON s.id = o.shop_id
      LEFT JOIN groups g ON g.id = o.group_id
      LEFT JOIN members m ON m.id = COALESCE(oi.override_member_id, oi.member_id)
      WHERE oi.id = ANY($1::uuid[]) AND oi.lost_claim_id IS NULL
      FOR UPDATE OF oi
    `, [ids])
    if (rows.length !== ids.length) throw new LostClaimError('Some of these claims changed or are already lost — refresh and try again', 409)
    if (rows.some((r: any) => r.owner_id !== joinerId)) throw new LostClaimError('Every claim picked must belong to this joiner', 400)

    const lostIds = new Set<string>(ids)
    const orderIds = [...new Set(rows.map((r: any) => r.order_id))] as string[]

    // 3. Plan the PC release on the pre-change state.
    const sessions = await q(`SELECT * FROM pc_sorting_sessions WHERE order_ids IS NOT NULL`)
    const pcPlans = await planPcRelease(q, joinerId, rows, lostIds, sessions)

    // 4. Batch + per-claim snapshots, then release ownership of the order claims.
    const batch = (await q(`
      INSERT INTO lost_claim_batches (joiner_id, trigger_type, trigger_label, trigger_amount_eur, trigger_order_id, trigger_box_id, trigger_shipment_id, reason, lost_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [joinerId, trigger.type, trigger.label, trigger.amount_eur, trigger.order_id || null, trigger.box_id || null, trigger.shipment_id || null, reason || null, userId]))[0]

    const paidRows = await q(`SELECT order_id FROM order_joiner_paid WHERE joiner_id=$1 AND order_id = ANY($2::uuid[]) AND paid = true`, [joinerId, orderIds])
    const paidOrders = new Set(paidRows.map((r: any) => r.order_id))

    for (const r of rows) {
      const lc = (await q(`
        INSERT INTO lost_claims (batch_id, order_id, original_joiner_id, original_item_joiner_id, member_id, description, version_name, item_type, price_eur, price_krw, amount_claimed, inclusions_count, claim_group_id, order_was_paid)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id
      `, [batch.id, r.order_id, joinerId, r.joiner_id, r.override_member_id || r.member_id, r.description, r.version_name, r.item_type || null,
          r.price_eur, r.price_krw ?? null, r.amount_claimed || 1, parseInt(r.inclusions_count) || 0, r.claim_group_id || null, paidOrders.has(r.order_id)]))[0]
      await q(`UPDATE order_items SET joiner_id = NULL, lost_claim_id = $1 WHERE id = $2`, [lc.id, r.id])
    }

    // 5. Apply the PC release.
    const pcEffects: any = { released: [] as any[], inclusions: [] as any[] }
    const sessionBoxIds = new Set<string>()
    for (const plan of pcPlans) {
      if (plan.session.box_id) sessionBoxIds.add(plan.session.box_id)
      for (const [packId, n] of plan.inclDec) {
        await q(`UPDATE pc_pack_inclusions SET inclusions_assigned = GREATEST(0, inclusions_assigned - $3) WHERE pack_id=$1 AND joiner_id=$2`, [packId, joinerId, n])
        await q(`DELETE FROM pc_pack_inclusions WHERE pack_id=$1 AND joiner_id=$2 AND inclusions_assigned <= 0`, [packId, joinerId])
        await q(`INSERT INTO lost_pc_inclusions (batch_id, session_id, pack_id, joiner_id, count) VALUES ($1,$2,$3,$4,$5)`, [batch.id, plan.session.id, packId, joinerId, n])
        const pack = (await q(`SELECT name FROM pc_packs WHERE id=$1`, [packId]))[0]
        pcEffects.inclusions.push({ session_id: plan.session.id, session_title: plan.session.title, pack_id: packId, pack_name: pack?.name, count: n, locked: !!plan.session.locked_at })
      }
      for (const a of plan.releases) {
        await q(`DELETE FROM pc_assignments WHERE id=$1`, [a.id])
        await q(`UPDATE pc_item_quantities SET available = LEAST(total_pulled, available + 1) WHERE item_id=$1 AND member_id=$2`, [a.item_id, a.member_id])
        await q(`
          INSERT INTO lost_pc_items (batch_id, session_id, pack_id, item_id, member_id, original_joiner_id, round, was_repeat, was_random, was_guaranteed, sort_method)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `, [batch.id, plan.session.id, a.pack_id, a.item_id, a.member_id, joinerId, a.round || 1, !!a.is_repeat, !!a.is_random, !!a.is_guaranteed, a.sort_method || plan.session.sort_method || 'fair'])
        pcEffects.released.push({ session_id: plan.session.id, session_title: plan.session.title, pack_name: a.pack_name, item_name: a.item_name, member_name: a.member_name, was_guaranteed: !!a.is_guaranteed })
      }
    }

    // 6. EMS / customs effects, per box holding an affected order.
    const boxes = await boxesForOrders(q, orderIds)
    const boxEffects: any[] = []
    for (const b of boxes) {
      const isTriggerBox = trigger.box_id === b.id
      const stillHasClaims = await joinerHasClaimsInBox(q, joinerId, b.id)
      const fullyOut = !stillHasClaims
      const share = (await q(`SELECT * FROM box_joiner_shares WHERE box_id=$1 AND joiner_id=$2`, [b.id, joinerId]))[0]
      const eff = { box_id: b.id, label: b.label || 'Box', ems_cancelled: false, customs_cancelled: false, customs_excluded: false, fully_out: fullyOut }

      const emsOwed = !!share && b.ems_payment_requested && num(share.ems_amount_eur) > 0.01 && !share.ems_paid && !share.ems_cancelled
      const customsOwed = !!share && b.customs_payment_requested && num(share.customs_amount_eur) > 0.01 && !share.customs_paid && !share.customs_cancelled

      const removeFromBox = (trigger.type === 'ems' && isTriggerBox) || fullyOut
      if (removeFromBox) {
        if (emsOwed) eff.ems_cancelled = true
        if (customsOwed) eff.customs_cancelled = true
        if (!share?.customs_excluded) eff.customs_excluded = true
      }
      if (trigger.type === 'customs' && isTriggerBox && customsOwed) eff.customs_cancelled = true

      if (eff.ems_cancelled || eff.customs_cancelled || eff.customs_excluded) {
        await q(`
          INSERT INTO box_joiner_shares (box_id, joiner_id, ems_cancelled, customs_cancelled, customs_excluded)
          VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (box_id, joiner_id) DO UPDATE SET
            ems_cancelled = box_joiner_shares.ems_cancelled OR EXCLUDED.ems_cancelled,
            customs_cancelled = box_joiner_shares.customs_cancelled OR EXCLUDED.customs_cancelled,
            customs_excluded = box_joiner_shares.customs_excluded OR EXCLUDED.customs_excluded
        `, [b.id, joinerId, eff.ems_cancelled, eff.customs_cancelled, eff.customs_excluded])
      }
      boxEffects.push(eff)
    }

    // 7. Shipments covering any affected box (or the triggering shipment).
    const affectedBoxIds = [...new Set([...boxes.map((b: any) => b.id), ...sessionBoxIds])]
    const shipments = await q(`
      SELECT DISTINCT sh.id, sh.price_eur, sh.paid, sh.payment_cancelled, sh.status, sh.lost_claims_note, f.title
      FROM shipments sh
      LEFT JOIN shipping_forms f ON f.id = sh.form_id
      WHERE sh.joiner_id = $1
        AND (sh.id = $3 OR EXISTS (SELECT 1 FROM shipping_form_boxes sfb WHERE sfb.form_id = sh.form_id AND sfb.box_id = ANY($2::uuid[])))
    `, [joinerId, affectedBoxIds, trigger.shipment_id || null])
    const shipmentEffects: any[] = []
    for (const sh of shipments) {
      const formBoxes = (await q(`SELECT box_id FROM shipping_form_boxes WHERE form_id = (SELECT form_id FROM shipments WHERE id=$1)`, [sh.id])).map((r: any) => r.box_id)
      const stillHas = await joinerStillInBoxes(q, joinerId, formBoxes)
      const empty = !stillHas
      const cancelPayment = empty && num(sh.price_eur) > 0 && !sh.paid && !sh.payment_cancelled
      const note = empty
        ? 'All claims in this shipment were lost (unpaid) — nothing left to pack'
        : 'Some claims were lost (unpaid) and removed from the packing list'
      await q(`UPDATE shipments SET lost_claims_note=$2, payment_cancelled = payment_cancelled OR $3, updated_at=now() WHERE id=$1`, [sh.id, note, cancelPayment])
      shipmentEffects.push({ shipment_id: sh.id, title: sh.title || 'Shipment', empty, payment_cancelled: cancelPayment, prev_note: sh.lost_claims_note || null })
      shipmentsToRebuild.push({ id: sh.id, boxIds: formBoxes })
    }

    const effects = {
      trigger,
      claims: rows.map((r: any) => ({
        order_id: r.order_id, order_label: r.order_label, description: r.description, member_name: r.member_name,
        version_name: r.version_name, amount_claimed: r.amount_claimed || 1, price_eur: r.price_eur != null ? num(r.price_eur) : null,
      })),
      pc: pcEffects,
      boxes: boxEffects,
      shipments: shipmentEffects,
    }
    await q(`UPDATE lost_claim_batches SET effects=$2 WHERE id=$1`, [batch.id, JSON.stringify(effects)])

    if (!dryRun) {
      const what = rows.length === 1 ? '1 of your claims was' : `${rows.length} of your claims were`
      await q(`INSERT INTO notifications (user_id, order_id, message) VALUES ($1,$2,$3)`, [
        joinerId, orderIds[0], `${what} marked as lost because the ${TRIGGER_LABELS[trigger.type].toLowerCase()} payment (${trigger.label}) wasn't paid. See My Orders for details.`,
      ]).catch(() => {})
    }

    return { batch_id: dryRun ? null : batch.id, effects }
  }, !!dryRun)

  if (!dryRun) {
    for (const s of shipmentsToRebuild) await buildShipmentItems(s.id, joinerId, s.boxIds).catch(err => console.error('[lost-claims rebuild]', err))
  }
  return result
}

// ── Restore ────────────────────────────────────────────────────────────────────

export async function restoreBatch(batchId: string, userId: string, note?: string | null) {
  await ensureLostClaimsSchema()
  const rebuild: { id: string; joinerId: string; boxIds: string[] }[] = []

  const summary = await withTx(async (q) => {
    const batch = (await q(`SELECT * FROM lost_claim_batches WHERE id=$1 FOR UPDATE`, [batchId]))[0]
    if (!batch) throw new LostClaimError('Not found', 404)
    if (batch.restored_at) throw new LostClaimError('Already restored')
    const joinerId = batch.joiner_id
    const out = { claims_restored: 0, claims_skipped: 0, pc_restored: 0, pc_skipped: 0 }

    // Order claims still sitting as leftovers go back to the joiner.
    const claims = await q(`SELECT * FROM lost_claims WHERE batch_id=$1`, [batchId])
    for (const lc of claims) {
      if (lc.status !== 'leftover') { out.claims_skipped++; continue }
      const upd = await q(`UPDATE order_items SET joiner_id=$2, lost_claim_id=NULL WHERE lost_claim_id=$1 RETURNING id`, [lc.id, lc.original_item_joiner_id])
      if (!upd.length) { out.claims_skipped++; continue }
      await q(`UPDATE lost_claims SET status='restored' WHERE id=$1`, [lc.id])
      await q(`UPDATE leftover_requests SET status='cancelled', gom_note='Returned to the original joiner', decided_at=now() WHERE lost_claim_id=$1 AND status='pending'`, [lc.id])
      out.claims_restored++
    }

    // Inclusions go back, then the released cards — only where the card is still in stock.
    for (const li of await q(`SELECT * FROM lost_pc_inclusions WHERE batch_id=$1`, [batchId])) {
      await q(`
        INSERT INTO pc_pack_inclusions (session_id, pack_id, joiner_id, inclusions_assigned) VALUES ($1,$2,$3,$4)
        ON CONFLICT (pack_id, joiner_id) DO UPDATE SET inclusions_assigned = pc_pack_inclusions.inclusions_assigned + EXCLUDED.inclusions_assigned
      `, [li.session_id, li.pack_id, li.joiner_id, li.count])
    }
    for (const lp of await q(`SELECT * FROM lost_pc_items WHERE batch_id=$1`, [batchId])) {
      if (lp.status !== 'leftover') { out.pc_skipped++; continue }
      const stock = (await q(`SELECT id, available FROM pc_item_quantities WHERE item_id=$1 AND member_id=$2 FOR UPDATE`, [lp.item_id, lp.member_id]))[0]
      if (!stock || stock.available <= 0) { out.pc_skipped++; continue }
      await q(`
        INSERT INTO pc_assignments (session_id, pack_id, item_id, joiner_id, member_id, round, is_repeat, is_random, is_guaranteed, sort_method)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `, [lp.session_id, lp.pack_id, lp.item_id, joinerId, lp.member_id, lp.round || 1, lp.was_repeat, lp.was_random, lp.was_guaranteed, lp.sort_method || 'fair'])
      await q(`UPDATE pc_item_quantities SET available = available - 1 WHERE id=$1`, [stock.id])
      await q(`UPDATE lost_pc_items SET status='restored' WHERE id=$1`, [lp.id])
      await q(`UPDATE leftover_requests SET status='cancelled', gom_note='Returned to the original joiner', decided_at=now() WHERE lost_pc_item_id=$1 AND status='pending'`, [lp.id])
      out.pc_restored++
    }

    // Undo box/shipment flags this batch set — unless another still-active batch for the same
    // joiner set the same flag.
    const effects = typeof batch.effects === 'string' ? JSON.parse(batch.effects) : (batch.effects || {})
    const others = await q(`SELECT effects FROM lost_claim_batches WHERE joiner_id=$1 AND id<>$2 AND restored_at IS NULL`, [joinerId, batchId])
    const otherEff = others.map((o: any) => (typeof o.effects === 'string' ? JSON.parse(o.effects) : o.effects) || {})
    const otherHasBox = (boxId: string, flag: string) => otherEff.some((e: any) => (e.boxes || []).some((b: any) => b.box_id === boxId && b[flag]))
    for (const b of effects.boxes || []) {
      for (const flag of ['ems_cancelled', 'customs_cancelled', 'customs_excluded']) {
        if (b[flag] && !otherHasBox(b.box_id, flag)) {
          await q(`UPDATE box_joiner_shares SET ${flag}=false WHERE box_id=$1 AND joiner_id=$2`, [b.box_id, joinerId])
        }
      }
    }
    const otherShipmentEff = (id: string) => otherEff.flatMap((e: any) => (e.shipments || []).filter((s: any) => s.shipment_id === id))
    for (const s of effects.shipments || []) {
      const others = otherShipmentEff(s.shipment_id)
      const formBoxes = (await q(`SELECT box_id FROM shipping_form_boxes WHERE form_id = (SELECT form_id FROM shipments WHERE id=$1)`, [s.shipment_id])).map((r: any) => r.box_id)
      // Note: back to what it was if no other active batch touched this shipment; otherwise
      // recomputed from what the joiner still has in it now.
      let note: string | null = s.prev_note || null
      if (others.length) {
        note = (await joinerStillInBoxes(q, joinerId, formBoxes))
          ? 'Some claims were lost (unpaid) and removed from the packing list'
          : 'All claims in this shipment were lost (unpaid) — nothing left to pack'
      }
      const undoPayment = !!s.payment_cancelled && !others.some((o: any) => o.payment_cancelled)
      await q(`UPDATE shipments SET lost_claims_note=$2, payment_cancelled = CASE WHEN $3 THEN false ELSE payment_cancelled END, updated_at=now() WHERE id=$1`,
        [s.shipment_id, note, undoPayment])
      rebuild.push({ id: s.shipment_id, joinerId, boxIds: formBoxes })
    }

    await q(`UPDATE lost_claim_batches SET restored_at=now(), restored_by=$2, restore_note=$3 WHERE id=$1`, [batchId, userId, note || null])
    await q(`INSERT INTO notifications (user_id, message) VALUES ($1,$2)`, [joinerId, 'Your GOM restored claims that had been marked as lost.']).catch(() => {})
    return out
  })

  for (const s of rebuild) await buildShipmentItems(s.id, s.joinerId, s.boxIds).catch(err => console.error('[lost-claims rebuild]', err))
  return summary
}

// ── Reassign leftovers ─────────────────────────────────────────────────────────

async function settleRequests(q: Q, column: 'lost_claim_id' | 'lost_pc_item_id', id: string, winnerJoinerId: string, userId: string) {
  await q(`UPDATE leftover_requests SET status='approved', decided_by=$3, decided_at=now() WHERE ${column}=$1 AND joiner_id=$2 AND status='pending'`, [id, winnerJoinerId, userId])
  const losers = await q(`UPDATE leftover_requests SET status='declined', gom_note=COALESCE(gom_note, 'Given to another joiner'), decided_by=$3, decided_at=now() WHERE ${column}=$1 AND joiner_id<>$2 AND status='pending' RETURNING joiner_id`, [id, winnerJoinerId, userId])
  for (const l of losers) await q(`INSERT INTO notifications (user_id, message) VALUES ($1,$2)`, [l.joiner_id, 'A leftover you requested went to another joiner.']).catch(() => {})
}

export async function reassignLostClaim(lostClaimId: string, newJoinerId: string, userId: string) {
  await ensureLostClaimsSchema()
  return withTx(async (q) => {
    const lc = (await q(`SELECT * FROM lost_claims WHERE id=$1 FOR UPDATE`, [lostClaimId]))[0]
    if (!lc) throw new LostClaimError('Not found', 404)
    if (lc.status !== 'leftover') throw new LostClaimError('This leftover was already reassigned or restored')
    const joiner = (await q(`SELECT id FROM profiles WHERE id=$1`, [newJoinerId]))[0]
    if (!joiner) throw new LostClaimError('Joiner not found', 404)
    const upd = await q(`UPDATE order_items SET joiner_id=$2, lost_claim_id=NULL WHERE lost_claim_id=$1 RETURNING id, order_id`, [lostClaimId, newJoinerId])
    if (!upd.length) throw new LostClaimError("The order line for this leftover no longer exists (the order may have been deleted)", 409)
    await q(`UPDATE lost_claims SET status='reassigned', reassigned_to=$2, reassigned_at=now(), reassigned_by=$3 WHERE id=$1`, [lostClaimId, newJoinerId, userId])
    await settleRequests(q, 'lost_claim_id', lostClaimId, newJoinerId, userId)
    await q(`INSERT INTO notifications (user_id, order_id, message) VALUES ($1,$2,$3)`, [newJoinerId, lc.order_id,
      `You've been given a leftover claim: ${lc.description || 'item'}. It's now in My Orders.`]).catch(() => {})
    return { ok: true, order_item_id: upd[0].id }
  })
}

export async function reassignLostPc(lostPcId: string, newJoinerId: string, userId: string) {
  await ensureLostClaimsSchema()
  return withTx(async (q) => {
    const lp = (await q(`SELECT * FROM lost_pc_items WHERE id=$1 FOR UPDATE`, [lostPcId]))[0]
    if (!lp) throw new LostClaimError('Not found', 404)
    if (lp.status !== 'leftover') throw new LostClaimError('This leftover was already reassigned or restored')
    const session = (await q(`SELECT * FROM pc_sorting_sessions WHERE id=$1`, [lp.session_id]))[0]
    if (!session) throw new LostClaimError('The sorting session no longer exists', 409)
    const stock = (await q(`SELECT id, available FROM pc_item_quantities WHERE item_id=$1 AND member_id=$2 FOR UPDATE`, [lp.item_id, lp.member_id]))[0]
    if (!stock || stock.available <= 0) throw new LostClaimError('This card is no longer in stock (the sort was re-run or quantities edited)', 409)
    const a = (await q(`
      INSERT INTO pc_assignments (session_id, pack_id, item_id, joiner_id, member_id, round, is_repeat, is_random, is_guaranteed, sort_method)
      VALUES ($1,$2,$3,$4,$5,1,false,false,false,$6) RETURNING id
    `, [lp.session_id, lp.pack_id, lp.item_id, newJoinerId, lp.member_id, session.sort_method || lp.sort_method || 'fair']))[0]
    await q(`UPDATE pc_item_quantities SET available = available - 1 WHERE id=$1`, [stock.id])
    await q(`UPDATE lost_pc_items SET status='reassigned', reassigned_to=$2, reassigned_at=now(), reassigned_by=$3, new_assignment_id=$4 WHERE id=$1`, [lostPcId, newJoinerId, userId, a.id])
    await settleRequests(q, 'lost_pc_item_id', lostPcId, newJoinerId, userId)
    await q(`INSERT INTO notifications (user_id, message) VALUES ($1,$2)`, [newJoinerId, `You've been given a leftover sorted card from "${session.title}". See Sorting.`]).catch(() => {})
    return { ok: true, assignment_id: a.id }
  })
}

// ── Listings ───────────────────────────────────────────────────────────────────

const LOST_CLAIM_SELECT = `
  SELECT lc.*, ${ORDER_LABEL_SQL} AS order_label, o.status AS order_status, m.name AS member_name,
    COALESCE(oj.display_name, oj.username) AS original_joiner_name,
    COALESCE(rj.display_name, rj.username) AS reassigned_to_name,
    b.trigger_type, b.trigger_label, b.trigger_amount_eur, b.reason, b.lost_at, b.restored_at
  FROM lost_claims lc
  JOIN lost_claim_batches b ON b.id = lc.batch_id
  JOIN orders o ON o.id = lc.order_id
  LEFT JOIN shops s ON s.id = o.shop_id
  LEFT JOIN groups g ON g.id = o.group_id
  LEFT JOIN members m ON m.id = lc.member_id
  LEFT JOIN profiles oj ON oj.id = lc.original_joiner_id
  LEFT JOIN profiles rj ON rj.id = lc.reassigned_to
`
const LOST_PC_SELECT = `
  SELECT lp.*, ss.title AS session_title, ss.locked_at, pk.name AS pack_name, it.name AS item_name,
    COALESCE(m.name, u.name) AS member_name,
    COALESCE(oj.display_name, oj.username) AS original_joiner_name,
    COALESCE(rj.display_name, rj.username) AS reassigned_to_name,
    q.available AS stock_available,
    b.trigger_type, b.trigger_label, b.trigger_amount_eur, b.reason, b.lost_at, b.restored_at
  FROM lost_pc_items lp
  JOIN lost_claim_batches b ON b.id = lp.batch_id
  JOIN pc_sorting_sessions ss ON ss.id = lp.session_id
  LEFT JOIN pc_packs pk ON pk.id = lp.pack_id
  LEFT JOIN pc_items it ON it.id = lp.item_id
  LEFT JOIN members m ON m.id = lp.member_id
  LEFT JOIN pc_item_units u ON u.id = lp.member_id
  LEFT JOIN pc_item_quantities q ON q.item_id = lp.item_id AND q.member_id = lp.member_id
  LEFT JOIN profiles oj ON oj.id = lp.original_joiner_id
  LEFT JOIN profiles rj ON rj.id = lp.reassigned_to
`

export async function getGomLeftoversData() {
  await ensureLostClaimsSchema()
  const [claims, pcs, batches, requests] = await Promise.all([
    query(`${LOST_CLAIM_SELECT} ORDER BY b.lost_at DESC, lc.created_at`),
    query(`${LOST_PC_SELECT} ORDER BY b.lost_at DESC, lp.created_at`),
    query(`
      SELECT b.*, COALESCE(p.display_name, p.username) AS joiner_name, COALESCE(lb.display_name, lb.username) AS lost_by_name,
        (SELECT COUNT(*)::int FROM lost_claims WHERE batch_id=b.id) AS claim_count,
        (SELECT COUNT(*)::int FROM lost_pc_items WHERE batch_id=b.id) AS pc_count
      FROM lost_claim_batches b
      LEFT JOIN profiles p ON p.id = b.joiner_id
      LEFT JOIN profiles lb ON lb.id = b.lost_by
      ORDER BY b.lost_at DESC
    `),
    query(`
      SELECT r.*, COALESCE(p.display_name, p.username) AS joiner_name,
        lc.description AS claim_description, lcm.name AS claim_member_name, lc.version_name AS claim_version, lc.status AS claim_status,
        it.name AS pc_item_name, pk.name AS pc_pack_name, COALESCE(pm.name, pu.name) AS pc_member_name, ss.title AS pc_session_title, lp.status AS pc_status,
        sm.name AS slot_member_name,
        ${ORDER_LABEL_SQL} AS order_label
      FROM leftover_requests r
      LEFT JOIN profiles p ON p.id = r.joiner_id
      LEFT JOIN lost_claims lc ON lc.id = r.lost_claim_id
      LEFT JOIN members lcm ON lcm.id = lc.member_id
      LEFT JOIN lost_pc_items lp ON lp.id = r.lost_pc_item_id
      LEFT JOIN pc_items it ON it.id = lp.item_id
      LEFT JOIN pc_packs pk ON pk.id = lp.pack_id
      LEFT JOIN members pm ON pm.id = lp.member_id
      LEFT JOIN pc_item_units pu ON pu.id = lp.member_id
      LEFT JOIN pc_sorting_sessions ss ON ss.id = lp.session_id
      LEFT JOIN members sm ON sm.id = r.member_id
      LEFT JOIN orders o ON o.id = COALESCE(r.order_id, lc.order_id)
      LEFT JOIN shops s ON s.id = o.shop_id
      LEFT JOIN groups g ON g.id = o.group_id
      ORDER BY (r.status = 'pending') DESC, r.created_at DESC
    `),
  ])
  return { claims, pcs, batches, requests }
}

// What a joiner may see: available leftovers WITHOUT who lost them or why, plus their own requests.
export async function getJoinerLeftoversData(joinerId: string) {
  await ensureLostClaimsSchema()
  const [claims, pcs, requests] = await Promise.all([
    query(`
      SELECT lc.id, lc.order_id, lc.description, lc.version_name, lc.price_eur, lc.amount_claimed, m.name AS member_name,
        ${ORDER_LABEL_SQL} AS order_label, o.status AS order_status
      FROM lost_claims lc
      JOIN orders o ON o.id = lc.order_id
      LEFT JOIN shops s ON s.id = o.shop_id
      LEFT JOIN groups g ON g.id = o.group_id
      LEFT JOIN members m ON m.id = lc.member_id
      WHERE lc.status = 'leftover'
      ORDER BY lc.created_at DESC
    `),
    query(`
      SELECT lp.id, lp.session_id, ss.title AS session_title, pk.name AS pack_name, it.name AS item_name, COALESCE(m.name, u.name) AS member_name
      FROM lost_pc_items lp
      JOIN pc_sorting_sessions ss ON ss.id = lp.session_id
      LEFT JOIN pc_packs pk ON pk.id = lp.pack_id
      LEFT JOIN pc_items it ON it.id = lp.item_id
      LEFT JOIN members m ON m.id = lp.member_id
      LEFT JOIN pc_item_units u ON u.id = lp.member_id
      WHERE lp.status = 'leftover'
      ORDER BY lp.created_at DESC
    `),
    query(`
      SELECT r.id, r.kind, r.lost_claim_id, r.lost_pc_item_id, r.order_id, r.member_id, r.version_label, r.note, r.status, r.gom_note, r.created_at, r.decided_at, r.slot_option,
        lc.description AS claim_description, lcm.name AS claim_member_name,
        it.name AS pc_item_name, COALESCE(pm.name, pu.name) AS pc_member_name, ss.title AS pc_session_title,
        sm.name AS slot_member_name, ${ORDER_LABEL_SQL} AS order_label
      FROM leftover_requests r
      LEFT JOIN lost_claims lc ON lc.id = r.lost_claim_id
      LEFT JOIN members lcm ON lcm.id = lc.member_id
      LEFT JOIN lost_pc_items lp ON lp.id = r.lost_pc_item_id
      LEFT JOIN pc_items it ON it.id = lp.item_id
      LEFT JOIN members pm ON pm.id = lp.member_id
      LEFT JOIN pc_item_units pu ON pu.id = lp.member_id
      LEFT JOIN pc_sorting_sessions ss ON ss.id = lp.session_id
      LEFT JOIN members sm ON sm.id = r.member_id
      LEFT JOIN orders o ON o.id = COALESCE(r.order_id, lc.order_id)
      LEFT JOIN shops s ON s.id = o.shop_id
      LEFT JOIN groups g ON g.id = o.group_id
      WHERE r.joiner_id = $1
      ORDER BY r.created_at DESC
    `, [joinerId]),
  ])
  return { claims, pcs, requests }
}

// The joiner's own lost claims (still lost — restored ones are back in their orders), with which
// payment wasn't paid, for the "Lost — unpaid" badges.
export async function getMyLostClaims(joinerId: string, orderId?: string | null) {
  await ensureLostClaimsSchema()
  const [claims, pcs] = await Promise.all([
    query(`
      SELECT lc.id, lc.order_id, lc.description, lc.version_name, lc.price_eur, lc.amount_claimed, lc.status, m.name AS member_name,
        ${ORDER_LABEL_SQL} AS order_label, b.trigger_type, b.trigger_label, b.trigger_amount_eur, b.reason, b.lost_at
      FROM lost_claims lc
      JOIN lost_claim_batches b ON b.id = lc.batch_id
      JOIN orders o ON o.id = lc.order_id
      LEFT JOIN shops s ON s.id = o.shop_id
      LEFT JOIN groups g ON g.id = o.group_id
      LEFT JOIN members m ON m.id = lc.member_id
      WHERE lc.original_joiner_id = $1 AND lc.status <> 'restored' AND b.restored_at IS NULL
        AND ($2::uuid IS NULL OR lc.order_id = $2::uuid)
      ORDER BY b.lost_at DESC
    `, [joinerId, orderId || null]),
    orderId ? Promise.resolve([] as any[]) : query(`
      SELECT lp.id, ss.title AS session_title, pk.name AS pack_name, it.name AS item_name, COALESCE(m.name, u.name) AS member_name,
        b.trigger_type, b.trigger_label, b.trigger_amount_eur, b.reason, b.lost_at
      FROM lost_pc_items lp
      JOIN lost_claim_batches b ON b.id = lp.batch_id
      JOIN pc_sorting_sessions ss ON ss.id = lp.session_id
      LEFT JOIN pc_packs pk ON pk.id = lp.pack_id
      LEFT JOIN pc_items it ON it.id = lp.item_id
      LEFT JOIN members m ON m.id = lp.member_id
      LEFT JOIN pc_item_units u ON u.id = lp.member_id
      WHERE lp.original_joiner_id = $1 AND lp.status <> 'restored' AND b.restored_at IS NULL
      ORDER BY b.lost_at DESC
    `, [joinerId]),
  ])
  return { claims, pcs }
}

// ── Leftover requests ──────────────────────────────────────────────────────────

export async function createLeftoverRequest(joinerId: string, body: any) {
  await ensureLostClaimsSchema()
  const kind = body.kind
  const note = (body.note || '').toString().slice(0, 500) || null
  if (kind === 'lost_claim') {
    const lc = (await query(`SELECT status FROM lost_claims WHERE id=$1`, [body.lost_claim_id]))[0]
    if (!lc || lc.status !== 'leftover') throw new LostClaimError('This leftover is no longer available', 409)
    const dup = await query(`SELECT 1 FROM leftover_requests WHERE joiner_id=$1 AND lost_claim_id=$2 AND status='pending'`, [joinerId, body.lost_claim_id])
    if (dup.length) throw new LostClaimError("You've already asked for this one")
    return (await query(`INSERT INTO leftover_requests (joiner_id, kind, lost_claim_id, note) VALUES ($1,'lost_claim',$2,$3) RETURNING *`, [joinerId, body.lost_claim_id, note]))[0]
  }
  if (kind === 'lost_pc') {
    const lp = (await query(`SELECT status FROM lost_pc_items WHERE id=$1`, [body.lost_pc_item_id]))[0]
    if (!lp || lp.status !== 'leftover') throw new LostClaimError('This leftover is no longer available', 409)
    const dup = await query(`SELECT 1 FROM leftover_requests WHERE joiner_id=$1 AND lost_pc_item_id=$2 AND status='pending'`, [joinerId, body.lost_pc_item_id])
    if (dup.length) throw new LostClaimError("You've already asked for this one")
    return (await query(`INSERT INTO leftover_requests (joiner_id, kind, lost_pc_item_id, note) VALUES ($1,'lost_pc',$2,$3) RETURNING *`, [joinerId, body.lost_pc_item_id, note]))[0]
  }
  if (kind === 'slot') {
    if (!body.order_id || !body.member_id) throw new LostClaimError('order_id and member_id are required')
    if (await openSlotCount(body.order_id, body.member_id, body.version_label) <= 0) throw new LostClaimError('This slot is no longer open', 409)
    // The option is looked up server-side from its key, so the stored price is the order's real
    // price, never whatever the browser sent.
    const option = (await getSlotOptions(body.order_id, body.version_label)).find(o => o.key === body.option_key)
    if (!option) throw new LostClaimError('Pick one of the order’s pricing options')
    const dup = await query(`SELECT 1 FROM leftover_requests WHERE joiner_id=$1 AND kind='slot' AND order_id=$2 AND member_id IS NOT DISTINCT FROM $3 AND version_label IS NOT DISTINCT FROM $4 AND status='pending'`,
      [joinerId, body.order_id, body.member_id, body.version_label || null])
    if (dup.length) throw new LostClaimError("You've already asked for this one")
    return (await query(`INSERT INTO leftover_requests (joiner_id, kind, order_id, member_id, version_label, note, slot_option) VALUES ($1,'slot',$2,$3,$4,$5,$6) RETURNING *`,
      [joinerId, body.order_id, body.member_id, body.version_label || null, note, JSON.stringify(option)]))[0]
  }
  throw new LostClaimError('Unknown request type')
}

export async function cancelLeftoverRequest(joinerId: string, id: string) {
  await ensureLostClaimsSchema()
  const r = await query(`UPDATE leftover_requests SET status='cancelled', decided_at=now() WHERE id=$1 AND joiner_id=$2 AND status='pending' RETURNING id`, [id, joinerId])
  if (!r.length) throw new LostClaimError('Request not found or already handled', 404)
  return { ok: true }
}

export async function decideLeftoverRequest(id: string, approve: boolean, userId: string, gomNote?: string | null) {
  await ensureLostClaimsSchema()
  const r = (await query(`SELECT * FROM leftover_requests WHERE id=$1`, [id]))[0]
  if (!r) throw new LostClaimError('Not found', 404)
  if (r.status !== 'pending') throw new LostClaimError('This request was already handled')
  if (!approve) {
    await query(`UPDATE leftover_requests SET status='declined', gom_note=$2, decided_by=$3, decided_at=now() WHERE id=$1`, [id, gomNote || null, userId])
    await query(`INSERT INTO notifications (user_id, message) VALUES ($1,$2)`, [r.joiner_id, 'Your leftover request was declined.' + (gomNote ? ` Note: ${gomNote}` : '')]).catch(() => {})
    return { ok: true }
  }
  if (r.kind === 'lost_claim') {
    await reassignLostClaim(r.lost_claim_id, r.joiner_id, userId)
  } else if (r.kind === 'lost_pc') {
    await reassignLostPc(r.lost_pc_item_id, r.joiner_id, userId)
  } else {
    // Open member slot: accepting creates the claim in the order right away, with the pricing
    // option the joiner picked when asking.
    const option = typeof r.slot_option === 'string' ? JSON.parse(r.slot_option) : r.slot_option
    if (!option) throw new LostClaimError('This request has no pricing option — ask the joiner to request again')
    const created = await giveSlot({ orderId: r.order_id, memberId: r.member_id, versionLabel: r.version_label, option, joinerId: r.joiner_id, userId, notify: false, exceptRequestId: r.id })
    await query(`UPDATE leftover_requests SET status='approved', gom_note=$2, decided_by=$3, decided_at=now(), created_order_item_id=$4 WHERE id=$1`, [id, gomNote || null, userId, created.order_item_id])
    await query(`INSERT INTO notifications (user_id, order_id, message) VALUES ($1,$2,$3)`, [r.joiner_id, r.order_id,
      `Your leftover request was accepted: ${option.description || 'claim'} has been added to your order.`]).catch(() => {})
    return { ok: true, order_item_id: created.order_item_id }
  }
  if (gomNote) await query(`UPDATE leftover_requests SET gom_note=$2 WHERE id=$1`, [id, gomNote])
  return { ok: true }
}

// Paid order money that left order_items with a lost claim — still counts as collected for the
// Payments "covering" maths (it was really received), until the claim is restored (then it's
// back in order_items and counted the normal way).
export async function getPaidLostAmounts() {
  await ensureLostClaimsSchema()
  return query(`
    SELECT lc.order_id, lc.original_joiner_id AS joiner_id, SUM(lc.price_eur * lc.amount_claimed) AS amount_eur
    FROM lost_claims lc
    WHERE lc.order_was_paid AND lc.status <> 'restored' AND lc.price_eur IS NOT NULL
    GROUP BY lc.order_id, lc.original_joiner_id
  `).catch(() => [] as any[])
}

// ── Give an open slot (accepted request, or the GOM giving it directly) ─────────

export async function giveSlot(input: { orderId: string; memberId: string; versionLabel?: string | null; option: SlotOption | null; optionKey?: string | null; joinerId: string; userId: string; notify?: boolean; exceptRequestId?: string | null }) {
  await ensureLostClaimsSchema()
  let option = input.option
  if (!option) {
    option = (await getSlotOptions(input.orderId, input.versionLabel)).find(o => o.key === input.optionKey) || null
    if (!option) throw new LostClaimError('Pick one of the order’s pricing options')
  }
  const joiner = (await query(`SELECT id FROM profiles WHERE id=$1`, [input.joinerId]))[0]
  if (!joiner) throw new LostClaimError('Joiner not found', 404)
  if (await openSlotCount(input.orderId, input.memberId, input.versionLabel) <= 0) throw new LostClaimError('This slot is no longer open', 409)
  const row = (await query(`
    INSERT INTO order_items (order_id, member_id, joiner_id, pricing_type, description, amount_claimed, price_eur, price_krw, weight_g, item_type, inclusions_count, entries_count, version_name, claim_group_id, weight_variant_id)
    VALUES ($1,$2,$3,'custom',$4,1,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id
  `, [input.orderId, input.memberId, input.joinerId, option.description, option.price_eur, option.price_krw, option.weight_g,
      option.item_type || 'photocard', option.inclusions_count || 0, option.entries_count || 0, option.version_name, randomUUID(), option.weight_variant_id]))[0]
  if (input.notify !== false) {
    await query(`INSERT INTO notifications (user_id, order_id, message) VALUES ($1,$2,$3)`, [input.joinerId, input.orderId,
      `You've been given a leftover claim: ${option.description || 'claim'}. It's now in My Orders.`]).catch(() => {})
  }
  // That was the last open slot for this member → other pending asks for it can't be met anymore.
  if (await openSlotCount(input.orderId, input.memberId, input.versionLabel) <= 0) {
    const losers = await query(`UPDATE leftover_requests SET status='declined', gom_note='Given to another joiner', decided_by=$4, decided_at=now()
      WHERE kind='slot' AND status='pending' AND order_id=$1 AND member_id=$2 AND version_label IS NOT DISTINCT FROM $3
        AND ($5::uuid IS NULL OR id <> $5::uuid) RETURNING joiner_id`,
      [input.orderId, input.memberId, input.versionLabel || null, input.userId, input.exceptRequestId || null])
    for (const l of losers) await query(`INSERT INTO notifications (user_id, message) VALUES ($1,$2)`, [l.joiner_id, 'A leftover you requested went to another joiner.']).catch(() => {})
  }
  return { ok: true, order_item_id: row.id }
}
