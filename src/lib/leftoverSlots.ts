import { query } from './db'

// ============================================================
// OPEN MEMBER SLOTS — member slots in an order nobody has claimed yet.
//
// Only GUARANTEED slots count — the same "Guaranteed sets" maths as the Albums Bought panel in
// Orders: with N albums bought for a group of S members, floor(N / S) full sets are guaranteed, so
// each member has that many guaranteed copies; the ones nobody claimed are open leftovers.
// Deliberately NOT included: the random remainder (N % S albums, member unknown until opened) and
// the old "level every member up to the most-claimed one" estimate for orders with no albums
// bought — neither is a copy that's actually guaranteed to exist.
// Once the order is home and the GOM has entered the copies actually received per member
// (orders.albums_received), that section uses the real numbers instead: received − claimed.
// Multi-version orders (with albums bought per version) and VCE/Fansign orders are computed per
// version. Leftover rows from lost claims still count as claimed here: they're listed separately
// as lost-claim leftovers, so counting them as open slots too would show them twice. A claim the
// GOM changed to another member (order_items.override_member_id) counts as that member.
// ============================================================

export interface SlotMember { id: string; name: string; leftover: number }
export interface SlotSection { versionLabel?: string; members: SlotMember[]; type: 'album' | 'standard' }
export interface SlotOrder { id: string; label: string; type: string; status: string; group_id: string | null; sections: SlotSection[] }

let receivedColDone = false

export async function computeOpenSlots(orderId?: string | null): Promise<SlotOrder[]> {
  if (!receivedColDone) {
    await query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS albums_received JSONB DEFAULT NULL').catch(() => {})
    receivedColDone = true
  }
  const orders = await query(`
    SELECT
      o.id, o.status, o.type, o.round_number, o.albums_bought, o.albums_received, o.is_vce_fansign, o.is_multi_version, o.version_names,
      s.name AS shop_name, g.id AS group_id, g.name AS group_name,
      (SELECT json_agg(json_build_object('id', m.id, 'name', m.name) ORDER BY m.sort_order NULLS LAST, m.name)
         FROM members m WHERE m.group_id = g.id) AS group_members,
      (SELECT json_agg(json_build_object('member_id', COALESCE(oi.override_member_id, oi.member_id), 'description', oi.description, 'version_name', oi.version_name))
         FROM order_items oi WHERE oi.order_id = o.id) AS items
    FROM orders o
    LEFT JOIN shops s ON s.id = o.shop_id
    LEFT JOIN groups g ON g.id = o.group_id
    WHERE o.status != 'closed' AND o.hide_leftovers IS NOT TRUE
      AND ($1::uuid IS NULL OR o.id = $1::uuid)
    ORDER BY o.created_at DESC
  `, [orderId || null]) as any[]

  const results: SlotOrder[] = []
  for (const order of orders) {
    const groupMembers: { id: string; name: string }[] = order.group_members || []
    const items: { member_id: string | null; description: string | null; version_name: string | null }[] = order.items || []
    const setSize = groupMembers.length
    const albumsBought = order.albums_bought
    const isPerVersion = albumsBought && typeof albumsBought === 'object'
    const label = [order.group_name, order.round_number ? `R${order.round_number}` : null, order.shop_name].filter(Boolean).join(' · ')

    let received: Record<string, Record<string, number>> = {}
    try { received = typeof order.albums_received === 'string' ? JSON.parse(order.albums_received) : (order.albums_received || {}) } catch { }

    const compute = (filtered: typeof items, bought: number | null, versionLabel?: string): SlotSection | null => {
      if (setSize < 2) return null
      const counts: Record<string, number> = {}
      for (const m of groupMembers) counts[m.id] = 0
      for (const it of filtered) if (it.member_id && counts[it.member_id] !== undefined) counts[it.member_id]++
      const list = groupMembers.map(m => ({ id: m.id, name: m.name, count: counts[m.id] }))
      // Real copies entered by the GOM once the order is home (Albums Bought panel) replace the
      // guaranteed-sets estimate: leftover = received − claimed, random albums included.
      const real = received[versionLabel || '__all__']
      if (bought != null && real && typeof real === 'object') {
        const members = list.map(m => ({ id: m.id, name: m.name, leftover: Math.max(0, (parseInt(real[m.id] as any) || 0) - m.count) })).filter(m => m.leftover > 0)
        return members.length ? { versionLabel, members, type: 'album' } : null
      }
      if (bought != null) {
        const sets = Math.floor(bought / setSize)
        const members = list.map(m => ({ id: m.id, name: m.name, leftover: Math.max(0, sets - m.count) })).filter(m => m.leftover > 0)
        return members.length ? { versionLabel, members, type: 'album' } : null
      }
      // No albums bought → nothing is guaranteed yet, so no leftover slots.
      return null
    }

    const sections: SlotSection[] = []
    if (order.is_multi_version && isPerVersion) {
      let names: string[] = []
      try { names = Array.isArray(order.version_names) ? order.version_names : JSON.parse(order.version_names || '[]') } catch { }
      for (const vn of names) {
        const vItems = items.filter(i => i.version_name === vn || (i.description || '').toLowerCase().includes(vn.toLowerCase()))
        const bought = (albumsBought as any)[vn] ?? null
        const s = compute(vItems, bought != null ? parseInt(bought) : null, vn)
        if (s) sections.push(s)
      }
    } else if (order.is_vce_fansign && isPerVersion) {
      for (const [key, lbl] of [['vce', 'VCE'], ['fansign', 'Fansign']]) {
        const vItems = items.filter(i => new RegExp(key, 'i').test(i.description || ''))
        const bought = (albumsBought as any)[key] ?? null
        const s = compute(vItems, bought != null ? parseInt(bought) : null, lbl)
        if (s) sections.push(s)
      }
    } else {
      const bought = albumsBought != null ? (typeof albumsBought === 'number' ? albumsBought : parseInt(albumsBought)) : null
      const s = compute(items, bought)
      if (s) sections.push(s)
    }
    if (sections.length) results.push({ id: order.id, label, type: order.type, status: order.status, group_id: order.group_id, sections })
  }
  return results
}

