'use client'
import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui'
import { formatEur } from '@/lib/utils'
import { Users, ShoppingBag, CreditCard, Package, TrendingUp } from 'lucide-react'

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => { fetch('/api/stats').then(r=>r.json()).then(d=>{setStats(d);setLoading(false)}) }, [])

  const cards = stats ? [
    { label:'Total Joiners', value:stats.joiners, icon:Users, color:'text-sky-500', bg:'bg-sky-50 dark:bg-sky-900/20', border:'border-sky-100 dark:border-sky-800' },
    { label:'Total Orders', value:stats.orders, icon:ShoppingBag, color:'text-emerald-500', bg:'bg-emerald-50 dark:bg-emerald-900/20', border:'border-emerald-100 dark:border-emerald-800' },
    { label:'Total Payments', value:formatEur(parseFloat(stats.total_payments_eur)), icon:CreditCard, color:'text-primary', bg:'bg-primary/5', border:'border-primary/10' },
    { label:'Total Boxes', value:stats.boxes, icon:Package, color:'text-amber-500', bg:'bg-amber-50 dark:bg-amber-900/20', border:'border-amber-100 dark:border-amber-800' },
  ] : []

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Dashboard" subtitle="Overview of all activity" />
      <div className="p-7">
        {loading
          ? <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>
          : <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {cards.map(card => (
                <div key={card.label} className={`${card.bg} border ${card.border} rounded-2xl p-5 card-hover`}>
                  <div className="flex items-start justify-between mb-4">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${card.bg}`}>
                      <card.icon size={18} className={card.color} />
                    </div>
                    <TrendingUp size={12} className="text-muted-foreground/30 mt-1" />
                  </div>
                  <p className="font-display text-2xl font-semibold mb-1">{card.value}</p>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{card.label}</p>
                </div>
              ))}
            </div>
            <div className="bg-gradient-to-br from-primary/5 to-transparent border border-primary/10 rounded-2xl p-6 text-center">
              <p className="font-display text-lg font-semibold mb-1">Welcome to Giantz GO ✦</p>
              <p className="text-sm text-muted-foreground">Manage your group orders, track payments and keep your joiners happy.</p>
            </div>
          </>
        }
      </div>
    </div>
  )
}
