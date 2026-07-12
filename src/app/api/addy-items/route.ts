import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query } from '@/lib/db'

let migrationsDone = false
async function ensureColumns() {
  if (migrationsDone) return
  migrationsDone = true
  await query('ALTER TABLE addy_items ADD COLUMN IF NOT EXISTS picture_url TEXT').catch(() => {})
  await query('ALTER TABLE addy_items ADD COLUMN IF NOT EXISTS notes TEXT').catch(() => {})
}

// Status → country mapping (same as ADDY_MAP in orders API)
const STATUS_TO_COUNTRY: Record<string, string> = {
  at_k_addy: 'KR',
  at_c_addy: 'CN',
  at_j_addy: 'JP',
}
// Statuses that mean the order has LEFT the addy stage
const PAST_ADDY_STATUSES = ['otw_to_gom', 'at_gom', 'closed']

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const country = new URL(req.url).searchParams.get('country') // 'KR' | 'CN' | 'JP'
  await ensureColumns()

  if (!country) return NextResponse.json([])

  // Find which status corresponds to this country tab
  const matchingStatus = Object.entries(STATUS_TO_COUNTRY).find(([, c]) => c === country)?.[0]
  if (!matchingStatus) return NextResponse.json([])

  // Ensure addy_items rows exist for all orders currently at this addy status
  // These are auto-created; the user doesn't need to log them manually
  await query(`
    INSERT INTO addy_items (country, order_id, arrived_at)
    SELECT $1, o.id, now()
    FROM orders o
    WHERE o.status = $2
      AND NOT EXISTS (
        SELECT 1 FROM addy_items ai WHERE ai.order_id = o.id AND ai.country = $1
      )
    ON CONFLICT DO NOTHING
  `, [country, matchingStatus]).catch(() => {})

  // Fetch all addy_items for this country, excluding orders that have moved past addy
  const items = await query(`
    SELECT
      ai.id,
      ai.country,
      ai.order_id,
      ai.notes,
      ai.arrived_at,
      ai.picture_url,
      ai.created_at,
      json_build_object(
        'id', o.id,
        'status', o.status,
        'round_number', o.round_number,
        'preview_image_url', o.preview_image_url,
        'shop', json_build_object('name', sh.name),
        'group', json_build_object('name', g.name)
      ) as "order"
    FROM addy_items ai
    JOIN orders o ON o.id = ai.order_id
    LEFT JOIN shops sh ON sh.id = o.shop_id
    LEFT JOIN groups g ON g.id = o.group_id
    WHERE ai.country = $1
      AND o.status NOT IN ('otw_to_gom', 'at_gom', 'closed')
    ORDER BY ai.arrived_at DESC NULLS LAST, ai.created_at DESC
  `, [country])

  return NextResponse.json(items)
}

export const maxDuration = 60
export const dynamic = 'force-dynamic'

// Increase body size limit for this route (base64 images can be large)
export const fetchCache = 'force-no-store'

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureColumns()

  const body = await req.json()
  const { id } = body

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  // Only update fields explicitly provided in the body
  const updates: string[] = []
  const params: any[] = []
  let i = 1

  if ('notes' in body) {
    updates.push(`notes = $${i++}`)
    params.push(body.notes ?? null)
  }
  if ('picture_url' in body) {
    updates.push(`picture_url = $${i++}`)
    params.push(body.picture_url ?? null)
  }

  if (updates.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  params.push(id)
  const rows = await query(
    `UPDATE addy_items SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
    params
  )

  return NextResponse.json(Array.isArray(rows) ? rows[0] : rows)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json()
  await query('DELETE FROM addy_items WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
