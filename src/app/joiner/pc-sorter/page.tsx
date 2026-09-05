'use client'
import { useEffect, useState } from 'react'
import { Music, Check, ChevronUp, ChevronDown } from 'lucide-react'
import { Card, CardContent, CardHeader, Button, PageHeader, EmptyState, Badge } from '@/components/ui'
import { formatDate } from '@/lib/utils'

interface RankedMember { member_id: string; name: string }

// A pack's inclusions apply uniformly to every item in it ("1 inclusion = 1 of every item in the
// pack"), so this is the joiner's raw due-count for `item` before any guaranteed claims are
// subtracted.
function inclusionsForPackFrom(inclusions: any[], packId: string): number {
  return inclusions.filter((i: any) => i.pack_id === packId).reduce((s: number, i: any) => s + (parseInt(i.inclusions_assigned) || 0), 0)
}

function guaranteedForItemFrom(guaranteed: any[], itemId: string): number {
  return guaranteed.filter((g: any) => g.item_id === itemId).reduce((s: number, g: any) => s + (parseInt(g.count) || 0), 0)
}

// How many of `item` this joiner still needs to actually RANK — their pack-level due count, minus
// whatever's already guaranteed to a specific unit they claimed (guaranteed claims only ever apply
// to is_unit items; a non-unit item's remaining need is just the pack's due count). Zero means
// there's nothing left for them to sort for this item, so it shouldn't appear on the form.
function remainingNeedForItem(item: any, det: any, packId: string): number {
  const packNeed = inclusionsForPackFrom(det?.inclusions || [], packId)
  if (!item?.is_unit) return packNeed
  return Math.max(0, packNeed - guaranteedForItemFrom(det?.guaranteed || [], item.id))
}

