import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query } from '@/lib/db'
import { ensureWinnerItemsSchema } from '@/lib/winnerItems'

export const dynamic = 'force-dynamic'

// GET /api/winner-items/types → every winner item type (archived last). Edits go through POST /api/winner-items.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['gom', 'admin'].includes((session.user as any).role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await ensureWinnerItemsSchema()
  return NextResponse.json(await query(`SELECT * FROM winner_item_types ORDER BY archived, sort_order, name`))
}
