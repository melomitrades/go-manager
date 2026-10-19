import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query } from '@/lib/db'
import { ensureLostClaimsSchema, getUnpaidPayments } from '@/lib/lostClaims'

export const dynamic = 'force-dynamic'

// GOM: every payment currently owed by a joiner and not validated yet (order, EMS, customs,
// shipping) — the list the "Mark claims lost" shortcut works from.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await ensureLostClaimsSchema()
  const rows = await getUnpaidPayments((sql, params) => query(sql, params), null)
  rows.sort((a, b) => (Number(b.overdue) - Number(a.overdue)) || a.joiner_name.localeCompare(b.joiner_name))
  return NextResponse.json(rows)
}
