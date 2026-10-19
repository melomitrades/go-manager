'use client'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, PackageX } from 'lucide-react'
import { Modal, Button } from '@/components/ui'
import { formatEur, formatDate } from '@/lib/utils'

export interface LostScope { order_id?: string | null; box_id?: string | null; shipment_id?: string | null }

interface Props {
  open: boolean
  joinerId: string | null
  joinerName?: string
  scope: LostScope
  // Pre-selects the unpaid payment this was opened from (an UnpaidPayment.key from lostClaims.ts).
  defaultTriggerKey?: string | null
  onClose: () => void
  onDone?: () => void
}

const TYPE_STYLE: Record<string, string> = {
  order: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-300 dark:border-sky-800',
  ems: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800',
  customs: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-800',
  shipping: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800',
}
export function PaymentTypeChip({ type }: { type: string }) {
  return <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${TYPE_STYLE[type] || 'bg-secondary border-border'}`}>{type}</span>
}

// "Mark claims as lost" picker: choose which unpaid payment this is about, pick the claim lines
// (or single member rows) to release, review exactly what will happen (server dry-run of the same
// transaction), then confirm.
export function MarkLostModal({ open, joinerId, joinerName, scope, defaultTriggerKey, onClose, onDone }: Props) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [triggerKey, setTriggerKey] = useState<string>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !joinerId) return
    setData(null); setPreview(null); setError(null); setSelected(new Set()); setExpanded(new Set()); setReason('')
    setLoading(true)
    const p = new URLSearchParams({ joiner_id: joinerId })
    if (scope.order_id) p.set('order_id', scope.order_id)
    if (scope.box_id) p.set('box_id', scope.box_id)
    if (scope.shipment_id) p.set('shipment_id', scope.shipment_id)
    fetch('/api/lost-claims/candidates?' + p).then(r => r.json()).then(d => {
      setData(d)
      const keys: string[] = (d?.unpaid || []).map((u: any) => u.key)
      setTriggerKey(defaultTriggerKey && keys.includes(defaultTriggerKey) ? defaultTriggerKey : (keys[0] || ''))
      setLoading(false)
    }).catch(() => { setError('Could not load claims'); setLoading(false) })
  }, [open, joinerId, scope.order_id, scope.box_id, scope.shipment_id, defaultTriggerKey])

  const allRowIds = useMemo(() => (data?.orders || []).flatMap((o: any) => o.lines.flatMap((l: any) => l.rows.map((r: any) => r.id))), [data])

  function toggleRows(ids: string[], on: boolean) {
    setPreview(null)
    setSelected(prev => {
      const next = new Set(prev)
      for (const id of ids) on ? next.add(id) : next.delete(id)
      return next
    })
  }

  async function submit(dryRun: boolean) {
    setBusy(true); setError(null)
    const res = await fetch('/api/lost-claims', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ joiner_id: joinerId, order_item_ids: [...selected], trigger_key: triggerKey, reason, dry_run: dryRun }),
    }).then(async r => ({ ok: r.ok, body: await r.json().catch(() => ({})) }))
    setBusy(false)
    if (!res.ok) { setError(res.body?.error || 'Something went wrong'); return }
    if (dryRun) { setPreview(res.body.effects); return }
    onDone?.()
    onClose()
  }

  const name = joinerName || data?.joiner?.name || 'this joiner'
  const unpaid: any[] = data?.unpaid || []
  const orders: any[] = data?.orders || []

  return (
    <Modal open={open} onClose={onClose} title={`Mark claims as lost — ${name}`} subtitle="Released claims become leftovers you can reassign later. Reversible from Leftovers → History." size="lg">
      {loading || !data ? (
        <div className="flex justify-center py-10"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-5">
          {/* 1. Unpaid payment */}
          <section>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">1 · Which payment wasn't paid?</p>
            {unpaid.length === 0 ? (
              <div className="rounded-xl border border-border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
                {name} has no unpaid payment linked to these claims, so nothing can be marked as lost here.
              </div>
            ) : (
              <div className="space-y-1.5">
                {unpaid.map(u => (
                  <label key={u.key} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${triggerKey === u.key ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary/40'}`}>
                    <input type="radio" name="trigger" checked={triggerKey === u.key} onChange={() => { setTriggerKey(u.key); setPreview(null) }} className="accent-primary" />
                    <PaymentTypeChip type={u.type} />
                    <span className="text-sm flex-1 min-w-0 truncate">{u.label}</span>
                    {u.overdue && <span className="text-[10px] font-bold text-red-600">OVERDUE</span>}
                    {u.proof_submitted && <span className="text-[10px] font-semibold text-amber-600" title="Proof submitted, not validated yet">📎 proof sent</span>}
                    <span className="text-sm font-semibold tabular-nums">{formatEur(u.amount_eur)}</span>
                  </label>
                ))}
                {(() => {
                  const t = unpaid.find(u => u.key === triggerKey)
                  if (t?.type !== 'ems') return null
                  return <p className="text-xs text-muted-foreground pt-1">Unpaid EMS: {name} will also be removed from this box&apos;s customs split, and an unpaid customs share there is cancelled.</p>
                })()}
              </div>
            )}
          </section>

          {/* 2. Claims */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">2 · Claims to release</p>
              {allRowIds.length > 0 && (
                <button className="text-xs font-semibold text-primary hover:underline"
                  onClick={() => toggleRows(allRowIds, selected.size !== allRowIds.length)}>
                  {selected.size === allRowIds.length ? 'Clear all' : 'Select everything'}
                </button>
              )}
            </div>
            {orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active claims for {name} here.</p>
            ) : (
              <div className="space-y-3">
                {orders.map(o => {
                  const ids: string[] = o.lines.flatMap((l: any) => l.rows.map((r: any) => r.id))
                  const allOn = ids.every(id => selected.has(id))
                  return (
                    <div key={o.order_id} className="border border-border rounded-xl overflow-hidden">
                      <label className="flex items-center gap-2.5 px-3 py-2 bg-secondary/40 cursor-pointer">
                        <input type="checkbox" checked={allOn} onChange={() => toggleRows(ids, !allOn)} className="accent-primary" />
                        <span className="text-sm font-semibold flex-1">{o.label}</span>
                        <span className="text-[11px] text-muted-foreground">{o.paid ? 'order paid' : 'order unpaid'} · select all in this order</span>
                      </label>
                      <div className="divide-y divide-border/50">
                        {o.lines.map((l: any) => {
                          const lineIds: string[] = l.rows.map((r: any) => r.id)
                          const on = lineIds.filter(id => selected.has(id)).length
                          const isOpen = expanded.has(l.key)
                          return (
                            <div key={l.key}>
                              <div className="flex items-center gap-2.5 px-3 py-2">
                                <input type="checkbox" checked={on === lineIds.length} ref={el => { if (el) el.indeterminate = on > 0 && on < lineIds.length }}
                                  onChange={() => toggleRows(lineIds, on !== lineIds.length)} className="accent-primary" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium leading-snug">
                                    {l.description}{l.version_name && <span className="text-muted-foreground font-normal"> · {l.version_name}</span>}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {l.rows.map((r: any) => r.member_name || `×${r.amount_claimed}`).join(', ')}
                                    {l.inclusions_count > 0 && <span className="ml-1.5 text-primary">· {l.inclusions_count} inclusion{l.inclusions_count !== 1 ? 's' : ''}</span>}
                                  </p>
                                </div>
                                {l.price_eur != null && <span className="text-xs tabular-nums text-muted-foreground">{formatEur(l.price_eur)} each</span>}
                                {l.rows.length > 1 && (
                                  <button className="text-muted-foreground hover:text-foreground p-0.5" title="Pick single members"
                                    onClick={() => setExpanded(prev => { const n = new Set(prev); isOpen ? n.delete(l.key) : n.add(l.key); return n })}>
                                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                  </button>
                                )}
                              </div>
                              {isOpen && (
                                <div className="pl-10 pr-3 pb-2 flex flex-wrap gap-1.5">
                                  {l.rows.map((r: any) => (
                                    <label key={r.id} className={`text-xs px-2 py-1 rounded-full border cursor-pointer ${selected.has(r.id) ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300' : 'bg-background border-border'}`}>
                                      <input type="checkbox" className="hidden" checked={selected.has(r.id)} onChange={() => toggleRows([r.id], !selected.has(r.id))} />
                                      {r.member_name || 'No member'}{r.amount_claimed > 1 ? ` ×${r.amount_claimed}` : ''}
                                    </label>
                                  ))}
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
          </section>

          {/* 3. Reason */}
          <section>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">3 · Note (shown to the joiner)</p>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="e.g. EMS deadline passed on 3 Oct, no reply to two reminders"
              className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/25" />
          </section>

          {preview && <EffectsPreview effects={preview} name={name} />}

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 px-3 py-2.5 text-sm text-red-700 dark:text-red-300">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            {!preview ? (
              <Button onClick={() => submit(true)} disabled={busy || !triggerKey || selected.size === 0}>
                {busy ? 'Checking…' : `Review ${selected.size} claim${selected.size !== 1 ? 's' : ''}`}
              </Button>
            ) : (
              <Button variant="destructive" onClick={() => submit(false)} disabled={busy}>
                <PackageX size={14} /> {busy ? 'Marking…' : `Mark ${selected.size} as lost`}
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

function EffectsPreview({ effects, name }: { effects: any; name: string }) {
  const released = effects?.pc?.released || []
  const incl = effects?.pc?.inclusions || []
  const boxes = (effects?.boxes || []).filter((b: any) => b.ems_cancelled || b.customs_cancelled || b.customs_excluded)
  const shipments = effects?.shipments || []
  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50/70 dark:bg-amber-900/10 dark:border-amber-800 px-4 py-3.5 space-y-2.5 text-sm">
      <p className="text-xs font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">What will happen</p>
      <Effect>{effects.claims.length} claim{effects.claims.length !== 1 ? 's' : ''} released from {name} and listed as leftovers</Effect>
      {incl.map((i: any, k: number) => (
        <Effect key={`i${k}`}>Sorting “{i.session_title}”: −{i.count} inclusion{i.count !== 1 ? 's' : ''} of {i.pack_name}{i.locked ? ' (locked session — edited in place, sort not re-run)' : ''}</Effect>
      ))}
      {released.length > 0 && (
        <Effect>
          {released.length} sorted card{released.length !== 1 ? 's' : ''} back in stock as leftovers:{' '}
          <span className="text-muted-foreground">{released.map((r: any) => `${r.item_name} – ${r.member_name}${r.was_guaranteed ? ' (guaranteed)' : ''}`).join(', ')}</span>
        </Effect>
      )}
      {boxes.map((b: any) => (
        <Effect key={b.box_id}>
          {b.label}: {[b.ems_cancelled && 'unpaid EMS share cancelled', b.customs_cancelled && 'unpaid customs share cancelled', b.customs_excluded && 'removed from the customs split'].filter(Boolean).join(' · ')}
        </Effect>
      ))}
      {shipments.map((s: any) => (
        <Effect key={s.shipment_id}>
          {s.title}: {s.empty ? 'nothing left to pack — shipment flagged' : 'lost claims removed from the packing list'}{s.payment_cancelled ? ', unpaid shipping cancelled' : ''}
        </Effect>
      ))}
      <p className="text-xs text-muted-foreground pt-1">Other joiners&apos; published EMS/customs amounts and sort results don&apos;t change. Anything already paid stays on record.</p>
    </section>
  )
}

function Effect({ children }: { children: React.ReactNode }) {
  return <p className="flex items-start gap-2"><Check size={13} className="mt-0.5 text-amber-600 flex-shrink-0" /><span>{children}</span></p>
}

// Small "Lost — unpaid X" badge used on joiner-facing views.
export function LostBadge({ triggerType, triggerLabel }: { triggerType?: string; triggerLabel?: string }) {
  const what = triggerType === 'ems' ? 'EMS' : triggerType === 'customs' ? 'customs' : triggerType === 'shipping' ? 'shipping' : 'order payment'
  return (
    <span title={triggerLabel} className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800">
      Lost — unpaid {what}
    </span>
  )
}

export function lostWhen(d: string | null | undefined) { return d ? formatDate(d) : '' }
