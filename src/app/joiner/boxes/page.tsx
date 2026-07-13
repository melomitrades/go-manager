'use client'
import { useEffect, useState } from 'react'
import { Box, ChevronDown, ChevronUp, Check, X } from 'lucide-react'
import { Card, CardContent, CardHeader, PageHeader, EmptyState } from '@/components/ui'
import { formatEur } from '@/lib/utils'

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
      const d = await fetch(`/api/boxes/${boxId}?viewAs=joiner`).then(r => r.json())
      setDetails(prev => ({ ...prev, [boxId]: d }))
    }
  }

  function StatusBadge({ paid }: { paid: boolean }) {
    return (
      <div className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${paid ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-secondary border-border text-muted-foreground'}`}>
        {paid ? <Check size={10}/> : <X size={10}/>} {paid ? 'Paid' : 'Unpaid'}
      </div>
    )
  }

  function ItemBreakdown({ items, emsAmt, joinerWeight, label, det }: { items: any[]; emsAmt: number; joinerWeight: number; label: string; det: any }) {
    if (!items?.length || emsAmt <= 0) return null
    const isEms = label === 'EMS'
    const colour = isEms ? 'text-blue-600' : 'text-purple-600'
    const bgColour = isEms ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-purple-50 border-purple-200 text-purple-800'

    // Group items
    const groups: Record<string, { shop: string; desc: string; members: string[]; qty: number; inclusions: number; weight_g: number }> = {}
    for (const it of items) {
      const key = `${it.shop_name || '?'}__${it.round_number || ''}__${it.description || it.item_type}`
      if (!groups[key]) groups[key] = {
        shop: (it.shop_name || '?') + (it.round_number ? ` #${it.round_number}` : ''),
        desc: it.description || it.item_type, members: [], qty: 0, inclusions: 0, weight_g: 0
      }
      if (it.member_name && !groups[key].members.includes(it.member_name)) groups[key].members.push(it.member_name)
      groups[key].qty += it.amount_claimed || 1
      groups[key].inclusions += it.inclusions_count || 0
      groups[key].weight_g += it.weight_g || 0
    }

    // Use weight-based rate if weights available, otherwise distribute by PC count
    const totalGroupWeight = Object.values(groups).reduce((s, g) => s + g.weight_g, 0)
    const totalGroupPcs = Object.values(groups).reduce((s, g) => s + g.qty + g.inclusions, 0)
    const useWeight = totalGroupWeight > 0
    const joinerItemRate = useWeight ? (joinerWeight > 0 ? emsAmt / joinerWeight : 0) : 0
    const ratePerPc = !useWeight && totalGroupPcs > 0 ? emsAmt / totalGroupPcs : 0

    return (
      <div className="border border-border rounded-xl overflow-hidden divide-y divide-border/50">
        <p className={`px-4 py-2 text-xs font-bold uppercase tracking-widest border-b ${bgColour}`}>{label} breakdown</p>
        {Object.entries(groups).map(([key, g]) => {
          const totalPcs = g.qty + g.inclusions
          const groupShare = useWeight
            ? joinerItemRate * (g.weight_g || 0)
            : ratePerPc * totalPcs
          const effectivePc = totalPcs > 0 ? groupShare / totalPcs : 0
          const pcLabel = g.inclusions > 0
            ? `${g.qty} + ${g.inclusions} incl. = ${totalPcs} PCs`
            : `${g.qty} PC${g.qty !== 1 ? 's' : ''}`
          return (
            <div key={key} className="flex items-center gap-3 px-4 py-3 text-sm">
              <div className="flex-1 min-w-0">
                <p className="font-medium">{g.desc}</p>
                <p className="text-xs text-muted-foreground">{g.shop}{g.members.length > 0 ? ` · ${g.members.join(', ')}` : ''}</p>
                {effectivePc > 0 && (
                  <p className={`text-xs font-semibold mt-0.5 ${colour}`}>{pcLabel} × {formatEur(effectivePc)}</p>
                )}
              </div>
              {groupShare > 0 && <span className={`font-mono text-sm font-bold flex-shrink-0 ${colour}`}>{formatEur(groupShare)}</span>}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Boxes" subtitle="Your EMS & customs shares"/>
      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-4">
        {loading
          ? <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>
          : boxes.length === 0
            ? <EmptyState icon={Box} title="No boxes yet" description="Your GOM will create boxes when your orders are ready to ship."/>
            : boxes.map(box => {
                const det = details[box.id]
                const mine = det?.joiners?.[0]
                const isOpen = expanded === box.id
                const emsRequested = det?.ems_payment_requested
                const customsRequested = det?.customs_payment_requested
                const emsAmt = mine?.ems_amount_eur ?? mine?.ems_share_eur ?? 0
                const customsAmt = mine?.customs_amount_eur ?? mine?.customs_share_eur ?? 0
                const joinerWeight = mine?.weight_g || 0

                return (
                  <Card key={box.id}>
                    <button className="w-full text-left" onClick={() => toggle(box.id)}>
                      <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-display font-semibold">{box.label || 'Box'}</p>
                          {isOpen ? <ChevronUp size={16} className="text-muted-foreground mt-1 flex-shrink-0"/> : <ChevronDown size={16} className="text-muted-foreground mt-1 flex-shrink-0"/>}
                        </div>
                      </CardHeader>
                    </button>

                    {isOpen && (
                      <CardContent>
                        {!det && <div className="flex justify-center py-6"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>}

                        {det && !emsRequested && !customsRequested && (
                          <p className="text-sm text-muted-foreground py-4 text-center">EMS split not yet published by your GOM.</p>
                        )}

                        {det && (emsRequested || customsRequested) && !mine && (
                          <p className="text-sm text-muted-foreground py-4 text-center">You have no items in this box.</p>
                        )}

                        {det && mine && (emsRequested || customsRequested) && (
                          <div className="space-y-4">
                            {/* Totals */}
                            <div className={`grid gap-3 ${emsRequested && customsRequested ? 'grid-cols-3' : 'grid-cols-2'}`}>
                              {emsRequested && (
                                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                                  <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">EMS</p>
                                  <p className="text-lg font-bold text-blue-700">{formatEur(emsAmt)}</p>
                                  {box.ems_deadline && <p className="text-xs text-amber-600 mt-1 font-semibold">Due {new Date(box.ems_deadline).toLocaleDateString()}</p>}
                                  <div className="mt-2"><StatusBadge paid={mine.ems_paid}/></div>
                                </div>
                              )}
                              {customsRequested && (
                                <div className="bg-purple-50 border border-purple-100 rounded-xl p-3">
                                  <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide mb-1">Customs</p>
                                  <p className="text-lg font-bold text-purple-700">{formatEur(customsAmt)}</p>
                                  {box.customs_deadline && <p className="text-xs text-amber-600 mt-1 font-semibold">Due {new Date(box.customs_deadline).toLocaleDateString()}</p>}
                                  <div className="mt-2"><StatusBadge paid={mine.customs_paid}/></div>
                                </div>
                              )}
                              {emsRequested && customsRequested && (
                                <div className="bg-secondary/40 rounded-xl p-3">
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Total</p>
                                  <p className="text-lg font-bold">{formatEur(emsAmt + customsAmt)}</p>
                                  <p className="text-xs text-muted-foreground mt-1">Pay in Payments tab</p>
                                </div>
                              )}
                            </div>

                            {/* EMS breakdown */}
                            {emsRequested && emsAmt > 0 && mine.items?.length > 0 && (
                              <ItemBreakdown items={mine.items} emsAmt={emsAmt} joinerWeight={joinerWeight} label="EMS" det={det}/>
                            )}

                            {/* Customs breakdown */}
                            {customsRequested && customsAmt > 0 && mine.items?.length > 0 && (
                              <ItemBreakdown items={mine.items} emsAmt={customsAmt} joinerWeight={joinerWeight} label="Customs" det={det}/>
                            )}
                          </div>
                        )}
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
