import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

async function ensureTables() {
  await Promise.all([
    query(`ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS box_id UUID REFERENCES boxes(id) ON DELETE SET NULL`).catch(()=>{}),
    query(`ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS order_ids JSONB DEFAULT NULL`).catch(()=>{}),
    query(`ALTER TABLE pc_versions ADD COLUMN IF NOT EXISTS slots JSONB DEFAULT NULL`).catch(()=>{}),
    query(`ALTER TABLE pc_versions ADD COLUMN IF NOT EXISTS order_ids TEXT DEFAULT ''`).catch(()=>{}),
    query(`CREATE TABLE IF NOT EXISTS pc_inclusion_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID REFERENCES pc_sorting_sessions(id) ON DELETE CASCADE,
      version_id UUID REFERENCES pc_versions(id) ON DELETE CASCADE,
      joiner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
      inclusions_assigned INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(version_id, joiner_id)
    )`).catch(()=>{}),
  ])
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

  // Inclusions: use session order_ids if set, else fall back to box orders
  const sessionOrderIds: string[] = (() => {
    try {
      const oids = (pcSession as any)?.order_ids
      if (!oids) return []
      return Array.isArray(oids) ? oids : JSON.parse(oids)
    } catch { return [] }
  })()

  const whereClause = sessionOrderIds.length > 0
    ? `oi.order_id = ANY(ARRAY[${sessionOrderIds.map((_,i) => `$${i+2}::uuid`).join(',')}])`
    : `oi.order_id IN (SELECT order_id FROM box_orders WHERE box_id = (SELECT box_id FROM pc_sorting_sessions WHERE id = $1))`
  const inclusionParams: any[] = sessionOrderIds.length > 0
    ? [params.sessionId, ...sessionOrderIds]
    : [params.sessionId]

  const inclusions = await query(`
    SELECT
      COALESCE(oi.joiner_id, o.personal_joiner_id) AS joiner_id,
      p.display_name,
      p.username,
      SUM(COALESCE(oi.inclusions_count, 0)) AS total_inclusions,
      SUM(COALESCE(oi.price_krw, 0) * COALESCE(oi.amount_claimed, 1)) as total_krw
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN profiles p ON p.id = COALESCE(oi.joiner_id, o.personal_joiner_id)
    WHERE ${whereClause}
      AND COALESCE(oi.joiner_id, o.personal_joiner_id) IS NOT NULL
      AND COALESCE(oi.inclusions_count, 0) > 0
    GROUP BY COALESCE(oi.joiner_id, o.personal_joiner_id), p.display_name, p.username
    ORDER BY total_inclusions DESC
  `, inclusionParams).catch(() => [] as any[])

  const assignments = await query(`SELECT * FROM pc_inclusion_assignments WHERE session_id=$1`, [params.sessionId]).catch(() => [] as any[])
  const forms = await query(`
    SELECT pf.*, p.display_name, p.username
    FROM pc_priority_forms pf
    JOIN profiles p ON p.id = pf.joiner_id
    WHERE pf.session_id=$1
    ORDER BY pf.submitted_at DESC
  `, [params.sessionId]).catch(() => [] as any[])
  const result = await query(`
    SELECT pa.*, m.name as member_name
    FROM pc_assignments pa
    LEFT JOIN pc_photocards pc ON pc.id = pa.photocard_id
    LEFT JOIN members m ON m.id = pc.member_id
    WHERE pa.session_id=$1
  `, [params.sessionId]).catch(() => [] as any[])

  // Debug: check what order_items exist for these orders
  const debugItems = await query(`
    SELECT oi.order_id, oi.joiner_id, o.personal_joiner_id, oi.inclusions_count, oi.item_type, oi.description, oi.amount_claimed
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE ${whereClause}
    LIMIT 20
  `, inclusionParams).catch(() => [] as any[])

  return NextResponse.json({ session: pcSession, versions, photocards, forms, inclusions, assignments, result, _debug: { sessionOrderIds, whereClause, inclusionParams: inclusionParams.map((p: any) => Array.isArray(p) ? `array[${p.length}]` : p), debugItems } })
}

