import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { queryOne } from '@/lib/db'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { payment_id, amount_to_send_eur, amount_claimed_eur } = await req.json()
  const cl = await queryOne(
    `INSERT INTO covering_log (payment_id, amount_to_send_eur, amount_claimed_eur)
     VALUES ($1,$2,$3)
     ON CONFLICT (payment_id) DO UPDATE SET amount_to_send_eur=$2, amount_claimed_eur=$3
     RETURNING *`,
    [payment_id, amount_to_send_eur, amount_claimed_eur]
  )
  return NextResponse.json(cl)
}
