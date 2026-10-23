import { query, queryOne } from './db'

// ============================================================
// ERAS + SEMI-FIXED SPOTS
//
// An ERA belongs to one group (one album cycle). Orders can be tagged with at most one era
// (orders.era_id). Each era carries two settings:
//   - events_per_round: how many events (orders) a semi-fixed joiner must join for one round
//   - renewal_days:     how many days a joiner has to renew once their round is complete
//
// A SEMI-FIXED SPOT ties a joiner + member(s) to an era. While the spot is held, the joiner is
// auto-added to new orders of that era (like fixed joiners) and gets +1 raffle entry on fancall
// orders of the group they're in.
//
// Progress: every distinct order of the era in which the joiner has at least one claim counts as
// one event (several claims in one order = 1 event; lost claims don't count because their
// joiner_id is cleared). progress = events - events_used, where events_used is the total
// already "spent" by previous rounds. When progress reaches events_per_round:
//   → renewal_requested_at is set and the joiner is notified.
//   → the joiner clicks Renew: events_used += events_per_round (extras carry over), round + 1.
//   → if they don't renew within renewal_days, the spot is LOST.
// Ending an era ends every spot in it (status 'ended').
//
// There's no cron: refreshSpots() runs whenever spots are read or an order is saved, so the
// renewal request / expiry is applied the next time anyone loads a relevant page.
//
// Id columns are TEXT with ::text comparisons (no FKs) so this works whether the live DB uses
// TEXT or UUID ids.
// ============================================================

let schemaDone = false
export async function ensureSemiFixedSchema() {
  if (schemaDone) return
  schemaDone = true
  await query(`
    CREATE TABLE IF NOT EXISTS eras (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      group_id TEXT NOT NULL,
      name TEXT NOT NULL,
      events_per_round INTEGER NOT NULL DEFAULT 5,
      renewal_days INTEGER NOT NULL DEFAULT 7,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TIMESTAMPTZ DEFAULT now(),
      ended_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    )`).catch(() => {})
  await query(`
    CREATE TABLE IF NOT EXISTS semi_fixed_spots (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      era_id TEXT NOT NULL,
      joiner_id TEXT NOT NULL,
      member_ids JSONB NOT NULL DEFAULT '[]',
      round INTEGER NOT NULL DEFAULT 1,
      events_used INTEGER NOT NULL DEFAULT 0,
      renewal_requested_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'active',
      ended_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    )`).catch(() => {})
  await Promise.all([
    query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS era_id TEXT DEFAULT NULL').catch(() => {}),
    // Orders ticked "Don't count for semi-fixed" stay in the era but aren't counted as events
    query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS exclude_from_semi_fixed BOOLEAN DEFAULT false').catch(() => {}),
    query('CREATE INDEX IF NOT EXISTS idx_orders_era_id ON orders(era_id)').catch(() => {}),
    query('CREATE INDEX IF NOT EXISTS idx_eras_group_id ON eras(group_id)').catch(() => {}),
    query('CREATE INDEX IF NOT EXISTS idx_sfs_era_id ON semi_fixed_spots(era_id)').catch(() => {}),
    query('CREATE INDEX IF NOT EXISTS idx_sfs_joiner_id ON semi_fixed_spots(joiner_id)').catch(() => {}),
  ])
}

async function notify(userId: string, message: string) {
  await query('INSERT INTO notifications (user_id, message) VALUES ($1, $2)', [userId, message]).catch(() => {})
}

// Spots joined with their era, group, joiner name and live event count.
const SPOT_SELECT = `
  SELECT s.*, e.name AS era_name, e.group_id, e.events_per_round, e.renewal_days, e.status AS era_status,
         g.name AS group_name,
         p.display_name AS joiner_display_name, p.username AS joiner_username,
         COALESCE((
           SELECT COUNT(DISTINCT o.id) FROM orders o
           JOIN order_items oi ON oi.order_id = o.id
           WHERE o.era_id = s.era_id AND NOT COALESCE(o.exclude_from_semi_fixed, false)
             AND oi.joiner_id::text = s.joiner_id AND oi.lost_claim_id IS NULL
         ), 0)::int AS events_total
  FROM semi_fixed_spots s
  JOIN eras e ON e.id = s.era_id
  LEFT JOIN groups g ON g.id::text = e.group_id
  LEFT JOIN profiles p ON p.id::text = s.joiner_id
`

export function decorateSpot(s: any) {
  const progress = Math.max(0, (s.events_total || 0) - (s.events_used || 0))
  const target = s.events_per_round || 0
  const renewalDeadline = s.renewal_requested_at
    ? new Date(new Date(s.renewal_requested_at).getTime() + (s.renewal_days || 0) * 86400000).toISOString()
    : null
  return {
    ...s,
    member_ids: Array.isArray(s.member_ids) ? s.member_ids : (() => { try { return JSON.parse(s.member_ids || '[]') } catch { return [] } })(),
    progress,
    target,
    renewal_deadline: renewalDeadline,
    // 'active' | 'awaiting_renewal' | 'lost' | 'ended'
    state: s.status !== 'active' ? s.status : (s.renewal_requested_at ? 'awaiting_renewal' : 'active'),
  }
}

