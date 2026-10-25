'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Pencil, Trash2, Shuffle, X, Trophy, CalendarClock } from 'lucide-react'
import { Button, Input, Modal, Textarea } from '@/components/ui'
import { formatDate, formatDateTime } from '@/lib/utils'
import { EVENT_TYPE_LABELS, EVENT_RESULT_LABELS } from '@/lib/eventTypes'
import { Portal, WinnerItemForm, orderTitle } from './WinnerItems'

// Events = every fansign / fancall / DIY event / lucky draw / VCE / POB event entered, won or not.
// See src/lib/events.ts for the rules.

const RESULT_TONE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800',
  won: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800',
  lost: 'bg-secondary text-muted-foreground border-border',
}
const RESULT_ON: Record<string, string> = {
  pending: 'bg-amber-500 text-white border-amber-500',
  won: 'bg-emerald-600 text-white border-emerald-600',
  lost: 'bg-zinc-500 text-white border-zinc-500',
}

async function post(body: any) {
  const res = await fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out.error || 'Something went wrong')
  return out
}

const sel = 'w-full px-3 py-2 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/25'
const F = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <label className="block space-y-1.5">
    <span className="text-xs font-semibold text-muted-foreground">{label}</span>
    {children}
    {hint && <span className="text-[11px] text-muted-foreground block">{hint}</span>}
  </label>
)
function Chip({ on, onClick, children, onClass }: { on: boolean; onClick: () => void; children: React.ReactNode; onClass?: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-2.5 py-1 rounded-lg border text-xs font-semibold transition-colors ${on ? (onClass || 'bg-primary text-primary-foreground border-primary') : 'bg-background border-border hover:border-primary/40'}`}>
      {children}
    </button>
  )
}

export function EventResultChip({ result }: { result: string }) {
  return <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${RESULT_TONE[result] || RESULT_TONE.pending}`}>{EVENT_RESULT_LABELS[result as 'won'] || result}</span>
}

export const eventTitle = (e: any) => [e.type_text || EVENT_TYPE_LABELS[e.type as 'fansign'] || e.type,
  e.event_local ? formatDate(e.event_local) : (e.event_day ? formatDate(e.event_day) : 'no date'),
  e.shop_name || e.order_shop_name].filter(Boolean).join(' · ')

// ─────────────────────────────────────────────────────────────
// Add / edit an event
// ─────────────────────────────────────────────────────────────

const emptyForm = {
  era_id: '', type: 'fansign', type_label: '', event_local: '', shop_id: '', entered_by: '', order_id: '',
  entries_count: '', winner_spots: '', result: 'pending', note: '',
}

