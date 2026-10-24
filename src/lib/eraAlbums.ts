import { query } from './db'
import { ensureSemiFixedSchema } from './semiFixed'
import { ensureLostClaimsSchema } from './lostClaims'

// ============================================================
// ERA ALBUM MANAGEMENT
//
// Each era is one album (eras.album_name) with several versions (era_versions: name, optional
// weight profile, optional photo). Orders of the era buy copies of those versions.
//
// One album copy = one INCLUSION PACK. Everything on the Eras page is counted in packs:
//   bought    = albums bought on the era's orders (orders.albums_bought) + extra albums
//               bought outside orders (era_extra_albums)
//   claimed   = per claim line: the larger of its "Inclusions" number (typed once per line,
//               counted once however many member rows the line was saved as) and its album
//               copies (rows with item type Album, or "album" in the option name — same rule as
//               the PC Sorter — one per row). Lost claims don't count, so they show up as unclaimed.
//   unclaimed = bought − claimed (negative = more claimed than bought)
//
// An order is split into SECTIONS, each linked to at most one era version:
//   multi-version order → one section per version name (claims by order_items.version_name)
//   VCE / Fansign order → 'vce' and 'fansign' (claims by "vce"/"fansign" in the option name)
//   any other order     → '__all__'
// The link is orders.era_version_map { section: era_version_id }. With no explicit link, a
// section whose name matches a version name (case/space-insensitive) is linked automatically,
// so existing orders link themselves; everything else is listed as "not linked".
//
// Id columns are TEXT with ::text comparisons (no FKs), like eras/semi-fixed.
// ============================================================

