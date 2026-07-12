import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/joiner-payments/all-paid
// Returns all validated (paid=true) joiner payments for covering calculation
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rows = await query(`
    SELECT
      ojp.order_id,
      ojp.joiner_id,
      ojp.paid,
      COALESCE(agg.amount_eur, 0) as amount_eur
    FROM order_joiner_paid ojp
    LEFT JOIN (
      SELECT order_id, joiner_id, SUM(price_eur * amount_claimed) as amount_eur
      FROM order_items GROUP BY order_id, joiner_id
    ) agg ON agg.order_id = ojp.order_id AND agg.joiner_id = ojp.joiner_id
    WHERE ojp.paid = true
  `).catch(() => [])

  return NextResponse.json((rows as any[]).map(r => ({ ...r, amount_eur: parseFloat(r.amount_eur) || 0 })))
}
