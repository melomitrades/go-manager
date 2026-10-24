import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { ensureEraAlbumsSchema, getEraAlbumStats, norm } from '@/lib/eraAlbums'

export const dynamic = 'force-dynamic'

async function gom() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })

// GET            → every era with its pack totals (Eras list)
// GET ?era_id=   → one era in full: versions (with photos), extras, orders + sections, unlinked
export async function GET(req: NextRequest) {
  const { error } = await gom(); if (error) return error
  await ensureEraAlbumsSchema()
  const eraId = new URL(req.url).searchParams.get('era_id')

  if (eraId) {
    const era = await queryOne<any>(`SELECT e.*, g.name AS group_name FROM eras e LEFT JOIN groups g ON g.id::text = e.group_id WHERE e.id = $1`, [eraId])
    if (!era) return bad('Era not found', 404)
    const stats = (await getEraAlbumStats([eraId]))[eraId]
    const photos = await query<any>(`SELECT id, photo_url FROM era_versions WHERE era_id = $1 AND photo_url IS NOT NULL`, [eraId])
    const photoById = new Map(photos.map(p => [p.id, p.photo_url]))
    stats.versions = stats.versions.map((v: any) => ({ ...v, photo_url: photoById.get(v.id) || null }))
    return NextResponse.json({ era, ...stats })
  }

  const eras = await query<any>(`
    SELECT e.id, e.name, e.album_name, e.status, e.group_id, e.started_at, e.created_at, g.name AS group_name
    FROM eras e LEFT JOIN groups g ON g.id::text = e.group_id
    ORDER BY g.name NULLS LAST, (e.status = 'active') DESC, e.started_at DESC`)
  const stats = await getEraAlbumStats(eras.map(e => e.id))
  return NextResponse.json(eras.map(e => ({
    ...e, totals: stats[e.id].totals, version_count: stats[e.id].versions.length,
    order_count: stats[e.id].orders.length, unlinked: stats[e.id].unlinked.sections.length,
  })))
}

