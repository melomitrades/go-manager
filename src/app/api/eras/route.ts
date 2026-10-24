import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { ensureSemiFixedSchema, listSpots } from '@/lib/semiFixed'
import { ensureEraAlbumsSchema } from '@/lib/eraAlbums'

async function requireGom() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

// GET /api/eras[?group_id=] — eras with their order count and (active + closed) semi-fixed spots
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureSemiFixedSchema()
  await ensureEraAlbumsSchema()
  const groupId = new URL(req.url).searchParams.get('group_id')
  const params: any[] = []
  let where = ''
  if (groupId) { params.push(groupId); where = 'WHERE e.group_id = $1' }
  const eras = await query(`
    SELECT e.*, (SELECT COUNT(*) FROM orders o WHERE o.era_id = e.id)::int AS order_count
    FROM eras e ${where}
    ORDER BY (e.status = 'active') DESC, e.started_at DESC`, params)
  const user = session.user as any
  const isGom = ['gom', 'admin'].includes(user.role)
  const spots = isGom ? await listSpots({ groupId: groupId || undefined, includeClosed: true }) : []
  // Album versions (no photos — those are only loaded on the era page)
  const versions = eras.length ? await query<any>(
    `SELECT id, era_id, name, weight_variant_id, sort_order FROM era_versions WHERE era_id = ANY($1::text[]) ORDER BY sort_order, created_at`,
    [eras.map((e: any) => e.id)]).catch(() => [] as any[]) : []
  return NextResponse.json(eras.map((e: any) => ({ ...e, spots: spots.filter((s: any) => s.era_id === e.id), versions: versions.filter((v: any) => v.era_id === e.id) })))
}

export async function POST(req: NextRequest) {
  const { error } = await requireGom(); if (error) return error
  await ensureSemiFixedSchema()
  const { group_id, name, events_per_round, renewal_days } = await req.json()
  if (!group_id || !name) return NextResponse.json({ error: 'Group and name are required' }, { status: 400 })
  const era = await queryOne(
    `INSERT INTO eras (group_id, name, events_per_round, renewal_days) VALUES ($1,$2,$3,$4) RETURNING *`,
    [String(group_id), name, Math.max(1, parseInt(events_per_round) || 1), Math.max(0, parseInt(renewal_days) || 0)])
  return NextResponse.json(era, { status: 201 })
}

// PATCH { id, name?, events_per_round?, renewal_days?, end?: true, reopen?: true }
export async function PATCH(req: NextRequest) {
  const { error } = await requireGom(); if (error) return error
  await ensureSemiFixedSchema()
  const { id, name, events_per_round, renewal_days, end, reopen } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  if (end) {
    const era = await queryOne(`UPDATE eras SET status='ended', ended_at=now() WHERE id=$1 RETURNING *`, [id])
    // Spots end with the era.
    await query(`UPDATE semi_fixed_spots SET status='ended', ended_at=now() WHERE era_id=$1 AND status='active'`, [id])
    return NextResponse.json(era)
  }
  if (reopen) {
    // Re-opening doesn't bring ended spots back — re-add them if needed.
    const era = await queryOne(`UPDATE eras SET status='active', ended_at=NULL WHERE id=$1 RETURNING *`, [id])
    return NextResponse.json(era)
  }

  const era = await queryOne(
    `UPDATE eras SET name=COALESCE($2,name), events_per_round=COALESCE($3,events_per_round), renewal_days=COALESCE($4,renewal_days)
     WHERE id=$1 RETURNING *`,
    [id, name || null,
      events_per_round != null && events_per_round !== '' ? Math.max(1, parseInt(events_per_round) || 1) : null,
      renewal_days != null && renewal_days !== '' ? Math.max(0, parseInt(renewal_days) || 0) : null])
  return NextResponse.json(era)
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireGom(); if (error) return error
  await ensureSemiFixedSchema()
  const { id } = await req.json()
  await query(`UPDATE orders SET era_id=NULL WHERE era_id=$1`, [id])
  await query(`DELETE FROM semi_fixed_spots WHERE era_id=$1`, [id])
  await ensureEraAlbumsSchema()
  await query(`DELETE FROM era_extra_albums WHERE era_id=$1`, [id])
  await query(`DELETE FROM era_versions WHERE era_id=$1`, [id])
  await query(`UPDATE orders SET era_version_map=NULL WHERE era_id IS NULL AND era_version_map IS NOT NULL`)
  await query(`DELETE FROM eras WHERE id=$1`, [id])
  return NextResponse.json({ ok: true })
}
