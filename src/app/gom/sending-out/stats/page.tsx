'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Package, Send, CheckCircle2, Users, ListChecks, Music, Trophy, Inbox, CreditCard, Clock, Truck, Table2, BarChart3, UserRound } from 'lucide-react'
import { Card, CardContent, PageHeader, Select, Table, Th, Td, Tr, EmptyState, Button } from '@/components/ui'

// Packing stats per GOM. The GOM is assigned per shipping form (Sending Out › Forms); every
// shipment on that form counts for them, including past ones. Data: /api/packing-stats.

type GomStats = {
  gom_id: string; gom_name: string; forms: number; parcels: number; packed: number; shipped: number; received: number
  joiners: number; claims: number; sorted_pcs: number; winner_items: number
  backlog: { to_pack: number; packed_no_payment: number; awaiting_payment: number; ready_to_ship: number }
}
type Monthly = { month: string; counts: Record<string, number> }

const NO_GOM = '__none__'

// Categorical series colours — a pink-forward palette (rose, lavender, peach, mint, berry, periwinkle,
// honey, orchid), fixed order, light / dark steps. Both sets were run through the dataviz palette
// validator (lightness band, chroma, colour-blind separation, normal-vision floor): all checks pass.
// Light-mode peach, periwinkle and honey sit under 3:1 contrast, which the legend + "Show as table"
// view cover. Colour follows the GOM (by position in the full alphabetical list), so filtering
// never repaints anyone. "Not assigned" — and any 9th+ GOM — is a neutral mauve-grey.
const SERIES: { bg: string }[] = [
  { bg: 'bg-[#e14b84] dark:bg-[#e34a93]' },
  { bg: 'bg-[#7b68e0] dark:bg-[#7c6fe3]' },
  { bg: 'bg-[#f2955f] dark:bg-[#cd5d20]' },
  { bg: 'bg-[#2aa198] dark:bg-[#03a89a]' },
  { bg: 'bg-[#b23a8f] dark:bg-[#ab3398]' },
  { bg: 'bg-[#6a9cf0] dark:bg-[#6095d8]' },
  { bg: 'bg-[#d99a2b] dark:bg-[#bc8010]' },
  { bg: 'bg-[#a85bd8] dark:bg-[#8e53b5]' },
]
const NEUTRAL = { bg: 'bg-[#b9a9b3] dark:bg-[#6e6168]' }

// Small square legend / table marker (identity is always also carried by the name).
function Swatch({ cls, size = 10 }: { cls?: string; size?: number }) {
  return <span className={`inline-block rounded-sm flex-shrink-0 ${cls || ''}`} style={{ width: size, height: size }} aria-hidden />
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function monthLabel(m: string, withYear: boolean) {
  const [y, mo] = m.split('-').map(Number)
  return `${MONTHS[mo - 1]}${withYear ? ` ’${String(y).slice(2)}` : ''}`
}
function niceMax(v: number) {
  if (v <= 4) return 4
  const step = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step
  return 10 * step
}

function Tile({ icon: Icon, label, value, hint }: { icon: React.ElementType; label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3.5" title={hint}>
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><Icon size={13} /> {label}</p>
      <p className="font-display text-2xl font-bold mt-1 tabular-nums">{value.toLocaleString('fr-FR')}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{hint}</p>}
    </div>
  )
}

