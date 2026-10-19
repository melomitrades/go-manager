import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getJoinerLeftoversData } from '@/lib/lostClaims'

export const dynamic = 'force-dynamic'

// Joiner view: leftovers anyone can ask for (never who lost them or why) + the caller's own requests.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  return NextResponse.json(await getJoinerLeftoversData(user.id))
}
