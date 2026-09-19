import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { queryOne } from '@/lib/db'

// Serves an order's preview image as a real image response instead of a multi-MB base64 string
// inside JSON. Used by the Pack wizard so it can load ONE image at a time, lazily, and let the
// browser cache it (the same order's image is reused for every joiner packed from it).
// GOMs/admins can fetch any order's image; a joiner only their own orders' (an item claimed by
// them, or a personal order of theirs) — same visibility as the order detail view.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return new NextResponse('Unauthorized', { status: 401 })
  const user = session.user as any
  const isGom = ['gom', 'admin'].includes(user.role)

  const row = await queryOne<any>(
    isGom
      ? 'SELECT preview_image_url FROM orders WHERE id=$1'
      : `SELECT o.preview_image_url FROM orders o
         WHERE o.id=$1 AND (o.personal_joiner_id=$2 OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=o.id AND oi.joiner_id=$2))`,
    isGom ? [params.id] : [params.id, user.id]
  ).catch(() => null)
  const url: string | null = row?.preview_image_url || null
  if (!url) return new NextResponse('Not found', { status: 404 })

  const m = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(url)
  if (!m) return NextResponse.redirect(url) // a plain hosted URL rather than an inline data URL
  const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]))
  return new NextResponse(buf, {
    headers: {
      'Content-Type': m[1],
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
