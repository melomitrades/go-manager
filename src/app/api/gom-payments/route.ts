import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { ensureGomPaymentsSchema, getCoverage, cleanLine } from '@/lib/gomPayments'

export const dynamic = 'force-dynamic'

// paid_at as 'YYYY-MM-DD' text — a DATE parsed by pg becomes a local-midnight Date, which can
// shift a day once serialised to UTC.
const RET = `id, order_id, amount_eur, amount_krw, krw_rate, paid_to, note, to_char(paid_at, 'YYYY-MM-DD') AS paid_at, created_by, created_at`

async function gom() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

// GET — coverage per order (received from joiners vs paid by the GOM)
export async function GET() {
  const { error } = await gom(); if (error) return error
  const rows = await getCoverage()
  return NextResponse.json(rows)
}

// POST { lines: [{ order_id, amount_eur, amount_krw?, krw_rate?, paid_to?, note?, paid_at? }] }
// (a single line object is accepted too). Lines with no amount are ignored.
export async function POST(req: NextRequest) {
  const { user, error } = await gom(); if (error) return error
  await ensureGomPaymentsSchema()
  const body = await req.json()
  const lines: any[] = Array.isArray(body?.lines) ? body.lines : [body]
  const out: any[] = []
  // Orders on the old system never get payment lines.
  const legacy = new Set((await query<any>(
    `SELECT id::text AS id FROM orders WHERE gom_payments_legacy AND id::text = ANY($1::text[])`,
    [lines.map(l => String(l?.order_id || ''))]
  )).map(r => r.id))
  for (const raw of lines) {
    if (!raw?.order_id || legacy.has(String(raw.order_id))) continue
    const l = cleanLine(raw)
    if (l.amount_eur == null || l.amount_eur < 0) continue
    const row = await queryOne(
      `INSERT INTO gom_order_payments (order_id, amount_eur, amount_krw, krw_rate, paid_to, note, paid_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE),$8) RETURNING ${RET}`,
      [String(raw.order_id), l.amount_eur, l.amount_krw, l.krw_rate, l.paid_to, l.note, l.paid_at, user.id]
    )
    out.push(row)
  }
  return NextResponse.json(out, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const { error } = await gom(); if (error) return error
  await ensureGomPaymentsSchema()
  const raw = await req.json()
  if (!raw?.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const l = cleanLine(raw)
  if (l.amount_eur == null || l.amount_eur < 0) return NextResponse.json({ error: 'Enter an amount' }, { status: 400 })
  const row = await queryOne(
    `UPDATE gom_order_payments SET amount_eur=$2, amount_krw=$3, krw_rate=$4, paid_to=$5, note=$6, paid_at=COALESCE($7::date, paid_at)
     WHERE id=$1 RETURNING ${RET}`,
    [raw.id, l.amount_eur, l.amount_krw, l.krw_rate, l.paid_to, l.note, l.paid_at]
  )
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(row)
}

export async function DELETE(req: NextRequest) {
  const { error } = await gom(); if (error) return error
  await ensureGomPaymentsSchema()
  const { id } = await req.json()
  await query('DELETE FROM gom_order_payments WHERE id=$1', [id])
  return NextResponse.json({ ok: true })
}
