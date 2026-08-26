'use client'
import { useEffect, useState } from 'react'
import { Music, Check, ChevronUp, ChevronDown } from 'lucide-react'
import { Card, CardContent, CardHeader, Button, PageHeader, EmptyState, Badge } from '@/components/ui'
import { formatDate } from '@/lib/utils'

interface RankedMember { member_id: string; name: string }

export default function JoinerPCSorterPage() {
  const [sessions, setSessions] = useState<any[]>([])
  const [details, setDetails] = useState<Record<string, any>>({})
  const [submitted, setSubmitted] = useState<Set<string>>(new Set())
  // order[sessionId][itemId] = ranked member list for that item, independent of every other item
  const [order, setOrder] = useState<Record<string, Record<string, RankedMember[]>>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/pc-sorter')
      .then(r => r.json())
      .then(async d => {
        const open = Array.isArray(d) ? d : [] // server already filters to form_open sessions for joiners
        setSessions(open)
        const detailMap: Record<string, any> = {}
        const initialOrder: Record<string, Record<string, RankedMember[]>> = {}

        for (const s of open) {
          const det = await fetch(`/api/pc-sorter/${s.id}`).then(r => r.json())
          detailMap[s.id] = det
          initialOrder[s.id] = {}
          for (const item of (det.items || [])) {
            const qs = (det.quantities || []).filter((q: any) => q.item_id === item.id && (q.total_pulled || 0) > 0)
            initialOrder[s.id][item.id] = qs.map((q: any) => ({ member_id: q.member_id, name: q.member_name || '?' }))
          }
          if ((det.forms || []).length > 0) setSubmitted(prev => new Set(prev).add(s.id))
        }
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
    const itemOrders = order[sessionId] || {}
    const flat: { item_id: string; member_id: string; priority: number }[] = []
    for (const [itemId, members] of Object.entries(itemOrders)) {
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
                  {isSubmitted && (
                    <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 gap-1">
                      <Check size={11} /> Submitted
                    </Badge>
                  )}
                </div>
              </CardHeader>

              {isSubmitted ? (
                <CardContent>
                  <div className="flex items-center gap-2.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-3 text-emerald-700 dark:text-emerald-300">
                    <Check size={15} />
                    <p className="text-sm font-medium">Your priorities have been submitted. Your GOM will run the sort when ready. Resubmitting below will overwrite your previous ranking.</p>
                  </div>
                  <button onClick={() => setSubmitted(prev => { const n = new Set(prev); n.delete(session.id); return n })} className="text-xs text-primary font-semibold hover:underline mt-2">Edit my ranking</button>
                </CardContent>
              ) : (
                <CardContent className="space-y-5">
                  {packs.map((pack: any) => {
                    const items: any[] = (det.items || []).filter((i: any) => i.pack_id === pack.id)
                    if (!items.length) return null
                    return (
                      <div key={pack.id} className="space-y-3">
                        <p className="text-xs font-bold text-primary uppercase tracking-widest">{pack.name}</p>
                        {items.map((item: any) => {
                          const members = itemOrders[item.id] || []
                          if (members.length === 0) return null
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
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
