import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query } from '@/lib/db'
import { ensurePcSorterSchema } from '@/lib/pcSorter'

// GET /api/pc-sorter/results?order_id=...&joiner_id=...
// Used by OrderDetail (scoped to one order) and the Sending Out page (scoped to one joiner,
// across all their sessions). Joiners can only ever fetch their own results.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  await ensurePcSorterSchema()

  const { searchParams } = new URL(req.url)
  const orderId = searchParams.get('order_id')
  const joinerIdParam = searchParams.get('joiner_id')
  const joinerId = user.role === 'joiner' ? user.id : (joinerIdParam || null)

  const rows = await query(`
    SELECT a.id, a.session_id, a.joiner_id, a.round, a.is_repeat, a.is_random, a.sort_method, a.created_at,
           pk.name as pack_name, it.name as item_name, m.name as member_name,
           s.title as session_title, p.display_name, p.username
    FROM pc_assignments a
    JOIN pc_sorting_sessions s ON s.id = a.session_id
    LEFT JOIN pc_packs pk ON pk.id = a.pack_id
    LEFT JOIN pc_items it ON it.id = a.item_id
    LEFT JOIN members m ON m.id = a.member_id
    LEFT JOIN profiles p ON p.id = a.joiner_id
    WHERE ($1::uuid IS NULL OR a.joiner_id = $1)
      AND ($2::text IS NULL OR (s.order_ids IS NOT NULL AND s.order_ids::jsonb @> to_jsonb($2::text)))
    ORDER BY a.created_at DESC
  `, [joinerId, orderId]).catch((err) => { console.error('[pc-sorter results]', err); return [] as any[] })

  return NextResponse.json(rows)
}