// POST { action, ... }
//   album         { era_id, album_name }
//   version_add   { era_id, name, weight_variant_id?, photo_url? }
//   version_update{ id, name?, weight_variant_id?, photo_url? (null clears) }
//   version_delete{ id }
//   version_move  { id, dir: -1 | 1 }
//   extra_add     { era_id, version_id?, qty, note? }
//   extra_delete  { id }
//   link          { order_id, section, version_id }   version_id: id | 'none' (not linked) | null (auto by name)
export async function POST(req: NextRequest) {
  const { error } = await gom(); if (error) return error
  await ensureEraAlbumsSchema()
  const b = await req.json().catch(() => ({}))
  const name = typeof b.name === 'string' ? b.name.trim() : ''

  async function nameTaken(eraId: string, n: string, exceptId?: string) {
    const rows = await query<any>(`SELECT id, name FROM era_versions WHERE era_id = $1`, [eraId])
    return rows.some(r => norm(r.name) === norm(n) && r.id !== exceptId)
  }

  switch (b.action) {
    case 'album': {
      if (!b.era_id) return bad('Missing era')
      const era = await queryOne(`UPDATE eras SET album_name = $2 WHERE id = $1 RETURNING id, album_name`, [b.era_id, (b.album_name || '').trim() || null])
      return era ? NextResponse.json(era) : bad('Era not found', 404)
    }
    case 'version_add': {
      if (!b.era_id || !name) return bad('Give the version a name')
      if (await nameTaken(b.era_id, name)) return bad('This era already has a version with that name')
      const v = await queryOne(
        `INSERT INTO era_versions (era_id, name, weight_variant_id, photo_url, sort_order)
         VALUES ($1, $2, $3, $4, COALESCE((SELECT MAX(sort_order) + 1 FROM era_versions WHERE era_id = $1), 0))
         RETURNING id, era_id, name, weight_variant_id, sort_order`,
        [b.era_id, name, b.weight_variant_id || null, b.photo_url || null])
      return NextResponse.json(v, { status: 201 })
    }
    case 'version_update': {
      const cur = await queryOne<any>(`SELECT * FROM era_versions WHERE id = $1`, [b.id])
      if (!cur) return bad('Version not found', 404)
      if ('name' in b) {
        if (!name) return bad('Give the version a name')
        if (await nameTaken(cur.era_id, name, cur.id)) return bad('This era already has a version with that name')
      }
      const v = await queryOne(
        `UPDATE era_versions SET
           name = $2,
           weight_variant_id = $3,
           photo_url = $4
         WHERE id = $1 RETURNING id, era_id, name, weight_variant_id, sort_order`,
        [b.id, 'name' in b ? name : cur.name,
          'weight_variant_id' in b ? (b.weight_variant_id || null) : cur.weight_variant_id,
          'photo_url' in b ? (b.photo_url || null) : cur.photo_url])
      return NextResponse.json(v)
    }
    case 'version_delete': {
      const cur = await queryOne<any>(`SELECT * FROM era_versions WHERE id = $1`, [b.id])
      if (!cur) return NextResponse.json({ ok: true })
      await query(`DELETE FROM era_extra_albums WHERE version_id = $1`, [b.id])
      // Drop manual links to it; those sections fall back to matching by name (or "not linked").
      await query(`
        UPDATE orders SET era_version_map = (
          SELECT NULLIF(COALESCE(jsonb_object_agg(k, v), '{}'::jsonb), '{}'::jsonb)
          FROM jsonb_each(era_version_map) AS t(k, v) WHERE v <> to_jsonb($1::text)
        )
        WHERE era_id::text = $2 AND era_version_map IS NOT NULL`, [b.id, cur.era_id])
      await query(`DELETE FROM era_versions WHERE id = $1`, [b.id])
      return NextResponse.json({ ok: true })
    }
    case 'version_move': {
      const cur = await queryOne<any>(`SELECT * FROM era_versions WHERE id = $1`, [b.id])
      if (!cur) return bad('Version not found', 404)
      const list = await query<any>(`SELECT id FROM era_versions WHERE era_id = $1 ORDER BY sort_order, created_at`, [cur.era_id])
      const i = list.findIndex(r => r.id === cur.id), j = i + (b.dir < 0 ? -1 : 1)
      if (j < 0 || j >= list.length) return NextResponse.json({ ok: true })
      ;[list[i], list[j]] = [list[j], list[i]]
      for (let k = 0; k < list.length; k++) await query(`UPDATE era_versions SET sort_order = $2 WHERE id = $1`, [list[k].id, k])
      return NextResponse.json({ ok: true })
    }
    case 'extra_add': {
      const qty = parseInt(b.qty)
      if (!b.era_id || !qty) return bad('Enter how many albums')
      const row = await queryOne(
        `INSERT INTO era_extra_albums (era_id, version_id, qty, note) VALUES ($1, $2, $3, $4) RETURNING *`,
        [b.era_id, b.version_id || null, qty, (b.note || '').trim() || null])
      return NextResponse.json(row, { status: 201 })
    }
    case 'extra_delete': {
      await query(`DELETE FROM era_extra_albums WHERE id = $1`, [b.id])
      return NextResponse.json({ ok: true })
    }
    case 'link': {
      if (!b.order_id || !b.section) return bad('Missing order or section')
      const section = String(b.section)
      if (b.version_id == null) {
        await query(`UPDATE orders SET era_version_map = NULLIF(COALESCE(era_version_map, '{}'::jsonb) - $2::text, '{}'::jsonb) WHERE id::text = $1`, [String(b.order_id), section])
      } else {
        await query(`UPDATE orders SET era_version_map = jsonb_set(COALESCE(era_version_map, '{}'::jsonb), ARRAY[$2::text], to_jsonb($3::text)) WHERE id::text = $1`,
          [String(b.order_id), section, String(b.version_id)])
      }
      return NextResponse.json({ ok: true })
    }
  }
  return bad('Unknown action')
}
