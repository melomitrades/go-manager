import { query, queryOne } from './db'

// ============================================================
// PC SORTER — shared schema migration, inclusion auto-fill,
// and the two sort algorithms (timestamp / fair).
//
// Design notes (see the redesign writeup for the full rationale):
//  - A session can contain multiple "packs" (e.g. Ver. A / Ver. B).
//  - Each pack contains one or more "items" (photocard, postcard,
//    lenticular, ...). One "inclusion" for a pack = exactly one of
//    EVERY item in that pack.
//  - Joiners rank members fully independently PER ITEM.
//  - Ownership ("already has this item") is tracked by matching
//    pack NAME + item NAME across sessions (so name your packs/items
//    consistently across boxes if you want ownership to carry over).
//  - Once a joiner already owns every distinct member available for
//    an item, they become "exhausted" for that item and are allowed
//    to receive a repeat (round 2+) rather than nothing — this is
//    what the spec calls "start a new round of item".
// ============================================================

let pcSorterMigDone = false
export async function ensurePcSorterSchema() {
  if (pcSorterMigDone) return
  pcSorterMigDone = true
  const stmts = [
    // Sessions: keep existing columns, add the new ones this redesign needs
    `ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ`,
    `ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS box_id UUID REFERENCES boxes(id) ON DELETE SET NULL`,
    `ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS order_ids JSONB DEFAULT NULL`,
    `ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS sort_method TEXT`,
    `ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS sort_run_at TIMESTAMPTZ`,

    // Packs (was "versions") — one or more per session
    `CREATE TABLE IF NOT EXISTS pc_packs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID REFERENCES pc_sorting_sessions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    )`,

    // Items within a pack (photocard, postcard, lenticular, ...)
    `CREATE TABLE IF NOT EXISTS pc_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pack_id UUID REFERENCES pc_packs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    )`,

    // Quantity pulled per member per item
    `CREATE TABLE IF NOT EXISTS pc_item_quantities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id UUID REFERENCES pc_items(id) ON DELETE CASCADE,
      member_id UUID REFERENCES members(id) ON DELETE SET NULL,
      total_pulled INTEGER NOT NULL DEFAULT 0,
      available INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(item_id, member_id)
    )`,

    // How many full packs (inclusions) each joiner is due, per pack
    `CREATE TABLE IF NOT EXISTS pc_pack_inclusions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID REFERENCES pc_sorting_sessions(id) ON DELETE CASCADE,
      pack_id UUID REFERENCES pc_packs(id) ON DELETE CASCADE,
      joiner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
      inclusions_assigned INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(pack_id, joiner_id)
    )`,

    // pc_priority_forms already exists (id, session_id, joiner_id, submitted_at, form_data).
    // We now need exactly one form per (session, joiner) — enforce it.
    `CREATE UNIQUE INDEX IF NOT EXISTS pc_priority_forms_session_joiner_uidx ON pc_priority_forms(session_id, joiner_id)`,

    // Individual ranked entries — one row per (form, item, member). This replaces the old
    // flat JSON blob and is what fixes the "priorities never actually get read" bug.
    `CREATE TABLE IF NOT EXISTS pc_priority_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      form_id UUID REFERENCES pc_priority_forms(id) ON DELETE CASCADE,
      item_id UUID REFERENCES pc_items(id) ON DELETE CASCADE,
      member_id UUID REFERENCES members(id) ON DELETE CASCADE,
      priority INTEGER NOT NULL,
      UNIQUE(form_id, item_id, member_id)
    )`,

    // pc_assignments already exists (id, session_id, joiner_id, photocard_id, sort_method, created_at).
    // Add the columns the new algorithm actually needs.
    `ALTER TABLE pc_assignments ADD COLUMN IF NOT EXISTS pack_id UUID`,
    `ALTER TABLE pc_assignments ADD COLUMN IF NOT EXISTS item_id UUID`,
    `ALTER TABLE pc_assignments ADD COLUMN IF NOT EXISTS member_id UUID`,
    `ALTER TABLE pc_assignments ADD COLUMN IF NOT EXISTS round INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE pc_assignments ADD COLUMN IF NOT EXISTS is_repeat BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE pc_assignments ADD COLUMN IF NOT EXISTS is_random BOOLEAN NOT NULL DEFAULT false`,
  ]
  for (const sql of stmts) {
    // Unlike the old ensureTables() blocks, we log failures instead of swallowing them
    // completely blind — a migration failure here should be visible in server logs.
    await query(sql).catch(err => console.error('[pc-sorter migration failed]', sql.slice(0, 70).replace(/\s+/g, ' '), '—', err?.message))
  }
}

