import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'

let migrationsDone = false
async function ensureColumns() {
  if (migrationsDone) return
  migrationsDone = true
  await query('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_plain TEXT').catch(() => {})
  await query('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_fixed BOOLEAN DEFAULT false').catch(() => {})
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureColumns()
  const users = await query(
    'SELECT id, username, display_name, role, created_at, password_plain, is_fixed FROM profiles ORDER BY created_at DESC'
  )
  return NextResponse.json(users)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const reqUser = session.user as any
  if (!['gom','admin'].includes(reqUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await ensureColumns()

  const { username, display_name, password, role } = await req.json()
  if (!username || !password) return NextResponse.json({ error: 'username and password required' }, { status: 400 })

  const hash = await bcrypt.hash(password, 12)
  const id = randomUUID()
  const newUser = await queryOne(
    'INSERT INTO profiles (id, username, display_name, password_hash, password_plain, role) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, username, display_name, role, created_at, password_plain',
    [id, username, display_name || username, hash, password, role || 'joiner']
  )
  return NextResponse.json(newUser, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const reqUser = session.user as any
  if (!['gom','admin'].includes(reqUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await ensureColumns()

  const { id, role, display_name, username, password, is_fixed } = await req.json()

  const sets: string[] = []
  const params: any[] = []
  let i = 1

  if (display_name !== undefined) { sets.push(`display_name = $${i++}`); params.push(display_name || null) }
  if (username) { sets.push(`username = $${i++}`); params.push(username) }
  if (role) { sets.push(`role = $${i++}`); params.push(role) }
  if (is_fixed !== undefined) { sets.push(`is_fixed = $${i++}`); params.push(!!is_fixed) }

  if (password) {
    const hash = await bcrypt.hash(password, 12)
    sets.push(`password_hash = $${i++}`); params.push(hash)
    sets.push(`password_plain = $${i++}`); params.push(password)
  }

  if (sets.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  params.push(id)
  const u = await queryOne(
    `UPDATE profiles SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, username, display_name, role, password_plain, is_fixed`,
    params
  )
  return NextResponse.json(u)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const reqUser = session.user as any
  if (!['gom','admin'].includes(reqUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await req.json()
  await query('DELETE FROM profiles WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
