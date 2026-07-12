'use client'
import { useEffect, useState } from 'react'
import { Music, Check, ChevronUp, ChevronDown } from 'lucide-react'
import { Card, CardContent, CardHeader, Button, PageHeader, EmptyState, Badge } from '@/components/ui'

export default function JoinerPCSorterPage() {
  const [sessions, setSessions] = useState<any[]>([])
  const [details, setDetails] = useState<Record<string, any>>({})
  const [submitted, setSubmitted] = useState<Set<string>>(new Set())
  // versionOrder[sessionId][versionId] = array of { member_id, name } in priority order
  const [versionOrder, setVersionOrder] = useState<Record<string, Record<string, { member_id: string; name: string }[]>>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/pc-sorter')
      .then(r => r.json())
      .then(async d => {
        const open = Array.isArray(d) ? d.filter((s: any) => s.form_open) : []
        setSessions(open)
        const detailMap: Record<string, any> = {}
        const initialOrder: Record<string, Record<string, { member_id: string; name: string }[]>> = {}

        for (const s of open) {
          const det = await fetch(`/api/pc-sorter/${s.id}`).then(r => r.json())
          detailMap[s.id] = det

          // Build initial order per version: all members in original order
          initialOrder[s.id] = {}
          for (const version of (det.versions || [])) {
            const pcs = (det.photocards || []).filter((pc: any) => pc.version_id === version.id)
            initialOrder[s.id][version.id] = pcs.map((pc: any) => ({
              member_id: pc.member_id,
              name: pc.member?.name || '?',
            }))
          }
        }
        setDetails(detailMap)
        setVersionOrder(initialOrder)
        setLoading(false)
      })
  }, [])

  function moveUp(sessionId: string, versionId: string, idx: number) {
    if (idx === 0) return
    setVersionOrder(prev => {
      const list = [...(prev[sessionId]?.[versionId] || [])]
      ;[list[idx - 1], list[idx]] = [list[idx], list[idx - 1]]
      return { ...prev, [sessionId]: { ...prev[sessionId], [versionId]: list } }
    })
  }

  function moveDown(sessionId: string, versionId: string, idx: number, len: number) {
    if (idx === len - 1) return
    setVersionOrder(prev => {
      const list = [...(prev[sessionId]?.[versionId] || [])]
      ;[list[idx], list[idx + 1]] = [list[idx + 1], list[idx]]
      return { ...prev, [sessionId]: { ...prev[sessionId], [versionId]: list } }
    })
  }

  async function submitForm(sessionId: string) {
    setSaving(sessionId)
    const sessionVersions = versionOrder[sessionId] || {}
    // Build flat priorities: [{version_id, member_id, priority}]
    const flat: { version_id: string; member_id: string; priority: number }[] = []
    for (const [versionId, members] of Object.entries(sessionVersions)) {
      members.forEach((m, idx) => {
        flat.push({ version_id: versionId, member_id: m.member_id, priority: idx + 1 })
      })
    }
    await fetch(`/api/pc-sorter/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priorities: flat }),
    })
    setSubmitted(prev => { const next = new Set(prev); next.add(sessionId); return next })
    setSaving(null)
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Sorting" subtitle="Rank your photocard preferences — drag or use arrows to reorder" />
      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-5">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
        ) : sessions.length === 0 ? (
          <EmptyState icon={Music} title="No active sessions" description="Your GOM will open a form when it's time to sort photocards." />
        ) : sessions.map(session => {
          const det = details[session.id]
          const isSubmitted = submitted.has(session.id)
          if (!det) return null
          const sessionVersions = versionOrder[session.id] || {}

          return (
            <Card key={session.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-display font-semibold text-lg">{session.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {det.versions?.length || 0} version{det.versions?.length !== 1 ? 's' : ''} · Rank from most to least wanted
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
                    <p className="text-sm font-medium">Your priorities have been submitted. Your GOM will run the sort when ready.</p>
                  </div>
                </CardContent>
              ) : (
                <CardContent className="space-y-5">

                  {(det.versions || []).map((version: any) => {
                    const members = sessionVersions[version.id] || []
                    if (members.length === 0) return null

                    return (
                      <div key={version.id} className="border border-border rounded-2xl overflow-hidden">
                        {/* Version header */}
                        <div className="px-4 py-3 bg-secondary/40 border-b border-border">
                          <p className="text-sm font-semibold">{version.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            #1 at the top = most wanted · use ↑↓ to reorder
                          </p>
                        </div>

                        {/* Ranked member list */}
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
                                {/* Rank badge */}
                                <div className={`w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 ${rankColor}`}>
                                  <span className="text-xs font-bold">{idx + 1}</span>
                                </div>

                                {/* Member name */}
                                <p className="flex-1 text-sm font-semibold">{m.name}</p>

                                {/* Arrow controls */}
                                <div className="flex flex-col gap-0.5 flex-shrink-0">
                                  <button
                                    onClick={() => moveUp(session.id, version.id, idx)}
                                    disabled={isFirst}
                                    className={`w-7 h-6 flex items-center justify-center rounded-lg border transition-all ${
                                      isFirst
                                        ? 'text-muted-foreground/20 border-border/30 cursor-not-allowed'
                                        : 'text-muted-foreground hover:text-primary hover:bg-primary/10 hover:border-primary/30 border-border'
                                    }`}
                                  >
                                    <ChevronUp size={13} />
                                  </button>
                                  <button
                                    onClick={() => moveDown(session.id, version.id, idx, members.length)}
                                    disabled={isLast}
                                    className={`w-7 h-6 flex items-center justify-center rounded-lg border transition-all ${
                                      isLast
                                        ? 'text-muted-foreground/20 border-border/30 cursor-not-allowed'
                                        : 'text-muted-foreground hover:text-primary hover:bg-primary/10 hover:border-primary/30 border-border'
                                    }`}
                                  >
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

                  <Button
                    onClick={() => submitForm(session.id)}
                    disabled={saving === session.id}
                    className="w-full"
                  >
                    {saving === session.id ? 'Submitting…' : <><Check size={14} /> Submit My Preferences</>}
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
