'use client'
import { useEffect, useState, useCallback } from 'react'
import {
  Plus, Send, Pencil, Trash2, ToggleLeft, ToggleRight,
  Package, CreditCard, Truck, CheckCircle2, Check, SkipForward, ArrowLeft, Image as ImageIcon, Settings2,
} from 'lucide-react'
import { Button, Card, CardHeader, CardContent, Badge, Modal, Input, Select, FormField, PageHeader, EmptyState, Checkbox } from '@/components/ui'
import { formatEur, formatDate } from '@/lib/utils'

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'packed', label: 'Packed' },
  { value: 'payment_requested', label: 'Payment Requested' },
  { value: 'payment_complete', label: 'Payment Complete' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'complete', label: 'Complete' },
]
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-secondary text-muted-foreground border border-border',
  packed: 'bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-900/20 dark:text-sky-300',
  payment_requested: 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-300',
  payment_complete: 'bg-teal-50 text-teal-700 border border-teal-200 dark:bg-teal-900/20 dark:text-teal-300',
  shipped: 'bg-violet-50 text-violet-700 border border-violet-200 dark:bg-violet-900/20 dark:text-violet-300',
  complete: 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300',
}
const SHIPPING_TYPES = [
  { value: 'stamped_letter', label: '✉️ Stamped Letter' },
  { value: 'tracked_letter', label: '📨 Tracked Letter' },
  { value: 'package', label: '📦 Package' },
  { value: 'inpost_mondial', label: '🏪 InPost / Mondial Relay' },
  { value: 'vinted_go', label: '🛍️ Vinted Go' },
  { value: 'vinted', label: '🛍️ Vinted' },
]
const shippingLabel = (v: string) => SHIPPING_TYPES.find(t => t.value === v)?.label || v

const emptyManualForm = { form_id: '', joiner_id: '', full_name: '', email: '', phone: '', address: '', shipping_type: '', notes: '' }
const emptyFormDraft = { id: '', title: '', box_ids: [] as string[], deadline: '', form_open: false }