export default function PackingStatsPage() {
  const [data, setData] = useState<{ goms: GomStats[]; monthly: Monthly[]; overall_joiners?: number } | null>(null)
  const [error, setError] = useState('')
  const [gomFilter, setGomFilter] = useState('')
  const [chartAsTable, setChartAsTable] = useState(false)
  const [hoverMonth, setHoverMonth] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/packing-stats').then(async r => {
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.goms) { setError(j?.error || 'Could not load packing stats'); return }
      setData(j)
    }).catch(() => setError('Could not load packing stats'))
  }, [])

  const goms = data?.goms || []
  const colorOf = useMemo(() => {
    const m = new Map<string, { bg: string }>()
    let k = 0
    for (const g of goms) m.set(g.gom_id, g.gom_id === NO_GOM ? NEUTRAL : (SERIES[k++] || NEUTRAL))
    return m
  }, [goms])

  const shown = gomFilter ? goms.filter(g => g.gom_id === gomFilter) : goms
  const sum = (f: (g: GomStats) => number) => shown.reduce((s, g) => s + f(g), 0)
  const totals = {
    parcels: sum(g => g.parcels), packed: sum(g => g.packed), shipped: sum(g => g.shipped), received: sum(g => g.received),
    // A joiner packed by two GOMs counts once overall (distinct across every GOM).
    joiners: gomFilter ? sum(g => g.joiners) : (data?.overall_joiners ?? sum(g => g.joiners)), claims: sum(g => g.claims), sorted_pcs: sum(g => g.sorted_pcs), winner_items: sum(g => g.winner_items),
    to_pack: sum(g => g.backlog.to_pack), packed_no_payment: sum(g => g.backlog.packed_no_payment),
    awaiting_payment: sum(g => g.backlog.awaiting_payment), ready_to_ship: sum(g => g.backlog.ready_to_ship),
  }
  const unassigned = goms.find(g => g.gom_id === NO_GOM)

  const monthly = data?.monthly || []
  const monthTotal = (m: Monthly) => shown.reduce((s, g) => s + (m.counts[g.gom_id] || 0), 0)
  const yMax = niceMax(Math.max(0, ...monthly.map(monthTotal)))
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => yMax * f).filter(t => Number.isInteger(t))
  const chartEmpty = monthly.every(m => monthTotal(m) === 0)

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Packing stats"
        subtitle="Who packed what, per GOM. Assign a GOM to each shipping form in Sending Out › Forms."
        action={<Link href="/gom/sending-out"><Button variant="outline" className="whitespace-nowrap"><ArrowLeft size={14} /> <span className="hidden sm:inline">Sending Out</span><span className="sm:hidden">Back</span></Button></Link>}
      />

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-6">
        {error ? <EmptyState icon={BarChart3} title="Packing stats unavailable" description={error} />
          : !data ? <div className="space-y-3"><div className="h-24 shimmer rounded-2xl" /><div className="h-64 shimmer rounded-2xl" /></div>
          : goms.length === 0 ? <EmptyState icon={Package} title="No shipments yet" description="Stats appear once joiners submit a shipping form or you add a manual entry." />
          : <>
            {/* Filter row */}
            <div className="flex flex-wrap items-center gap-2">
              <Select
                options={[{ value: '', label: 'All GOMs' }, ...goms.map(g => ({ value: g.gom_id, label: g.gom_name }))]}
                value={gomFilter} onChange={e => setGomFilter(e.target.value)} className="w-auto max-w-[240px]" />
              {unassigned && unassigned.parcels > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1">
                  <UserRound size={12} /> {unassigned.parcels} shipment{unassigned.parcels === 1 ? '' : 's'} on {unassigned.forms} form{unassigned.forms === 1 ? '' : 's'} without a GOM —
                  <Link href="/gom/sending-out" className="font-semibold underline">assign one</Link>
                </p>
              )}
            </div>

            {/* Volume */}
            <section className="space-y-2">
              <h2 className="font-display font-semibold text-lg">Volume</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Tile icon={Package} label="Parcels packed" value={totals.packed} hint={`of ${totals.parcels} shipment${totals.parcels === 1 ? '' : 's'} submitted`} />
                <Tile icon={Send} label="Parcels shipped" value={totals.shipped} />
                <Tile icon={CheckCircle2} label="Received by joiners" value={totals.received} />
                <Tile icon={Users} label="Joiners served" value={totals.joiners} hint="Distinct joiners with a packed parcel" />
                <Tile icon={ListChecks} label="Claims packed" value={totals.claims} hint="Claimed items confirmed in the Pack wizard" />
                <Tile icon={Music} label="Sorted PCs packed" value={totals.sorted_pcs} />
                <Tile icon={Trophy} label="Winner items packed" value={totals.winner_items} />
              </div>
            </section>

            {/* Backlog */}
            <section className="space-y-2">
              <h2 className="font-display font-semibold text-lg">Backlog right now</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Tile icon={Inbox} label="To pack" value={totals.to_pack} hint="Submitted, not packed yet" />
                <Tile icon={Clock} label="Packed, payment not requested" value={totals.packed_no_payment} />
                <Tile icon={CreditCard} label="Waiting for payment" value={totals.awaiting_payment} />
                <Tile icon={Truck} label="Paid, ready to ship" value={totals.ready_to_ship} />
              </div>
            </section>

            {/* Over time */}
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <h2 className="font-display font-semibold text-lg">Parcels packed per month</h2>
                  <p className="text-xs text-muted-foreground">Last 12 months{gomFilter ? '' : ', stacked by GOM'}</p>
                </div>
                <button onClick={() => setChartAsTable(v => !v)} className="text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1">
                  {chartAsTable ? <><BarChart3 size={13} /> Show chart</> : <><Table2 size={13} /> Show as table</>}
                </button>
              </div>
              <Card>
                <CardContent className="space-y-3">
                  {/* Legend */}
                  {shown.length > 1 && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {shown.map(g => (
                        <span key={g.gom_id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Swatch cls={colorOf.get(g.gom_id)?.bg} /> {g.gom_name}
                        </span>
                      ))}
                    </div>
                  )}
                  {chartAsTable ? (
                    <div className="overflow-x-auto">
                      <Table>
                        <thead><tr><Th>Month</Th>{shown.map(g => <Th key={g.gom_id} className="text-right">{g.gom_name}</Th>)}{shown.length > 1 && <Th className="text-right">Total</Th>}</tr></thead>
                        <tbody>
                          {[...monthly].reverse().map(m => (
                            <Tr key={m.month}>
                              <Td>{monthLabel(m.month, true)}</Td>
                              {shown.map(g => <Td key={g.gom_id} className="text-right tabular-nums">{m.counts[g.gom_id] || 0}</Td>)}
                              {shown.length > 1 && <Td className="text-right tabular-nums font-semibold">{monthTotal(m)}</Td>}
                            </Tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  ) : chartEmpty ? (
                    <p className="text-sm text-muted-foreground text-center py-12">No parcels packed in the last 12 months.</p>
                  ) : (
                    <div className="flex gap-2">
                      {/* Y axis */}
                      <div className="relative h-56 w-7 flex-shrink-0 text-[10px] text-muted-foreground tabular-nums">
                        {ticks.map(t => (
                          <span key={t} className="absolute right-0" style={{ bottom: `${(t / yMax) * 100}%`, transform: 'translateY(50%)' }}>{t}</span>
                        ))}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="relative h-56">
                          {/* Grid */}
                          {ticks.map(t => (
                            <div key={t} className={`absolute inset-x-0 border-t ${t === 0 ? 'border-border' : 'border-border/40'}`} style={{ bottom: `${(t / yMax) * 100}%` }} />
                          ))}
                          {/* Bars */}
                          <div className="absolute inset-0 flex items-end gap-1 sm:gap-2">
                            {monthly.map((m, mi) => {
                              const total = monthTotal(m)
                              // Tooltip sits inside the plot (the card clips anything outside it),
                              // aligned to the left/right edge for the outer months.
                              const tipPos = mi < 3 ? 'left-0' : mi > monthly.length - 4 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                              const segs = shown.filter(g => (m.counts[g.gom_id] || 0) > 0)
                              return (
                                <div key={m.month} className="relative flex-1 h-full flex items-end justify-center cursor-default"
                                  onMouseEnter={() => setHoverMonth(m.month)} onMouseLeave={() => setHoverMonth(null)}>
                                  <div className={`w-full max-w-[36px] flex flex-col-reverse gap-[2px] transition-opacity ${hoverMonth && hoverMonth !== m.month ? 'opacity-50' : ''}`}
                                    style={{ height: `${(total / yMax) * 100}%` }}>
                                    {segs.map((g, i) => (
                                      <div key={g.gom_id} className={`${colorOf.get(g.gom_id)?.bg} ${i === segs.length - 1 ? 'rounded-t-[4px]' : ''}`}
                                        style={{ flexGrow: m.counts[g.gom_id], flexBasis: 0, minHeight: 2 }} />
                                    ))}
                                  </div>
                                  {hoverMonth === m.month && (
                                    <div className={`absolute top-0 ${tipPos} z-10 min-w-[150px] rounded-xl border border-border bg-card shadow-lg px-3 py-2 text-xs pointer-events-none`}>
                                      <p className="font-semibold mb-1">{monthLabel(m.month, true)}</p>
                                      {shown.map(g => (
                                        <p key={g.gom_id} className="flex items-center justify-between gap-3">
                                          <span className="flex items-center gap-1.5 text-muted-foreground"><Swatch cls={colorOf.get(g.gom_id)?.bg} size={8} />{g.gom_name}</span>
                                          <span className="tabular-nums font-medium">{m.counts[g.gom_id] || 0}</span>
                                        </p>
                                      ))}
                                      {shown.length > 1 && <p className="flex justify-between gap-3 border-t border-border mt-1 pt-1 font-semibold"><span>Total</span><span className="tabular-nums">{total}</span></p>}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                        {/* X axis */}
                        <div className="flex gap-1 sm:gap-2 mt-1.5">
                          {monthly.map((m, i) => (
                            <span key={m.month} className="flex-1 text-center text-[10px] text-muted-foreground truncate">
                              {monthLabel(m.month, false)}
                              {(i === 0 || m.month.endsWith('-01')) && <span className="hidden sm:inline"> ’{m.month.slice(2, 4)}</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            {/* Per-GOM comparison */}
            <section className="space-y-2">
              <h2 className="font-display font-semibold text-lg">Per GOM</h2>
              <Card>
                <div className="overflow-x-auto text-foreground">
                  <Table>
                    <thead>
                      <tr>
                        <Th className="px-3">GOM</Th><Th className="text-right px-3">Forms</Th><Th className="text-right px-3">Packed</Th><Th className="text-right px-3">Shipped</Th>
                        <Th className="text-right px-3">Received</Th><Th className="text-right px-3">Joiners</Th><Th className="text-right px-3">Claims</Th>
                        <Th className="text-right px-3">PCs</Th><Th className="text-right px-3">Winners</Th><Th className="text-right px-3">To pack</Th>
                        <Th className="text-right px-3">Payment pending</Th><Th className="text-right px-3">Ready to ship</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {goms.map(g => (
                        <Tr key={g.gom_id} onClick={() => setGomFilter(f => f === g.gom_id ? '' : g.gom_id)}
                          className={`cursor-pointer ${gomFilter === g.gom_id ? 'bg-primary/[0.05]' : ''}`}>
                          <Td className="font-semibold whitespace-nowrap px-3"><span className="flex items-center gap-2"><Swatch cls={colorOf.get(g.gom_id)?.bg} />{g.gom_name}</span></Td>
                          <Td className="text-right tabular-nums px-3">{g.forms}</Td>
                          <Td className="text-right tabular-nums px-3">{g.packed}<span className="text-muted-foreground">/{g.parcels}</span></Td>
                          <Td className="text-right tabular-nums px-3">{g.shipped}</Td>
                          <Td className="text-right tabular-nums px-3">{g.received}</Td>
                          <Td className="text-right tabular-nums px-3">{g.joiners}</Td>
                          <Td className="text-right tabular-nums px-3">{g.claims}</Td>
                          <Td className="text-right tabular-nums px-3">{g.sorted_pcs}</Td>
                          <Td className="text-right tabular-nums px-3">{g.winner_items}</Td>
                          <Td className="text-right tabular-nums px-3">{g.backlog.to_pack}</Td>
                          <Td className="text-right tabular-nums px-3">{g.backlog.packed_no_payment + g.backlog.awaiting_payment}</Td>
                          <Td className="text-right tabular-nums px-3">{g.backlog.ready_to_ship}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </Card>
              <p className="text-xs text-muted-foreground">Click a row to focus on that GOM. Claims, PCs and winners = items confirmed in the Pack wizard. “Payment pending” = packed, payment not requested yet or not paid yet.</p>
            </section>
          </>}
      </div>
    </div>
  )
}
