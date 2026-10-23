'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, Search, AlertTriangle, RefreshCw } from 'lucide-react'
import { Input, StatusBadge, Card, Table, Th, Td, Tr, Modal, Button } from '@/components/ui'
import { formatEur, formatKrw, formatDate } from '@/lib/utils'
import { GomPaidLineModal, paidToLabel } from './GomPaidModal'

// ── Coverage: per order, received from joiners vs paid by the GOM ───────────────
// Organised Group → Era → orders, with subtotals at each level and grand totals on top.

const n = (v: any) => parseFloat(v) || 0
const OTHER = '__other__'
const NO_ERA = '__none__'

export const roundLabel = (r: any) => r == null || r === '' ? null : /^\d+$/.test(String(r)) ? `R${r}` : String(r)
export function orderTitle(r: any) {
  return [r.shop_name || 'No shop', roundLabel(r.round_number)].filter(Boolean).join(' · ')
}

function Covered({ value, muted }: { value: number | null; muted?: boolean }) {
  if (value == null) return <span className="text-muted-foreground/50 text-sm">—</span>
  const pos = value >= 0
  return <span className={`text-sm font-semibold tabular-nums ${muted ? 'opacity-70' : ''} ${pos ? 'text-emerald-600' : 'text-red-500'}`}>{value > 0 ? '+' : ''}{formatEur(value)}</span>
}

function totals(rows: any[]) {
  let received = 0, pending = 0, paid = 0, expected = 0, coveredReceived = 0, missing = 0
  for (const r of rows) {
    received += n(r.received_eur); pending += n(r.pending_eur); expected += n(r.expected_eur)
    if (r.lines.length) { paid += n(r.paid_eur); coveredReceived += n(r.received_eur) } else missing++
  }
  // Covered only counts orders that have their amount paid entered — an order with nothing
  // logged yet would otherwise look fully "covered".
  return { received, pending, paid, expected, covered: coveredReceived - paid, missing, count: rows.length }
}

