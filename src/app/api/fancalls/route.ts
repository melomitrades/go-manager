let fancallMigDone = false
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!fancallMigDone) { fancallMigDone = true; await Promise.all([query('ALTER TABLE fancalls ADD COLUMN IF NOT EXISTS raffle_winner_id UUID REFERENCES profiles(id) ON DELETE SET NULL').catch(()=>{}), query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS entries_count INTEGER DEFAULT 0').catch(()=>{})]) }
  const fancalls = await query(`
    SELECT f.*,
      row_to_json(s) as shop,
      row_to_json(p) as enterer,
      row_to_json(w) as raffle_winner
    FROM fancalls f
    LEFT JOIN shops s ON s.id = f.shop_id
    LEFT JOIN profiles p ON p.id = f.entered_by
    LEFT JOIN profiles w ON w.id = f.raffle_winner_id
    ORDER BY f.created_at DESC
  `)
  return NextResponse.json(fancalls)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { order_id, shop_id, entered_by, fancall_datetime, won, received, benefits_to_kaddy } = await req.json()
  const fc = await queryOne(
    `INSERT INTO fancalls (order_id, shop_id, entered_by, fancall_datetime, won, received, benefits_to_kaddy)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [order_id||null, shop_id||null, entered_by||null, fancall_datetime||null, won, received, benefits_to_kaddy||null]
  )
  return NextResponse.json(fc, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, shop_id, entered_by, fancall_datetime, won, received, benefits_to_kaddy, raffle_winner_id } = await req.json()

  // Never overwrite order_id (set by Orders page) or raffle_winner unless explicitly provided
  const fc = await queryOne(
    `UPDATE fancalls SET
       shop_id = COALESCE($1, shop_id),
       entered_by = COALESCE($2, entered_by),
       fancall_datetime = COALESCE($3, fancall_datetime),
       won = $4,
       received = $5,
       benefits_to_kaddy = COALESCE($6, benefits_to_kaddy),
       raffle_winner_id = COALESCE($7, raffle_winner_id),
       updated_at = now()
     WHERE id = $8 RETURNING *`,
    [shop_id||null, entered_by||null, fancall_datetime||null, won ?? false, received ?? false, benefits_to_kaddy||null, raffle_winner_id||null, id]
  )
  return NextResponse.json(fc)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json()
  await query('DELETE FROM fancalls WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
