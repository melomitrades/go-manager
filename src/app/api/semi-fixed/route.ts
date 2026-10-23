import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { ensureSemiFixedSchema, listSpots, renewSpot } from '@/lib/semiFixed'

// GET /api/semi-fixed[?era_id=&group_id=]
//   joiner → their own spots in active eras (incl. lost ones there, so they see what happened)
//   gom    → active spots (used by the Orders page to auto-add semi-fixed joiners)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const sp = new URL(req.url).searchParams
  const isGom = ['gom', 'admin'].includes(user.role) && sp.get('viewAs') !== 'joiner'
  if (!isGom) {
    const spots = await listSpots({ joinerId: user.id, includeClosed: true })
    return NextResponse.json(spots.filter((s: any) => s.era_status === 'active'))
  }
  const spots = await listSpots({ eraId: sp.get('era_id') || undefined, groupId: sp.get('group_id') || undefined })
  return NextResponse.json(spots)
}

// POST { era_id, joiner_id, member_ids } — GOM assigns a semi-fixed spot
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await ensureSemiFixedSchema()
  const { era_id, joiner_id, member_ids } = await req.json()
  if (!era_id || !joiner_id) return NextResponse.json({ error: 'Era and joiner are required' }, { status: 400 })
  const era = await queryOne(`SELECT status FROM eras WHERE id=$1`, [era_id])
  if (!era) return NextResponse.json({ error: 'Era not found' }, { status: 404 })
  if (era.status !== 'active') return NextResponse.json({ error: 'This era has ended' }, { status: 400 })
  const spot = await queryOne(
    `INSERT INTO semi_fixed_spots (era_id, joiner_id, member_ids) VALUES ($1,$2,$3) RETURNING *`,
    [era_id, String(joiner_id), JSON.stringify(Array.isArray(member_ids) ? member_ids : [])])
  return NextResponse.json(spot, { status: 201 })
}

// PATCH { id, action: 'renew' }            — joiner (own spot) or GOM
//       { id, action: 'release' }          — GOM: take the spot away now
//       { id, member_ids?, events_used? }  — GOM: edit members / correct the counter
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const isGom = ['gom', 'admin'].includes(user.role)
  await ensureSemiFixedSchema()
  const { id, action, member_ids, events_used } = await req.json()
  const spot = await queryOne(`SELECT * FROM semi_fixed_spots WHERE id=$1`, [id])
  if (!spot) return NextResponse.json({ error: 'Spot not found' }, { status: 404 })

  if (action === 'renew') {
    if (!isGom && String(spot.joiner_id) !== String(user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    try { await renewSpot(id) } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }) }
    return NextResponse.json({ ok: true })
  }
  if (!isGom) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (action === 'release') {
    await query(`UPDATE semi_fixed_spots SET status='lost', ended_at=now() WHERE id=$1`, [id])
    return NextResponse.json({ ok: true })
  }
  await query(
    `UPDATE semi_fixed_spots SET member_ids=COALESCE($2::jsonb, member_ids), events_used=COALESCE($3, events_used) WHERE id=$1`,
    [id, Array.isArray(member_ids) ? JSON.stringify(member_ids) : null, events_used != null ? Math.max(0, parseInt(events_used) || 0) : null])
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await ensureSemiFixedSchema()
  const { id } = await req.json()
  await query(`DELETE FROM semi_fixed_spots WHERE id=$1`, [id])
  return NextResponse.json({ ok: true })
}
