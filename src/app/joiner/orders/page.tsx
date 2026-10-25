'use client'
import { useEffect, useState } from 'react'
import { ShoppingBag, AlertTriangle, RotateCcw } from 'lucide-react'
import { Card, Table, Th, Td, Tr, PageHeader, EmptyState, StatusBadge, Badge, Button } from '@/components/ui'
import { formatDate, formatEur } from '@/lib/utils'
import { LostBadge } from '@/components/shared/MarkLostModal'
import { OrderDetail } from '@/components/shared/OrderDetail'
import { PackSummary } from '@/components/shared/PackMark'
import { JoinerWinnerList } from '@/components/shared/WinnerItems'
import type { Order } from '@/types'

export default function JoinerOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [changedOrderIds, setChangedOrderIds] = useState<Set<string>>(new Set())
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [lost, setLost] = useState<{ claims: any[]; pcs: any[] }>({ claims: [], pcs: [] })

  useEffect(() => {
    fetch('/api/orders?viewAs=joiner').then(r => r.json()).then(d => {
      const STATUS_ORDER = ['to_be_ordered','ordered','at_k_addy','otw_to_gom','at_gom','at_c_addy','at_j_addy','otw_to_joiners','delivered','closed']
      const raw = Array.isArray(d) ? d : []
      const sorted = [...raw].sort((a: any,b: any) => (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)) || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
      setOrders(sorted)
      setLoading(false)
    })
  }, [])

  // Claims (and sorted cards) the GOM marked as lost because a payment wasn't made.
  useEffect(() => {
    fetch('/api/lost-claims').then(r => r.json()).then(d => {
      if (d && Array.isArray(d.claims)) setLost({ claims: d.claims, pcs: d.pcs || [] })
    }).catch(() => {})
  }, [])
  const lostOrderIds = new Set(lost.claims.map((c: any) => c.order_id))

  // Winner items (polaroids, signed PCs…) the GOM sold or gave to this joiner.
  const [winners, setWinners] = useState<any[]>([])
  useEffect(() => {
    fetch('/api/winner-items?mine=1').then(r => r.json()).then(d => setWinners(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])
  const winnerOrderIds = new Set(winners.map((w: any) => w.order_id).filter(Boolean))

  // Semi-fixed spots in active eras (progress + renewal)
  const [spots, setSpots] = useState<any[]>([])
  const [renewing, setRenewing] = useState<string | null>(null)
  const loadSpots = () => fetch('/api/semi-fixed?viewAs=joiner').then(r => r.json()).then(d => setSpots(Array.isArray(d) ? d : [])).catch(() => {})
  useEffect(() => { loadSpots() }, [])
  async function renewSpot(id: string) {
    setRenewing(id)
    const res = await fetch('/api/semi-fixed', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action: 'renew' }) })
    if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Could not renew') }
    await loadSpots()
    setRenewing(null)
  }

  // Orders where the GOM changed one of this joiner's claims while packing (see /api/claim-overrides).
  useEffect(() => {
    fetch('/api/claim-overrides').then(r => r.json()).then(d => {
      setChangedOrderIds(new Set((Array.isArray(d) ? d : []).map((o: any) => o.order_id)))
    }).catch(() => {})
  }, [])

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="My Orders" subtitle="Click an order to see your items and payment status" />
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {spots.length > 0 && (
          <div className="mb-5 border border-border rounded-2xl overflow-hidden bg-card">
            <div className="px-4 py-3 border-b border-border bg-secondary/30">
              <p className="text-sm font-bold">🔁 My semi-fixed spots</p>
              <p className="text-xs text-muted-foreground mt-0.5">Each order you join in the era counts as one event. When a round is complete, renew to keep your spot — extra events carry over to the next round.</p>
            </div>
            <div className="divide-y divide-border/60">
              {spots.map((s: any) => {
                const waiting = s.state === 'awaiting_renewal'
                const pct = s.target > 0 ? Math.min(100, Math.round(s.progress / s.target * 100)) : 0
                return (
                  <div key={s.id} className={`px-4 py-3 space-y-2 ${waiting ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{s.group_name || 'Group'}</span>
                      <span className="text-xs text-muted-foreground">· {s.era_name} · round {s.round}</span>
                      {s.state === 'lost' && <Badge className="bg-red-50 text-red-700 border border-red-200">Spot lost</Badge>}
                      {waiting && <Badge className="bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700">Renew by {s.renewal_deadline ? formatDate(s.renewal_deadline) : '—'}</Badge>}
                      {waiting && (
                        <Button size="sm" className="ml-auto" disabled={renewing === s.id} onClick={() => renewSpot(s.id)}>
                          <RotateCcw size={12} /> {renewing === s.id ? 'Renewing…' : 'Renew spot'}
                        </Button>
                      )}
                    </div>
                    {s.state !== 'lost' && (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                          <div className={`h-full rounded-full ${waiting ? 'bg-amber-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-semibold tabular-nums text-muted-foreground">{s.progress} / {s.target} events</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {winners.length > 0 && (
          <div className="mb-5 border border-amber-200 dark:border-amber-900 rounded-2xl overflow-hidden bg-card">
            <div className="px-4 py-3 border-b border-amber-100 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-900/10">
              <p className="text-sm font-bold">🏆 My winner items</p>
              <p className="text-xs text-muted-foreground mt-0.5">Event items (polaroids, signed PCs…) you bought or were given. They&apos;re packed with your shipment for that order&apos;s box.</p>
            </div>
            <JoinerWinnerList items={winners} onOpenOrder={id => setSelectedOrderId(id)} />
          </div>
        )}
        {(lost.claims.length > 0 || lost.pcs.length > 0) && (
          <div className="mb-5 border border-red-200 dark:border-red-900 rounded-2xl overflow-hidden bg-card">
            <div className="px-4 py-3 border-b border-red-100 dark:border-red-900 bg-red-50/60 dark:bg-red-900/10">
              <p className="text-sm font-bold text-red-700 dark:text-red-300 flex items-center gap-1.5"><AlertTriangle size={14} /> Claims lost — payment not received</p>
              <p className="text-xs text-muted-foreground mt-0.5">These were released because a payment wasn&apos;t made by the deadline. They&apos;re no longer yours and aren&apos;t counted in what you owe. Contact your GOM if you think this is a mistake.</p>
            </div>
            <div className="divide-y divide-border/40">
              {lost.claims.map((c: any) => (
                <div key={c.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="flex-1 min-w-[200px]">
                    <p className="text-sm font-medium">{c.description || 'Item'}{c.member_name && <span className="text-muted-foreground font-normal"> · {c.member_name}</span>}{c.version_name && <span className="text-muted-foreground font-normal"> · {c.version_name}</span>}</p>
                    <p className="text-xs text-muted-foreground">{c.order_label} · unpaid: {c.trigger_label}{c.trigger_amount_eur != null ? ` (${formatEur(parseFloat(c.trigger_amount_eur))})` : ''} · {formatDate(c.lost_at)}{c.reason && <span className="italic"> · “{c.reason}”</span>}</p>
                  </div>
                  <LostBadge triggerType={c.trigger_type} triggerLabel={c.trigger_label} />
                </div>
              ))}
              {lost.pcs.map((p: any) => (
                <div key={p.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="flex-1 min-w-[200px]">
                    <p className="text-sm font-medium">🎴 {p.item_name} · {p.member_name}</p>
                    <p className="text-xs text-muted-foreground">{p.session_title} · {p.pack_name} · unpaid: {p.trigger_label} · {formatDate(p.lost_at)}</p>
                  </div>
                  <LostBadge triggerType={p.trigger_type} triggerLabel={p.trigger_label} />
                </div>
              ))}
            </div>
          </div>
        )}
        {loading
          ? <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
          : orders.length === 0
            ? <EmptyState icon={ShoppingBag} title="No orders yet" description="Your GOM hasn't added you to any orders yet." />
            : <Card>
                <Table>
                  <thead>
                    <tr>
                      <Th>Shop</Th>
                      <Th>Group</Th>
                      <Th>Round</Th>
                      <Th>Status</Th>
                      <Th>Date</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(o => (
                      <Tr
                        key={o.id}
                        onClick={() => setSelectedOrderId(o.id)}
                        className="cursor-pointer hover:bg-primary/[0.04]"
                      >
                        <Td className="font-semibold">
                          {o.shop?.name || '—'}
                          {lostOrderIds.has(o.id) && (
                            <Badge className="ml-2 bg-red-50 text-red-700 border border-red-200 align-middle">Lost claims</Badge>
                          )}
                          {winnerOrderIds.has(o.id) && (
                            <Badge className="ml-2 bg-amber-50 text-amber-700 border border-amber-200 align-middle">🏆 Winner item</Badge>
                          )}
                          {changedOrderIds.has(o.id) && (
                            <Badge className="ml-2 bg-amber-50 text-amber-700 border border-amber-200 align-middle"><AlertTriangle size={10} className="inline mr-1" />Claim changed</Badge>
                          )}
                          {(o as any).pack_summary && <span className="block mt-1 font-normal"><PackSummary summary={(o as any).pack_summary} /></span>}
                        </Td>
                        <Td className="text-muted-foreground">{(o.group as any)?.name || '—'}</Td>
                        <Td className="text-muted-foreground">{o.round_number ? o.round_number : '—'}</Td>
                        <Td><StatusBadge status={o.status} /></Td>
                        <Td className="text-xs text-muted-foreground">{formatDate(o.created_at)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
        }
      </div>

      <OrderDetail
        orderId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
        viewAs="joiner"
      />
    </div>
  )
}
