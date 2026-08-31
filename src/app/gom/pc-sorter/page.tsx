'use client'
import { useEffect, useState, useCallback, Fragment } from 'react'
import { Plus, Music, Trash2, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, Check, Clock, Zap, Repeat, Shuffle, ShieldCheck } from 'lucide-react'
import { Button, Card, CardContent, CardHeader, Modal, Input, Select, FormField, PageHeader, EmptyState, Badge } from '@/components/ui'
import { formatDate, formatDateTime } from '@/lib/utils'

function orderLabel(o: any) {
  return [o.group?.name, o.round_number ? `R${o.round_number}` : null, o.shop?.name].filter(Boolean).join(' · ') || o.id?.slice(0, 8)
}

// All version names on a multi-version order, e.g. ["Ver. A", "Ver. B"]. Empty for a normal order.
function versionsForOrder(o: any): string[] {
  if (!o?.is_multi_version) return []
  try {
    const vn = o.version_names
    const arr = Array.isArray(vn) ? vn : (vn ? JSON.parse(vn) : [])
    return (arr || []).filter(Boolean)
  } catch { return [] }
}

// Checkboxes for which orders (and, for multi-version orders, which specific versions of
// each) feed inclusion counts into a session. An order with no version override selected
// still counts every version — the override map only ever holds deliberate narrowing.
function OrderPicker({ orders, orderIds, setOrderIds, orderVersions, setOrderVersions }: {
  orders: any[]
  orderIds: string[]
  setOrderIds: (fn: any) => void
  orderVersions: Record<string, string[]>
  setOrderVersions: (fn: any) => void
}) {
  function toggleOrder(o: any) {
    setOrderIds((prev: string[]) => prev.includes(o.id) ? prev.filter(x => x !== o.id) : [...prev, o.id])
  }
  function toggleVersion(o: any, vn: string) {
    const all = versionsForOrder(o)
    setOrderVersions((prev: Record<string, string[]>) => {
      const current = prev[o.id] ?? all
      const next = current.includes(vn) ? current.filter(v => v !== vn) : [...current, vn]
      const copy = { ...prev }
      if (next.length === all.length) delete copy[o.id] // back to "every version" — no override needed
      else copy[o.id] = next
      return copy
    })
  }
  return (
    <div className="border border-border rounded-xl overflow-hidden max-h-64 overflow-y-auto divide-y divide-border/50">
      {orders.map((o: any) => {
        const allVersions = versionsForOrder(o)
        const included = orderIds.includes(o.id)
        const checkedVersions = orderVersions[o.id] ?? allVersions
        return (
          <div key={o.id} className={allVersions.length > 0 ? 'bg-secondary/10' : ''}>
            <label className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-secondary/40 transition-colors">
              <input type="checkbox" checked={included} onChange={() => toggleOrder(o)} className="accent-primary w-3.5 h-3.5" />
              <span className="text-sm flex-1">{orderLabel(o)}</span>
              {allVersions.length > 0 && (
                <span className="text-[10px] font-semibold text-muted-foreground">
                  {checkedVersions.length}/{allVersions.length} versions
                </span>
              )}
            </label>
            {included && allVersions.length > 0 && (
              <div className="pl-9 pb-2 pr-4 space-y-1">
                {allVersions.map(vn => (
                  <label key={vn} className="flex items-center gap-2.5 py-1 cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                    <input type="checkbox" checked={checkedVersions.includes(vn)} onChange={() => toggleVersion(o, vn)} className="accent-primary w-3 h-3" />
                    {vn}
                  </label>
                ))}
                {checkedVersions.length === 0 && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">No version selected — this order won't contribute any inclusions.</p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function GomPcSorterPage() {
  const [sessions, setSessions] = useState<any[]>([])
  const [groups, setGroups] = useState<any[]>([])
  const [boxes, setBoxes] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [allOrders, setAllOrders] = useState<any[]>([]) // unfiltered (includes closed) — for looking up an already-linked order by id, e.g. inclusion source breakdown
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [createModal, setCreateModal] = useState(false)
  const [form, setForm] = useState({ title: '', group_id: '', box_id: '', deadline: '' })
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([])
  const [selectedOrderVersions, setSelectedOrderVersions] = useState<Record<string, string[]>>({})

  const [editingSession, setEditingSession] = useState<any>(null)
  const [editForm, setEditForm] = useState({ title: '', group_id: '', deadline: '', box_id: '' })
  const [editOrderIds, setEditOrderIds] = useState<string[]>([])
  const [editOrderVersions, setEditOrderVersions] = useState<Record<string, string[]>>({})

  const [expandedSession, setExpandedSession] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<Record<string, 'packs' | 'forms' | 'results'>>({})
  const [sessionDetails, setSessionDetails] = useState<Record<string, any>>({})
  const [newPackName, setNewPackName] = useState<Record<string, string>>({})
  const [newItemName, setNewItemName] = useState<Record<string, string>>({})
  const [newItemIsUnit, setNewItemIsUnit] = useState<Record<string, boolean>>({}) // pack_id -> checkbox state
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, Record<string, string>>>({}) // item_id -> member_id (or unit id) -> value
  // Draft state for building a new unit combo ("Mai + Jungeun") on a unit-tagged item, before
  // it's saved as a PCItemUnit. item_id -> selected real member ids / an overridden combo name.
  const [unitDraftMembers, setUnitDraftMembers] = useState<Record<string, string[]>>({})
  const [unitDraftName, setUnitDraftName] = useState<Record<string, string | undefined>>({})

  const [inclusionsModal, setInclusionsModal] = useState<string | null>(null)
  const [inclusionDrafts, setInclusionDrafts] = useState<Record<string, Record<string, string>>>({}) // joiner_id -> pack_id -> value
  const [inclusionSourcesOpenFor, setInclusionSourcesOpenFor] = useState<string | null>(null) // joiner_id whose "sources" dropdown is expanded, in the Manage Inclusions box

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
    setAllOrders(Array.isArray(o) ? o : [])
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

  function onBoxChange(boxId: string, setIds: (ids: string[]) => void, setF: (fn: any) => void, setVersions: (v: any) => void) {
    setF((f: any) => ({ ...f, box_id: boxId }))
    setVersions({}) // switching boxes invalidates any per-order version narrowing from before
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
        order_versions: selectedOrderVersions,
      }),
    })
    setCreateModal(false)
    setForm({ title: '', group_id: '', box_id: '', deadline: '' })
    setSelectedOrderIds([])
    setSelectedOrderVersions({})
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
        order_versions: editOrderVersions,
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
      body: JSON.stringify({ add_item: { pack_id: packId, name, is_unit: !!newItemIsUnit[packId] } }),
    })
    setNewItemName(p => ({ ...p, [packId]: '' }))
    setNewItemIsUnit(p => ({ ...p, [packId]: false }))
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

  function toggleUnitDraftMember(itemId: string, memberId: string) {
    setUnitDraftMembers(prev => {
      const current = prev[itemId] || []
      const next = current.includes(memberId) ? current.filter(x => x !== memberId) : [...current, memberId]
      return { ...prev, [itemId]: next }
    })
  }

  async function addUnit(sessionId: string, itemId: string, groupMembers: any[]) {
    const memberIds = unitDraftMembers[itemId] || []
    if (memberIds.length === 0) return
    const auto = memberIds.map(id => groupMembers.find((m: any) => m.id === id)?.name).filter(Boolean).join(' + ')
    const name = (unitDraftName[itemId] ?? auto).trim()
    if (!name) return
    await fetch(`/api/pc-sorter/${sessionId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ add_unit: { item_id: itemId, name, member_ids: memberIds } }),
    })
    setUnitDraftMembers(p => ({ ...p, [itemId]: [] }))
    setUnitDraftName(p => ({ ...p, [itemId]: undefined }))
    await loadDetails(sessionId)
  }

  async function deleteUnit(sessionId: string, unitId: string) {
    if (!confirm('Delete this unit combo? Its quantity and any priority rankings for it will be removed too.')) return
    await fetch(`/api/pc-sorter/${sessionId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete_unit: { unit_id: unitId } }),
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

  async function resetInclusions(sessionId: string) {
    if (!confirm('Clear every inclusion count for this session? This cannot be undone.')) return
    setSaving(true)
    await fetch(`/api/pc-sorter/${sessionId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset_inclusions: true }),
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

  const [lockingSession, setLockingSession] = useState<string | null>(null)

  async function lockSort(sessionId: string) {
    setLockingSession(sessionId)
    await fetch(`/api/pc-sorter/${sessionId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lock_sort: true }),
    })
    await loadDetails(sessionId)
    await fetchData()
    setLockingSession(null)
  }

  async function unlockSort(sessionId: string) {
    if (!confirm('Unlock this session? Packs, items, quantities, inclusions, and re-running the sort will become editable again.')) return
    setLockingSession(sessionId)
    await fetch(`/api/pc-sorter/${sessionId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unlock_sort: true }),
    })
    await loadDetails(sessionId)
    await fetchData()
    setLockingSession(null)
  }

  // Breaks a joiner's auto-filled inclusion total back down by source order — mirrors the
  // server's autoFillInclusions logic (same version filter, same "explicit inclusions_count
  // counted once per claim line, album-fallback counted per row" dedupe) so the numbers shown
  // here always add up to what auto-fill actually assigned. Purely for display in the Manage
  // Inclusions box; doesn't affect saving.
  function inclusionSourcesForJoiner(d: any, joinerId: string): { order: any; amount: number }[] {
    const sessionRow = d?.session
    if (!sessionRow) return []
    const orderIds: string[] = (() => {
      try { const o = sessionRow.order_ids; if (!o) return []; return Array.isArray(o) ? o : JSON.parse(o) } catch { return [] }
    })()
    if (orderIds.length === 0) return []
    const orderVersions: Record<string, string[]> = (() => {
      try { const v = sessionRow.order_versions; if (!v) return {}; return typeof v === 'string' ? JSON.parse(v) : v } catch { return {} }
    })()
    const results: { order: any; amount: number }[] = []
    for (const oid of orderIds) {
      const order = allOrders.find((o: any) => o.id === oid)
      if (!order) { results.push({ order: { id: oid }, amount: -1 }); continue } // -1 = "can't tell, order not loaded"
      const versions = Object.prototype.hasOwnProperty.call(orderVersions, oid) ? orderVersions[oid] : null
      const relevant = (order.items || []).filter((it: any) => {
        const jid = it.joiner_id || order.personal_joiner_id
        if (jid !== joinerId) return false
        if (versions && !versions.includes(it.version_name)) return false
        return (parseInt(it.inclusions_count) || 0) > 0 || (it.description || '').toLowerCase().includes('album')
      })
      const seenExplicit = new Set<string>()
      let amount = 0
      for (const it of relevant) {
        const explicit = (parseInt(it.inclusions_count) || 0) > 0
        const amt = explicit ? (parseInt(it.inclusions_count) || 0) : (parseInt(it.amount_claimed) || 1)
        if (explicit) {
          // Same grouping key as the server's autoFillInclusions: prefer claim_group_id (exact)
          // and only fall back to the description+price+version heuristic for rows saved before
          // that column existed.
          const key = it.claim_group_id ? `cg:${it.claim_group_id}` : `${it.description || ''}|${it.price_eur ?? ''}|${it.version_name || ''}`
          if (seenExplicit.has(key)) continue
          seenExplicit.add(key)
        }
        amount += amt
      }
      if (amount > 0) results.push({ order, amount })
    }
    return results
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

  // Sum of guaranteed claims for one joiner+item (guaranteed claims only ever apply to is_unit items).
  const guaranteedForJoinerItem = (d: any, joinerId: string, itemId: string) =>
    (d?.guaranteed || []).filter((g: any) => g.joiner_id === joinerId && g.item_id === itemId).reduce((s: number, g: any) => s + (parseInt(g.count) || 0), 0)

  // Whether a joiner has anything left to actually RANK anywhere in this session — false when
  // every item they're due for is either not due to them at all, or fully covered by a guaranteed
  // unit claim (so it was pre-assigned automatically and never needed ranking). Mirrors the
  // joiner-facing page's own visibility filter, so a joiner who's never shown a ranking form there
  // is never left dangling as "awaiting submission" here — they'll never submit one.
  const hasAnythingToSort = (d: any, joinerId: string) => {
    const packs: any[] = d?.packs || []
    const items: any[] = d?.items || []
    return packs.some((pack: any) => {
      const packNeed = (d?.inclusions || []).filter((i: any) => i.joiner_id === joinerId && i.pack_id === pack.id).reduce((s: number, i: any) => s + (parseInt(i.inclusions_assigned) || 0), 0)
      if (packNeed <= 0) return false
      return items.some((item: any) => {
        if (item.pack_id !== pack.id) return false
        if (!item.is_unit) return true
        return packNeed - guaranteedForJoinerItem(d, joinerId, item.id) > 0
      })
    })
  }

  // Joiners who have inclusions assigned (so they're expected to rank) but haven't submitted a form yet
  const pendingJoiners = (d: any) => {
    const submittedIds = new Set((d?.forms || []).map((f: any) => f.joiner_id))
    const seen = new Set<string>()
    const list: any[] = []
    for (const i of d?.inclusions || []) {
      if (submittedIds.has(i.joiner_id) || seen.has(i.joiner_id)) continue
      if (!hasAnythingToSort(d, i.joiner_id)) continue
      seen.add(i.joiner_id)
      list.push(i)
    }
    return list
  }

  const totalInclusionsFor = (d: any, joinerId: string) =>
    (d?.inclusions || []).filter((i: any) => i.joiner_id === joinerId).reduce((s: number, i: any) => s + (parseInt(i.inclusions_assigned) || 0), 0)

  // Sum of every inclusion row's count — the real number of "inclusions assigned",
  // as opposed to the number of joiner-pack ROWS (a joiner can have more than 1 inclusion
  // on a single row, so those aren't the same thing).
  const totalInclusionUnits = (d: any) =>
    (d?.inclusions || []).reduce((s: number, i: any) => s + (parseInt(i.inclusions_assigned) || 0), 0)

  // What the sort SHOULD produce once it runs: one inclusion = one of EVERY item in its pack,
  // so each pack's inclusion units multiply by that pack's own item count — this is the number
  // to compare "assigned" against, not the raw inclusion count, which is expected to be lower
  // whenever a pack has more than one item. Mirrors totalDemand in runPcSort() server-side.
  const expectedAssignedTotal = (d: any) => {
    const packs: any[] = d?.packs || []
    const items: any[] = d?.items || []
    const inclusions: any[] = d?.inclusions || []
    return packs.reduce((sum: number, p: any) => {
      const itemsInPack = items.filter((i: any) => i.pack_id === p.id).length
      const packUnits = inclusions.filter((i: any) => i.pack_id === p.id).reduce((s: number, i: any) => s + (parseInt(i.inclusions_assigned) || 0), 0)
      return sum + itemsInPack * packUnits
    }, 0)
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
            const isLocked = !!s.locked_at
            // Default to Results once a sort has run (that's what a GOM opens the card to check),
            // otherwise Packs & Items (that's what's still being set up).
            const activeTab = detailTab[s.id] || (s.sort_run_at ? 'results' : 'packs')

            return (
              <Card key={s.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-display font-semibold">{s.title}</p>
                        {isLocked ? (
                          <Badge className="text-xs bg-violet-50 text-violet-700 border border-violet-200" title={`Locked ${formatDateTime(s.locked_at)}`}>🔒 Sort locked</Badge>
                        ) : (
                          <Badge className={`text-xs ${s.form_open ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-secondary text-muted-foreground border border-border'}`}>
                            {s.form_open ? 'Form open' : 'Form closed'}
                          </Badge>
                        )}
                        {s.deadline && <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${new Date(s.deadline) < new Date() ? 'bg-destructive/10 text-destructive border-destructive/20' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>⏱ {formatDate(s.deadline)}</span>}
                        {s.box?.label && <Badge className="bg-sky-50 text-sky-700 border border-sky-200 text-xs">📦 {s.box.label}</Badge>}
                        {s.sort_method && <Badge className="bg-primary/10 text-primary border border-primary/20 text-xs">{s.sort_method === 'timestamp' ? <><Clock size={10} className="inline mr-0.5" />Timestamp</> : <><Zap size={10} className="inline mr-0.5" />Fair</>} sorted</Badge>}
                      </div>
                      {s.group?.name && <p className="text-xs text-muted-foreground mt-0.5">{s.group.name}</p>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {!isLocked && (
                        <Button
                          variant={s.form_open ? 'outline' : 'default'}
                          size="sm"
                          onClick={() => toggleFormOpen(s)}
                          title={s.sort_run_at ? "Sort already ran — reopening only lets joiners who haven't submitted yet do so before you sort again. Joiners who already submitted stay locked in; they can't edit." : ''}
                        >
                          {s.form_open ? <><ToggleRight size={14} /> Close form</> : <><ToggleLeft size={14} /> Open form</>}
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={async () => {
                        setEditForm({ title: s.title, group_id: s.group_id || '', deadline: s.deadline?.slice(0, 16) || '', box_id: s.box_id || '' })
                        const savedIds = (() => { try { const o = s.order_ids; if (!o) return []; return Array.isArray(o) ? o : JSON.parse(o) } catch { return [] } })()
                        setEditOrderIds(savedIds.length > 0 ? savedIds : boxLinkedOrderIds(s.box_id))
                        const savedVersions = (() => { try { const v = s.order_versions; if (!v) return {}; return typeof v === 'string' ? JSON.parse(v) : v } catch { return {} } })()
                        setEditOrderVersions(savedVersions)
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
                        {/* Tabs — keeps the card from turning into one long scroll of six stacked sections */}
                        <div className="flex items-center gap-1 border-b border-border">
                          {([
                            { key: 'packs' as const, label: 'Packs & Items', count: packs.length },
                            { key: 'forms' as const, label: 'Forms & Inclusions', count: (d.forms || []).length },
                            { key: 'results' as const, label: 'Results', count: (d.assignments || []).length },
                          ]).map(tab => (
                            <button
                              key={tab.key}
                              onClick={() => setDetailTab(p => ({ ...p, [s.id]: tab.key }))}
                              className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${activeTab === tab.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                            >
                              {tab.label}{tab.count > 0 ? ` (${tab.count})` : ''}
                            </button>
                          ))}
                        </div>

                        {activeTab === 'packs' && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Packs & items</p>
                              {isLocked
                                ? <p className="text-[11px] text-violet-700 dark:text-violet-400 mt-0.5">🔒 Locked — unlock the sort (Results tab) to edit packs, items, or quantities.</p>
                                : s.sort_run_at && <p className="text-[11px] text-muted-foreground mt-0.5">"N left" badges show what's still unassigned since the last sort ({formatDateTime(s.sort_run_at)}).</p>}
                            </div>
                            {!isLocked && (
                              <div className="flex items-center gap-1.5">
                                <Input placeholder="New pack name (e.g. Ver. A)" value={newPackName[s.id] || ''} onChange={e => setNewPackName(p => ({ ...p, [s.id]: e.target.value }))} className="w-48 text-xs py-1.5" />
                                <Button size="sm" variant="outline" onClick={() => addPack(s.id)}><Plus size={12} /> Add pack</Button>
                              </div>
                            )}
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
                                      {!isLocked && <button onClick={() => deletePack(s.id, pack.id)} className="text-destructive/50 hover:text-destructive"><Trash2 size={12} /></button>}
                                    </div>
                                    <div className="p-3 space-y-3">
                                      {!isLocked && (
                                        <div className="space-y-1.5">
                                          <div className="flex items-center gap-1.5">
                                            <Input placeholder="New item (e.g. Photocard)" value={newItemName[pack.id] || ''} onChange={e => setNewItemName(p => ({ ...p, [pack.id]: e.target.value }))} className="text-xs py-1.5 flex-1" />
                                            <Button size="sm" variant="outline" onClick={() => addItem(s.id, pack.id)}><Plus size={11} /> Add item</Button>
                                          </div>
                                          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer pl-0.5">
                                            <input type="checkbox" checked={!!newItemIsUnit[pack.id]} onChange={e => setNewItemIsUnit(p => ({ ...p, [pack.id]: e.target.checked }))} className="w-3 h-3 accent-primary" />
                                            Unit item — combine several members into one sorting option (e.g. "Mai + Jungeun") instead of a row per member
                                          </label>
                                        </div>
                                      )}
                                      {items.length === 0 ? (
                                        <p className="text-xs text-muted-foreground">No items in this pack yet.</p>
                                      ) : items.map((item: any) => {
                                        const itemUnits: any[] = (d.units || []).filter((u: any) => u.item_id === item.id)
                                        const draftMembers = unitDraftMembers[item.id] || []
                                        const autoUnitName = draftMembers.map((id: string) => groupMembers.find((m: any) => m.id === id)?.name).filter(Boolean).join(' + ')
                                        return (
                                        <div key={item.id} className="border border-border/60 rounded-lg p-2.5">
                                          <div className="flex items-center justify-between mb-2">
                                            <p className="text-xs font-bold text-primary flex items-center gap-1.5">
                                              {item.name}
                                              {item.is_unit && <span className="text-[10px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-1.5 py-0.5">👥 Unit</span>}
                                            </p>
                                            {!isLocked && <button onClick={() => deleteItem(s.id, item.id)} className="text-destructive/40 hover:text-destructive"><Trash2 size={11} /></button>}
                                          </div>
                                          {item.is_unit ? (
                                            <div className="space-y-1.5">
                                              {itemUnits.length === 0 && (
                                                <p className="text-xs text-muted-foreground">No unit combos yet — build one below (e.g. check "Mai" + "Jungeun").</p>
                                              )}
                                              {itemUnits.map((u: any) => {
                                                const q = (d.quantities || []).find((x: any) => x.item_id === item.id && x.member_id === u.id)
                                                const remaining = q ? (parseInt(q.available) || 0) : null
                                                const total = parseInt(qtyDrafts[item.id]?.[u.id] || '0') || 0
                                                const showRemaining = !!s.sort_run_at && remaining !== null
                                                return (
                                                  <div key={u.id} className="flex items-center gap-2">
                                                    <span className="text-xs flex-1">👥 {u.name}</span>
                                                    {showRemaining && (
                                                      <span
                                                        title="Left unassigned after the last sort — the box on the right is still the original total pulled (used to redo the sort or add more)"
                                                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${
                                                          remaining === 0 ? 'bg-secondary text-muted-foreground border-border'
                                                          : remaining < total ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                        }`}
                                                      >
                                                        {remaining} left
                                                      </span>
                                                    )}
                                                    <Input type="number" min="0" placeholder="0" value={qtyDrafts[item.id]?.[u.id] ?? ''}
                                                      onChange={e => setQtyDrafts(p => ({ ...p, [item.id]: { ...(p[item.id] || {}), [u.id]: e.target.value } }))}
                                                      disabled={isLocked}
                                                      className="w-20 text-xs py-1 disabled:opacity-50" />
                                                    {!isLocked && <button onClick={() => deleteUnit(s.id, u.id)} className="text-destructive/40 hover:text-destructive"><Trash2 size={11} /></button>}
                                                  </div>
                                                )
                                              })}
                                              {!isLocked && groupMembers.length > 0 && (
                                                <div className="border border-dashed border-border rounded-lg p-2 space-y-1.5">
                                                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">New unit combo</p>
                                                  <div className="flex flex-wrap gap-1">
                                                    {groupMembers.map((m: any) => {
                                                      const checked = draftMembers.includes(m.id)
                                                      return (
                                                        <label key={m.id} className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border cursor-pointer transition-colors ${checked ? 'bg-primary/10 border-primary/40 text-primary font-semibold' : 'border-border text-muted-foreground hover:border-primary/30'}`}>
                                                          <input type="checkbox" checked={checked} onChange={() => toggleUnitDraftMember(item.id, m.id)} className="w-3 h-3 accent-primary" />
                                                          {m.name}
                                                        </label>
                                                      )
                                                    })}
                                                  </div>
                                                  <div className="flex items-center gap-1.5">
                                                    <Input placeholder={autoUnitName || 'Combo name'} value={unitDraftName[item.id] ?? autoUnitName} onChange={e => setUnitDraftName(p => ({ ...p, [item.id]: e.target.value }))} className="text-xs py-1 flex-1" />
                                                    <Button size="sm" variant="outline" onClick={() => addUnit(s.id, item.id, groupMembers)} disabled={draftMembers.length === 0}>+ Add</Button>
                                                  </div>
                                                </div>
                                              )}
                                              {!isLocked && itemUnits.length > 0 && (
                                                <div className="flex justify-end pt-1">
                                                  <Button size="sm" variant="outline" onClick={() => saveQuantities(s.id, item.id, itemUnits)}>Save quantities</Button>
                                                </div>
                                              )}
                                            </div>
                                          ) : groupMembers.length === 0 ? (
                                            <p className="text-xs text-muted-foreground">Select a group for this session to set quantities.</p>
                                          ) : (
                                            <div className="space-y-1">
                                              {groupMembers.map((m: any) => {
                                                const q = (d.quantities || []).find((x: any) => x.item_id === item.id && x.member_id === m.id)
                                                const remaining = q ? (parseInt(q.available) || 0) : null
                                                const total = parseInt(qtyDrafts[item.id]?.[m.id] || '0') || 0
                                                const showRemaining = !!s.sort_run_at && remaining !== null
                                                return (
                                                  <div key={m.id} className="flex items-center gap-2">
                                                    <span className="text-xs flex-1">{m.name}</span>
                                                    {showRemaining && (
                                                      <span
                                                        title="Left unassigned after the last sort — the box on the right is still the original total pulled (used to redo the sort or add more)"
                                                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${
                                                          remaining === 0 ? 'bg-secondary text-muted-foreground border-border'
                                                          : remaining < total ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                        }`}
                                                      >
                                                        {remaining} left
                                                      </span>
                                                    )}
                                                    <Input type="number" min="0" placeholder="0" value={qtyDrafts[item.id]?.[m.id] ?? ''}
                                                      onChange={e => setQtyDrafts(p => ({ ...p, [item.id]: { ...(p[item.id] || {}), [m.id]: e.target.value } }))}
                                                      disabled={isLocked}
                                                      className="w-20 text-xs py-1 disabled:opacity-50" />
                                                  </div>
                                                )
                                              })}
                                              {!isLocked && (
                                                <div className="flex justify-end pt-1">
                                                  <Button size="sm" variant="outline" onClick={() => saveQuantities(s.id, item.id, groupMembers)}>Save quantities</Button>
                                                </div>
                                              )}
                                            </div>
                                          )}
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
                        )}

                        {activeTab === 'forms' && (
                        <div className="space-y-5">
                        {/* Inclusions */}
                        {packs.length > 0 && (() => {
                          const totalUnits = totalInclusionUnits(d)
                          const uniqueJoiners = new Set((d.inclusions || []).map((i: any) => i.joiner_id)).size
                          const expected = expectedAssignedTotal(d)
                          return (
                            <div className="flex items-center justify-between p-3 bg-secondary/30 rounded-xl">
                              <div>
                                <p className="text-sm font-semibold">Inclusions assigned</p>
                                <p className="text-xs text-muted-foreground">
                                  {totalUnits} total inclusion{totalUnits !== 1 ? 's' : ''} across {uniqueJoiners} joiner{uniqueJoiners !== 1 ? 's' : ''}
                                  {expected !== totalUnits && <> · {expected} item{expected !== 1 ? 's' : ''} once sorted (packs have more than one item)</>}
                                </p>
                              </div>
                              <Button size="sm" variant="outline" onClick={() => setInclusionsModal(s.id)}>{isLocked ? 'View inclusions' : 'Manage inclusions'}</Button>
                            </div>
                          )
                        })()}

                        {/* Awaiting submission */}
                        {packs.length > 0 && (() => {
                          const pending = pendingJoiners(d)
                          if (pending.length === 0) return null
                          return (
                            <div className="p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl">
                              <p className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-widest mb-2">
                                ⏳ Awaiting submission ({pending.length})
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {pending.map((j: any) => (
                                  <span key={j.joiner_id} className="text-xs px-2.5 py-1 rounded-full bg-background border border-amber-200 dark:border-amber-800 font-medium">
                                    {j.display_name || j.username} <span className="text-muted-foreground font-normal">· {totalInclusionsFor(d, j.joiner_id)} due</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )
                        })()}

                        {/* Priority forms */}
                        <div>
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">
                            Priority forms ({(d.forms || []).length}{pendingJoiners(d).length > 0 ? ` of ${(d.forms || []).length + pendingJoiners(d).length}` : ''} submitted)
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
                        </div>
                        )}

                        {activeTab === 'results' && (
                        <div className="space-y-5">
                        {/* Run sort */}
                        {packs.length > 0 && (() => {
                          const expected = expectedAssignedTotal(d)
                          const staleVsCurrent = lastSort && typeof lastSort.totalDemand === 'number' && lastSort.totalDemand !== expected
                          return (
                            <div className={`p-3 border rounded-xl ${isLocked ? 'border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-900/10' : 'border-primary/20 bg-primary/5'}`}>
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-sm font-semibold">{isLocked ? '🔒 Sort locked' : 'Run sort'}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {isLocked
                                      ? `Locked ${formatDateTime(s.locked_at)} — packs, items, quantities, and inclusions can't be edited, and the sort can't be re-run until you unlock it.`
                                      : <>
                                          {s.sort_run_at ? `Last run ${formatDateTime(s.sort_run_at)} · ${s.sort_method}` : 'Not run yet'}
                                          {expected > 0 && <> · {expected} item{expected !== 1 ? 's' : ''} expected from current inclusions</>}
                                        </>}
                                  </p>
                                </div>
                                {isLocked ? (
                                  <Button size="sm" variant="outline" onClick={() => unlockSort(s.id)} disabled={lockingSession === s.id}>🔓 Unlock</Button>
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <Button size="sm" variant="outline" onClick={() => setSortModal(s.id)}><Check size={12} /> Run sort</Button>
                                    {s.sort_run_at && (
                                      <Button size="sm" onClick={() => lockSort(s.id)} disabled={lockingSession === s.id} title="Locks packs, items, quantities, and inclusions so nothing can shift under this result">
                                        {lockingSession === s.id ? 'Saving…' : <>💾 Save sort</>}
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </div>
                              {lastSort && (
                                <p className="text-xs mt-2 text-muted-foreground">
                                  Assigned {lastSort.assigned} · Unfulfilled {lastSort.unfulfilled}
                                  {typeof lastSort.totalDemand === 'number' && <> (of {lastSort.totalDemand} expected at sort time)</>}
                                  {staleVsCurrent && !isLocked && (
                                    <span className="block text-amber-600 dark:text-amber-400 font-medium mt-1">
                                      ⚠ Inclusions or items changed since this sort ran — {expected} expected now vs {lastSort.totalDemand} then. Re-run to match.
                                    </span>
                                  )}
                                </p>
                              )}
                            </div>
                          )
                        })()}

                        {/* Results */}
                        {(d.assignments || []).length > 0 && (() => {
                          const allAssignments = d.assignments as any[]
                          const rowsByJoiner = allAssignments.reduce((acc: Record<string, any[]>, a: any) => {
                            const key = a.joiner_id || a.display_name || a.username
                            if (!acc[key]) acc[key] = []
                            acc[key].push(a)
                            return acc
                          }, {} as Record<string, any[]>)
                          const joinerCount = Object.keys(rowsByJoiner).length
                          const totalRandom = allAssignments.filter((a: any) => a.is_random).length
                          const totalRepeat = allAssignments.filter((a: any) => a.is_repeat).length
                          const totalGuaranteed = allAssignments.filter((a: any) => a.is_guaranteed).length
                          const expected = expectedAssignedTotal(d)

                          return (
                            <div>
                              <div className="flex items-center justify-between mb-2 gap-3">
                                <div>
                                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Results</p>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {allAssignments.length}{expected > 0 && expected !== allAssignments.length ? ` of ${expected} expected` : ''} item{allAssignments.length !== 1 ? 's' : ''} assigned to {joinerCount} joiner{joinerCount !== 1 ? 's' : ''}
                                    {totalGuaranteed > 0 && <> · <ShieldCheck size={10} className="inline text-emerald-500" /> {totalGuaranteed} guaranteed</>}
                                    {totalRandom > 0 && <> · <Shuffle size={10} className="inline text-sky-500" /> {totalRandom} random</>}
                                    {totalRepeat > 0 && <> · <Repeat size={10} className="inline text-amber-500" /> {totalRepeat} repeat</>}
                                  </p>
                                  {expected > allAssignments.length && (
                                    <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-0.5">
                                      {expected - allAssignments.length} short of current inclusions — either stock ran out at sort time, or inclusions/items changed since. Re-run the sort to refresh.
                                    </p>
                                  )}
                                </div>
                                <button onClick={() => setOwnershipModal(s.id)} className="text-xs text-primary font-semibold hover:underline flex-shrink-0">View ownership</button>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                {Object.entries(rowsByJoiner).map(([joinerId, rows]: [string, any]) => {
                                  const name: string = rows[0].display_name || rows[0].username || String(joinerId)
                                  const byPack = (rows as any[]).reduce((acc: Record<string, any[]>, r: any) => {
                                    if (!acc[r.pack_name]) acc[r.pack_name] = []
                                    acc[r.pack_name].push(r)
                                    return acc
                                  }, {} as Record<string, any[]>)
                                  return (
                                    <div key={joinerId} className="border border-border rounded-xl overflow-hidden">
                                      <div className="flex items-center gap-2 px-3 py-2 bg-secondary/30 border-b border-border">
                                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                                          <span className="text-primary text-[10px] font-bold">{name.slice(0, 2).toUpperCase()}</span>
                                        </div>
                                        <p className="text-sm font-semibold truncate">{name}</p>
                                        <span className="ml-auto text-xs text-muted-foreground flex-shrink-0">{rows.length} item{rows.length !== 1 ? 's' : ''}</span>
                                      </div>
                                      <div className="px-3 py-2 space-y-1.5">
                                        {Object.entries(byPack).map(([packName, packRows]: [string, any]) => (
                                          <div key={packName}>
                                            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{packName}</p>
                                            <div className="flex flex-wrap gap-1">
                                              {(packRows as any[]).map((r: any) => (
                                                <span key={r.id} className="inline-flex items-center gap-1 text-xs pl-2 pr-2 py-1 rounded-full bg-secondary/50 border border-border">
                                                  <span className="text-muted-foreground">{r.item_name}</span>
                                                  <span className="text-foreground font-semibold">{r.member_name}</span>
                                                  {r.is_guaranteed && <span title="Guaranteed — matched a version this joiner specifically claimed, not ranked or competed for"><ShieldCheck size={10} className="text-emerald-500" /></span>}
                                                  {r.is_repeat && <span title="Repeat — every other option was already owned"><Repeat size={10} className="text-amber-500" /></span>}
                                                  {r.is_random && <span title="Random — no priority form was submitted"><Shuffle size={10} className="text-sky-500" /></span>}
                                                </span>
                                              ))}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })()}
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
      <Modal open={createModal} onClose={() => { setCreateModal(false); setForm({ title: '', group_id: '', box_id: '', deadline: '' }); setSelectedOrderIds([]); setSelectedOrderVersions({}) }} title="New Sorting Session" size="lg">
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
              <Select options={boxes.map((b: any) => ({ value: b.id, label: b.label || 'Box' }))} placeholder="Select box…" value={form.box_id} onChange={e => onBoxChange(e.target.value, setSelectedOrderIds, setForm, setSelectedOrderVersions)} />
            </FormField>
            <FormField label="Group">
              <Select options={groups.map((g: any) => ({ value: g.id, label: g.name }))} placeholder="Select group…" value={form.group_id} onChange={e => setForm(f => ({ ...f, group_id: e.target.value }))} />
            </FormField>
          </div>
          {form.box_id && (
            <FormField label="Orders included in this session">
              <p className="text-xs text-muted-foreground mb-2">Inclusion counts will be pulled from these orders. All orders from the box are pre-selected. For a multi-version order, uncheck the versions you don't want feeding this session.</p>
              <OrderPicker
                orders={orders.filter((o: any) => boxLinkedOrderIds(form.box_id).includes(o.id))}
                orderIds={selectedOrderIds} setOrderIds={setSelectedOrderIds}
                orderVersions={selectedOrderVersions} setOrderVersions={setSelectedOrderVersions}
              />
              {selectedOrderIds.length > 0 && <p className="text-xs text-primary font-semibold mt-1">{selectedOrderIds.length} order{selectedOrderIds.length !== 1 ? 's' : ''} selected</p>}
            </FormField>
          )}
          <p className="text-xs text-muted-foreground">After creating the session, add packs (e.g. "Ver. A") and their items, set quantities, then use "Manage inclusions" to auto-fill from these orders.</p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => { setCreateModal(false); setSelectedOrderIds([]); setSelectedOrderVersions({}) }}>Cancel</Button>
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
                    onChange={e => onBoxChange(e.target.value, setEditOrderIds, setEditForm, setEditOrderVersions)} />
                </FormField>
                <FormField label="Group">
                  <Select options={groups.map((g: any) => ({ value: g.id, label: g.name }))} placeholder="Select…" value={editForm.group_id} onChange={e => setEditForm(f => ({ ...f, group_id: e.target.value }))} />
                </FormField>
              </div>
              {editForm.box_id && (
                <FormField label="Orders included in this session">
                  <p className="text-xs text-muted-foreground mb-2">For a multi-version order, uncheck the versions you don't want feeding this session.</p>
                  <OrderPicker
                    orders={editBoxOrders}
                    orderIds={editOrderIds} setOrderIds={setEditOrderIds}
                    orderVersions={editOrderVersions} setOrderVersions={setEditOrderVersions}
                  />
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
        const modalLocked = !!sessions.find((s: any) => s.id === inclusionsModal)?.locked_at
        return (
          <Modal open={true} onClose={() => { setInclusionsModal(null); setInclusionSourcesOpenFor(null) }} title={modalLocked ? 'Inclusions (locked)' : 'Manage Inclusions'} subtitle={modalLocked ? "This session's sort is locked — unlock it (Results tab) to edit inclusions." : "How many full packs (inclusions) each joiner is due, per pack"} size="lg">
            <div className="space-y-4">
              {!modalLocked && (
              <>
              <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/15 rounded-xl">
                <div>
                  <p className="text-sm font-semibold">Auto-fill / refresh from orders</p>
                  <p className="text-xs text-muted-foreground">Sums inclusion counts from this session's selected orders only (plus any claim mentioning "album" in those orders) and splits across packs. Fully replaces every current value, including clearing joiners who no longer qualify.</p>
                </div>
                <Button size="sm" onClick={() => autoFillInclusions(inclusionsModal).then(() => setInclusionsModal(inclusionsModal))}>✨ Auto-fill</Button>
              </div>
              <div className="flex items-center justify-between p-3 bg-destructive/5 border border-destructive/15 rounded-xl">
                <div>
                  <p className="text-sm font-semibold">Reset all inclusions</p>
                  <p className="text-xs text-muted-foreground">Clears every joiner's inclusion count for this session back to zero — for starting over by hand instead of auto-filling. Never touches priority forms or past sort results — joiners' submitted rankings stay exactly as they are.</p>
                </div>
                <Button size="sm" variant="destructive" onClick={() => resetInclusions(inclusionsModal).then(() => setInclusionsModal(inclusionsModal))}>Reset</Button>
              </div>
              </>
              )}
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
                      {joiners.map((j: any) => {
                        const sourcesOpen = inclusionSourcesOpenFor === j.joiner_id
                        const sources = sourcesOpen ? inclusionSourcesForJoiner(d, j.joiner_id) : []
                        return (
                          <Fragment key={j.joiner_id}>
                            <tr>
                              <td className="px-3 py-2 align-top">
                                <button
                                  onClick={() => setInclusionSourcesOpenFor(sourcesOpen ? null : j.joiner_id)}
                                  className="flex items-center gap-1 font-semibold hover:text-primary transition-colors"
                                  title="Show which orders these inclusions were auto-filled from"
                                >
                                  {j.display_name || j.username}
                                  {sourcesOpen ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
                                </button>
                              </td>
                              {packs.map((p: any) => (
                                <td key={p.id} className="px-3 py-2 align-top">
                                  <input type="number" min="0" value={inclusionDrafts[j.joiner_id]?.[p.id] || ''}
                                    onChange={e => setInclusionDrafts(prev => ({ ...prev, [j.joiner_id]: { ...(prev[j.joiner_id] || {}), [p.id]: e.target.value } }))}
                                    disabled={modalLocked}
                                    className="w-16 px-2 py-1.5 rounded-lg border border-input bg-background text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-50" placeholder="0" />
                                </td>
                              ))}
                            </tr>
                            {sourcesOpen && (
                              <tr>
                                <td colSpan={packs.length + 1} className="px-3 pb-2.5 pt-0">
                                  <div className="bg-secondary/30 border border-border rounded-lg px-3 py-2">
                                    {sources.length === 0 ? (
                                      <p className="text-xs text-muted-foreground">Not from this session's orders — this joiner's inclusions were entered by hand, or the order they came from is no longer linked to this session.</p>
                                    ) : (
                                      <div className="flex flex-wrap gap-1.5">
                                        {sources.map(({ order, amount }) => (
                                          <span key={order.id} className="text-xs px-2 py-1 rounded-full bg-background border border-border font-medium">
                                            {amount === -1
                                              ? <>Order {order.id.slice(0, 8)} <span className="text-muted-foreground font-normal">(details unavailable)</span></>
                                              : <>{orderLabel(order)} <span className="text-primary font-semibold">· {amount}</span></>}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={() => { setInclusionsModal(null); setInclusionSourcesOpenFor(null) }}>{modalLocked ? 'Close' : 'Cancel'}</Button>
                {!modalLocked && <Button onClick={() => saveInclusions(inclusionsModal, packs)} disabled={saving}>{saving ? 'Saving…' : 'Save inclusions'}</Button>}
              </div>
            </div>
          </Modal>
        )
      })()}

      {/* Run Sort Modal */}
      {sortModal && (
        <Modal open={true} onClose={() => !sortRunning && setSortModal(null)} title="Run Sort" subtitle="Closes the form and assigns items. Safe to re-run any time — it always redoes the assignments fresh from the current inclusions and stock, using the priority forms already on file. Joiners are never asked to resubmit just because you reran it." size="sm">
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
