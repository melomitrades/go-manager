import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getPackingStats } from '@/lib/packingStats'

export const dynamic = 'force-dynamic'

// GET /api/packing-stats — per-GOM packing volume, current backlog and monthly packed parcels.
// GOM / admin only.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    return NextResponse.json(await getPackingStats())
  } catch (err: any) {
    console.error('[packing-stats]', err?.message)
    return NextResponse.json({ error: 'Could not load packing stats' }, { status: 500 })
  }
}
