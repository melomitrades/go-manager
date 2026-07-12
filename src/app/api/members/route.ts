import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { group_id, name } = await req.json()
  const m = await queryOne('INSERT INTO members (group_id, name) VALUES ($1,$2) RETURNING *', [group_id, name])
  return NextResponse.json(m, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()

  // Bulk reorder: [{ id, sort_order }]
  if (body.reorder) {
    for (const { id, sort_order } of body.reorder) {
      await query('UPDATE members SET sort_order=$1 WHERE id=$2', [sort_order, id])
    }
    return NextResponse.json({ ok: true })
  }

  const { id, name } = body
  const m = await queryOne('UPDATE members SET name=$1 WHERE id=$2 RETURNING *', [name, id])
  return NextResponse.json(m)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await req.json()
  await query('DELETE FROM members WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
