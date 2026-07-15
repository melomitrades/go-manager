let pcMigDone = false
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

async function ensureTables() {
  if (pcMigDone) return
  pcMigDone = true
  await Promise.all([
    query('ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ').catch(()=>{}),
    query('ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS box_id UUID REFERENCES boxes(id) ON DELETE SET NULL').catch(()=>{}),
    query('ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS order_ids JSONB DEFAULT NULL').catch(()=>{}),
    query('ALTER TABLE pc_versions ADD COLUMN IF NOT EXISTS slots JSONB DEFAULT NULL').catch(()=>{}),
    query('ALTER TABLE pc_photocards ADD COLUMN IF NOT EXISTS slot_index INTEGER DEFAULT 0').catch(()=>{}),
    query('ALTER TABLE pc_versions ADD COLUMN IF NOT EXISTS order_ids TEXT').catch(()=>{}),
    query('ALTER TABLE pc_assignments ADD COLUMN IF NOT EXISTS inclusions_count INTEGER DEFAULT 0').catch(()=>{}),
  ])
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTables()

  await query(`UPDATE pc_sorting_sessions SET form_open=false WHERE deadline IS NOT NULL AND deadline < now() AND form_open=true`).catch(()=>{})

  const sessions = await query(`
    SELECT ps.*, row_to_json(g) as "group", row_to_json(b) as box
    FROM pc_sorting_sessions ps
    LEFT JOIN groups g ON g.id = ps.group_id
    LEFT JOIN boxes b ON b.id = ps.box_id
    ORDER BY ps.created_at DESC
  `)
  return NextResponse.json(sessions)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom','admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await ensureTables()

  const { title, group_id, versions, deadline, box_id, order_ids } = await req.json()
  const pcSession = await queryOne(
    'INSERT INTO pc_sorting_sessions (title, group_id, created_by, deadline, box_id, order_ids) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [title, group_id||null, user.id, deadline||null, box_id||null, order_ids ? JSON.stringify(order_ids) : null]
  )
  if (!pcSession) return NextResponse.json({ error: 'Failed' }, { status: 500 })

  for (const v of (versions||[])) {
    const slots: string[] = v.slots?.filter((s: string) => s.trim()) || ['PC']
    const ver = await queryOne(
      'INSERT INTO pc_versions (session_id, name, slots) VALUES ($1,$2,$3) RETURNING *',
      [(pcSession as any).id, v.name, JSON.stringify(slots)]
    )
    if (!ver) continue
    // Save per-slot pull counts: m.pulls is array [countSlot0, countSlot1, ...]
    for (const m of (v.members||[])) {
      if (!m.member_id) continue
      const pulls: number[] = Array.isArray(m.pulls)
        ? m.pulls.map((p: any) => parseInt(p) || 0)
        : slots.map(() => parseInt(m.total_pulled) || 0)
      for (let si = 0; si < slots.length; si++) {
        const pulled = pulls[si] || 0
        if (pulled <= 0) continue
        await query(
          'INSERT INTO pc_photocards (version_id, member_id, slot_index, total_pulled, available) VALUES ($1,$2,$3,$4,$4)',
          [(ver as any).id, m.member_id, si, pulled]
        )
      }
    }
  }
  return NextResponse.json(pcSession, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom','admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await ensureTables()

  const { id, title, form_open, group_id, deadline, box_id, order_ids } = await req.json()
  const s = await queryOne(
    `UPDATE pc_sorting_sessions SET
       title=COALESCE($1,title), form_open=COALESCE($2,form_open),
       group_id=COALESCE($3,group_id), deadline=$4, box_id=COALESCE($5,box_id),
       order_ids=COALESCE($6,order_ids), updated_at=now()
     WHERE id=$7 RETURNING *`,
    [title||null, form_open??null, group_id||null, deadline||null, box_id||null,
     order_ids ? JSON.stringify(order_ids) : null, id]
  )
  return NextResponse.json(s)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom','admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await req.json()
  await query('DELETE FROM pc_sorting_sessions WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