// Applies renewal requests and expiries. Pass an era id, joiner id, or nothing (all active spots).
export async function refreshSpots(filter: { eraId?: string; joinerId?: string } = {}) {
  await ensureSemiFixedSchema()
  const where: string[] = [`s.status = 'active'`]
  const params: any[] = []
  if (filter.eraId) { params.push(filter.eraId); where.push(`s.era_id = $${params.length}`) }
  if (filter.joinerId) { params.push(String(filter.joinerId)); where.push(`s.joiner_id = $${params.length}`) }
  const rows = await query(`${SPOT_SELECT} WHERE ${where.join(' AND ')}`, params).catch(() => [] as any[])

  for (const raw of rows) {
    const s = decorateSpot(raw)
    const label = `${s.group_name || 'Group'} · ${s.era_name}`
    if (!s.renewal_requested_at && s.target > 0 && s.progress >= s.target) {
      await query(`UPDATE semi_fixed_spots SET renewal_requested_at = now() WHERE id = $1 AND renewal_requested_at IS NULL`, [s.id])
      await notify(s.joiner_id, `🔁 Your semi-fixed round for ${label} is complete (${s.target}/${s.target} events). Renew your spot within ${s.renewal_days} day${s.renewal_days === 1 ? '' : 's'} in My Orders to keep it.`)
    } else if (s.renewal_requested_at && s.progress < s.target) {
      // An order was excluded/removed after the round looked complete — round isn't complete anymore
      await query(`UPDATE semi_fixed_spots SET renewal_requested_at = NULL WHERE id = $1`, [s.id])
    } else if (s.renewal_requested_at && s.renewal_deadline && new Date(s.renewal_deadline).getTime() < Date.now()) {
      await query(`UPDATE semi_fixed_spots SET status = 'lost', ended_at = now() WHERE id = $1 AND status = 'active'`, [s.id])
      await notify(s.joiner_id, `Your semi-fixed spot for ${label} was released because it wasn't renewed in time.`)
    }
  }
}

export async function listSpots(filter: { eraId?: string; joinerId?: string; groupId?: string; includeClosed?: boolean } = {}) {
  await refreshSpots({ eraId: filter.eraId, joinerId: filter.joinerId })
  const where: string[] = ['1=1']
  const params: any[] = []
  if (filter.eraId) { params.push(filter.eraId); where.push(`s.era_id = $${params.length}`) }
  if (filter.joinerId) { params.push(String(filter.joinerId)); where.push(`s.joiner_id = $${params.length}`) }
  if (filter.groupId) { params.push(String(filter.groupId)); where.push(`e.group_id = $${params.length}`) }
  if (!filter.includeClosed) where.push(`s.status = 'active'`)
  const rows = await query(`${SPOT_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.created_at`, params)
  return rows.map(decorateSpot)
}

export async function renewSpot(spotId: string) {
  await ensureSemiFixedSchema()
  const row = await queryOne(`${SPOT_SELECT} WHERE s.id = $1`, [spotId])
  if (!row) throw new Error('Spot not found')
  const s = decorateSpot(row)
  if (s.status !== 'active') throw new Error('This spot is no longer active')
  if (!s.renewal_requested_at) throw new Error('This spot does not need renewing yet')
  await query(
    `UPDATE semi_fixed_spots SET events_used = events_used + $2, round = round + 1, renewal_requested_at = NULL WHERE id = $1`,
    [spotId, s.target]
  )
  // Extras carried over might already complete the next round.
  await refreshSpots({ eraId: s.era_id, joinerId: s.joiner_id })
}

// Raffle entries for one order: bought entries + bonus.
//   +2 if the joiner is a fixed joiner of the order's group
//   +1 if the joiner holds an active semi-fixed spot in an era of the order's group
// The higher bonus applies if both. Bonus only for joiners who have a claim in this order.
export async function raffleEntriesForOrder(orderId: string) {
  await ensureSemiFixedSchema()
  const order = await queryOne(`SELECT id, group_id FROM orders WHERE id::text = $1`, [orderId])
  if (!order) return []
  const rows = await query(`
    SELECT oi.joiner_id::text AS joiner_id, COALESCE(SUM(oi.entries_count), 0)::int AS base,
           MAX(p.display_name) AS display_name, MAX(p.username) AS username
    FROM order_items oi LEFT JOIN profiles p ON p.id = oi.joiner_id
    WHERE oi.order_id::text = $1 AND oi.joiner_id IS NOT NULL AND oi.lost_claim_id IS NULL
    GROUP BY oi.joiner_id`, [orderId])

  const fixedIds = new Set<string>()
  const semiIds = new Set<string>()
  if (order.group_id) {
    const g = await queryOne(`SELECT fixed_joiners FROM groups WHERE id::text = $1`, [String(order.group_id)]).catch(() => null)
    try { for (const f of JSON.parse(g?.fixed_joiners || '[]')) if (f?.joiner_id) fixedIds.add(String(f.joiner_id)) } catch {}
    await refreshSpots()
    const spots = await query(
      `SELECT s.joiner_id FROM semi_fixed_spots s JOIN eras e ON e.id = s.era_id WHERE e.group_id = $1 AND s.status = 'active'`,
      [String(order.group_id)])
    for (const s of spots) semiIds.add(String(s.joiner_id))
  }

  return rows.map((r: any) => {
    const isFixed = fixedIds.has(r.joiner_id)
    const isSemi = !isFixed && semiIds.has(r.joiner_id)
    const bonus = isFixed ? 2 : isSemi ? 1 : 0
    return {
      joiner_id: r.joiner_id,
      display_name: r.display_name || r.username || 'Unknown',
      base: r.base,
      bonus,
      bonus_type: isFixed ? 'fixed' : isSemi ? 'semi_fixed' : null,
      entries: r.base + bonus,
    }
  }).filter((e: any) => e.entries > 0)
}
