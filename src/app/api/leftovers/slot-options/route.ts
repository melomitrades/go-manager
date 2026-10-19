import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getSlotOptions } from '@/lib/leftoverSlots'

export const dynamic = 'force-dynamic'

// GET ?order_id=&version_label= — the pricing options an open slot of this order can be claimed
// with (picked by the joiner when requesting, or by the GOM when giving a slot directly).
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const orderId = sp.get('order_id')
  if (!orderId) return NextResponse.json({ error: 'order_id required' }, { status: 400 })
  return NextResponse.json(await getSlotOptions(orderId, sp.get('version_label')))
}
