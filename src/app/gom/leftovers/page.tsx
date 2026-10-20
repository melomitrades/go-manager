'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PackageOpen, RefreshCw, Undo2, UserPlus, Check, X, Inbox, History } from 'lucide-react'
import { PageHeader, Modal, Button, Select, EmptyState } from '@/components/ui'
import { LeftoverBoard, buildEntries, type LeftoverEntry } from '@/components/shared/LeftoverBoard'
import { PaymentTypeChip } from '@/components/shared/MarkLostModal'
import { formatEur, formatDate } from '@/lib/utils'

type Tab = 'leftovers' | 'requests' | 'history'

const STATUS_STYLE: Record<string, string> = {
  leftover: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800',
  reassigned: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-300 dark:border-sky-800',
  restored: 'bg-secondary text-muted-foreground border-border',
  pending: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  declined: 'bg-red-50 text-red-700 border-red-200',
  cancelled: 'bg-secondary text-muted-foreground border-border',
}
function StatusPill({ status }: { status: string }) {
  const label = status === 'leftover' ? 'available' : status
  return <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${STATUS_STYLE[status] || 'bg-secondary border-border'}`}>{label}</span>
}

export default function GomLeftoversPage() {
  const [tab, setTab] = useState<Tab>('leftovers')
  const [slots, setSlots] = useState<any[]>([])
  const [slotOptions, setSlotOptions] = useState<any[] | null>(null)
  const [optionKey, setOptionKey] = useState('')
  const [data, setData] = useState<{ claims: any[]; pcs: any[]; batches: any[]; requests: any[] } | null>(null)
  const [users, setUsers] = useState<any[]>([])
  const [showAll, setShowAll] = useState(false)
  const [assign, setAssign] = useState<{ kind: 'claim' | 'pc' | 'slot'; id: string; label: string; entry?: LeftoverEntry } | null>(null)
  const [assignTo, setAssignTo] = useState('')
  const [restoreBatch, setRestoreBatch] = useState<any | null>(null)
  const [restoreNote, setRestoreNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const [d, sl] = await Promise.all([
      fetch('/api/leftovers/manage').then(r => r.json()).catch(() => null),
      fetch('/api/leftovers').then(r => r.json()).catch(() => []),
    ])
    setData(d && !d.error ? d : { claims: [], pcs: [], batches: [], requests: [] })
    setSlots(Array.isArray(sl) ? sl : [])
  }, [])

  function openGive(e: LeftoverEntry) {
    setAssignTo(''); setOptionKey(''); setSlotOptions(null)
    if (e.kind === 'slot') {
      setAssign({ kind: 'slot', id: e.key, label: `${e.memberName} · ${e.title} — ${e.groupLabel}`, entry: e })
      const p = new URLSearchParams({ order_id: e.order.id })
      if (e.section.versionLabel) p.set('version_label', e.section.versionLabel)
      fetch('/api/leftovers/slot-options?' + p).then(r => r.json()).then(o => {
        const list = Array.isArray(o) ? o : []
        setSlotOptions(list); if (list.length === 1) setOptionKey(list[0].key)
      }).catch(() => setSlotOptions([]))
    } else {
      setAssign({ kind: e.kind, id: e.raw.id, label: `${e.memberName} · ${e.title} — ${e.groupLabel}`, entry: e })
    }
  }
  useEffect(() => {
    load()
    fetch('/api/users').then(r => r.json()).then(u => setUsers(Array.isArray(u) ? u : [])).catch(() => {})
  }, [load])

  async function call(body: any, url = '/api/lost-claims') {
    setBusy(true); setMsg(null)
    const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(async r => ({ ok: r.ok, body: await r.json().catch(() => ({})) }))
    setBusy(false)
    if (!res.ok) { setMsg({ ok: false, text: res.body?.error || 'Something went wrong' }); return null }
    await load()
    return res.body
  }

  async function doAssign() {
    if (!assign || !assignTo) return
    const e = assign.entry
    const r = await call(assign.kind === 'claim'
      ? { action: 'reassign_claim', lost_claim_id: assign.id, joiner_id: assignTo }
      : assign.kind === 'pc'
        ? { action: 'reassign_pc', lost_pc_item_id: assign.id, joiner_id: assignTo }
        : { action: 'give_slot', order_id: e?.order.id, member_id: e?.member.id, version_label: e?.section.versionLabel || null, option_key: optionKey, joiner_id: assignTo })
    if (r) { setMsg({ ok: true, text: assign.kind === 'slot' ? 'Claim added to their order.' : 'Leftover reassigned.' }); setAssign(null); setAssignTo('') }
  }

  async function doRestore() {
    if (!restoreBatch) return
    const r = await call({ action: 'restore', batch_id: restoreBatch.id, note: restoreNote })
    if (r) {
      const skipped = (r.claims_skipped || 0) + (r.pc_skipped || 0)
      setMsg({ ok: true, text: `Restored ${r.claims_restored} claim${r.claims_restored !== 1 ? 's' : ''} and ${r.pc_restored} sorted card${r.pc_restored !== 1 ? 's' : ''}.${skipped ? ` ${skipped} could not be restored (already reassigned or out of stock).` : ''}` })
      setRestoreBatch(null); setRestoreNote('')
    }
  }

  async function decide(id: string, approve: boolean) {
    const note = approve ? '' : (window.prompt('Optional note for the joiner') ?? '')
    const r = await call({ id, approve, note }, '/api/leftovers/requests')
    if (r) setMsg({ ok: true, text: approve ? 'Accepted — it’s now in their claims.' : 'Declined.' })
  }

  const entries = useMemo(() => buildEntries(
    (data?.claims || []).filter(c => showAll || c.status === 'leftover'),
    (data?.pcs || []).filter(c => showAll || c.status === 'leftover'),
    slots,
  ), [data, slots, showAll])
  const pendingRequests = (data?.requests || []).filter(r => r.status === 'pending')
  // Pending requests per leftover, keyed like LeftoverEntry.key.
  const pendingByKey = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of pendingRequests) {
      const k = r.lost_claim_id ? `c:${r.lost_claim_id}` : r.lost_pc_item_id ? `p:${r.lost_pc_item_id}` : `s:${r.order_id}:${r.member_id || ''}:${r.version_label || ''}`
      m[k] = (m[k] || 0) + 1
    }
    return m
  }, [pendingRequests])
  const availableCount = entries.filter(e => e.status === 'leftover' || e.status === 'open').length

  const tabs: { id: Tab; label: string; icon: any; count?: number }[] = [
    { id: 'leftovers', label: 'Leftovers', icon: PackageOpen, count: availableCount },
    { id: 'requests', label: 'Requests', icon: Inbox, count: pendingRequests.length },
    { id: 'history', label: 'History', icon: History },
  ]

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Leftovers" subtitle="Claims released from unpaid joiners, open member slots, and joiner requests"
        action={<Button variant="outline" size="sm" onClick={load}><RefreshCw size={13} /> Refresh</Button>} />

      <div className="flex border-b border-border px-4 sm:px-6 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-all whitespace-nowrap ${tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            <t.icon size={14} /> {t.label}
            {!!t.count && <span className="ml-1 bg-primary text-primary-foreground text-xs px-1.5 py-0.5 rounded-full">{t.count}</span>}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-4">
        {msg && (
          <div className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm ${msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300' : 'border-red-200 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
            <span>{msg.text}</span><button onClick={() => setMsg(null)}><X size={14} /></button>
          </div>
        )}

        {!data ? (
          <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
        ) : tab === 'leftovers' ? (
          <>
            <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground cursor-pointer w-fit">
              <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="accent-primary" /> Also show reassigned / restored
            </label>
            {entries.length === 0 ? (
              <EmptyState icon={PackageOpen} title="No leftovers" description="Lost claims (from Payments → Unpaid or an order's Lost button), guaranteed album copies nobody claimed, and released sorted cards show up here." />
            ) : (
              <LeftoverBoard entries={entries} isGom renderAction={e => (
                <div className="flex items-center gap-2 flex-shrink-0">
                  {pendingByKey[e.key] && (
                    <button onClick={() => setTab('requests')} className="text-xs font-semibold text-amber-600 hover:underline">
                      {pendingByKey[e.key]} request{pendingByKey[e.key] > 1 ? 's' : ''}
                    </button>
                  )}
                  <StatusPill status={e.status === 'open' ? 'leftover' : e.status} />
                  {(e.status === 'leftover' || e.status === 'open') && (
                    <Button size="sm" variant="outline" onClick={() => openGive(e)}
                      disabled={e.kind === 'pc' && (e.raw.stock_available ?? 0) <= 0}
                      title={e.kind === 'pc' && (e.raw.stock_available ?? 0) <= 0 ? 'No longer in stock — the sort was re-run or quantities edited' : undefined}>
                      <UserPlus size={12} /> {e.kind === 'slot' ? 'Give' : 'Reassign'}
                    </Button>
                  )}
                </div>
              )} />
            )}
          </>
        ) : tab === 'requests' ? (
          (data.requests || []).length === 0 ? (
            <EmptyState icon={Inbox} title="No requests yet" description="Joiners can ask for leftovers from their Leftovers page. Accepting puts it straight into their claims." />
          ) : (
            <section className="border border-border rounded-2xl overflow-hidden bg-card divide-y divide-border/50">
              {data.requests.map(r => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-[220px]">
                    <p className="text-sm"><strong>{r.joiner_name}</strong> asks for{' '}
                      {r.kind === 'lost_claim' ? <>{r.claim_description}{r.claim_member_name && ` · ${r.claim_member_name}`}{r.claim_version && ` · ${r.claim_version}`}</>
                        : r.kind === 'lost_pc' ? <>{r.pc_item_name} · {r.pc_member_name} <span className="text-muted-foreground">({r.pc_session_title})</span></>
                        : <>an open slot{r.slot_member_name && ` · ${r.slot_member_name}`}{r.version_label && ` · ${r.version_label}`}
                          {r.slot_option && <span className="text-muted-foreground"> — {r.slot_option.description || 'claim'}{r.slot_option.price_eur != null ? ` (${formatEur(r.slot_option.price_eur)})` : ''}</span>}</>}
                    </p>
                    <p className="text-xs text-muted-foreground">{r.kind === 'lost_pc' ? 'Sorted card' : r.order_label} · {formatDate(r.created_at)}{r.note && <span className="italic"> · “{r.note}”</span>}</p>
                    {r.gom_note && <p className="text-xs text-muted-foreground">Your note: {r.gom_note}</p>}
                  </div>
                  <StatusPill status={r.status} />
                  {r.status === 'pending' && (
                    <div className="flex gap-1.5">
                      <Button size="sm" onClick={() => decide(r.id, true)} disabled={busy}><Check size={12} /> Accept</Button>
                      <Button size="sm" variant="outline" onClick={() => decide(r.id, false)} disabled={busy}><X size={12} /> Decline</Button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )
        ) : (
          (data.batches || []).length === 0 ? (
            <EmptyState icon={History} title="Nothing marked as lost yet" />
          ) : (
            <section className="border border-border rounded-2xl overflow-hidden bg-card divide-y divide-border/50">
              {data.batches.map(b => {
                const eff = typeof b.effects === 'string' ? JSON.parse(b.effects) : (b.effects || {})
                const boxNotes = (eff.boxes || []).filter((x: any) => x.ems_cancelled || x.customs_cancelled || x.customs_excluded)
                return (
                  <div key={b.id} className={`px-4 py-3 ${b.restored_at ? 'opacity-60' : ''}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <PaymentTypeChip type={b.trigger_type} />
                      <p className="text-sm flex-1 min-w-[200px]"><strong>{b.joiner_name}</strong> · unpaid {b.trigger_label}{b.trigger_amount_eur != null && ` (${formatEur(parseFloat(b.trigger_amount_eur))})`}</p>
                      <span className="text-xs text-muted-foreground">{formatDate(b.lost_at)} by {b.lost_by_name || '?'}</span>
                      {b.restored_at
                        ? <span className="text-xs font-semibold text-muted-foreground">Restored {formatDate(b.restored_at)}</span>
                        : <Button size="sm" variant="outline" onClick={() => setRestoreBatch(b)}><Undo2 size={12} /> Restore</Button>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {b.claim_count} claim{b.claim_count !== 1 ? 's' : ''}{b.pc_count > 0 && ` · ${b.pc_count} sorted card${b.pc_count !== 1 ? 's' : ''}`}
                      {boxNotes.map((x: any) => ` · ${x.label}: ${[x.ems_cancelled && 'EMS cancelled', x.customs_cancelled && 'customs cancelled', x.customs_excluded && 'out of customs'].filter(Boolean).join(', ')}`).join('')}
                      {(eff.shipments || []).filter((s: any) => s.payment_cancelled).map((s: any) => ` · ${s.title}: shipping cancelled`).join('')}
                    </p>
                    {b.reason && <p className="text-xs italic text-muted-foreground mt-0.5">“{b.reason}”</p>}
                    {b.restore_note && <p className="text-xs text-muted-foreground mt-0.5">Restore note: {b.restore_note}</p>}
                  </div>
                )
              })}
            </section>
          )
        )}
      </div>

      <Modal open={!!assign} onClose={() => setAssign(null)} title={assign?.kind === 'slot' ? 'Give open slot' : 'Reassign leftover'} subtitle={assign?.label} size="sm">
        <div className="space-y-4">
          <Select value={assignTo} onChange={e => setAssignTo(e.target.value)} placeholder="Choose a joiner…"
            options={users.map(u => ({ value: u.id, label: `${u.display_name || u.username}${u.role !== 'joiner' ? ` (${u.role})` : ''}` }))} />
          {assign?.kind === 'slot' && (
            slotOptions === null ? <p className="text-xs text-muted-foreground">Loading pricing options…</p>
            : slotOptions.length === 0 ? <p className="text-xs text-red-600">This order has no pricing option to claim with yet — add the claim from the order instead.</p>
            : <Select value={optionKey} onChange={e => setOptionKey(e.target.value)} placeholder="Pricing option…"
                options={slotOptions.map(o => ({ value: o.key, label: `${o.description || 'Claim'}${o.version_name ? ' · ' + o.version_name : ''}${o.price_eur != null ? ' — ' + formatEur(o.price_eur) : ''}${o.inclusions_count ? ` · ${o.inclusions_count} incl.` : ''}` }))} />
          )}
          <p className="text-xs text-muted-foreground">
            {assign?.kind === 'slot'
              ? 'A claim for this member is added to the order for them right away, and their order payment goes up accordingly. PC Sorter inclusions aren’t changed — re-run auto-fill if this order is in a sorting session.'
              : assign?.kind === 'claim'
              ? 'The claim moves into their order and their order payment goes up accordingly. If EMS/customs for that box were already published, add their share on the Boxes page.'
              : 'The card is added to their sorting results. If this session is unlocked and the sort is re-run, results are recomputed from inclusions.'}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAssign(null)}>Cancel</Button>
            <Button onClick={doAssign} disabled={!assignTo || busy || (assign?.kind === 'slot' && !optionKey)}>{busy ? 'Saving…' : assign?.kind === 'slot' ? 'Give' : 'Reassign'}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!restoreBatch} onClose={() => setRestoreBatch(null)} title="Restore lost claims" subtitle={restoreBatch ? `${restoreBatch.joiner_name} · unpaid ${restoreBatch.trigger_label}` : ''} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Gives back every claim from this batch that&apos;s still a leftover, puts their sorted cards back if they&apos;re still in stock, and undoes the EMS/customs/shipping cancellations. Anything already reassigned stays with its new owner.</p>
          <textarea value={restoreNote} onChange={e => setRestoreNote(e.target.value)} rows={2} placeholder="Optional note (e.g. paid late on 12 Oct)"
            className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/25" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRestoreBatch(null)}>Cancel</Button>
            <Button onClick={doRestore} disabled={busy}><Undo2 size={13} /> {busy ? 'Restoring…' : 'Restore'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
