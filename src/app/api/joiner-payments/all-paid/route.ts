import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query } from '@/lib/db'
import { getPaidLostAmounts } from '@/lib/lostClaims'

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

  // Money already paid for claims that were later marked lost (e.g. order paid, EMS not) left
  // order_items with the claim — add it back so the covering maths still counts what was really
  // collected. Merged into the same (order, joiner) row when one exists.
  const out = (rows as any[]).map(r => ({ ...r, amount_eur: parseFloat(r.amount_eur) || 0 }))
  for (const l of await getPaidLostAmounts() as any[]) {
    const amt = parseFloat(l.amount_eur) || 0
    if (amt <= 0) continue
    const existing = out.find(r => r.order_id === l.order_id && r.joiner_id === l.joiner_id)
    if (existing) existing.amount_eur += amt
    else out.push({ order_id: l.order_id, joiner_id: l.joiner_id, paid: true, amount_eur: amt })
  }
  return NextResponse.json(out)
}
