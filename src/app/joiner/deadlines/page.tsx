'use client'
import { useEffect, useState } from 'react'
import { Calendar, Clock } from 'lucide-react'
import { Card, CardContent, PageHeader, EmptyState, StatusBadge, Badge } from '@/components/ui'
import { formatDateTime } from '@/lib/utils'

interface DeadlineItem {
  id: string
  type: 'order' | 'ems' | 'customs' | 'pc_sorter' | 'shipping'
  label: string
  sublabel?: string
  deadline: string
  status?: string
  paid?: boolean
  extra?: string
}

function urgencyInfo(deadline: string) {
  const now = new Date()
  const d = new Date(deadline)
  const hoursLeft = (d.getTime() - now.getTime()) / 3_600_000
  if (hoursLeft < 0) return { label: 'Expired', color: 'text-destructive', border: 'border-destructive/40 bg-destructive/5' }
  if (hoursLeft < 24) return { label: `${Math.floor(hoursLeft)}h left`, color: 'text-amber-600 dark:text-amber-400 font-bold', border: 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/10' }
  if (hoursLeft < 72) return { label: `${Math.floor(hoursLeft / 24)}d left`, color: 'text-amber-500 dark:text-amber-400 font-semibold', border: 'border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-900/5' }
  return { label: `${Math.floor(hoursLeft / 24)}d left`, color: 'text-muted-foreground', border: 'border-border' }
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  order: { label: 'Order', color: 'bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-900/20 dark:text-sky-300' },
  ems: { label: 'EMS Payment', color: 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300' },
  customs: { label: 'Customs Payment', color: 'bg-violet-50 text-violet-700 border border-violet-200 dark:bg-violet-900/20 dark:text-violet-300' },
  pc_sorter: { label: 'PC Sorter', color: 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-900/20 dark:text-rose-300' },
  shipping: { label: 'Shipping Form', color: 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-300' },
}

export default function JoinerDeadlinesPage() {
  const [items, setItems] = useState<DeadlineItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const deadlines: DeadlineItem[] = []

      // Orders with deadlines
      const orders = await fetch('/api/orders?viewAs=joiner').then(r => r.json()).catch(() => [])
      for (const o of (Array.isArray(orders) ? orders : [])) {
        if (o.deadline) {
          // Skip expired deadlines
          if (new Date(o.deadline) < new Date()) continue
          deadlines.push({
            id: `order-${o.id}`, type: 'order',
            label: o.shop?.name || 'Order',
            sublabel: `${o.group?.name ? o.group.name + ' · ' : ''}${o.round_number ? `Round ${o.round_number}` : ''}`,
            deadline: o.deadline, status: o.status,
            paid: !!(o.items?.length && o.items.every((i: any) => i.paid)),
          })
        }
      }

      // Boxes with EMS/customs deadlines — use joiner's share from payments API
      const [boxes, paymentItems] = await Promise.all([
        fetch('/api/boxes').then(r => r.json()).catch(() => []),
        fetch('/api/joiner-payments').then(r => r.json()).catch(() => []),
      ])
      // Build a map of box_id → { ems_amount, customs_amount, ems_paid, customs_paid }
      const boxPaymentMap: Record<string, { ems?: number; customs?: number; ems_paid?: boolean; customs_paid?: boolean }> = {}
      for (const p of (Array.isArray(paymentItems) ? paymentItems : [])) {
        if (p.type === 'ems' && p.box_id) boxPaymentMap[p.box_id] = { ...boxPaymentMap[p.box_id], ems: p.amount_eur, ems_paid: p.paid }
        if (p.type === 'customs' && p.box_id) boxPaymentMap[p.box_id] = { ...boxPaymentMap[p.box_id], customs: p.amount_eur, customs_paid: p.paid }
      }
      for (const b of (Array.isArray(boxes) ? boxes : [])) {
        const bm = boxPaymentMap[b.id] || {}
        if (b.ems_deadline && new Date(b.ems_deadline) > new Date() && bm.ems != null) {
          deadlines.push({
            id: `ems-${b.id}`, type: 'ems',
            label: b.label || 'Box',
            sublabel: `EMS: ${bm.ems.toFixed(2)}€`,
            deadline: b.ems_deadline,
            paid: bm.ems_paid,
          })
        }
        if (b.customs_deadline && new Date(b.customs_deadline) > new Date() && bm.customs != null) {
          deadlines.push({
            id: `customs-${b.id}`, type: 'customs',
            label: b.label || 'Box',
            sublabel: `Customs: ${bm.customs.toFixed(2)}€`,
            deadline: b.customs_deadline,
            paid: bm.customs_paid,
          })
        }
      }

      // PC sorter sessions with deadlines
      const sessions = await fetch('/api/pc-sorter?viewAs=joiner').then(r => r.json()).catch(() => [])
      for (const s of (Array.isArray(sessions) ? sessions : [])) {
        if (s.deadline) {
          deadlines.push({
            id: `pc-${s.id}`, type: 'pc_sorter',
            label: s.title,
            sublabel: s.group?.name || '',
            deadline: s.deadline,
          })
        }
      }

      // Shipping form deadline — only show if form is open
      const [shippingDl, shippingOpen] = await Promise.all([
        fetch('/api/settings?key=sending_form_deadline').then(r => r.json()).catch(() => ({ value: '' })),
        fetch('/api/settings?key=sending_form_open').then(r => r.json()).catch(() => ({ value: 'true' })),
      ])
      const formIsOpen = shippingOpen.value !== 'false'
      const deadlinePassed = shippingDl.value && new Date(shippingDl.value) < new Date()
      if (shippingDl.value && formIsOpen && !deadlinePassed) {
        deadlines.push({
          id: 'shipping-form', type: 'shipping',
          label: 'Shipping Form',
          sublabel: 'Submit your shipping info before this date',
          deadline: shippingDl.value,
        })
      }

      // Sort: soonest first
      deadlines.sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())

      setItems(deadlines)
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Deadlines" subtitle="All upcoming deadlines sorted by urgency" />
      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-3">
        {loading
          ? <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
          : items.length === 0
            ? <EmptyState icon={Calendar} title="No upcoming deadlines" description="Deadlines for orders, payments, PC sorter, and shipping will appear here." />
            : items.map(item => {
                const urg = urgencyInfo(item.deadline)
                const typeInfo = TYPE_LABELS[item.type]
                return (
                  <Card key={item.id} className={`border-2 ${urg.border} ${item.paid ? 'opacity-50' : ''}`}>
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <Badge className={`${typeInfo.color} text-xs`}>{typeInfo.label}</Badge>
                            {item.status && <StatusBadge status={item.status as any} />}
                          </div>
                          <p className="font-semibold">{item.label}</p>
                          {item.sublabel && <p className="text-xs text-muted-foreground mt-0.5">{item.sublabel}</p>}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className={`text-sm font-bold ${urg.color}`}>{urg.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 justify-end">
                            <Clock size={11} />
                            {formatDateTime(item.deadline)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })
        }
      </div>
    </div>
  )
}
