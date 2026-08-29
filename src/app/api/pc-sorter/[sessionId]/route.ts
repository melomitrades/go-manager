import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { ensurePcSorterSchema, autoFillInclusions, resetInclusions } from '@/lib/pcSorter'

export async function GET(req: NextRequest, { params }: { params: { sessionId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  await ensurePcSorterSchema()
  const sessionId = params.sessionId

  const sessionRow = await queryOne(`
    SELECT ps.*, row_to_json(b) as box
    FROM pc_sorting_sessions ps
    LEFT JOIN boxes b ON b.id = ps.box_id
    WHERE ps.id = $1
  `, [sessionId])
  if (!sessionRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const packs = await query(`SELECT * FROM pc_packs WHERE session_id=$1 ORDER BY sort_order, created_at`, [sessionId])
  const items = await query(`
    SELECT * FROM pc_items WHERE pack_id = ANY(SELECT id FROM pc_packs WHERE session_id=$1) ORDER BY sort_order, created_at
  `, [sessionId])
  const quantities = await query(`
    SELECT q.*, m.name as member_name
    FROM pc_item_quantities q
    LEFT JOIN members m ON m.id = q.member_id
    WHERE q.item_id = ANY(SELECT id FROM pc_items WHERE pack_id = ANY(SELECT id FROM pc_packs WHERE session_id=$1))
  `, [sessionId])

  let inclusions = await query(`
    SELECT i.*, p.display_name, p.username
    FROM pc_pack_inclusions i
    LEFT JOIN profiles p ON p.id = i.joiner_id
    WHERE i.session_id=$1
  `, [sessionId])

  let forms = await query(`
    SELECT f.*, p.display_name, p.username
    FROM pc_priority_forms f
    JOIN profiles p ON p.id = f.joiner_id
    WHERE f.session_id=$1
    ORDER BY f.submitted_at ASC
  `, [sessionId])

  let entries = await query(`
    SELECT e.* FROM pc_priority_entries e
    WHERE e.form_id = ANY(SELECT id FROM pc_priority_forms WHERE session_id=$1)
  `, [sessionId])

  let assignments = await query(`
    SELECT a.*, pk.name as pack_name, it.name as item_name, m.name as member_name, p.display_name, p.username
    FROM pc_assignments a
    LEFT JOIN pc_packs pk ON pk.id = a.pack_id
    LEFT JOIN pc_items it ON it.id = a.item_id
    LEFT JOIN members m ON m.id = a.member_id
    LEFT JOIN profiles p ON p.id = a.joiner_id
    WHERE a.session_id=$1
    ORDER BY a.created_at ASC
  `, [sessionId])

  let ownership = await query(`
    SELECT DISTINCT a.joiner_id, a.member_id, m.name as member_name, pk.name as pack_name, it.name as item_name,
           p.display_name, p.username, s.title as session_title, s.id as session_id
    FROM pc_assignments a
    JOIN pc_packs pk ON pk.id = a.pack_id
    JOIN pc_items it ON it.id = a.item_id
    JOIN pc_sorting_sessions s ON s.id = a.session_id
    LEFT JOIN members m ON m.id = a.member_id
    LEFT JOIN profiles p ON p.id = a.joiner_id
    WHERE a.session_id != $1
      AND pk.name IN (SELECT name FROM pc_packs WHERE session_id=$1)
  `, [sessionId]).catch(() => [] as any[])

  // The joiner-facing Sorting page always sends ?viewAs=joiner, for every account. For a real
  // joiner this changes nothing (they're always scoped to themselves regardless). For a
  // gom/admin it means "show MY OWN participation as a joiner, the same as any other joiner
  // sees theirs" — scoped to their own id, never an arbitrary other joiner's.
  const viewAsJoiner = new URL(req.url).searchParams.get('viewAs') === 'joiner'
  const scopeToSelf = user.role === 'joiner' || (['gom', 'admin'].includes(user.role) && viewAsJoiner)

  // Joiners (real, or a gom/admin viewing their own joiner side) only ever see their own
  // priority forms / entries / inclusions / assignments — never other joiners' picks or results.
  if (scopeToSelf) {
    const myFormIds = new Set((forms as any[]).filter(f => f.joiner_id === user.id).map(f => f.id))
    entries = (entries as any[]).filter(e => myFormIds.has(e.form_id))
    forms = (forms as any[]).filter(f => f.joiner_id === user.id)
    inclusions = (inclusions as any[]).filter(i => i.joiner_id === user.id)
    assignments = (assignments as any[]).filter(a => a.joiner_id === user.id)
    ownership = []
  }

  return NextResponse.json({ session: sessionRow, packs, items, quantities, inclusions, forms, entries, assignments, ownership })
}

export async function POST(req: NextRequest, { params }: { params: { sessionId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  await ensurePcSorterSchema()
  const sessionId = params.sessionId
  const body = await req.json()

  // ── Joiner: submit priority form (independent ranking per item) ──
  if (body.priorities !== undefined) {
    const sessionRow = await queryOne<any>(`SELECT * FROM pc_sorting_sessions WHERE id=$1`, [sessionId])
    if (!sessionRow) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    if (!sessionRow.form_open) return NextResponse.json({ error: 'This form is closed' }, { status: 403 })
    if (sessionRow.deadline && new Date(sessionRow.deadline) < new Date()) {
      return NextResponse.json({ error: 'The deadline for this form has passed' }, { status: 403 })
    }

    // One submission per joiner per session, period — no self-service edits. If the GOM
    // reopens the form after a sort, that's for joiners who never submitted at all to get a
    // chance; it never reopens editing for someone who already has a form on file.
    const existingForm = await queryOne<any>(`SELECT id FROM pc_priority_forms WHERE session_id=$1 AND joiner_id=$2`, [sessionId, user.id])
    if (existingForm) {
      return NextResponse.json({ error: "You've already submitted your priorities for this session — they can't be changed." }, { status: 403 })
    }

    const form = await queryOne<any>(`
      INSERT INTO pc_priority_forms (session_id, joiner_id, submitted_at, form_data)
      VALUES ($1,$2, now(), '{}')
      ON CONFLICT (session_id, joiner_id) DO UPDATE SET submitted_at = now()
      RETURNING *
    `, [sessionId, user.id])
    if (!form) return NextResponse.json({ error: 'Failed to save form' }, { status: 500 })

    await query(`DELETE FROM pc_priority_entries WHERE form_id=$1`, [form.id])
    for (const p of (body.priorities || [])) {
      if (!p.item_id || !p.member_id || !p.priority) continue
      await query(
        `INSERT INTO pc_priority_entries (form_id, item_id, member_id, priority) VALUES ($1,$2,$3,$4)`,
        [form.id, p.item_id, p.member_id, parseInt(p.priority)]
      )
    }
    return NextResponse.json({ ok: true })
  }

  // ── Everything else is GOM/admin only ──
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (body.add_pack) {
    const p = await queryOne(
      `INSERT INTO pc_packs (session_id, name, sort_order)
       VALUES ($1,$2, COALESCE((SELECT MAX(sort_order)+1 FROM pc_packs WHERE session_id=$1),0)) RETURNING *`,
      [sessionId, body.add_pack.name]
    )
    return NextResponse.json(p, { status: 201 })
  }
  if (body.rename_pack) {
    await query(`UPDATE pc_packs SET name=$1 WHERE id=$2 AND session_id=$3`, [body.rename_pack.name, body.rename_pack.pack_id, sessionId])
    return NextResponse.json({ ok: true })
  }
  if (body.delete_pack) {
    await query(`DELETE FROM pc_packs WHERE id=$1 AND session_id=$2`, [body.delete_pack.pack_id, sessionId])
    return NextResponse.json({ ok: true })
  }

  if (body.add_item) {
    const it = await queryOne(
      `INSERT INTO pc_items (pack_id, name, sort_order)
       VALUES ($1,$2, COALESCE((SELECT MAX(sort_order)+1 FROM pc_items WHERE pack_id=$1),0)) RETURNING *`,
      [body.add_item.pack_id, body.add_item.name]
    )
    return NextResponse.json(it, { status: 201 })
  }
  if (body.rename_item) {
    await query(`UPDATE pc_items SET name=$1 WHERE id=$2`, [body.rename_item.name, body.rename_item.item_id])
    return NextResponse.json({ ok: true })
  }
  if (body.delete_item) {
    await query(`DELETE FROM pc_items WHERE id=$1`, [body.delete_item.item_id])
    return NextResponse.json({ ok: true })
  }

  if (body.update_quantities) {
    const { item_id, quantities } = body.update_quantities
    for (const q of (quantities || [])) {
      const total = parseInt(q.total_pulled) || 0
      await query(`
        INSERT INTO pc_item_quantities (item_id, member_id, total_pulled, available)
        VALUES ($1,$2,$3,$3)
        ON CONFLICT (item_id, member_id) DO UPDATE SET total_pulled=$3, available=$3
      `, [item_id, q.member_id, total])
    }
    return NextResponse.json({ ok: true })
  }

  if (body.inclusions) {
    for (const a of body.inclusions) {
      await query(`
        INSERT INTO pc_pack_inclusions (session_id, pack_id, joiner_id, inclusions_assigned)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (pack_id, joiner_id) DO UPDATE SET inclusions_assigned=$4
      `, [sessionId, a.pack_id, a.joiner_id, parseInt(a.inclusions_assigned) || 0])
    }
    return NextResponse.json({ ok: true })
  }
  if (body.auto_fill_inclusions) {
    const result = await autoFillInclusions(sessionId)
    return NextResponse.json(result)
  }
  if (body.reset_inclusions) {
    const result = await resetInclusions(sessionId)
    return NextResponse.json(result)
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
