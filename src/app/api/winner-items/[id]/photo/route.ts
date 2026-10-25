import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { queryOne } from '@/lib/db'
import { ensureWinnerItemsSchema } from '@/lib/winnerItems'

export const dynamic = 'force-dynamic'

// GET /api/winner-items/[id]/photo → the item's photo as an image (kept out of list JSON).
// GOM/admin: any item. Joiner: only an item sold / given to them.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  await ensureWinnerItemsSchema()
  const row = await queryOne<any>(`SELECT photo_url, recipient_id, status FROM winner_items WHERE id = $1`, [params.id])
  if (!row?.photo_url) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const isGom = ['gom', 'admin'].includes(user.role)
  if (!isGom && !(row.recipient_id === user.id && ['sold', 'given'].includes(row.status))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const m = /^data:(image\/[a-z+.-]+);base64,(.*)$/i.exec(row.photo_url)
  if (!m) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return new NextResponse(Buffer.from(m[2], 'base64'), {
    headers: { 'Content-Type': m[1], 'Cache-Control': 'private, max-age=300' },
  })
}
