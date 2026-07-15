import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

async function ensureTables() {
  await Promise.all([
    query(`ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS box_id UUID REFERENCES boxes(id) ON DELETE SET NULL`).catch(()=>{}),
    query(`ALTER TABLE pc_sorting_sessions ADD COLUMN IF NOT EXISTS order_ids JSONB DEFAULT NULL`).catch(()=>{}),
    query(`ALTER TABLE pc_versions ADD COLUMN IF NOT EXISTS slots JSONB DEFAULT NULL`).catch(()=>{}),
    query(`ALTER TABLE pc_photocards ADD COLUMN IF NOT EXISTS slot_index INTEGER DEFAULT 0`).catch(()=>{}),
    query(`ALTER TABLE pc_assignments ADD COLUMN IF NOT EXISTS slot_index INTEGER DEFAULT 0`).catch(()=>{}),
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

  // Use same approach as boxes route — query per order to avoid ANY(uuid[]) driver issues
  const orderIdsToQuery: string[] = sessionOrderIds.length > 0
    ? sessionOrderIds
    : await query(`SELECT order_id FROM box_orders WHERE box_id = (SELECT box_id FROM pc_sorting_sessions WHERE id = $1)`, [params.sessionId])
        .then((rows: any[]) => rows.map(r => r.order_id))
        .catch(() => [] as string[])

  const joinerInclusionMap: Record<string, { display_name: string; username: string; total_inclusions: number; total_krw: number }> = {}

  for (const oid of orderIdsToQuery) {
    const items = await query(`
      SELECT
        COALESCE(oi.joiner_id, o.personal_joiner_id) AS joiner_id,
        p.display_name, p.username,
        COALESCE(oi.inclusions_count, 0) AS inclusions_count,
        COALESCE(oi.price_krw, 0) * COALESCE(oi.amount_claimed, 1) AS krw
      FROM order_items oi
      LEFT JOIN orders o ON o.id = oi.order_id
      LEFT JOIN profiles p ON p.id = COALESCE(oi.joiner_id, o.personal_joiner_id)
      WHERE oi.order_id = $1
        AND (oi.joiner_id IS NOT NULL OR (oi.joiner_id IS NULL AND o.personal_joiner_id IS NOT NULL AND o.type = 'personal'))
        AND COALESCE(oi.joiner_id, o.personal_joiner_id) IS NOT NULL
        AND COALESCE(oi.inclusions_count, 0) > 0
    `, [oid]).catch(() => [] as any[])

    for (const item of items as any[]) {
      const jid = item.joiner_id
      if (!joinerInclusionMap[jid]) {
        joinerInclusionMap[jid] = { display_name: item.display_name, username: item.username, total_inclusions: 0, total_krw: 0 }
      }
      joinerInclusionMap[jid].total_inclusions += parseInt(item.inclusions_count) || 0
      joinerInclusionMap[jid].total_krw += parseFloat(item.krw) || 0
    }
  }

  const inclusions = Object.entries(joinerInclusionMap)
    .map(([joiner_id, v]) => ({ joiner_id, ...v }))
    .filter(j => j.total_inclusions > 0)
    .sort((a, b) => b.total_inclusions - a.total_inclusions)

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

  // Ownership: for each version in this session, find what member+version combos joiners already own
  // from OTHER sessions with the same version name
  const ownership = await query(`
    SELECT DISTINCT pa.joiner_id, m.id as member_id, m.name as member_name,
      pv.name as version_name, ps.title as session_title, ps.id as session_id
    FROM pc_assignments pa
    JOIN pc_photocards pc ON pc.id = pa.photocard_id
    JOIN members m ON m.id = pc.member_id
    JOIN pc_versions pv ON pv.id = pa.version_id
    JOIN pc_sorting_sessions ps ON ps.id = pa.session_id
    WHERE pa.session_id != $1
      AND pv.name IN (SELECT name FROM pc_versions WHERE session_id = $1)
  `, [params.sessionId]).catch(() => [] as any[])

  return NextResponse.json({ session: pcSession, versions, photocards, forms, inclusions, assignments, result, ownership })
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

  // GOM: update versions slots and pull counts
  if (body.update_versions && body.versions) {
    for (const v of body.versions) {
      const slots: string[] = v.slots || ['PC']
      // Update version slots
      await query('UPDATE pc_versions SET name=$1, slots=$2 WHERE id=$3',
        [v.name, JSON.stringify(slots), v.id]).catch(()=>{})
      // Delete old photocards and re-insert with updated pulls
      await query('DELETE FROM pc_photocards WHERE version_id=$1', [v.id]).catch(()=>{})
      for (const m of v.members || []) {
        const pulls: number[] = Array.isArray(m.pulls) ? m.pulls.map((p: any) => parseInt(p) || 0) : slots.map(() => 0)
        for (let si = 0; si < slots.length; si++) {
          const pulled = pulls[si] || 0
          if (pulled <= 0) continue
          await query(
            'INSERT INTO pc_photocards (version_id, member_id, slot_index, total_pulled, available) VALUES ($1,$2,$3,$4,$4)',
            [v.id, m.member_id, si, pulled]
          ).catch(()=>{})
        }
      }
    }
    return NextResponse.json({ ok: true })
  }
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

    // Build owned set: joiner+version_name+member combos from other sessions with same version name
    const ownedRows = await query(`
      SELECT DISTINCT pa.joiner_id, m.id as member_id, pv.name as version_name
      FROM pc_assignments pa
      JOIN pc_photocards pc ON pc.id = pa.photocard_id
      JOIN members m ON m.id = pc.member_id
      JOIN pc_versions pv ON pv.id = pa.version_id
      WHERE pa.session_id != $1
        AND pv.name IN (SELECT name FROM pc_versions WHERE session_id = $1)
    `, [params.sessionId]).catch(() => [] as any[])
    const ownedSet = new Set((ownedRows as any[]).map((r: any) => `${r.joiner_id}|${r.version_name}|${r.member_id}`))

    const priorityMap: Record<string, any> = {}
    for (const f of allForms as any[]) {
      priorityMap[f.joiner_id] = f.form_data?.priorities || {}
    }

    for (const ver of allVersions as any[]) {
      const slots: string[] = (() => { try { return JSON.parse(ver.slots || '["PC"]') } catch { return ['PC'] } })()
      const vPhotocards = (allPhotocards as any[]).filter((p: any) => p.version_id === ver.id)
      const versionName: string = ver.name || ''
      const available: Record<string, number> = {}
      for (const pc of vPhotocards) available[pc.member_id] = pc.available || pc.total_pulled || 0
      const vAssignments = (allAssignments as any[]).filter((a: any) => a.version_id === ver.id)

      for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
        // Filter photocards for this specific slot
        const slotPhotocards = vPhotocards.filter((p: any) => (p.slot_index ?? 0) === slotIdx)

        // Per-slot available stock
        const slotAvailable: Record<string, number> = {}
        for (const pc of slotPhotocards) slotAvailable[pc.member_id] = pc.available || pc.total_pulled || 0

        const requests: { joiner_id: string; priorities: string[] }[] = []
        for (const a of vAssignments) {
          const count = a.inclusions_assigned || 0
          const slotPriorities: string[] = priorityMap[a.joiner_id]?.[ver.id]?.[slotIdx] || []
          for (let i = 0; i < count; i++) requests.push({ joiner_id: a.joiner_id, priorities: slotPriorities })
        }

        const results: { joiner_id: string; member_id: string }[] = []
        for (const req of requests) {
          let assigned: string | null = null
          // 1. Try priorities skipping already-owned
          for (const memberId of req.priorities) {
            if (!ownedSet.has(`${req.joiner_id}|${versionName}|${memberId}`) && (slotAvailable[memberId] || 0) > 0) {
              slotAvailable[memberId]--; assigned = memberId; break
            }
          }
          // 2. Fallback: any non-owned available member in this slot
          if (!assigned) {
            for (const [memberId, qty] of Object.entries(slotAvailable)) {
              if (qty > 0 && !ownedSet.has(`${req.joiner_id}|${versionName}|${memberId}`)) {
                slotAvailable[memberId]--; assigned = memberId; break
              }
            }
          }
          // 3. Last resort: any available member in this slot
          if (!assigned) {
            const fb = Object.entries(slotAvailable).find(([, v]) => v > 0)
            if (fb) { slotAvailable[fb[0]]--; assigned = fb[0] }
          }
          if (assigned) results.push({ joiner_id: req.joiner_id, member_id: assigned })
        }

        for (const r of results) {
          const pc = slotPhotocards.find((p: any) => p.member_id === r.member_id)
          if (!pc) continue
          await query(`INSERT INTO pc_assignments (session_id, joiner_id, photocard_id, version_id, slot_index) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
            [params.sessionId, r.joiner_id, pc.id, ver.id, slotIdx]).catch(()=>{})
        }
        // Update slot-specific available stock
        for (const pc of slotPhotocards) {
          await query('UPDATE pc_photocards SET available=$1 WHERE id=$2', [slotAvailable[pc.member_id] ?? pc.available, pc.id]).catch(()=>{})
        }
      }
    }
    await query('UPDATE pc_sorting_sessions SET form_open=false WHERE id=$1', [params.sessionId])
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
