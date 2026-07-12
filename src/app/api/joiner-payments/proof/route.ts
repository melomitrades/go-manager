import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') || 'order'
  const joiner_id = searchParams.get('joiner_id')
  const order_id = searchParams.get('order_id')
  const box_id = searchParams.get('box_id')

  if (type === 'order' && order_id && joiner_id) {
    const row = await queryOne('SELECT proof_url FROM order_joiner_paid WHERE order_id=$1 AND joiner_id=$2', [order_id, joiner_id])
    return NextResponse.json({ proof_url: (row as any)?.proof_url || null })
  }
  if (type === 'ems' && box_id && joiner_id) {
    const row = await queryOne('SELECT proof_url FROM box_joiner_shares WHERE box_id=$1 AND joiner_id=$2', [box_id, joiner_id])
    return NextResponse.json({ proof_url: (row as any)?.proof_url || null })
  }
  if (type === 'customs' && box_id && joiner_id) {
    const row = await queryOne('SELECT customs_proof_url FROM box_joiner_shares WHERE box_id=$1 AND joiner_id=$2', [box_id, joiner_id])
    return NextResponse.json({ proof_url: (row as any)?.customs_proof_url || null })
  }
  return NextResponse.json({ proof_url: null })
}
