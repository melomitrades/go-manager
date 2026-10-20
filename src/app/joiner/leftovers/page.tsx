'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PackageOpen, Send, X } from 'lucide-react'
import { PageHeader, Modal, Button, EmptyState } from '@/components/ui'
import { LeftoverBoard, buildEntries, type LeftoverEntry } from '@/components/shared/LeftoverBoard'
import { formatEur, formatDate } from '@/lib/utils'

const REQ_STYLE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800',
  declined: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800',
  cancelled: 'bg-secondary text-muted-foreground border-border',
}
const REQ_LABEL: Record<string, string> = { pending: 'waiting for GOM', approved: 'accepted', declined: 'declined', cancelled: 'cancelled' }

export default function JoinerLeftoversPage() {
  const [data, setData] = useState<{ claims: any[]; pcs: any[]; requests: any[] } | null>(null)
  const [slots, setSlots] = useState<any[]>([])
  const [target, setTarget] = useState<LeftoverEntry | null>(null)
  const [options, setOptions] = useState<any[] | null>(null)
  const [optionKey, setOptionKey] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [d, s] = await Promise.all([
      fetch('/api/leftovers/available').then(r => r.json()).catch(() => null),
      fetch('/api/leftovers').then(r => r.json()).catch(() => []),
    ])
    setData(d && !d.error ? d : { claims: [], pcs: [], requests: [] })
    setSlots(Array.isArray(s) ? s : [])
  }, [])
  useEffect(() => { load() }, [load])

  const entries = useMemo(() => buildEntries(data?.claims || [], data?.pcs || [], slots, true), [data, slots])

  // Already asked (pending) → the button turns into "Requested".
  const pendingKeys = useMemo(() => {
    const k = new Set<string>()
    for (const r of data?.requests || []) {
      if (r.status !== 'pending') continue
      k.add(r.lost_claim_id ? `c:${r.lost_claim_id}` : r.lost_pc_item_id ? `p:${r.lost_pc_item_id}` : `s:${r.order_id}:${r.member_id || ''}:${r.version_label || ''}`)
    }
    return k
  }, [data])

  function openRequest(e: LeftoverEntry) {
    setTarget(e); setError(null); setNote(''); setOptionKey(''); setOptions(null)
    if (e.kind === 'slot') {
      const p = new URLSearchParams({ order_id: e.order.id })
      if (e.section.versionLabel) p.set('version_label', e.section.versionLabel)
      fetch('/api/leftovers/slot-options?' + p).then(r => r.json()).then(o => {
        const list = Array.isArray(o) ? o : []
        setOptions(list); if (list.length === 1) setOptionKey(list[0].key)
      }).catch(() => setOptions([]))
    }
  }

  async function send() {
    if (!target) return
    const body = target.kind === 'claim' ? { kind: 'lost_claim', lost_claim_id: target.raw.id }
      : target.kind === 'pc' ? { kind: 'lost_pc', lost_pc_item_id: target.raw.id }
      : { kind: 'slot', order_id: target.order.id, member_id: target.member.id, version_label: target.section.versionLabel || null, option_key: optionKey }
    setBusy(true); setError(null)
    const res = await fetch('/api/leftovers/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, note }) })
      .then(async r => ({ ok: r.ok, body: await r.json().catch(() => ({})) }))
    setBusy(false)
    if (!res.ok) { setError(res.body?.error || 'Something went wrong'); return }
    setTarget(null); load()
  }
  async function cancel(id: string) {
    await fetch('/api/leftovers/requests', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action: 'cancel' }) })
    load()
  }

  const selectedOption = options?.find(o => o.key === optionKey)

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Leftovers" subtitle="Ask your GOM for an available leftover" />
      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-5">
        {!data ? (
          <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <>
            {entries.length === 0
              ? <EmptyState icon={PackageOpen} title="No leftovers right now" description="Check back later — new leftovers show up here." />
              : <LeftoverBoard entries={entries} isGom={false} renderAction={e => pendingKeys.has(e.key)
                  ? <span className="text-xs font-semibold text-amber-600 flex-shrink-0">Requested</span>
                  : <Button size="sm" variant="outline" onClick={() => openRequest(e)}><Send size={12} /> Request</Button>} />}

            {data.requests.length > 0 && (
              <section className="border border-border rounded-2xl overflow-hidden bg-card">
                <p className="px-4 py-3 border-b border-border text-xs font-bold uppercase tracking-widest text-muted-foreground">My requests</p>
                <div className="divide-y divide-border/50">
                  {data.requests.map(r => (
                    <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">
                          {r.kind === 'lost_claim' ? <>{r.claim_description}{r.claim_member_name && ` · ${r.claim_member_name}`}</>
                            : r.kind === 'lost_pc' ? <>{r.pc_item_name} · {r.pc_member_name}</>
                            : <>{r.slot_member_name || 'Leftover'}{r.version_label && ` · ${r.version_label}`}{r.slot_option && ` — ${r.slot_option.description || 'claim'}${r.slot_option.price_eur != null ? ` (${formatEur(r.slot_option.price_eur)})` : ''}`}</>}
                        </p>
                        <p className="text-xs text-muted-foreground">{r.kind === 'lost_pc' ? r.pc_session_title : r.order_label} · {formatDate(r.created_at)}{r.gom_note && ` · GOM: ${r.gom_note}`}</p>
                      </div>
                      <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${REQ_STYLE[r.status] || ''}`}>{REQ_LABEL[r.status] || r.status}</span>
                      {r.status === 'pending' && <button onClick={() => cancel(r.id)} className="text-muted-foreground hover:text-foreground" title="Cancel request"><X size={14} /></button>}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <Modal open={!!target} onClose={() => setTarget(null)} title="Request this leftover" subtitle={target ? `${target.memberName} · ${target.title} — ${target.groupLabel}` : ''} size="sm">
        <div className="space-y-4">
          {target?.kind === 'slot' && (
            <div className="space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">What do you want to claim?</p>
              {options === null ? <p className="text-sm text-muted-foreground">Loading…</p>
                : options.length === 0 ? <p className="text-sm text-red-600">This order has no option to claim yet — contact your GOM.</p>
                : options.map(o => (
                  <label key={o.key} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer ${optionKey === o.key ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary/40'}`}>
                    <input type="radio" checked={optionKey === o.key} onChange={() => setOptionKey(o.key)} className="accent-primary" />
                    <span className="text-sm flex-1">{o.description || 'Claim'}{o.version_name && <span className="text-muted-foreground"> · {o.version_name}</span>}{o.inclusions_count > 0 && <span className="text-xs text-primary"> · {o.inclusions_count} inclusion{o.inclusions_count > 1 ? 's' : ''}</span>}</span>
                    <span className="text-sm font-semibold tabular-nums">{o.price_eur != null ? formatEur(o.price_eur) : '—'}</span>
                  </label>
                ))}
            </div>
          )}
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Optional message for your GOM"
            className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/25" />
          <p className="text-xs text-muted-foreground">
            Your GOM decides who gets it. Once they accept, it&apos;s added to your claims automatically{target?.kind === 'slot' && selectedOption?.price_eur != null ? ` and ${formatEur(selectedOption.price_eur)} is added to what you owe for this order` : target?.kind === 'claim' ? ' and added to what you owe for this order' : ''}.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
            <Button onClick={send} disabled={busy || (target?.kind === 'slot' && !optionKey)}><Send size={13} /> {busy ? 'Sending…' : 'Send request'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
