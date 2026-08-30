'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus, Send, Pencil, Trash2, ChevronDown, ChevronUp, ToggleLeft, ToggleRight, User } from 'lucide-react'
import { Button, Card, CardHeader, CardContent, Badge, Modal, Input, Select, FormField, PageHeader, EmptyState, StatusBadge } from '@/components/ui'
import { formatDate } from '@/lib/utils'

const STATUS_OPTIONS = [
  { value: 'unpacked', label: 'To Pack' },
  { value: 'sorting', label: 'Sorting' },
  { value: 'packing', label: 'Packing' },
  { value: 'sent', label: 'Sent ✓' },
]
const STATUS_COLORS: Record<string, string> = {
  unpacked: 'bg-secondary text-muted-foreground border border-border',
  sorting: 'bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-900/20 dark:text-sky-300',
  packing: 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-300',
  sent: 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300',
}
const SHIPPING_TYPES = [
  { value: 'letter', label: '✉️ Letter' },
  { value: 'package', label: '📦 Package' },
  { value: 'inpost', label: '🏪 InPost' },
  { value: 'vinted_go', label: '🛍️ Vinted Go' },
  { value: 'vinted', label: '🛍️ Vinted' },
]

const emptyForm = { order_id: '', joiner_id: '', shipping_type: '', courier: '', address: '', email: '', phone: '', status: 'unpacked', weight_g: '', shipping_deadline: '', notes: '' }

