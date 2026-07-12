import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const addrs = await query('SELECT * FROM addy_addresses ORDER BY country')
  return NextResponse.json(addrs)
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { country, address } = await req.json()
  const a = await queryOne(
    'UPDATE addy_addresses SET address=$1, updated_at=now() WHERE country=$2 RETURNING *',
    [address, country]
  )
  return NextResponse.json(a)
}
