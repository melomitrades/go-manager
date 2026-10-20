import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getJoinerClaimOverrides, setOrderItemOverride } from '@/lib/shipments'

export const dynamic = 'force-dynamic'

// GET — claims the GOM changed (see setOrderItemOverride in src/lib/shipments.ts), scoped to the
// signed-in user's own claims — feeds the joiner-facing warnings on the Shipping, Orders and
// Deadlines pages. A GOM previewing the joiner view only ever sees their own.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  return NextResponse.json(await getJoinerClaimOverrides(user.id))
}

// POST — GOM/admin changes (or, with no member_id, reverts) the member a claim is packed as,
// from the Orders detail panel. { order_item_id, member_id, reason }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { order_item_id, member_id, reason } = await req.json()
  if (!order_item_id) return NextResponse.json({ error: 'order_item_id required' }, { status: 400 })
  const result: any = await setOrderItemOverride(order_item_id, member_id || null, typeof reason === 'string' ? reason.trim().slice(0, 500) || null : null)
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status || 400 })
  return NextResponse.json(result)
}
