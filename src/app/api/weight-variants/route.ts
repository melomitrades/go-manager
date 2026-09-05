import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { ensureWeightVariantsSchema } from '@/lib/weightVariants'

export const dynamic = 'force-dynamic'

// GET /api/weight-variants?item_type=photocard&group_id=<uuid>
// Powers the "which weight variant is this?" dropdown on a pricing option in Orders.
// - item_type is required (variants are always scoped to one of the 4 categories).
// - group_id present  -> that group's own variants PLUS global ones (group_id IS NULL).
// - group_id absent   -> global variants only (personal orders have no group to scope by).
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureWeightVariantsSchema()

  const { searchParams } = new URL(req.url)
  const item_type = searchParams.get('item_type')
  const group_id = searchParams.get('group_id')
  if (!item_type) return NextResponse.json({ error: 'item_type required' }, { status: 400 })

  const rows = group_id
    ? await query(
        `SELECT * FROM weight_variants WHERE item_type=$1 AND (group_id=$2 OR group_id IS NULL) ORDER BY group_id IS NULL, label`,
        [item_type, group_id]
      )
    : await query(
        `SELECT * FROM weight_variants WHERE item_type=$1 AND group_id IS NULL ORDER BY label`,
        [item_type]
      )
  return NextResponse.json(rows)
}

// POST — create a new named variant (weight_g optional: a GOM can name "Ver B" before it's been
// physically weighed, and fill the weight in later from the Boxes page). De-duplicates
// case-insensitively on (item_type, group_id, label) so re-typing an existing name from the
// "+ Create new" box just reuses the existing row instead of spawning a near-duplicate.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await ensureWeightVariantsSchema()

  const { item_type, group_id, label, weight_g } = await req.json()
  if (!item_type || !label || !String(label).trim()) {
    return NextResponse.json({ error: 'item_type and label required' }, { status: 400 })
  }

  const existing = group_id
    ? await queryOne('SELECT * FROM weight_variants WHERE item_type=$1 AND group_id=$2 AND LOWER(label)=LOWER($3)', [item_type, group_id, label])
    : await queryOne('SELECT * FROM weight_variants WHERE item_type=$1 AND group_id IS NULL AND LOWER(label)=LOWER($2)', [item_type, label])
  if (existing) return NextResponse.json(existing, { status: 200 })

  const row = await queryOne(
    `INSERT INTO weight_variants (item_type, group_id, label, weight_g) VALUES ($1,$2,$3,$4) RETURNING *`,
    [item_type, group_id || null, String(label).trim(), weight_g != null && weight_g !== '' ? parseFloat(weight_g) : null]
  )
  return NextResponse.json(row, { status: 201 })
}