function SubTotals({ t, compact }: { t: ReturnType<typeof totals>; compact?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${compact ? 'text-xs' : 'text-xs sm:text-sm'} text-muted-foreground tabular-nums`}>
      <span>Received <b className="text-foreground font-semibold">{formatEur(t.received)}</b>{t.pending > 0 && <span className="text-amber-600"> +{formatEur(t.pending)} pending</span>}</span>
      <span>Paid <b className="text-foreground font-semibold">{formatEur(t.paid)}</b></span>
      <span>Covered <Covered value={t.count - t.missing > 0 ? t.covered : null}/></span>
      {t.missing > 0 && <span className="text-amber-600 font-semibold">{t.missing} missing</span>}
    </div>
  )
}

export function GomCoverage() {
  const [rows, setRows] = useState<any[] | null>(null)
  const [search, setSearch] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [hideClosed, setHideClosed] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [openOrder, setOpenOrder] = useState<string | null>(null)
  const [lineModal, setLineModal] = useState<{ order: any; line: any | null } | null>(null)
  const [deleting, setDeleting] = useState<{ order: any; line: any } | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    const res = await fetch('/api/gom-payments').then(r => r.json()).catch(() => [])
    setRows(Array.isArray(res) ? res : [])
    setRefreshing(false)
  }, [])
  useEffect(() => { load() }, [load])

  // Remember collapsed sections per browser
  useEffect(() => { try { const s = localStorage.getItem('coverage-collapsed'); if (s) setCollapsed(new Set(JSON.parse(s))) } catch {} }, [])
  function toggle(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key)
      try { localStorage.setItem('coverage-collapsed', JSON.stringify(Array.from(next))) } catch {}
      return next
    })
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter(r => {
      if (hideClosed && r.status === 'closed') return false
      if (onlyMissing && r.lines.length) return false
      if (q && ![r.shop_name, r.group_name, r.era_name, r.round_number, r.personal_joiner_name].some(v => String(v || '').toLowerCase().includes(q))) return false
      return true
    })
  }, [rows, search, onlyMissing, hideClosed])

  // Group → Era → orders
  const tree = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; eras: Map<string, { key: string; name: string; active: boolean; created: string; rows: any[] }> }>()
    for (const r of filtered) {
      const gKey = r.type === 'personal' || !r.group_id ? OTHER : r.group_id
      const gName = gKey === OTHER ? 'Other / personal' : (r.group_name || 'Unknown group')
      if (!groups.has(gKey)) groups.set(gKey, { key: gKey, name: gName, eras: new Map() })
      const g = groups.get(gKey)!
      const eKey = gKey === OTHER ? NO_ERA : (r.era_id || NO_ERA)
      if (!g.eras.has(eKey)) g.eras.set(eKey, { key: eKey, name: eKey === NO_ERA ? 'No era' : r.era_name, active: r.era_status === 'active', created: r.era_created_at || '', rows: [] })
      g.eras.get(eKey)!.rows.push(r)
    }
    return Array.from(groups.values())
      .sort((a, b) => a.key === OTHER ? 1 : b.key === OTHER ? -1 : a.name.localeCompare(b.name))
      .map(g => ({
        ...g,
        eraList: Array.from(g.eras.values()).sort((a, b) =>
          a.key === NO_ERA ? 1 : b.key === NO_ERA ? -1 : (Number(b.active) - Number(a.active)) || b.created.localeCompare(a.created)),
      }))
  }, [filtered])

  const grand = totals(filtered)
  const allMissing = (rows || []).filter(r => !r.lines.length && !(hideClosed && r.status === 'closed')).length

  async function deleteLine() {
    if (!deleting) return
    const { order, line } = deleting
    setDeleting(null)
    // Optimistic: drop the line locally, then sync quietly
    setRows(prev => (prev || []).map(r => r.id !== order.id ? r : {
      ...r, lines: r.lines.filter((l: any) => l.id !== line.id),
      paid_eur: r.lines.filter((l: any) => l.id !== line.id).reduce((s: number, l: any) => s + n(l.amount_eur), 0) || null,
    }))
    await fetch('/api/gom-payments', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: line.id }) })
    load()
  }

  if (rows === null) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>

  return (
    <div className="space-y-4">
      {/* Grand totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Received (validated)', value: formatEur(grand.received), sub: grand.pending > 0 ? `+ ${formatEur(grand.pending)} pending` : `expected ${formatEur(grand.expected)}` },
          { label: 'Paid by GOM', value: formatEur(grand.paid), sub: `${grand.count - grand.missing} of ${grand.count} orders entered` },
          { label: 'Covered', value: null, sub: 'received − paid, on orders with paid entered' },
          { label: 'Missing amount paid', value: String(grand.missing), sub: grand.missing ? 'click to show them' : 'all entered 🎉', missing: true },
        ].map((c, i) => (
          <button key={i} type="button" disabled={!c.missing}
            onClick={() => c.missing && setOnlyMissing(v => !v)}
            className={`text-left bg-card border rounded-2xl px-4 py-3 ${c.missing ? (onlyMissing ? 'border-amber-400 ring-2 ring-amber-200' : grand.missing ? 'border-amber-300 hover:border-amber-400' : 'border-border') : 'border-border cursor-default'}`}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{c.label}</p>
            <p className={`font-display text-xl font-bold mt-0.5 tabular-nums ${c.missing && grand.missing ? 'text-amber-600' : ''}`}>
              {c.value ?? <Covered value={grand.count - grand.missing > 0 ? grand.covered : null}/>}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{c.sub}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/>
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search shop, group, era…" className="pl-8 py-2 text-xs w-56"/>
        </div>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground cursor-pointer">
          <input type="checkbox" className="accent-primary" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)}/> Missing amount only{allMissing ? ` (${allMissing})` : ''}
        </label>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground cursor-pointer">
          <input type="checkbox" className="accent-primary" checked={hideClosed} onChange={e => setHideClosed(e.target.checked)}/> Hide closed
        </label>
        <button onClick={load} className="ml-auto text-muted-foreground hover:text-foreground p-1" title="Refresh">
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''}/>
        </button>
      </div>
      <p className="text-xs text-muted-foreground">Orders show here once they&apos;re <b>Ordered</b>. Received = order payments you validated (EMS, customs and shipping aren&apos;t included). Orders created before 22 Oct 2026 stay on the old system — their payments are in the Archive.</p>

      {tree.length === 0 && <div className="text-center py-10 text-sm text-muted-foreground">{rows.length ? 'No orders match these filters.' : 'No ordered orders yet.'}</div>}

      {tree.map(g => {
        const gRows = g.eraList.flatMap(e => e.rows)
        const gOpen = !collapsed.has(`g:${g.key}`)
        return (
          <div key={g.key} className="border border-border rounded-2xl overflow-hidden bg-card">
            <button onClick={() => toggle(`g:${g.key}`)} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 bg-secondary/40 hover:bg-secondary/60 text-left">
              {gOpen ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}
              <span className="font-display font-semibold">{g.name}</span>
              <span className="text-xs text-muted-foreground">{gRows.length} order{gRows.length > 1 ? 's' : ''}</span>
              <div className="w-full sm:w-auto sm:ml-auto pl-6 sm:pl-0"><SubTotals t={totals(gRows)}/></div>
            </button>

            {gOpen && g.eraList.map(e => {
              const showEraHeader = g.key !== OTHER && !(g.eraList.length === 1 && e.key === NO_ERA)
              const eKey = `e:${g.key}:${e.key}`
              const eOpen = !showEraHeader || !collapsed.has(eKey)
              return (
                <div key={e.key} className="border-t border-border">
                  {showEraHeader && (
                    <button onClick={() => toggle(eKey)} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 hover:bg-secondary/30 text-left">
                      {eOpen ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
                      <span className={`text-sm font-semibold ${e.key === NO_ERA ? 'text-muted-foreground italic' : ''}`}>{e.name}</span>
                      {e.key !== NO_ERA && !e.active && <span className="text-[10px] uppercase font-bold text-muted-foreground/70 border border-border rounded px-1">ended</span>}
                      <span className="text-xs text-muted-foreground">{e.rows.length}</span>
                      <div className="w-full sm:w-auto sm:ml-auto pl-5 sm:pl-0"><SubTotals t={totals(e.rows)} compact/></div>
                    </button>
                  )}
                  {eOpen && (
                    <div className="divide-y divide-border/50">
                      {/* column labels (desktop) */}
                      <div className="hidden md:grid grid-cols-[1fr_110px_150px_150px_120px] gap-3 px-4 pl-10 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 bg-secondary/20">
                        <span>Order</span><span className="text-right">Expected</span><span className="text-right">Received</span><span className="text-right">Paid</span><span className="text-right">Covered</span>
                      </div>
                      {e.rows.map(r => <OrderRow key={r.id} r={r} open={openOrder === r.id}
                        onToggle={() => setOpenOrder(o => o === r.id ? null : r.id)}
                        onAdd={() => setLineModal({ order: r, line: null })}
                        onEdit={(l: any) => setLineModal({ order: r, line: l })}
                        onDelete={(l: any) => setDeleting({ order: r, line: l })}/>)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}

      <GomPaidLineModal
        open={!!lineModal}
        orderId={lineModal?.order.id || null}
        orderLabel={lineModal ? `${lineModal.order.group_name ? lineModal.order.group_name + ' · ' : ''}${orderTitle(lineModal.order)}` : ''}
        line={lineModal?.line || null}
        received={lineModal ? n(lineModal.order.received_eur) : undefined}
        otherPaid={lineModal ? lineModal.order.lines.filter((l: any) => l.id !== lineModal.line?.id).reduce((s: number, l: any) => s + n(l.amount_eur), 0) : 0}
        onClose={() => setLineModal(null)}
        onSaved={() => { if (lineModal) setOpenOrder(lineModal.order.id); load() }}
      />

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete payment" size="sm">
        <p className="text-sm text-muted-foreground mb-5">Delete this {deleting ? formatEur(n(deleting.line.amount_eur)) : ''} payment from {deleting ? orderTitle(deleting.order) : ''}?</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="destructive" onClick={deleteLine}>Delete</Button>
        </div>
      </Modal>
    </div>
  )
}

function OrderRow({ r, open, onToggle, onAdd, onEdit, onDelete }: any) {
  const has = r.lines.length > 0
  const paid = n(r.paid_eur)
  const covered = has ? n(r.received_eur) - paid : null
  return (
    <div className={open ? 'bg-primary/[0.02]' : ''}>
      <div onClick={onToggle} className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_110px_150px_150px_120px] gap-x-3 gap-y-1 items-center px-4 py-2.5 cursor-pointer hover:bg-primary/[0.03]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-muted-foreground flex-shrink-0">{open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{orderTitle(r)}{r.personal_joiner_name && <span className="font-normal text-primary"> → {r.personal_joiner_name}</span>}</p>
            <div className="flex items-center gap-2 mt-0.5"><StatusBadge status={r.status}/>{r.ordered_at && <span className="text-[11px] text-muted-foreground">ordered {formatDate(r.ordered_at)}</span>}</div>
          </div>
        </div>
        {/* mobile: covered on the right of the title */}
        <div className="md:hidden text-right"><Covered value={covered}/></div>
        <div className="hidden md:block text-right text-sm tabular-nums text-muted-foreground">{formatEur(n(r.expected_eur))}</div>
        <div className="text-right text-sm tabular-nums col-span-2 md:col-span-1 flex md:block justify-between">
          <span className="md:hidden text-xs text-muted-foreground">Received</span>
          <span>
            <span className="font-medium">{formatEur(n(r.received_eur))}</span>
            {n(r.pending_eur) > 0 && <span className="block text-[11px] text-amber-600">+{formatEur(n(r.pending_eur))} pending</span>}
            <span className="block text-[11px] text-muted-foreground">{r.joiners_paid}/{r.joiners} joiners paid</span>
          </span>
        </div>
        <div className="text-right text-sm tabular-nums col-span-2 md:col-span-1 flex md:block justify-between items-center" onClick={e => { if (!has) { e.stopPropagation(); onAdd() } }}>
          <span className="md:hidden text-xs text-muted-foreground">Paid</span>
          {has
            ? <span><span className="font-semibold">{formatEur(paid)}</span>{r.lines.length > 1 && <span className="block text-[11px] text-muted-foreground">{r.lines.length} payments</span>}</span>
            : <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800"><AlertTriangle size={11}/> Enter amount</span>}
        </div>
        <div className="hidden md:block text-right"><Covered value={covered}/></div>
      </div>

      {open && (
        <div className="px-4 pl-10 pb-3 space-y-2">
          {has ? (
            <div className="border border-border rounded-xl divide-y divide-border/60 bg-background">
              {r.lines.map((l: any) => (
                <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className="text-xs text-muted-foreground w-24">{l.paid_at ? formatDate(l.paid_at) : '—'}</span>
                  {l.paid_to && <span className="text-[11px] font-semibold bg-secondary border border-border rounded-full px-2 py-0.5">{paidToLabel(l.paid_to)}</span>}
                  <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">{l.note}</span>
                  <span className="tabular-nums font-semibold">{formatEur(n(l.amount_eur))}</span>
                  {l.amount_krw != null && <span className="text-[11px] text-muted-foreground tabular-nums">{formatKrw(n(l.amount_krw))}{l.krw_rate ? ` @ ${n(l.krw_rate)}` : ''}</span>}
                  <div className="flex">
                    <button onClick={() => onEdit(l)} className="p-1.5 text-muted-foreground hover:text-foreground" title="Edit"><Pencil size={12}/></button>
                    <button onClick={() => onDelete(l)} className="p-1.5 text-destructive/50 hover:text-destructive" title="Delete"><Trash2 size={12}/></button>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-muted-foreground">No amount paid entered yet.</p>}
          <button onClick={onAdd} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"><Plus size={12}/> Add payment</button>
        </div>
      )}
    </div>
  )
}

// ── Archive: the old GOM payments log, read-only ────────────────────────────────

export function GomPaymentsArchive() {
  const [rows, setRows] = useState<any[] | null>(null)
  useEffect(() => { fetch('/api/payments').then(r => r.json()).then(d => setRows(Array.isArray(d) ? d : [])).catch(() => setRows([])) }, [])
  if (rows === null) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>
  if (rows.length === 0) return <div className="text-center py-10 text-sm text-muted-foreground">The archive is empty.</div>
  const total = rows.reduce((s, p) => s + n(p.amount_eur), 0)
  const label = (p: any) => [p.order_group_name, roundLabel(p.order_round), p.order_shop_name].filter(Boolean).join(' · ') || null
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Payments logged with the old system — kept read-only for reference. They aren&apos;t counted in the coverage tab. Total {formatEur(total)} over {rows.length} entries.</p>
      <Card>
        <Table>
          <thead><tr><Th>Order</Th><Th>Date</Th><Th className="text-right">Amount (€)</Th><Th className="text-right">Amount (₩)</Th><Th>Note</Th></tr></thead>
          <tbody>
            {rows.map(p => (
              <Tr key={p.id}>
                <Td className="text-sm font-medium">{label(p) || <span className="text-muted-foreground/50 italic">—</span>}</Td>
                <Td className="text-sm text-muted-foreground">{formatDate(p.deadline || p.created_at)}</Td>
                <Td className="text-right font-mono font-semibold">{formatEur(n(p.amount_eur))}</Td>
                <Td className="text-right font-mono text-sm text-muted-foreground">{p.amount_krw ? formatKrw(n(p.amount_krw)) : '—'}</Td>
                <Td className="text-xs text-muted-foreground">{p.notes || ''}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  )
}
