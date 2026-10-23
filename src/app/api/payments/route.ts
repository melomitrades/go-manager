let payMigDone = false
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { query } from '@/lib/db'

async function ensurePaymentColumns() {
  if (!payMigDone) { payMigDone = true; await Promise.all([query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS proof_url TEXT').catch(()=>{}), query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS joiner_submitted BOOLEAN DEFAULT false').catch(()=>{})]) }
}

export const dynamic = 'force-dynamic'

export async function GET() {
  await ensurePaymentColumns()
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const payments = await query(`
    SELECT p.*, row_to_json(s) as shop,
      (SELECT row_to_json(cl) FROM covering_log cl WHERE cl.payment_id = p.id LIMIT 1) as covering_log,
      os.name AS order_shop_name, og.name AS order_group_name, o.round_number AS order_round
    FROM payments p LEFT JOIN shops s ON s.id = p.shop_id
    LEFT JOIN orders o ON o.id = p.order_id
    LEFT JOIN shops os ON os.id = o.shop_id
    LEFT JOIN groups og ON og.id = o.group_id
    ORDER BY COALESCE(p.deadline, p.created_at) DESC
  `)
  return NextResponse.json(payments)
}

// The `payments` table is the ARCHIVE of the old GOM payments log — read-only now.
// New GOM payments are per-order lines in /api/gom-payments.
const archived = () => NextResponse.json({ error: 'GOM payments are archived — log new ones per order on the Payments page' }, { status: 410 })
export async function POST() { return archived() }
export async function PATCH() { return archived() }
export async function DELETE() { return archived() }
