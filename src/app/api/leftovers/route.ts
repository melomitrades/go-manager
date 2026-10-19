import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { computeOpenSlots } from '@/lib/leftoverSlots'

export const dynamic = 'force-dynamic'

// Open member slots across active orders (see src/lib/leftoverSlots.ts). Just counts per member,
// no joiner names, so joiners may read it too — the joiner Leftovers page lets them ask for one.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await computeOpenSlots())
}
