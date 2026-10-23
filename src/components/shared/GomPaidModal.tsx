'use client'
import { useEffect, useState } from 'react'
import { Modal, Button, Input } from '@/components/ui'
import { formatEur, formatKrw } from '@/lib/utils'

// ── Amount paid by the GOM for an order ─────────────────────────────────────────
// Used by the Orders page (prompt when orders become "Ordered", one row per order) and the
// Payments page (add / edit one payment line). Amounts can be typed in € or in ₩ with a
// ₩-per-€ rate; € is always what's stored for the maths, ₩ + rate are kept for reference.

export const PAID_TO = [
  { value: '', label: 'Paid to…' },
  { value: 'shop', label: 'Shop' },
  { value: 'kaddy', label: 'K-addy' },
  { value: 'proxy', label: 'Proxy' },
  { value: 'seller', label: 'Seller' },
  { value: 'other', label: 'Other' },
]
export const paidToLabel = (v?: string | null) => PAID_TO.find(p => p.value === v && v)?.label || ''

const RATE_KEY = 'gom-krw-rate'
function loadRate() { try { return localStorage.getItem(RATE_KEY) || '' } catch { return '' } }
function saveRate(r: string) { try { if (r) localStorage.setItem(RATE_KEY, r) } catch {} }
const today = () => new Date().toISOString().slice(0, 10)
const num = (v: string) => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n }

export type Currency = 'eur' | 'krw'
export function toEur(value: string, currency: Currency, rate: string): number | null {
  const v = num(value)
  if (v == null) return null
  if (currency === 'eur') return Math.round(v * 100) / 100
  const r = num(rate)
  return r && r > 0 ? Math.round((v / r) * 100) / 100 : null
}
function payload(value: string, currency: Currency, rate: string) {
  return {
    amount_eur: toEur(value, currency, rate),
    amount_krw: currency === 'krw' ? num(value) : null,
    krw_rate: currency === 'krw' ? num(rate) : null,
  }
}

