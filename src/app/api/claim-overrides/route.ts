import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getJoinerClaimOverrides } from '@/lib/shipments'

// Claims the GOM changed while packing (see setClaimOverride in src/lib/shipments.ts), scoped to
// the signed-in user's own shipments — feeds the joiner-facing warnings on the Shipping, Orders
// and Deadlines pages. A GOM previewing the joiner view only ever sees their own.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  return NextResponse.json(await getJoinerClaimOverrides(user.id))
}
