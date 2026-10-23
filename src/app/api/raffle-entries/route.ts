import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { raffleEntriesForOrder } from '@/lib/semiFixed'

// GET /api/raffle-entries?order_id= — bought entries + fixed (+2) / semi-fixed (+1) bonus per joiner
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orderId = new URL(req.url).searchParams.get('order_id')
  if (!orderId) return NextResponse.json({ error: 'Missing order_id' }, { status: 400 })
  return NextResponse.json(await raffleEntriesForOrder(orderId))
}