export function EventForm({ open, eraId, orderId, event, onClose, onSaved }: {
  open: boolean; eraId?: string | null; orderId?: string | null; event?: any | null; onClose: () => void; onSaved: (ev: any) => void
}) {
  const [f, setF] = useState({ ...emptyForm })
  const [opts, setOpts] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (p: Partial<typeof emptyForm>) => setF(prev => ({ ...prev, ...p }))

  useEffect(() => {
    if (!open) return
    setError('')
    if (event) {
      setF({
        era_id: event.era_id, type: event.type, type_label: event.type_label || '', event_local: event.event_local || '',
        shop_id: event.shop_id || '', entered_by: event.entered_by || '', order_id: event.order_id || '',
        entries_count: event.entries_count != null ? String(event.entries_count) : '', winner_spots: event.winner_spots != null ? String(event.winner_spots) : '',
        result: event.result, note: event.note || '',
      })
    } else setF({ ...emptyForm, era_id: eraId || '', order_id: orderId || '' })
  }, [open, event, eraId, orderId])

  useEffect(() => {
    if (!open) return
    fetch(`/api/events/options${f.era_id ? `?era_id=${f.era_id}` : ''}`).then(r => r.json()).then(d => {
      setOpts(d)
      if (!f.era_id && !event && Array.isArray(d?.eras)) {
        const active = d.eras.filter((e: any) => e.status === 'active')
        if (active.length === 1) set({ era_id: active[0].id })
      }
    }).catch(() => {})
  }, [open, f.era_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Picking a fancall order fills the shop
  function pickOrder(id: string) {
    const o = opts?.orders?.find((x: any) => x.id === id)
    set({ order_id: id })
    if (o && !f.shop_id) {
      const shop = opts?.shops?.find((s: any) => s.name === o.shop_name)
      if (shop) set({ order_id: id, shop_id: shop.id })
    }
  }

  async function save() {
    setSaving(true); setError('')
    try {
      const out = await post(event ? { action: 'update', id: event.id, ...f } : { action: 'create', ...f })
      onSaved(out.event); onClose()
    } catch (e: any) { setError(e.message) }
    setSaving(false)
  }

  if (!open) return null
  return (
    <Portal>
      <Modal open onClose={onClose} title={event ? 'Edit event' : 'New event'} size="lg">
        <div className="space-y-5">
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Type</span>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => <Chip key={k} on={f.type === k} onClick={() => set({ type: k })}>{k === 'other' ? 'Other…' : v}</Chip>)}
            </div>
            {f.type === 'other' && <Input value={f.type_label} onChange={e => set({ type_label: e.target.value })} placeholder="e.g. Birthday cafe event" className="mt-1.5"/>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <F label="Era">
              <select className={sel} value={f.era_id} onChange={e => set({ era_id: e.target.value, order_id: '' })}>
                <option value="">Pick an era…</option>
                {(opts?.eras || []).map((e: any) => <option key={e.id} value={e.id}>{e.group_name ? `${e.group_name} · ` : ''}{e.name}{e.status !== 'active' ? ' (ended)' : ''}</option>)}
              </select>
            </F>
            <F label="Order (optional)">
              <select className={sel} value={f.order_id} onChange={e => pickOrder(e.target.value)} disabled={!f.era_id}>
                <option value="">No order</option>
                {(opts?.orders || []).map((o: any) => <option key={o.id} value={o.id}>{orderTitle(o)}{o.is_fancall ? ' ✦' : ''}</option>)}
              </select>
            </F>
            <F label="Date & time (Paris)"><Input type="datetime-local" value={f.event_local} onChange={e => set({ event_local: e.target.value })}/></F>
            <F label="Shop">
              <select className={sel} value={f.shop_id} onChange={e => set({ shop_id: e.target.value })}>
                <option value="">No shop</option>
                {(opts?.shops || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </F>
            <F label="Entered by">
              <select className={sel} value={f.entered_by} onChange={e => set({ entered_by: e.target.value })}>
                <option value="">—</option>
                {(opts?.users || []).map((u: any) => <option key={u.id} value={u.id}>{u.name}{u.role !== 'joiner' ? ` (${u.role})` : ''}</option>)}
              </select>
            </F>
            <div className="grid grid-cols-2 gap-3">
              <F label="Entries / albums used"><Input type="number" min="0" step="1" value={f.entries_count} onChange={e => set({ entries_count: e.target.value })}/></F>
              <F label="Winner spots"><Input type="number" min="0" step="1" value={f.winner_spots} onChange={e => set({ winner_spots: e.target.value })}/></F>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Result</span>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(EVENT_RESULT_LABELS).map(([k, v]) => <Chip key={k} on={f.result === k} onClick={() => set({ result: k })} onClass={RESULT_ON[k]}>{v}</Chip>)}
            </div>
            <span className="text-[11px] text-muted-foreground block">Lost = no winner item. Adding a winner item to a Pending event marks it Won.</span>
          </div>

          <F label="Note"><Textarea rows={2} value={f.note} onChange={e => set({ note: e.target.value })}/></F>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : event ? 'Save' : 'Add event'}</Button>
          </div>
        </div>
      </Modal>
    </Portal>
  )
}

// ─────────────────────────────────────────────────────────────
// Raffle (fancall orders) — shared by Fancall events and archive fancalls
// ─────────────────────────────────────────────────────────────

export function RaffleModal({ orderId, title, onClose, onSave }: { orderId: string; title: string; onClose: () => void; onSave: (winnerId: string) => Promise<void> }) {
  const [entries, setEntries] = useState<{ joiner_id: string; display_name: string; entries: number; base: number; bonus: number; bonus_type: 'fixed' | 'semi_fixed' | null }[]>([])
  const [loading, setLoading] = useState(true)
  const [winner, setWinner] = useState<{ joiner_id: string; display_name: string } | null>(null)
  const [rolling, setRolling] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    // Bought entries (qty × entries per pricing option) + bonus: +2 fixed joiners, +1 semi-fixed spot holders.
    fetch(`/api/raffle-entries?order_id=${orderId}`).then(r => r.json()).then(d => setEntries(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false))
  }, [orderId])
  const total = entries.reduce((s, e) => s + e.entries, 0)

  function roll() {
    if (!entries.length) return
    setRolling(true); setWinner(null)
    const pool: { joiner_id: string; display_name: string }[] = []
    for (const e of entries) for (let i = 0; i < e.entries; i++) pool.push({ joiner_id: e.joiner_id, display_name: e.display_name })
    if (!pool.length) { setRolling(false); return }
    let tick = 0
    const iv = setInterval(() => {
      tick++
      setWinner(pool[Math.floor(Math.random() * pool.length)])
      if (tick > 20) { clearInterval(iv); setWinner(pool[Math.floor(Math.random() * pool.length)]); setRolling(false) }
    }, 80)
  }

  return (
    <Portal>
      <Modal open onClose={onClose} title="🎟 Raffle" subtitle={`${title} — ${total} total entries`} size="md">
        <div className="space-y-5">
          {loading ? <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>
          : entries.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground text-sm">No entries found for this order.</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Make sure joiners have been logged with entries in the Orders page.</p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Participants</p>
                <div className="bg-secondary/30 rounded-2xl divide-y divide-border overflow-hidden">
                  {entries.map(e => (
                    <div key={e.joiner_id} className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-sm font-semibold">{e.display_name}</span>
                      <div className="flex items-center gap-2">
                        {e.bonus > 0 && (
                          <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full border ${e.bonus_type === 'fixed' ? 'bg-primary/10 text-primary border-primary/30' : 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-800'}`}>
                            {e.base} + {e.bonus} {e.bonus_type === 'fixed' ? 'fixed' : 'semi-fixed'}
                          </span>
                        )}
                        <span className="text-xs font-bold text-primary">{e.entries}</span>
                        <span className="text-xs text-muted-foreground">entr{e.entries === 1 ? 'y' : 'ies'} ({total ? Math.round(e.entries / total * 100) : 0}%)</span>
                        <button onClick={() => setEntries(prev => prev.filter(r => r.joiner_id !== e.joiner_id))} className="text-muted-foreground/50 hover:text-destructive ml-1" title="Remove from raffle"><X size={13}/></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {winner && (
                <div className={`rounded-2xl border-2 px-6 py-5 text-center ${rolling ? 'border-primary/30 bg-primary/5' : 'border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700'}`}>
                  {rolling ? <p className="font-display font-bold text-2xl text-primary animate-pulse">{winner.display_name}</p> : (
                    <>
                      <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-1">🏆 Winner</p>
                      <p className="font-display font-bold text-3xl text-amber-700 dark:text-amber-300">{winner.display_name}</p>
                    </>
                  )}
                </div>
              )}
              <div className="flex gap-3">
                <Button onClick={roll} disabled={rolling} className="flex-1" variant={winner && !rolling ? 'outline' : 'default'}>
                  <Shuffle size={14}/> {winner && !rolling ? 'Re-roll' : 'Roll Raffle'}
                </Button>
                {winner && !rolling && (
                  <Button className="flex-1" disabled={saving} onClick={async () => { setSaving(true); await onSave(winner.joiner_id); setSaving(false); onClose() }}>
                    {saving ? 'Saving…' : '🏆 Save Winner'}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </Modal>
    </Portal>
  )
}

// ─────────────────────────────────────────────────────────────
// Events list (Events tab and era page)
// ─────────────────────────────────────────────────────────────

export function EventTotals({ t }: { t: any }) {
  if (!t || !t.count) return null
  return (
    <p className="text-xs text-muted-foreground tabular-nums">
      {t.count} entered · <span className="text-emerald-600 font-semibold">{t.won} won</span> · {t.lost} lost · {t.pending} pending
      {t.win_rate != null && <> · win rate <span className="font-semibold text-foreground">{t.win_rate}%</span></>}
    </p>
  )
}

function EventRow({ e, showEra, onChanged, onEdit, onAddItem, onRaffle }: {
  e: any; showEra?: boolean; onChanged: () => void; onEdit: () => void; onAddItem: () => void; onRaffle: () => void
}) {
  const [busy, setBusy] = useState(false)
  async function act(body: any) {
    setBusy(true)
    try {
      await post(body); onChanged()
      // Just won: offer to add what was won
      if (body.action === 'set_result' && body.result === 'won' && !e.item_count) onAddItem()
    } catch (err: any) { alert(err.message) }
    setBusy(false)
  }
  const due = e.result === 'pending' && e.event_local && new Date(e.event_at).getTime() < Date.now()
  return (
    <div className="px-3.5 py-2.5 flex flex-wrap items-start gap-x-3 gap-y-2">
      <div className="flex-1 min-w-[220px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-sm font-semibold">{e.type_text}</p>
          <span className="text-sm text-muted-foreground">· {e.event_local ? formatDateTime(e.event_at) : 'no date'}</span>
          {due && <span className="text-[10px] font-bold uppercase text-amber-600">result to enter</span>}
        </div>
        <p className="text-xs text-muted-foreground">
          {[showEra ? `${e.group_name ? e.group_name + ' · ' : ''}${e.era_name}` : null, e.shop_name, e.order_id ? `Order: ${orderTitle(e)}` : null,
            e.entries_count != null ? `${e.entries_count} entr${e.entries_count === 1 ? 'y' : 'ies'}` : null,
            e.winner_spots != null ? `${e.winner_spots} winner spot${e.winner_spots === 1 ? '' : 's'}` : null,
            e.entered_by_name ? `entered by ${e.entered_by_name}` : null].filter(Boolean).join(' · ')}
        </p>
        {(e.raffle_winner_name || e.item_count > 0 || e.note) && (
          <p className="text-xs mt-0.5">
            {e.item_count > 0 && <span className="font-semibold text-amber-700 dark:text-amber-300">🏆 {e.item_count} winner item{e.item_count === 1 ? '' : 's'}</span>}
            {e.raffle_winner_name && <span className="ml-2 text-muted-foreground">Raffle: <b>{e.raffle_winner_name}</b></span>}
            {e.note && <span className="ml-2 italic text-muted-foreground">{e.note}</span>}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {(['pending', 'won', 'lost'] as const).map(r => (
          <button key={r} disabled={busy || e.result === r} onClick={() => act({ action: 'set_result', id: e.id, result: r })}
            className={`px-2 py-0.5 rounded-md border text-[11px] font-bold transition-colors ${e.result === r ? RESULT_ON[r] : 'bg-background border-border text-muted-foreground hover:text-foreground'}`}>
            {EVENT_RESULT_LABELS[r]}
          </button>
        ))}
      </div>
      <div className="flex items-center -mr-1 flex-shrink-0">
        {e.result !== 'lost' && <button onClick={onAddItem} className="p-1.5 text-amber-600 hover:text-amber-700" title="Add winner item"><Trophy size={13}/></button>}
        {e.type === 'fancall' && e.order_id && <button onClick={onRaffle} className="p-1.5 text-primary" title="Raffle"><Shuffle size={13}/></button>}
        <button onClick={onEdit} className="p-1.5 text-muted-foreground hover:text-foreground" title="Edit"><Pencil size={12}/></button>
        <button disabled={busy} onClick={() => { if (confirm('Delete this event?')) act({ action: 'delete', id: e.id }) }} className="p-1.5 text-destructive/50 hover:text-destructive" title="Delete"><Trash2 size={12}/></button>
      </div>
    </div>
  )
}

export function EventsList({ eraId, reloadKey, onChanged, title = 'Events', showEraFilter }: {
  eraId?: string; reloadKey?: number; onChanged?: () => void; title?: string; showEraFilter?: boolean
}) {
  const [data, setData] = useState<{ events: any[]; totals: any } | null>(null)
  const [form, setForm] = useState<{ event: any | null } | null>(null)
  const [itemFor, setItemFor] = useState<any | null>(null)
  const [raffleFor, setRaffleFor] = useState<any | null>(null)
  const [filter, setFilter] = useState({ era: showEraFilter ? '__active__' : '', type: '', result: '' })
  const load = useCallback(() => fetch(`/api/events${eraId ? `?era_id=${eraId}` : ''}`).then(r => r.json()).then(d => setData(d?.events ? d : { events: [], totals: null })).catch(() => {}), [eraId])
  useEffect(() => { load() }, [load, reloadKey])
  const changed = () => { load(); onChanged?.() }

  const events = data?.events || []
  const eras = useMemo(() => Array.from(new Map(events.map(e => [e.era_id, { id: e.era_id, label: `${e.group_name ? e.group_name + ' · ' : ''}${e.era_name}`, active: e.era_status === 'active' }])).values()), [events])
  const shown = events.filter(e =>
    (!filter.era || (filter.era === '__active__' ? e.era_status === 'active' : e.era_id === filter.era)) &&
    (!filter.type || e.type === filter.type) && (!filter.result || e.result === filter.result))
  const totals = useMemo(() => {
    const won = shown.filter(e => e.result === 'won').length, lost = shown.filter(e => e.result === 'lost').length
    return { count: shown.length, won, lost, pending: shown.filter(e => e.result === 'pending').length, win_rate: won + lost ? Math.round(won / (won + lost) * 100) : null }
  }, [shown])
  const fsel = 'text-xs border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary/30'

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="font-display font-semibold text-lg flex items-center gap-2"><CalendarClock size={16} className="text-primary"/> {title}</h2>
          <EventTotals t={totals}/>
        </div>
        <Button size="sm" onClick={() => setForm({ event: null })}><Plus size={13}/> New event</Button>
      </div>
      {events.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {showEraFilter && (
            <select className={fsel} value={filter.era} onChange={e => setFilter(f => ({ ...f, era: e.target.value }))}>
              <option value="__active__">Active eras</option><option value="">All eras</option>
              {eras.map(e => <option key={e.id} value={e.id}>{e.label}{e.active ? '' : ' (ended)'}</option>)}
            </select>
          )}
          <select className={fsel} value={filter.type} onChange={e => setFilter(f => ({ ...f, type: e.target.value }))}>
            <option value="">All types</option>{Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className={fsel} value={filter.result} onChange={e => setFilter(f => ({ ...f, result: e.target.value }))}>
            <option value="">All results</option>{Object.entries(EVENT_RESULT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      )}
      {data === null ? <div className="h-16 shimmer rounded-2xl"/> : shown.length === 0 ? (
        <div className="border border-dashed border-border rounded-2xl px-4 py-6 text-center text-sm text-muted-foreground">
          {events.length ? 'Nothing matches these filters.' : 'No events yet. Add every fansign, fancall or event you enter, won or not.'}
        </div>
      ) : (
        <div className="border border-border rounded-2xl bg-card divide-y divide-border/60 overflow-hidden">
          {shown.map(e => (
            <EventRow key={e.id} e={e} showEra={!eraId} onChanged={changed} onEdit={() => setForm({ event: e })}
              onAddItem={() => setItemFor(e)} onRaffle={() => setRaffleFor(e)}/>
          ))}
        </div>
      )}

      <EventForm open={!!form} eraId={eraId} event={form?.event} onClose={() => setForm(null)}
        onSaved={ev => { changed(); if (ev?.result === 'won' && form?.event?.result !== 'won' && !ev.item_count) setItemFor(ev) }}/>
      {itemFor && <WinnerItemForm open eraId={itemFor.era_id} eventId={itemFor.id} onClose={() => setItemFor(null)} onSaved={changed}/>}
      {raffleFor && (
        <RaffleModal orderId={raffleFor.order_id} title={eventTitle(raffleFor)} onClose={() => setRaffleFor(null)}
          onSave={async id => { await post({ action: 'raffle_winner', id: raffleFor.id, raffle_winner_id: id }).catch(err => alert(err.message)); changed() }}/>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// Dashboard: pending events whose date has passed
// ─────────────────────────────────────────────────────────────

export function ResultsDueWidget() {
  const [events, setEvents] = useState<any[]>([])
  const [itemFor, setItemFor] = useState<any | null>(null)
  const load = useCallback(() => fetch('/api/events?results_due=1').then(r => r.json()).then(d => setEvents(Array.isArray(d?.events) ? d.events : [])).catch(() => {}), [])
  useEffect(() => { load() }, [load])
  async function setResult(id: string, result: string) {
    try {
      await post({ action: 'set_result', id, result })
      if (result === 'won') setItemFor(events.find(e => e.id === id) || null)
      load()
    } catch (e: any) { alert(e.message) }
  }
  if (!events.length) return itemFor ? <WinnerItemForm open eraId={itemFor.era_id} eventId={itemFor.id} onClose={() => setItemFor(null)} onSaved={() => {}}/> : null
  return (
    <div className="bg-card border border-amber-200 dark:border-amber-900 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-amber-100 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-900/10">
        <p className="text-sm font-semibold flex items-center gap-2"><CalendarClock size={14} className="text-amber-600"/> Results to enter <span className="text-xs font-bold text-amber-700">{events.length}</span></p>
        <Link href="/gom/events" className="text-xs font-semibold text-primary hover:underline">Events</Link>
      </div>
      <div className="divide-y divide-border">
        {events.map(e => (
          <div key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5">
            <div className="flex-1 min-w-[180px]">
              <p className="text-sm font-semibold">{e.type_text} <span className="font-normal text-muted-foreground">· {formatDateTime(e.event_at)}</span></p>
              <p className="text-xs text-muted-foreground">{[e.group_name, e.era_name, e.shop_name, e.order_id ? orderTitle(e) : null].filter(Boolean).join(' · ')}</p>
            </div>
            <div className="flex gap-1">
              <button onClick={() => setResult(e.id, 'won')} className="px-2 py-0.5 rounded-md border text-[11px] font-bold border-emerald-300 text-emerald-700 hover:bg-emerald-50">Won</button>
              <button onClick={() => setResult(e.id, 'lost')} className="px-2 py-0.5 rounded-md border text-[11px] font-bold border-border text-muted-foreground hover:bg-secondary">Lost</button>
            </div>
          </div>
        ))}
      </div>
      {itemFor && <WinnerItemForm open eraId={itemFor.era_id} eventId={itemFor.id} onClose={() => setItemFor(null)} onSaved={() => {}}/>}
    </div>
  )
}