export async function POST(req: NextRequest, { params }: { params: { sessionId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  await ensureTables()

  const body = await req.json()

  // Joiner submitting priorities (per slot per version)
  if (body.priorities !== undefined) {
    await query('DELETE FROM pc_priority_forms WHERE session_id=$1 AND joiner_id=$2', [params.sessionId, user.id]).catch(()=>{})
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

  // GOM: run sort — assign members per slot per version based on priorities
  if (body.run_sort) {
    const allForms = await query(`SELECT pf.joiner_id, pf.form_data FROM pc_priority_forms pf WHERE pf.session_id=$1`, [params.sessionId]).catch(() => [] as any[])
    const allAssignments = await query(`SELECT * FROM pc_inclusion_assignments WHERE session_id=$1`, [params.sessionId]).catch(() => [] as any[])
    const allVersions = await query(`SELECT * FROM pc_versions WHERE session_id=$1`, [params.sessionId]).catch(() => [] as any[])
    const allPhotocards = await query(`SELECT * FROM pc_photocards WHERE version_id = ANY(SELECT id FROM pc_versions WHERE session_id=$1)`, [params.sessionId]).catch(() => [] as any[])

    // Build priority map: joiner_id -> version_id -> slot_index -> [member_id ordered]
    const priorityMap: Record<string, any> = {}
    for (const f of allForms as any[]) {
      priorityMap[f.joiner_id] = f.form_data?.priorities || {}
    }

    // For each version, for each slot, run a greedy assignment
    for (const ver of allVersions as any[]) {
      const slots: string[] = (() => { try { return JSON.parse(ver.slots || '["PC"]') } catch { return ['PC'] } })()
      const vPhotocards = (allPhotocards as any[]).filter(p => p.version_id === ver.id)

      // Track available stock per member for this version
      const available: Record<string, number> = {}
      for (const pc of vPhotocards) available[pc.member_id] = pc.available || pc.total_pulled || 0

      // Joiners who have inclusions in this version
      const vAssignments = (allAssignments as any[]).filter(a => a.version_id === ver.id)

      for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
        // Collect all joiner slot-requests: each inclusion pack = 1 request for this slot
        const requests: { joiner_id: string; priorities: string[] }[] = []
        for (const a of vAssignments) {
          const joinerId = a.joiner_id
          const count = a.inclusions_assigned || 0
          const slotPriorities: string[] = priorityMap[joinerId]?.[ver.id]?.[slotIdx] || []
          for (let i = 0; i < count; i++) {
            requests.push({ joiner_id: joinerId, priorities: slotPriorities })
          }
        }

        // Greedy: assign each request to their highest-priority available member
        const results: { joiner_id: string; member_id: string; slot: string }[] = []
        for (const req of requests) {
          let assigned: string | null = null
          for (const memberId of req.priorities) {
            if ((available[memberId] || 0) > 0) {
              available[memberId]--
              assigned = memberId
              break
            }
          }
          // Fallback: any available member
          if (!assigned) {
            const fallback = Object.entries(available).find(([, v]) => v > 0)
            if (fallback) { available[fallback[0]]--; assigned = fallback[0] }
          }
          if (assigned) results.push({ joiner_id: req.joiner_id, member_id: assigned, slot: slots[slotIdx] })
        }

        // Save results
        for (const r of results) {
          const pc = vPhotocards.find(p => p.member_id === r.member_id)
          if (!pc) continue
          await query(`
            INSERT INTO pc_assignments (session_id, joiner_id, photocard_id, version_id)
            VALUES ($1,$2,$3,$4)
            ON CONFLICT DO NOTHING
          `, [params.sessionId, r.joiner_id, pc.id, ver.id]).catch(()=>{})
        }

        // Update available stock
        for (const pc of vPhotocards) {
          await query('UPDATE pc_photocards SET available=$1 WHERE id=$2', [available[pc.member_id] ?? pc.available, pc.id]).catch(()=>{})
        }
      }
    }

    await query('UPDATE pc_sorting_sessions SET form_open=false WHERE id=$1', [params.sessionId])
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
