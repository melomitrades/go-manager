import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

async function ensureTables() {
  await query(`ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS box_id UUID REFERENCES boxes(id) ON DELETE SET NULL`).catch(() => {})
  await query(`ALTER TABLE pc_versions ADD COLUMN IF NOT EXISTS order_ids TEXT DEFAULT ''`).catch(() => {})
  await query(`CREATE TABLE IF NOT EXISTS pc_inclusion_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES pc_sorting_sessions(id) ON DELETE CASCADE,
    version_id UUID REFERENCES pc_versions(id) ON DELETE CASCADE,
    joiner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    inclusions_assigned INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(version_id, joiner_id)
  )`).catch(() => {})
}

export async function GET(req: NextRequest, { params }: { params: { sessionId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureTables()

  const pcSession = await queryOne(`
    SELECT ps.*, row_to_json(b) as box
    FROM pc_sorting_sessions ps
    LEFT JOIN boxes b ON b.id = ps.box_id
    WHERE ps.id = $1
  `, [params.sessionId])

  const versions = await query(`SELECT * FROM pc_versions WHERE session_id=$1 ORDER BY created_at`, [params.sessionId])
  const photocards = await query(`
    SELECT pc.*, m.name as member_name, m.id as member_id
    FROM pc_photocards pc
    LEFT JOIN members m ON m.id = pc.member_id
    WHERE pc.version_id = ANY(SELECT id FROM pc_versions WHERE session_id=$1)
    ORDER BY pc.version_id, m.sort_order NULLS LAST, m.name
  `, [params.sessionId])

  // Get inclusions per joiner per version (from order_items in linked box orders)
  const inclusions = await query(`
    SELECT
      oi.joiner_id,
      p.display_name,
      p.username,
      SUM(oi.inclusions_count) as total_inclusions,
      SUM(COALESCE(oi.price_krw, 0) * oi.amount_claimed) as total_krw
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN profiles p ON p.id = oi.joiner_id
    WHERE oi.order_id IN (
      SELECT order_id FROM box_orders WHERE box_id = (
        SELECT box_id FROM pc_sorting_sessions WHERE id = $1
      )
    )
    AND oi.inclusions_count > 0
    GROUP BY oi.joiner_id, p.display_name, p.username
    ORDER BY total_inclusions DESC
  `, [params.sessionId]).catch(() => [] as any[])

  // Get assigned inclusions
  const assignments = await query(`
    SELECT * FROM pc_inclusion_assignments WHERE session_id=$1
  `, [params.sessionId]).catch(() => [] as any[])

  // Get submitted forms
  const forms = await query(`
    SELECT pf.*, p.display_name, p.username
    FROM pc_priority_forms pf
    JOIN profiles p ON p.id = pf.joiner_id
    WHERE pf.session_id=$1
    ORDER BY pf.submitted_at DESC
  `, [params.sessionId]).catch(() => [] as any[])

  // Sort results
  const result = await query(`
    SELECT pa.*, m.name as member_name
    FROM pc_assignments pa
    LEFT JOIN pc_photocards pc ON pc.id = pa.photocard_id
    LEFT JOIN members m ON m.id = pc.member_id
    WHERE pa.session_id=$1
  `, [params.sessionId]).catch(() => [] as any[])

  return NextResponse.json({ session: pcSession, versions, photocards, forms, inclusions, assignments, result })
}

export async function POST(req: NextRequest, { params }: { params: { sessionId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  await ensureTables()

  const body = await req.json()

  // Joiner submitting priorities
  if (body.priorities !== undefined) {
    await query('DELETE FROM pc_priority_forms WHERE session_id=$1 AND joiner_id=$2', [params.sessionId, user.id]).catch(() => {})
    await queryOne(
      'INSERT INTO pc_priority_forms (session_id, joiner_id, form_data) VALUES ($1,$2,$3) RETURNING *',
      [params.sessionId, user.id, JSON.stringify({ priorities: body.priorities })]
    )
    return NextResponse.json({ ok: true })
  }

  // GOM: assign inclusions per version per joiner
  if (body.assignments) {
    for (const a of body.assignments) {
      await query(`
        INSERT INTO pc_inclusion_assignments (session_id, version_id, joiner_id, inclusions_assigned)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (version_id, joiner_id) DO UPDATE SET inclusions_assigned=$4
      `, [params.sessionId, a.version_id, a.joiner_id, a.inclusions_assigned])
    }
    return NextResponse.json({ ok: true })
  }

  // GOM: run the sort and assign to sending_out
  if (body.run_sort) {
    // Get all submitted forms
    const allForms = await query(`
      SELECT pf.joiner_id, pf.form_data FROM pc_priority_forms pf WHERE pf.session_id=$1
    `, [params.sessionId]).catch(() => [] as any[])

    // Get inclusions assignments
    const allAssignments = await query(`
      SELECT * FROM pc_inclusion_assignments WHERE session_id=$1
    `, [params.sessionId]).catch(() => [] as any[])

    // For each joiner, create a note in their sending_out entry with their PC sort result
    for (const a of allAssignments as any[]) {
      const version = await queryOne('SELECT * FROM pc_versions WHERE id=$1', [a.version_id]).catch(() => null) as any
      if (!version || !a.inclusions_assigned) continue

      const versionName = version.name || 'Unknown version'
      const note = `PC Sort: ${a.inclusions_assigned}x ${versionName} inclusions`

      // Find or create sending_out entry for this joiner
      const existing = await queryOne(
        'SELECT id, notes FROM sending_out WHERE joiner_id=$1 AND joiner_submitted=true',
        [a.joiner_id]
      ).catch(() => null) as any

      if (existing) {
        const updatedNotes = [existing.notes, note].filter(Boolean).join('\n')
        await query('UPDATE sending_out SET notes=$1 WHERE id=$2', [updatedNotes, existing.id])
      }
      // If no entry yet, save for when they submit
      await query(`
        INSERT INTO pc_sorting_session_assignments (session_id, joiner_id, version_id, inclusions_assigned)
        VALUES ($1,$2,$3,$4) ON CONFLICT (session_id, joiner_id, version_id) DO UPDATE SET inclusions_assigned=$4
      `, [params.sessionId, a.joiner_id, a.version_id, a.inclusions_assigned]).catch(() => {})
    }

    // Mark session as sorted
    await query('UPDATE pc_sorting_sessions SET form_open=false WHERE id=$1', [params.sessionId])
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
