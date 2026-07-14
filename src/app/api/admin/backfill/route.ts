import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const result = await query(`
    UPDATE order_items
    SET inclusions_count = COALESCE(amount_claimed, 1)
    WHERE inclusions_count = 0
      AND description IS NOT NULL
      AND LOWER(description) LIKE '%inclu%'
    RETURNING id
  `)

  return NextResponse.json({ updated: (result as any[]).length })
}
