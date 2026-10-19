'use client'
import { useEffect, useState } from 'react'
import { ShoppingBag, AlertTriangle } from 'lucide-react'
import { Card, Table, Th, Td, Tr, PageHeader, EmptyState, StatusBadge, Badge } from '@/components/ui'
import { formatDate, formatEur } from '@/lib/utils'
import { LostBadge } from '@/components/shared/MarkLostModal'
import { OrderDetail } from '@/components/shared/OrderDetail'
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
                          {changedOrderIds.has(o.id) && (
                            <Badge className="ml-2 bg-amber-50 text-amber-700 border border-amber-200 align-middle"><AlertTriangle size={10} className="inline mr-1" />Claim changed</Badge>
                          )}
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
