'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ShoppingBag, Clock, AlertTriangle, PackageOpen,
  RefreshCw, ChevronDown, ChevronRight, TrendingUp,
} from 'lucide-react'
import { formatEur, formatDate } from '@/lib/utils'

// ── types ──────────────────────────────────────────────────────────────────────

interface OrderSummaryRow { status: string; count: number }
interface SparkDay { day: string; count: number }
interface DeadlineOrder { id: string; deadline: string; round_number: number | null; status: string; shop_name: string | null; group_name: string | null }
interface UnpaidOrder { order_id: string; label: string; deadline: string; amount_eur: number }
interface UnpaidJoiner { joiner_id: string; joiner_name: string | null; joiner_username: string; total_owed: number; orders: UnpaidOrder[] }
interface LeftoverMember { id: string; name: string; leftover: number }
interface LeftoverSection { versionLabel?: string; members: LeftoverMember[]; type: 'album' | 'standard' }
interface LeftoverOrder { id: string; label: string; type: string; sections: LeftoverSection[] }

interface DashboardData {
  orders: { summary: OrderSummaryRow[]; sparkline: SparkDay[] }
  deadlines: DeadlineOrder[]
  unpaid: UnpaidJoiner[]
  leftovers: LeftoverOrder[]
}

// ── status helpers ─────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  to_be_ordered: 'To Order',
  ordered: 'Ordered',
  received: 'Received',
  processing: 'Processing',
  shipped: 'Shipped',
  closed: 'Closed',
}

const STATUS_COLORS: Record<string, string> = {
  to_be_ordered: 'bg-amber-100 text-amber-700 border-amber-200',
  ordered: 'bg-sky-100 text-sky-700 border-sky-200',
  received: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  processing: 'bg-violet-100 text-violet-700 border-violet-200',
  shipped: 'bg-blue-100 text-blue-700 border-blue-200',
  closed: 'bg-muted text-muted-foreground border-border',
}

// ── mini sparkline ─────────────────────────────────────────────────────────────

