import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { ensureWeightVariantsSchema } from '@/lib/weightVariants'

async function notifyJoiners(orderId: string, status: string, shopName: string | null) {
  const statusLabels: Record<string, string> = {
    to_be_ordered: 'To Be Ordered', ordered: 'Ordered', at_k_addy: 'At K-Addy',
    otw_to_gom: 'On the way to GOM', at_gom: 'At GOM', at_c_addy: 'At C-Addy',
    at_j_addy: 'At J-Addy', otw_to_joiners: 'On the way to you!',
    delivered: 'Delivered 🎉', closed: 'Closed',
  }
  try {
    const joiners = await query(`SELECT DISTINCT joiner_id FROM order_items WHERE order_id=$1 AND joiner_id IS NOT NULL`, [orderId])
    if (!Array.isArray(joiners) || joiners.length === 0) return
    const label = statusLabels[status] || status
    const msg = shopName ? `Your ${shopName} order is now: ${label}` : `An order status changed to: ${label}`
    await query(`INSERT INTO notifications (user_id, order_id, message) SELECT joiner_id, $1, $2 FROM order_items WHERE order_id=$1 AND joiner_id IS NOT NULL GROUP BY joiner_id`, [orderId, msg])
  } catch {}
}

const ADDY_MAP: Record<string, string> = { at_k_addy: 'KR', at_c_addy: 'CN', at_j_addy: 'JP' }

