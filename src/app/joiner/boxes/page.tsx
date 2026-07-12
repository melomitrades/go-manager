'use client'
import { useEffect, useState, useCallback } from 'react'
import { Box, ChevronDown, ChevronUp, Check, X } from 'lucide-react'
import { Card, CardContent, CardHeader, PageHeader, EmptyState, Badge } from '@/components/ui'
import { formatEur, formatKrw } from '@/lib/utils'

export default function JoinerBoxesPage() {
  const [boxes, setBoxes] = useState<any[]>([])
  const [details, setDetails] = useState<Record<string, any>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/boxes').then(r => r.json()).then(b => {
      setBoxes(Array.isArray(b) ? b : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  async function toggle(boxId: string) {
    if (expanded === boxId) { setExpanded(null); return }
    setExpanded(boxId)
    if (!details[boxId]) {
      const d = await fetch(`/api/boxes/${boxId}`).then(r => r.json())
      setDetails(prev => ({ ...prev, [boxId]: d }))
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Boxes" subtitle="Your EMS & customs shares" />
      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-4">
        {loading
          ? <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>
          : boxes.length === 0
            ? <EmptyState icon={Box} title="No boxes yet" description="Your GOM will create boxes when your orders are ready to ship." />
            : boxes.map(box => {
                const det = details[box.id]
                const mine = det?.joiners?.[0]
                const isOpen = expanded === box.id

                return (
                  <Card key={box.id}>
                    <button className="w-full text-left" onClick={() => toggle(box.id)}>
                      <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-display font-semibold">{box.label || 'Box'}</p>
                            {(box.linked_orders || []).length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-1.5">
                                {(box.linked_orders || []).map((o: any) => (
                                  <Badge key={o.order_id || o.id} className="bg-secondary text-secondary-foreground border border-border text-xs">
                                    {o.shop?.name || '?'}{o.round_number ? ` #${o.round_number}` : ''}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                          {isOpen ? <ChevronUp size={16} className="text-muted-foreground mt-1 flex-shrink-0"/> : <ChevronDown size={16} className="text-muted-foreground mt-1 flex-shrink-0"/>}
                        </div>
                      </CardHeader>
                    </button>

                    {isOpen && (
                      <CardContent>
                        {!mine
                          ? <p className="text-sm text-muted-foreground py-4 text-center">You have no items in this box.</p>
                          : <div className="space-y-4">
                              {/* Share totals */}
                              <div className="grid grid-cols-3 gap-3">
                                <div className="bg-secondary/40 rounded-xl p-3">
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">EMS</p>
                                  <p className="text-lg font-bold">{formatEur(mine.ems_share_eur)}</p>
                                  {formatKrw(mine.ems_share_krw) && <p className="text-xs text-muted-foreground">{formatKrw(mine.ems_share_krw)}</p>}
                                  {box.ems_deadline && <p className="text-xs text-amber-600 mt-1 font-semibold">Due {new Date(box.ems_deadline).toLocaleDateString()}</p>}
                                  <div className={`mt-2 inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${mine.ems_paid ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-secondary border-border text-muted-foreground'}`}>
                                    {mine.ems_paid ? <Check size={10}/> : <X size={10}/>} {mine.ems_paid ? 'Paid' : 'Unpaid'}
                                  </div>
                                </div>
                                <div className="bg-secondary/40 rounded-xl p-3">
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Customs</p>
                                  <p className="text-lg font-bold">{formatEur(mine.customs_share_eur)}</p>
                                  {formatKrw(mine.customs_share_krw) && <p className="text-xs text-muted-foreground">{formatKrw(mine.customs_share_krw)}</p>}
                                  {box.customs_deadline && <p className="text-xs text-amber-600 mt-1 font-semibold">Due {new Date(box.customs_deadline).toLocaleDateString()}</p>}
                                  <div className={`mt-2 inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${mine.customs_paid ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-secondary border-border text-muted-foreground'}`}>
                                    {mine.customs_paid ? <Check size={10}/> : <X size={10}/>} {mine.customs_paid ? 'Paid' : 'Unpaid'}
                                  </div>
                                </div>
                                <div className="bg-primary/5 border border-primary/10 rounded-xl p-3">
                                  <p className="text-xs font-semibold text-primary/70 uppercase tracking-wide mb-1">Total</p>
                                  <p className="text-lg font-bold text-primary">{formatEur(mine.total_share_eur)}</p>
                                  {formatKrw(mine.total_share_krw) && <p className="text-xs text-muted-foreground">{formatKrw(mine.total_share_krw)}</p>}
                                </div>
                              </div>

                              {/* My items */}
                              {mine.items?.length > 0 && (
                                <div>
                                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">My Items in this Box</p>
                                  <div className="border border-border rounded-xl overflow-hidden divide-y divide-border/50">
                                    {mine.items.map((it: any, idx: number) => (
                                      <div key={idx} className="flex items-center gap-3 px-4 py-3 text-sm">
                                        <div className="flex-1 min-w-0">
                                          <p className="font-medium">{it.description || it.item_type}</p>
                                          <p className="text-xs text-muted-foreground">
                                            {it.shop_name}{it.round_number ? ` #${it.round_number}` : ''}{it.member_name ? ` · ${it.member_name}` : ''}
                                          </p>
                                        </div>
                                        {it.amount_claimed > 1 && <span className="text-xs text-muted-foreground">×{it.amount_claimed}</span>}
                                        {it.price_eur && <span className="font-mono text-sm font-semibold">{formatEur(it.price_eur * it.amount_claimed)}</span>}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                        }
                      </CardContent>
                    )}
                  </Card>
                )
              })
        }
      </div>
    </div>
  )
}
