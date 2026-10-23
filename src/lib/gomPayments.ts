import { query } from './db'
import { ensureLostClaimsSchema } from './lostClaims'
import { ensureSemiFixedSchema } from './semiFixed'

// ============================================================
// GOM PAYMENTS (what the GOM paid to buy an order) + COVERAGE
//
// Each order can have several payment lines (deposit + balance, shop + proxy fee…), each with
// an amount in € (and optionally the ₩ amount + the ₩-per-€ rate it was converted with), who it
// was paid to, a date and a note. Their sum is the order's "paid".
//
// Coverage for an order = received − paid, where "received" is the order money joiners have
// paid and the GOM validated (order_joiner_paid.paid), plus money already paid for claims that
// were later marked lost. Submitted-but-not-validated proofs are reported separately as
// "pending". EMS / customs / shipping are per box/shipment and are NOT part of this.
//
// The old `payments` table (+ covering_log) is left untouched and shown read-only as the
// Archive on the Payments page — nothing writes to it anymore.
//
// Id columns are TEXT with ::text comparisons (no FKs) so this works whether the live DB uses
// TEXT or UUID ids. Lines of a deleted order are removed by DELETE /api/orders.
// ============================================================

// Memoised promise: concurrent first requests all wait for the same migration run.
let schemaPromise: Promise<void> | null = null
export function ensureGomPaymentsSchema() {
  if (!schemaPromise) schemaPromise = migrate().catch(err => { schemaPromise = null; throw err })
  return schemaPromise
}
async function migrate() {
  await ensureLostClaimsSchema()
  await ensureSemiFixedSchema()
  const stmts = [
    `CREATE TABLE IF NOT EXISTS gom_order_payments (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      order_id TEXT NOT NULL,
      amount_eur NUMERIC(10,2) NOT NULL DEFAULT 0,
      amount_krw NUMERIC(12,0),
      krw_rate NUMERIC(10,4),
      paid_to TEXT,
      note TEXT,
      paid_at DATE DEFAULT CURRENT_DATE,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_gom_order_payments_order ON gom_order_payments(order_id)`,
    // Read by the coverage query; normally added by /api/joiner-payments' own migration.
    `ALTER TABLE order_joiner_paid ADD COLUMN IF NOT EXISTS proof_submitted BOOLEAN DEFAULT false`,
    `ALTER TABLE boxes ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS gom_payments_legacy BOOLEAN NOT NULL DEFAULT false`,
  ]
  for (const sql of stmts) {
    await query(sql).catch(err => console.error('[gom-payments migration]', sql.slice(0, 60), err?.message))
  }
  // Cut-over: every order created before 22 Oct 2026 (Paris) stays on the OLD system — its GOM
  // payments are in the Archive, it doesn't show on the GOM Payments tab and never asks for an
  // amount paid, whatever its status now or later. Orders created from then on use the new system.
  // The rule only depends on created_at, so it's safe to apply on every cold start (it also
  // corrects anything flagged by an earlier version of the rule).
  await query(`UPDATE orders SET gom_payments_legacy = (COALESCE(created_at, '-infinity') < $1::timestamptz)
      WHERE gom_payments_legacy IS DISTINCT FROM (COALESCE(created_at, '-infinity') < $1::timestamptz)`, [LEGACY_CUTOFF])
    .catch(err => console.error('[gom-payments cutover]', err?.message))
}

// Orders created before this stay on the old payments system.
export const LEGACY_CUTOFF = '2026-10-22T00:00:00+02:00'

export const PAID_TO_OPTIONS = ['shop', 'kaddy', 'proxy', 'seller', 'other'] as const

export function cleanLine(l: any) {
  const num = (v: any) => (v === '' || v == null || isNaN(parseFloat(v)) ? null : parseFloat(v))
  const eur = num(l.amount_eur)
  return {
    amount_eur: eur == null ? null : Math.round(eur * 100) / 100,
    amount_krw: num(l.amount_krw) == null ? null : Math.round(num(l.amount_krw)!),
    krw_rate: num(l.krw_rate),
    paid_to: PAID_TO_OPTIONS.includes(l.paid_to) ? l.paid_to : null,
    note: typeof l.note === 'string' && l.note.trim() ? l.note.trim() : null,
    paid_at: typeof l.paid_at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(l.paid_at) ? l.paid_at.slice(0, 10) : null,
  }
}