// ── Pack wizard ─────────────────────────────────────────────
function PackWizard({ shipment, onClose, onDone }: { shipment: any; onClose: () => void; onDone: () => void }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/shipments/${shipment.id}/pack`).then(r => r.json()).catch(() => null)
    setData(res)
    setLoading(false)
  }, [shipment.id])

  useEffect(() => { load() }, [load])

  async function act(action: string, item_id?: string) {
    setBusy(true); setError('')
    const res = await fetch(`/api/shipments/${shipment.id}/pack`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, item_id }),
    })
    if (action === 'finalize') {
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || 'Could not finish packing'); setBusy(false); return }
      setBusy(false); onDone(); return
    }
    await load()
    setIndex(i => Math.min(i + 1, (data?.items?.length || 1) - 1))
    setBusy(false)
  }

  if (loading) return (
    <Modal open onClose={onClose} title="Packing…" size="lg">
      <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
    </Modal>
  )

  const items: any[] = data?.items || []
  const previewImages: Record<string, string> = data?.previewImages || {}
  const progress = data?.progress || { total: 0, confirmed: 0, skipped: 0, remaining: 0 }
  const joinerName = shipment.joiner?.display_name || shipment.joiner?.username || 'Joiner'

  if (items.length === 0) {
    return (
      <Modal open onClose={onClose} title={`Packing — ${joinerName}`} size="lg">
        <EmptyState icon={Package} title="Nothing to pack" description="No At-GOM items or sorted photocards were found for this joiner in this form's boxes." />
        <div className="flex justify-end"><Button variant="outline" onClick={onClose}>Close</Button></div>
      </Modal>
    )
  }

  const current = items[Math.min(index, items.length - 1)]
  const allDone = progress.remaining === 0

  return (
    <Modal open onClose={onClose} title={`Packing — ${joinerName}`} subtitle={`Item ${Math.min(index + 1, items.length)} of ${items.length}`} size="lg">
      <div className="space-y-4">
        <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${((progress.confirmed + progress.skipped) / progress.total) * 100}%` }} />
        </div>

        <Card>
          {current.has_preview && current.order_id && previewImages[current.order_id] && (
            <img src={previewImages[current.order_id]} alt="preview" className="w-full max-h-64 object-contain bg-secondary/40 border-b border-border" />
          )}
          {!(current.has_preview && current.order_id && previewImages[current.order_id]) && (
            <div className="w-full h-32 flex items-center justify-center bg-secondary/40 border-b border-border text-muted-foreground/40">
              <ImageIcon size={28} />
            </div>
          )}
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={current.source_type === 'pc_assignment' ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-secondary text-muted-foreground border border-border'}>
                {current.source_type === 'pc_assignment' ? '🎴 Sorted item' : 'Claimed item'}
              </Badge>
              {current.is_guaranteed && <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200">✓ Guaranteed</Badge>}
              {current.is_repeat && <Badge className="bg-secondary text-muted-foreground border border-border">2nd copy</Badge>}
              {current.is_random && <Badge className="bg-secondary text-muted-foreground border border-border">Random</Badge>}
              {current.confirmed && <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200">Confirmed</Badge>}
              {current.skipped && <Badge className="bg-amber-50 text-amber-700 border border-amber-200">Skipped</Badge>}
            </div>
            <p className="font-display font-semibold text-lg">{current.label}</p>
            {current.member_name && <p className="text-sm text-muted-foreground">{current.member_name}</p>}
            {current.sub_label && <p className="text-xs text-muted-foreground">{current.sub_label}</p>}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {current.amount_claimed > 1 && <span>×{current.amount_claimed}</span>}
              {current.price_eur && <span className="font-mono">{formatEur(current.price_eur)}</span>}
            </div>
          </CardContent>
        </Card>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={index === 0}>
            <ArrowLeft size={13} /> Back
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => act('skip', current.id)}>
              <SkipForward size={13} /> Skip
            </Button>
            <Button size="sm" disabled={busy} onClick={() => act('confirm', current.id)}>
              <Check size={13} /> Confirm in box
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            {progress.confirmed} confirmed · {progress.skipped} skipped · {progress.remaining} remaining
          </p>
          <Button size="sm" variant={allDone ? 'default' : 'outline'} disabled={busy} onClick={() => act('finalize')}>
            <CheckCircle2 size={13} /> Mark as Packed
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Forms manager ────────────────────────────────────────────
function FormsManager({ forms, boxes, onClose, onChanged }: { forms: any[]; boxes: any[]; onClose: () => void; onChanged: () => void }) {
  const [draft, setDraft] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const payload = { title: draft.title, box_ids: draft.box_ids, deadline: draft.deadline || null, form_open: draft.form_open }
    if (draft.id) {
      await fetch('/api/shipping-forms', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, id: draft.id }) })
    } else {
      await fetch('/api/shipping-forms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    }
    setSaving(false); setDraft(null); onChanged()
  }

  async function toggleOpen(f: any) {
    await fetch('/api/shipping-forms', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: f.id, form_open: !f.form_open }) })
    onChanged()
  }
  async function del(f: any) {
    if (!confirm(`Delete "${f.title}"? Its shipments will be deleted too.`)) return
    await fetch('/api/shipping-forms', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: f.id }) })
    onChanged()
  }

  return (
    <Modal open onClose={onClose} title="Shipping Forms" subtitle="Several forms can be open at once, each covering its own set of boxes" size="lg">
      <div className="space-y-4">
        {!draft && (
          <Button size="sm" onClick={() => setDraft({ ...emptyFormDraft })}><Plus size={13} /> New form</Button>
        )}

        {draft ? (
          <Card>
            <CardContent className="space-y-4">
              <FormField label="Title" required>
                <Input placeholder="e.g. FR Boxes" value={draft.title} onChange={e => setDraft((d: any) => ({ ...d, title: e.target.value }))} />
              </FormField>
              <FormField label="Boxes covered by this form" required>
                <div className="space-y-1.5 max-h-48 overflow-auto border border-border rounded-xl p-3">
                  {boxes.length === 0 && <p className="text-xs text-muted-foreground">No boxes yet — create one on the Boxes page first.</p>}
                  {boxes.map((b: any) => (
                    <Checkbox key={b.id} id={`box-${b.id}`} label={b.label || 'Untitled box'}
                      checked={draft.box_ids.includes(b.id)}
                      onChange={() => setDraft((d: any) => ({ ...d, box_ids: d.box_ids.includes(b.id) ? d.box_ids.filter((x: string) => x !== b.id) : [...d.box_ids, b.id] }))} />
                  ))}
                </div>
              </FormField>
              <FormField label="Deadline (optional)">
                <input type="datetime-local" value={draft.deadline} onChange={e => setDraft((d: any) => ({ ...d, deadline: e.target.value }))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/25" />
              </FormField>
              <Checkbox id="form-open-now" label="Open immediately" checked={draft.form_open} onChange={e => setDraft((d: any) => ({ ...d, form_open: e.target.checked }))} />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
                <Button onClick={save} disabled={saving || !draft.title || draft.box_ids.length === 0}>{saving ? 'Saving…' : 'Save'}</Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {forms.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No shipping forms yet.</p>}
            {forms.map(f => (
              <Card key={f.id}>
                <CardContent className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{f.title}</p>
                      <Badge className={f.form_open ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-secondary text-muted-foreground border border-border'}>
                        {f.form_open ? 'Open' : 'Closed'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{f.shipment_count || 0} shipment{f.shipment_count === 1 ? '' : 's'}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(f.boxes || []).map((b: any) => b.label || 'Untitled').join(', ') || 'No boxes'}
                      {f.deadline && <span> · Deadline {formatDate(f.deadline)}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => toggleOpen(f)} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground" title={f.form_open ? 'Close form' : 'Open form'}>
                      {f.form_open ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    </button>
                    <Button variant="ghost" size="icon" onClick={() => setDraft({ id: f.id, title: f.title, box_ids: (f.boxes || []).map((b: any) => b.id), deadline: f.deadline?.slice(0, 16) || '', form_open: f.form_open })}><Pencil size={13} /></Button>
                    <Button variant="ghost" size="icon" onClick={() => del(f)}><Trash2 size={13} className="text-destructive/50 hover:text-destructive" /></Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── Main page ─────────────────────────────────────────────────
export default function GomSendingOutPage() {
  const [forms, setForms] = useState<any[]>([])
  const [shipments, setShipments] = useState<any[]>([])
  const [boxes, setBoxes] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [formsModalOpen, setFormsModalOpen] = useState(false)
  const [manualModalOpen, setManualModalOpen] = useState(false)
  const [manualForm, setManualForm] = useState<any>(emptyManualForm)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editForm, setEditForm] = useState<any>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [paymentModal, setPaymentModal] = useState<any>(null)
  const [paymentDraft, setPaymentDraft] = useState({ price_eur: '', payment_info: '' })
  const [shipModal, setShipModal] = useState<any>(null)
  const [trackingDraft, setTrackingDraft] = useState('')
  const [packing, setPacking] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  const [filterForm, setFilterForm] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [sortBy, setSortBy] = useState('newest')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [f, sh, b, u] = await Promise.all([
      fetch('/api/shipping-forms').then(r => r.json()).catch(() => []),
      fetch('/api/shipments').then(r => r.json()).catch(() => []),
      fetch('/api/boxes').then(r => r.json()).catch(() => []),
      fetch('/api/users').then(r => r.json()).catch(() => []),
    ])
    setForms(Array.isArray(f) ? f : [])
    setShipments(Array.isArray(sh) ? sh : [])
    setBoxes(Array.isArray(b) ? b : [])
    setUsers(Array.isArray(u) ? u : [])
    setLoading(false)
  }, [])
  useEffect(() => { fetchData() }, [fetchData])

  async function updateStatus(id: string, status: string) {
    await fetch('/api/shipments', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })
    fetchData()
  }
  async function handleDelete(id: string) {
    if (!confirm('Delete this shipment?')) return
    await fetch('/api/shipments', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    fetchData()
  }
  async function saveManual() {
    setSaving(true)
    await fetch('/api/shipments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...manualForm, joiner_id: manualForm.joiner_id, manual: true }),
    })
    setSaving(false); setManualModalOpen(false); setManualForm(emptyManualForm); fetchData()
  }
  function openEdit(sh: any) {
    setEditingId(sh.id)
    setEditForm({
      full_name: sh.full_name || '', email: sh.email || '', phone: sh.phone || '',
      address: sh.address || '', shipping_type: sh.shipping_type || '', notes: sh.notes || '',
    })
    setEditModalOpen(true)
  }
  async function saveEdit() {
    setSaving(true)
    await fetch('/api/shipments', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...editForm, id: editingId }) })
    setSaving(false); setEditModalOpen(false); fetchData()
  }
  async function submitPaymentRequest() {
    setSaving(true)
    await fetch('/api/shipments', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: paymentModal.id, request_payment: true, price_eur: parseFloat(paymentDraft.price_eur) || 0, payment_info: paymentDraft.payment_info || null }),
    })
    setSaving(false); setPaymentModal(null); setPaymentDraft({ price_eur: '', payment_info: '' }); fetchData()
  }
  async function submitShip() {
    setSaving(true)
    await fetch('/api/shipments', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: shipModal.id, tracking_code: trackingDraft || null, status: 'shipped' }) })
    setSaving(false); setShipModal(null); setTrackingDraft(''); fetchData()
  }

  let filtered = shipments
  if (filterForm) filtered = filtered.filter(s => s.form_id === filterForm)
  if (filterStatus) filtered = filtered.filter(s => s.status === filterStatus)
  if (filterType) filtered = filtered.filter(s => s.shipping_type === filterType)
  filtered = [...filtered].sort((a, b) => {
    if (sortBy === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    if (sortBy === 'name') return (a.joiner?.display_name || a.joiner?.username || '').localeCompare(b.joiner?.display_name || b.joiner?.username || '')
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  const manualFormBoxIds = (forms.find(f => f.id === manualForm.form_id)?.boxes || []).map((b: any) => b.id)

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Sending Out"
        subtitle="Manage shipping forms, packing, payment and shipping"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setFormsModalOpen(true)}><Settings2 size={14} /> Forms ({forms.filter(f => f.form_open).length} open)</Button>
            <Button onClick={() => setManualModalOpen(true)}><Plus size={14} /> Manual Entry</Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-b border-border">
        <Select options={[{ value: '', label: 'All forms' }, ...forms.map(f => ({ value: f.id, label: f.title }))]} value={filterForm} onChange={e => setFilterForm(e.target.value)} className="w-auto max-w-[220px]" />
        <Select options={[{ value: '', label: 'All statuses' }, ...STATUS_OPTIONS]} value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="w-auto max-w-[200px]" />
        <Select options={[{ value: '', label: 'All shipping types' }, ...SHIPPING_TYPES]} value={filterType} onChange={e => setFilterType(e.target.value)} className="w-auto max-w-[220px]" />
        <Select options={[{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }, { value: 'name', label: 'Joiner name A–Z' }]} value={sortBy} onChange={e => setSortBy(e.target.value)} className="w-auto max-w-[180px]" />
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-3">
        {loading
          ? <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
          : filtered.length === 0
            ? <EmptyState icon={Send} title="No shipments" description="Open a shipping form for one or more boxes so joiners can submit their info, or add one manually." />
            : filtered.map(sh => {
                const joinerName = sh.joiner?.display_name || sh.joiner?.username || 'Unassigned'
                return (
                  <Card key={sh.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/25 to-primary/5 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <span className="text-primary text-xs font-bold">{joinerName.slice(0, 2).toUpperCase()}</span>
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-sm">{joinerName}</p>
                              <Badge className="bg-secondary text-muted-foreground border border-border text-xs">{sh.form_title || 'No form'}</Badge>
                              <Badge className={STATUS_COLORS[sh.status] || STATUS_COLORS.pending}>{STATUS_OPTIONS.find(s => s.value === sh.status)?.label || sh.status}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {sh.shipping_type && shippingLabel(sh.shipping_type)}
                              {sh.price_eur != null && <span className="ml-2 font-mono">{formatEur(sh.price_eur)}</span>}
                              {sh.tracking_code && <span className="ml-2">📮 {sh.tracking_code}</span>}
                            </p>
                            <div className="mt-1.5 space-y-0.5">
                              {sh.address && <p className="text-xs text-muted-foreground">📍 {sh.address}</p>}
                              {sh.email && <p className="text-xs text-muted-foreground">✉️ {sh.email}</p>}
                              {sh.phone && <p className="text-xs text-muted-foreground">📞 {sh.phone}</p>}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                          <select value={sh.status} onChange={e => updateStatus(sh.id, e.target.value)}
                            className="text-xs border border-border rounded-lg px-2 py-1 bg-background focus:outline-none cursor-pointer">
                            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </select>
                          <Button variant="outline" size="sm" onClick={() => setPacking(sh)}><Package size={13} /> Pack</Button>
                          <Button variant="outline" size="sm" onClick={() => { setPaymentModal(sh); setPaymentDraft({ price_eur: sh.price_eur != null ? String(sh.price_eur) : '', payment_info: sh.payment_info || '' }) }}><CreditCard size={13} /> Payment</Button>
                          <Button variant="outline" size="sm" onClick={() => { setShipModal(sh); setTrackingDraft(sh.tracking_code || '') }}><Truck size={13} /> Ship</Button>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(sh)}><Pencil size={13} /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(sh.id)}><Trash2 size={13} className="text-destructive/50 hover:text-destructive" /></Button>
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                )
              })
        }
      </div>

      {formsModalOpen && <FormsManager forms={forms} boxes={boxes} onClose={() => setFormsModalOpen(false)} onChanged={fetchData} />}
      {packing && <PackWizard shipment={packing} onClose={() => setPacking(null)} onDone={() => { setPacking(null); fetchData() }} />}

      {/* Manual entry */}
      <Modal open={manualModalOpen} onClose={() => setManualModalOpen(false)} title="Manual Entry" size="lg">
        <div className="space-y-4">
          <FormField label="Shipping Form" required>
            <Select options={forms.map(f => ({ value: f.id, label: f.title }))} placeholder="Select a form…" value={manualForm.form_id} onChange={e => setManualForm((f: any) => ({ ...f, form_id: e.target.value }))} />
          </FormField>
          <FormField label="Joiner" required>
            <Select options={users.map((u: any) => ({ value: u.id, label: u.display_name || u.username }))} placeholder="Select…" value={manualForm.joiner_id} onChange={e => setManualForm((f: any) => ({ ...f, joiner_id: e.target.value }))} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Full Name"><Input value={manualForm.full_name} onChange={e => setManualForm((f: any) => ({ ...f, full_name: e.target.value }))} /></FormField>
            <FormField label="Shipping Type">
              <Select options={SHIPPING_TYPES} placeholder="Select…" value={manualForm.shipping_type} onChange={e => setManualForm((f: any) => ({ ...f, shipping_type: e.target.value }))} />
            </FormField>
          </div>
          <FormField label="Shipping Address"><Input value={manualForm.address} onChange={e => setManualForm((f: any) => ({ ...f, address: e.target.value }))} /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Email"><Input type="email" value={manualForm.email} onChange={e => setManualForm((f: any) => ({ ...f, email: e.target.value }))} /></FormField>
            <FormField label="Phone"><Input type="tel" value={manualForm.phone} onChange={e => setManualForm((f: any) => ({ ...f, phone: e.target.value }))} /></FormField>
          </div>
          <FormField label="Notes"><textarea className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30" rows={2} value={manualForm.notes} onChange={e => setManualForm((f: any) => ({ ...f, notes: e.target.value }))} /></FormField>
          {manualForm.form_id && manualFormBoxIds.length === 0 && <p className="text-xs text-amber-600">This form has no boxes linked — packing won't find any items.</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setManualModalOpen(false)}>Cancel</Button>
            <Button onClick={saveManual} disabled={saving || !manualForm.form_id || !manualForm.joiner_id}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </Modal>

      {/* Edit shipment */}
      <Modal open={editModalOpen} onClose={() => setEditModalOpen(false)} title="Edit Shipment" size="lg">
        {editForm && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Full Name"><Input value={editForm.full_name} onChange={e => setEditForm((f: any) => ({ ...f, full_name: e.target.value }))} /></FormField>
              <FormField label="Shipping Type">
                <Select options={SHIPPING_TYPES} placeholder="Select…" value={editForm.shipping_type} onChange={e => setEditForm((f: any) => ({ ...f, shipping_type: e.target.value }))} />
              </FormField>
            </div>
            <FormField label="Shipping Address"><Input value={editForm.address} onChange={e => setEditForm((f: any) => ({ ...f, address: e.target.value }))} /></FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Email"><Input type="email" value={editForm.email} onChange={e => setEditForm((f: any) => ({ ...f, email: e.target.value }))} /></FormField>
              <FormField label="Phone"><Input type="tel" value={editForm.phone} onChange={e => setEditForm((f: any) => ({ ...f, phone: e.target.value }))} /></FormField>
            </div>
            <FormField label="Notes"><textarea className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30" rows={2} value={editForm.notes} onChange={e => setEditForm((f: any) => ({ ...f, notes: e.target.value }))} /></FormField>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setEditModalOpen(false)}>Cancel</Button>
              <Button onClick={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Update'}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Request payment */}
      <Modal open={!!paymentModal} onClose={() => setPaymentModal(null)} title="Request Shipment Payment" subtitle={paymentModal ? (paymentModal.joiner?.display_name || paymentModal.joiner?.username) : ''}>
        <div className="space-y-4">
          <FormField label="Price (EUR)" required>
            <Input type="number" step="0.01" placeholder="0.00" value={paymentDraft.price_eur} onChange={e => setPaymentDraft(d => ({ ...d, price_eur: e.target.value }))} />
          </FormField>
          <FormField label="Payment Info (shown to the joiner)">
            <textarea className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30" rows={2} placeholder="e.g. PayPal: gom@example.com" value={paymentDraft.payment_info} onChange={e => setPaymentDraft(d => ({ ...d, payment_info: e.target.value }))} />
          </FormField>
          <p className="text-xs text-muted-foreground">This shows up as an outstanding payment on the joiner's Payments page. Status moves to "Payment Requested".</p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setPaymentModal(null)}>Cancel</Button>
            <Button onClick={submitPaymentRequest} disabled={saving || !paymentDraft.price_eur}>{saving ? 'Sending…' : 'Request Payment'}</Button>
          </div>
        </div>
      </Modal>

      {/* Ship */}
      <Modal open={!!shipModal} onClose={() => setShipModal(null)} title="Ship" subtitle={shipModal ? (shipModal.joiner?.display_name || shipModal.joiner?.username) : ''}>
        <div className="space-y-4">
          <FormField label="Tracking Code (optional)">
            <Input placeholder="e.g. LA123456789FR" value={trackingDraft} onChange={e => setTrackingDraft(e.target.value)} />
          </FormField>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setShipModal(null)}>Cancel</Button>
            <Button onClick={submitShip} disabled={saving}>{saving ? 'Saving…' : 'Mark as Shipped'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
