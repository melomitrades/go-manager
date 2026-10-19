'use client'
import { useEffect, useMemo, useState } from 'react'
import { ShoppingBag, Users } from 'lucide-react'
import { formatEur, formatDate } from '@/lib/utils'
import { PaymentTypeChip } from './MarkLostModal'

// One combined list of every leftover — lost order claims, open member slots and released sorted
// cards — viewable grouped by order or by member. Shared by the GOM and joiner Leftovers pages;
// each page passes its own action button per entry (Reassign/Give vs Request).

export type LeftoverKind = 'claim' | 'slot' | 'pc'
export interface LeftoverEntry {
  kind: LeftoverKind
  key: string
  groupId: string        // order id, or `session:<id>` for sorted cards
  groupLabel: string
  memberName: string
  title: string
  detail: string
  status: string         // leftover | reassigned | restored (slots are always "open")
  raw: any
  // slot only
  order?: any
  section?: any
  member?: any
}

export function buildEntries(claims: any[], pcs: any[], slots: any[]): LeftoverEntry[] {
  const out: LeftoverEntry[] = []
  for (const c of claims) out.push({
    kind: 'claim', key: `c:${c.id}`, groupId: c.order_id, groupLabel: c.order_label || 'Order',
    memberName: c.member_name || 'No member',
    title: `${c.description || 'Item'}${c.version_name ? ' · ' + c.version_name : ''}${c.amount_claimed > 1 ? ` ×${c.amount_claimed}` : ''}`,
    detail: c.price_eur != null ? formatEur(parseFloat(c.price_eur)) : 'no price',
    status: c.status || 'leftover', raw: c,
  })
  for (const o of slots) for (const sec of o.sections || []) for (const m of sec.members || []) out.push({
    kind: 'slot', key: `s:${o.id}:${m.id}:${sec.versionLabel || ''}`, groupId: o.id, groupLabel: o.label || 'Order',
    memberName: m.name, title: `Open slot${sec.versionLabel ? ' · ' + sec.versionLabel : ''}${m.leftover > 1 ? ` ×${m.leftover}` : ''}`,
    detail: sec.type === 'album' ? 'unclaimed album slot' : 'unclaimed member', status: 'open', raw: m, order: o, section: sec, member: m,
  })
  for (const p of pcs) out.push({
    kind: 'pc', key: `p:${p.id}`, groupId: `session:${p.session_id}`, groupLabel: `🎴 ${p.session_title || 'Sorting'}`,
    memberName: p.member_name || '?', title: `${p.item_name || 'Card'}${p.was_guaranteed ? ' (was guaranteed)' : ''}`,
    detail: `${p.pack_name || ''}${p.stock_available != null ? ` · ${p.stock_available} in stock` : ''}`,
    status: p.status || 'leftover', raw: p,
  })
  return out
}

const KIND_STYLE: Record<LeftoverKind, { label: string; cls: string }> = {
  claim: { label: 'Lost claim', cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800' },
  slot: { label: 'Open slot', cls: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-300 dark:border-sky-800' },
  pc: { label: 'Sorted card', cls: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-800' },
}

const VIEW_KEY = 'leftovers-view'

export function LeftoverBoard({ entries, isGom, renderAction }: {
  entries: LeftoverEntry[]
  isGom: boolean
  renderAction: (e: LeftoverEntry) => React.ReactNode
}) {
  const [view, setView] = useState<'order' | 'member'>('order')
  const [kinds, setKinds] = useState<Set<LeftoverKind>>(new Set(['claim', 'slot', 'pc']))
  useEffect(() => { try { const v = localStorage.getItem(VIEW_KEY); if (v === 'member' || v === 'order') setView(v) } catch {} }, [])
  function changeView(v: 'order' | 'member') { setView(v); try { localStorage.setItem(VIEW_KEY, v) } catch {} }

  const groups = useMemo(() => {
    const visible = entries.filter(e => kinds.has(e.kind))
    const map = new Map<string, { id: string; label: string; items: LeftoverEntry[] }>()
    for (const e of visible) {
      const id = view === 'order' ? e.groupId : e.memberName.trim().toLowerCase()
      const label = view === 'order' ? e.groupLabel : e.memberName
      if (!map.has(id)) map.set(id, { id, label, items: [] })
      map.get(id)!.items.push(e)
    }
    const order: Record<LeftoverKind, number> = { claim: 0, slot: 1, pc: 2 }
    const list = [...map.values()]
    for (const g of list) g.items.sort((a, b) => view === 'order'
      ? (order[a.kind] - order[b.kind]) || a.memberName.localeCompare(b.memberName)
      : a.groupLabel.localeCompare(b.groupLabel) || (order[a.kind] - order[b.kind]))
    if (view === 'member') list.sort((a, b) => a.label.localeCompare(b.label))
    return list
  }, [entries, view, kinds])

  const counts = useMemo(() => {
    const c: Record<LeftoverKind, number> = { claim: 0, slot: 0, pc: 0 }
    for (const e of entries) c[e.kind]++
    return c
  }, [entries])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-secondary/50 rounded-xl p-1">
          {([['order', 'By order', ShoppingBag], ['member', 'By member', Users]] as const).map(([v, label, Icon]) => (
            <button key={v} onClick={() => changeView(v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${view === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(KIND_STYLE) as LeftoverKind[]).map(k => (
            <button key={k} onClick={() => setKinds(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n.size ? n : prev })}
              className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-opacity ${KIND_STYLE[k].cls} ${kinds.has(k) ? '' : 'opacity-40'}`}>
              {KIND_STYLE[k].label} · {counts[k]}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-10">Nothing to show.</p>
      ) : groups.map(g => (
        <section key={g.id} className="border border-border rounded-2xl overflow-hidden bg-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/30">
            <p className="text-sm font-bold">{g.label}</p>
            <span className="text-xs text-muted-foreground">{g.items.length} leftover{g.items.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="divide-y divide-border/50">
            {g.items.map(e => (
              <div key={e.key} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${e.status === 'reassigned' || e.status === 'restored' ? 'opacity-60' : ''}`}>
                <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border flex-shrink-0 ${KIND_STYLE[e.kind].cls}`}>{KIND_STYLE[e.kind].label}</span>
                <div className="flex-1 min-w-[200px]">
                  <p className="text-sm font-semibold">
                    {view === 'order' ? <>{e.memberName} <span className="font-normal text-muted-foreground">· {e.title}</span></> : <>{e.title}</>}
                  </p>
                  <p className="text-xs text-muted-foreground">{view === 'member' ? `${e.groupLabel} · ` : ''}{e.detail}</p>
                  {isGom && e.kind !== 'slot' && (
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <PaymentTypeChip type={e.raw.trigger_type} />
                      Lost by <strong className="font-semibold text-foreground">{e.raw.original_joiner_name || '?'}</strong> · unpaid {e.raw.trigger_label} · {formatDate(e.raw.lost_at)}
                      {e.raw.order_was_paid && <span className="text-emerald-600">· order was paid</span>}
                      {e.raw.reason && <span className="italic">· “{e.raw.reason}”</span>}
                    </p>
                  )}
                  {isGom && e.status === 'reassigned' && <p className="text-xs text-sky-700 mt-0.5">→ {e.raw.reassigned_to_name} · {formatDate(e.raw.reassigned_at)}</p>}
                </div>
                {renderAction(e)}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