// One row per non-legacy order that is at least "ordered" (or already has payment lines), with everything
// the Payments page needs — computed in a single query.
export async function getCoverage() {
  await ensureGomPaymentsSchema()
  return query(`
    WITH claims AS (
      SELECT oi.order_id::text AS order_id, oi.joiner_id::text AS joiner_id,
             SUM(COALESCE(oi.price_eur, 0) * COALESCE(oi.amount_claimed, 1)) AS amt
      FROM order_items oi
      WHERE oi.joiner_id IS NOT NULL
      GROUP BY 1, 2
    ),
    recv AS (
      SELECT c.order_id,
        SUM(c.amt) AS expected,
        SUM(CASE WHEN ojp.paid THEN c.amt ELSE 0 END) AS received,
        SUM(CASE WHEN NOT COALESCE(ojp.paid, false) AND COALESCE(ojp.proof_submitted, false) THEN c.amt ELSE 0 END) AS pending,
        COUNT(*) AS joiners,
        COUNT(*) FILTER (WHERE ojp.paid) AS joiners_paid
      FROM claims c
      LEFT JOIN order_joiner_paid ojp ON ojp.order_id::text = c.order_id AND ojp.joiner_id::text = c.joiner_id
      GROUP BY c.order_id
    ),
    lost AS (
      SELECT lc.order_id::text AS order_id, SUM(lc.price_eur * lc.amount_claimed) AS amt
      FROM lost_claims lc
      WHERE lc.order_was_paid AND lc.status <> 'restored' AND lc.price_eur IS NOT NULL
      GROUP BY 1
    ),
    paid AS (
      SELECT order_id,
        SUM(amount_eur) AS paid_eur,
        SUM(amount_krw) AS paid_krw,
        json_agg(json_build_object(
          'id', id, 'amount_eur', amount_eur, 'amount_krw', amount_krw, 'krw_rate', krw_rate,
          'paid_to', paid_to, 'note', note, 'paid_at', paid_at, 'created_at', created_at
        ) ORDER BY paid_at NULLS LAST, created_at) AS lines
      FROM gom_order_payments
      GROUP BY order_id
    )
    SELECT
      o.id::text AS id, o.type, o.status, o.round_number, o.created_at, o.ordered_at,
      o.group_id::text AS group_id, g.name AS group_name,
      o.era_id::text AS era_id, e.name AS era_name, e.status AS era_status, e.created_at AS era_created_at,
      s.name AS shop_name,
      COALESCE(pj.display_name, pj.username) AS personal_joiner_name,
      COALESCE(r.expected, 0) + COALESCE(l.amt, 0) AS expected_eur,
      COALESCE(r.received, 0) + COALESCE(l.amt, 0) AS received_eur,
      COALESCE(r.pending, 0) AS pending_eur,
      COALESCE(r.joiners, 0) AS joiners, COALESCE(r.joiners_paid, 0) AS joiners_paid,
      p.paid_eur, p.paid_krw, COALESCE(p.lines, '[]'::json) AS lines
    FROM orders o
    LEFT JOIN groups g ON g.id::text = o.group_id::text
    LEFT JOIN eras e ON e.id::text = o.era_id::text
    LEFT JOIN shops s ON s.id::text = o.shop_id::text
    LEFT JOIN profiles pj ON pj.id::text = o.personal_joiner_id::text
    LEFT JOIN recv r ON r.order_id = o.id::text
    LEFT JOIN lost l ON l.order_id = o.id::text
    LEFT JOIN paid p ON p.order_id = o.id::text
    WHERE NOT o.gom_payments_legacy
      AND (o.status::text <> 'to_be_ordered' OR p.order_id IS NOT NULL)
    ORDER BY g.name NULLS LAST, e.created_at NULLS LAST, COALESCE(o.ordered_at, o.created_at) DESC
  `)
}