function Sparkline({ data }: { data: SparkDay[] }) {
  if (data.length < 2) return null
  const counts = data.map(d => d.count)
  const max = Math.max(...counts, 1)
  const min = Math.min(...counts)
  const H = 32, W = 80
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * W
    const y = H - ((d.count - min) / (max - min || 1)) * H
    return `${x},${y}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-20 h-8 opacity-60">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// ── widget shell ───────────────────────────────────────────────────────────────

function Widget({ title, icon: Icon, count, children, defaultOpen = true }: {
  title: string; icon: any; count?: number; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-border rounded-2xl overflow-hidden bg-card">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex items-center gap-2.5">
          <Icon size={15} className="text-primary flex-shrink-0"/>
          <span className="font-bold text-sm">{title}</span>
          {count != null && count > 0 && (
            <span className="text-xs font-bold bg-primary text-primary-foreground px-2 py-0.5 rounded-full">{count}</span>
          )}
        </div>
        {open ? <ChevronDown size={14} className="text-muted-foreground"/> : <ChevronRight size={14} className="text-muted-foreground"/>}
      </button>
      {open && <div className="border-t border-border">{children}</div>}
    </div>
  )
}

// ── page ───────────────────────────────────────────────────────────────────────

export default function GomDashboardPage() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedJoiners, setExpandedJoiners] = useState<Set<string>>(new Set())

  const fetchData = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/dashboard').then(r => r.json()).catch(() => null)
    setData(res)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const totalActive = data?.orders.summary.reduce((s, r) => s + Number(r.count), 0) ?? 0
  const totalLeftovers = data?.leftovers.reduce((s, o) =>
    s + o.sections.reduce((ss, sec) =>
      ss + sec.members.reduce((sss, m) => sss + m.leftover, 0), 0), 0) ?? 0

  const toggleJoiner = (id: string) =>
    setExpandedJoiners(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  if (loading) return (
    <div className="flex items-center justify-center h-full min-h-64">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-5 border-b border-border">
        <div>
          <h1 className="font-display font-bold text-xl">Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{totalActive} active orders</p>
        </div>
        <button onClick={fetchData} className="text-muted-foreground hover:text-foreground transition-colors p-2 rounded-xl hover:bg-secondary" title="Refresh">
          <RefreshCw size={14}/>
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-4">

        {/* ── Orders summary ─────────────────────────────────────────────────── */}
        <Widget title="Orders" icon={ShoppingBag}>
          <div className="px-5 py-4">
            {/* Sparkline + total */}
            <div className="flex items-end justify-between mb-4">
              <div>
                <p className="text-3xl font-display font-bold text-primary">{totalActive}</p>
                <p className="text-xs text-muted-foreground">active orders</p>
              </div>
              <div className="text-primary">
                <Sparkline data={data?.orders.sparkline ?? []}/>
                <p className="text-[10px] text-muted-foreground text-right mt-0.5">last 30 days</p>
              </div>
            </div>
            {/* Status pills */}
            <div className="flex flex-wrap gap-2">
              {data?.orders.summary.map(row => (
                <button
                  key={row.status}
                  onClick={() => router.push(`/gom/orders?status=${row.status}`)}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all hover:opacity-80 ${STATUS_COLORS[row.status] || 'bg-muted text-muted-foreground border-border'}`}
                >
                  {STATUS_LABELS[row.status] || row.status}
                  <span className="font-bold">{row.count}</span>
                </button>
              ))}
            </div>
          </div>
        </Widget>

        {/* ── Upcoming deadlines ─────────────────────────────────────────────── */}
        <Widget title="Deadlines This Week" icon={Clock} count={data?.deadlines.length}>
          {!data?.deadlines.length ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">No deadlines in the next 7 days 🎉</p>
          ) : (
            <div className="divide-y divide-border">
              {data.deadlines.map(d => {
                const daysLeft = Math.ceil((new Date(d.deadline).getTime() - Date.now()) / 86400000)
                const urgent = daysLeft <= 2
                return (
                  <button
                    key={d.id}
                    onClick={() => router.push(`/gom/orders?id=${d.id}`)}
                    className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors text-left"
                  >
                    <div>
                      <p className="text-sm font-semibold">
                        {[d.group_name, d.round_number ? `R${d.round_number}` : null, d.shop_name].filter(Boolean).join(' · ')}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{formatDate(d.deadline)}</p>
                    </div>
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border flex-shrink-0 ${urgent ? 'bg-red-100 text-red-700 border-red-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
                      {daysLeft === 0 ? 'Today' : daysLeft === 1 ? 'Tomorrow' : `${daysLeft}d`}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </Widget>

        {/* ── Overdue unpaid claims ──────────────────────────────────────────── */}
        <Widget title="Overdue Unpaid Claims" icon={AlertTriangle} count={data?.unpaid.length}>
          {!data?.unpaid.length ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">No overdue unpaid claims ✓</p>
          ) : (
            <div className="divide-y divide-border">
              {data.unpaid.map(joiner => {
                const expanded = expandedJoiners.has(joiner.joiner_id)
                return (
                  <div key={joiner.joiner_id}>
                    <button
                      onClick={() => toggleJoiner(joiner.joiner_id)}
                      className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-muted/30 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        {expanded ? <ChevronDown size={13} className="text-muted-foreground flex-shrink-0"/> : <ChevronRight size={13} className="text-muted-foreground flex-shrink-0"/>}
                        <div>
                          <p className="text-sm font-semibold">{joiner.joiner_name || joiner.joiner_username}</p>
                          <p className="text-xs text-muted-foreground">{joiner.orders.length} order{joiner.orders.length !== 1 ? 's' : ''}</p>
                        </div>
                      </div>
                      <span className="text-sm font-bold text-red-600 flex-shrink-0">{formatEur(joiner.total_owed)}</span>
                    </button>
                    {expanded && (
                      <div className="bg-muted/20 divide-y divide-border/50">
                        {joiner.orders.map((o, i) => {
                          const overdueDays = Math.floor((Date.now() - new Date(o.deadline).getTime()) / 86400000)
                          return (
                            <div key={i} className="flex items-center justify-between px-8 py-2.5">
                              <div>
                                <p className="text-xs font-semibold">{o.label}</p>
                                <p className="text-[11px] text-red-500 font-medium mt-0.5">{overdueDays}d overdue</p>
                              </div>
                              <span className="text-xs font-bold tabular-nums">{formatEur(o.amount_eur)}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Widget>

        {/* ── Leftovers ─────────────────────────────────────────────────────── */}
        <Widget title="Available Leftovers" icon={PackageOpen} count={totalLeftovers > 0 ? totalLeftovers : undefined}>
          {!data?.leftovers.length ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">No leftover slots across active orders 🎉</p>
          ) : (
            <div className="divide-y divide-border">
              {data.leftovers.map(order => (
                <div key={order.id} className="px-5 py-3.5">
                  <button
                    onClick={() => router.push(`/gom/orders?id=${order.id}`)}
                    className="text-sm font-bold hover:text-primary transition-colors text-left flex items-center gap-2 mb-2.5"
                  >
                    {order.label}
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${order.type === 'personal' ? 'bg-violet-50 text-violet-600 border-violet-200' : 'bg-sky-50 text-sky-600 border-sky-200'}`}>
                      {order.type}
                    </span>
                  </button>
                  <div className="space-y-2">
                    {order.sections.map((sec, si) => (
                      <div key={si}>
                        {sec.versionLabel && (
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">{sec.versionLabel}</p>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          {sec.members.map(m => (
                            <span key={m.id} className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${sec.type === 'album' ? 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-300 dark:border-sky-800' : 'bg-muted text-muted-foreground border-border'}`}>
                              {m.name}{m.leftover > 1 && <span className={`ml-1 font-bold ${sec.type === 'album' ? 'text-sky-500' : 'text-muted-foreground/60'}`}>×{m.leftover}</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Widget>

      </div>
    </div>
  )
}