function CurrencyToggle({ currency, onChange }: { currency: Currency; onChange: (c: Currency) => void }) {
  return (
    <div className="flex rounded-lg border border-border overflow-hidden text-xs font-semibold w-fit">
      {(['eur', 'krw'] as Currency[]).map(c => (
        <button key={c} type="button" onClick={() => onChange(c)}
          className={`px-3 py-1.5 transition-colors ${currency === c ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>
          {c === 'eur' ? '€ Euro' : '₩ Won'}
        </button>
      ))}
    </div>
  )
}

function RateInput({ rate, setRate }: { rate: string; setRate: (r: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="whitespace-nowrap">1 € =</span>
      <Input type="number" step="0.01" min="0" value={rate} onChange={e => setRate(e.target.value)} placeholder="e.g. 1480" className="w-28 py-1.5 text-xs"/>
      <span>₩</span>
    </label>
  )
}

const selectCls = 'text-xs border border-border rounded-lg px-2 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary/30'

// ── Bulk prompt: one amount per order ───────────────────────────────────────────

export interface PromptOrder { id: string; label: string; sublabel?: string; already_eur?: number | null }

export function GomPaidPrompt({ open, orders, onClose, onSaved }: {
  open: boolean
  orders: PromptOrder[]
  onClose: () => void
  onSaved?: (orderIds: string[]) => void
}) {
  const [currency, setCurrency] = useState<Currency>('eur')
  const [rate, setRate] = useState('')
  const [date, setDate] = useState(today())
  const [rows, setRows] = useState<Record<string, { value: string; paid_to: string }>>({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) return
    setRate(loadRate()); setDate(today()); setErr('')
    setRows(Object.fromEntries(orders.map(o => [o.id, { value: '', paid_to: '' }])))
  }, [open, orders])

  const set = (id: string, patch: Partial<{ value: string; paid_to: string }>) =>
    setRows(r => ({ ...r, [id]: { ...(r[id] || { value: '', paid_to: '' }), ...patch } }))

  const filled = orders.filter(o => (rows[o.id]?.value || '').trim() !== '')
  const total = filled.reduce((s, o) => s + (toEur(rows[o.id].value, currency, rate) || 0), 0)
  const needsRate = currency === 'krw' && filled.length > 0 && !(num(rate)! > 0)

  async function save() {
    if (needsRate) { setErr('Enter the ₩ → € rate first'); return }
    setSaving(true); setErr('')
    if (currency === 'krw') saveRate(rate)
    const lines = filled.map(o => ({ order_id: o.id, paid_at: date, paid_to: rows[o.id].paid_to || null, ...payload(rows[o.id].value, currency, rate) }))
    const res = await fetch('/api/gom-payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }) })
    setSaving(false)
    if (!res.ok) { setErr('Could not save — try again'); return }
    onSaved?.(filled.map(o => o.id))
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} size="lg"
      title={orders.length > 1 ? `Amount paid for ${orders.length} orders` : 'Amount paid for this order'}
      subtitle="What you paid to buy it. Leave a field empty to fill it in later from Payments.">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <CurrencyToggle currency={currency} onChange={setCurrency}/>
          {currency === 'krw' && <RateInput rate={rate} setRate={setRate}/>}
          <label className="flex items-center gap-2 text-xs text-muted-foreground ml-auto">
            Paid on <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="py-1.5 text-xs w-36"/>
          </label>
        </div>

        <div className="border border-border rounded-xl divide-y divide-border/60 max-h-[50vh] overflow-y-auto">
          {orders.map((o, i) => {
            const r = rows[o.id] || { value: '', paid_to: '' }
            const eur = currency === 'krw' ? toEur(r.value, currency, rate) : null
            return (
              <div key={o.id} className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{o.label}</p>
                  {(o.sublabel || (o.already_eur ?? 0) > 0) && (
                    <p className="text-xs text-muted-foreground truncate">
                      {o.sublabel}{o.sublabel && (o.already_eur ?? 0) > 0 ? ' · ' : ''}
                      {(o.already_eur ?? 0) > 0 && <span className="text-amber-600">already logged {formatEur(o.already_eur!)}</span>}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{currency === 'eur' ? '€' : '₩'}</span>
                    <Input autoFocus={i === 0} type="number" step={currency === 'eur' ? '0.01' : '1'} min="0" inputMode="decimal"
                      value={r.value} onChange={e => set(o.id, { value: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') save() }}
                      placeholder={currency === 'eur' ? '0.00' : '0'} className="pl-6 py-2 text-sm w-32 tabular-nums"/>
                  </div>
                  <select value={r.paid_to} onChange={e => set(o.id, { paid_to: e.target.value })} className={selectCls}>
                    {PAID_TO.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                {eur != null && <p className="text-xs text-muted-foreground sm:w-20 sm:text-right tabular-nums">≈ {formatEur(eur)}</p>}
              </div>
            )
          })}
        </div>

        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="text-sm text-muted-foreground">{filled.length > 0 ? <>Total <span className="font-semibold text-foreground tabular-nums">{formatEur(total)}</span> · {filled.length}/{orders.length} filled</> : 'Nothing entered yet'}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Skip — fill in later</Button>
            <Button onClick={save} disabled={saving || filled.length === 0}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ── One payment line (add / edit) ───────────────────────────────────────────────

export function GomPaidLineModal({ open, orderId, orderLabel, line, received, otherPaid, onClose, onSaved }: {
  open: boolean
  orderId: string | null
  orderLabel?: string
  line?: any | null           // existing line → edit
  received?: number          // for the live "covered" preview
  otherPaid?: number         // other lines of this order
  onClose: () => void
  onSaved?: () => void
}) {
  const [currency, setCurrency] = useState<Currency>('eur')
  const [value, setValue] = useState('')
  const [rate, setRate] = useState('')
  const [paidTo, setPaidTo] = useState('')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) return
    setErr('')
    if (line) {
      const isKrw = line.amount_krw != null && line.krw_rate != null
      setCurrency(isKrw ? 'krw' : 'eur')
      setValue(String(isKrw ? Math.round(parseFloat(line.amount_krw)) : parseFloat(line.amount_eur ?? 0)))
      setRate(isKrw ? String(parseFloat(line.krw_rate)) : loadRate())
      setPaidTo(line.paid_to || ''); setNote(line.note || '')
      setDate(line.paid_at ? String(line.paid_at).slice(0, 10) : today())
    } else {
      setCurrency('eur'); setValue(''); setRate(loadRate()); setPaidTo(''); setNote(''); setDate(today())
    }
  }, [open, line])

  const eur = toEur(value, currency, rate)
  const covered = received != null && eur != null ? received - (otherPaid || 0) - eur : null

  async function save() {
    if (eur == null) { setErr(currency === 'krw' && value ? 'Enter the ₩ → € rate' : 'Enter an amount'); return }
    setSaving(true); setErr('')
    if (currency === 'krw') saveRate(rate)
    const body = { ...payload(value, currency, rate), paid_to: paidTo || null, note: note || null, paid_at: date }
    const res = await fetch('/api/gom-payments', {
      method: line ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(line ? { ...body, id: line.id } : { ...body, order_id: orderId }),
    })
    setSaving(false)
    if (!res.ok) { setErr('Could not save — try again'); return }
    onSaved?.(); onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={line ? 'Edit payment' : 'Add payment'} subtitle={orderLabel} size="md">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <CurrencyToggle currency={currency} onChange={setCurrency}/>
          {currency === 'krw' && <RateInput rate={rate} setRate={setRate}/>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Amount paid ({currency === 'eur' ? '€' : '₩'})</span>
            <Input autoFocus type="number" step={currency === 'eur' ? '0.01' : '1'} min="0" inputMode="decimal" value={value}
              onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save() }} placeholder="0" className="tabular-nums"/>
            {currency === 'krw' && eur != null && <span className="text-xs text-muted-foreground">≈ {formatEur(eur)}</span>}
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Paid on</span>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)}/>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Paid to</span>
            <select value={paidTo} onChange={e => setPaidTo(e.target.value)} className={`${selectCls} w-full`}>
              {PAID_TO.map(p => <option key={p.value} value={p.value}>{p.value ? p.label : '—'}</option>)}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Note</span>
            <Input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. deposit, proxy fee"/>
          </label>
        </div>

        {covered != null && (
          <div className="rounded-xl border bg-muted/30 px-4 py-3 text-sm space-y-1">
            <div className="flex justify-between text-muted-foreground"><span>Received from joiners</span><span className="tabular-nums text-foreground">{formatEur(received!)}</span></div>
            <div className="flex justify-between text-muted-foreground"><span>Paid{otherPaid ? ' (with other payments)' : ''}</span><span className="tabular-nums text-foreground">− {formatEur((otherPaid || 0) + eur!)}</span></div>
            <div className="flex justify-between border-t pt-1 font-semibold"><span>Covered</span>
              <span className={`tabular-nums ${covered >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{covered >= 0 ? '+' : ''}{formatEur(covered)}</span></div>
          </div>
        )}
        {line?.amount_krw != null && currency === 'eur' && <p className="text-xs text-muted-foreground">Was entered as {formatKrw(parseFloat(line.amount_krw))} — saving in € drops the ₩ amount.</p>}

        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : line ? 'Update' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  )
}
