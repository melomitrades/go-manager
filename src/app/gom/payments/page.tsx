'use client'
import { useState, useCallback } from 'react'
import { Check, X, RefreshCw, PackageX } from 'lucide-react'
import { PageHeader } from '@/components/ui'
import { formatEur, formatDate } from '@/lib/utils'
import { GomCoverage, GomPaymentsArchive } from '@/components/shared/GomCoverage'
import { MarkLostModal, PaymentTypeChip, type LostScope } from '@/components/shared/MarkLostModal'

// ── page ───────────────────────────────────────────────────────────────────────

export default function GomPaymentsPage() {
  const [joinerItems, setJoinerItems] = useState<any[]>([])
  const [activeTab, setActiveTab] = useState<'coverage' | 'joiner-proofs' | 'unpaid' | 'archive'>('coverage')
  // "Unpaid" tab: every payment a joiner currently owes, with the "Mark claims lost" shortcut.
  const [unpaid, setUnpaid] = useState<any[] | null>(null)
  const [unpaidSearch, setUnpaidSearch] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [lostTarget, setLostTarget] = useState<{ joinerId: string; name: string; scope: LostScope; key: string } | null>(null)
  const fetchUnpaid = useCallback(async () => {
    setUnpaid(null)
    const rows = await fetch('/api/joiner-payments/unpaid').then(r => r.json()).catch(() => [])
    setUnpaid(Array.isArray(rows) ? rows : [])
  }, [])
  function openLost(item: { type: string; joiner_id: string; order_id?: string | null; box_id?: string | null; shipment_id?: string | null }, name: string) {
    const ref = item.type === 'order' ? item.order_id : item.type === 'shipping' ? item.shipment_id : item.box_id
    const scope: LostScope = item.type === 'order' ? { order_id: item.order_id } : item.type === 'shipping' ? { shipment_id: item.shipment_id } : { box_id: item.box_id }
    setLostTarget({ joinerId: item.joiner_id, name, scope, key: `${item.type}:${ref}:${item.joiner_id}` })
  }
  const [proofsLoading, setProofsLoading] = useState(false)
  const [previewProof, setPreviewProof]   = useState<string | null>(null)
  const [proofFilter, setProofFilter]     = useState<'all' | 'pending' | 'validated'>('all')
  const [joinerSearch, setJoinerSearch]   = useState('')
  const [orderSearch, setOrderSearch]     = useState('')

  // ── fetch ──────────────────────────────────────────────────────────────────

  const [joinerItemsLoaded, setJoinerItemsLoaded] = useState(false)
  const [joinerLoading, setJoinerLoading] = useState(false)

  const fetchJoinerItems = useCallback(async (force = false) => {
    if ((joinerItemsLoaded && !force) || joinerLoading) return
    setJoinerLoading(true)
    const ji = await fetch('/api/joiner-payments?all=true').then(r => r.json()).catch(() => [])
    setJoinerItems(Array.isArray(ji) ? ji : [])
    setJoinerItemsLoaded(true)
    setJoinerLoading(false)
  }, [joinerItemsLoaded, joinerLoading])

  // ── joiner proof validation ────────────────────────────────────────────────

  async function validateJoinerPayment(item: any) {
    await fetch('/api/joiner-payments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: item.type, order_id: item.order_id, box_id: item.box_id, shipment_id: item.shipment_id,
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
    if (item.shipment_id) params.set('shipment_id', item.shipment_id)
    const res = await fetch('/api/joiner-payments/proof?' + params).then(r => r.json()).catch(() => ({}))
    setProofCache(prev => ({ ...prev, [key]: res.proof_url || null }))
    setLoadingProof(null)
    if (res.proof_url) setPreviewProof(res.proof_url)
  }

  const pendingProofCount = joinerItems.filter((i: any) => !i.paid).length

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Payments" subtitle="What joiners paid vs what you paid, per order"/>

      {/* Tabs */}
      <div className="flex border-b border-border px-4 sm:px-6 overflow-x-auto">
        {(['coverage', 'joiner-proofs', 'unpaid', 'archive'] as const).map(tab => (
          <button key={tab} onClick={() => { setActiveTab(tab); if (tab === 'joiner-proofs') fetchJoinerItems(); if (tab === 'unpaid' && unpaid === null) fetchUnpaid() }}
            className={`px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition-all whitespace-nowrap ${activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {tab === 'coverage' ? 'GOM Payments' : tab === 'archive' ? 'Archive' : tab === 'unpaid' ? (
              <>Unpaid{unpaid && unpaid.filter(u => u.overdue).length > 0 && (
                <span className="ml-1.5 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">{unpaid.filter(u => u.overdue).length}</span>
              )}</>
            ) : (
              <>Joiner Payment Proofs{joinerItemsLoaded && pendingProofCount > 0 && (
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

        {/* ── GOM PAYMENTS (coverage per order) ──────────────────────────── */}
        {activeTab === 'coverage' && <GomCoverage/>}

        {/* ── ARCHIVE (old payments log, read-only) ──────────────────────── */}
        {activeTab === 'archive' && <GomPaymentsArchive/>}

        {/* ── UNPAID TAB ─────────────────────────────────────────────────── */}
        {activeTab === 'unpaid' && (
          unpaid === null
            ? <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>
            : (() => {
              const q = unpaidSearch.toLowerCase()
              const rows = unpaid.filter(u => (!overdueOnly || u.overdue) && (!q || u.joiner_name.toLowerCase().includes(q) || u.label.toLowerCase().includes(q)))
              const byJoiner: Record<string, any[]> = {}
              for (const u of rows) (byJoiner[u.joiner_id] ||= []).push(u)
              return (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="text" placeholder="Search joiner or payment…" value={unpaidSearch} onChange={e => setUnpaidSearch(e.target.value)}
                      className="pl-3 pr-3 py-2 text-xs border border-border rounded-xl bg-background focus:outline-none focus:ring-2 focus:ring-primary/25 w-56"/>
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground cursor-pointer">
                      <input type="checkbox" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} className="accent-primary"/> Overdue only
                    </label>
                    <button onClick={fetchUnpaid} className="ml-auto text-muted-foreground hover:text-foreground p-1" title="Refresh"><RefreshCw size={13}/></button>
                  </div>
                  <p className="text-xs text-muted-foreground">Everything joiners currently owe. If someone won&apos;t pay, “Mark claims lost” releases their claims as leftovers.</p>
                  {Object.keys(byJoiner).length === 0 ? (
                    <div className="text-center py-10 text-sm text-muted-foreground">Nothing unpaid{overdueOnly ? ' and overdue' : ''} 🎉</div>
                  ) : Object.entries(byJoiner).map(([jid, list]) => (
                    <div key={jid} className="border border-border rounded-2xl overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 bg-secondary/30 border-b border-border">
                        <p className="font-bold text-sm">{list[0].joiner_name}</p>
                        <p className="text-sm font-semibold tabular-nums">{formatEur(list.reduce((s: number, u: any) => s + u.amount_eur, 0))}</p>
                      </div>
                      <div className="divide-y divide-border/50">
                        {list.map((u: any) => (
                          <div key={u.key} className="flex items-center gap-3 px-4 py-2.5">
                            <PaymentTypeChip type={u.type}/>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm truncate">{u.label}</p>
                              <p className="text-xs text-muted-foreground">
                                {u.deadline ? <span className={u.overdue ? 'text-red-600 font-semibold' : ''}>{u.overdue ? 'Overdue since ' : 'Due '}{formatDate(u.deadline)}</span> : 'No deadline'}
                                {u.proof_submitted && <span className="ml-2 text-amber-600">📎 proof sent — check the proofs tab</span>}
                              </p>
                            </div>
                            <span className="text-sm font-semibold tabular-nums">{formatEur(u.amount_eur)}</span>
                            <button onClick={() => openLost(u, u.joiner_name)}
                              className="text-xs border border-border text-muted-foreground px-2.5 py-1 rounded-lg font-semibold hover:text-red-600 hover:border-red-300 transition-colors flex items-center gap-1 flex-shrink-0">
                              <PackageX size={11}/> Mark claims lost
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()
        )}

        {/* ── JOINER PROOFS TAB ─────────────────────────────────────────── */}
        {activeTab === 'joiner-proofs' && (
          <div className="space-y-4">
            {joinerLoading && (
              <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>
            )}
            {!joinerLoading && joinerItemsLoaded && joinerItems.length > 0 && (
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
              <div className="text-center py-10 text-sm text-muted-foreground">{joinerItemsLoaded ? 'No joiner payment submissions yet.' : ''}</div>
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
                    const pendingItems = batchItems.filter((i: any) => !i.paid)
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
                              <button onClick={async () => { await Promise.all(pendingItems.map((i: any) => validateJoinerPayment(i))) }}
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
                                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${item.type === 'order' ? 'bg-sky-50 text-sky-700 border-sky-200' : item.type === 'ems' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : item.type === 'shipping' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-violet-50 text-violet-700 border-violet-200'}`}>{item.type}</span>
                                  <p className="text-sm truncate">{item.label}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-sm font-semibold">{formatEur(item.amount_eur)}</span>
                                {item.paid ? (
                                  <span className="text-xs font-bold text-emerald-600 w-16 text-right">✓ Paid</span>
                                ) : true ? (
                                  <>
                                  <button onClick={() => openLost(item, joinerName)} title="Didn't pay — mark claims as lost"
                                    className="text-xs border border-border text-muted-foreground px-2 py-1 rounded-lg font-semibold hover:text-red-600 hover:border-red-300 transition-colors flex items-center gap-1">
                                    <PackageX size={10}/> Lost
                                  </button>
                                  <button onClick={() => validateJoinerPayment(item)}
                                    className="text-xs bg-emerald-500 text-white px-2.5 py-1 rounded-lg font-semibold hover:bg-emerald-600 transition-colors flex items-center gap-1 w-20 justify-center">
                                    <Check size={10}/> Validate
                                  </button>
                                  </>
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

      <MarkLostModal
        open={!!lostTarget}
        joinerId={lostTarget?.joinerId || null}
        joinerName={lostTarget?.name}
        scope={lostTarget?.scope || {}}
        defaultTriggerKey={lostTarget?.key}
        onClose={() => setLostTarget(null)}
        onDone={() => { fetchUnpaid(); if (joinerItemsLoaded) fetchJoinerItems(true) }}
      />

    </div>
  )
}