// ── Auto-fill / refresh pack inclusions from the session's SELECTED orders ──────────
// Deliberately scoped to session_row.order_ids only — NOT every order linked to the box.
// A session only counts the orders the GOM explicitly checked off for it. Within those
// orders, an inclusion comes from either: (a) a line with inclusions_count explicitly set,
// or (b) a line whose description mentions "album" — those are album claims and should
// feed the sort even if nobody bothered to fill in an inclusions_count for them. A line
// that qualifies both ways is only counted once (inclusions_count wins).
export async function autoFillInclusions(sessionId: string) {
  await ensurePcSorterSchema()
  const sessionRow = await queryOne<any>(`SELECT * FROM pc_sorting_sessions WHERE id=$1`, [sessionId])
  if (!sessionRow) throw new Error('Session not found')

  const packs = await query<any>(`SELECT * FROM pc_packs WHERE session_id=$1 ORDER BY sort_order, created_at`, [sessionId])
  if (!packs.length) return { assignments: [] as any[] }

  const orderIds: string[] = (() => {
    try {
      const o = sessionRow.order_ids
      if (!o) return []
      return Array.isArray(o) ? o : JSON.parse(o)
    } catch { return [] }
  })()

  // No orders selected for this session → nothing to auto-fill from. No fallback to the
  // whole box: only the orders the GOM explicitly picked for this session count.
  if (orderIds.length === 0) return { assignments: [] as any[] }

  const joinerTotals: Record<string, number> = {}
  for (const oid of orderIds) {
    const items = await query<any>(`
      SELECT COALESCE(oi.joiner_id, o.personal_joiner_id) AS joiner_id,
             CASE
               WHEN COALESCE(oi.inclusions_count, 0) > 0 THEN oi.inclusions_count
               WHEN oi.description ILIKE '%album%' THEN COALESCE(oi.amount_claimed, 1)
               ELSE 0
             END AS effective_inclusions
      FROM order_items oi
      LEFT JOIN orders o ON o.id = oi.order_id
      WHERE oi.order_id = $1
        AND COALESCE(oi.joiner_id, o.personal_joiner_id) IS NOT NULL
        AND (COALESCE(oi.inclusions_count, 0) > 0 OR oi.description ILIKE '%album%')
    `, [oid]).catch(() => [] as any[])
    for (const it of items) {
      joinerTotals[it.joiner_id] = (joinerTotals[it.joiner_id] || 0) + (parseInt(it.effective_inclusions) || 0)
    }
  }

  const packTotals: Record<string, number> = {}
  for (const p of packs) packTotals[p.id] = 0

  const rows: { joiner_id: string; pack_id: string; inclusions_assigned: number }[] = []
  const entries = Object.entries(joinerTotals)
  const multi = entries.filter(([, t]) => t > 1)
  const single = entries.filter(([, t]) => t === 1)

  // Joiners with >1 inclusion: split evenly across packs, remainder to earlier packs
  for (const [joinerId, total] of multi) {
    const base = Math.floor(total / packs.length)
    const remainder = total % packs.length
    packs.forEach((p: any, i: number) => {
      const count = base + (i < remainder ? 1 : 0)
      if (count > 0) rows.push({ joiner_id: joinerId, pack_id: p.id, inclusions_assigned: count })
      packTotals[p.id] += count
    })
  }
  // Joiners with exactly 1 inclusion: assign to whichever pack currently has the lowest total (balancing)
  for (const [joinerId] of single) {
    const target = packs.reduce((best: any, p: any) => (packTotals[p.id] < packTotals[best.id] ? p : best), packs[0])
    rows.push({ joiner_id: joinerId, pack_id: target.id, inclusions_assigned: 1 })
    packTotals[target.id] += 1
  }

  for (const r of rows) {
    await query(`
      INSERT INTO pc_pack_inclusions (session_id, pack_id, joiner_id, inclusions_assigned)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (pack_id, joiner_id) DO UPDATE SET inclusions_assigned = $4
    `, [sessionId, r.pack_id, r.joiner_id, r.inclusions_assigned])
  }

  return { assignments: rows }
}

