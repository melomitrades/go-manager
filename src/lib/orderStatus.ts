import { query, queryOne } from './db'
import { ensureGomPaymentsSchema } from './gomPayments'

// ============================================================
// ORDER STATUS CHANGES (single, bulk, and "box received → At GOM")
// ============================================================

const STATUS_LABELS: Record<string, string> = {
  to_be_ordered: 'To Be Ordered', ordered: 'Ordered', at_k_addy: 'At K-Addy',
  otw_to_gom: 'On the way to GOM', at_gom: 'At GOM', at_c_addy: 'At C-Addy',
  at_j_addy: 'At J-Addy', otw_to_joiners: 'On the way to you!',
  delivered: 'Delivered 🎉', closed: 'Closed',
}

const ADDY_MAP: Record<string, string> = { at_k_addy: 'KR', at_c_addy: 'CN', at_j_addy: 'JP' }

// Statuses that come before the order reaches the GOM. "Box received" only moves orders that
// are still in one of these — it never pulls an order back from At GOM / Closed.
export const PRE_GOM_STATUSES = ['to_be_ordered', 'ordered', 'at_k_addy', 'at_c_addy', 'at_j_addy', 'otw_to_gom']

export async function notifyStatus(orderId: string, status: string) {
  try {
    const shop = await queryOne<any>('SELECT s.name FROM shops s JOIN orders o ON o.shop_id = s.id WHERE o.id = $1', [orderId]).catch(() => null)
    const label = STATUS_LABELS[status] || status
    const msg = shop?.name ? `Your ${shop.name} order is now: ${label}` : `An order status changed to: ${label}`
    await query(`INSERT INTO notifications (user_id, order_id, message)
      SELECT joiner_id, $1, $2 FROM order_items WHERE order_id = $1 AND joiner_id IS NOT NULL GROUP BY joiner_id`, [orderId, msg])
  } catch {}
}

async function ensureAddyItem(orderId: string, status: string) {
  const country = ADDY_MAP[status]
  if (!country) return
  await query(`ALTER TABLE addy_items ADD COLUMN IF NOT EXISTS picture_url TEXT`).catch(() => {})
  const exists = await queryOne('SELECT id FROM addy_items WHERE order_id = $1 AND country = $2', [orderId, country])
  if (!exists) await query(`INSERT INTO addy_items (country, order_id, arrived_at) VALUES ($1, $2, now())`, [country, orderId])
}

// Set one order's status. Joiners are notified only when the status actually changes.
// Becoming "ordered" also fills ordered_at if it was empty.
export async function setOrderStatus(orderId: string, status: string) {
  const prev = await queryOne<any>('SELECT status FROM orders WHERE id = $1', [orderId])
  if (!prev) return null
  const order = await queryOne<any>(
    `UPDATE orders SET status = $1, addy_country = $2,
       ordered_at = CASE WHEN $4::boolean THEN COALESCE(ordered_at, now()) ELSE ordered_at END,
       updated_at = now()
     WHERE id = $3 RETURNING *`,
    [status, ADDY_MAP[status] || null, orderId, status === 'ordered']
  )
  if (order && prev.status !== status) {
    await notifyStatus(orderId, status)
    await ensureAddyItem(orderId, status)
  }
  if (order) {
    order.previous_status = prev.status
    order.preview_image_url = null
  }
  return order
}

// Mark a box received (or undo). When received, every order in the box whose boxes are now ALL
// received moves to At GOM — but only if it hasn't reached At GOM or later yet. Undoing only
// clears the flag; orders keep their status.
export async function setBoxReceived(boxId: string, received: boolean) {
  await ensureGomPaymentsSchema()
  const box = await queryOne<any>(
    `UPDATE boxes SET received_at = ${received ? 'COALESCE(received_at, now())' : 'NULL'}, updated_at = now() WHERE id = $1 RETURNING *`,
    [boxId]
  )
  if (!box) return null
  const result = received ? await applyReceivedBoxes(boxId) : { moved: [], waiting: [], already: [] }
  return { box, ...result }
}

export async function applyReceivedBoxes(boxId: string) {
  // Box ↔ order links; legacy boxes with only boxes.order_id (no box_orders rows) count too.
  const rows = await query<any>(`
    WITH links AS (
      SELECT bo.box_id::text AS box_id, bo.order_id::text AS order_id FROM box_orders bo
      UNION
      SELECT b.id::text, b.order_id::text FROM boxes b
      WHERE b.order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM box_orders bo WHERE bo.box_id = b.id)
    )
    SELECT l.order_id, o.status::text AS status,
      bool_and(b.received_at IS NOT NULL) AS all_received,
      COUNT(*) FILTER (WHERE b.received_at IS NULL) AS boxes_left
    FROM links l
    JOIN boxes b ON b.id::text = l.box_id
    JOIN orders o ON o.id::text = l.order_id
    WHERE l.order_id IN (SELECT order_id FROM links WHERE box_id = $1)
    GROUP BY l.order_id, o.status
  `, [String(boxId)])
  const moved: string[] = [], waiting: string[] = [], already: string[] = []
  for (const r of rows) {
    if (!PRE_GOM_STATUSES.includes(r.status)) { already.push(r.order_id); continue }
    if (!r.all_received) { waiting.push(r.order_id); continue }
    await setOrderStatus(r.order_id, 'at_gom')
    moved.push(r.order_id)
  }
  return { moved, waiting, already }
}
