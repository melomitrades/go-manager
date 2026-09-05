import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { ensureWeightVariantsSchema } from '@/lib/weightVariants'

export const dynamic = 'force-dynamic'

// PATCH — used from the Boxes page's "Confirm weights" panel to fill in / correct a variant's
// gram weight (and, rarely, rename it) once the physical item has actually been weighed. This is
// a GLOBAL edit: every box that uses this variant picks up the new weight immediately, past and
// future, which is the point — a comeback's "Ver A" weighs what it weighs everywhere it's sold.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await ensureWeightVariantsSchema()

  const { label, weight_g } = await req.json()
  const row = await queryOne(
    `UPDATE weight_variants SET
       label = COALESCE($1, label),
       weight_g = CASE WHEN $2::text IS NULL THEN weight_g ELSE NULLIF($2::text,'')::numeric END
     WHERE id=$3 RETURNING *`,
    [label ?? null, weight_g === undefined ? null : (weight_g === null ? '' : String(weight_g)), params.id]
  )
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(row)
}

// DELETE — only allowed when nothing references it, so a mis-clicked "create new" can be cleaned
// up without leaving dangling FKs to worry about.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await ensureWeightVariantsSchema()

  const inUse = await queryOne('SELECT id FROM order_items WHERE weight_variant_id=$1 LIMIT 1', [params.id])
  if (inUse) return NextResponse.json({ error: 'In use by existing order items' }, { status: 409 })
  await query('DELETE FROM weight_variants WHERE id=$1', [params.id])
  return NextResponse.json({ ok: true })
}
