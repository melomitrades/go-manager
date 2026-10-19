import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { LostClaimError, markClaimsLost, restoreBatch, reassignLostClaim, reassignLostPc, getMyLostClaims, giveSlot } from '@/lib/lostClaims'

export const dynamic = 'force-dynamic'

function fail(e: any) {
  if (e instanceof LostClaimError) return NextResponse.json({ error: e.message }, { status: e.status })
  console.error('[lost-claims]', e)
  return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
}

// GET ?mine=1[&order_id=] — the signed-in user's own lost claims (any role; a GOM previewing the
// joiner side only ever sees their own, same convention as ?viewAs=joiner elsewhere).
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  try {
    const orderId = new URL(req.url).searchParams.get('order_id')
    return NextResponse.json(await getMyLostClaims(user.id, orderId))
  } catch (e) { return fail(e) }
}

// POST — mark claims lost (GOM/admin). { joiner_id, order_item_ids, trigger_key, reason, dry_run }
// dry_run runs the exact same transaction and rolls it back, returning what WOULD happen.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const body = await req.json()
    if (!body.joiner_id || !body.trigger_key) return NextResponse.json({ error: 'joiner_id and trigger_key are required' }, { status: 400 })
    const result = await markClaimsLost({
      joinerId: body.joiner_id,
      orderItemIds: Array.isArray(body.order_item_ids) ? body.order_item_ids : [],
      triggerKey: body.trigger_key,
      reason: body.reason || null,
      userId: user.id,
      dryRun: !!body.dry_run,
    })
    return NextResponse.json(result)
  } catch (e) { return fail(e) }
}

// PATCH — { action: 'restore', batch_id, note } | { action: 'reassign_claim', lost_claim_id, joiner_id }
//       | { action: 'reassign_pc', lost_pc_item_id, joiner_id }
//       | { action: 'give_slot', order_id, member_id, version_label, option_key, joiner_id }
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const body = await req.json()
    if (body.action === 'restore') return NextResponse.json(await restoreBatch(body.batch_id, user.id, body.note))
    if (body.action === 'reassign_claim') return NextResponse.json(await reassignLostClaim(body.lost_claim_id, body.joiner_id, user.id))
    if (body.action === 'reassign_pc') return NextResponse.json(await reassignLostPc(body.lost_pc_item_id, body.joiner_id, user.id))
    if (body.action === 'give_slot') return NextResponse.json(await giveSlot({
      orderId: body.order_id, memberId: body.member_id, versionLabel: body.version_label || null,
      option: null, optionKey: body.option_key, joinerId: body.joiner_id, userId: user.id,
    }))
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) { return fail(e) }
}
