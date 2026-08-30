'use client'
import { useEffect, useState } from 'react'
import { X, Check, Clock, ShoppingBag, Users } from 'lucide-react'
import { StatusBadge, Badge } from '@/components/ui'
import { formatEur, formatKrw, formatDate } from '@/lib/utils'

interface OrderDetailProps {
  orderId: string | null
  onClose: () => void
  viewAs: 'gom' | 'joiner'
}

// Group items with the same description+price into one consolidated line
function groupItems(items: any[]): { label: string; qty: number; price_eur: number | null; price_krw: number | null; members: string[]; inclusions_count: number; entries_count: number }[] {
  const groups: Record<string, { label: string; qty: number; price_eur: number | null; price_krw: number | null; members: string[]; inclusions_count: number; entries_count: number }> = {}
  const seenClaimsByGroup: Record<string, Set<string>> = {}
  for (const item of items) {
    const label = item.description || item.member?.name || 'Item'
    const price = item.price_eur ? parseFloat(item.price_eur) : null
    const priceKrw = item.price_krw ? parseFloat(item.price_krw) : null
    const key = `${label}__${price ?? 'null'}`
    if (!groups[key]) {
      groups[key] = { label, qty: 0, price_eur: price, price_krw: priceKrw, members: [], inclusions_count: 0, entries_count: 0 }
      seenClaimsByGroup[key] = new Set()
    }
    groups[key].qty += item.amount_claimed || 1
    // inclusions_count is a per-claim-LINE total, not per-row — when one claim is split across
    // several members it's saved onto every resulting row identically (by design; see
    // gom/orders/page.tsx's handleSave). Two genuinely separate claims can still land in this
    // same label+price group (e.g. the same pricing option claimed twice), so it's not safe to
    // just take the first row's value — each distinct claim (by claim_group_id, where the row
    // has one) contributes its own inclusions_count once. Rows saved before claim_group_id
    // existed have no id to dedupe by, so — same limitation as before — only the first such
    // legacy row in the group counts; resaving the order assigns them proper ids.
    if ((item.inclusions_count || 0) > 0) {
      const claimKey = item.claim_group_id ? `cg:${item.claim_group_id}` : '__legacy__'
      if (!seenClaimsByGroup[key].has(claimKey)) {
        seenClaimsByGroup[key].add(claimKey)
        groups[key].inclusions_count += item.inclusions_count || 0
      }
    }
    groups[key].entries_count += item.entries_count || 0
    if (item.member?.name) {
      const existing = groups[key].members.find((m: string) => m === item.member.name || m.startsWith(item.member.name + ' ×'))
      if (!existing) {
        groups[key].members.push(item.member.name)
      } else {
        const idx = groups[key].members.indexOf(existing)
        const count = existing.includes(' ×') ? parseInt(existing.split(' ×')[1]) + 1 : 2
        groups[key].members[idx] = `${item.member.name} ×${count}`
      }
    }
  }
  return Object.values(groups)
}

function SortResultsList({ results }: { results: any[] }) {
  if (!results || results.length === 0) return null
  return (
    <div className="px-4 py-2.5 bg-primary/5 border-t border-primary/10">
      <p className="text-xs font-bold text-primary uppercase tracking-widest mb-1.5">🎴 Sorting results</p>
      <div className="space-y-0.5">
        {results.map((r: any) => (
          <p key={r.id} className="text-xs">
            <span className="text-muted-foreground">{r.pack_name} · {r.item_name}:</span>{' '}
            <span className="font-semibold">{r.member_name}</span>
            {r.is_guaranteed && <span className="text-emerald-600 ml-1">(guaranteed — matched their claimed version)</span>}
            {r.is_repeat && <span className="text-amber-600 ml-1">(2nd)</span>}
            {r.is_random && <span className="text-sky-600 ml-1">(random — no form submitted)</span>}
          </p>
        ))}
      </div>
    </div>
  )
}