// ── Sort algorithm internals ─────────────────────────────────────────

interface RankEntry { member_id: string; priority: number }
interface ItemCtx {
  stock: Map<string, number>                 // member_id -> available
  need: Map<string, number>                   // joiner_id -> remaining units needed
  ranking: Map<string, RankEntry[]>            // joiner_id -> sorted priority list
  submittedAt: Map<string, Date>               // joiner_id -> form submission time
  ownSet: Set<string>                          // `${joiner_id}|${member_id}` already owned (cross-session + this run)
}
interface AssignResult { joiner_id: string; member_id: string; round: number; is_repeat: boolean; is_random: boolean }

function isExhausted(list: RankEntry[], joinerId: string, ownSet: Set<string>): boolean {
  return list.length > 0 && list.every(e => ownSet.has(`${joinerId}|${e.member_id}`))
}

function tryAssignOne(list: RankEntry[], joinerId: string, ctx: ItemCtx, allowOwned: boolean): { member_id: string } | null {
  for (const e of list) {
    const owned = ctx.ownSet.has(`${joinerId}|${e.member_id}`)
    if (owned && !allowOwned) continue
    const avail = ctx.stock.get(e.member_id) || 0
    if (avail <= 0) continue
    ctx.stock.set(e.member_id, avail - 1)
    ctx.ownSet.add(`${joinerId}|${e.member_id}`)
    return { member_id: e.member_id }
  }
  return null
}

// Timestamp sort: process joiners strictly in submission order. Each joiner's units are
// filled one at a time by walking their own ranked list top-down.
function timestampSort(ctx: ItemCtx): AssignResult[] {
  const joinerIds = [...ctx.need.keys()]
    .filter(j => (ctx.need.get(j) || 0) > 0 && ctx.ranking.has(j))
    .sort((a, b) => (ctx.submittedAt.get(a)?.getTime() || 0) - (ctx.submittedAt.get(b)?.getTime() || 0))

  const results: AssignResult[] = []
  let round = 1

  for (const joinerId of joinerIds) {
    const list = ctx.ranking.get(joinerId) || []
    const n = ctx.need.get(joinerId) || 0
    for (let unit = 0; unit < n; unit++) {
      const wasExhausted = isExhausted(list, joinerId, ctx.ownSet)
      let assigned = tryAssignOne(list, joinerId, ctx, false)
      let isRepeat = false
      if (!assigned && wasExhausted) {
        assigned = tryAssignOne(list, joinerId, ctx, true)
        isRepeat = true
        round = Math.max(round, 2)
      }
      if (assigned) results.push({ joiner_id: joinerId, member_id: assigned.member_id, round: isRepeat ? 2 : 1, is_repeat: isRepeat, is_random: false })
      // else: this unit is unfulfilled (no stock left anywhere in their list) — just move on
    }
  }
  return results
}

// Fair sort: round-by-round, level-by-level. At each priority level, every joiner who still
// needs a unit and named a member at that level competes simultaneously for it; ties broken
// by earliest form submission. Losers cascade to their next level. Once a joiner already owns
// every distinct member in their ranking, they're allowed to re-compete for repeats ("new round").
function fairSort(ctx: ItemCtx): AssignResult[] {
  const results: AssignResult[] = []
  const maxLevel = Math.max(0, ...[...ctx.ranking.values()].map(l => l.length))
  if (maxLevel === 0) return results

  let round = 1
  let progressed = true
  const MAX_ROUNDS = 25 // safety cap against pathological loops

  while (progressed && round <= MAX_ROUNDS) {
    progressed = false
    for (let level = 1; level <= maxLevel; level++) {
      const contenders = new Map<string, string[]>() // member_id -> joiner_ids competing for it at this level

      for (const [joinerId, list] of ctx.ranking) {
        if ((ctx.need.get(joinerId) || 0) <= 0) continue
        const entry = list[level - 1]
        if (!entry) continue
        const exhausted = isExhausted(list, joinerId, ctx.ownSet)
        const owned = ctx.ownSet.has(`${joinerId}|${entry.member_id}`)
        if (owned && !exhausted) continue // normal case: already has it, skip to their next level
        if (!contenders.has(entry.member_id)) contenders.set(entry.member_id, [])
        contenders.get(entry.member_id)!.push(joinerId)
      }

      for (const [memberId, joinerIds] of contenders) {
        let avail = ctx.stock.get(memberId) || 0
        if (avail <= 0) continue
        const ordered = joinerIds.slice().sort((a, b) => (ctx.submittedAt.get(a)?.getTime() || 0) - (ctx.submittedAt.get(b)?.getTime() || 0))
        for (const joinerId of ordered) {
          if (avail <= 0) break
          const wasOwned = ctx.ownSet.has(`${joinerId}|${memberId}`)
          avail -= 1
          ctx.stock.set(memberId, avail)
          ctx.ownSet.add(`${joinerId}|${memberId}`)
          ctx.need.set(joinerId, (ctx.need.get(joinerId) || 0) - 1)
          results.push({ joiner_id: joinerId, member_id: memberId, round, is_repeat: wasOwned, is_random: false })
          progressed = true
        }
      }
    }
    round += 1
  }
  return results
}

