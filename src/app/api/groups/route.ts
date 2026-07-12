import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

let migrationsDone = false
async function ensureColumns() {
  if (migrationsDone) return
  migrationsDone = true
  // fixed_joiners: JSON array of {joiner_id, member_id} objects
  await query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS fixed_joiners TEXT DEFAULT '[]'`).catch(() => {})
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureColumns()
  const groups = await query(`
    SELECT g.*, json_agg(m ORDER BY m.sort_order NULLS LAST, m.created_at) FILTER (WHERE m.id IS NOT NULL) as members
    FROM groups g LEFT JOIN members m ON m.group_id = g.id
    GROUP BY g.id ORDER BY g.name
  `)
  return NextResponse.json(groups)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { name } = await req.json()
  const g = await queryOne('INSERT INTO groups (name) VALUES ($1) RETURNING *', [name])
  return NextResponse.json(g, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await ensureColumns()

  const { id, name, sort_order, fixed_joiners } = await req.json()

  // Build SET clause dynamically to avoid referencing missing columns
  const sets: string[] = []
  const params: any[] = []
  let i = 1

  if (name != null) { sets.push(`name = $${i++}`); params.push(name) }
  if (sort_order != null) { sets.push(`sort_order = $${i++}`); params.push(sort_order) }
  if (fixed_joiners != null) { sets.push(`fixed_joiners = $${i++}`); params.push(JSON.stringify(fixed_joiners)) }

  if (sets.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  params.push(id)
  const g = await queryOne(
    `UPDATE groups SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    params
  )

  // Recompute global is_fixed flag for all joiners: true if they appear in
  // ANY group's fixed_joiners list, false otherwise. This drives the +2
  // raffle entry bonus, which is a flat per-joiner setting (not per-group).
  if (fixed_joiners != null) {
    await query('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_fixed BOOLEAN DEFAULT false').catch(() => {})

    const allGroups = await query(`SELECT fixed_joiners FROM groups`)
    const fixedIds = new Set<string>()
    for (const row of allGroups as any[]) {
      try {
        const list = JSON.parse(row.fixed_joiners || '[]')
        for (const entry of list) {
          if (entry?.joiner_id) fixedIds.add(entry.joiner_id)
        }
      } catch { /* ignore malformed entries */ }
    }

    if (fixedIds.size > 0) {
      await query(
        `UPDATE profiles SET is_fixed = (id::text = ANY($1::text[]))`,
        [Array.from(fixedIds)]
      )
    } else {
      await query(`UPDATE profiles SET is_fixed = false`)
    }
  }

  return NextResponse.json(g)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await req.json()
  await query('DELETE FROM groups WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
