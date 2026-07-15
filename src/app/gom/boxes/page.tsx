'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus, Box, Pencil, ChevronDown, ChevronUp, Check, X, Trash2 } from 'lucide-react'
import { Button, Card, CardHeader, CardContent, Modal, Input, Select, FormField, PageHeader, EmptyState, Badge } from '@/components/ui'
import { formatEur, formatKrw } from '@/lib/utils'

const ITEM_TYPES = [
  { value: 'photocard', label: '🃏 Photocard' },
  { value: 'album', label: '💿 Album' },
  { value: 'photobook', label: '📖 Photobook' },
  { value: 'custom', label: '✏️ Custom…' },
]

interface ItemTypeRow { id: string; item_type: string; custom_label: string; weight_g: string }
function uid() { return Math.random().toString(36).slice(2) }

export default function GomBoxesPage() {
  const [boxes, setBoxes] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingBox, setEditingBox] = useState<any>(null)
  const [expandedBox, setExpandedBox] = useState<string | null>(null)
  const [boxShares, setBoxShares] = useState<Record<string, any>>({})
  const [sharesLoading, setSharesLoading] = useState<string | null>(null)
  const [expandedJoiner, setExpandedJoiner] = useState<string | null>(null)
  const [excludedJoiners, setExcludedJoiners] = useState<Record<string, Set<string>>>({})

  function toggleExclude(boxId: string, joinerId: string) {
    setExcludedJoiners(prev => {
      const current = new Set(prev[boxId] || [])
      current.has(joinerId) ? current.delete(joinerId) : current.add(joinerId)
      return { ...prev, [boxId]: current }
    })
    fetch(`/api/boxes/${boxId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'exclude', joiner_id: joinerId, excluded: !((excludedJoiners[boxId] || new Set()).has(joinerId)) }),
    })
  }
  const [form, setForm] = useState({
    label: '',
    ems_total_eur: '', ems_total_krw: '',
    customs_total_eur: '', customs_total_krw: '',
    ems_deadline: '', customs_deadline: '', payment_info: '',
  })
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([])
  const [itemTypeRows, setItemTypeRows] = useState<ItemTypeRow[]>([
    { id: uid(), item_type: 'photocard', custom_label: '', weight_g: '' }
  ])
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [b, o] = await Promise.all([
      fetch('/api/boxes').then(r => r.json()),
      fetch('/api/orders').then(r => r.json()),
    ])
    setBoxes(Array.isArray(b) ? b : [])
    setOrders(Array.isArray(o) ? o : [])
    setLoading(false)
  }, [])
  useEffect(() => { fetchData() }, [fetchData])

  async function loadShares(boxId: string) {
    setSharesLoading(boxId)
    const res = await fetch(`/api/boxes/${boxId}`).then(r => r.json())
    setBoxShares(prev => ({ ...prev, [boxId]: res }))
    if (res.joiners) {
      const excludedSet = new Set<string>(res.joiners.filter((j: any) => j.excluded).map((j: any) => j.joiner_id))
      setExcludedJoiners(prev => ({ ...prev, [boxId]: excludedSet }))
    }
    setSharesLoading(null)
  }

  async function toggleExpand(boxId: string) {
    if (expandedBox === boxId) { setExpandedBox(null); return }
    setExpandedBox(boxId)
    if (!boxShares[boxId]) await loadShares(boxId)
  }

  async function togglePaid(boxId: string, joinerId: string, field: 'ems_paid' | 'customs_paid', current: boolean) {
    await fetch(`/api/boxes/${boxId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ joiner_id: joinerId, field, value: !current }),
    })
    setBoxShares(prev => ({
      ...prev,
      [boxId]: {
        ...prev[boxId],
        joiners: (prev[boxId]?.joiners || []).map((s: any) =>
          s.joiner_id === joinerId ? { ...s, [field]: !current } : s
        ),
      },
    }))
  }

  function openNew() {
    setEditingBox(null)
    setForm({ label: '', ems_total_eur: '', ems_total_krw: '', customs_total_eur: '', customs_total_krw: '', ems_deadline: '', customs_deadline: '', payment_info: '' })
    setSelectedOrderIds([])
    setItemTypeRows([{ id: uid(), item_type: 'photocard', custom_label: '', weight_g: '' }])
    setModalOpen(true)
  }

  function openEdit(box: any) {
    setEditingBox(box)
    setForm({
      label: box.label || '',
      ems_total_eur: String(box.ems_total_eur || ''),
      ems_total_krw: String(box.ems_total_krw || ''),
      customs_total_eur: String(box.customs_total_eur || ''),
      customs_total_krw: String(box.customs_total_krw || ''),
      ems_deadline: box.ems_deadline?.slice(0, 16) || '',
      payment_info: box.payment_info || '',
      customs_deadline: box.customs_deadline?.slice(0, 16) || '',
    })
    setSelectedOrderIds((box.linked_orders || []).map((o: any) => o.order_id || o.id))
    setItemTypeRows(
      (box.item_types || []).map((it: any) => ({
        id: uid(), item_type: it.item_type, custom_label: it.custom_label || '', weight_g: String(it.weight_g || '')
      }))
    )
    if (itemTypeRows.length === 0) setItemTypeRows([{ id: uid(), item_type: 'photocard', custom_label: '', weight_g: '' }])
    setModalOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    const payload = {
      label: form.label || null,
      order_ids: selectedOrderIds,
      ems_total_eur: parseFloat(form.ems_total_eur) || 0,
      ems_total_krw: parseFloat(form.ems_total_krw) || 0,
      customs_total_eur: parseFloat(form.customs_total_eur) || 0,
      customs_total_krw: parseFloat(form.customs_total_krw) || 0,
      ems_deadline: form.ems_deadline || null,
      payment_info: form.payment_info || null,
      customs_deadline: form.customs_deadline || null,
      item_types: itemTypeRows
        .filter(r => r.weight_g)
        .map(r => ({ item_type: r.item_type, custom_label: r.custom_label || null, weight_g: parseFloat(r.weight_g) || 0 })),
    }
    if (editingBox) {
      await fetch('/api/boxes', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editingBox.id, ...payload }) })
      if (expandedBox === editingBox.id) await loadShares(editingBox.id)
    } else {
      await fetch('/api/boxes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    }
    setModalOpen(false); setEditingBox(null); fetchData(); setSaving(false)
  }

  async function handleDelete(boxId: string) {
    if (!confirm('Delete this box?')) return
    await fetch('/api/boxes', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: boxId }) })
    if (expandedBox === boxId) setExpandedBox(null)
    setBoxShares(prev => { const n = { ...prev }; delete n[boxId]; return n })
    fetchData()
  }

  function toggleOrderId(id: string) {
    setSelectedOrderIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  function updateItemRow(id: string, field: keyof ItemTypeRow, value: string) {
    setItemTypeRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  const orderLabel = (o: any) =>
    `${o.shop?.name || '?'}${o.round_number ? ` #${o.round_number}` : ''}${o.group?.name ? ` · ${o.group.name}` : ''}`

  function PaidBtn({ paid, onClick }: { paid: boolean; onClick: (e: any) => void }) {
    return (
      <button onClick={(e) => { e.stopPropagation(); onClick(e) }} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${paid ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800' : 'bg-background text-muted-foreground border-border hover:border-primary/40'}`}>
        {paid ? <Check size={10}/> : <X size={10}/>} {paid ? 'Paid' : 'Unpaid'}
      </button>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Boxes" subtitle="Multi-order boxes with weight-based EMS & customs sharing" action={<Button onClick={openNew}><Plus size={14}/> New Box</Button>} />

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-4">
        {loading
          ? <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>
          : boxes.length === 0
            ? <EmptyState icon={Box} title="No boxes yet" action={<Button onClick={openNew}><Plus size={14}/> New Box</Button>} />
            : boxes.map(box => {
                const shares = boxShares[box.id]
                const isExpanded = expandedBox === box.id
                const totalEur = parseFloat(box.ems_total_eur || 0) + parseFloat(box.customs_total_eur || 0)
                const totalKrw = parseFloat(box.ems_total_krw || 0) + parseFloat(box.customs_total_krw || 0)

                return (
                  <Card key={box.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-display font-semibold">{box.label || 'Box'}</p>
                          {box.payment_info && (
                            <div className="mt-2 border border-primary/20 bg-primary/5 rounded-xl px-3 py-2">
                              <p className="text-xs font-bold text-primary uppercase tracking-wide mb-0.5">💳 Payment Info</p>
                              <p className="text-xs whitespace-pre-wrap text-muted-foreground">{box.payment_info}</p>
                            </div>
                          )}
                          {/* Linked orders */}
                          {(box.linked_orders || []).length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                              {(box.linked_orders || []).map((o: any) => (
                                <Badge key={o.order_id || o.id} className="bg-secondary text-secondary-foreground border border-border text-xs">
                                  {o.shop?.name || '?'}{o.round_number ? ` #${o.round_number}` : ''}
                                </Badge>
                              ))}
                            </div>
                          )}
                          {/* Item type weights */}
                          {(box.item_types || []).length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                              {(box.item_types as any[]).map((it: any, i: number) => (
                                <span key={i} className="text-xs text-muted-foreground bg-secondary/50 px-2 py-0.5 rounded-full">
                                  {ITEM_TYPES.find(t => t.value === it.item_type)?.label?.split(' ')[1] || it.custom_label || it.item_type}: {it.weight_g}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(box)}><Pencil size={13}/></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(box.id)}><Trash2 size={13} className="text-destructive/50 hover:text-destructive"/></Button>
                          <button onClick={() => toggleExpand(box.id)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors">
                            {isExpanded ? <ChevronUp size={13}/> : <ChevronDown size={13}/>} Shares
                          </button>
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent>
                      {/* Fee totals */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">EMS</p>
                          <p className="text-lg font-semibold">{formatEur(box.ems_total_eur)}</p>
                          <p className="text-xs text-muted-foreground">{formatKrw(box.ems_total_krw)}</p>
                          {box.ems_deadline && <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mt-1">Due {new Date(box.ems_deadline).toLocaleDateString()}</p>}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Customs</p>
                          <p className="text-lg font-semibold">{formatEur(box.customs_total_eur)}</p>
                          <p className="text-xs text-muted-foreground">{formatKrw(box.customs_total_krw)}</p>
                          {box.customs_deadline && <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mt-1">Due {new Date(box.customs_deadline).toLocaleDateString()}</p>}
                        </div>
                        <div className="border-l border-border pl-4">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Total</p>
                          <p className="text-lg font-bold text-primary">{formatEur(totalEur)}</p>
                          <p className="text-xs text-muted-foreground">{formatKrw(totalKrw)}</p>
                        </div>
                      </div>

                      {/* Joiner shares panel */}
                      {isExpanded && (
                        <div className="mt-5 pt-4 border-t border-border">
                          <div className="flex items-center justify-between mb-3 gap-3">
                            <p className="text-sm font-semibold">Joiner Shares <span className="text-xs text-muted-foreground font-normal">— by item weight</span></p>
                            {shares && (
                              <div className="flex gap-2 flex-shrink-0">
                                <button
                                  onClick={async () => {
                                    if (shares?.ems_payment_requested) return
                                    const excluded = excludedJoiners[box.id] || new Set()
                                    const totalW = shares.joiners.filter((j: any) => !excluded.has(j.joiner_id)).reduce((s: number, j: any) => s + (j.weight_g || 0), 0)
                                    const emsTotal = parseFloat(box.ems_total_eur || 0)
                                    const joiner_shares = shares.joiners
                                      .filter((j: any) => !excluded.has(j.joiner_id))
                                      .map((j: any) => ({
                                        joiner_id: j.joiner_id,
                                        ems_amount_eur: totalW > 0 ? Math.ceil((emsTotal * j.weight_g / totalW) * 100) / 100 : 0,
                                      }))
                                    await fetch(`/api/boxes/${box.id}`, {
                                      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ action: 'publish_ems', joiner_shares }),
                                    })
                                    await loadShares(box.id)
                                  }}
                                  disabled={shares?.ems_payment_requested}
                                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${shares?.ems_payment_requested ? 'bg-emerald-50 text-emerald-700 border-emerald-200 cursor-default' : 'bg-primary text-primary-foreground border-primary hover:opacity-90'}`}
                                >
                                  {shares?.ems_payment_requested ? '✓ EMS sent' : '💸 Ask EMS'}
                                </button>
                                <button
                                  onClick={async () => {
                                    if (shares?.customs_payment_requested) return
                                    const excluded = excludedJoiners[box.id] || new Set()
                                    const totalW = shares.joiners.filter((j: any) => !excluded.has(j.joiner_id)).reduce((s: number, j: any) => s + (j.weight_g || 0), 0)
                                    const customsTotal = parseFloat(box.customs_total_eur || 0)
                                    const joiner_shares = shares.joiners
                                      .filter((j: any) => !excluded.has(j.joiner_id))
                                      .map((j: any) => ({
                                        joiner_id: j.joiner_id,
                                        customs_amount_eur: totalW > 0 ? Math.ceil((customsTotal * j.weight_g / totalW) * 100) / 100 : 0,
                                      }))
                                    await fetch(`/api/boxes/${box.id}`, {
                                      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ action: 'publish_customs', joiner_shares }),
                                    })
                                    await loadShares(box.id)
                                  }}
                                  disabled={shares?.customs_payment_requested}
                                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${shares?.customs_payment_requested ? 'bg-emerald-50 text-emerald-700 border-emerald-200 cursor-default' : 'bg-sky-600 text-white border-sky-600 hover:opacity-90'}`}
                                >
                                  {shares?.customs_payment_requested ? '✓ Customs sent' : '🛃 Ask Customs'}
                                </button>
                              </div>
                            )}
                          </div>
                          {sharesLoading === box.id ? (
                            <div className="flex justify-center py-4"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>
                          ) : !shares?.joiners?.length ? (
                            <p className="text-sm text-muted-foreground">No items found across linked orders. Link orders with items to see shares.</p>
                          ) : (
                            <div className="rounded-xl border border-border overflow-hidden">
                              {/* Rate card */}
                              {(() => {
                                const excluded = excludedJoiners[box.id] || new Set()
                                const totalWeight = shares.joiners.reduce((sum: number, j: any) => excluded.has(j.joiner_id) ? sum : sum + (j.weight_g || 0), 0)
                                if (totalWeight === 0) return null
                                const emsTotal = parseFloat(box.ems_total_eur || 0)
                                const customsTotal = parseFloat(box.customs_total_eur || 0)
                                const emsRpg = emsTotal / totalWeight
                                const customsRpg = customsTotal / totalWeight
                                const itemTypes: any[] = shares.itemTypes || []
                                const LABELS: Record<string, string> = { photocard: 'Photocard / Inclusion', album: 'Album', photobook: 'Photobook', custom: 'Custom' }
                                if (itemTypes.length === 0) return null
                                return (
                                  <div className="px-4 py-3 bg-primary/5 border-b border-border space-y-2">
                                    {emsTotal > 0 && (
                                      <div>
                                        <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-1.5">EMS rate per unit</p>
                                        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                                          {itemTypes.map((it: any) => {
                                            const label = LABELS[it.item_type] || it.custom_label || it.item_type
                                            const wg = parseFloat(it.weight_g || 0)
                                            const rate = Math.ceil(emsRpg * wg * 100) / 100
                                            return (
                                              <div key={it.item_type} className="flex items-center gap-1.5 text-sm">
                                                <span className="text-muted-foreground">{label} ({wg}g):</span>
                                                <span className="font-bold text-blue-600 font-mono">{formatEur(rate)}</span>
                                              </div>
                                            )
                                          })}
                                          <span className="text-xs text-muted-foreground self-center">({totalWeight.toFixed(0)}g total)</span>
                                        </div>
                                      </div>
                                    )}
                                    {customsTotal > 0 && (
                                      <div>
                                        <p className="text-xs font-bold text-purple-600 uppercase tracking-widest mb-1.5">Customs rate per unit</p>
                                        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                                          {itemTypes.map((it: any) => {
                                            const label = LABELS[it.item_type] || it.custom_label || it.item_type
                                            const wg = parseFloat(it.weight_g || 0)
                                            const rate = Math.ceil(customsRpg * wg * 100) / 100
                                            return (
                                              <div key={it.item_type} className="flex items-center gap-1.5 text-sm">
                                                <span className="text-muted-foreground">{label} ({wg}g):</span>
                                                <span className="font-bold text-purple-600 font-mono">{formatEur(rate)}</span>
                                              </div>
                                            )
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )
                              })()}
                              {/* Header */}
                              <div className="overflow-x-auto">
                              <div className="min-w-max grid grid-cols-[32px_1fr_55px_55px_65px_70px_85px_80px_90px_80px] gap-2 px-4 py-2 bg-secondary/50 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                <span title="Exclude from EMS split">Excl.</span><span>Joiner</span><span>Items</span><span>Incl.</span><span>Weight</span><span>Share</span><span>EMS (€)</span><span>EMS paid</span><span>Customs (€)</span><span>Customs paid</span>
                              </div>
                              {(() => {
                                const excluded = excludedJoiners[box.id] || new Set()
                                const totalWeight = shares.joiners.reduce((sum: number, j: any) => excluded.has(j.joiner_id) ? sum : sum + (j.weight_g || 0), 0)
                                const emsTotal = parseFloat(box.ems_total_eur || 0)
                                return shares.joiners.map((s: any, i: number) => {
                                  const isExcluded = excluded.has(s.joiner_id)
                                  const joinerWeight = s.weight_g || 0
                                  const sharePercent = !isExcluded && totalWeight > 0 ? ((joinerWeight / totalWeight) * 100).toFixed(1) : '—'
                                  const emsShare = !isExcluded && totalWeight > 0 ? Math.ceil((emsTotal * joinerWeight / totalWeight) * 100) / 100 : 0
                                  return (
                                  <div key={s.joiner_id}>
                                  <div
                                    className={`grid grid-cols-[32px_1fr_55px_55px_65px_70px_85px_80px_90px_80px] gap-2 px-4 py-3 items-center text-sm cursor-pointer hover:bg-primary/5 transition-colors ${isExcluded ? 'opacity-40' : i % 2 === 0 ? '' : 'bg-secondary/20'}`}
                                    onClick={() => setExpandedJoiner(expandedJoiner === `${box.id}-${s.joiner_id}` ? null : `${box.id}-${s.joiner_id}`)}
                                  >
                                    <span onClick={e => { e.stopPropagation(); toggleExclude(box.id, s.joiner_id) }} className="flex items-center justify-center">
                                      <input type="checkbox" readOnly checked={isExcluded} className="w-3.5 h-3.5 accent-primary cursor-pointer" title="Exclude from EMS split"/>
                                    </span>
                                    <span className="font-semibold flex items-center gap-1.5">
                                      {expandedJoiner === `${box.id}-${s.joiner_id}` ? <ChevronUp size={12} className="text-primary"/> : <ChevronDown size={12} className="text-muted-foreground"/>}
                                      {s.display_name || s.username}
                                    </span>
                                    <span className="text-muted-foreground">{s.item_count}</span>
                                    <span className="text-muted-foreground">{s.total_inclusions || 0}</span>
                                    <span className="font-mono text-xs">{joinerWeight.toFixed(0)}g</span>
                                    <span className={`text-xs font-semibold ${isExcluded ? 'text-muted-foreground' : 'text-primary'}`}>{sharePercent}{!isExcluded && '%'}</span>
                                    <span className="font-mono text-sm">{isExcluded ? <span className="text-muted-foreground/50">—</span> : formatEur(emsShare)}</span>
                                    <span className="flex items-center gap-1">
                                      {s.proof_url && !s.ems_paid && <span title="Proof submitted" className="text-amber-500 text-xs">📎</span>}
                                      <PaidBtn paid={s.ems_paid} onClick={(e) => { e.stopPropagation(); togglePaid(box.id, s.joiner_id, 'ems_paid', s.ems_paid) }}/>
                                    </span>
                                    <span className="font-mono text-sm">{formatEur(s.customs_share_eur)}</span>
                                    <span><PaidBtn paid={s.customs_paid} onClick={(e) => { e.stopPropagation(); togglePaid(box.id, s.joiner_id, 'customs_paid', s.customs_paid) }}/></span>
                                  </div>
                                {expandedJoiner === `${box.id}-${s.joiner_id}` && s.items?.length > 0 && (
                                  <div className="px-5 pb-4 bg-primary/[0.02] border-t border-primary/10">
                                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider pt-3 mb-3">Items</p>
                                    {(() => {
                                      const excluded = excludedJoiners[box.id] || new Set()
                                      const totalWeight = shares.joiners.reduce((sum: number, j: any) => excluded.has(j.joiner_id) ? sum : sum + (j.weight_g || 0), 0)
                                      const joinerWeight = s.weight_g || 0
                                      const isExcluded = excluded.has(s.joiner_id)
                                      const ceil2 = (n: number) => Math.ceil(n * 100) / 100

                                      // EMS — use locked amount if published
                                      const emsRequested = shares.ems_payment_requested
                                      const lockedEms = s.ems_amount_eur != null ? parseFloat(s.ems_amount_eur) : null
                                      // Always compute EMS share for GOM (use locked if published, else live)
                                      const emsShare = lockedEms ?? (!isExcluded && totalWeight > 0 ? ceil2(parseFloat(box.ems_total_eur || 0) * joinerWeight / totalWeight) : 0)
                                      const emsRate = joinerWeight > 0 ? emsShare / joinerWeight : 0

                                      // Customs — show as preview before asking, and as locked after
                                      const customsRequested = shares.customs_payment_requested
                                      const showCustomsBreakdown = parseFloat(box.customs_total_eur || 0) > 0
                                      const lockedCustoms = s.customs_amount_eur != null ? parseFloat(s.customs_amount_eur) : null
                                      const customsShare = showCustomsBreakdown ? (customsRequested ? (lockedCustoms ?? ceil2(parseFloat(box.customs_total_eur || 0) * joinerWeight / (totalWeight || 1))) : ceil2(parseFloat(box.customs_total_eur || 0) * joinerWeight / (totalWeight || 1))) : 0
                                      const customsRate = joinerWeight > 0 ? customsShare / joinerWeight : 0

                                      const groups: Record<string, { shop: string; desc: string; members: string[]; qty: number; inclusions: number; weight_g: number }> = {}
                                      for (const it of s.items) {
                                        const key = `${it.shop_name || '?'}__${it.round_number || ''}__${it.description || it.item_type}`
                                        if (!groups[key]) groups[key] = { shop: (it.shop_name || '?') + (it.round_number ? ' #' + it.round_number : ''), desc: it.description || it.item_type, members: [], qty: 0, inclusions: 0, weight_g: 0 }
                                        if (it.member_name && !groups[key].members.includes(it.member_name)) groups[key].members.push(it.member_name)
                                        groups[key].qty += it.amount_claimed || 1
                                        // inclusions_count is per-row total, not per-member — only set from first row
                                        if (groups[key].inclusions === 0) groups[key].inclusions = it.inclusions_count || 0
                                        groups[key].weight_g += it.weight_g || 0
                                      }
                                      return (
                                        <div className="space-y-3">
                                          {Object.entries(groups).map(([key, g]) => {
                                            const totalPcs = g.qty + g.inclusions
                                            const groupEms = emsRate * (g.weight_g || 0)
                                            const groupCustoms = (showCustomsBreakdown ? customsRate : 0) * (g.weight_g || 0)
                                            const emsPc = totalPcs > 0 ? groupEms / totalPcs : 0
                                            const customsPc = totalPcs > 0 ? groupCustoms / totalPcs : 0
                                            const pcLabel = g.inclusions > 0
                                              ? `${g.qty} + ${g.inclusions} incl. = ${totalPcs} PCs`
                                              : `${g.qty} PC${g.qty !== 1 ? 's' : ''}`
                                            return (
                                            <div key={key} className="space-y-1">
                                              <p className="text-xs font-semibold text-muted-foreground">{g.shop}</p>
                                              <div className="flex items-start gap-2 flex-wrap">
                                                <div className="flex-1 min-w-0">
                                                  <span className="text-sm font-medium">{g.desc}</span>
                                                  {g.members.length > 0 && (
                                                    <span className="ml-2">{g.members.map(m => (
                                                      <span key={m} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20 mr-1">{m}</span>
                                                    ))}</span>
                                                  )}
                                                  {g.members.length === 0 && g.qty > 1 && <span className="text-xs text-muted-foreground ml-1">×{g.qty}</span>}
                                                </div>
                                                <div className="flex gap-3 flex-shrink-0 text-xs font-semibold">
                                                  {emsShare > 0 && groupEms > 0 && (
                                                    <span className={emsRequested ? 'text-blue-600' : 'text-blue-400 italic'} title={emsRequested ? undefined : 'Preview — not yet sent to joiners'}>
                                                      EMS{!emsRequested && ' (preview)'} {pcLabel} × {formatEur(emsPc)} = <span className="font-bold">{formatEur(groupEms)}</span>
                                                    </span>
                                                  )}
                                                  {showCustomsBreakdown && groupCustoms > 0 && (
                                                    <span className={customsRequested ? 'text-purple-600' : 'text-purple-400 italic'} title={customsRequested ? undefined : 'Preview — not yet sent to joiners'}>
                                                      Customs{!customsRequested && ' (preview)'} {pcLabel} × {formatEur(customsPc)} = <span className="font-bold">{formatEur(groupCustoms)}</span>
                                                    </span>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          )})}
                                        </div>
                                      )
                                    })()}
                                  </div>
                                )}
                              </div>
                              )
                              })
                              })()}
                              {/* Totals row */}
                              <div className="min-w-max grid grid-cols-[32px_1fr_55px_55px_65px_70px_85px_80px_90px_80px] gap-2 px-4 py-2.5 bg-secondary/50 text-xs font-semibold border-t border-border">
                                <span/>
                                <span>Total{(excludedJoiners[box.id]?.size || 0) > 0 && <span className="text-amber-600 font-normal ml-1">({excludedJoiners[box.id].size} excl.)</span>}</span>
                                <span>{shares.joiners.reduce((s: number, j: any) => s + j.item_count, 0)}</span>
                                <span>{shares.joiners.reduce((s: number, j: any) => s + (j.total_inclusions || 0), 0)}</span>
                                <span className="font-mono text-xs">{shares.joiners.reduce((s: number, j: any) => s + (j.weight_g || 0), 0).toFixed(0)}g</span>
                                <span className="font-mono">{formatEur(parseFloat(box.ems_total_eur))}</span>
                                <span className="text-muted-foreground">{shares.joiners.filter((j: any) => j.ems_paid).length}/{shares.joiners.length}</span>
                                <span className="font-mono">{formatEur(parseFloat(box.customs_total_eur))}</span>
                                <span className="text-muted-foreground">{shares.joiners.filter((j: any) => j.customs_paid).length}/{shares.joiners.length}</span>
                              </div>
                              </div>{/* end overflow-x-auto */}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })
        }
      </div>

      {/* Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingBox ? 'Edit Box' : 'New Box'} size="xl">
        <div className="space-y-5">

          <FormField label="Label">
            <Input placeholder="e.g. Box 1 — Weverse Shop July" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
          </FormField>

          {/* Linked orders — multi-select */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Linked Orders</p>
            <div className="border border-border rounded-xl p-3 max-h-48 overflow-y-auto space-y-1">
              {orders.length === 0
                ? <p className="text-sm text-muted-foreground">No orders found.</p>
                : orders.map((o: any) => (
                    <label key={o.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-secondary/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedOrderIds.includes(o.id)}
                        onChange={() => toggleOrderId(o.id)}
                        className="accent-primary w-4 h-4 rounded"
                      />
                      <span className="text-sm">{orderLabel(o)}</span>
                      <span className="text-xs text-muted-foreground ml-auto capitalize">{o.status?.replace(/_/g, ' ')}</span>
                    </label>
                  ))
              }
            </div>
            {selectedOrderIds.length > 0 && (
              <p className="text-xs text-primary font-medium">{selectedOrderIds.length} order{selectedOrderIds.length > 1 ? 's' : ''} selected</p>
            )}
          </div>

          {/* Item type weights */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Item Weights</p>
              <button onClick={() => setItemTypeRows(prev => [...prev, { id: uid(), item_type: 'photocard', custom_label: '', weight_g: '' }])}
                className="text-xs text-primary hover:underline font-semibold flex items-center gap-1">
                <Plus size={12}/> Add type
              </button>
            </div>
            <div className="grid grid-cols-[180px_1fr_80px_28px] gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">
              <span>Type</span><span>Custom label</span><span>Weight (g)</span><span/>
            </div>
            {itemTypeRows.map(row => (
              <div key={row.id} className="grid grid-cols-[180px_1fr_80px_28px] gap-2 items-center">
                <Select
                  options={ITEM_TYPES}
                  value={row.item_type}
                  onChange={e => updateItemRow(row.id, 'item_type', e.target.value)}
                />
                <Input
                  placeholder={row.item_type === 'custom' ? 'e.g. Poster' : '—'}
                  disabled={row.item_type !== 'custom'}
                  value={row.custom_label}
                  onChange={e => updateItemRow(row.id, 'custom_label', e.target.value)}
                  className={row.item_type !== 'custom' ? 'opacity-30' : ''}
                />
                <Input
                  type="number" placeholder="0"
                  value={row.weight_g}
                  onChange={e => updateItemRow(row.id, 'weight_g', e.target.value)}
                />
                <button onClick={() => setItemTypeRows(prev => prev.filter(r => r.id !== row.id))}
                  disabled={itemTypeRows.length === 1}
                  className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-20">
                  <X size={14}/>
                </button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">EMS & customs shares are split by each joiner's total item weight.</p>
          </div>

          {/* EMS fees */}
          <div className="border border-border rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold">EMS Fees</p>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Amount (€)"><Input type="number" placeholder="0.00" value={form.ems_total_eur} onChange={e => setForm(f => ({ ...f, ems_total_eur: e.target.value }))}/></FormField>
              <FormField label="Amount (₩)"><Input type="number" placeholder="0" value={form.ems_total_krw} onChange={e => setForm(f => ({ ...f, ems_total_krw: e.target.value }))}/></FormField>
            </div>
            <FormField label="EMS Payment Deadline"><Input type="datetime-local" value={form.ems_deadline} onChange={e => setForm(f => ({ ...f, ems_deadline: e.target.value }))}/></FormField>
          </div>

          {/* Customs fees */}
          <div className="border border-border rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold">Customs Fees</p>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Amount (€)"><Input type="number" placeholder="0.00" value={form.customs_total_eur} onChange={e => setForm(f => ({ ...f, customs_total_eur: e.target.value }))}/></FormField>
              <FormField label="Amount (₩)"><Input type="number" placeholder="0" value={form.customs_total_krw} onChange={e => setForm(f => ({ ...f, customs_total_krw: e.target.value }))}/></FormField>
            </div>
            <FormField label="Customs Payment Deadline"><Input type="datetime-local" value={form.customs_deadline} onChange={e => setForm(f => ({ ...f, customs_deadline: e.target.value }))}/></FormField>
            <FormField label="Payment Info">
              <p className="text-xs text-muted-foreground mb-1.5">Shown to joiners in the Boxes tab (bank details, PayPal, etc.)</p>
              <textarea className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30" rows={3} value={form.payment_info} onChange={e=>setForm(f=>({...f,payment_info:e.target.value}))} placeholder="e.g. PayPal: gom@example.com"/>
            </FormField>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : editingBox ? 'Update Box' : 'Save Box'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
