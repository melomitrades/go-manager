import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const shops = await query('SELECT * FROM shops ORDER BY name')
  return NextResponse.json(shops)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, website, ships_to_korea, accepts_id } = await req.json()
  const shop = await queryOne(
    'INSERT INTO shops (name, website, ships_to_korea, accepts_id) VALUES ($1,$2,$3,$4) RETURNING *',
    [name, website || null, ships_to_korea ?? false, accepts_id ?? false]
  )
  return NextResponse.json(shop, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, name, website, ships_to_korea, accepts_id } = await req.json()
  const shop = await queryOne(
    'UPDATE shops SET name=$1, website=$2, ships_to_korea=$3, accepts_id=$4, updated_at=now() WHERE id=$5 RETURNING *',
    [name, website || null, ships_to_korea, accepts_id, id]
  )
  return NextResponse.json(shop)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json()
  await query('DELETE FROM shops WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
