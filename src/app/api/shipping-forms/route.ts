import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { ensureShipmentsSchema, joinerEligibleForBoxes } from '@/lib/shipments'

// gom_id must be a GOM/admin profile (or empty to unassign). Returns the id, null, or an error.
async function validGomId(v: any): Promise<{ id: string | null } | { error: string }> {
  if (v === null || v === undefined || v === '') return { id: null }
  const p = await queryOne<any>(`SELECT id FROM profiles WHERE id=$1 AND role IN ('gom','admin')`, [String(v)])
  return p ? { id: String(p.id) } : { error: 'That person is not a GOM' }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  await ensureShipmentsSchema()

  const viewAsJoiner = new URL(req.url).searchParams.get('viewAs') === 'joiner'
  const asJoiner = user.role === 'joiner' || (['gom', 'admin'].includes(user.role) && viewAsJoiner)

  const forms = await query<any>(`
    SELECT f.*, COALESCE(bx.boxes, '[]'::json) as boxes, COALESCE(gp.display_name, gp.username) as gom_name
    FROM shipping_forms f
    LEFT JOIN profiles gp ON gp.id = f.gom_id
    LEFT JOIN (
      SELECT sfb.form_id, json_agg(json_build_object('id', b.id, 'label', b.label)) as boxes
      FROM shipping_form_boxes sfb JOIN boxes b ON b.id = sfb.box_id
      GROUP BY sfb.form_id
    ) bx ON bx.form_id = f.id
    ORDER BY f.created_at DESC
  `)

  if (!asJoiner) {
    // GOM/admin: also attach a quick shipment count per form
    const counts = await query<any>(`SELECT form_id, count(*)::int as shipment_count FROM shipments GROUP BY form_id`)
    const countByForm = new Map(counts.map(c => [c.form_id, c.shipment_count]))
    for (const f of forms) f.shipment_count = countByForm.get(f.id) || 0
    return NextResponse.json(forms)
  }

  // Joiner view: only forms they're actually eligible for (have an At-GOM claim in one of the
  // form's boxes) OR forms where they already have a shipment on file (so a submitted form
  // doesn't disappear from their view once the GOM closes it).
  const myShipments = await query<any>('SELECT form_id FROM shipments WHERE joiner_id=$1', [user.id])
  const myFormIds = new Set(myShipments.map(s => s.form_id))

  const out: any[] = []
  for (const f of forms) {
    if (myFormIds.has(f.id)) { out.push(f); continue }
    if (!f.form_open) continue
    const boxIds = (f.boxes || []).map((b: any) => b.id)
    if (await joinerEligibleForBoxes(user.id, boxIds)) out.push(f)
  }
  return NextResponse.json(out)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await ensureShipmentsSchema()

  const { title, box_ids, deadline, form_open, gom_id } = await req.json()
  if (!title || !Array.isArray(box_ids) || box_ids.length === 0) {
    return NextResponse.json({ error: 'title and at least one box are required' }, { status: 400 })
  }
  const gom = await validGomId(gom_id)
  if ('error' in gom) return NextResponse.json({ error: gom.error }, { status: 400 })

  const form = await queryOne<any>(
    `INSERT INTO shipping_forms (title, deadline, form_open, created_by, gom_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [title, deadline || null, !!form_open, user.id, gom.id]
  )
  for (const boxId of box_ids) {
    await query('INSERT INTO shipping_form_boxes (form_id, box_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [form!.id, boxId])
  }
  return NextResponse.json(form, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await ensureShipmentsSchema()

  const body = await req.json()
  const { id, title, box_ids, form_open } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  // Tri-state: the key absent means "don't touch"; present (even as '' to clear) means "set it".
  const deadlineProvided = Object.prototype.hasOwnProperty.call(body, 'deadline')
  // Same tri-state for the packing GOM ('' / null = unassign).
  const gomProvided = Object.prototype.hasOwnProperty.call(body, 'gom_id')
  let gomId: string | null = null
  if (gomProvided) {
    const gom = await validGomId(body.gom_id)
    if ('error' in gom) return NextResponse.json({ error: gom.error }, { status: 400 })
    gomId = gom.id
  }

  const form = await queryOne<any>(
    `UPDATE shipping_forms SET
       title = COALESCE($1, title),
       deadline = CASE WHEN $2 THEN $3::timestamptz ELSE deadline END,
       form_open = COALESCE($4, form_open),
       gom_id = CASE WHEN $6 THEN $7::uuid ELSE gom_id END,
       updated_at = now()
     WHERE id=$5 RETURNING *`,
    [title || null, deadlineProvided, deadlineProvided ? (body.deadline || null) : null, form_open ?? null, id, gomProvided, gomId]
  )

  if (Array.isArray(box_ids)) {
    await query('DELETE FROM shipping_form_boxes WHERE form_id=$1', [id])
    for (const boxId of box_ids) {
      await query('INSERT INTO shipping_form_boxes (form_id, box_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, boxId])
    }
  }

  return NextResponse.json(form)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await req.json()
  await query('DELETE FROM shipping_forms WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
