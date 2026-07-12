import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { queryOne } from '@/lib/db'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const stats = await queryOne(`
    SELECT
      (SELECT COUNT(*) FROM profiles WHERE role = 'joiner') as joiners,
      (SELECT COUNT(*) FROM orders) as orders,
      (SELECT COUNT(*) FROM boxes) as boxes,
      (SELECT COALESCE(SUM(amount_eur),0) FROM payments) as total_payments_eur,
      (SELECT COUNT(*) FROM payments) as payments
  `)
  return NextResponse.json(stats)
}
