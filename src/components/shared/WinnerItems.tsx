'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trophy, Plus, Pencil, Trash2, Copy, ImagePlus, Settings2, Archive, ArchiveRestore, Check, X } from 'lucide-react'
import { Button, Input, Modal, Textarea } from '@/components/ui'
import { formatDate, formatEur, formatKrw } from '@/lib/utils'
import { EventForm } from './Events'

// Winner items (polaroids, signed PCs…) — see src/lib/winnerItems.ts for the rules.
// Kept client-side copies of the labels so this file has no server imports.

export const STATUS_LABELS: Record<string, string> = {
  won: 'Not received yet', received: 'Received', listed: 'Listed for sale', kept: 'Kept', sold: 'Sold', given: 'Given away', missing: 'Missing',
}
const STATUS_TONE: Record<string, string> = {
  won: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800',
  received: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-300 dark:border-sky-800',
  listed: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-800',
  kept: 'bg-secondary text-secondary-foreground border-border',
  sold: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800',
  given: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:border-rose-800',
  missing: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800',
}
export const SOURCE_LABELS: Record<string, string> = {
  fansign: 'Fansign', fancall: 'Fancall', diy_event: 'DIY event', lucky_draw: 'Lucky draw', vce: 'VCE', pob_event: 'POB / pre-order event', other: 'Other…',
}
const sourceText = (i: any) => i.source_text || (i.source === 'other' ? (i.source_label || 'Other') : SOURCE_LABELS[i.source] || i.source)
const roundLabel = (r: any) => r == null || r === '' ? null : /^\d+$/.test(String(r)) ? `R${r}` : String(r)
export const orderTitle = (o: any) => [o?.shop_name || o?.order_shop_name || 'No shop', roundLabel(o?.round_number ?? o?.order_round)].filter(Boolean).join(' · ')
const membersText = (i: any) => (i.member_names || []).length ? i.member_names.join(' + ') : 'Not revealed yet'
const photoSrc = (i: any) => `/api/winner-items/${i.id}/photo?v=${encodeURIComponent(i.updated_at || '')}`

function resizePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const max = 800, scale = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')) }
    img.src = url
  })
}

async function post(body: any) {
  const res = await fetch('/api/winner-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out.error || 'Something went wrong')
  return out
}

// Modals rendered into <body>, so they sit above the order side panel.
export function Portal({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  return ready ? createPortal(<div className="relative z-[70]">{children}</div>, document.body) : null
}

export function WinnerStatusChip({ status }: { status: string }) {
  return <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${STATUS_TONE[status] || STATUS_TONE.kept}`}>{STATUS_LABELS[status] || status}</span>
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-2.5 py-1 rounded-lg border text-xs font-semibold transition-colors ${on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:border-primary/40'}`}>
      {children}
    </button>
  )
}

const F = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <label className="block space-y-1.5">
    <span className="text-xs font-semibold text-muted-foreground">{label}</span>
    {children}
    {hint && <span className="text-[11px] text-muted-foreground block">{hint}</span>}
  </label>
)
const sel = 'w-full px-3 py-2 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/25'

// ─────────────────────────────────────────────────────────────
// Add / edit form
// ─────────────────────────────────────────────────────────────

const emptyForm = {
  event_id: '',
  type_id: 'polaroid', member_ids: [] as string[], order_id: '', order_section: '', version_id: '',
  source: 'fansign', source_label: '', fancall_id: '', event_date: '', received_date: '',
  status: 'won', kept_by: '', recipient_id: '', sale_price_eur: '', sale_price_krw: '', sale_date: '', ship_box_id: '',
  note: '', photo_url: undefined as string | null | undefined, count: '1',
}