// Joiners who never submitted a priority form at all (not "ranked this item low" — never
// filled out the form for this session, period) still get served: whatever stock is left
// after every joiner who DID submit has been processed gets handed out to them at random.
// Same ownership rule applies — skip members they already own until every option is
// exhausted, then allow a repeat. Both the joiner order and the member picked are randomized.
function randomFillUnsubmitted(ctx: ItemCtx, submittedJoinerIds: Set<string>): AssignResult[] {
  const results: AssignResult[] = []
  const joinerIds = [...ctx.need.keys()].filter(j => (ctx.need.get(j) || 0) > 0 && !submittedJoinerIds.has(j))
  // shuffle so no joiner is systematically favored when leftover stock is scarce
  for (let i = joinerIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[joinerIds[i], joinerIds[j]] = [joinerIds[j], joinerIds[i]]
  }

  for (const joinerId of joinerIds) {
    const n = ctx.need.get(joinerId) || 0
    for (let unit = 0; unit < n; unit++) {
      const notOwned = [...ctx.stock.entries()].filter(([memberId, avail]) => avail > 0 && !ctx.ownSet.has(`${joinerId}|${memberId}`))
      const pool = notOwned.length > 0 ? notOwned : [...ctx.stock.entries()].filter(([, avail]) => avail > 0)
      if (pool.length === 0) break // nothing left in stock at all for this item

      const [memberId] = pool[Math.floor(Math.random() * pool.length)]
      const wasOwned = ctx.ownSet.has(`${joinerId}|${memberId}`)
      ctx.stock.set(memberId, (ctx.stock.get(memberId) || 0) - 1)
      ctx.ownSet.add(`${joinerId}|${memberId}`)
      ctx.need.set(joinerId, (ctx.need.get(joinerId) || 0) - 1)
      results.push({ joiner_id: joinerId, member_id: memberId, round: 0, is_repeat: wasOwned, is_random: true })
    }
  }
  return results
}

