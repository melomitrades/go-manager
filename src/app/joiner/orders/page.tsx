'use client'
import { useEffect, useState } from 'react'
import { ShoppingBag } from 'lucide-react'
import { Card, Table, Th, Td, Tr, PageHeader, EmptyState, StatusBadge, Badge } from '@/components/ui'
import { formatDate } from '@/lib/utils'
import { OrderDetail } from '@/components/shared/OrderDetail'
import type { Order } from '@/types'

export default function JoinerOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/orders?viewAs=joiner').then(r => r.json()).then(d => {
      const STATUS_ORDER = ['to_be_ordered','ordered','at_k_addy','otw_to_gom','at_gom','at_c_addy','at_j_addy','otw_to_joiners','delivered','closed']
      const raw = Array.isArray(d) ? d : []
      const sorted = [...raw].sort((a: any,b: any) => (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)) || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
      setOrders(sorted)
      setLoading(false)
    })
  }, [])

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="My Orders" subtitle="Click an order to see your items and payment status" />
      <div className="flex-1 overflow-auto p-4 sm:p-6">
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
                        <Td className="font-semibold">{o.shop?.name || '—'}</Td>
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
