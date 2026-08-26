'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus, Music, Trash2, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, Check, Clock, Zap, Repeat, Shuffle } from 'lucide-react'
import { Button, Card, CardContent, CardHeader, Modal, Input, Select, FormField, PageHeader, EmptyState, Badge } from '@/components/ui'
import { formatDate, formatDateTime } from '@/lib/utils'

function orderLabel(o: any) {
  return [o.group?.name, o.round_number ? `R${o.round_number}` : null, o.shop?.name].filter(Boolean).join(' · ') || o.id?.slice(0, 8)
}

export default function GomPcSorterPage() {
  const [sessions, setSessions] = useState<any[]>([])
  const [groups, setGroups] = useState<any[]>([])
  const [boxes, setBoxes] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [createModal, setCreateModal] = useState(false)
  const [form, setForm] = useState({ title: '', group_id: '', box_id: '', deadline: '' })
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([])

  const [editingSession, setEditingSession] = useState<any>(null)
  const [editForm, setEditForm] = useState({ title: '', group_id: '', deadline: '', box_id: '' })
  const [editOrderIds, setEditOrderIds] = useState<string[]>([])

  const [expandedSession, setExpandedSession] = useState<string | null>(null)
  const [sessionDetails, setSessionDetails] = useState<Record<string, any>>({})
  const [newPackName, setNewPackName] = useState<Record<string, string>>({})
  const [newItemName, setNewItemName] = useState<Record<string, string>>({})
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, Record<string, string>>>({}) // item_id -> member_id -> value

  const [inclusionsModal, setInclusionsModal] = useState<string | null>(null)
  const [inclusionDrafts, setInclusionDrafts] = useState<Record<string, Record<string, string>>>({}) // joiner_id -> pack_id -> value

  const [sortModal, setSortModal] = useState<string | null>(null)
  const [sortMethod, setSortMethod] = useState<'timestamp' | 'fair'>('fair')
  const [sortRunning, setSortRunning] = useState(false)
  const [lastSortResult, setLastSortResult] = useState<Record<string, any>>({})

  const [ownershipModal, setOwnershipModal] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [s, g, b, o] = await Promise.all([
      fetch('/api/pc-sorter').then(r => r.json()),
      fetch('/api/groups').then(r => r.json()),
      fetch('/api/boxes').then(r => r.json()),
      fetch('/api/orders?lite=true').then(r => r.json()),
    ])
    setSessions(Array.isArray(s) ? s : [])
    setGroups(Array.isArray(g) ? g : [])
    setBoxes(Array.isArray(b) ? b : [])
    setOrders(Array.isArray(o) ? o.filter((x: any) => x.status !== 'closed') : [])
    setLoading(false)
  }, [])
  useEffect(() => { fetchData() }, [fetchData])

  async function loadDetails(sessionId: string) {
    const d = await fetch(`/api/pc-sorter/${sessionId}`).then(r => r.json())
    setSessionDetails(prev => ({ ...prev, [sessionId]: d }))
    const qd: Record<string, Record<string, string>> = {}
    for (const item of d.items || []) {
      qd[item.id] = {}
      for (const q of (d.quantities || []).filter((x: any) => x.item_id === item.id)) {
        qd[item.id][q.member_id] = String(q.total_pulled)
      }
    }
    setQtyDrafts(qd)
    const inc: Record<string, Record<string, string>> = {}
    for (const i of d.inclusions || []) {
      if (!inc[i.joiner_id]) inc[i.joiner_id] = {}
      inc[i.joiner_id][i.pack_id] = String(i.inclusions_assigned)
    }
    setInclusionDrafts(inc)
    return d
  }

  async function toggleExpand(sessionId: string) {
    if (expandedSession === sessionId) { setExpandedSession(null); return }
    setExpandedSession(sessionId)
    await loadDetails(sessionId)
  }

  function onBoxChange(boxId: string, setIds: (ids: string[]) => void, setF: (fn: any) => void) {
    setF((f: any) => ({ ...f, box_id: boxId }))
    if (!boxId) { setIds([]); return }
    const box = boxes.find((b: any) => b.id === boxId)
    const linkedIds: string[] = (box?.linked_orders || []).map((o: any) => o.order_id || o.id).filter(Boolean)
    setIds(linkedIds)
  }

  const boxLinkedOrderIds = (boxId: string) =>
    boxId ? (boxes.find((b: any) => b.id === boxId)?.linked_orders || []).map((o: any) => o.order_id || o.id).filter(Boolean) : []

  async function handleCreate() {
    if (!form.title) return
    setSaving(true)
    await fetch('/api/pc-sorter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: form.title,
        group_id: form.group_id || null,
        box_id: form.box_id || null,
        deadline: form.deadline || null,
        order_ids: selectedOrderIds.length > 0 ? selectedOrderIds : null,
      }),
    })
    setCreateModal(false)
    setForm({ title: '', group_id: '', box_id: '', deadline: '' })
    setSelectedOrderIds([])
    await fetchData()
    setSaving(false)
  }

  async function handleEdit() {
    if (!editingSession) return
    setSaving(true)
    await fetch('/api/pc-sorter', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingSession.id,
        title: editForm.title,
        group_id: editForm.group_id || null,
        deadline: editForm.deadline || null,
        box_id: editForm.box_id || null,
        order_ids: editOrderIds.length > 0 ? editOrderIds : null,
      }),
    })
    setEditingSession(null)
    await fetchData()
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this session? This removes all its packs, items, forms, and results.')) return
    await fetch('/api/pc-sorter', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    await fetchData()
  }

  async function toggleFormOpen(s: any) {
    await fetch('/api/pc-sorter', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id, form_open: !s.form_open }),
    })
    await fetchData()
  }

  async function addPack(sessionId: string) {
    const name = (newPackName[sessionId] || '').trim()
    if (!name) return
    await fetch(`/api/pc-sorter/${sessionId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ add_pack: { name } }),
    })
    setNewPackName(p => ({ ...p, [sessionId]: '' }))
    await loadDetails(sessionId)
  }

  async function deletePack(sessionId: string, packId: string) {
    if (!confirm('Delete this pack and all its items?')) return
    await fetch(`/api/pc-sorter/${sessionId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete_pack: { pack_id: packId } }),
    })
    await loadDetails(sessionId)
  }

  async function addItem(sessionId: string, packId: string) {
    const name = (newItemName[packId] || '').trim()
    if (!name) return
    await fetch(`/api/pc-sorter/${sessionId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ add_item: { pack_id: packId, name } }),
    })
    setNewItemName(p => ({ ...p, [packId]: '' }))
    await loadDetails(sessionId)
  }

  async function deleteItem(sessionId: string, itemId: string) {
    if (!confirm('Delete this item?')) return
    await fetch(`/api/pc-sorter/${sessionId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete_item: { item_id: itemId } }),
    })
    await loadDetails(sessionId)
  }

  async function saveQuantities(sessionId: string, itemId: string, members: any[]) {
    const quantities = members.map(m => ({ member_id: m.id, total_pulled: parseInt(qtyDrafts[itemId]?.[m.id] || '0') || 0 }))
    await fetch(`/api/pc-sorter/${sessionId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ update_quantities: { item_id: itemId, quantities } }),
    })
    await loadDetails(sessionId)
  }

  async function autoFillInclusions(sessionId: string) {
    setSaving(true)
    await fetch(`/api/pc-sorter/${sessionId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_fill_inclusions: true }),
    })
    await loadDetails(sessionId)
    setSaving(false)
  }

  async function saveInclusions(sessionId: string, packs: any[]) {
    setSaving(true)
    const rows: any[] = []
    for (const [joinerId, byPack] of Object.entries(inclusionDrafts)) {
      for (const p of packs) {
        const v = parseInt(byPack[p.id] || '0') || 0
        if (v > 0) rows.push({ joiner_id: joinerId, pack_id: p.id, inclusions_assigned: v })
      }
    }
    await fetch(`/api/pc-sorter/${sessionId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inclusions: rows }),
    })
    await loadDetails(sessionId)
    setInclusionsModal(null)
    setSaving(false)
  }

  async function runSort(sessionId: string) {
    setSortRunning(true)
    const res = await fetch(`/api/pc-sorter/${sessionId}/sort`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: sortMethod }),
    }).then(r => r.json())
    setLastSortResult(p => ({ ...p, [sessionId]: res }))
    setSortRunning(false)
    setSortModal(null)
    await loadDetails(sessionId)
    await fetchData()
  }

  const inclusionJoiners = (d: any) => {
    const seen = new Set<string>()
    const list: any[] = []
    for (const i of d?.inclusions || []) {
      if (!seen.has(i.joiner_id)) { seen.add(i.joiner_id); list.push(i) }
    }
    for (const f of d?.forms || []) {
      if (!seen.has(f.joiner_id)) { seen.add(f.joiner_id); list.push(f) }
    }
    return list
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Sorting"
        subtitle="Create sessions, build packs of items, and run the sort"
        action={<Button onClick={() => setCreateModal(true)}><Plus size={14} /> New Session</Button>}
      />

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-4">
        {loading ? <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
        : sessions.length === 0 ? <EmptyState icon={Music} title="No sessions yet" action={<Button onClick={() => setCreateModal(true)}><Plus size={14} /> New Session</Button>} />
        : sessions.map(s => {
            const isOpen = expandedSession === s.id
            const d = sessionDetails[s.id]
            const packs: any[] = d?.packs || []
            const lastSort = lastSortResult[s.id]

            return (
              <Card key={s.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-display font-semibold">{s.title}</p>
                        <Badge className={`text-xs ${s.form_open ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-secondary text-muted-foreground border border-border'}`}>
                          {s.form_open ? 'Form open' : 'Form closed'}
                        </Badge>
                        {s.deadline && <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${new Date(s.deadline) < new Date() ? 'bg-destructive/10 text-destructive border-destructive/20' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>⏱ {formatDate(s.deadline)}</span>}
                        {s.box?.label && <Badge className="bg-sky-50 text-sky-700 border border-sky-200 text-xs">📦 {s.box.label}</Badge>}
                        {s.sort_method && <Badge className="bg-primary/10 text-primary border border-primary/20 text-xs">{s.sort_method === 'timestamp' ? <><Clock size={10} className="inline mr-0.5" />Timestamp</> : <><Zap size={10} className="inline mr-0.5" />Fair</>} sorted</Badge>}
                      </div>
                      {s.group?.name && <p className="text-xs text-muted-foreground mt-0.5">{s.group.name}</p>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Button
                        variant={s.form_open ? 'outline' : 'default'}
                        size="sm"
                        onClick={() => toggleFormOpen(s)}
                        title={s.sort_run_at ? 'Sort already ran — reopening lets joiners resubmit before you sort again' : ''}
                      >
                        {s.form_open ? <><ToggleRight size={14} /> Close form</> : <><ToggleLeft size={14} /> Open form</>}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={async () => {
                        setEditForm({ title: s.title, group_id: s.group_id || '', deadline: s.deadline?.slice(0, 16) || '', box_id: s.box_id || '' })
                        const savedIds = (() => { try { const o = s.order_ids; if (!o) return []; return Array.isArray(o) ? o : JSON.parse(o) } catch { return [] } })()
                        setEditOrderIds(savedIds.length > 0 ? savedIds : boxLinkedOrderIds(s.box_id))
                        setEditingSession(s)
                      }}>Edit</Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(s.id)}><Trash2 size={13} className="text-destructive/50" /></Button>
                      <button onClick={() => toggleExpand(s.id)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary px-2 py-1.5 rounded-lg hover:bg-secondary">
                        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Details
                      </button>
                    </div>
                  </div>
                </CardHeader>

                {isOpen && (
                  <CardContent className="space-y-5">
                    {!d ? (
                      <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
                    ) : (
                      <>
                        {/* Packs & Items */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Packs & items</p>
                            <div className="flex items-center gap-1.5">
                              <Input placeholder="New pack name (e.g. Ver. A)" value={newPackName[s.id] || ''} onChange={e => setNewPackName(p => ({ ...p, [s.id]: e.target.value }))} className="w-48 text-xs py-1.5" />
                              <Button size="sm" variant="outline" onClick={() => addPack(s.id)}><Plus size={12} /> Add pack</Button>
                            </div>
                          </div>

                          {packs.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4 border border-dashed border-border rounded-xl">No packs yet — add one above (e.g. "Ver. A").</p>
                          ) : (
                            <div className="space-y-3">
                              {packs.map((pack: any) => {
                                const items: any[] = (d.items || []).filter((i: any) => i.pack_id === pack.id)
                                const groupMembers: any[] = groups.find((g: any) => g.id === s.group_id)?.members || []
                                return (
                                  <div key={pack.id} className="border border-border rounded-xl overflow-hidden">
                                    <div className="flex items-center justify-between px-3 py-2 bg-secondary/30 border-b border-border">
                                      <p className="text-sm font-semibold">{pack.name}</p>
                                      <button onClick={() => deletePack(s.id, pack.id)} className="text-destructive/50 hover:text-destructive"><Trash2 size={12} /></button>
                                    </div>
                                    <div className="p-3 space-y-3">
                                      <div className="flex items-center gap-1.5">
                                        <Input placeholder="New item (e.g. Photocard)" value={newItemName[pack.id] || ''} onChange={e => setNewItemName(p => ({ ...p, [pack.id]: e.target.value }))} className="text-xs py-1.5 flex-1" />
                                        <Button size="sm" variant="outline" onClick={() => addItem(s.id, pack.id)}><Plus size={11} /> Add item</Button>
                                      </div>
                                      {items.length === 0 ? (
                                        <p className="text-xs text-muted-foreground">No items in this pack yet.</p>
                                      ) : items.map((item: any) => (
                                        <div key={item.id} className="border border-border/60 rounded-lg p-2.5">
                                          <div className="flex items-center justify-between mb-2">
                                            <p className="text-xs font-bold text-primary">{item.name}</p>
                                            <button onClick={() => deleteItem(s.id, item.id)} className="text-destructive/40 hover:text-destructive"><Trash2 size={11} /></button>
                                          </div>
                                          {groupMembers.length === 0 ? (
                                            <p className="text-xs text-muted-foreground">Select a group for this session to set quantities.</p>
                                          ) : (
                                            <div className="space-y-1">
                                              {groupMembers.map((m: any) => (
                                                <div key={m.id} className="flex items-center gap-2">
                                                  <span className="text-xs flex-1">{m.name}</span>
                                                  <Input type="number" min="0" placeholder="0" value={qtyDrafts[item.id]?.[m.id] ?? ''}
                                                    onChange={e => setQtyDrafts(p => ({ ...p, [item.id]: { ...(p[item.id] || {}), [m.id]: e.target.value } }))}
                                                    className="w-20 text-xs py-1" />
                                                </div>
                                              ))}
                                              <div className="flex justify-end pt-1">
                                                <Button size="sm" variant="outline" onClick={() => saveQuantities(s.id, item.id, groupMembers)}>Save quantities</Button>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>

                        {/* Inclusions */}
                        {packs.length > 0 && (
                          <div className="flex items-center justify-between p-3 bg-secondary/30 rounded-xl">
                            <div>
                              <p className="text-sm font-semibold">Inclusions assigned</p>
                              <p className="text-xs text-muted-foreground">{(d.inclusions || []).length} joiner-pack entries set</p>
                            </div>
                            <Button size="sm" variant="outline" onClick={() => setInclusionsModal(s.id)}>Manage inclusions</Button>
                          </div>
                        )}

                        {/* Priority forms */}
                        <div>
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">
                            Priority forms ({(d.forms || []).length} submitted)
                            <button onClick={() => loadDetails(s.id)} className="ml-2 text-primary font-normal normal-case tracking-normal">↺ Refresh</button>
                          </p>
                          {(d.forms || []).length === 0 ? (
                            <p className="text-sm text-muted-foreground">No submissions yet.</p>
                          ) : (
                            <div className="space-y-2">
                              {(d.forms || []).map((f: any) => {
                                return (
                                  <div key={f.id} className="border border-border rounded-xl overflow-hidden">
                                    <div className="flex items-center justify-between px-3 py-2 bg-secondary/30">
                                      <p className="text-sm font-semibold">{f.display_name || f.username}</p>
                                      <span className="text-xs text-muted-foreground">{formatDateTime(f.submitted_at)}</span>
                                    </div>
                                    <div className="px-3 py-2 space-y-1.5">
                                      {(d.items || []).map((item: any) => {
                                        const ranked = (d.entries || [])
                                          .filter((e: any) => e.form_id === f.id && e.item_id === item.id)
                                          .sort((a: any, b: any) => a.priority - b.priority)
                                        if (!ranked.length) return null
                                        return (
                                          <div key={item.id}>
                                            <p className="text-xs font-semibold text-muted-foreground mb-0.5">{item.name}</p>
                                            <div className="flex flex-wrap gap-1">
                                              {ranked.map((r: any, idx: number) => {
                                                const memberName = (d.quantities || []).find((q: any) => q.member_id === r.member_id)?.member_name || r.member_id
                                                return (
                                                  <span key={idx} className={`text-xs px-2 py-0.5 rounded-full border font-medium ${idx === 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : idx === 1 ? 'bg-slate-50 text-slate-600 border-slate-200' : 'bg-secondary text-muted-foreground border-border'}`}>
                                                    {idx + 1}. {memberName}
                                                  </span>
                                                )
                                              })}
                                            </div>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>

                        {/* Run sort */}
                        {packs.length > 0 && (
                          <div className="p-3 border border-primary/20 bg-primary/5 rounded-xl">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-semibold">Run sort</p>
                                <p className="text-xs text-muted-foreground">
                                  {s.sort_run_at ? `Last run ${formatDateTime(s.sort_run_at)} · ${s.sort_method}` : 'Not run yet'}
                                </p>
                              </div>
                              <Button size="sm" onClick={() => setSortModal(s.id)}><Check size={12} /> Run sort</Button>
                            </div>
                            {lastSort && (
                              <p className="text-xs mt-2 text-muted-foreground">
                                Assigned {lastSort.assigned} · Unfulfilled {lastSort.unfulfilled}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Results */}
                        {(d.assignments || []).length > 0 && (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Results</p>
                              <button onClick={() => setOwnershipModal(s.id)} className="text-xs text-primary font-semibold hover:underline">View ownership</button>
                            </div>
                            <div className="space-y-1">
                              {Object.entries(
                                (d.assignments as any[]).reduce((acc: Record<string, any[]>, a: any) => {
                                  const key = a.display_name || a.username || a.joiner_id
                                  if (!acc[key]) acc[key] = []
                                  acc[key].push(a)
                                  return acc
                                }, {})
                              ).map(([joinerName, rows]: [string, any]) => (
                                <div key={joinerName} className="flex items-start gap-2 text-sm px-1">
                                  <span className="font-semibold flex-shrink-0">{joinerName}:</span>
                                  <span className="text-muted-foreground flex-wrap flex gap-x-1.5">
                                    {rows.map((r: any, i: number) => (
                                      <span key={r.id}>
                                        {r.pack_name} {r.item_name} → <span className="text-foreground font-medium">{r.member_name}</span>
                                        {r.is_repeat && <span title="Repeat — every other option was already owned"><Repeat size={10} className="inline ml-0.5 text-amber-500" /></span>}
                                        {r.is_random && <span title="Random — no priority form was submitted"><Shuffle size={10} className="inline ml-0.5 text-sky-500" /></span>}
                                        {i < rows.length - 1 ? ',' : ''}
                                      </span>
                                    ))}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                )}
              </Card>
            )
          })
        }
      </div>

      {/* Create Session Modal */}
      <Modal open={createModal} onClose={() => { setCreateModal(false); setForm({ title: '', group_id: '', box_id: '', deadline: '' }); setSelectedOrderIds([]) }} title="New Sorting Session" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <FormField label="Session Title" required>
              <Input placeholder="e.g. No Tragedy Limited" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </FormField>
            <FormField label="Form Deadline (auto-closes)">
              <Input type="datetime-local" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
            </FormField>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <FormField label="EMS/customs box" required>
              <Select options={boxes.map((b: any) => ({ value: b.id, label: b.label || 'Box' }))} placeholder="Select box…" value={form.box_id} onChange={e => onBoxChange(e.target.value, setSelectedOrderIds, setForm)} />
            </FormField>
            <FormField label="Group">
              <Select options={groups.map((g: any) => ({ value: g.id, label: g.name }))} placeholder="Select group…" value={form.group_id} onChange={e => setForm(f => ({ ...f, group_id: e.target.value }))} />
            </FormField>
          </div>
          {form.box_id && (
            <FormField label="Orders included in this session">
              <p className="text-xs text-muted-foreground mb-2">Inclusion counts will be pulled from these orders. All orders from the box are pre-selected.</p>
              <div className="border border-border rounded-xl overflow-hidden max-h-48 overflow-y-auto divide-y divide-border/50">
                {orders.filter((o: any) => boxLinkedOrderIds(form.box_id).includes(o.id)).map((o: any) => (
                  <label key={o.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-secondary/40 transition-colors">
                    <input type="checkbox" checked={selectedOrderIds.includes(o.id)}
                      onChange={() => setSelectedOrderIds(prev => prev.includes(o.id) ? prev.filter(x => x !== o.id) : [...prev, o.id])}
                      className="accent-primary w-3.5 h-3.5" />
                    <span className="text-sm">{orderLabel(o)}</span>
                  </label>
                ))}
              </div>
              {selectedOrderIds.length > 0 && <p className="text-xs text-primary font-semibold mt-1">{selectedOrderIds.length} order{selectedOrderIds.length !== 1 ? 's' : ''} selected</p>}
            </FormField>
          )}
          <p className="text-xs text-muted-foreground">After creating the session, add packs (e.g. "Ver. A") and their items, set quantities, then use "Manage inclusions" to auto-fill from these orders.</p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => { setCreateModal(false); setSelectedOrderIds([]) }}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.title || !form.box_id}>{saving ? 'Creating…' : 'Create Session'}</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Session Modal */}
      {editingSession && (() => {
        const editBoxOrders = editForm.box_id ? orders.filter((o: any) => boxLinkedOrderIds(editForm.box_id).includes(o.id)) : orders
        return (
          <Modal open={true} onClose={() => setEditingSession(null)} title="Edit Session" size="lg">
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <FormField label="Session Title" required>
                  <Input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
                </FormField>
                <FormField label="Form Deadline">
                  <Input type="datetime-local" value={editForm.deadline} onChange={e => setEditForm(f => ({ ...f, deadline: e.target.value }))} />
                </FormField>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <FormField label="Box">
                  <Select options={boxes.map((b: any) => ({ value: b.id, label: b.label || 'Box' }))} placeholder="No box…" value={editForm.box_id}
                    onChange={e => onBoxChange(e.target.value, setEditOrderIds, setEditForm)} />
                </FormField>
                <FormField label="Group">
                  <Select options={groups.map((g: any) => ({ value: g.id, label: g.name }))} placeholder="Select…" value={editForm.group_id} onChange={e => setEditForm(f => ({ ...f, group_id: e.target.value }))} />
                </FormField>
              </div>
              {editForm.box_id && (
                <FormField label="Orders included in this session">
                  <div className="border border-border rounded-xl overflow-hidden max-h-48 overflow-y-auto divide-y divide-border/50">
                    {editBoxOrders.map((o: any) => (
                      <label key={o.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-secondary/40 transition-colors">
                        <input type="checkbox" checked={editOrderIds.includes(o.id)}
                          onChange={() => setEditOrderIds(prev => prev.includes(o.id) ? prev.filter(x => x !== o.id) : [...prev, o.id])}
                          className="accent-primary w-3.5 h-3.5" />
                        <span className="text-sm">{orderLabel(o)}</span>
                      </label>
                    ))}
                  </div>
                </FormField>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={() => setEditingSession(null)}>Cancel</Button>
                <Button onClick={handleEdit} disabled={saving}>{saving ? 'Saving…' : 'Update'}</Button>
              </div>
            </div>
          </Modal>
        )
      })()}

      {/* Inclusions Modal */}
      {inclusionsModal && (() => {
        const d = sessionDetails[inclusionsModal]
        const packs: any[] = d?.packs || []
        const joiners = inclusionJoiners(d)
        return (
          <Modal open={true} onClose={() => setInclusionsModal(null)} title="Manage Inclusions" subtitle="How many full packs (inclusions) each joiner is due, per pack" size="lg">
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/15 rounded-xl">
                <div>
                  <p className="text-sm font-semibold">Auto-fill / refresh from orders</p>
                  <p className="text-xs text-muted-foreground">Sums inclusion counts from this session's selected orders only (plus any claim mentioning "album" in those orders) and splits across packs. Safe to re-run any time — it overwrites current values.</p>
                </div>
                <Button size="sm" onClick={() => autoFillInclusions(inclusionsModal).then(() => setInclusionsModal(inclusionsModal))}>✨ Auto-fill</Button>
              </div>
              {joiners.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No joiners found yet. Auto-fill from orders, or wait for priority forms to come in.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="text-left text-xs font-bold text-muted-foreground uppercase tracking-wider px-3 py-2 border-b border-border">Joiner</th>
                        {packs.map((p: any) => (
                          <th key={p.id} className="text-left text-xs font-bold text-muted-foreground uppercase tracking-wider px-3 py-2 border-b border-border">{p.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {joiners.map((j: any) => (
                        <tr key={j.joiner_id}>
                          <td className="px-3 py-2 font-semibold">{j.display_name || j.username}</td>
                          {packs.map((p: any) => (
                            <td key={p.id} className="px-3 py-2">
                              <input type="number" min="0" value={inclusionDrafts[j.joiner_id]?.[p.id] || ''}
                                onChange={e => setInclusionDrafts(prev => ({ ...prev, [j.joiner_id]: { ...(prev[j.joiner_id] || {}), [p.id]: e.target.value } }))}
                                className="w-16 px-2 py-1.5 rounded-lg border border-input bg-background text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/25" placeholder="0" />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={() => setInclusionsModal(null)}>Cancel</Button>
                <Button onClick={() => saveInclusions(inclusionsModal, packs)} disabled={saving}>{saving ? 'Saving…' : 'Save inclusions'}</Button>
              </div>
            </div>
          </Modal>
        )
      })()}

      {/* Run Sort Modal */}
      {sortModal && (
        <Modal open={true} onClose={() => !sortRunning && setSortModal(null)} title="Run Sort" subtitle="This closes the form and assigns items — it can't be undone by re-running without resetting quantities." size="sm">
          <div className="space-y-4">
            <div className="space-y-2">
              <button onClick={() => setSortMethod('timestamp')} className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${sortMethod === 'timestamp' ? 'border-primary bg-primary/5' : 'border-border'}`}>
                <Clock size={16} className="mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Timestamp sort</p>
                  <p className="text-xs text-muted-foreground">Joiners are served strictly in the order they submitted — earliest gets first pick of everything.</p>
                </div>
              </button>
              <button onClick={() => setSortMethod('fair')} className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${sortMethod === 'fair' ? 'border-primary bg-primary/5' : 'border-border'}`}>
                <Zap size={16} className="mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Fair sort</p>
                  <p className="text-xs text-muted-foreground">Goes level by level through everyone's rankings at once. Ties at the same priority level go to whoever submitted earliest.</p>
                </div>
              </button>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setSortModal(null)} disabled={sortRunning}>Cancel</Button>
              <Button onClick={() => runSort(sortModal)} disabled={sortRunning}>{sortRunning ? 'Running…' : 'Run sort'}</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Ownership Modal */}
      {ownershipModal && (() => {
        const d = sessionDetails[ownershipModal]
        const ownership: any[] = d?.ownership || []
        const byJoiner: Record<string, { name: string; owned: any[] }> = {}
        for (const o of ownership) {
          if (!byJoiner[o.joiner_id]) byJoiner[o.joiner_id] = { name: o.display_name || o.username || o.joiner_id, owned: [] }
          byJoiner[o.joiner_id].owned.push(o)
        }
        return (
          <Modal open={true} onClose={() => setOwnershipModal(null)} title="Ownership" subtitle="Already-owned pack+item+member combos from past sessions — the sort skips these until exhausted" size="lg">
            {ownership.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No ownership history found for these pack/item names in past sessions.</p>
            ) : (
              <div className="space-y-3">
                {Object.values(byJoiner).map((j, idx) => (
                  <div key={idx} className="border border-border rounded-xl p-3">
                    <p className="text-sm font-semibold mb-1.5">{j.name}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {j.owned.map((o, oi) => (
                        <span key={oi} className="text-xs px-2 py-1 rounded-full bg-secondary text-muted-foreground border border-border">
                          {o.pack_name} · {o.item_name} · {o.member_name}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Modal>
        )
      })()}
    </div>
  )
}