let schemaPromise: Promise<void> | null = null
export function ensureEraAlbumsSchema() {
  if (!schemaPromise) schemaPromise = migrate().catch(err => { schemaPromise = null; throw err })
  return schemaPromise
}
async function migrate() {
  await ensureSemiFixedSchema()
  await ensureLostClaimsSchema()
  const stmts = [
    `ALTER TABLE eras ADD COLUMN IF NOT EXISTS album_name TEXT`,
    `CREATE TABLE IF NOT EXISTS era_versions (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      era_id TEXT NOT NULL,
      name TEXT NOT NULL,
      weight_variant_id TEXT,
      photo_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_era_versions_era ON era_versions(era_id)`,
    `CREATE TABLE IF NOT EXISTS era_extra_albums (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      era_id TEXT NOT NULL,
      version_id TEXT,
      qty INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_era_extra_albums_era ON era_extra_albums(era_id)`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS era_version_map JSONB DEFAULT NULL`,
    // Read below; normally added by /api/orders' own migration.
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS albums_bought JSONB DEFAULT NULL`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_vce_fansign BOOLEAN DEFAULT false`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_multi_version BOOLEAN DEFAULT false`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS version_names JSONB DEFAULT NULL`,
    `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS version_name TEXT DEFAULT NULL`,
    `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS claim_group_id TEXT DEFAULT NULL`,
    `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS item_type TEXT DEFAULT 'photocard'`,
    `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS inclusions_count INTEGER DEFAULT 0`,
  ]
  for (const sql of stmts) {
    await query(sql).catch(err => console.error('[era-albums migration]', sql.slice(0, 60), err?.message))
  }
}

export const norm = (s: any) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

export function sectionLabel(key: string) {
  if (key === '__all__') return 'All albums'
  if (key === '__none__') return 'No version'
  if (key === 'vce') return 'VCE'
  if (key === 'fansign') return 'Fansign'
  return key
}

const parseJson = (v: any) => {
  if (v == null) return null
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch { return null }
}

export interface SectionStat { key: string; label: string; bought: number; claimed: number; version_id: string | null; linked: 'manual' | 'name' | null }

// Per-order sections with bought / claimed packs.
function orderSections(o: any, rows: any[], versions: any[]): SectionStat[] {
  const bought = parseJson(o.albums_bought)
  const map: Record<string, string> = parseJson(o.era_version_map) || {}
  const isMulti = !!o.is_multi_version
  const isVce = !!o.is_vce_fansign && !isMulti
  const names: string[] = isMulti ? (parseJson(o.version_names) || []) : []

  const sectionOf = (r: any) => {
    if (isMulti) return r.version_name && names.includes(r.version_name) ? r.version_name : (r.version_name || '__none__')
    if (isVce) { const d = String(r.description || ''); return /fansign/i.test(d) ? 'fansign' : /vce/i.test(d) ? 'vce' : '__none__' }
    return '__all__'
  }

  // Claim lines (within this order): claim_group_id, or the description/price/version fallback
  // for rows saved before claim_group_id existed.
  const lines = new Map<string, { section: string; explicit: number; albums: number }>()
  for (const r of rows) {
    const key = r.claim_group_id ? `cg:${r.claim_group_id}` : `${r.joiner_id}|${r.description || ''}|${r.price_eur ?? ''}|${r.version_name || ''}`
    if (!lines.has(key)) lines.set(key, { section: sectionOf(r), explicit: 0, albums: 0 })
    const l = lines.get(key)!
    l.explicit = Math.max(l.explicit, parseInt(r.inclusions_count) || 0)
    const isAlbum = r.item_type === 'album' || /album/i.test(String(r.description || ''))
    if (isAlbum) l.albums += parseInt(r.amount_claimed) || 1
  }
  const claimed: Record<string, number> = {}
  for (const l of lines.values()) claimed[l.section] = (claimed[l.section] || 0) + Math.max(l.explicit, l.albums)

  const boughtOf = (key: string): number => {
    if (bought == null) return 0
    if (typeof bought === 'number' || typeof bought === 'string') return key === '__all__' ? (parseInt(bought as any) || 0) : 0
    return parseInt(bought[key]) || 0
  }

  let keys: string[]
  if (isMulti) keys = Array.from(new Set([...names, ...Object.keys(claimed)]))
  else if (isVce) keys = Array.from(new Set(['vce', 'fansign', ...Object.keys(claimed)])).filter(k => boughtOf(k) > 0 || (claimed[k] || 0) > 0 || k === 'vce' || k === 'fansign')
  else keys = ['__all__', ...Object.keys(claimed).filter(k => k !== '__all__')]

  return keys.map(key => {
    const explicit = map[key]
    let version_id: string | null = null
    let linked: SectionStat['linked'] = null
    if (explicit && versions.some(v => v.id === explicit)) { version_id = explicit; linked = 'manual' }
    else if (explicit === 'none') { version_id = null }
    else {
      const m = versions.find(v => norm(v.name) === norm(sectionLabel(key)) && key !== '__all__' && key !== '__none__')
      if (m) { version_id = m.id; linked = 'name' }
    }
    return { key, label: sectionLabel(key), bought: boughtOf(key), claimed: claimed[key] || 0, version_id, linked }
  })
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

// Full stats for one or several eras. Returns one object per era id.
export async function getEraAlbumStats(eraIds: string[]) {
  await ensureEraAlbumsSchema()
  if (!eraIds.length) return {} as Record<string, any>
  const [versions, extras, orders] = await Promise.all([
    query<any>(`SELECT id, era_id, name, weight_variant_id, (photo_url IS NOT NULL) AS has_photo, sort_order, created_at
                FROM era_versions WHERE era_id = ANY($1::text[]) ORDER BY sort_order, created_at`, [eraIds]),
    query<any>(`SELECT * FROM era_extra_albums WHERE era_id = ANY($1::text[]) ORDER BY created_at`, [eraIds]),
    query<any>(`SELECT o.id::text AS id, o.era_id::text AS era_id, o.status::text AS status, o.round_number, o.created_at,
                  o.is_multi_version, o.is_vce_fansign, o.version_names, o.albums_bought, o.era_version_map, s.name AS shop_name
                FROM orders o LEFT JOIN shops s ON s.id::text = o.shop_id::text
                WHERE o.era_id::text = ANY($1::text[]) ORDER BY o.created_at`, [eraIds]),
  ])
  const items = orders.length ? await query<any>(`
    SELECT oi.order_id::text AS order_id, oi.joiner_id::text AS joiner_id, oi.version_name, oi.description, oi.item_type,
      oi.inclusions_count, oi.amount_claimed, oi.claim_group_id, oi.price_eur
    FROM order_items oi
    WHERE oi.order_id::text = ANY($1::text[]) AND oi.joiner_id IS NOT NULL AND oi.lost_claim_id IS NULL
  `, [orders.map(o => o.id)]) : []
  const itemsByOrder = new Map<string, any[]>()
  for (const it of items) { if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []); itemsByOrder.get(it.order_id)!.push(it) }

  const out: Record<string, any> = {}
  for (const eraId of eraIds) {
    const vs = versions.filter(v => v.era_id === eraId)
    const ex = extras.filter(e => e.era_id === eraId)
    const os = orders.filter(o => o.era_id === eraId).map(o => {
      const sections = orderSections(o, itemsByOrder.get(o.id) || [], vs)
      return {
        id: o.id, status: o.status, round_number: o.round_number, shop_name: o.shop_name, created_at: o.created_at,
        sections, bought: sum(sections.map(s => s.bought)), claimed: sum(sections.map(s => s.claimed)),
      }
    })
    const allSections = os.flatMap(o => o.sections.map(s => ({ ...s, order_id: o.id })))
    const extraFor = (vid: string | null) => sum(ex.filter(e => (e.version_id || null) === vid).map(e => parseInt(e.qty) || 0))
    const versionStats = vs.map(v => {
      const secs = allSections.filter(s => s.version_id === v.id)
      const extra = extraFor(v.id)
      const bought = sum(secs.map(s => s.bought)) + extra
      const claimed = sum(secs.map(s => s.claimed))
      return { ...v, bought, extra, claimed, unclaimed: bought - claimed, orders: new Set(secs.map(s => s.order_id)).size }
    })
    const unlinkedSecs = allSections.filter(s => !s.version_id && (s.bought > 0 || s.claimed > 0))
    const unlinkedExtra = extraFor(null)
    const unlinked = {
      bought: sum(unlinkedSecs.map(s => s.bought)) + unlinkedExtra, extra: unlinkedExtra,
      claimed: sum(unlinkedSecs.map(s => s.claimed)),
      sections: unlinkedSecs,
    }
    const bought = sum(versionStats.map(v => v.bought)) + unlinked.bought
    const claimed = sum(versionStats.map(v => v.claimed)) + unlinked.claimed
    out[eraId] = {
      versions: versionStats, extras: ex, orders: os.map(o => ({ ...o, unclaimed: o.bought - o.claimed })),
      unlinked: { ...unlinked, unclaimed: unlinked.bought - unlinked.claimed },
      totals: { bought, claimed, unclaimed: bought - claimed },
    }
  }
  return out
}
