import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runPcSort } from '@/lib/pcSorter'

export async function POST(req: NextRequest, { params }: { params: { sessionId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['gom', 'admin'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { method } = await req.json()
  if (method !== 'timestamp' && method !== 'fair') {
    return NextResponse.json({ error: 'method must be "timestamp" or "fair"' }, { status: 400 })
  }

  try {
    const result = await runPcSort(params.sessionId, method)
    return NextResponse.json(result)
  } catch (err: any) {
    // Deliberately surfaced instead of swallowed — see the redesign notes on why the old
    // run_sort silently ate its own failures.
    console.error('[pc-sorter run_sort failed]', err)
    return NextResponse.json({ error: err?.message || 'Sort failed' }, { status: 500 })
  }
}