export default function JoinerPCSorterPage() {
  const [sessions, setSessions] = useState<any[]>([])
  const [details, setDetails] = useState<Record<string, any>>({})
  const [submitted, setSubmitted] = useState<Set<string>>(new Set())
  // order[sessionId][itemId] = ranked member list for that item, independent of every other item
  const [order, setOrder] = useState<Record<string, Record<string, RankedMember[]>>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // ?viewAs=joiner is always sent, for every account — same convention as the Orders page.
    // For a real joiner it changes nothing (the API already scopes them to themselves). For a
    // gom/admin it means "show MY OWN participation as a joiner", so this page looks and works
    // identically no matter who's logged in — never a dashboard of everyone else's data.
    fetch('/api/pc-sorter?viewAs=joiner')
      .then(r => r.json())
      .then(async d => {
        const open = Array.isArray(d) ? d : [] // server already filters to form_open (or already-sorted) sessions
        setSessions(open)
        const detailMap: Record<string, any> = {}
        const initialOrder: Record<string, Record<string, RankedMember[]>> = {}

        // Each session's detail fetch is independent of every other session's — fetch them all
        // concurrently instead of one sequential round trip per session.
        const dets = await Promise.all(open.map((s: any) => fetch(`/api/pc-sorter/${s.id}?viewAs=joiner`).then(r => r.json())))
        const submittedIds: string[] = []
        open.forEach((s: any, i: number) => {
          const det = dets[i]
          detailMap[s.id] = det
          initialOrder[s.id] = {}
          for (const item of (det.items || [])) {
            const qs = (det.quantities || []).filter((q: any) => q.item_id === item.id && (q.total_pulled || 0) > 0)
            initialOrder[s.id][item.id] = qs.map((q: any) => ({ member_id: q.member_id, name: q.member_name || '?' }))
          }
          if ((det.forms || []).length > 0) submittedIds.push(s.id)
        })
        if (submittedIds.length > 0) setSubmitted(prev => new Set([...prev, ...submittedIds]))
        setDetails(detailMap)
        setOrder(initialOrder)
        setLoading(false)
      })
  }, [])

  function moveUp(sessionId: string, itemId: string, idx: number) {
    if (idx === 0) return
    setOrder(prev => {
      const list = [...(prev[sessionId]?.[itemId] || [])]
      ;[list[idx - 1], list[idx]] = [list[idx], list[idx - 1]]
      return { ...prev, [sessionId]: { ...prev[sessionId], [itemId]: list } }
    })
  }
  function moveDown(sessionId: string, itemId: string, idx: number, len: number) {
    if (idx === len - 1) return
    setOrder(prev => {
      const list = [...(prev[sessionId]?.[itemId] || [])]
      ;[list[idx], list[idx + 1]] = [list[idx + 1], list[idx]]
      return { ...prev, [sessionId]: { ...prev[sessionId], [itemId]: list } }
    })
  }

  async function submitForm(sessionId: string) {
    setSaving(sessionId)
    const det = details[sessionId]
    const itemOrders = order[sessionId] || {}
    const itemsById = new Map<string, any>((det?.items || []).map((i: any) => [i.id, i]))
    const flat: { item_id: string; member_id: string; priority: number }[] = []
    for (const [itemId, members] of Object.entries(itemOrders)) {
      const item = itemsById.get(itemId)
      // Skip items the joiner has nothing left to rank for (already fully guaranteed, or not due
      // to them at all) — mirrors the visibility filter in the render below, so we never submit
      // priorities for an item that was never shown as a form to rank.
      if (!item || remainingNeedForItem(item, det, item.pack_id) <= 0) continue
      members.forEach((m, idx) => flat.push({ item_id: itemId, member_id: m.member_id, priority: idx + 1 }))
    }
    const res = await fetch(`/api/pc-sorter/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priorities: flat }),
    })
    if (res.ok) setSubmitted(prev => { const next = new Set(prev); next.add(sessionId); return next })
    else {
      const err = await res.json().catch(() => ({}))
      alert(err.error || 'Could not submit — the form may have just closed.')
    }
    setSaving(null)
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Sorting" subtitle="Rank your preferences per item — each item is ranked independently" />
      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-5">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
        ) : sessions.length === 0 ? (
          <EmptyState icon={Music} title="No active sessions" description="Your GOM will open a form when it's time to sort." />
        ) : sessions.map(session => {
          const det = details[session.id]
          const isSubmitted = submitted.has(session.id)
          if (!det) return null
          const packs: any[] = det.packs || []
          const itemOrders = order[session.id] || {}
          const deadlinePassed = session.deadline && new Date(session.deadline) < new Date()
          const myInclusions: any[] = det.inclusions || []
          const myTotalInclusions = myInclusions.reduce((s: number, i: any) => s + (parseInt(i.inclusions_assigned) || 0), 0)
          const inclusionsForPack = (packId: string) => inclusionsForPackFrom(myInclusions, packId)
          const isSorted = !!session.sort_run_at
          // Only show the ranking form while it's actually open and not yet submitted — once
          // submitted, priorities are locked (no self-service edits).
          const canSubmit = session.form_open && !isSubmitted && !deadlinePassed
          const myAssignments: any[] = det.assignments || []
          // Whether there's anything left to actually rank: an item only counts if it has stock
          // (members.length > 0) AND the joiner still has some unmet need for it after subtracting
          // guaranteed claims. A joiner with 0 inclusions everywhere, or whose entire need is
          // already covered by guaranteed unit claims, has nothing to sort — they shouldn't be
          // shown a pointless empty/no-op form.
          const hasAnythingToSort = packs.some((pack: any) =>
            (det.items || []).some((item: any) =>
              item.pack_id === pack.id && (itemOrders[item.id] || []).length > 0 && remainingNeedForItem(item, det, pack.id) > 0
            )
          )

          return (
            <Card key={session.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-display font-semibold text-lg">{session.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {packs.length} pack{packs.length !== 1 ? 's' : ''} · Rank from most to least wanted, per item
                      {session.deadline && <> · Closes {formatDate(session.deadline)}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge className={myTotalInclusions > 0 ? 'bg-primary/10 text-primary border border-primary/20 gap-1' : 'bg-secondary text-muted-foreground border border-border gap-1'}>
                      🎫 {myTotalInclusions} inclusion{myTotalInclusions !== 1 ? 's' : ''} to sort
                    </Badge>
                    {isSubmitted && (
                      <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 gap-1">
                        <Check size={11} /> Submitted
                      </Badge>
                    )}
                    {isSorted && (
                      <Badge className="bg-primary/10 text-primary border border-primary/20 gap-1">
                        🎴 Sorted
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>

              {isSorted ? (
                <CardContent>
                  {myAssignments.length === 0 ? (
                    <div className="flex items-center gap-2.5 bg-secondary/30 border border-border rounded-xl px-4 py-3 text-muted-foreground">
                      <p className="text-sm">The sort has run for this session, but nothing was assigned to you.</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-3 text-emerald-700 dark:text-emerald-300 mb-4">
                        <Check size={15} />
                        <p className="text-sm font-medium">The sort has run — here's what you got.</p>
                      </div>
                      <div className="space-y-3">
                        {packs.map((pack: any) => {
                          const packRows = myAssignments.filter((a: any) => a.pack_id === pack.id)
                          if (!packRows.length) return null
                          return (
                            <div key={pack.id} className="border border-border rounded-2xl overflow-hidden">
                              <div className="px-4 py-2.5 bg-secondary/40 border-b border-border">
                                <p className="text-sm font-semibold">{pack.name}</p>
                              </div>
                              <div className="divide-y divide-border/40">
                                {packRows.map((r: any) => (
                                  <div key={r.id} className="flex items-center justify-between px-4 py-2.5">
                                    <p className="text-sm">{r.item_name}</p>
                                    <p className="text-sm font-semibold">
                                      {r.member_name}
                                      {r.is_guaranteed && <span className="text-emerald-600 ml-1.5 text-xs font-normal">(guaranteed)</span>}
                                      {r.is_repeat && <span className="text-amber-600 ml-1.5 text-xs font-normal">(2nd)</span>}
                                      {r.is_random && <span className="text-sky-600 ml-1.5 text-xs font-normal">(random)</span>}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </CardContent>
              ) : isSubmitted ? (
                <CardContent>
                  <div className="flex items-center gap-2.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-3 text-emerald-700 dark:text-emerald-300">
                    <Check size={15} />
                    <p className="text-sm font-medium">Your priorities have been submitted and can't be changed. Your GOM will run the sort when ready — your results will show here once they do.</p>
                  </div>
                </CardContent>
              ) : canSubmit && !hasAnythingToSort ? (
                <CardContent>
                  <div className="flex items-center gap-2.5 bg-secondary/30 border border-border rounded-xl px-4 py-3 text-muted-foreground">
                    <p className="text-sm">Nothing for you to sort here — either nothing is due to you in this session, or everything due is already guaranteed to a specific version you claimed. Check back after your GOM runs the sort.</p>
                  </div>
                </CardContent>
              ) : canSubmit ? (
                <CardContent className="space-y-5">
                  {packs.map((pack: any) => {
                    const items: any[] = (det.items || []).filter((i: any) =>
                      i.pack_id === pack.id && (itemOrders[i.id] || []).length > 0 && remainingNeedForItem(i, det, pack.id) > 0
                    )
                    if (!items.length) return null
                    return (
                      <div key={pack.id} className="space-y-3">
                        <p className="text-xs font-bold text-primary uppercase tracking-widest">
                          {pack.name}
                          <span className="ml-2 text-muted-foreground normal-case font-normal tracking-normal">· {inclusionsForPack(pack.id)} due to you</span>
                        </p>
                        {items.map((item: any) => {
                          const members = itemOrders[item.id] || []
                          return (
                            <div key={item.id} className="border border-border rounded-2xl overflow-hidden">
                              <div className="px-4 py-3 bg-secondary/40 border-b border-border">
                                <p className="text-sm font-semibold">{item.name}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">#1 at the top = most wanted · ranked independently from other items</p>
                              </div>
                              <div className="divide-y divide-border/40">
                                {members.map((m, idx) => {
                                  const isFirst = idx === 0
                                  const isLast = idx === members.length - 1
                                  const rankColor =
                                    idx === 0 ? 'text-amber-500 bg-amber-50 dark:bg-amber-900/20 border-amber-200' :
                                    idx === 1 ? 'text-slate-500 bg-slate-50 dark:bg-slate-900/20 border-slate-200' :
                                    idx === 2 ? 'text-orange-500 bg-orange-50 dark:bg-orange-900/20 border-orange-200' :
                                    'text-muted-foreground bg-secondary/30 border-border'
                                  return (
                                    <div key={m.member_id} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/20 transition-colors">
                                      <div className={`w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 ${rankColor}`}>
                                        <span className="text-xs font-bold">{idx + 1}</span>
                                      </div>
                                      <p className="flex-1 text-sm font-semibold">{m.name}</p>
                                      <div className="flex flex-col gap-0.5 flex-shrink-0">
                                        <button onClick={() => moveUp(session.id, item.id, idx)} disabled={isFirst}
                                          className={`w-7 h-6 flex items-center justify-center rounded-lg border transition-all ${isFirst ? 'text-muted-foreground/20 border-border/30 cursor-not-allowed' : 'text-muted-foreground hover:text-primary hover:bg-primary/10 hover:border-primary/30 border-border'}`}>
                                          <ChevronUp size={13} />
                                        </button>
                                        <button onClick={() => moveDown(session.id, item.id, idx, members.length)} disabled={isLast}
                                          className={`w-7 h-6 flex items-center justify-center rounded-lg border transition-all ${isLast ? 'text-muted-foreground/20 border-border/30 cursor-not-allowed' : 'text-muted-foreground hover:text-primary hover:bg-primary/10 hover:border-primary/30 border-border'}`}>
                                          <ChevronDown size={13} />
                                        </button>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}

                  <Button onClick={() => submitForm(session.id)} disabled={saving === session.id || deadlinePassed} className="w-full">
                    {deadlinePassed ? 'Deadline passed' : saving === session.id ? 'Submitting…' : <><Check size={14} /> Submit My Preferences</>}
                  </Button>
                </CardContent>
              ) : (
                <CardContent>
                  <p className="text-sm text-muted-foreground">This form is currently closed.</p>
                </CardContent>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