export function OrderDetail({ orderId, onClose, viewAs }: OrderDetailProps) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [sortResults, setSortResults] = useState<any[]>([])

  useEffect(() => {
    if (!orderId) { setData(null); setSortResults([]); return }
    setLoading(true)
    fetch(`/api/orders/${orderId}?viewAs=${viewAs}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
    fetch(`/api/pc-sorter/results?order_id=${orderId}`)
      .then(r => r.json())
      .then(d => setSortResults(Array.isArray(d) ? d : []))
      .catch(() => setSortResults([]))
  }, [orderId])

  async function togglePaid(joinerId: string, current: boolean) {
    await fetch(`/api/orders/${orderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ joiner_id: joinerId, paid: !current }),
    })
    setData((prev: any) => ({
      ...prev,
      joiners: prev.joiners.map((j: any) =>
        j.joiner_id === joinerId ? { ...j, paid: !current } : j
      ),
    }))
  }

  if (!orderId) return null

  // GOM view: all joiners with their items + paid toggle
  // Joiner view: only the joiner's own section, read-only paid status
  // The API already filters items by role on the server side

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" onClick={onClose} />

      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-card border-l border-border z-50 flex flex-col shadow-2xl animate-fade-in">

        {/* Fixed close button — stays top-right regardless of scroll */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-xl flex items-center justify-center bg-card/80 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all shadow-sm border border-border"
        >
          <X size={16} />
        </button>

        {/* Body — fully scrollable, includes header */}
        <div className="flex-1 overflow-y-auto">

          {/* Preview image banner — 2800×1350 ratio, shown at top when present */}
          {data?.order && (data.order as any).preview_image_url && (
            <div
              className="w-full overflow-hidden cursor-zoom-in"
              style={{ aspectRatio: '2800 / 1350' }}
              onClick={() => window.open((data.order as any).preview_image_url, '_blank')}
            >
              <img
                src={(data.order as any).preview_image_url}
                alt="Order preview"
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Header */}
          <div className="flex items-start justify-between px-6 py-5 border-b border-border bg-gradient-to-r from-primary/5 to-transparent">
            <div className="min-w-0 flex-1 pr-10">
              {data?.order ? (
                <>
                  <h2 className="font-display font-semibold text-xl leading-tight">
                    {data.order.shop?.name || 'Order'}
                    {data.order.round_number && (
                      <span className="text-muted-foreground font-normal text-base ml-2">· {data.order.round_number}</span>
                    )}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <StatusBadge status={data.order.status} />
                    {data.order.group?.name && (
                      <Badge className="bg-secondary text-secondary-foreground border border-border text-xs">{data.order.group.name}</Badge>
                    )}
                    {data.order.is_fancall && (
                      <Badge className="bg-rose-50 text-rose-600 border border-rose-200 dark:bg-rose-900/20 dark:text-rose-300 text-xs">Fancall ✦</Badge>
                    )}
                    {(data.order as any).raffle_winner_name && (
                      <Badge className="bg-amber-50 text-amber-700 border border-amber-300 dark:bg-amber-900/20 dark:text-amber-300 text-xs">🏆 {(data.order as any).raffle_winner_name}</Badge>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <div className="h-6 w-40 shimmer rounded-lg" />
                  <div className="h-4 w-24 shimmer rounded-lg" />
                </div>
              )}
            </div>
          </div>
          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-20 shimmer rounded-2xl" />)}
            </div>
          ) : !data ? (
            <div className="flex items-center justify-center py-20">
              <ShoppingBag size={32} className="text-muted-foreground/30" />
            </div>
          ) : viewAs === 'gom' ? (
            // ── GOM VIEW: all joiners, paid toggle ────────────────
            <div className="p-5 space-y-4">

              {/* Summary */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="bg-secondary/40 rounded-xl p-3 text-center">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Joiners</p>
                  <p className="font-display font-bold text-lg">{data.joiners.length}</p>
                </div>
                <div className="bg-secondary/40 rounded-xl p-3 text-center">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Items</p>
                  <p className="font-display font-bold text-lg">{data.totalItems}</p>
                </div>
                <div className="bg-primary/5 border border-primary/10 rounded-xl p-3 text-center">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Total</p>
                  <p className="font-display font-bold text-lg text-primary">{formatEur(data.totalPrice)}{data.totalKrw > 0 && <span className="text-sm font-normal text-muted-foreground ml-1.5">({formatKrw(data.totalKrw)})</span>}</p>
                </div>
              </div>

              {/* Leftover calculator */}
              {(data.order as any)?.payment_info && (
                <div className="border border-primary/25 bg-primary/5 rounded-2xl px-4 py-3.5">
                  <p className="text-xs font-bold text-primary uppercase tracking-widest mb-1.5">💳 Payment Info</p>
                  <p className="text-sm whitespace-pre-wrap">{(data.order as any).payment_info}</p>
                </div>
              )}

              {/* Albums bought breakdown */}
              {(() => {
                const rawAlbumsBought = (data.order as any)?.albums_bought
                if (rawAlbumsBought == null) return null
                const groupMembers: { id: string; name: string }[] = data.order?.group?.members || []
                const setSize = groupMembers.length
                if (setSize < 2) return null

                // Count total claims per member across all joiners
                const countMemberClaims = (filterFn?: (item: any) => boolean) => {
                  const counts: Record<string, { name: string; count: number }> = {}
                  for (const m of groupMembers) counts[m.id] = { name: m.name, count: 0 }
                  for (const jg of data.joiners) {
                    for (const item of jg.items) {
                      if (item.member_id && counts[item.member_id] !== undefined) {
                        if (!filterFn || filterFn(item)) counts[item.member_id].count++
                      }
                    }
                  }
                  return groupMembers.map(m => ({ ...counts[m.id], id: m.id }))
                }

                const AlbumPanel = ({ label, albumsBought, memberList, color }: {
                  label: string | null; albumsBought: number; memberList: { id: string; name: string; count: number }[]; color: string
                }) => {
                  const totalClaims = memberList.reduce((s, m) => s + m.count, 0)
                  if (totalClaims === 0 && albumsBought === 0) return null
                  const completeSets = totalClaims > 0 ? Math.min(...memberList.map(m => m.count)) : 0
                  const affordableSets = Math.floor(albumsBought / setSize)
                  const randomAlbumSlots = albumsBought % setSize
                  const canCoverSets = affordableSets >= completeSets
                  const allGuaranteed = albumsBought >= totalClaims
                  const effectiveSets = canCoverSets ? affordableSets : affordableSets
                  const membersWithExcess = memberList
                    .map(m => ({ ...m, excess: Math.max(0, m.count - effectiveSets) }))
                    .filter(m => m.excess > 0)
                    .sort((a, b) => a.count - b.count)
                  const panelColor = allGuaranteed
                    ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-900/10 dark:border-emerald-800'
                    : canCoverSets
                    ? 'border-sky-200 bg-sky-50 dark:bg-sky-900/10 dark:border-sky-800'
                    : 'border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800'
                  const headerColor = allGuaranteed ? 'text-emerald-700 dark:text-emerald-300' : canCoverSets ? 'text-sky-700 dark:text-sky-300' : 'text-amber-700 dark:text-amber-300'
                  return (
                    <div className={`border rounded-xl px-4 py-3 space-y-3 ${panelColor}`}>
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <p className={`text-xs font-bold uppercase tracking-widest ${headerColor}`}>
                          📀 {label ? `${label} — ` : ''}Albums Bought: {albumsBought}
                        </p>
                        <span className="text-xs font-semibold text-muted-foreground bg-background/60 px-2 py-0.5 rounded-full border border-border">
                          {totalClaims} claims · {completeSets} full set{completeSets !== 1 ? 's' : ''} of {setSize}
                        </span>
                      </div>
                      <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between items-center">
                          <span className="text-emerald-700 dark:text-emerald-400 font-semibold">✓ Guaranteed sets</span>
                          <span className="font-bold text-emerald-700 dark:text-emerald-400">
                            {effectiveSets} × {setSize} = {effectiveSets * setSize} claims
                          </span>
                        </div>
                        {randomAlbumSlots > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-amber-700 dark:text-amber-400 font-semibold">🎲 Random slots</span>
                            <span className="font-bold text-amber-700 dark:text-amber-400">{randomAlbumSlots} album{randomAlbumSlots !== 1 ? 's' : ''} randomly</span>
                          </div>
                        )}
                        {!canCoverSets && totalClaims > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-red-600 dark:text-red-400 font-semibold">⚠ Not covered</span>
                            <span className="font-bold text-red-600 dark:text-red-400">{completeSets * setSize - albumsBought} claims without album</span>
                          </div>
                        )}
                        {allGuaranteed && randomAlbumSlots === 0 && totalClaims > 0 && (
                          <p className="text-xs text-emerald-600 font-semibold">Perfect fit 🎉</p>
                        )}
                      </div>
                      {totalClaims > 0 && (
                        <div className="border-t border-current/10 pt-2.5 space-y-1.5">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Per member</p>
                          {memberList.map(m => {
                            const guaranteed = Math.min(m.count, effectiveSets)
                            const leftoverSlots = Math.max(0, effectiveSets - m.count) // album slots with no claim
                            const remaining = m.count - guaranteed
                            const random = remaining > 0 ? Math.min(remaining, randomAlbumSlots) : 0
                            const unresolved = remaining - random
                            return (
                              <div key={m.id} className="flex items-center justify-between text-xs gap-2">
                                <span className="font-semibold text-foreground min-w-[70px]">{m.name}</span>
                                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                  <span className="text-muted-foreground">{m.count} claim{m.count !== 1 ? 's' : ''}</span>
                                  {guaranteed > 0 && <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 font-semibold dark:bg-emerald-900/30 dark:text-emerald-300">✓ {guaranteed}</span>}
                                  {leftoverSlots > 0 && <span className="px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 border border-sky-200 font-semibold dark:bg-sky-900/30 dark:text-sky-300">+{leftoverSlots} leftover</span>}
                                  {random > 0 && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 font-semibold dark:bg-amber-900/30 dark:text-amber-300">🎲 {random}</span>}
                                  {unresolved > 0 && <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 font-semibold dark:bg-red-900/30 dark:text-red-300">✗ {unresolved}</span>}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                      {randomAlbumSlots > 0 && membersWithExcess.length > 0 && (
                        <div className="border-t border-current/10 pt-2.5">
                          <p className="text-xs text-muted-foreground mb-1.5">Random candidates ({randomAlbumSlots} slot{randomAlbumSlots !== 1 ? 's' : ''}):</p>
                          <div className="flex flex-wrap gap-1.5">
                            {membersWithExcess.map(m => (
                              <span key={m.id} className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-300">
                                {m.name}{m.excess > 1 ? ` ×${m.excess}` : ''}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                }

                const isMultiVersion = !!(data.order as any).is_multi_version
                const isVceFansign = !!(data.order as any).is_vce_fansign
                const isPerVersion = typeof rawAlbumsBought === 'object' && rawAlbumsBought !== null

                if (isMultiVersion && isPerVersion) {
                  const versionNames: string[] = (() => { try { const vn = (data.order as any).version_names; return Array.isArray(vn) ? vn : JSON.parse(vn || '[]') } catch { return [] } })()
                  if (versionNames.length === 0) return null
                  return (
                    <div className="space-y-3">
                      {versionNames.map(vn => {
                        const bought = (rawAlbumsBought as any)[vn]
                        if (bought == null) return null
                        const memberList = countMemberClaims((item: any) => {
                          if (item.version_name) return item.version_name === vn
                          return (item.description || '').toLowerCase().includes(vn.toLowerCase())
                        })
                        return <AlbumPanel key={vn} label={vn} albumsBought={parseInt(bought)} memberList={memberList} color="sky" />
                      })}
                    </div>
                  )
                }

                if (isVceFansign && isPerVersion) {
                  const vceBought = (rawAlbumsBought as any)['vce']
                  const fansignBought = (rawAlbumsBought as any)['fansign']
                  return (
                    <div className="space-y-3">
                      {vceBought != null && <AlbumPanel label="VCE" albumsBought={parseInt(vceBought)} memberList={countMemberClaims((item: any) => /vce/i.test(item.description || ''))} color="sky" />}
                      {fansignBought != null && <AlbumPanel label="Fansign" albumsBought={parseInt(fansignBought)} memberList={countMemberClaims((item: any) => /fansign/i.test(item.description || ''))} color="purple" />}
                    </div>
                  )
                }

                // Standard single value
                const albumsBought = typeof rawAlbumsBought === 'number' ? rawAlbumsBought : parseInt(rawAlbumsBought)
                if (isNaN(albumsBought)) return null
                return <AlbumPanel label={null} albumsBought={albumsBought} memberList={countMemberClaims()} color="sky" />
              })()}
              {/* Leftover calculator — hidden when albums bought is set (album panel takes over) */}
              {viewAs === 'gom' && data.joiners.length > 0 && !(data.order as any).hide_leftovers && !(data.order as any).albums_bought && (() => {
                const groupMembers: { id: string; name: string }[] = data.order?.group?.members || []
                if (groupMembers.length < 2) return null
                const isVceFansign = !!(data.order as any).is_vce_fansign

                // ── Multi-version leftover calculator ─────────────────────
                const isMultiVersion = !!(data.order as any).is_multi_version
                const versionNames: string[] = (() => {
                  try {
                    const vn = (data.order as any).version_names
                    return Array.isArray(vn) ? vn : JSON.parse(vn || '[]')
                  } catch { return [] }
                })()

                if (isMultiVersion && versionNames.length > 0) {
                  // For each member, for each version: count total claims (rows), not distinct joiners
                  const verClaimed: Record<string, Record<string, number>> = {} // versionName -> memberId -> count
                  for (const vn of versionNames) { verClaimed[vn] = {} }
                  for (const m of groupMembers) {
                    for (const vn of versionNames) { verClaimed[vn][m.id] = 0 }
                  }
                  // Pre-group items per joiner per member to detect version by position
                  for (const jg of data.joiners) {
                    const byMember: Record<string, any[]> = {}
                    for (const item of jg.items) {
                      if (!item.member_id) continue
                      if (!byMember[item.member_id]) byMember[item.member_id] = []
                      byMember[item.member_id].push(item)
                    }
                    for (const [memberId, memberItems] of Object.entries(byMember)) {
                      memberItems.forEach((item, itemIdx) => {
                        let vn = item.version_name || null
                        if (!vn) {
                          for (const v of versionNames) {
                            if ((item.description || '').toLowerCase().includes(v.toLowerCase())) { vn = v; break }
                          }
                        }
                        if (!vn) {
                          vn = versionNames[itemIdx % versionNames.length] || null
                        }
                        if (vn && verClaimed[vn]?.[memberId] !== undefined) {
                          verClaimed[vn][memberId]++
                        }
                      })
                    }
                  }
                  const verMax: Record<string, number> = {}
                  for (const vn of versionNames) {
                    verMax[vn] = Math.max(...groupMembers.map(m => verClaimed[vn][m.id] ?? 0), 0)
                  }
                  const totalLeftPerVer: Record<string, number> = {}
                  for (const vn of versionNames) {
                    totalLeftPerVer[vn] = groupMembers.reduce((s, m) => s + Math.max(0, verMax[vn] - (verClaimed[vn][m.id] ?? 0)), 0)
                  }
                  const hasAny = Object.values(verMax).some(v => v > 0)
                  if (!hasAny) return null

                  const membersWithLeftovers = groupMembers.filter(m =>
                    versionNames.some(vn => (verClaimed[vn][m.id] ?? 0) < verMax[vn])
                  )
                  if (membersWithLeftovers.length === 0) return null

                  const VERSION_COLORS = ['sky', 'purple', 'amber', 'emerald', 'rose', 'indigo']
                  const colorClass = (i: number) => {
                    const colors = ['text-sky-700 bg-sky-100 border-sky-200', 'text-purple-700 bg-purple-100 border-purple-200', 'text-amber-700 bg-amber-100 border-amber-200', 'text-emerald-700 bg-emerald-100 border-emerald-200', 'text-rose-700 bg-rose-100 border-rose-200', 'text-indigo-700 bg-indigo-100 border-indigo-200']
                    return colors[i % colors.length]
                  }

                  return (
                    <div className="border border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800 rounded-xl px-4 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">⚠ Leftover Members</p>
                        <div className="flex gap-1.5 flex-wrap justify-end">
                          {versionNames.map((vn, vi) => totalLeftPerVer[vn] > 0 && (
                            <span key={vn} className={`text-xs font-bold px-2 py-0.5 rounded-full border ${colorClass(vi)}`}>
                              {vn}: {totalLeftPerVer[vn]}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-2">
                        {membersWithLeftovers.map(m => (
                          <div key={m.id} className="flex items-start justify-between text-sm gap-3">
                            <span className="font-semibold text-amber-800 dark:text-amber-200 mt-0.5">{m.name}</span>
                            <div className="text-xs text-right space-y-0.5">
                              {versionNames.map((vn, vi) => {
                                const claimed = verClaimed[vn][m.id] ?? 0
                                const left = Math.max(0, verMax[vn] - claimed)
                                return verMax[vn] > 0 ? (
                                  <div key={vn} className={left > 0 ? colorClass(vi).split(' ')[0] : 'text-emerald-600'}>
                                    {vn}: {claimed}/{verMax[vn]}
                                    {left > 0 && <strong className="ml-1">→ {left} left</strong>}
                                    {left === 0 && <span className="ml-1">✓</span>}
                                  </div>
                                ) : null
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                }

                if (isVceFansign) {
                  // ── VCE/Fansign split leftover calculator ──────────────────
                  // For each member, count separately how many joiners claimed a vce-label item
                  // vs a fansign-label item for that member
                  const vceBy: Record<string, number> = {}
                  const fansignBy: Record<string, number> = {}
                  for (const m of groupMembers) { vceBy[m.id] = 0; fansignBy[m.id] = 0 }

                  for (const jg of data.joiners) {
                    for (const item of jg.items) {
                      if (!item.member_id) continue
                      const label = (item.description || '').toLowerCase()
                      if (/vce/.test(label) && vceBy[item.member_id] !== undefined) vceBy[item.member_id]++
                      if (/fansign/.test(label) && fansignBy[item.member_id] !== undefined) fansignBy[item.member_id]++
                    }
                  }

                  const vceMax = Math.max(...groupMembers.map(m => vceBy[m.id] ?? 0), 0)
                  const fansignMax = Math.max(...groupMembers.map(m => fansignBy[m.id] ?? 0), 0)
                  if (vceMax === 0 && fansignMax === 0) return null

                  const vceTotalLeft = groupMembers.reduce((s, m) => s + Math.max(0, vceMax - (vceBy[m.id] ?? 0)), 0)
                  const fansignTotalLeft = groupMembers.reduce((s, m) => s + Math.max(0, fansignMax - (fansignBy[m.id] ?? 0)), 0)

                  const membersWithLeftovers = groupMembers.filter(m =>
                    (vceBy[m.id] ?? 0) < vceMax || (fansignBy[m.id] ?? 0) < fansignMax
                  )
                  if (membersWithLeftovers.length === 0) return null

                  return (
                    <div className="border border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800 rounded-xl px-4 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">⚠ Leftover Members</p>
                        <div className="flex gap-2">
                          {vceMax > 0 && <span className="text-xs font-bold text-sky-700 bg-sky-100 dark:bg-sky-900/40 px-2 py-0.5 rounded-full border border-sky-200">VCE: {vceTotalLeft}</span>}
                          {fansignMax > 0 && <span className="text-xs font-bold text-purple-700 bg-purple-100 dark:bg-purple-900/40 px-2 py-0.5 rounded-full border border-purple-200">Fansign: {fansignTotalLeft}</span>}
                        </div>
                      </div>
                      <div className="space-y-2">
                        {membersWithLeftovers.sort((a, b) => (vceBy[a.id] ?? 0) - (vceBy[b.id] ?? 0)).map(m => {
                          const vceClaimed = vceBy[m.id] ?? 0
                          const fansignClaimed = fansignBy[m.id] ?? 0
                          const vceLeft = Math.max(0, vceMax - vceClaimed)
                          const fansignLeft = Math.max(0, fansignMax - fansignClaimed)
                          return (
                            <div key={m.id} className="flex items-start justify-between text-sm gap-3">
                              <span className="font-semibold text-amber-800 dark:text-amber-200 mt-0.5">{m.name}</span>
                              <div className="text-xs text-right space-y-0.5">
                                {vceMax > 0 && (
                                  <div className={vceLeft > 0 ? 'text-sky-700 dark:text-sky-300' : 'text-emerald-600 dark:text-emerald-400'}>
                                    VCE {vceClaimed}/{vceMax}
                                    {vceLeft > 0 && <strong className="ml-1">→ {vceLeft} left</strong>}
                                    {vceLeft === 0 && <span className="ml-1">✓</span>}
                                  </div>
                                )}
                                {fansignMax > 0 && (
                                  <div className={fansignLeft > 0 ? 'text-purple-700 dark:text-purple-300' : 'text-emerald-600 dark:text-emerald-400'}>
                                    Fansign {fansignClaimed}/{fansignMax}
                                    {fansignLeft > 0 && <strong className="ml-1">→ {fansignLeft} left</strong>}
                                    {fansignLeft === 0 && <span className="ml-1">✓</span>}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                }

                // ── Standard leftover calculator ───────────────────────────
                // Count total order_items rows per member (one row per claim,
                // so 2x Koko for one joiner = 2 rows = count of 2, not 1)
                const claimedCount: Record<string, number> = {}
                for (const m of groupMembers) { claimedCount[m.id] = 0 }
                for (const jg of data.joiners) {
                  for (const item of jg.items) {
                    if (item.member_id && claimedCount[item.member_id] !== undefined) {
                      claimedCount[item.member_id]++
                    }
                  }
                }
                const counts = groupMembers.map(m => ({ id: m.id, name: m.name, count: claimedCount[m.id] ?? 0 }))
                const maxCount = Math.max(...counts.map(c => c.count))
                if (maxCount === 0) return null
                const leftovers = counts.filter(c => c.count < maxCount).sort((a, b) => a.count - b.count)
                if (leftovers.length === 0) return null
                const totalLeftovers = leftovers.reduce((s, l) => s + (maxCount - l.count), 0)

                return (
                  <div className="border border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800 rounded-xl px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">⚠ Leftover Members</p>
                      <span className="text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-700">{totalLeftovers} total leftover</span>
                    </div>
                    <div className="space-y-1.5">
                      {leftovers.map(l => {
                        const diff = maxCount - l.count
                        return (
                          <div key={l.id} className="flex items-center justify-between text-sm gap-3">
                            <span className="font-semibold text-amber-800 dark:text-amber-200">{l.name}</span>
                            <span className="text-xs text-amber-600 dark:text-amber-400 text-right">
                              {l.count}/{maxCount} claimed
                              <strong className="ml-1.5 text-amber-700 dark:text-amber-300">→ {diff} leftover</strong>
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {/* Paid progress */}
              {data.joiners.length > 0 && (() => {
                const paidCount = data.joiners.filter((j: any) => j.paid).length
                const allPaid = paidCount === data.joiners.length
                return (
                  <div className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-sm font-semibold ${allPaid ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300'}`}>
                    {allPaid ? <Check size={14} /> : <Clock size={14} />}
                    {paidCount}/{data.joiners.length} paid
                    {allPaid && <span className="ml-1 font-medium">· All done ✓</span>}
                  </div>
                )
              })()}

              {/* Per-joiner cards */}
              {data.joiners.length === 0 ? (
                <div className="text-center py-12">
                  <Users size={28} className="mx-auto mb-2 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">No items logged yet.</p>
                </div>
              ) : data.joiners.map((jg: any, idx: number) => {
                const name = jg.joiner?.display_name || jg.joiner?.username || 'Unassigned'
                const grouped = groupItems(jg.items)
                const joinerTotal = jg.items.reduce((s: number, i: any) => s + (parseFloat(i.price_eur) || 0) * (i.amount_claimed || 1), 0)

                return (
                  <div key={jg.joiner_id || idx} className={`border rounded-2xl overflow-hidden transition-colors ${jg.paid ? 'border-emerald-200 dark:border-emerald-800' : 'border-border'}`}>
                    {/* Joiner header row */}
                    <div className={`flex items-center justify-between px-4 py-3 border-b ${jg.paid ? 'bg-emerald-50/50 border-emerald-100 dark:bg-emerald-900/10 dark:border-emerald-800' : 'bg-secondary/30 border-border'}`}>
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary/25 to-primary/5 flex items-center justify-center flex-shrink-0">
                          <span className="text-primary text-xs font-bold">{name.slice(0, 2).toUpperCase()}</span>
                        </div>
                        <div>
                          <p className="font-semibold text-sm leading-tight">{name}</p>
                          <p className="text-xs text-muted-foreground">{data.totalItems > 0 ? (() => {
                            const joinerKrw = jg.items.reduce((s: number, i: any) => s + (parseFloat(i.price_krw)||0)*(i.amount_claimed||1), 0)
                            return `${jg.items.length} item${jg.items.length !== 1 ? 's' : ''} · ${formatEur(joinerTotal)}${joinerKrw > 0 ? ` (${formatKrw(joinerKrw)})` : ''}${jg.items.reduce((s:number,i:any)=>s+(i.entries_count||0),0)>0 ? ` · 🎟 ${jg.items.reduce((s:number,i:any)=>s+(i.entries_count||0),0)} entries` : ''}`
                          })() : '—'}</p>
                        </div>
                      </div>
                      {jg.joiner_id && (
                        <button
                          onClick={() => togglePaid(jg.joiner_id, jg.paid)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                            jg.paid
                              ? 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700'
                              : 'bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-primary'
                          }`}
                        >
                          {jg.paid ? <Check size={11} /> : <Clock size={11} />}
                          {jg.paid ? 'Paid' : 'Unpaid'}
                        </button>
                      )}
                    </div>

                    {/* Grouped item lines */}
                    <div className="divide-y divide-border/40">
                      {grouped.map((g, gi) => (
                        <div key={gi} className="flex items-center justify-between px-4 py-2.5 gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-snug">
                              {g.qty > 1 && <span className="text-primary font-bold mr-1.5">×{g.qty}</span>}
                              {g.label}
                            </p>
                            {g.members.length > 0 && (
                              <p className="text-xs text-muted-foreground mt-0.5">{g.members.join(', ')}</p>
                            )}
                            {g.entries_count > 0 && (
                              <p className="text-xs font-semibold text-rose-600 mt-0.5">🎟 {g.entries_count} {g.entries_count === 1 ? 'entry' : 'entries'}</p>
                            )}
                          </div>
                          <div className="flex-shrink-0 text-right">
                            {g.price_eur != null ? (
                              <>
                                <p className="text-sm font-semibold text-primary">{formatEur(g.price_eur * g.qty)}{g.price_krw && <span className="text-muted-foreground font-normal ml-1 text-xs">({formatKrw(g.price_krw * g.qty)})</span>}</p>
                                {g.qty > 1 && <p className="text-xs text-muted-foreground">{formatEur(g.price_eur)} each{g.price_krw ? ` / ${formatKrw(g.price_krw)}` : ''}</p>}
                              </>
                            ) : (
                              <p className="text-xs text-muted-foreground/50">—</p>
                            )}
                          </div>
                        </div>
                      ))}

                      {/* Sorting results — below member claimed */}
                      <SortResultsList results={sortResults.filter((r: any) => r.joiner_id === jg.joiner_id)} />

                      {/* Subtotal if more than one line */}
                      {grouped.length > 1 && (
                        <div className="flex items-center justify-between px-4 py-2 bg-secondary/20">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Subtotal</p>
                          <p className="text-sm font-bold">{(() => { const joinerKrw = jg.items.reduce((s: number, i: any) => s + (parseFloat(i.price_krw) || 0) * (i.amount_claimed || 1), 0); return <>{formatEur(joinerTotal)}{joinerKrw > 0 && <span className="text-muted-foreground font-normal ml-1.5 text-xs">({formatKrw(joinerKrw)})</span>}</> })()}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* Order meta */}
              <OrderMeta order={data.order} />
            </div>

          ) : (
            // ── JOINER VIEW: only their own items ─────────────────
            <div className="p-5 space-y-4">

              {/* Payment info — shown prominently at the top for joiners */}
              {data.order?.payment_info && (
                <div className="border border-primary/25 bg-primary/5 rounded-2xl px-4 py-3.5">
                  <p className="text-xs font-bold text-primary uppercase tracking-widest mb-1.5">💳 Payment Info</p>
                  <p className="text-sm whitespace-pre-wrap">{data.order.payment_info}</p>
                </div>
              )}

              {data.joiners.length === 0 ? (
                <div className="text-center py-12">
                  <ShoppingBag size={28} className="mx-auto mb-2 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">No items found for you in this order.</p>
                </div>
              ) : data.joiners.map((jg: any, idx: number) => {
                const grouped = groupItems(jg.items)
                const joinerTotal = jg.items.reduce((s: number, i: any) => s + (parseFloat(i.price_eur) || 0) * (i.amount_claimed || 1), 0)

                return (
                  <div key={idx} className="space-y-3">

                    {/* Payment status banner */}
                    <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border font-semibold text-sm ${
                      jg.paid
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300'
                        : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300'
                    }`}>
                      {jg.paid ? <Check size={15} /> : <Clock size={15} />}
                      {jg.paid ? 'Payment received ✓' : 'Payment pending — contact your GOM'}
                    </div>

                    {/* Items card */}
                    <div className="border border-border rounded-2xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-center justify-between">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Your items</p>
                        <p className="text-xs text-muted-foreground">{jg.items.length} item{jg.items.length !== 1 ? 's' : ''}</p>
                      </div>
                      <div className="divide-y divide-border/40">
                        {grouped.map((g, gi) => (
                          <div key={gi} className="flex items-center justify-between px-4 py-3 gap-4">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium leading-snug">
                                {g.qty > 1 && <span className="text-primary font-bold mr-1.5">×{g.qty}</span>}
                                {g.label}
                              </p>
                              {g.members.length > 0 && (
                                <p className="text-xs text-muted-foreground mt-0.5">{g.members.join(', ')}</p>
                              )}
                            </div>
                            <div className="flex-shrink-0 text-right">
                              {g.price_eur != null ? (
                                <>
                                  <p className="text-sm font-semibold text-primary">{formatEur(g.price_eur * g.qty)}{g.price_krw ? <span className="text-muted-foreground font-normal ml-1 text-xs">({formatKrw(g.price_krw * g.qty)})</span> : null}</p>
                                  {g.qty > 1 && <p className="text-xs text-muted-foreground">{formatEur(g.price_eur)} each{g.price_krw ? ` / ${formatKrw(g.price_krw)}` : ""}</p>}
                                </>
                              ) : (
                                <p className="text-xs text-muted-foreground/50">—</p>
                              )}
                            </div>
                          </div>
                        ))}

                        {/* Sorting results — below member claimed */}
                        <SortResultsList results={sortResults.filter((r: any) => r.joiner_id === jg.joiner_id)} />

                        {/* Total */}
                        <div className="flex items-center justify-between px-4 py-3 bg-primary/5 border-t border-primary/10">
                          <p className="text-sm font-bold">Total to pay</p>
                          <p className="text-base font-display font-bold text-primary">{formatEur(joinerTotal)}{(() => { const kTotal = jg.items.reduce((s: number, i: any) => s + (parseFloat(i.price_krw)||0)*(i.amount_claimed||1), 0); return kTotal > 0 ? <span className="text-sm font-normal text-muted-foreground ml-1.5">({formatKrw(kTotal)})</span> : null })()}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* Order meta */}
              <OrderMeta order={data?.order} />
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function OrderMeta({ order }: { order: any }) {
  if (!order) return null
  return (
    <div className="space-y-3 mt-2">
      <div className="border border-border rounded-2xl p-4 space-y-2 text-sm">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Order info</p>
        <div className="flex justify-between"><span className="text-muted-foreground">Shop</span><span className="font-medium">{order.shop?.name || '—'}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="font-medium capitalize">{order.type}</span></div>
        {order.round_number && <div className="flex justify-between"><span className="text-muted-foreground">Round</span><span className="font-medium">#{order.round_number}</span></div>}
        {order.addy_country && <div className="flex justify-between"><span className="text-muted-foreground">Addy</span><span className="font-medium">{order.addy_country}</span></div>}
        <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span className="font-medium">{formatDate(order.created_at)}</span></div>
        {order.notes && (
          <div className="pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground mb-1">Notes</p>
            <p className="text-sm">{order.notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}
