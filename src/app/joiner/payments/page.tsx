'use client'
import { useEffect, useState, useCallback } from 'react'
import { CreditCard, Upload, Check, RefreshCw, Send, X, CheckSquare, Square } from 'lucide-react'
import { Button, PageHeader, EmptyState, Badge } from '@/components/ui'
import { formatEur, formatDate } from '@/lib/utils'

const TYPE_COLORS: Record<string, string> = {
  order:   'bg-sky-50 text-sky-700 border-sky-200',
  ems:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  customs: 'bg-violet-50 text-violet-700 border-violet-200',
}

export default function JoinerPaymentsPage() {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [proof, setProof] = useState('')
  const [fullName, setFullName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Submitted item IDs (cleared on reload — server state is source of truth)
  const [submittedIds, setSubmittedIds] = useState<Set<string>>(new Set())

  const fetchData = useCallback(async () => {
    setLoading(true)
    const data = await fetch('/api/joiner-payments').then(r => r.json()).catch(() => [])
    setItems(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const orderItems = items.filter(i => i.type === 'order')
  const boxItems = items.filter(i => i.type === 'ems' || i.type === 'customs')
  const unpaidItems = orderItems.filter(i => !i.paid)
  const paidItems = orderItems.filter(i => i.paid)
  // Items with proof submitted but not yet validated by GOM
  const pendingItems = unpaidItems.filter(i => i.proof_submitted || i.proof_url)
  const awaitingProof = unpaidItems.filter(i => !i.proof_submitted && !i.proof_url)
  // Items selectable = those not yet submitted (no proof_url) — orders only
  const selectableItems = awaitingProof
  const selectableBoxItems = boxItems.filter(i => !i.paid && !i.proof_submitted && !i.proof_url)
  const selectedItems = selectableItems.filter(i => selected.has(i.id))
  const selectedBoxItems = selectableBoxItems.filter(i => selected.has(i.id))
  const allSelectedItems = [...selectedItems, ...selectedBoxItems]
  const selectedTotal = allSelectedItems.reduce((s, i) => s + i.amount_eur, 0)
  const allSelected = selectableItems.length > 0 && selectableItems.every(i => selected.has(i.id))

  function toggle(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function handleFile(file: File) {
    if (file.size > 5_000_000) { alert('Max 5MB'); return }
    const reader = new FileReader()
    reader.onload = ev => setProof(ev.target?.result as string || '')
    reader.readAsDataURL(file)
  }

  async function submit() {
    if (!proof || selected.size === 0 || !fullName.trim()) return
    setSubmitting(true)
    await Promise.all(allSelectedItems.map(item =>
      fetch('/api/joiner-payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: item.type,
          order_id: item.order_id || null,
          box_id: item.box_id || null,
          paid: false,
          proof_url: proof,
          full_name: fullName.trim(),
        }),
      })
    ))
    setSubmittedIds(prev => { const n = new Set(prev); allSelectedItems.forEach(i => n.add(i.id)); return n })
    setSelected(new Set())
    setProof('')
    setSubmitting(false)
    await fetchData()
  }

  const paymentInfos = [...new Map(
    allSelectedItems.filter((i: any) => i.payment_info).map((i: any) => [i.payment_info, i.payment_info])
  ).values()]

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  if (items.length === 0) return (
    <div className="flex flex-col h-full">
      <PageHeader title="Payments" subtitle="Your payment requests"/>
      <div className="flex-1 flex items-center justify-center">
        <EmptyState icon={CreditCard} title="No payment requests" description="Items will appear here once your GOM sets prices."/>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Payments"
        subtitle={`${formatEur([...unpaidItems,...boxItems.filter(i=>!i.paid)].reduce((s,i)=>s+i.amount_eur,0))} outstanding`}
        action={<Button variant="ghost" size="sm" onClick={fetchData}><RefreshCw size={13}/> Refresh</Button>}
      />
      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-5">

        {/* ── Pending validation section ─────────────────────────── */}
        {pendingItems.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Awaiting validation</p>
            {pendingItems.map(item => (
              <div key={item.id} className="flex items-center gap-3 px-4 py-3 bg-card border border-border rounded-2xl opacity-50">
                <div className="w-4 h-4 rounded-full border-2 border-amber-400 bg-amber-100 flex-shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.label}</p>
                </div>
                <span className="text-xs font-bold text-amber-600 whitespace-nowrap">⏳ {formatEur(item.amount_eur)}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Selectable unpaid items ────────────────────────────── */}
        {selectableItems.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                {pendingItems.length > 0 ? 'Remaining to pay' : 'Outstanding'}
              </p>
              <button onClick={() => setSelected(allSelected ? new Set() : new Set(selectableItems.map(i => i.id)))}
                className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                {allSelected ? <><CheckSquare size={13}/> Deselect all</> : <><Square size={13}/> Select all</>}
              </button>
            </div>

            {selectableItems.map(item => {
              const sel = selected.has(item.id)
              return (
                <div key={item.id} onClick={() => toggle(item.id)}
                  className={`border-2 rounded-2xl overflow-hidden cursor-pointer select-none transition-all ${sel ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/40'}`}>
                  <div className="flex items-start gap-3 px-4 py-3.5">
                    <div className={`w-5 h-5 rounded-md border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-all ${sel ? 'bg-primary border-primary' : 'border-border'}`}>
                      {sel && <Check size={11} className="text-white"/>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${TYPE_COLORS[item.type] || ''}`}>{item.type}</span>
                      </div>
                      <p className="font-semibold text-sm">{item.label}</p>
                      {item.deadline && (
                        <p className={`text-xs mt-0.5 ${new Date(item.deadline) < new Date() ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                          Due: {formatDate(item.deadline)}
                        </p>
                      )}
                      {item.payment_info && (
                        <div className="mt-2 border border-primary/20 bg-primary/5 rounded-xl px-3 py-2">
                          <p className="text-xs font-bold text-primary uppercase tracking-wide mb-0.5">💳 Payment Info</p>
                          <p className="text-xs whitespace-pre-wrap">{item.payment_info}</p>
                        </div>
                      )}
                    </div>
                    <p className="font-display text-xl font-bold text-primary flex-shrink-0">{formatEur(item.amount_eur)}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Submission panel ───────────────────────────────────── */}
        {selected.size > 0 && (
          <div className="border-2 border-primary rounded-2xl overflow-hidden bg-card">
            {/* Selected summary */}
            <div className="flex items-center justify-between px-5 py-4 bg-primary/5 border-b border-primary/15">
              <div>
                <p className="text-sm font-semibold">{allSelectedItems.length} item{allSelectedItems.length !== 1 ? 's' : ''} selected</p>
                <p className="font-display text-2xl font-bold text-primary">{formatEur(selectedTotal)}</p>
              </div>
              <button onClick={() => { setSelected(new Set()); setProof('') }} className="text-muted-foreground hover:text-foreground"><X size={16}/></button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Warning */}
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
                ⚠️ Please upload <strong>one proof per payment</strong>. If you paid to different GOMs separately, you need to submit a separate proof for each.
              </div>

              {/* Payment infos for all selected items */}
              {[...new Map(allSelectedItems.filter(i => i.payment_info).map((i: any) => [i.payment_info, i.payment_info])).values()].map((info: any, idx: number) => (
                <div key={idx} className="border border-primary/25 bg-primary/5 rounded-xl px-3 py-2.5">
                  <p className="text-xs font-bold text-primary uppercase tracking-wide mb-1">💳 Payment Info</p>
                  <p className="text-xs whitespace-pre-wrap">{info}</p>
                </div>
              ))}

              {/* Full name */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Full name on the payment</label>
                <input type="text" placeholder="e.g. Jane Doe" value={fullName} onChange={e => setFullName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"/>
              </div>

              {/* Proof upload */}
              {proof ? (
                <div className="relative">
                  <img src={proof} alt="proof" className="w-full max-h-48 object-cover rounded-xl border border-border"/>
                  <label className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2.5 py-1 rounded-lg cursor-pointer">
                    Replace <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}/>
                  </label>
                </div>
              ) : (
                <label className="w-full border-2 border-dashed border-border hover:border-primary/50 rounded-xl py-6 flex flex-col items-center gap-2 text-muted-foreground hover:text-primary cursor-pointer transition-all">
                  <Upload size={20}/>
                  <p className="text-sm font-semibold">Upload proof of payment</p>
                  <p className="text-xs text-center">This covers all {allSelectedItems.length} selected item{allSelectedItems.length !== 1 ? 's' : ''}</p>
                  <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}/>
                </label>
              )}

              {proof && (
                <Button onClick={submit} disabled={submitting || !fullName.trim()} className="w-full">
                  {submitting
                    ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/> Submitting…</>
                    : <><Send size={14}/> Submit proof for {allSelectedItems.length} item{allSelectedItems.length !== 1 ? 's' : ''}</>
                  }
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ── EMS / Customs section ───────────────────────────── */}
        {boxItems.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">EMS & Customs</p>
            {boxItems.map(item => {
              const isEms = item.type === 'ems'
              const colour = isEms ? 'border-blue-200 bg-blue-50/40' : 'border-purple-200 bg-purple-50/40'
              const textColour = isEms ? 'text-blue-700' : 'text-purple-700'
              const isPending = !item.paid && (item.proof_submitted || item.proof_url)
              const isSelectable = !item.paid && !item.proof_submitted && !item.proof_url
              const isSel = selected.has(item.id)
              return (
                <div key={item.id}
                  onClick={() => isSelectable ? toggle(item.id) : undefined}
                  className={`border-2 rounded-2xl overflow-hidden transition-all ${isPending ? 'opacity-60 border-amber-200 bg-amber-50/40 cursor-default' : item.paid ? 'opacity-50 border-emerald-200 bg-card cursor-default' : isSel ? `border-primary bg-primary/5 cursor-pointer` : `${colour} cursor-pointer hover:border-primary/40`}`}>
                  <div className="flex items-start gap-3 px-4 py-3.5">
                    {isSelectable && (
                      <div className={`w-5 h-5 rounded-md border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-all ${isSel ? 'bg-primary border-primary' : 'border-border'}`}>
                        {isSel && <Check size={11} className="text-white"/>}
                      </div>
                    )}
                    {isPending && <div className="w-4 h-4 rounded-full border-2 border-amber-400 bg-amber-100 flex-shrink-0 mt-1"/>}
                    {item.paid && <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0 mt-1"><Check size={10} className="text-white"/></div>}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${isEms ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-purple-100 text-purple-700 border-purple-200'}`}>{item.type.toUpperCase()}</span>
                        {isPending && <span className="text-xs text-amber-600 font-semibold">⏳ Awaiting validation</span>}
                        {item.paid && <span className="text-xs text-emerald-600 font-semibold">✓ Validated</span>}
                      </div>
                      <p className="font-semibold text-sm">{item.label}</p>
                      {item.deadline && (
                        <p className={`text-xs mt-0.5 ${new Date(item.deadline) < new Date() ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                          Due: {formatDate(item.deadline)}
                        </p>
                      )}
                      {item.payment_info && isSelectable && (
                        <div className="mt-2 border border-primary/20 bg-primary/5 rounded-xl px-3 py-2">
                          <p className="text-xs font-bold text-primary uppercase tracking-wide mb-0.5">💳 Payment Info</p>
                          <p className="text-xs whitespace-pre-wrap">{item.payment_info}</p>
                        </div>
                      )}
                    </div>
                    <p className={`font-display text-xl font-bold flex-shrink-0 ${textColour}`}>{formatEur(item.amount_eur)}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Validated (paid) ──────────────────────────────────── */}
        {paidItems.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Validated ✓</p>
            {paidItems.map(item => (
              <div key={item.id} className="flex items-center gap-3 px-4 py-3 bg-card border border-emerald-200 rounded-2xl opacity-50">
                <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
                  <Check size={10} className="text-white"/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.label}</p>
                </div>
                <span className="text-sm font-semibold text-emerald-600">{formatEur(item.amount_eur)}</span>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