// How many open slots a member has in an order (optionally for one version section).
export async function openSlotCount(orderId: string, memberId: string, versionLabel?: string | null): Promise<number> {
  const [order] = await computeOpenSlots(orderId)
  if (!order) return 0
  const sec = order.sections.find(s => (s.versionLabel || null) === (versionLabel || null))
  return sec?.members.find(m => m.id === memberId)?.leftover || 0
}

// ── Pricing options a slot can be claimed with ─────────────────────────────────

export interface SlotOption {
  key: string
  description: string | null
  price_eur: number | null
  price_krw: number | null
  item_type: string
  weight_g: number | null
  weight_variant_id: string | null
  version_name: string | null
  inclusions_count: number   // per member — see below
  entries_count: number
}

const optKey = (o: { version_name: string | null; description: string | null; price_eur: number | null; item_type: string }) =>
  `${o.version_name || ''}|${o.description || ''}|${o.price_eur ?? ''}|${o.item_type || 'photocard'}`

// The order's existing pricing options, read from its claim rows (and, for multi-version orders,
// the saved per-version options too, so an option nobody claimed yet is still offered). Scoped to
// the slot's version section when it has one. A claim line's "Inclusions" number covers the whole
// line, so it's divided by the line's member rows to get a one-member value (e.g. "4 POBs + 4
// inclusions" → 1 inclusion for one slot).
export async function getSlotOptions(orderId: string, versionLabel?: string | null): Promise<SlotOption[]> {
  const order = (await query(`SELECT id, is_multi_version, is_vce_fansign, version_options FROM orders WHERE id=$1`, [orderId]))[0]
  if (!order) return []
  const rows = await query(`
    SELECT description, price_eur, price_krw, COALESCE(item_type, 'photocard') AS item_type, weight_g, weight_variant_id,
      version_name, COALESCE(inclusions_count, 0) AS inclusions_count, COALESCE(entries_count, 0) AS entries_count,
      amount_claimed, claim_group_id
    FROM order_items WHERE order_id=$1 AND lost_claim_id IS NULL ORDER BY created_at
  `, [orderId]).catch(() => [] as any[])

  const groupSize: Record<string, number> = {}
  for (const r of rows) if (r.claim_group_id) groupSize[r.claim_group_id] = (groupSize[r.claim_group_id] || 0) + (r.amount_claimed || 1)

  const out = new Map<string, SlotOption>()
  const add = (o: Omit<SlotOption, 'key'>) => {
    const key = optKey(o)
    if (!out.has(key)) out.set(key, { key, ...o })
  }
  for (const r of rows) {
    const size = r.claim_group_id ? (groupSize[r.claim_group_id] || 1) : 1
    const incl = parseInt(r.inclusions_count) || 0
    add({
      description: r.description, price_eur: r.price_eur != null ? parseFloat(r.price_eur) : null,
      price_krw: r.price_krw != null ? parseFloat(r.price_krw) : null, item_type: r.item_type,
      weight_g: r.weight_g != null ? parseFloat(r.weight_g) : null, weight_variant_id: r.weight_variant_id || null,
      version_name: r.version_name || null, inclusions_count: incl > 0 ? Math.max(1, Math.round(incl / size)) : 0,
      entries_count: Math.round((parseInt(r.entries_count) || 0) / (r.amount_claimed || 1)),
    })
  }
  if (order.is_multi_version) {
    let vo: any[] = []
    try { vo = Array.isArray(order.version_options) ? order.version_options : JSON.parse(order.version_options || '[]') } catch { }
    for (const v of vo || []) for (const o of v.options || []) {
      add({
        description: o.label || null, price_eur: o.price_eur !== '' && o.price_eur != null ? parseFloat(o.price_eur) : null,
        price_krw: o.price_krw !== '' && o.price_krw != null ? parseFloat(o.price_krw) : null, item_type: o.weight_category || 'photocard',
        weight_g: o.weight_g !== '' && o.weight_g != null ? parseFloat(o.weight_g) : null, weight_variant_id: o.weight_variant_id || null,
        version_name: v.name || null, inclusions_count: /inclu/i.test(o.label || '') ? 1 : 0,
        entries_count: o.entries ? parseInt(o.entries) || 0 : 0,
      })
    }
  }

  let list = [...out.values()]
  if (versionLabel) {
    if (order.is_multi_version) list = list.filter(o => o.version_name === versionLabel)
    else if (order.is_vce_fansign) list = list.filter(o => new RegExp(versionLabel, 'i').test(o.description || ''))
  }
  // Late fees aren't something to claim.
  return list.filter(o => !/late.?fee/i.test(o.description || ''))
}
