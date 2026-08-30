import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { ensurePcSorterSchema } from '@/lib/pcSorter'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensurePcSorterSchema()

  // Auto-close any session whose deadline has passed
  await query(`UPDATE pc_sorting_sessions SET form_open=false WHERE deadline IS NOT NULL AND deadline < now() AND form_open=true`).catch(() => {})

  const user = session.user as any
  const sessions = await query(`
    SELECT ps.*, row_to_json(g) as "group", row_to_json(b) as box
    FROM pc_sorting_sessions ps
    LEFT JOIN groups g ON g.id = ps.group_id
    LEFT JOIN boxes b ON b.id = ps.box_id
    ORDER BY ps.created_at DESC
  `)

  // The joiner-facing Sorting page always sends ?viewAs=joiner, for every account — a gom/admin
  // hitting it this way is shown their OWN participation as a joiner (same as the orders page's
  // viewAs convention), not a filtered-down GOM dashboard. A real joiner is always scoped to
  // themselves regardless of this param; it only changes anything for gom/admin.
  const viewAsJoiner = new URL(req.url).searchParams.get('viewAs') === 'joiner'

  // Joiners see a session once its form is open (to submit), and keep seeing it after a sort
  // has run (to view their results) even though the GOM closes the form when running the
  // sort. A session that's closed and has never been sorted still isn't visible at all — it
  // isn't ready for joiners yet. Same rule applies to a gom/admin viewing their own joiner side.
  if (user.role === 'joiner' || (['gom', 'admin'].includes(user.role) && viewAsJoiner)) {
    return NextResponse.json((sessions as any[]).filter(s => s.form_open || s.sort_run_at))
  }
  return NextResponse.json(sessions)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await ensurePcSorterSchema()

  const { title, group_id, box_id, deadline, order_ids, order_versions } = await req.json()
  if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 })

  // Sessions always start closed — the GOM opens the form explicitly once packs/items/
  // quantities/inclusions are set up.
  const pcSession = await queryOne(
    `INSERT INTO pc_sorting_sessions (title, group_id, created_by, deadline, box_id, order_ids, order_versions, form_open)
     VALUES ($1,$2,$3,$4,$5,$6,$7,false) RETURNING *`,
    [title, group_id || null, user.id, deadline || null, box_id || null, order_ids ? JSON.stringify(order_ids) : null,
     order_versions ? JSON.stringify(order_versions) : null]
  )
  return NextResponse.json(pcSession, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await ensurePcSorterSchema()

  const { id, title, form_open, group_id, deadline, box_id, order_ids, order_versions } = await req.json()
  const s = await queryOne(
    `UPDATE pc_sorting_sessions SET
       title=COALESCE($1,title), form_open=COALESCE($2,form_open),
       group_id=COALESCE($3,group_id), deadline=$4, box_id=COALESCE($5,box_id),
       order_ids=COALESCE($6,order_ids), order_versions=COALESCE($7,order_versions), updated_at=now()
     WHERE id=$8 RETURNING *`,
    [title || null, form_open ?? null, group_id || null, deadline || null, box_id || null,
     order_ids ? JSON.stringify(order_ids) : null, order_versions ? JSON.stringify(order_versions) : null, id]
  )
  return NextResponse.json(s)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await req.json()
  await query('DELETE FROM pc_sorting_sessions WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
