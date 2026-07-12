'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus, Pencil, Trash2, Check, Eye, X, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react'
import { Button, Card, Badge, Table, Th, Td, Tr, Modal, Input, Select, FormField, PageHeader, EmptyState } from '@/components/ui'
import { formatEur, formatKrw, formatDate } from '@/lib/utils'

// ── helpers ────────────────────────────────────────────────────────────────────

function CoveringBadge({ value }: { value: number }) {
  if (value === 0) return <span className="text-muted-foreground text-sm tabular-nums">±{formatEur(0)}</span>
  const pos = value > 0
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-semibold tabular-nums ${pos ? 'text-emerald-600' : 'text-red-500'}`}>
      {pos ? <TrendingUp size={13}/> : <TrendingDown size={13}/>}
      {pos ? '+' : ''}{formatEur(value)}
    </span>
  )
}

const EMPTY_FORM = { order_id: '', date_of_payment: '', amount_eur: '', amount_krw: '' }

// ── page ───────────────────────────────────────────────────────────────────────

export default function GomPaymentsPage() {
  const [payments, setPayments]   = useState<any[]>([])
  const [orders, setOrders]       = useState<any[]>([])
  const [joinerItems, setJoinerItems] = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [activeTab, setActiveTab] = useState<'payments' | 'joiner-proofs'>('payments')
  const [proofsLoading, setProofsLoading] = useState(false)
  const [previewProof, setPreviewProof]   = useState<string | null>(null)
  const [proofFilter, setProofFilter]     = useState<'all' | 'pending' | 'validated'>('all')
  const [joinerSearch, setJoinerSearch]   = useState('')
  const [orderSearch, setOrderSearch]     = useState('')
  const [modalOpen, setModalOpen]   = useState(false)
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [form, setForm]             = useState<typeof EMPTY_FORM>(EMPTY_FORM)
  const [saving, setSaving]         = useState(false)
  const [deleteId, setDeleteId]     = useState<string | null>(null)

  // ── fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [pmts, ords, ji] = await Promise.all([
      fetch('/api/payments').then(r => r.json()).catch(() => []),
      fetch('/api/orders').then(r => r.json()).catch(() => []),
      fetch('/api/joiner-payments?all=true').then(r => r.json()).catch(() => []),
    ])
    setPayments(Array.isArray(pmts) ? pmts : [])
    setOrders(Array.isArray(ords) ? ords : [])
    setJoinerItems(Array.isArray(ji) ? ji.filter((i: any) => i.proof_submitted || i.proof_url) : [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ── order label helper ────────────────────────────────────────────────────

  function orderLabel(o: any) {
    const parts = [
      o.group?.name || o.group_name,
      o.round_number ? `R${o.round_number}` : null,
      o.label || o.shop?.name,
    ].filter(Boolean)
    return parts.join(' · ') || o.id?.slice(0, 8)
  }

  // ── covering: sum of validated joiner payments for an order ───────────────
  // joinerItems has all items with proof_url; validated ones have paid=true
  // We compute per order_id

  function totalJoinerPaidForOrder(orderId: string): number {
    return joinerItems
      .filter((i: any) => i.order_id === orderId && i.paid)
      .reduce((s: number, i: any) => s + (parseFloat(i.amount_eur) || 0), 0)
  }

  // ── modal ─────────────────────────────────────────────────────────────────

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  function openEdit(p: any) {
    setEditingId(p.id)
    setForm({
      order_id:        p.order_id ?? '',
      date_of_payment: p.deadline ? p.deadline.slice(0, 10) : (p.date_of_payment ? p.date_of_payment.slice(0, 10) : ''),
      amount_eur:      p.amount_eur != null ? String(p.amount_eur) : '',
      amount_krw:      p.amount_krw != null ? String(p.amount_krw) : '',
    })
    setModalOpen(true)
  }

  // ── live covering preview in modal ────────────────────────────────────────

  const selectedOrder = orders.find((o: any) => o.id === form.order_id)
  const totalCollected = form.order_id ? totalJoinerPaidForOrder(form.order_id) : null
  const previewCovering = totalCollected != null && form.amount_eur
    ? totalCollected - parseFloat(form.amount_eur)
    : null

  // ── save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.amount_eur) return
    setSaving(true)
    const body = {
      order_id:   form.order_id || null,
      // store in 'deadline' column (existing column) repurposed as date_of_payment
      deadline:   form.date_of_payment || null,
      amount_eur: parseFloat(form.amount_eur),
      amount_krw: form.amount_krw ? parseInt(form.amount_krw) : null,
      // required fields with defaults so existing NOT NULL constraints pass
      recipient_type: 'shop',
    }
    if (editingId) {
      await fetch('/api/payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, id: editingId }),
      })
    } else {
      await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    }
    setSaving(false)
    setModalOpen(false)
    fetchData()
  }

  // ── delete ─────────────────────────────────────────────────────────────────

  async function handleDelete(id: string) {
    await fetch('/api/payments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setDeleteId(null)
    fetchData()
  }

  // ── joiner proof validation ────────────────────────────────────────────────

  async function validateJoinerPayment(item: any) {
    await fetch('/api/joiner-payments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: item.type, order_id: item.order_id, box_id: item.box_id,
        joiner_id: item.joiner_id, paid: true, validated_by_gom: true,
      }),
    })
    setJoinerItems(prev => prev.map((i: any) => i.id === item.id ? { ...i, paid: true } : i))
  }

  const [proofCache, setProofCache] = useState<Record<string, string | null>>({})
  const [loadingProof, setLoadingProof] = useState<string | null>(null)

  async function loadProof(item: any) {
    const key = item.id
    if (key in proofCache) {
      if (proofCache[key]) setPreviewProof(proofCache[key])
      return
    }
    // If proof_url already on item (old rows), use it directly
    if (item.proof_url) {
      setProofCache(prev => ({ ...prev, [key]: item.proof_url }))
      setPreviewProof(item.proof_url)
      return
    }
    setLoadingProof(key)
    const params = new URLSearchParams({ type: item.type, joiner_id: item.joiner_id })
    if (item.order_id) params.set('order_id', item.order_id)
    if (item.box_id) params.set('box_id', item.box_id)
    const res = await fetch('/api/joiner-payments/proof?' + params).then(r => r.json()).catch(() => ({}))
    setProofCache(prev => ({ ...prev, [key]: res.proof_url || null }))
    setLoadingProof(null)
    if (res.proof_url) setPreviewProof(res.proof_url)
  }

  const pendingProofCount = joinerItems.filter((i: any) => !i.paid && (i.proof_submitted || i.proof_url)).length

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Payments"
        subtitle={`${payments.length} entries`}
        action={<Button onClick={openCreate}><Plus size={14}/> Log Payment</Button>}
      />

      {/* Tabs */}
      <div className="flex border-b border-border px-4 sm:px-6 overflow-x-auto">
        {(['payments', 'joiner-proofs'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition-all whitespace-nowrap ${activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {tab === 'payments' ? 'GOM Payments' : (
              <>Joiner Payment Proofs{pendingProofCount > 0 && (
                <span className="ml-1.5 bg-primary text-primary-foreground text-xs px-1.5 py-0.5 rounded-full">{pendingProofCount}</span>
              )}</>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6">

        {/* ── PROOF PREVIEW OVERLAY ─────────────────────────────────────── */}
        {previewProof && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setPreviewProof(null)}>
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm"/>
            <div className="relative bg-card rounded-2xl overflow-hidden max-w-lg w-full shadow-2xl">
              <img src={previewProof} alt="Proof" className="w-full max-h-[70vh] object-contain"/>
              <button onClick={() => setPreviewProof(null)}
                className="absolute top-3 right-3 w-8 h-8 bg-black/50 text-white rounded-lg flex items-center justify-center">
                <X size={14}/>
              </button>
            </div>
          </div>
        )}

        {/* ── GOM PAYMENTS TAB ─────────────────────────────────────────── */}
        {activeTab === 'payments' && (
          loading
            ? <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>
            : payments.length === 0
              ? <EmptyState icon={Plus} title="No payments yet" action={<Button onClick={openCreate}><Plus size={14}/> Log Payment</Button>}/>
              : (
                <>
                  {/* Desktop table */}
                  <div className="hidden sm:block">
                    <Card>
                      <Table>
                        <thead>
                          <tr>
                            <Th>Order</Th>
                            <Th>Date of Payment</Th>
                            <Th className="text-right">Amount Paid (€)</Th>
                            <Th className="text-right">Amount Paid (₩)</Th>
                            <Th className="text-right">Covering</Th>
                            <Th/>
                          </tr>
                        </thead>
                        <tbody>
                          {payments.map((p: any) => {
                            const collected = p.order_id ? totalJoinerPaidForOrder(p.order_id) : 0
                            const covering  = collected - parseFloat(p.amount_eur || 0)
                            const linkedOrder = orders.find((o: any) => o.id === p.order_id)
                            return (
                              <Tr key={p.id}>
                                <Td>
                                  {linkedOrder
                                    ? <span className="font-medium text-sm">{orderLabel(linkedOrder)}</span>
                                    : <span className="text-muted-foreground/40 text-xs italic">—</span>
                                  }
                                </Td>
                                <Td className="text-muted-foreground text-sm">
                                  {p.deadline || p.date_of_payment
                                    ? formatDate(p.deadline || p.date_of_payment)
                                    : <span className="text-muted-foreground/40 italic">—</span>
                                  }
                                </Td>
                                <Td className="text-right font-semibold font-mono">{formatEur(p.amount_eur)}</Td>
                                <Td className="text-right font-mono text-muted-foreground text-sm">
                                  {p.amount_krw ? formatKrw(p.amount_krw) : '—'}
                                </Td>
                                <Td className="text-right">
                                  <CoveringBadge value={covering}/>
                                  {p.order_id && (
                                    <div className="text-[10px] text-muted-foreground/50 mt-0.5">
                                      collected {formatEur(collected)}
                                    </div>
                                  )}
                                </Td>
                                <Td>
                                  <div className="flex gap-1 justify-end">
                                    <Button variant="ghost" size="icon" onClick={() => openEdit(p)}><Pencil size={13}/></Button>
                                    <Button variant="ghost" size="icon" onClick={() => setDeleteId(p.id)}><Trash2 size={13} className="text-destructive/60 hover:text-destructive"/></Button>
                                  </div>
                                </Td>
                              </Tr>
                            )
                          })}
                        </tbody>
                      </Table>
                    </Card>
                  </div>

                  {/* Mobile cards */}
                  <div className="sm:hidden space-y-3">
                    {payments.map((p: any) => {
                      const collected = p.order_id ? totalJoinerPaidForOrder(p.order_id) : 0
                      const covering  = collected - parseFloat(p.amount_eur || 0)
                      const linkedOrder = orders.find((o: any) => o.id === p.order_id)
                      return (
                        <div key={p.id} className="bg-card border border-border rounded-2xl px-4 py-4 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold text-sm">
                                {linkedOrder ? orderLabel(linkedOrder) : <span className="text-muted-foreground italic">No order linked</span>}
                              </p>
                              {(p.deadline || p.date_of_payment) && (
                                <p className="text-xs text-muted-foreground mt-0.5">{formatDate(p.deadline || p.date_of_payment)}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="icon" onClick={() => openEdit(p)}><Pencil size={13}/></Button>
                              <Button variant="ghost" size="icon" onClick={() => setDeleteId(p.id)}><Trash2 size={13} className="text-destructive/50"/></Button>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-mono font-bold text-primary">{formatEur(p.amount_eur)}</p>
                              {p.amount_krw && <p className="text-xs text-muted-foreground font-mono">{formatKrw(p.amount_krw)}</p>}
                            </div>
                            <div className="text-right">
                              <CoveringBadge value={covering}/>
                              {p.order_id && <p className="text-[10px] text-muted-foreground/50 mt-0.5">collected {formatEur(collected)}</p>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )
        )}

        {/* ── JOINER PROOFS TAB ─────────────────────────────────────────── */}
        {activeTab === 'joiner-proofs' && (
          <div className="space-y-4">
            {joinerItems.length > 0 && (
              <div className="space-y-3">
                <div className="flex gap-1 bg-secondary/50 rounded-xl p-1 w-fit">
                  {(['all', 'pending', 'validated'] as const).map(f => (
                    <button key={f} onClick={() => setProofFilter(f)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${proofFilter === f ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                      {f === 'pending' ? '⏳ Pending' : f === 'validated' ? '✓ Validated' : 'All'}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 flex-wrap">
                  {[['joiner', joinerSearch, setJoinerSearch, 'Search joiner…'], ['order', orderSearch, setOrderSearch, 'Search order…']].map(([key, val, setter, ph]: any) => (
                    <div key={key} className="relative">
                      <input type="text" placeholder={ph} value={val} onChange={e => setter(e.target.value)}
                        className="pl-3 pr-7 py-2 text-xs border border-border rounded-xl bg-background focus:outline-none focus:ring-2 focus:ring-primary/25 w-44"/>
                      {val && <button onClick={() => setter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">×</button>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {joinerItems.length === 0 ? (
              <div className="text-center py-10 text-sm text-muted-foreground">No joiner payment submissions yet.</div>
            ) : (() => {
              const filtered = joinerItems.filter((item: any) => {
                if (proofFilter === 'pending' && item.paid) return false
                if (proofFilter === 'validated' && !item.paid) return false
                if (joinerSearch && !(item.joiner_name || item.joiner_username || '').toLowerCase().includes(joinerSearch.toLowerCase())) return false
                if (orderSearch && !(item.label || '').toLowerCase().includes(orderSearch.toLowerCase())) return false
                return true
              })
              if (filtered.length === 0) return <div className="text-center py-10 text-sm text-muted-foreground">No submissions match this filter.</div>

              const batches: Record<string, any[]> = {}
              for (const item of filtered) {
                const joiner = item.joiner_name || item.joiner_username || 'Unknown'
                const key = `${joiner}||${item.id}`
                if (!batches[key]) batches[key] = []
                batches[key].push(item)
              }

              return (
                <div className="space-y-5">
                  {Object.entries(batches).map(([batchKey, batchItems]) => {
                    const pendingItems = batchItems.filter((i: any) => !i.paid && (i.proof_submitted || i.proof_url))
                    const firstItem = batchItems[0]
                    const fullName = batchItems.find((i: any) => i.full_name)?.full_name
                    const joinerName = firstItem?.joiner_name || firstItem?.joiner_username || 'Unknown'
                    const total = batchItems.reduce((s: number, i: any) => s + i.amount_eur, 0)
                    const isBatch = batchItems.length > 1
                    const cachedProof = proofCache[firstItem?.id]
                    return (
                      <div key={batchKey} className={`border-2 rounded-2xl overflow-hidden ${pendingItems.length > 0 ? 'border-amber-300' : 'border-emerald-200 opacity-70'}`}>
                        <div className="flex gap-0">
                          <div className="w-28 flex-shrink-0 bg-secondary/30 cursor-pointer flex items-center justify-center min-h-[80px]"
                            onClick={() => cachedProof ? setPreviewProof(cachedProof) : loadProof(firstItem)}>
                            {cachedProof
                              ? <img src={cachedProof} alt="proof" className="w-full h-full object-cover max-h-40"/>
                              : loadingProof === firstItem?.id
                                ? <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"/>
                                : <span className="text-xs text-muted-foreground text-center px-2">👁<br/>View<br/>Proof</span>
                            }
                          </div>
                          <div className="flex-1 px-4 py-3.5">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                  <p className="font-bold text-sm">{joinerName}</p>
                                  {fullName && <span className="text-xs text-muted-foreground">· 💳 {fullName}</span>}
                                  {isBatch && <span className="text-xs font-semibold text-primary/70 bg-primary/10 px-2 py-0.5 rounded-full">{batchItems.length} orders</span>}
                                </div>
                                <p className={`text-xs font-bold ${pendingItems.length > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                  {pendingItems.length > 0 ? `⏳ ${pendingItems.length} awaiting validation` : '✓ All validated'}
                                </p>
                              </div>
                              <p className="font-display text-xl font-bold text-primary flex-shrink-0">{formatEur(total)}</p>
                            </div>
                            {pendingItems.length > 1 && (
                              <button onClick={async () => { await Promise.all(pendingItems.map((i: any) => validateJoinerPayment(i))); fetchData() }}
                                className="mt-3 flex items-center gap-1.5 text-xs bg-emerald-500 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-emerald-600 transition-colors w-full justify-center">
                                <Check size={12}/> Validate all {pendingItems.length} orders
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="border-t border-border/50 divide-y divide-border/50">
                          {batchItems.map((item: any) => (
                            <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                              <div className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center ${item.paid ? 'bg-emerald-500 border-emerald-500' : 'border-border'}`}>
                                {item.paid && <Check size={10} className="text-white"/>}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${item.type === 'order' ? 'bg-sky-50 text-sky-700 border-sky-200' : item.type === 'ems' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-violet-50 text-violet-700 border-violet-200'}`}>{item.type}</span>
                                  <p className="text-sm truncate">{item.label}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-sm font-semibold">{formatEur(item.amount_eur)}</span>
                                {item.paid ? (
                                  <span className="text-xs font-bold text-emerald-600 w-16 text-right">✓ Paid</span>
                                ) : (item.proof_submitted || item.proof_url) ? (
                                  <button onClick={() => validateJoinerPayment(item)}
                                    className="text-xs bg-emerald-500 text-white px-2.5 py-1 rounded-lg font-semibold hover:bg-emerald-600 transition-colors flex items-center gap-1 w-20 justify-center">
                                    <Check size={10}/> Validate
                                  </button>
                                ) : (
                                  <span className="text-xs text-muted-foreground/40 w-20 text-right">no proof</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {/* ── ADD / EDIT MODAL ─────────────────────────────────────────────── */}
      {modalOpen && (
        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Edit Payment' : 'Log Payment'} size="md">
          <div className="space-y-4">
            <FormField label="Linked Order">
              <Select
                value={form.order_id}
                onChange={(e: any) => setForm(f => ({ ...f, order_id: e.target.value }))}
                options={[
                  { value: '', label: '— No order —' },
                  ...orders.map((o: any) => ({ value: o.id, label: orderLabel(o) }))
                ]}
              />
            </FormField>

            <FormField label="Date of Payment">
              <Input type="date" value={form.date_of_payment}
                onChange={(e: any) => setForm(f => ({ ...f, date_of_payment: e.target.value }))}/>
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Amount Paid (€)" required>
                <Input type="number" step="0.01" min="0" placeholder="0.00"
                  value={form.amount_eur}
                  onChange={(e: any) => setForm(f => ({ ...f, amount_eur: e.target.value }))}/>
              </FormField>
              <FormField label="Amount Paid (₩)">
                <Input type="number" step="1" min="0" placeholder="0"
                  value={form.amount_krw}
                  onChange={(e: any) => setForm(f => ({ ...f, amount_krw: e.target.value }))}/>
              </FormField>
            </div>

            {/* Live covering preview */}
            {selectedOrder && form.amount_eur && (
              <div className="rounded-xl border bg-muted/30 px-4 py-3 text-sm space-y-1.5">
                <div className="flex justify-between text-muted-foreground">
                  <span>Total collected from joiners</span>
                  <span className="tabular-nums font-medium text-foreground">{formatEur(totalCollected ?? 0)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Amount paid</span>
                  <span className="tabular-nums font-medium text-foreground">− {formatEur(parseFloat(form.amount_eur))}</span>
                </div>
                <div className="flex justify-between border-t pt-1.5 mt-0.5">
                  <span className="font-semibold">Covering</span>
                  <span className={`tabular-nums font-bold ${previewCovering! > 0 ? 'text-emerald-600' : previewCovering! < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                    {previewCovering! >= 0 ? '+' : ''}{formatEur(previewCovering!)}
                  </span>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !form.amount_eur}>
                {saving ? 'Saving…' : editingId ? 'Update' : 'Save'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── DELETE CONFIRM ────────────────────────────────────────────────── */}
      {deleteId && (
        <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Payment" size="sm">
          <p className="text-sm text-muted-foreground mb-5">Are you sure you want to delete this payment? This cannot be undone.</p>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => handleDelete(deleteId!)}>Delete</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