// ── Orchestration: run the sort for every pack/item in a session ────
export async function runPcSort(sessionId: string, method: 'timestamp' | 'fair') {
  await ensurePcSorterSchema()

  const packs = await query<any>(`SELECT * FROM pc_packs WHERE session_id=$1 ORDER BY sort_order, created_at`, [sessionId])
  if (!packs.length) return { assigned: 0, unfulfilled: 0 }

  const items = await query<any>(`SELECT * FROM pc_items WHERE pack_id = ANY(SELECT id FROM pc_packs WHERE session_id=$1) ORDER BY sort_order, created_at`, [sessionId])
  const quantities = await query<any>(`
    SELECT * FROM pc_item_quantities
    WHERE item_id = ANY(SELECT id FROM pc_items WHERE pack_id = ANY(SELECT id FROM pc_packs WHERE session_id=$1))
  `, [sessionId])
  const inclusions = await query<any>(`SELECT * FROM pc_pack_inclusions WHERE session_id=$1`, [sessionId])
  const forms = await query<any>(`SELECT * FROM pc_priority_forms WHERE session_id=$1`, [sessionId])
  const entries = await query<any>(`SELECT * FROM pc_priority_entries WHERE form_id = ANY(SELECT id FROM pc_priority_forms WHERE session_id=$1)`, [sessionId])

  // Cross-session ownership: match by pack NAME + item NAME (not id — different sessions have different rows)
  const ownershipRows = await query<any>(`
    SELECT DISTINCT a.joiner_id, a.member_id, pk.name as pack_name, it.name as item_name
    FROM pc_assignments a
    JOIN pc_packs pk ON pk.id = a.pack_id
    JOIN pc_items it ON it.id = a.item_id
    WHERE a.session_id != $1
  `, [sessionId])

  const entriesByForm = new Map<string, any[]>()
  for (const e of entries) {
    if (!entriesByForm.has(e.form_id)) entriesByForm.set(e.form_id, [])
    entriesByForm.get(e.form_id)!.push(e)
  }

  const submittedJoinerIds = new Set(forms.map((f: any) => f.joiner_id))

  type PendingAssignment = { pack_id: string; item_id: string; joiner_id: string; member_id: string; round: number; is_repeat: boolean; is_random: boolean }
  const pending: PendingAssignment[] = []
  let totalDemand = 0
  let totalAssigned = 0
  const finalStockByItem = new Map<string, Map<string, number>>()

  for (const pack of packs) {
    const packItems = items.filter((i: any) => i.pack_id === pack.id)
    for (const item of packItems) {
      const stock = new Map<string, number>()
      for (const q of quantities.filter((q: any) => q.item_id === item.id)) stock.set(q.member_id, q.available)

      const need = new Map<string, number>()
      for (const inc of inclusions) {
        if (inc.pack_id === pack.id && (inc.inclusions_assigned || 0) > 0) need.set(inc.joiner_id, inc.inclusions_assigned)
      }
      for (const n of need.values()) totalDemand += n

      const ranking = new Map<string, RankEntry[]>()
      const submittedAt = new Map<string, Date>()
      for (const form of forms) {
        submittedAt.set(form.joiner_id, new Date(form.submitted_at))
        const es = (entriesByForm.get(form.id) || [])
          .filter((e: any) => e.item_id === item.id)
          .sort((a: any, b: any) => a.priority - b.priority)
        if (es.length) ranking.set(form.joiner_id, es.map((e: any) => ({ member_id: e.member_id, priority: e.priority })))
      }

      const ownSet = new Set<string>()
      for (const o of ownershipRows) {
        if (o.pack_name === pack.name && o.item_name === item.name) ownSet.add(`${o.joiner_id}|${o.member_id}`)
      }

      const ctx: ItemCtx = { stock, need, ranking, submittedAt, ownSet }
      const results = method === 'timestamp' ? timestampSort(ctx) : fairSort(ctx)

      // Joiners who never submitted a form at all still get served, at random, from
      // whatever's left over once every submitter has been processed.
      const randomResults = randomFillUnsubmitted(ctx, submittedJoinerIds)

      const allResults = results.concat(randomResults)
      totalAssigned += allResults.length
      for (const r of allResults) {
        pending.push({ pack_id: pack.id, item_id: item.id, joiner_id: r.joiner_id, member_id: r.member_id, round: r.round, is_repeat: r.is_repeat, is_random: r.is_random })
      }
      finalStockByItem.set(item.id, stock)
    }
  }

  // Persist. Deliberately NOT wrapped in a swallow-all catch — if this fails, the request
  // should return a real error instead of silently pretending the sort succeeded.
  for (const a of pending) {
    await query(
      `INSERT INTO pc_assignments (session_id, pack_id, item_id, joiner_id, member_id, round, is_repeat, is_random, sort_method, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())`,
      [sessionId, a.pack_id, a.item_id, a.joiner_id, a.member_id, a.round, a.is_repeat, a.is_random, method]
    )
  }
  for (const [itemId, stock] of finalStockByItem) {
    for (const [memberId, avail] of stock) {
      await query(`UPDATE pc_item_quantities SET available=$1 WHERE item_id=$2 AND member_id=$3`, [avail, itemId, memberId])
    }
  }

  await query(
    `UPDATE pc_sorting_sessions SET form_open=false, sort_method=$1, sort_run_at=now(), updated_at=now() WHERE id=$2`,
    [method, sessionId]
  )

  return { assigned: totalAssigned, unfulfilled: Math.max(0, totalDemand - totalAssigned), totalDemand }
}