export function WinnerItemForm({ open, eraId, orderId, eventId, item, onClose, onSaved }: {
  open: boolean; eraId: string; orderId?: string | null; eventId?: string | null; item?: any | null; onClose: () => void; onSaved: () => void
}) {
  const [newEvent, setNewEvent] = useState(false)
  const [opts, setOpts] = useState<any | null>(null)
  const [f, setF] = useState({ ...emptyForm })
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [newType, setNewType] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const loadOpts = useCallback(() => fetch(`/api/winner-items/options?era_id=${eraId}`).then(r => r.json()).then(d => setOpts(d?.era ? d : null)).catch(() => {}), [eraId])
  useEffect(() => { if (open) loadOpts() }, [open, loadOpts])

  useEffect(() => {
    if (!open) return
    setError(''); setNewType(null)
    if (item) {
      setF({
        ...emptyForm,
        event_id: item.event_id || '',
        type_id: item.type_id, member_ids: item.member_ids || [], order_id: item.order_id || '', order_section: item.order_section || '',
        version_id: item.version_id || '', source: item.source, source_label: item.source_label || '', fancall_id: item.fancall_id || '',
        event_date: item.event_date || '', received_date: item.received_date || '', status: item.status,
        kept_by: item.kept_by || '', recipient_id: item.recipient_id || '',
        sale_price_eur: item.sale_price_eur != null ? String(item.sale_price_eur) : '', sale_price_krw: item.sale_price_krw != null ? String(item.sale_price_krw) : '',
        sale_date: item.sale_date || '', ship_box_id: item.ship_box_id || '', note: item.note || '', photo_url: undefined, count: '1',
      })
      setPhotoPreview(item.has_photo ? photoSrc(item) : null)
    } else {
      setF({ ...emptyForm, order_id: orderId || '', event_id: eventId || '' })
      setPhotoPreview(null)
    }
  }, [open, item, orderId, eventId])

  // New item from an order: preselect the order's only open event.
  useEffect(() => {
    if (!open || item || eventId || !orderId || !opts?.events) return
    const mine = opts.events.filter((e: any) => e.order_id === orderId && e.result !== 'lost')
    if (mine.length === 1) setF(prev => (prev.event_id ? prev : { ...prev, event_id: mine[0].id }))
  }, [open, item, eventId, orderId, opts])

  const set = (patch: Partial<typeof emptyForm>) => setF(prev => ({ ...prev, ...patch }))
  // Archive item = created before events existed (no event): keeps its own order / source / date fields.
  const archived = !!item && !item.event_id
  const ev = opts?.events?.find((e: any) => e.id === f.event_id)
  const order = opts?.orders?.find((o: any) => o.id === (archived ? f.order_id : ev?.order_id))
  const eventLabel = (e: any) => [e.type_text, e.event_day ? formatDate(e.event_day) : 'no date', e.shop_name || (e.order_id ? orderTitle(e) : null),
    e.result === 'pending' ? 'pending' : e.result === 'lost' ? 'lost' : null].filter(Boolean).join(' · ')
  // Events of this order first, Lost ones last (not pickable)
  const eventChoices = (opts?.events || []).slice().sort((a: any, b: any) =>
    Number(a.result === 'lost') - Number(b.result === 'lost') || Number(b.order_id === orderId) - Number(a.order_id === orderId))
  const fancall = opts?.fancalls?.find((x: any) => x.id === f.fancall_id)
  const fancallLabel = (x: any) => [x.fancall_datetime ? formatDate(x.fancall_datetime) : 'No date', x.shop_name, x.entered_by_name, x.won ? 'won ✓' : null].filter(Boolean).join(' · ')
  const types = (opts?.types || []).filter((t: any) => !t.archived || t.id === f.type_id)

  async function addType() {
    const name = (newType || '').trim()
    if (!name) return
    try { const t = await post({ action: 'type_add', name }); await loadOpts(); set({ type_id: t.id }); setNewType(null) } catch (e: any) { setError(e.message) }
  }
  async function pickPhoto(file?: File | null) {
    if (!file) return
    try { const url = await resizePhoto(file); set({ photo_url: url }); setPhotoPreview(url) } catch (e: any) { setError(e.message) }
  }
  async function save() {
    setSaving(true); setError('')
    try {
      const body: any = { ...f, era_id: eraId, order_id: f.order_id || null, event_id: f.event_id || null }
      if (body.photo_url === undefined) delete body.photo_url
      if (!archived) { delete body.order_id; delete body.source; delete body.source_label; delete body.fancall_id; delete body.event_date }
      await post(item ? { action: 'update', id: item.id, ...body } : { action: 'create', ...body })
      onSaved(); onClose()
    } catch (e: any) { setError(e.message) }
    setSaving(false)
  }

  if (!open) return null
  const handedOver = f.status === 'sold' || f.status === 'given'
  const userLabel = (u: any) => `${u.name}${u.role !== 'joiner' ? ` (${u.role})` : ''}`

  return (
    <Portal>
      <Modal open onClose={onClose} title={item ? 'Edit winner item' : 'Add winner item'} subtitle={opts ? `${opts.era.name}${opts.era.group_name ? ` · ${opts.era.group_name}` : ''}` : undefined} size="lg">
        {!opts ? <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div> : (
          <div className="space-y-5">
            {/* What */}
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Item type</span>
              <div className="flex flex-wrap gap-1.5">
                {types.map((t: any) => <Chip key={t.id} on={f.type_id === t.id} onClick={() => set({ type_id: t.id })}>{t.name}{t.archived ? ' (archived)' : ''}</Chip>)}
                {newType === null ? (
                  <button type="button" onClick={() => setNewType('')} className="px-2.5 py-1 rounded-lg border border-dashed border-border text-xs font-semibold text-muted-foreground hover:text-foreground"><Plus size={11} className="inline -mt-0.5"/> New type</button>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <Input autoFocus value={newType} onChange={e => setNewType(e.target.value)} placeholder="e.g. Signed album" className="py-1 text-xs w-40"
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addType() } if (e.key === 'Escape') setNewType(null) }}/>
                    <button type="button" onClick={addType} className="p-1 text-emerald-600" title="Add"><Check size={14}/></button>
                    <button type="button" onClick={() => setNewType(null)} className="p-1 text-muted-foreground" title="Cancel"><X size={14}/></button>
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Member(s)</span>
              <div className="flex flex-wrap gap-1.5">
                <Chip on={f.member_ids.length === 0} onClick={() => set({ member_ids: [] })}>Not revealed yet</Chip>
                {opts.members.map((m: any) => (
                  <Chip key={m.id} on={f.member_ids.includes(m.id)} onClick={() => set({ member_ids: f.member_ids.includes(m.id) ? f.member_ids.filter(x => x !== m.id) : [...f.member_ids, m.id] })}>{m.name}</Chip>
                ))}
              </div>
              <span className="text-[11px] text-muted-foreground block">Pick several for a unit or group item.</span>
            </div>

            {archived ? (<>
            {/* Archive item: its own order / source / date */}
            <div className="grid gap-3 sm:grid-cols-2">
              <F label="Order (optional)">
                <select className={sel} value={f.order_id} onChange={e => set({ order_id: e.target.value, order_section: '' })}>
                  <option value="">No order (directly on the era)</option>
                  {opts.orders.map((o: any) => <option key={o.id} value={o.id}>{orderTitle(o)}</option>)}
                </select>
              </F>
              {order && order.sections.length > 0 ? (
                <F label="Part of the order (optional)">
                  <select className={sel} value={f.order_section} onChange={e => {
                    const s = order.sections.find((x: any) => x.key === e.target.value)
                    set({ order_section: e.target.value, ...(s?.version_id && !f.version_id ? { version_id: s.version_id } : {}) })
                  }}>
                    <option value="">Whole order</option>
                    {order.sections.map((s: any) => <option key={s.key} value={s.key}>{s.label}{s.version_name && s.version_name !== s.label ? ` (${s.version_name})` : ''}</option>)}
                  </select>
                </F>
              ) : (
                <F label="Version (optional)">
                  <select className={sel} value={f.version_id} onChange={e => set({ version_id: e.target.value })}>
                    <option value="">No specific version</option>
                    {opts.versions.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </F>
              )}
              {order && order.sections.length > 0 && (
                <F label="Version (optional)">
                  <select className={sel} value={f.version_id} onChange={e => set({ version_id: e.target.value })}>
                    <option value="">No specific version</option>
                    {opts.versions.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </F>
              )}
            </div>

            {/* Where from */}
            <div className="grid gap-3 sm:grid-cols-2">
              <F label="Where it came from">
                <select className={sel} value={f.source} onChange={e => set({ source: e.target.value })}>
                  {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </F>
              {f.source === 'other' && (
                <F label="Source name"><Input value={f.source_label} onChange={e => set({ source_label: e.target.value })} placeholder="e.g. Birthday cafe event"/></F>
              )}
              {f.source === 'fancall' && (
                <F label="Fancall" hint={opts.fancalls.length === 0 ? 'No fancalls yet. Add it in the Fancalls tab first.' : 'Its date is used as the event date.'}>
                  <select className={sel} value={f.fancall_id} onChange={e => set({ fancall_id: e.target.value })}>
                    <option value="">Pick a fancall…</option>
                    {opts.fancalls.map((x: any) => <option key={x.id} value={x.id}>{fancallLabel(x)}</option>)}
                  </select>
                </F>
              )}
              {f.source !== 'fancall' && (
                <F label="Event date"><Input type="date" value={f.event_date} onChange={e => set({ event_date: e.target.value })}/></F>
              )}
              {f.source === 'fancall' && fancall && !fancall.fancall_datetime && (
                <p className="text-xs text-amber-600 sm:col-span-2">This fancall has no date. Add it in the Fancalls tab to save.</p>
              )}
              <F label="Received date (optional)" hint="Needed for shipping when the item has no order, or its order isn't At GOM.">
                <Input type="date" value={f.received_date} onChange={e => set({ received_date: e.target.value })}/>
              </F>
            </div>

            </>) : (<>
            {/* Won at (event) */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2 space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground block">Won at</span>
                <div className="flex gap-2">
                  <select className={sel} value={f.event_id} onChange={e => set({ event_id: e.target.value, order_section: '' })}>
                    <option value="">Pick the event…</option>
                    {eventChoices.map((e: any) => <option key={e.id} value={e.id} disabled={e.result === 'lost' && e.id !== item?.event_id}>{eventLabel(e)}</option>)}
                  </select>
                  <Button type="button" variant="outline" size="sm" className="flex-shrink-0" onClick={() => setNewEvent(true)}><Plus size={12}/> New event</Button>
                </div>
                <span className="text-[11px] text-muted-foreground block">
                  {ev ? <>Era, order, source and date come from the event{ev.order_id ? <> · order <b>{orderTitle(ev)}</b></> : ' · no order'}.{ev.result === 'pending' ? ' Saving marks the event Won.' : ''}</>
                    : 'Every winner item comes from an event (Events tab).'}
                </span>
              </div>
              {order && order.sections.length > 0 && (
                <F label="Part of the order (optional)">
                  <select className={sel} value={f.order_section} onChange={e => {
                    const s = order.sections.find((x: any) => x.key === e.target.value)
                    set({ order_section: e.target.value, ...(s?.version_id && !f.version_id ? { version_id: s.version_id } : {}) })
                  }}>
                    <option value="">Whole order</option>
                    {order.sections.map((s: any) => <option key={s.key} value={s.key}>{s.label}{s.version_name && s.version_name !== s.label ? ` (${s.version_name})` : ''}</option>)}
                  </select>
                </F>
              )}
              <F label="Version (optional)">
                <select className={sel} value={f.version_id} onChange={e => set({ version_id: e.target.value })}>
                  <option value="">No specific version</option>
                  {opts.versions.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </F>
              <F label="Received date (optional)" hint="Needed for shipping when the item has no order, or its order isn't At GOM.">
                <Input type="date" value={f.received_date} onChange={e => set({ received_date: e.target.value })}/>
              </F>
            </div>

            </>)}

            {/* What happened to it */}
            <div className="rounded-2xl border border-border bg-secondary/20 p-3.5 space-y-3">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground">Status</span>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(STATUS_LABELS).map(([k, v]) => <Chip key={k} on={f.status === k} onClick={() => set({ status: k })}>{v}</Chip>)}
                </div>
              </div>
              {f.status === 'kept' && (
                <F label="Kept by">
                  <select className={sel} value={f.kept_by} onChange={e => set({ kept_by: e.target.value })}>
                    <option value="">Pick a GOM…</option>
                    {opts.goms.map((u: any) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
                  </select>
                </F>
              )}
              {handedOver && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <F label={f.status === 'sold' ? 'Sold to' : 'Given to'} hint="They'll see it on My Orders.">
                    <select className={sel} value={f.recipient_id} onChange={e => set({ recipient_id: e.target.value })}>
                      <option value="">Pick a user…</option>
                      {opts.users.map((u: any) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
                    </select>
                  </F>
                  {!f.order_id && (
                    <F label="Ship with box (optional)" hint="No order is linked, so pick the box it goes into for shipping.">
                      <select className={sel} value={f.ship_box_id} onChange={e => set({ ship_box_id: e.target.value })}>
                        <option value="">Don't ship</option>
                        {opts.boxes.map((b: any) => <option key={b.id} value={b.id}>{b.label || 'Box'} · {formatDate(b.created_at)}</option>)}
                      </select>
                    </F>
                  )}
                </div>
              )}
              {f.status === 'sold' && (
                <div className="grid gap-3 grid-cols-3">
                  <F label="Price €"><Input type="number" min="0" step="0.01" value={f.sale_price_eur} onChange={e => set({ sale_price_eur: e.target.value })}/></F>
                  <F label="Price ₩"><Input type="number" min="0" step="1" value={f.sale_price_krw} onChange={e => set({ sale_price_krw: e.target.value })}/></F>
                  <F label="Sale date"><Input type="date" value={f.sale_date} onChange={e => set({ sale_date: e.target.value })} placeholder="today"/></F>
                </div>
              )}
              {f.status === 'sold' && <p className="text-[11px] text-muted-foreground">Tracking only: no payment request is created for the buyer.</p>}
            </div>

            {/* Extras */}
            <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground block">Photo</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => fileRef.current?.click()} className="w-20 h-20 rounded-xl bg-secondary/40 border border-border overflow-hidden flex items-center justify-center">
                    {photoPreview ? <img src={photoPreview} alt="" className="w-full h-full object-cover"/> : <ImagePlus size={22} className="text-muted-foreground/50"/>}
                  </button>
                  {photoPreview && <Button size="sm" variant="ghost" onClick={() => { set({ photo_url: null }); setPhotoPreview(null) }}>Remove</Button>}
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { pickPhoto(e.target.files?.[0]); e.target.value = '' }}/>
              </div>
              <F label="Note (GOM only)"><Textarea rows={3} value={f.note} onChange={e => set({ note: e.target.value })} placeholder="Anything to remember"/></F>
            </div>

            {!item && (
              <F label="How many identical items?" hint="Creates one row per physical item, so each can be kept or sold separately.">
                <Input type="number" min="1" max="50" step="1" value={f.count} onChange={e => set({ count: e.target.value })} className="w-24"/>
              </F>
            )}

            {archived && <p className="text-[11px] text-muted-foreground">Archive item (entered before events): it keeps its own order, source and date.</p>}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : item ? 'Save' : (parseInt(f.count) || 1) > 1 ? `Add ${parseInt(f.count)} items` : 'Add item'}</Button>
            </div>
          </div>
        )}
      </Modal>
      <EventForm open={newEvent} eraId={eraId} orderId={orderId} onClose={() => setNewEvent(false)}
        onSaved={async e => { await loadOpts(); if (e?.id && e.result !== 'lost') set({ event_id: e.id }) }}/>
    </Portal>
  )
}

// ─────────────────────────────────────────────────────────────
// Item types manager
// ─────────────────────────────────────────────────────────────

export function WinnerTypesManager({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged?: () => void }) {
  const [types, setTypes] = useState<any[]>([])
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(() => fetch('/api/winner-items/types').then(r => r.json()).then(d => setTypes(Array.isArray(d) ? d : [])).catch(() => {}), [])
  useEffect(() => { if (open) { load(); setError('') } }, [open, load])
  async function run(body: any) {
    setError('')
    try { await post(body); await load(); onChanged?.() } catch (e: any) { setError(e.message) }
  }
  if (!open) return null
  return (
    <Portal>
      <Modal open onClose={onClose} title="Winner item types" subtitle="Shared by every era" size="sm">
        <div className="space-y-3">
          <div className="border border-border rounded-xl divide-y divide-border/60">
            {types.map(t => (
              <div key={t.id} className={`flex items-center gap-2 px-3 py-2 text-sm ${t.archived ? 'opacity-60' : ''}`}>
                {editing && editing.id === t.id ? (
                  <>
                    <Input autoFocus value={editing.name} onChange={e => setEditing({ id: t.id, name: e.target.value })} className="py-1 text-sm"
                      onKeyDown={e => { if (e.key === 'Enter') { run({ action: 'type_update', id: t.id, name: editing.name }); setEditing(null) } if (e.key === 'Escape') setEditing(null) }}/>
                    <button onClick={() => { run({ action: 'type_update', id: t.id, name: editing.name }); setEditing(null) }} className="p-1 text-emerald-600"><Check size={14}/></button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 font-medium">{t.name}{t.builtin && <span className="ml-1.5 text-[10px] uppercase font-bold text-muted-foreground">built-in</span>}{t.archived && <span className="ml-1.5 text-[10px] uppercase font-bold text-muted-foreground">archived</span>}</span>
                    <button onClick={() => setEditing({ id: t.id, name: t.name })} className="p-1 text-muted-foreground hover:text-foreground" title="Rename"><Pencil size={12}/></button>
                    <button onClick={() => run({ action: 'type_update', id: t.id, archived: !t.archived })} className="p-1 text-muted-foreground hover:text-foreground" title={t.archived ? 'Restore' : 'Archive'}>
                      {t.archived ? <ArchiveRestore size={13}/> : <Archive size={13}/>}
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="New type, e.g. Signed album" className="py-2 text-sm"
              onKeyDown={e => { if (e.key === 'Enter' && name.trim()) { run({ action: 'type_add', name }); setName('') } }}/>
            <Button size="sm" disabled={!name.trim()} onClick={() => { run({ action: 'type_add', name }); setName('') }}><Plus size={12}/> Add</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Archived types stay on existing items but aren&apos;t offered for new ones.</p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </Modal>
    </Portal>
  )
}

// ─────────────────────────────────────────────────────────────
// Rows + totals
// ─────────────────────────────────────────────────────────────

function personLine(i: any) {
  if (i.status === 'kept') return i.kept_by_name ? `Kept by ${i.kept_by_name}` : null
  if (i.status === 'sold') return [i.recipient_name ? `to ${i.recipient_name}` : null,
    i.sale_price_eur != null ? formatEur(i.sale_price_eur) : null, i.sale_price_krw != null ? formatKrw(i.sale_price_krw) : null].filter(Boolean).join(' · ')
  if (i.status === 'given') return i.recipient_name ? `to ${i.recipient_name}` : null
  return null
}

function WinnerRow({ i, onEdit, onChanged, compact }: { i: any; onEdit: () => void; onChanged: () => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false)
  async function act(body: any) { setBusy(true); try { await post(body); onChanged() } catch (e: any) { alert(e.message) } setBusy(false) }
  const person = personLine(i)
  const partLabel = i.order_section && !['__all__', '__none__'].includes(i.order_section)
    ? (i.order_section === 'vce' ? 'VCE' : i.order_section === 'fansign' ? 'Fansign' : i.order_section) : null
  return (
    <div className="flex items-start gap-3 px-3.5 py-2.5">
      <button onClick={onEdit} className="w-11 h-11 rounded-lg bg-secondary/40 border border-border overflow-hidden flex items-center justify-center flex-shrink-0" title="Edit">
        {i.has_photo ? <img src={photoSrc(i)} alt="" className="w-full h-full object-cover" loading="lazy"/> : <Trophy size={16} className="text-muted-foreground/40"/>}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-sm font-semibold">{i.type_name || 'Item'}</p>
          <span className="text-sm text-muted-foreground">· {membersText(i)}</span>
          <WinnerStatusChip status={i.status}/>
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {sourceText(i)} · {formatDate(i.event_date)}
          {i.version_name ? ` · 💿 ${i.version_name}` : ''}{partLabel && partLabel !== i.version_name ? ` · ${partLabel}` : ''}
        </p>
        {person && <p className="text-xs font-medium">{person}{i.ship_box_label && !i.order_id ? <span className="text-muted-foreground font-normal"> · ships with {i.ship_box_label}</span> : null}</p>}
        {!compact && i.note && <p className="text-xs text-muted-foreground italic truncate">{i.note}</p>}
      </div>
      <div className="flex items-center -mr-1 flex-shrink-0">
        <button disabled={busy} onClick={onEdit} className="p-1.5 text-muted-foreground hover:text-foreground" title="Edit"><Pencil size={12}/></button>
        <button disabled={busy} onClick={() => act({ action: 'duplicate', id: i.id })} className="p-1.5 text-muted-foreground hover:text-foreground" title="Duplicate (one more identical item)"><Copy size={12}/></button>
        <button disabled={busy} onClick={() => { if (confirm('Delete this winner item?')) act({ action: 'delete', id: i.id }) }} className="p-1.5 text-destructive/50 hover:text-destructive" title="Delete"><Trash2 size={12}/></button>
      </div>
    </div>
  )
}

export function WinnerTotals({ t }: { t: any }) {
  if (!t || !t.count) return null
  const parts = [`${t.count} item${t.count === 1 ? '' : 's'}`]
  if (t.won) parts.push(`${t.won} not received`)
  if (t.received) parts.push(`${t.received} received`)
  if (t.listed) parts.push(`${t.listed} listed`)
  if (t.kept) parts.push(`${t.kept} kept`)
  if (t.sold) parts.push(`${t.sold} sold`)
  if (t.given) parts.push(`${t.given} given`)
  if (t.missing) parts.push(`${t.missing} missing`)
  const money = [t.sold_eur ? formatEur(t.sold_eur) : null, t.sold_krw ? formatKrw(t.sold_krw) : null].filter(Boolean).join(' + ')
  return <p className="text-xs text-muted-foreground tabular-nums">{parts.join(' · ')}{money ? <> · <span className="font-semibold text-emerald-600">{money} sold</span></> : null}</p>
}

// ─────────────────────────────────────────────────────────────
// Era page section
// ─────────────────────────────────────────────────────────────

export function EraWinnerItems({ eraId, reloadKey, onChanged }: { eraId: string; reloadKey?: number; onChanged?: () => void }) {
  const [showArchive, setShowArchive] = useState(false)
  const [data, setData] = useState<{ items: any[]; totals: any } | null>(null)
  const [form, setForm] = useState<{ item: any | null; eventId?: string | null } | null>(null)
  const [typesOpen, setTypesOpen] = useState(false)
  const [filter, setFilter] = useState({ type: '', member: '', source: '', status: '' })
  const fetchItems = useCallback(() => fetch(`/api/winner-items?era_id=${eraId}`).then(r => r.json()).then(d => setData(d?.items ? d : { items: [], totals: null })).catch(() => {}), [eraId])
  useEffect(() => { fetchItems() }, [fetchItems, reloadKey])
  const load = () => { fetchItems(); onChanged?.() }

  const items = data?.items || []
  const choices = useMemo(() => {
    const uniq = (pairs: [string, string][]) => Array.from(new Map(pairs).entries())
    return {
      types: uniq(items.map(i => [i.type_id, i.type_name || i.type_id])),
      members: uniq(items.flatMap(i => (i.member_ids || []).map((id: string, k: number) => [id, i.member_names?.[k] || '?'] as [string, string]))),
      sources: uniq(items.map(i => [i.source === 'other' ? `other:${i.source_label || ''}` : i.source, sourceText(i)])),
    }
  }, [items])
  const shown = items.filter(i =>
    (!filter.type || i.type_id === filter.type) &&
    (!filter.member || (filter.member === '__none__' ? !(i.member_ids || []).length : (i.member_ids || []).includes(filter.member))) &&
    (!filter.source || (i.source === 'other' ? `other:${i.source_label || ''}` : i.source) === filter.source) &&
    (!filter.status || i.status === filter.status))
  // New items grouped by their event; archive items (before events) by order, in a collapsible block.
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; title: string; sub: string | null; eventId: string | null; items: any[] }>()
    for (const i of shown.filter(x => x.event_id)) {
      const k = i.event_id
      if (!m.has(k)) {
        const typeText = i.event_type === 'other' ? (i.event_type_label || 'Other') : (SOURCE_LABELS[i.event_type] || i.event_type)
        m.set(k, { key: k, eventId: k, items: [],
          title: [typeText, i.event_day ? formatDate(i.event_day) : null, i.event_shop_name].filter(Boolean).join(' · '),
          sub: i.order_id ? orderTitle(i) : null })
      }
      m.get(k)!.items.push(i)
    }
    return Array.from(m.values())
  }, [shown])
  const archiveGroups = useMemo(() => {
    const m = new Map<string, { key: string; title: string; items: any[] }>()
    for (const i of shown.filter(x => !x.event_id)) {
      const k = i.order_id || '__none__'
      if (!m.has(k)) m.set(k, { key: k, title: i.order_id ? orderTitle(i) : 'No order', items: [] })
      m.get(k)!.items.push(i)
    }
    return Array.from(m.values())
  }, [shown])
  const archiveCount = archiveGroups.reduce((n, g) => n + g.items.length, 0)
  const filtered = Object.values(filter).some(Boolean)
  const fsel = 'text-xs border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary/30'

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="font-display font-semibold text-lg flex items-center gap-2"><Trophy size={16} className="text-amber-500"/> Winner items</h2>
          <WinnerTotals t={data?.totals}/>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setTypesOpen(true)}><Settings2 size={13}/> Types</Button>
          <Button size="sm" onClick={() => setForm({ item: null })}><Plus size={13}/> Add winner item</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Polaroids, signed PCs and other items won at events. Only GOMs see this list; a buyer sees their own item on My Orders.</p>

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select className={fsel} value={filter.type} onChange={e => setFilter(f => ({ ...f, type: e.target.value }))}>
            <option value="">All types</option>{choices.types.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className={fsel} value={filter.member} onChange={e => setFilter(f => ({ ...f, member: e.target.value }))}>
            <option value="">All members</option><option value="__none__">Not revealed yet</option>
            {choices.members.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className={fsel} value={filter.source} onChange={e => setFilter(f => ({ ...f, source: e.target.value }))}>
            <option value="">All sources</option>{choices.sources.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className={fsel} value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
            <option value="">All statuses</option>{Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {filtered && <button onClick={() => setFilter({ type: '', member: '', source: '', status: '' })} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Clear · {shown.length} shown</button>}
        </div>
      )}

      {data === null ? <div className="h-16 shimmer rounded-2xl"/> : items.length === 0 ? (
        <div className="border border-dashed border-border rounded-2xl px-4 py-6 text-center text-sm text-muted-foreground">No winner items in this era yet.</div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing matches these filters.</p>
      ) : (
        <div className="space-y-3">
          {groups.map(g => (
            <div key={g.key} className="border border-border rounded-2xl bg-card overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3.5 py-2 bg-secondary/30 border-b border-border">
                <p className="text-sm font-semibold">{g.title} <span className="font-normal text-muted-foreground">· {g.items.length}{g.sub ? ` · ${g.sub}` : ''}</span></p>
                <button onClick={() => setForm({ item: null, eventId: g.eventId })} className="text-xs font-semibold text-primary hover:underline"><Plus size={11} className="inline -mt-0.5"/> Add</button>
              </div>
              <div className="divide-y divide-border/60">
                {g.items.map(i => <WinnerRow key={i.id} i={i} onEdit={() => setForm({ item: i })} onChanged={load}/>)}
              </div>
            </div>
          ))}
          {archiveCount > 0 && (
            <div className="border border-dashed border-border rounded-2xl overflow-hidden">
              <button onClick={() => setShowArchive(v => !v)} className="w-full flex items-center justify-between px-3.5 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
                <span>🗄 Archive (before events) · {archiveCount}</span><span className="text-xs">{showArchive ? 'Hide' : 'Show'}</span>
              </button>
              {showArchive && archiveGroups.map(g => (
                <div key={g.key} className="border-t border-border">
                  <p className="px-3.5 py-1.5 text-xs font-semibold bg-secondary/20">{g.title} <span className="font-normal text-muted-foreground">· {g.items.length}</span></p>
                  <div className="divide-y divide-border/60">
                    {g.items.map(i => <WinnerRow key={i.id} i={i} onEdit={() => setForm({ item: i })} onChanged={load}/>)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <WinnerItemForm open={!!form} eraId={eraId} eventId={form?.eventId} item={form?.item} onClose={() => setForm(null)} onSaved={load}/>
      <WinnerTypesManager open={typesOpen} onClose={() => setTypesOpen(false)} onChanged={load}/>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// Order detail block (GOM)
// ─────────────────────────────────────────────────────────────

export function OrderWinnerItems({ orderId, eraId }: { orderId: string; eraId: string | null }) {
  const [data, setData] = useState<{ items: any[]; totals: any } | null>(null)
  const [form, setForm] = useState<{ item: any | null } | null>(null)
  const load = useCallback(() => fetch(`/api/winner-items?order_id=${orderId}`).then(r => r.json()).then(d => setData(d?.items ? d : { items: [], totals: null })).catch(() => {}), [orderId])
  useEffect(() => { load() }, [load])
  const items = data?.items || []

  return (
    <div className="border border-amber-200 dark:border-amber-900 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-amber-50/60 dark:bg-amber-900/10 border-b border-amber-100 dark:border-amber-900">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">🏆 {items.length} winner item{items.length === 1 ? '' : 's'}</p>
          <WinnerTotals t={items.length > 1 ? data?.totals : null}/>
        </div>
        {eraId
          ? <button onClick={() => setForm({ item: null })} className="text-xs font-semibold text-primary hover:underline flex-shrink-0"><Plus size={11} className="inline -mt-0.5"/> Add</button>
          : <span className="text-[11px] text-muted-foreground text-right">Link this order to an era to add winner items</span>}
      </div>
      {items.length > 0 && (
        <div className="divide-y divide-border/60">
          {items.map(i => <WinnerRow key={i.id} i={i} compact onEdit={() => setForm({ item: i })} onChanged={load}/>)}
        </div>
      )}
      {eraId && <WinnerItemForm open={!!form} eraId={form?.item?.era_id || eraId} orderId={orderId} item={form?.item} onClose={() => setForm(null)} onSaved={load}/>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Joiner side
// ─────────────────────────────────────────────────────────────

export function JoinerWinnerList({ items, onOpenOrder, showOrder = true }: { items: any[]; onOpenOrder?: (orderId: string) => void; showOrder?: boolean }) {
  const [zoom, setZoom] = useState<any | null>(null)
  if (!items.length) return null
  return (
    <>
      <div className="divide-y divide-border/50">
        {items.map(i => (
          <div key={i.id} className="flex items-start gap-3 px-4 py-2.5">
            <button onClick={() => i.has_photo && setZoom(i)} className={`w-12 h-12 rounded-lg bg-secondary/40 border border-border overflow-hidden flex items-center justify-center flex-shrink-0 ${i.has_photo ? 'cursor-zoom-in' : 'cursor-default'}`}>
              {i.has_photo ? <img src={`/api/winner-items/${i.id}/photo`} alt="" className="w-full h-full object-cover" loading="lazy"/> : <Trophy size={16} className="text-amber-500/60"/>}
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{i.type_name || 'Winner item'} <span className="font-normal text-muted-foreground">· {membersText(i)}</span></p>
              <p className="text-xs text-muted-foreground">
                {i.source_text} · {formatDate(i.event_date)}{i.version_name ? ` · 💿 ${i.version_name}` : ''}
              </p>
              {showOrder && (i.order_id ? (
                onOpenOrder
                  ? <button onClick={() => onOpenOrder(i.order_id)} className="text-xs font-semibold text-primary hover:underline">{orderTitle(i)}</button>
                  : <p className="text-xs text-muted-foreground">{orderTitle(i)}</p>
              ) : <p className="text-xs text-muted-foreground">{i.era_name}</p>)}
            </div>
            <div className="text-right flex-shrink-0">
              {i.status === 'sold' ? (
                <>
                  <p className="text-sm font-semibold text-primary">{i.sale_price_eur != null ? formatEur(i.sale_price_eur) : i.sale_price_krw != null ? formatKrw(i.sale_price_krw) : 'Bought'}</p>
                  {i.sale_price_eur != null && i.sale_price_krw != null && <p className="text-[11px] text-muted-foreground">{formatKrw(i.sale_price_krw)}</p>}
                </>
              ) : <p className="text-xs font-semibold text-rose-600">Gift 🎁</p>}
            </div>
          </div>
        ))}
      </div>
      {zoom && (
        <Portal>
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4" onClick={() => setZoom(null)}>
            <img src={`/api/winner-items/${zoom.id}/photo`} alt="" className="max-w-full max-h-[85vh] rounded-xl"/>
          </div>
        </Portal>
      )}
    </>
  )
}
