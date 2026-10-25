import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query } from '@/lib/db'
import { ensureEventsSchema } from '@/lib/events'

export const dynamic = 'force-dynamic'

// GET /api/events/options[?era_id=] → what the event form needs: eras, shops, users, and the era's orders.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['gom', 'admin'].includes((session.user as any).role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await ensureEventsSchema()
  const eraId = new URL(req.url).searchParams.get('era_id')
  const [eras, shops, users, orders] = await Promise.all([
    query<any>(`SELECT e.id::text AS id, e.name, e.status, g.name AS group_name FROM eras e LEFT JOIN groups g ON g.id::text = e.group_id::text
                ORDER BY (e.status = 'active') DESC, g.name NULLS LAST, e.started_at DESC`),
    query<any>(`SELECT id::text AS id, name FROM shops ORDER BY name`).catch(() => [] as any[]),
    query<any>(`SELECT id::text AS id, COALESCE(display_name, username) AS name, role::text AS role FROM profiles ORDER BY COALESCE(display_name, username)`),
    eraId
      ? query<any>(`SELECT o.id::text AS id, o.round_number, o.status::text AS status, o.is_fancall, s.name AS shop_name
                    FROM orders o LEFT JOIN shops s ON s.id::text = o.shop_id::text WHERE o.era_id::text = $1 ORDER BY o.created_at DESC`, [eraId])
      : Promise.resolve([] as any[]),
  ])
  return NextResponse.json({ eras, shops, users, orders })
}