function JoinerItemsPanel({ joinerId, joinerName }: { joinerId: string | null; joinerName: string | null }) {
  const [items, setItems] = useState<any[]>([])
  const [sortResults, setSortResults] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!joinerId) { setLoading(false); return }
    Promise.all([
      fetch(`/api/sending-out?joiner_id=${joinerId}`).then(r => r.json()).catch(() => []),
      fetch(`/api/pc-sorter/results?joiner_id=${joinerId}`).then(r => r.json()).catch(() => []),
    ]).then(([its, results]) => {
      setItems(Array.isArray(its) ? its : [])
      setSortResults(Array.isArray(results) ? results : [])
      setLoading(false)
    })
  }, [joinerId])

  if (!joinerId) return <p className="text-sm text-muted-foreground">No joiner linked to this entry.</p>

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">
          {joinerName ? `${joinerName}'s` : 'Joiner'} items currently At GOM
        </p>
        {loading ? <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"/> :
        items.length === 0 ? <p className="text-sm text-muted-foreground">No At GOM items for this joiner.</p> :
        <div className="space-y-1.5">
          {items.map((it: any, idx: number) => (
            <div key={idx} className="flex items-center gap-3 bg-secondary/40 rounded-xl px-4 py-2.5 text-sm">
              <div className="flex-1 min-w-0">
                <p className="font-semibold">{it.description || it.item_type}</p>
                <p className="text-xs text-muted-foreground">
                  {it.shop_name}{it.round_number ? ` #${it.round_number}` : ''}
                  {it.member_name ? ` · ${it.member_name}` : ''}
                </p>
              </div>
              {it.amount_claimed > 1 && <span className="text-xs text-muted-foreground">×{it.amount_claimed}</span>}
              {it.price_eur && <span className="font-mono text-xs">{it.price_eur}€</span>}
            </div>
          ))}
        </div>
        }
      </div>

      {!loading && sortResults.length > 0 && (
        <div>
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">🎴 Sorted PC items to pack</p>
          <div className="space-y-1.5">
            {sortResults.map((r: any) => (
              <div key={r.id} className="flex items-center gap-3 bg-primary/5 border border-primary/10 rounded-xl px-4 py-2.5 text-sm">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{r.member_name}</p>
                  <p className="text-xs text-muted-foreground">{r.session_title} · {r.pack_name} · {r.item_name}{r.is_guaranteed ? ' (guaranteed — matched their claimed version)' : ''}{r.is_repeat ? ' (2nd copy)' : ''}{r.is_random ? ' (random — no form submitted)' : ''}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function GomSendingOutPage() {
  const [entries, setEntries] = useState<any[]>([])
  const [allOrders, setAllOrders] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [editingEntry, setEditingEntry] = useState<any>(null)
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null)
  const [form, setForm] = useState<any>(emptyForm)
  const [saving, setSaving] = useState(false)
  // Global form open/close state (stored as a simple localStorage key for now)
  const [formOpen, setFormOpen] = useState(true)
  const [formDeadline, setFormDeadline] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [e, o, u] = await Promise.all([
      fetch('/api/sending-out').then(r => r.json()),
      fetch('/api/orders').then(r => r.json()),
      fetch('/api/users').then(r => r.json()),
    ])
    const entries = Array.isArray(e) ? e : []
    const orders = Array.isArray(o) ? o : []

    // No auto-insert — GOMs manually add or joiners submit the form
    setEntries(entries)
    setAllOrders(orders)
    setUsers(Array.isArray(u) ? u : [])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
    Promise.all([
      fetch('/api/settings?key=sending_form_open').then(r => r.json()).catch(() => ({ value: 'true' })),
      fetch('/api/settings?key=sending_form_deadline').then(r => r.json()).catch(() => ({ value: '' })),
    ]).then(([open, dl]) => {
      // Auto-close if deadline passed
      const deadlineVal = dl.value || ''
      setFormDeadline(deadlineVal)
      const deadlinePassed = deadlineVal && new Date(deadlineVal) < new Date()
      if (deadlinePassed && open.value !== 'false') {
        setFormOpen(false)
        fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'sending_form_open', value: 'false' }) })
      } else {
        setFormOpen(open.value !== 'false')
      }
    })
  }, [fetchData])

  async function toggleFormOpen() {
    const next = !formOpen
    setFormOpen(next)
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'sending_form_open', value: String(next) }),
    })
  }

  function openNew() { setEditingEntry(null); setForm(emptyForm); setModalOpen(true) }
  function openEdit(e: any) {
    setEditingEntry(e)
    setForm({
      order_id: e.order_id || '', joiner_id: e.joiner_id || '',
      shipping_type: e.shipping_type || '', courier: e.courier || '',
      address: e.address || '', email: e.email || '', phone: e.phone || '',
      status: e.status || 'unpacked', weight_g: e.weight_g ? String(e.weight_g) : '',
      shipping_deadline: e.shipping_deadline?.slice(0, 16) || '', notes: e.notes || '',
    })
    setModalOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    const payload = {
      status: form.status, joiner_id: form.joiner_id || null,
      shipping_type: form.shipping_type || null, courier: form.courier || null,
      address: form.address || null, email: form.email || null, phone: form.phone || null,
      weight_g: form.weight_g ? parseFloat(form.weight_g) : null,
      shipping_deadline: form.shipping_deadline || null, notes: form.notes || null,
    }
    if (editingEntry) {
      await fetch('/api/sending-out', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, id: editingEntry.id }) })
    } else {
      await fetch('/api/sending-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, order_id: form.order_id }) })
    }
    setModalOpen(false); fetchData(); setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this entry?')) return
    await fetch('/api/sending-out', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    fetchData()
  }

  async function updateStatus(id: string, status: string) {
    await fetch('/api/sending-out', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })
    setEntries(prev => prev.map(e => e.id === id ? { ...e, status } : e))
  }

  const filtered = filterStatus
    ? entries.filter(e => e.status === filterStatus)
    : entries

  const orderOptions = allOrders.map((o: any) => ({
    value: o.id,
    label: `${o.shop?.name || '?'}${o.round_number ? ` #${o.round_number}` : ''}${o.group?.name ? ` · ${o.group.name}` : ''} [${o.status}]`,
  }))

  const atGomOrders = allOrders.filter((o: any) => o.status === 'at_gom')

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Sending Out"
        subtitle="Manage packages and track shipping · joiner submissions shown below"
        action={
          <div className="flex items-center gap-2">
            {/* Joiner form toggle */}
            <button
              onClick={toggleFormOpen}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
                formOpen
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300'
                  : 'bg-secondary text-muted-foreground border-border'
              }`}
            >
              {formOpen ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
              Joiner form {formOpen ? 'open' : 'closed'}
            </button>
            <div className="flex items-center gap-2">
              <input type="datetime-local" value={formDeadline} onChange={async e => {
                setFormDeadline(e.target.value)
                await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'sending_form_deadline', value: e.target.value }) })
              }} className="text-xs border border-border rounded-xl px-3 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" title="Form deadline — auto-closes when passed"/>
            </div>
            <Button onClick={openNew}><Plus size={14} /> Manual Entry</Button>
          </div>
        }
      />

      {/* Status filters */}
      <div className="flex gap-2 px-6 py-3 border-b border-border">
        {[{ value: '', label: 'All' }, ...STATUS_OPTIONS].map(s => (
          <button key={s.value} onClick={() => setFilterStatus(s.value)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${filterStatus === s.value ? 'bg-primary text-white shadow-rose-sm' : 'bg-secondary text-muted-foreground hover:bg-secondary/70'}`}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-3">
        {loading
          ? <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
          : filtered.length === 0
            ? <EmptyState icon={Send} title="No packages" description="Orders set to 'At GOM' appear here automatically. Joiners can also submit their shipping info." />
            : filtered.map(e => {
                const statusLabel = STATUS_OPTIONS.find(s => s.value === e.status)?.label || e.status
                const shippingLabel = SHIPPING_TYPES.find(t => t.value === e.shipping_type)?.label
                const isExpanded = expandedEntry === e.id
                const joinerName = e.joiner?.display_name || e.joiner?.username

                return (
                  <Card key={e.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">

                          {/* Joiner avatar */}
                          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/25 to-primary/5 flex items-center justify-center flex-shrink-0 mt-0.5">
                            {joinerName
                              ? <span className="text-primary text-xs font-bold">{joinerName.slice(0, 2).toUpperCase()}</span>
                              : <User size={14} className="text-muted-foreground" />
                            }
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-sm">{joinerName || 'Unassigned'}</p>
                              {e.joiner_submitted && (
                                <Badge className="bg-primary/10 text-primary border border-primary/20 text-xs">Self-submitted</Badge>
                              )}
                              <Badge className={STATUS_COLORS[e.status] || STATUS_COLORS.unpacked}>{statusLabel}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {e.order?.shop?.name || e.shop?.name || 'No linked order'}
                              {shippingLabel && <span className="ml-2">· {shippingLabel}</span>}
                            </p>
                            {/* Contact info */}
                            {(e.address || e.email || e.phone) && (
                              <div className="mt-1.5 space-y-0.5">
                                {e.address && <p className="text-xs text-muted-foreground">📍 {e.address}</p>}
                                {e.email && <p className="text-xs text-muted-foreground">✉️ {e.email}</p>}
                                {e.phone && <p className="text-xs text-muted-foreground">📞 {e.phone}</p>}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <select
                            value={e.status}
                            onChange={ev => updateStatus(e.id, ev.target.value)}
                            className="text-xs border border-border rounded-lg px-2 py-1 bg-background focus:outline-none cursor-pointer"
                          >
                            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </select>

                          {/* Expand to see At GOM orders */}
                          <button
                            onClick={() => setExpandedEntry(isExpanded ? null : e.id)}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-1 rounded-lg hover:bg-secondary"
                          >
                            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            Orders
                          </button>

                          <Button variant="ghost" size="icon" onClick={() => openEdit(e)}><Pencil size={13} /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(e.id)}><Trash2 size={13} className="text-destructive/50 hover:text-destructive" /></Button>
                        </div>
                      </div>
                    </CardHeader>

                    {/* Joiner's At GOM items panel */}
                    {isExpanded && (
                      <CardContent>
                        <JoinerItemsPanel joinerId={e.joiner_id} joinerName={joinerName} />
                      </CardContent>
                    )}
                  </Card>
                )
              })
        }
      </div>

      {/* Edit / New Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingEntry ? 'Edit Package' : 'New Package'} size="lg">
        <div className="space-y-4">
          {!editingEntry && (
            <FormField label="Linked Order">
              <Select options={orderOptions} placeholder="Select order (optional)…" value={form.order_id} onChange={e => setForm((f: any) => ({ ...f, order_id: e.target.value }))} />
            </FormField>
          )}
          {editingEntry && editingEntry.order && (
            <div className="bg-secondary/40 rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground">
              {editingEntry.order?.shop?.name || 'No linked order'}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Joiner">
              <Select options={users.map((u: any) => ({ value: u.id, label: u.display_name || u.username }))} placeholder="Select…" value={form.joiner_id} onChange={e => setForm((f: any) => ({ ...f, joiner_id: e.target.value }))} />
            </FormField>
            <FormField label="Status">
              <Select options={STATUS_OPTIONS} value={form.status} onChange={e => setForm((f: any) => ({ ...f, status: e.target.value }))} />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Shipping Type">
              <Select options={SHIPPING_TYPES} placeholder="Select…" value={form.shipping_type} onChange={e => setForm((f: any) => ({ ...f, shipping_type: e.target.value }))} />
            </FormField>
            <FormField label="Weight (g)">
              <Input type="number" placeholder="0" value={form.weight_g} onChange={e => setForm((f: any) => ({ ...f, weight_g: e.target.value }))} />
            </FormField>
          </div>

          <FormField label="Shipping Address">
            <Input placeholder="Full address" value={form.address} onChange={e => setForm((f: any) => ({ ...f, address: e.target.value }))} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Email">
              <Input type="email" placeholder="joiner@email.com" value={form.email} onChange={e => setForm((f: any) => ({ ...f, email: e.target.value }))} />
            </FormField>
            <FormField label="Phone">
              <Input type="tel" placeholder="+33 6 00 00 00 00" value={form.phone} onChange={e => setForm((f: any) => ({ ...f, phone: e.target.value }))} />
            </FormField>
          </div>

          <FormField label="Notes">
            <textarea className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30" rows={2} value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} />
          </FormField>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : editingEntry ? 'Update' : 'Save'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
