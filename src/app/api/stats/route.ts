import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { queryOne } from '@/lib/db'
import { ensureGomPaymentsSchema } from '@/lib/gomPayments'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await ensureGomPaymentsSchema()
  // GOM payments: archived entries (old `payments` table) + the per-order lines used now.
  const stats = await queryOne(`
    SELECT
      (SELECT COUNT(*) FROM profiles WHERE role = 'joiner') as joiners,
      (SELECT COUNT(*) FROM orders) as orders,
      (SELECT COUNT(*) FROM boxes) as boxes,
      (SELECT COALESCE(SUM(amount_eur),0) FROM payments) + (SELECT COALESCE(SUM(amount_eur),0) FROM gom_order_payments) as total_payments_eur,
      (SELECT COUNT(*) FROM payments) + (SELECT COUNT(*) FROM gom_order_payments) as payments
  `)
  return NextResponse.json(stats)
}
