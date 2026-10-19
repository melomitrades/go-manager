import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getGomLeftoversData } from '@/lib/lostClaims'

export const dynamic = 'force-dynamic'

// GOM view of everything leftover-related: lost order claims, released sorted cards, the
// lost-claims history (for Restore), and joiners' leftover requests.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(await getGomLeftoversData())
}
