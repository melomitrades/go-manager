import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { LostClaimError, createLeftoverRequest, cancelLeftoverRequest, decideLeftoverRequest } from '@/lib/lostClaims'

export const dynamic = 'force-dynamic'

function fail(e: any) {
  if (e instanceof LostClaimError) return NextResponse.json({ error: e.message }, { status: e.status })
  console.error('[leftover requests]', e)
  return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
}

// POST — a joiner asks for a leftover: { kind: 'lost_claim', lost_claim_id } | { kind: 'lost_pc', lost_pc_item_id }
//        | { kind: 'slot', order_id, member_id, version_label } — plus an optional note.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  try {
    return NextResponse.json(await createLeftoverRequest(user.id, await req.json()), { status: 201 })
  } catch (e) { return fail(e) }
}

// PATCH — joiner: { id, action: 'cancel' } · GOM: { id, approve: boolean, note }
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  try {
    const body = await req.json()
    if (body.action === 'cancel') return NextResponse.json(await cancelLeftoverRequest(user.id, body.id))
    if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json(await decideLeftoverRequest(body.id, !!body.approve, user.id, body.note))
  } catch (e) { return fail(e) }
}
