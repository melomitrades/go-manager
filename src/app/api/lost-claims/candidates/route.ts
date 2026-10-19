import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLoseCandidates } from '@/lib/lostClaims'

export const dynamic = 'force-dynamic'

// GET ?joiner_id=&order_id= | &box_id= | &shipment_id= — the joiner's claims in that scope, grouped
// by order and claim line, plus the unpaid payments that can be used as the reason.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sp = new URL(req.url).searchParams
  const joinerId = sp.get('joiner_id')
  if (!joinerId) return NextResponse.json({ error: 'joiner_id required' }, { status: 400 })
  try {
    return NextResponse.json(await getLoseCandidates(joinerId, {
      order_id: sp.get('order_id'), box_id: sp.get('box_id'), shipment_id: sp.get('shipment_id'),
    }))
  } catch (e) {
    console.error('[lost-claims candidates]', e)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
