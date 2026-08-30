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
    // Per-order album-version narrowing: { order_id: [version names to include] }. Absent key =
    // every version of that order counts (unchanged default behavior).
    `ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS order_versions JSONB DEFAULT NULL`,
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

  // Per-order album-version narrowing. A key present (even as []) means the GOM explicitly
  // chose which versions of THAT order count for this session — only those version_name values
  // are counted (an empty array means every version was deliberately excluded, so that order
  // contributes nothing). A key absent means no narrowing was set: every version of that order
  // counts, same as before this feature existed.
  const orderVersions: Record<string, string[]> = (() => {
    try {
      const ov = sessionRow.order_versions
      if (!ov) return {}
      return typeof ov === 'string' ? JSON.parse(ov) : ov
    } catch { return {} }
  })()

  const joinerTotals: Record<string, number> = {}
  for (const oid of orderIds) {
    const versions = Object.prototype.hasOwnProperty.call(orderVersions, oid) ? orderVersions[oid] : null
    const items = await query<any>(`
      SELECT COALESCE(oi.joiner_id, o.personal_joiner_id) AS joiner_id,
             oi.description, oi.version_name, oi.price_eur, oi.claim_group_id,
             (COALESCE(oi.inclusions_count, 0) > 0) AS is_explicit,
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
        AND ($2::text[] IS NULL OR oi.version_name = ANY($2::text[]))
    `, [oid, versions]).catch(() => [] as any[])
    // The Orders form lets a GOM claim one item for several members at once (e.g. "want a
    // photocard of any of these 4 members") — that becomes one order_items ROW PER MEMBER, and
    // an explicit "Inclusions" number typed for that claim is saved onto EVERY one of those
    // rows (by design — the edit form reads it back from just the first row of the group, never
    // a sum; see the comment in gom/orders/page.tsx's handleSave). So a row with an EXPLICIT
    // inclusions_count must only be counted ONCE per claim-line here too, or a claim split
    // across N members inflates its total by ×N (this is what "4 pobs + 4 inclusions showing as
    // 16" was: 4 member rows × 4 each). Rows saved after claim_group_id was introduced use that
    // as the exact grouping key (one id per original line, set at save time); older rows saved
    // before it existed fall back to a description+price+version heuristic, which can't tell two
    // genuinely separate same-priced claims apart — resaving the order fixes those permanently.
    // Rows that fall back to the "album" amount_claimed path are NOT deduped — those never had a
    // number typed in, and are always meant to add up one-per-row (one member pill = one
    // inclusion).
    const seenExplicit = new Set<string>()
    for (const it of items) {
      const amt = parseInt(it.effective_inclusions) || 0
      if (amt === 0) continue
      if (it.is_explicit) {
        const groupKey = it.claim_group_id
          ? `cg:${it.claim_group_id}`
          : `${it.joiner_id}|${it.description || ''}|${it.price_eur ?? ''}|${it.version_name || ''}`
        if (seenExplicit.has(groupKey)) continue
        seenExplicit.add(groupKey)
      }
      joinerTotals[it.joiner_id] = (joinerTotals[it.joiner_id] || 0) + amt
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

  // A true overwrite: clear every existing inclusion row for this session first, THEN insert
  // the freshly computed ones. An upsert alone (INSERT ... ON CONFLICT DO UPDATE) can only ever
  // touch joiners who still qualify — a joiner who qualified last time (or was set manually) but
  // no longer does (an order got deselected, a claim's inclusions_count got zeroed out, etc.)
  // would keep their stale number forever, which is what "the overwriting doesn't work" was about.
  await query(`DELETE FROM pc_pack_inclusions WHERE session_id=$1`, [sessionId])
  for (const r of rows) {
    await query(`
      INSERT INTO pc_pack_inclusions (session_id, pack_id, joiner_id, inclusions_assigned)
      VALUES ($1,$2,$3,$4)
    `, [sessionId, r.pack_id, r.joiner_id, r.inclusions_assigned])
  }

  return { assignments: rows }
}

// Wipe every inclusion assignment for a session back to nothing — a manual "start over" the
// GOM can reach for regardless of what auto-fill would compute (e.g. before entering numbers
// by hand, or to confirm a session really has zero inclusions left).
export async function resetInclusions(sessionId: string) {
  await ensurePcSorterSchema()
  await query(`DELETE FROM pc_pack_inclusions WHERE session_id=$1`, [sessionId])
  return { ok: true }
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

  // Every run starts from a clean slate: clear this session's previous assignments and put
  // every item's available stock back to its full pulled total. Without this, a second run
  // would (a) treat "need" as ADDITIONAL on top of what joiners already got — inclusions_assigned
  // is always the full amount due, never a remaining balance — silently over-assigning on repeat
  // runs, and (b) compute against whatever stock was left over from the previous run instead of
  // the true total. This never touches pc_priority_forms / pc_priority_entries — re-running only
  // redoes the assignment step from the CURRENT inclusion counts using the forms already on file;
  // joiners never need to resubmit anything just because the GOM reran the sort.
  await query(`DELETE FROM pc_assignments WHERE session_id=$1`, [sessionId])
  await query(`
    UPDATE pc_item_quantities SET available = total_pulled
    WHERE item_id = ANY(SELECT id FROM pc_items WHERE pack_id = ANY(SELECT id FROM pc_packs WHERE session_id=$1))
  `, [sessionId])

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