// Run migrations once per cold start only
let migrationsDone = false
async function ensureOrderColumns() {
  if (migrationsDone) return
  migrationsDone = true
  await ensureWeightVariantsSchema()
  // Idempotent backfill — belongs in the once-per-cold-start gate below, not run unconditionally
  // on every request (it used to fire outside the gate on every single GET/POST/PATCH).
  query(`UPDATE order_items SET inclusions_count = COALESCE(amount_claimed, 1)
    WHERE inclusions_count = 0
      AND description IS NOT NULL
      AND LOWER(description) LIKE '%inclu%'`).catch(() => {})
  await Promise.all([
    query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ').catch(() => {}),
    query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS ordered_at TIMESTAMPTZ').catch(() => {}),
    query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS preview_image_url TEXT').catch(() => {}),
    query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS hide_leftovers BOOLEAN DEFAULT false').catch(() => {}),
    query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_info TEXT').catch(() => {}),
    query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_vce_fansign BOOLEAN DEFAULT false').catch(() => {}),
    query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_multi_version BOOLEAN DEFAULT false').catch(() => {}),
    query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS version_names JSONB DEFAULT NULL').catch(() => {}),
    query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS version_options JSONB DEFAULT NULL').catch(() => {}),
    query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS albums_bought JSONB DEFAULT NULL').catch(() => {}),
    query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS personal_joiner_id UUID REFERENCES profiles(id) ON DELETE SET NULL').catch(() => {}),
    query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS version_name TEXT DEFAULT NULL').catch(() => {}),
    // Ties together every row a single item-line explodes into (one row per member picked on
    // that line). Without this, there was no reliable way to tell "these 4 rows are really one
    // claim, split across 4 members" apart from "these are 4 separate claims that happen to
    // share the same description/price" — which caused inclusion totals to be either multiplied
    // (summed every row) or wrongly collapsed (deduped by description+price, which can't tell
    // two distinct same-priced claims apart). Set once per line at save time; NULL on rows saved
    // before this column existed (readers fall back to the description+price+version heuristic
    // for those).
    query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS claim_group_id TEXT DEFAULT NULL').catch(() => {}),
    query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS item_type TEXT DEFAULT \'photocard\'').catch(() => {}),
    query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS inclusions_count INTEGER DEFAULT 0').catch(() => {}),
    query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS entries_count INTEGER DEFAULT 0').catch(() => {}),
    query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS price_krw NUMERIC(12,0)').catch(() => {}),
    query('ALTER TABLE orders ALTER COLUMN round_number TYPE TEXT USING round_number::text').catch(() => {}),
    query(`ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'closed'`).catch(() => {}),
    query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='albums_bought' AND data_type='integer') THEN ALTER TABLE orders ALTER COLUMN albums_bought TYPE JSONB USING CASE WHEN albums_bought IS NULL THEN NULL ELSE to_jsonb(albums_bought) END; END IF; END $$`).catch(() => {}),
    query('CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)').catch(() => {}),
    query('CREATE INDEX IF NOT EXISTS idx_order_items_joiner_id ON order_items(joiner_id)').catch(() => {}),
    query('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)').catch(() => {}),
    query('CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC)').catch(() => {}),
  ])
}

export async function GET(req: NextRequest) {
  await ensureOrderColumns()
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const shop_id = searchParams.get('shop_id')
  const viewAs = searchParams.get('viewAs')
  const filterByJoiner = user.role === 'joiner' || viewAs === 'joiner'
  // gom/payments and gom/pc-sorter already request ?lite=true, expecting a lighter payload — but
  // pc-sorter's "inclusion sources" dropdown (allOrders.find(...).items) actually reads the full
  // items array back out of this exact same lite-fetched list, so items can NOT be dropped for
  // lite requests without breaking that feature. The only thing safe to drop for every caller,
  // lite or not, is preview_image_url below (verified unused by every current list consumer) —
  // `lite` is accepted but currently doesn't change the query itself.
  const lite = searchParams.get('lite') === 'true'
  void lite

  // Single aggregated query — no correlated subquery per order row
  let sql = `
    SELECT
      o.*,
      row_to_json(s) AS shop,
      row_to_json(g) AS "group",
      w.display_name AS raffle_winner_name,
      COALESCE(agg.items, '[]'::json) AS items
    FROM orders o
    LEFT JOIN shops s ON s.id = o.shop_id
    LEFT JOIN groups g ON g.id = o.group_id
    LEFT JOIN fancalls f ON f.order_id = o.id
    LEFT JOIN profiles w ON w.id = f.raffle_winner_id
    LEFT JOIN (
      SELECT order_id, json_agg(oi ORDER BY oi.created_at) AS items
      FROM order_items oi
      GROUP BY order_id
    ) agg ON agg.order_id = o.id
    WHERE 1=1
  `
  const params: any[] = []
  let i = 1
  if (filterByJoiner) {
    sql += ` AND (o.id IN (SELECT order_id FROM order_items WHERE joiner_id = $${i}) OR o.personal_joiner_id = $${i})`
    params.push(user.id); i++
  }
  if (status) { sql += ` AND o.status = $${i++}`; params.push(status) }
  if (shop_id) { sql += ` AND o.shop_id = $${i++}`; params.push(shop_id) }
  sql += ' ORDER BY o.created_at DESC'
  const rows = await query<any>(sql, params)
  // preview_image_url is a base64 data URL that can run multiple MB per order — the list view
  // never renders it (only the edit form and OrderDetail drawer do, and both fetch the single
  // order separately), so strip it here and let the frontend know it exists via a boolean flag
  // it can use to lazy-fetch the real image only when actually needed.
  for (const row of rows) {
    row.has_preview_image = !!row.preview_image_url
    row.preview_image_url = null
  }
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { type, shop_id, group_id, round_number, is_fancall, is_vce_fansign, is_multi_version, version_names, version_options, status, notes, items, deadline, ordered_at, joiner_id: personal_joiner_id, preview_image_url, hide_leftovers, payment_info, albums_bought } = await req.json()
  const addy_country = ADDY_MAP[status] || null

  const order = await queryOne(
    `INSERT INTO orders (type, shop_id, group_id, round_number, is_fancall, status, addy_country, notes, created_by, deadline, ordered_at, personal_joiner_id, preview_image_url, hide_leftovers, payment_info, is_vce_fansign, is_multi_version, version_names, version_options, albums_bought)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
    [type, shop_id || null, group_id || null, round_number || null, is_fancall, status, addy_country, notes || null, user.id, deadline || null, ordered_at || null, personal_joiner_id || null, preview_image_url || null, hide_leftovers || false, payment_info || null, is_vce_fansign || false, is_multi_version || false, version_names ? JSON.stringify(version_names) : null, version_options ? JSON.stringify(version_options) : null, albums_bought != null ? JSON.stringify(albums_bought) : null]
  )
  if (!order) return NextResponse.json({ error: 'Insert failed' }, { status: 500 })

  if (items?.length) {
    for (const item of items) {
      await query(
        `INSERT INTO order_items (order_id, member_id, joiner_id, pricing_type, description, amount_claimed, price_eur, price_krw, weight_g, item_type, inclusions_count, entries_count, claim_group_id, weight_variant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [order.id, item.member_id || null, item.joiner_id || null, item.pricing_type, item.description || null,
          item.amount_claimed || 1, item.price_eur || null, (item.price_krw != null && item.price_krw !== '' ? item.price_krw : null), item.weight_g || null, item.item_type || 'photocard', (item.inclusions_count > 0 ? item.inclusions_count : (item.description && item.description.toLowerCase().includes('inclu') ? (item.amount_claimed || 1) : 0)), item.entries_count || 0, item.claim_group_id || null, item.weight_variant_id || null]
      )
    }
  }

  if (is_fancall && shop_id) {
    await query('INSERT INTO fancalls (order_id, shop_id) VALUES ($1,$2)', [order.id, shop_id])
  }

  return NextResponse.json(order, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { id, shop_id, group_id, round_number, is_fancall, is_vce_fansign, is_multi_version, version_names, version_options, status, notes, type, items, deadline, ordered_at, joiner_id: personal_joiner_id, preview_image_url, hide_leftovers, payment_info, albums_bought } = body
  const addy_country = ADDY_MAP[status] || null

  if (body.krw_updates && id) {
    for (const u of body.krw_updates) {
      await query(`UPDATE order_items SET price_krw=$1 WHERE order_id=$2 AND (description=$3 OR description IS NULL AND $3 IS NULL) AND (price_eur=$4 OR price_eur IS NULL AND $4 IS NULL)`,
        [u.price_krw || null, id, u.label || null, u.price_eur || null])
    }
    return NextResponse.json({ ok: true })
  }

  const isStatusOnly = status && !type && !shop_id && items === undefined && deadline === undefined && ordered_at === undefined && !notes
  if (isStatusOnly) {
    const order = await queryOne(`UPDATE orders SET status=$1, addy_country=$2, updated_at=now() WHERE id=$3 RETURNING *`, [status, addy_country, id])
    const shopRow = order ? await queryOne('SELECT s.name FROM shops s JOIN orders o ON o.shop_id=s.id WHERE o.id=$1', [id]).catch(() => null) : null
    await notifyJoiners(id, status, (shopRow as any)?.name || null)
    if (addy_country && ['KR','CN','JP'].includes(addy_country)) {
      await query(`ALTER TABLE addy_items ADD COLUMN IF NOT EXISTS picture_url TEXT`).catch(() => {})
      const exists = await queryOne('SELECT id FROM addy_items WHERE order_id=$1 AND country=$2', [id, addy_country])
      if (!exists) await query(`INSERT INTO addy_items (country, order_id, arrived_at) VALUES ($1,$2,now())`, [addy_country, id])
    }
    return NextResponse.json(order)
  }

  const order = await queryOne(
    `UPDATE orders SET
       type=COALESCE($1,type), shop_id=COALESCE($2,shop_id), group_id=$3,
       round_number=$4, is_fancall=COALESCE($5,is_fancall),
       status=$6, addy_country=$7, notes=$8, deadline=$9, ordered_at=$10,
       personal_joiner_id=$11, preview_image_url=COALESCE($12, preview_image_url), hide_leftovers=$13, payment_info=COALESCE($15, payment_info), is_vce_fansign=COALESCE($16, is_vce_fansign), is_multi_version=COALESCE($17, is_multi_version), version_names=COALESCE($18, version_names), version_options=COALESCE($19, version_options), albums_bought=$20, updated_at=now()
     WHERE id=$14 RETURNING *`,
    [type || null, shop_id || null, group_id || null, round_number || null, is_fancall ?? null, status, addy_country, notes || null, deadline || null, ordered_at || null, personal_joiner_id || null, preview_image_url || null, hide_leftovers ?? false, id, payment_info || null, is_vce_fansign ?? null, is_multi_version ?? null, version_names ? JSON.stringify(version_names) : null, version_options ? JSON.stringify(version_options) : null, albums_bought != null ? JSON.stringify(albums_bought) : null]
  )

  if (is_fancall === true) {
    const existing = await queryOne('SELECT id FROM fancalls WHERE order_id=$1', [(order as any).id]).catch(() => null)
    if (!existing) await query('INSERT INTO fancalls (order_id, shop_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [(order as any).id, shop_id || (order as any).shop_id || null]).catch(() => {})
  }

  if (addy_country && ['KR','CN','JP'].includes(addy_country)) {
    await query(`ALTER TABLE addy_items ADD COLUMN IF NOT EXISTS picture_url TEXT`).catch(() => {})
    const exists = await queryOne('SELECT id FROM addy_items WHERE order_id=$1 AND country=$2', [id, addy_country])
    if (!exists) await query(`INSERT INTO addy_items (country, order_id, arrived_at) VALUES ($1,$2,now())`, [addy_country, id])
  }

  if (items !== undefined) {
    await query('DELETE FROM order_items WHERE order_id=$1', [id])
    for (const item of (items || [])) {
      await query(
        `INSERT INTO order_items (order_id, member_id, joiner_id, pricing_type, description, amount_claimed, price_eur, price_krw, weight_g, item_type, inclusions_count, entries_count, version_name, claim_group_id, weight_variant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [id, item.member_id || null, item.joiner_id || null, item.pricing_type || 'custom', item.description || null, item.amount_claimed || 1, item.price_eur || null, (item.price_krw != null && item.price_krw !== '' ? item.price_krw : null), item.weight_g || null, item.item_type || 'photocard', (item.inclusions_count > 0 ? item.inclusions_count : (item.description && item.description.toLowerCase().includes('inclu') ? (item.amount_claimed || 1) : 0)), item.entries_count || 0, item.version_name || null, item.claim_group_id || null, item.weight_variant_id || null]
      )
    }
  }

  if (status) {
    const shopRow = await queryOne('SELECT s.name FROM shops s JOIN orders o ON o.shop_id=s.id WHERE o.id=$1', [id]).catch(() => null)
    await notifyJoiners(id, status, (shopRow as any)?.name || null)
  }

  return NextResponse.json(order)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await req.json()
  await query('DELETE FROM orders WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
