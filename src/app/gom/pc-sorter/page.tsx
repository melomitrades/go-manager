'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus, Music, Trash2, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, RefreshCw, Check } from 'lucide-react'
import { Button, Card, CardContent, CardHeader, Modal, Input, Select, FormField, PageHeader, EmptyState, Badge } from '@/components/ui'
import { formatDate, formatDateTime } from '@/lib/utils'

interface PcVersion { id: string; name: string; members: { member_id: string; name: string; total_pulled: string }[] }

export default function GomPcSorterPage() {
  const [sessions, setSessions] = useState<any[]>([])
  const [groups, setGroups] = useState<any[]>([])
  const [boxes, setBoxes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [createModal, setCreateModal] = useState(false)
  const [editingSession, setEditingSession] = useState<any>(null)
  const [expandedSession, setExpandedSession] = useState<string | null>(null)
  const [sessionDetails, setSessionDetails] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)
  const [inclusionsModal, setInclusionsModal] = useState<{ sessionId: string; session: any } | null>(null)
  const [inclusionDrafts, setInclusionDrafts] = useState<Record<string, Record<string, string>>>({})  // joiner_id -> version_id -> count
  const [krwMinFilter, setKrwMinFilter] = useState<string>('')  // min KRW spent filter

  const [form, setForm] = useState({ title:'', group_id:'', box_id:'', deadline:'' })
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([])
  const [inclusionOrderIds, setInclusionOrderIds] = useState<string[]>([])
  const [versions, setVersions] = useState<PcVersion[]>([])
  const [editForm, setEditForm] = useState({ title:'', group_id:'', form_open:true, deadline:'', box_id:'' })

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [s, g, b] = await Promise.all([
      fetch('/api/pc-sorter').then(r=>r.json()),
      fetch('/api/groups').then(r=>r.json()),
      fetch('/api/boxes').then(r=>r.json()),
    ])
    setSessions(Array.isArray(s)?s:[])
    setGroups(Array.isArray(g)?g:[])
    setBoxes(Array.isArray(b)?b:[])
    setLoading(false)
  }, [])
  useEffect(() => { fetchData() }, [fetchData])

  async function loadDetails(sessionId: string) {
    const d = await fetch(`/api/pc-sorter/${sessionId}`).then(r=>r.json())
    setSessionDetails(prev => ({ ...prev, [sessionId]: d }))
  }

  async function toggleExpand(sessionId: string) {
    if (expandedSession === sessionId) { setExpandedSession(null); return }
    setExpandedSession(sessionId)
    await loadDetails(sessionId)
  }

  function addVersion() { setVersions(v => [...v, { id: Math.random().toString(36).slice(2), name:'', members:[] }]) }
  function removeVersion(id: string) { setVersions(v => v.filter(x => x.id !== id)) }
  function updateVersionName(id: string, name: string) { setVersions(v => v.map(x => x.id===id?{...x,name}:x)) }
  function addMember(vId: string) { setVersions(v => v.map(x => x.id===vId?{...x,members:[...x.members,{member_id:'',name:'',total_pulled:''}]}:x)) }
  function updateMember(vId: string, idx: number, field: string, val: string) {
    setVersions(v => v.map(x => x.id===vId?{...x,members:x.members.map((m,i)=>i===idx?{...m,[field]:val}:m)}:x))
  }

  // When a box is selected, pre-populate group from box's linked orders
  async function onBoxChange(boxId: string) {
    setForm(f => ({ ...f, box_id: boxId }))
    if (!boxId) return
    const box = boxes.find((b: any) => b.id === boxId)
    if (box?.linked_orders?.[0]) {
      const firstOrder = box.linked_orders[0]
      if (firstOrder.group?.id && !form.group_id) {
        setForm(f => ({ ...f, group_id: firstOrder.group.id }))
      }
    }
  }

  async function handleCreate() {
    if (!form.title) return
    setSaving(true)
    const selectedBox = boxes.find((b: any) => b.id === form.box_id)
    const group = groups.find((g: any) => g.id === form.group_id)
    const groupMembers: any[] = group?.members || []

    // Build full versions with members from group
    const fullVersions = versions.map(v => ({
      name: v.name,
      members: groupMembers.map(m => ({
        member_id: m.id,
        total_pulled: v.members.find(vm => vm.member_id === m.id)?.total_pulled || '0',
      }))
    }))

    await fetch('/api/pc-sorter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: form.title,
        group_id: form.group_id || null,
        box_id: form.box_id || null,
        deadline: form.deadline || null,
        versions: fullVersions,
      }),
    })
    setCreateModal(false)
    setForm({ title:'', group_id:'', box_id:'', deadline:'' })
    setVersions([])
    fetchData()
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
        form_open: editForm.form_open,
        deadline: editForm.deadline || null,
        box_id: editForm.box_id || null,
          order_ids: inclusionOrderIds.length > 0 ? inclusionOrderIds : null,
      }),
    })
    setEditingSession(null)
    fetchData()
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this session?')) return
    await fetch('/api/pc-sorter', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) })
    fetchData()
  }

  async function openInclusionsModal(session: any) {
    const det = sessionDetails[session.id] || await fetch(`/api/pc-sorter/${session.id}`).then(r=>r.json())
    setSessionDetails(p => ({ ...p, [session.id]: det }))
    // Pre-fill from existing assignments
    const drafts: Record<string, Record<string, string>> = {}
    for (const a of det.assignments || []) {
      if (!drafts[a.joiner_id]) drafts[a.joiner_id] = {}
      drafts[a.joiner_id][a.version_id] = String(a.inclusions_assigned)
    }
    setInclusionDrafts(drafts)
    setInclusionsModal({ sessionId: session.id, session })
  }

  async function saveInclusions() {
    if (!inclusionsModal) return
    setSaving(true)
    const assignments: any[] = []
    for (const [joiner_id, vMap] of Object.entries(inclusionDrafts)) {
      for (const [version_id, cnt] of Object.entries(vMap)) {
        if (parseInt(cnt) > 0) {
          assignments.push({ joiner_id, version_id, inclusions_assigned: parseInt(cnt) })
        }
      }
    }
    await fetch(`/api/pc-sorter/${inclusionsModal.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments }),
    })
    await loadDetails(inclusionsModal.sessionId)
    setInclusionsModal(null)
    setSaving(false)
  }

  async function runSort(sessionId: string) {
    if (!confirm('Run sort and assign inclusions to joiners? This will update their packages.')) return
    await fetch(`/api/pc-sorter/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_sort: true }),
    })
    await loadDetails(sessionId)
    fetchData()
  }

  const det = expandedSession ? sessionDetails[expandedSession] : null

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Sorting"
        subtitle="Create sorting sessions, assign inclusions, and run the sort"
        action={<Button onClick={() => setCreateModal(true)}><Plus size={14}/> New Session</Button>}
      />

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-4">
        {loading ? <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>
        : sessions.length === 0 ? <EmptyState icon={Music} title="No sessions yet" action={<Button onClick={()=>setCreateModal(true)}><Plus size={14}/> New Session</Button>}/>
        : sessions.map(session => {
            const isOpen = expandedSession === session.id
            const d = sessionDetails[session.id]
            const box = boxes.find((b: any) => b.id === session.box_id)

            return (
              <Card key={session.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-display font-semibold">{session.title}</p>
                        <Badge className={`text-xs ${session.form_open ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-secondary text-muted-foreground border border-border'}`}>
                          {session.form_open ? 'Open' : 'Closed'}
                        </Badge>
                        {session.deadline && <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${new Date(session.deadline) < new Date() ? 'bg-destructive/10 text-destructive border-destructive/20' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>⏱ {formatDate(session.deadline)}</span>}
                        {box && <Badge className="bg-sky-50 text-sky-700 border border-sky-200 text-xs">📦 {box.label || 'Box'}</Badge>}
                      </div>
                      {session.group?.name && <p className="text-xs text-muted-foreground mt-0.5">{session.group.name}</p>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => openInclusionsModal(session)}>Inclusions</Button>
                      <Button variant="ghost" size="sm" onClick={() => {
                        setEditingSession(session)
                        setEditForm({ title:session.title, group_id:session.group_id||'', form_open:session.form_open, deadline:session.deadline?.slice(0,16)||'', box_id:session.box_id||'' })
                        // Restore saved order_ids for this session
                        const savedIds = (() => { try { const o = session.order_ids; if (!o) return []; return Array.isArray(o) ? o : JSON.parse(o) } catch { return [] } })()
                        setInclusionOrderIds(savedIds.length > 0 ? savedIds : (boxes.find((b:any)=>b.id===session.box_id)?.linked_orders||[]).map((o:any)=>o.order_id||o.id).filter(Boolean))
                      }}>Edit</Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(session.id)}><Trash2 size={13} className="text-destructive/50"/></Button>
                      <button onClick={() => toggleExpand(session.id)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary px-2 py-1.5 rounded-lg hover:bg-secondary">
                        {isOpen ? <ChevronUp size={14}/> : <ChevronDown size={14}/>} Details
                      </button>
                    </div>
                  </div>
                </CardHeader>

                {isOpen && (
                  <CardContent>
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                        Priority Forms ({d?.forms?.length || 0} submitted)
                        <button onClick={() => loadDetails(session.id)} className="ml-2 text-primary font-normal normal-case tracking-normal">↺ Refresh</button>
                      </p>
                      {d?.assignments?.length > 0 && (
                        <Button size="sm" onClick={() => runSort(session.id)}>
                          <Check size={13}/> Run Sort & Assign
                        </Button>
                      )}
                    </div>

                    {/* Submitted forms */}
                    {d?.forms?.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No submissions yet.</p>
                    ) : (
                      <div className="space-y-3 mb-5">
                        {d?.forms?.map((form: any) => {
                          const priorities: any[] = form.form_data?.priorities || []
                          return (
                            <div key={form.id} className="border border-border rounded-xl overflow-hidden">
                              <div className="flex items-center justify-between px-4 py-2.5 bg-secondary/30">
                                <p className="text-sm font-semibold">{form.display_name || form.username}</p>
                                <span className="text-xs text-muted-foreground">{formatDateTime(form.submitted_at)}</span>
                              </div>
                              <div className="px-4 py-3">
                                {d?.versions?.map((v: any) => {
                                  const vPriorities = priorities.filter((p: any) => p.version_id === v.id).sort((a: any, b: any) => a.priority - b.priority)
                                  if (!vPriorities.length) return null
                                  return (
                                    <div key={v.id} className="mb-2">
                                      <p className="text-xs font-semibold text-muted-foreground mb-1">{v.name}</p>
                                      <div className="flex flex-wrap gap-1">
                                        {vPriorities.map((p: any, idx: number) => {
                                          const pc = d.photocards.find((ph: any) => ph.member_id === p.member_id && ph.version_id === v.id)
                                          return (
                                            <span key={idx} className={`text-xs px-2 py-0.5 rounded-full border font-medium ${idx===0?'bg-amber-50 text-amber-700 border-amber-200':idx===1?'bg-slate-50 text-slate-600 border-slate-200':'bg-secondary text-muted-foreground border-border'}`}>
                                              {idx+1}. {pc?.member_name || p.member_id}
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

                    {/* Inclusions assignments preview */}
                    {d?.assignments?.length > 0 && (
                      <div>
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Inclusions Assigned</p>
                        <div className="space-y-1">
                          {d.assignments.map((a: any) => {
                            const v = d?.versions?.find((v: any) => v.id === a.version_id)
                            const joiner = d?.inclusions?.find((j: any) => j.joiner_id === a.joiner_id)
                            return (
                              <div key={a.id} className="flex items-center gap-2 text-sm">
                                <span className="font-semibold">{joiner?.display_name || a.joiner_id}</span>
                                <span className="text-muted-foreground">→</span>
                                <span className="text-primary font-bold">{a.inclusions_assigned}×</span>
                                <span className="text-muted-foreground">{v?.name}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            )
          })
        }
      </div>

      {/* Create Session Modal */}
      <Modal open={createModal} onClose={()=>{setCreateModal(false);setForm({title:'',group_id:'',box_id:'',deadline:''});setVersions([])}} title="New PC Sorting Session" size="xl">
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <FormField label="Session Title" required>
              <Input placeholder="e.g. BTS YTC Round 1" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))}/>
            </FormField>
            <FormField label="Group">
              <Select options={groups.map((g:any)=>({value:g.id,label:g.name}))} placeholder="Select group…" value={form.group_id} onChange={e=>setForm(f=>({...f,group_id:e.target.value}))}/>
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <FormField label="Linked Box (for inclusions)">
              <Select options={boxes.map((b:any)=>({value:b.id,label:b.label||'Box'}))} placeholder="Select box…" value={form.box_id} onChange={e=>onBoxChange(e.target.value)}/>
            </FormField>
            <FormField label="Form Deadline (auto-closes)">
              <Input type="datetime-local" value={form.deadline} onChange={e=>setForm(f=>({...f,deadline:e.target.value}))}/>
            </FormField>
          </div>

          {/* Versions */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Versions</p>
              <Button variant="outline" size="sm" onClick={addVersion}><Plus size={12}/> Add Version</Button>
            </div>
            {versions.length === 0 && <p className="text-sm text-muted-foreground text-center py-3">Add at least one version (e.g. ver. A, ver. B)</p>}
            {versions.map((v, vi) => (
              <div key={v.id} className="border border-border rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 bg-secondary/30 border-b border-border">
                  <Input placeholder={`Version name (e.g. ver. A)`} value={v.name} onChange={e=>updateVersionName(v.id,e.target.value)} className="flex-1"/>
                  <Button variant="ghost" size="icon" onClick={()=>removeVersion(v.id)}><Trash2 size={13} className="text-destructive/50"/></Button>
                </div>
                <div className="p-3 space-y-2">
                  <p className="text-xs text-muted-foreground">Members pulled for this version (leave 0 if equal for all)</p>
                  {groups.find((g:any)=>g.id===form.group_id)?.members?.map((m: any) => (
                    <div key={m.id} className="flex items-center gap-3">
                      <span className="text-sm flex-1">{m.name}</span>
                      <div className="w-24"><Input type="number" min="0" placeholder="0" value={v.members.find(vm=>vm.member_id===m.id)?.total_pulled||''} onChange={e=>{const idx=v.members.findIndex(vm=>vm.member_id===m.id); if(idx>=0) updateMember(v.id,idx,'total_pulled',e.target.value); else setVersions(vs=>vs.map(x=>x.id===v.id?{...x,members:[...x.members,{member_id:m.id,name:m.name,total_pulled:e.target.value}]}:x))}}/></div>
                    </div>
                  )) || <p className="text-xs text-muted-foreground">Select a group first to see members</p>}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={()=>{setCreateModal(false);setVersions([])}}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving||!form.title}>{saving?'Creating…':'Create Session'}</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      {editingSession && (() => {
        const editBox = boxes.find((b: any) => b.id === editForm.box_id)
        const editBoxOrderIds: string[] = (editBox?.linked_orders || []).map((o: any) => o.order_id || o.id).filter(Boolean)
        return (
        <Modal open={!!editingSession} onClose={()=>setEditingSession(null)} title="Edit Session" size="md">
          <div className="space-y-4">
            <FormField label="Title"><Input value={editForm.title} onChange={e=>setEditForm(f=>({...f,title:e.target.value}))}/></FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Group"><Select options={groups.map((g:any)=>({value:g.id,label:g.name}))} placeholder="Select…" value={editForm.group_id} onChange={e=>setEditForm(f=>({...f,group_id:e.target.value}))}/></FormField>
              <FormField label="Box">
                <Select options={boxes.map((b:any)=>({value:b.id,label:b.label||'Box'}))} placeholder="No box…" value={editForm.box_id}
                  onChange={e => {
                    const newBoxId = e.target.value
                    setEditForm(f=>({...f, box_id: newBoxId}))
                    const b = boxes.find((x:any) => x.id === newBoxId)
                    const ids = (b?.linked_orders || []).map((o:any) => o.order_id || o.id).filter(Boolean)
                    if (ids.length > 0) setInclusionOrderIds(ids)
                  }}/>
              </FormField>
            </div>
            <FormField label="Deadline"><Input type="datetime-local" value={editForm.deadline} onChange={e=>setEditForm(f=>({...f,deadline:e.target.value}))}/></FormField>

            {/* Order selection for inclusions */}
            <FormField label="Orders for inclusions">
              <p className="text-xs text-muted-foreground mb-2">Select orders whose inclusions count for this session.</p>
              <div className="border border-border rounded-xl overflow-hidden max-h-40 overflow-y-auto divide-y divide-border/50">
                {orders.length === 0 && <p className="text-sm text-muted-foreground p-3">No active orders.</p>}
                {orders.map((o:any) => (
                  <label key={o.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-secondary/40 transition-colors">
                    <input type="checkbox" checked={inclusionOrderIds.includes(o.id)}
                      onChange={()=>setInclusionOrderIds(prev=>prev.includes(o.id)?prev.filter(x=>x!==o.id):[...prev,o.id])}
                      className="accent-primary w-3.5 h-3.5"/>
                    <span className="text-sm">{orderLabel(o)}</span>
                  </label>
                ))}
              </div>
              {editBoxOrderIds.length > 0 && inclusionOrderIds.length === 0 && (
                <button onClick={() => setInclusionOrderIds(editBoxOrderIds)} className="text-xs text-primary underline mt-1">
                  Pre-select from linked box ({editBoxOrderIds.length} order{editBoxOrderIds.length !== 1 ? 's' : ''})
                </button>
              )}
              {inclusionOrderIds.length > 0 && <p className="text-xs text-primary font-semibold mt-1">{inclusionOrderIds.length} order{inclusionOrderIds.length!==1?'s':''} selected</p>}
            </FormField>

            <div className="flex items-center gap-3">
              <button onClick={()=>setEditForm(f=>({...f,form_open:!f.form_open}))} className={`flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl border transition-all ${editForm.form_open?'bg-emerald-50 text-emerald-700 border-emerald-200':'bg-secondary text-muted-foreground border-border'}`}>
                {editForm.form_open?<ToggleRight size={16}/>:<ToggleLeft size={16}/>} Form {editForm.form_open?'open':'closed'}
              </button>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={()=>setEditingSession(null)}>Cancel</Button>
              <Button onClick={handleEdit} disabled={saving}>{saving?'Saving…':'Update'}</Button>
            </div>
          </div>
        </Modal>
        )
      })()}

      {/* Inclusions Assignment Modal */}
      {inclusionsModal && (() => {
        const d = sessionDetails[inclusionsModal.sessionId]
        const joiners: any[] = d?.inclusions || []
        const vers: any[] = d?.versions || []
        return (
          <Modal open={true} onClose={()=>setInclusionsModal(null)} title="Assign Inclusions per Version" subtitle="Assign how many inclusions each joiner gets per version" size="xl">
            <div className="space-y-4">
              {/* KRW filter */}
              {joiners.some((j:any) => j.total_krw > 0) && (
                <div className="flex items-center gap-3">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Min. KRW spent</label>
                  <input
                    type="number"
                    placeholder="e.g. 10000"
                    value={krwMinFilter}
                    onChange={e => setKrwMinFilter(e.target.value)}
                    className="w-36 px-3 py-1.5 text-sm border border-border rounded-xl bg-background focus:outline-none focus:ring-2 focus:ring-primary/25"
                  />
                  {krwMinFilter && <button onClick={() => setKrwMinFilter('')} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>}
                  <span className="text-xs text-muted-foreground ml-auto">
                    {joiners.filter((j:any) => !krwMinFilter || (j.total_krw || 0) >= parseInt(krwMinFilter)).length} / {joiners.length} joiners shown
                  </span>
                </div>
              )}
              {joiners.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No joiners with inclusions found. Make sure the session is linked to a box with orders that have inclusions_count set.</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <th className="text-left text-xs font-bold text-muted-foreground uppercase tracking-wider px-3 py-2 border-b border-border">Joiner</th>
                          <th className="text-left text-xs font-bold text-muted-foreground uppercase tracking-wider px-3 py-2 border-b border-border">Total Incl.</th>
                          {vers.map((v:any) => (
                            <th key={v.id} className="text-left text-xs font-bold text-muted-foreground uppercase tracking-wider px-3 py-2 border-b border-border">{v.name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {joiners.filter((j:any) => !krwMinFilter || (j.total_krw || 0) >= (parseInt(krwMinFilter) || 0)).map((j: any) => {
                          const rowTotal = vers.reduce((s, v) => s + parseInt(inclusionDrafts[j.joiner_id]?.[v.id] || '0'), 0)
                          const remaining = j.total_inclusions - rowTotal
                          return (
                            <tr key={j.joiner_id} className="hover:bg-secondary/20">
                              <td className="px-3 py-2.5"><p className="font-semibold">{j.display_name || j.username}</p>{j.total_krw > 0 && <p className="text-xs text-muted-foreground font-mono">₩{j.total_krw.toLocaleString()}</p>}</td>
                              <td className="px-3 py-2.5">
                                <span className="font-mono text-sm">{j.total_inclusions}</span>
                                {remaining !== 0 && <span className={`ml-1.5 text-xs font-bold ${remaining > 0 ? 'text-amber-600' : 'text-destructive'}`}>({remaining > 0 ? `${remaining} left` : `${Math.abs(remaining)} over`})</span>}
                              </td>
                              {vers.map((v: any) => (
                                <td key={v.id} className="px-3 py-2">
                                  <input
                                    type="number" min="0"
                                    value={inclusionDrafts[j.joiner_id]?.[v.id] || ''}
                                    onChange={e => setInclusionDrafts(prev => ({
                                      ...prev,
                                      [j.joiner_id]: { ...(prev[j.joiner_id] || {}), [v.id]: e.target.value }
                                    }))}
                                    className="w-16 px-2 py-1.5 rounded-lg border border-input bg-background text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/25"
                                    placeholder="0"
                                  />
                                </td>
                              ))}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground">The numbers in each version column must add up to the joiner's total inclusions.</p>
                  <div className="flex justify-end gap-3 pt-2">
                    <Button variant="outline" onClick={()=>setInclusionsModal(null)}>Cancel</Button>
                    <Button onClick={saveInclusions} disabled={saving}>{saving?'Saving…':'Save Inclusions'}</Button>
                  </div>
                </>
              )}
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}
