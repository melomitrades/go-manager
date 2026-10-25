import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getEraAlbumStats } from '@/lib/eraAlbums'
import { ensureWinnerItemsSchema } from '@/lib/winnerItems'
import { listEvents } from '@/lib/events'

export const dynamic = 'force-dynamic'

// GET /api/winner-items/options?era_id=  → everything the winner item form needs for one era:
// item types, the group's members, the era's versions, its orders (with their parts), its events, archive fancalls,
// GOM/admin accounts (Kept by), all users (Sold / Given to) and boxes (Ship with box).
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await ensureWinnerItemsSchema()

  const eraId = new URL(req.url).searchParams.get('era_id')
  if (!eraId) return NextResponse.json({ error: 'era_id required' }, { status: 400 })
  const era = await queryOne<any>(`SELECT e.id, e.name, e.album_name, e.group_id, g.name AS group_name
    FROM eras e LEFT JOIN groups g ON g.id::text = e.group_id WHERE e.id = $1`, [eraId])
  if (!era) return NextResponse.json({ error: 'Era not found' }, { status: 404 })

  const [types, members, stats, fancalls, profiles, boxes, events] = await Promise.all([
    query<any>(`SELECT * FROM winner_item_types ORDER BY archived, sort_order, name`),
    era.group_id
      ? query<any>(`SELECT id::text AS id, name FROM members WHERE group_id::text = $1 ORDER BY sort_order NULLS LAST, name`, [String(era.group_id)])
          .catch(() => query<any>(`SELECT id::text AS id, name FROM members WHERE group_id::text = $1 ORDER BY name`, [String(era.group_id)]))
      : Promise.resolve([] as any[]),
    getEraAlbumStats([eraId]),
    query<any>(`
      SELECT f.id::text AS id, f.fancall_datetime, f.won, f.order_id::text AS order_id,
        s.name AS shop_name, COALESCE(p.display_name, p.username) AS entered_by_name,
        o.era_id::text AS order_era_id
      FROM fancalls f
      LEFT JOIN shops s ON s.id = f.shop_id
      LEFT JOIN profiles p ON p.id = f.entered_by
      LEFT JOIN orders o ON o.id = f.order_id
      ORDER BY f.fancall_datetime DESC NULLS LAST, f.created_at DESC
      LIMIT 300`).catch(() => [] as any[]),
    query<any>(`SELECT id::text AS id, COALESCE(display_name, username) AS name, username, role::text AS role FROM profiles ORDER BY COALESCE(display_name, username)`),
    query<any>(`SELECT id::text AS id, label, created_at FROM boxes ORDER BY created_at DESC LIMIT 200`).catch(() => [] as any[]),
    listEvents({ eraId }),
  ])

  const st = stats[eraId]
  const versionName = (id: string | null) => st.versions.find((v: any) => v.id === id)?.name
  const orders = st.orders.map((o: any) => ({
    id: o.id, status: o.status, shop_name: o.shop_name, round_number: o.round_number,
    // Parts worth picking: versions of a multi-version order, VCE / Fansign. '__all__' = the whole order.
    sections: o.sections.filter((s: any) => s.key !== '__all__' && s.key !== '__none__')
      .map((s: any) => ({ key: s.key, label: s.label, version_id: s.version_id, version_name: versionName(s.version_id) || null })),
  }))

  return NextResponse.json({
    era,
    types,
    members,
    versions: st.versions.map((v: any) => ({ id: v.id, name: v.name })),
    orders,
    // This era's fancalls first, then the rest.
    fancalls: [...fancalls].sort((a, b) => Number(b.order_era_id === eraId) - Number(a.order_era_id === eraId)),
    // The era's events (for "Won at"); Lost ones are listed but can't be picked.
    events: events.map(e => ({ id: e.id, type: e.type, type_text: e.type_text, event_local: e.event_local, event_day: e.event_day,
      result: e.result, order_id: e.order_id, shop_name: e.shop_name, order_shop_name: e.order_shop_name, order_round: e.order_round, item_count: e.item_count })),
    goms: profiles.filter(p => ['gom', 'admin'].includes(p.role)),
    users: profiles,
    boxes,
  })
}
