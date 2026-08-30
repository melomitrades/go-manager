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

  // These 9 reads are all independent SELECTs keyed by sessionId (or by ids derived purely from
  // sessionId) — none of them depends on another's result, so run them concurrently instead of
  // as 9 sequential round trips. `let` because forms/entries/inclusions/assignments/ownership get
  // filtered in place below when scoping the response to a single joiner.
  let [packs, items, units, quantities, inclusions, forms, entries, assignments, ownership] = await Promise.all([
    query(`SELECT * FROM pc_packs WHERE session_id=$1 ORDER BY sort_order, created_at`, [sessionId]),
    query(`
      SELECT * FROM pc_items WHERE pack_id = ANY(SELECT id FROM pc_packs WHERE session_id=$1) ORDER BY sort_order, created_at
    `, [sessionId]),
    // A unit-tagged item's sortable options are pc_item_units rows (several real members combined
    // into one, e.g. "Mai + Jungeun") instead of one row per real group member — fetched here so
    // the GOM UI can render/manage them, and joined into quantities/assignments/ownership below so
    // their combined name resolves the same way a real member's name would.
    query(`
      SELECT * FROM pc_item_units
      WHERE item_id = ANY(SELECT id FROM pc_items WHERE pack_id = ANY(SELECT id FROM pc_packs WHERE session_id=$1))
      ORDER BY sort_order, created_at
    `, [sessionId]),
    query(`
      SELECT q.*, COALESCE(m.name, u.name) as member_name
      FROM pc_item_quantities q
      LEFT JOIN members m ON m.id = q.member_id
      LEFT JOIN pc_item_units u ON u.id = q.member_id
      WHERE q.item_id = ANY(SELECT id FROM pc_items WHERE pack_id = ANY(SELECT id FROM pc_packs WHERE session_id=$1))
    `, [sessionId]),
    query(`
      SELECT i.*, p.display_name, p.username
      FROM pc_pack_inclusions i
      LEFT JOIN profiles p ON p.id = i.joiner_id
      WHERE i.session_id=$1
    `, [sessionId]),
    query(`
      SELECT f.*, p.display_name, p.username
      FROM pc_priority_forms f
      JOIN profiles p ON p.id = f.joiner_id
      WHERE f.session_id=$1
      ORDER BY f.submitted_at ASC
    `, [sessionId]),
    query(`
      SELECT e.* FROM pc_priority_entries e
      WHERE e.form_id = ANY(SELECT id FROM pc_priority_forms WHERE session_id=$1)
    `, [sessionId]),
    query(`
      SELECT a.*, pk.name as pack_name, it.name as item_name, COALESCE(m.name, u.name) as member_name, p.display_name, p.username
      FROM pc_assignments a
      LEFT JOIN pc_packs pk ON pk.id = a.pack_id
      LEFT JOIN pc_items it ON it.id = a.item_id
      LEFT JOIN members m ON m.id = a.member_id
      LEFT JOIN pc_item_units u ON u.id = a.member_id
      LEFT JOIN profiles p ON p.id = a.joiner_id
      WHERE a.session_id=$1
      ORDER BY a.created_at ASC
    `, [sessionId]),
    query(`
      SELECT DISTINCT a.joiner_id, a.member_id, COALESCE(m.name, u.name) as member_name, pk.name as pack_name, it.name as item_name,
             p.display_name, p.username, s.title as session_title, s.id as session_id
      FROM pc_assignments a
      JOIN pc_packs pk ON pk.id = a.pack_id
      JOIN pc_items it ON it.id = a.item_id
      JOIN pc_sorting_sessions s ON s.id = a.session_id
      LEFT JOIN members m ON m.id = a.member_id
      LEFT JOIN pc_item_units u ON u.id = a.member_id
      LEFT JOIN profiles p ON p.id = a.joiner_id
      WHERE a.session_id != $1
        AND pk.name IN (SELECT name FROM pc_packs WHERE session_id=$1)
    `, [sessionId]).catch(() => [] as any[]),
  ])

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

  return NextResponse.json({ session: sessionRow, packs, items, units, quantities, inclusions, forms, entries, assignments, ownership })
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
    if (sessionRow.locked_at) return NextResponse.json({ error: 'This session is locked — the GOM has finalized its sort.' }, { status: 403 })

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

  // ── Lock / unlock: freezes packs, items, quantities, inclusions, and the sort itself once
  // the GOM is happy with the results, so nothing can shift under a result that may already
  // have been communicated to joiners. Requires a sort to have actually run first — locking an
  // un-sorted session wouldn't "validate" anything. Unlock just clears it; no side effects.
  if (body.lock_sort !== undefined) {
    const sessionRow = await queryOne<any>(`SELECT sort_run_at FROM pc_sorting_sessions WHERE id=$1`, [sessionId])
    if (!sessionRow) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    if (!sessionRow.sort_run_at) return NextResponse.json({ error: 'Run the sort at least once before locking it.' }, { status: 400 })
    const s = await queryOne(
      `UPDATE pc_sorting_sessions SET locked_at=now(), form_open=false, updated_at=now() WHERE id=$1 RETURNING *`,
      [sessionId]
    )
    return NextResponse.json(s)
  }
  if (body.unlock_sort !== undefined) {
    const s = await queryOne(`UPDATE pc_sorting_sessions SET locked_at=NULL, updated_at=now() WHERE id=$1 RETURNING *`, [sessionId])
    return NextResponse.json(s)
  }

  // Every other GOM action below mutates packs/items/quantities/inclusions/the sort — all
  // blocked once the session is locked. (lock_sort/unlock_sort themselves are handled above,
  // before this check, so unlocking always works regardless of current state.)
  const mutatingKeys = ['add_pack', 'rename_pack', 'delete_pack', 'add_item', 'rename_item', 'delete_item', 'add_unit', 'delete_unit', 'update_quantities', 'inclusions', 'auto_fill_inclusions', 'reset_inclusions']
  if (mutatingKeys.some(k => body[k] !== undefined)) {
    const sessionRow = await queryOne<any>(`SELECT locked_at FROM pc_sorting_sessions WHERE id=$1`, [sessionId])
    if (sessionRow?.locked_at) return NextResponse.json({ error: 'This session is locked — unlock it first to make changes.' }, { status: 403 })
  }

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
      `INSERT INTO pc_items (pack_id, name, sort_order, is_unit)
       VALUES ($1,$2, COALESCE((SELECT MAX(sort_order)+1 FROM pc_items WHERE pack_id=$1),0), $3) RETURNING *`,
      [body.add_item.pack_id, body.add_item.name, !!body.add_item.is_unit]
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

  // ── Unit combos (e.g. "Mai + Jungeun") for a unit-tagged item — scoped to that one item, not
  // the group's member roster. No rename endpoint, same as items/packs themselves not being
  // renamable from this UI: delete and re-add to change one.
  if (body.add_unit) {
    const { item_id, name, member_ids } = body.add_unit
    if (!item_id || !name || !Array.isArray(member_ids) || member_ids.length === 0) {
      return NextResponse.json({ error: 'A unit combo needs a name and at least one member' }, { status: 400 })
    }
    const u = await queryOne(
      `INSERT INTO pc_item_units (item_id, name, member_ids, sort_order)
       VALUES ($1,$2,$3, COALESCE((SELECT MAX(sort_order)+1 FROM pc_item_units WHERE item_id=$1),0))
       RETURNING *`,
      [item_id, name, JSON.stringify(member_ids)]
    )
    return NextResponse.json(u, { status: 201 })
  }
  if (body.delete_unit) {
    // No FK cascade on pc_item_quantities.member_id any more (it can point at either a real
    // member or a unit) — clean up this unit's quantity row by hand before dropping it.
    await query(`DELETE FROM pc_item_quantities WHERE member_id=$1`, [body.delete_unit.unit_id])
    await query(`DELETE FROM pc_item_units WHERE id=$1`, [body.delete_unit.unit_id])
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
