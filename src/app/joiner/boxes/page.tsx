'use client'
import { useEffect, useState, useRef } from 'react'
import { Box, ChevronDown, ChevronUp, Check, X, Upload } from 'lucide-react'
import { Card, CardContent, CardHeader, PageHeader, EmptyState } from '@/components/ui'
import { formatEur, formatKrw } from '@/lib/utils'

export default function JoinerBoxesPage() {
  const [boxes, setBoxes] = useState<any[]>([])
  const [details, setDetails] = useState<Record<string, any>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState<string | null>(null)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

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

  async function submitProof(boxId: string, action: string, uploadKey: string, file: File) {
    if (file.size > 5_000_000) { alert('Max 5MB'); return }
    setUploading(uploadKey)
    try {
      const proof_url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = e => resolve(e.target?.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      await fetch(`/api/boxes/${boxId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, proof_url }),
      })
      const d = await fetch(`/api/boxes/${boxId}?viewAs=joiner`).then(r => r.json())
      setDetails(prev => ({ ...prev, [boxId]: d }))
    } catch (e) {
      console.error(e)
    }
    setUploading(null)
  }

  function ItemBreakdown({ items, emsAmt, joinerWeight, label }: { items: any[]; emsAmt: number; joinerWeight: number; label: string }) {
    if (!items?.length || emsAmt <= 0) return null
    const isEms = label === 'EMS'
    const colour = isEms ? 'text-blue-600' : 'text-purple-600'
    const bgColour = isEms ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-purple-50 border-purple-200 text-purple-800'
    const joinerItemRate = joinerWeight > 0 ? emsAmt / joinerWeight : 0
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
    return (
      <div className="border border-border rounded-xl overflow-hidden divide-y divide-border/50">
        <p className={`px-4 py-2 text-xs font-bold uppercase tracking-widest border-b ${bgColour}`}>{label} breakdown</p>
        {Object.entries(groups).map(([key, g]) => {
          const groupShare = joinerItemRate * (g.weight_g || 0)
          const totalPcs = g.qty + g.inclusions
          const ratePerPc = totalPcs > 0 ? groupShare / totalPcs : 0
          const pcLabel = g.inclusions > 0
            ? `${g.qty} + ${g.inclusions} incl. = ${totalPcs} PCs`
            : `${g.qty} PC${g.qty !== 1 ? 's' : ''}`
          return (
            <div key={key} className="flex items-center gap-3 px-4 py-3 text-sm">
              <div className="flex-1 min-w-0">
                <p className="font-medium">{g.desc}</p>
                <p className="text-xs text-muted-foreground">{g.shop}{g.members.length > 0 ? ` · ${g.members.join(', ')}` : ''}</p>
                {ratePerPc > 0 && (
                  <p className={`text-xs font-semibold mt-0.5 ${colour}`}>
                    {pcLabel} × {formatEur(ratePerPc)}
                  </p>
                )}
              </div>
              {groupShare > 0 && <span className={`font-mono text-sm font-bold flex-shrink-0 ${colour}`}>{formatEur(groupShare)}</span>}
            </div>
          )
        })}
      </div>
    )
  }

  function ProofSection({ boxId, action, uploadKey, amount, label, paid, proofUrl, paymentInfo, color = 'primary' }: any) {
    const colorCls = color === 'sky'
      ? 'border-sky-200 bg-sky-50/50'
      : 'border-primary/20 bg-primary/5'
    const uploadCls = color === 'sky'
      ? 'border-sky-300 text-sky-600 hover:border-sky-500'
      : 'border-primary/30 text-primary hover:border-primary/60'
    if (paid) return null
    return (
      <div className={`rounded-xl border p-4 space-y-3 ${colorCls}`}>
        <p className="text-sm font-semibold">Pay {label}: {formatEur(amount)}</p>
        {paymentInfo && (
          <div className="rounded-lg bg-background border border-border px-3 py-2.5">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Payment Info</p>
            <p className="text-sm whitespace-pre-wrap">{paymentInfo}</p>
          </div>
        )}
        {proofUrl ? (
          <div className="space-y-2">
            <p className="text-xs text-emerald-600 font-semibold">✓ Proof submitted — waiting for GOM confirmation</p>
            <img src={proofUrl} alt="Proof" className="max-h-32 rounded-lg border object-cover cursor-pointer" onClick={() => window.open(proofUrl, '_blank')}/>
            <button onClick={() => fileRefs.current[uploadKey]?.click()} className="text-xs text-muted-foreground underline">Replace proof</button>
          </div>
        ) : (
          <button onClick={() => fileRefs.current[uploadKey]?.click()} disabled={uploading === uploadKey}
            className={`w-full flex items-center justify-center gap-2 border-2 border-dashed rounded-xl py-4 text-sm font-semibold transition-all ${uploadCls}`}>
            {uploading === uploadKey
              ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"/>
              : <><Upload size={14}/> Upload {label} proof</>}
          </button>
        )}
        <input type="file" accept="image/*" className="hidden"
          ref={el => { fileRefs.current[uploadKey] = el }}
          onChange={e => { const f = e.target.files?.[0]; if (f) submitProof(boxId, action, uploadKey, f) }}/>
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
                const paymentInfo = box.payment_info || null

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

                            {/* Totals summary */}
                            <div className={`grid gap-3 ${emsRequested && customsRequested ? 'grid-cols-3' : 'grid-cols-2'}`}>
                              {emsRequested && (
                                <div className="bg-secondary/40 rounded-xl p-3">
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">EMS</p>
                                  <p className="text-lg font-bold">{formatEur(emsAmt)}</p>
                                  {box.ems_deadline && <p className="text-xs text-amber-600 mt-1 font-semibold">Due {new Date(box.ems_deadline).toLocaleDateString()}</p>}
                                  <div className={`mt-2 inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${mine.ems_paid ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-secondary border-border text-muted-foreground'}`}>
                                    {mine.ems_paid ? <Check size={10}/> : <X size={10}/>} {mine.ems_paid ? 'Paid' : 'Unpaid'}
                                  </div>
                                </div>
                              )}
                              {customsRequested && (
                                <div className="bg-secondary/40 rounded-xl p-3">
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Customs</p>
                                  <p className="text-lg font-bold">{formatEur(customsAmt)}</p>
                                  {box.customs_deadline && <p className="text-xs text-amber-600 mt-1 font-semibold">Due {new Date(box.customs_deadline).toLocaleDateString()}</p>}
                                  <div className={`mt-2 inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${mine.customs_paid ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-secondary border-border text-muted-foreground'}`}>
                                    {mine.customs_paid ? <Check size={10}/> : <X size={10}/>} {mine.customs_paid ? 'Paid' : 'Unpaid'}
                                  </div>
                                </div>
                              )}
                              {emsRequested && customsRequested && (
                                <div className="bg-primary/5 border border-primary/10 rounded-xl p-3">
                                  <p className="text-xs font-semibold text-primary/70 uppercase tracking-wide mb-1">Total</p>
                                  <p className="text-lg font-bold text-primary">{formatEur(emsAmt + customsAmt)}</p>
                                </div>
                              )}
                            </div>

                            {/* EMS item breakdown */}
                            {emsRequested && emsAmt > 0 && mine.items?.length > 0 && (
                              <ItemBreakdown items={mine.items} emsAmt={emsAmt} joinerWeight={joinerWeight} label="EMS"/>
                            )}

                            {/* Customs item breakdown */}
                            {customsRequested && customsAmt > 0 && mine.items?.length > 0 && (
                              <ItemBreakdown items={mine.items} emsAmt={customsAmt} joinerWeight={joinerWeight} label="Customs"/>
                            )}

                            {/* EMS proof upload */}
                            {emsRequested && (
                              <ProofSection
                                boxId={box.id} action="submit_proof" uploadKey={`${box.id}_ems`}
                                amount={emsAmt} label="EMS" paid={mine.ems_paid}
                                proofUrl={mine.proof_url} paymentInfo={paymentInfo}
                              />
                            )}

                            {/* Customs proof upload */}
                            {customsRequested && (
                              <ProofSection
                                boxId={box.id} action="submit_customs_proof" uploadKey={`${box.id}_customs`}
                                amount={customsAmt} label="Customs" paid={mine.customs_paid}
                                proofUrl={mine.customs_proof_url} paymentInfo={paymentInfo} color="sky"
                              />
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
