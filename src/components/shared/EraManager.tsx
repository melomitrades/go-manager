'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus, Pencil, Trash2, Flag, RotateCcw, UserMinus, Check, X } from 'lucide-react'
import { Button, Modal, Input, FormField, Select, Badge } from '@/components/ui'
import { formatDate } from '@/lib/utils'

// Settings → Groups & Members → (expanded group) → Eras & semi-fixed spots.
// An era = one album cycle of the group. Its settings decide how many events make one
// semi-fixed round and how many days a joiner has to renew once their round is complete.

interface Props {
  groupId: string
  members: { id: string; name: string }[]
  joiners: { id: string; display_name?: string | null; username: string }[]
}

const emptyEra = { name: '', events_per_round: '5', renewal_days: '7' }

export function EraManager({ groupId, members, joiners }: Props) {
  const [eras, setEras] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [eraModal, setEraModal] = useState(false)
  const [editingEra, setEditingEra] = useState<any>(null)
  const [eraForm, setEraForm] = useState(emptyEra)
  const [saving, setSaving] = useState(false)
  // Add-spot form, per era
  const [addFor, setAddFor] = useState<string | null>(null)
  const [newJoiner, setNewJoiner] = useState('')
  const [newMembers, setNewMembers] = useState<string[]>([])
  // Editing a spot's members
  const [editSpot, setEditSpot] = useState<string | null>(null)
  const [editMembers, setEditMembers] = useState<string[]>([])
  const [showClosed, setShowClosed] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const data = await fetch(`/api/eras?group_id=${groupId}`).then(r => r.json()).catch(() => [])
    setEras(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [groupId])
  useEffect(() => { load() }, [load])

  const memberName = (id: string) => members.find(m => m.id === id)?.name || '?'
  const joinerName = (s: any) => s.joiner_display_name || s.joiner_username || 'Unknown'

  async function api(url: string, method: string, body: any) {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Something went wrong') }
    return res.ok
  }

  function openNewEra() { setEditingEra(null); setEraForm(emptyEra); setEraModal(true) }
  function openEditEra(e: any) { setEditingEra(e); setEraForm({ name: e.name, events_per_round: String(e.events_per_round), renewal_days: String(e.renewal_days) }); setEraModal(true) }

  async function saveEra() {
    setSaving(true)
    const ok = editingEra
      ? await api('/api/eras', 'PATCH', { id: editingEra.id, ...eraForm })
      : await api('/api/eras', 'POST', { group_id: groupId, ...eraForm })
    setSaving(false)
    if (ok) { setEraModal(false); load() }
  }

  async function endEra(e: any) {
    const active = (e.spots || []).filter((s: any) => s.status === 'active').length
    if (!confirm(`End era "${e.name}"?${active ? ` Its ${active} semi-fixed spot${active === 1 ? '' : 's'} will end too.` : ''}`)) return
    if (await api('/api/eras', 'PATCH', { id: e.id, end: true })) load()
  }
  async function reopenEra(e: any) {
    if (!confirm(`Reopen era "${e.name}"? Spots that ended with it stay ended — re-add them if needed.`)) return
    if (await api('/api/eras', 'PATCH', { id: e.id, reopen: true })) load()
  }
  async function deleteEra(e: any) {
    if (!confirm(`Delete era "${e.name}"? Its orders are kept (just untagged) and its semi-fixed spots are deleted.`)) return
    if (await api('/api/eras', 'DELETE', { id: e.id })) load()
  }

  async function addSpot(eraId: string) {
    if (!newJoiner) return
    if (await api('/api/semi-fixed', 'POST', { era_id: eraId, joiner_id: newJoiner, member_ids: newMembers })) {
      setAddFor(null); setNewJoiner(''); setNewMembers([]); load()
    }
  }
  async function saveSpotMembers(id: string) {
    if (await api('/api/semi-fixed', 'PATCH', { id, member_ids: editMembers })) { setEditSpot(null); load() }
  }
  async function renew(s: any) {
    if (!confirm(`Renew ${joinerName(s)}'s spot now? (normally the joiner does this from My Orders)`)) return
    if (await api('/api/semi-fixed', 'PATCH', { id: s.id, action: 'renew' })) load()
  }
  async function release(s: any) {
    if (!confirm(`Release ${joinerName(s)}'s semi-fixed spot?`)) return
    if (await api('/api/semi-fixed', 'PATCH', { id: s.id, action: 'release' })) load()
  }
  async function removeSpot(s: any) {
    if (!confirm(`Delete this spot record for ${joinerName(s)}?`)) return
    if (await api('/api/semi-fixed', 'DELETE', { id: s.id })) load()
  }

  const MemberPills = ({ selected, onToggle }: { selected: string[]; onToggle: (id: string) => void }) => (
    <div className="flex flex-wrap gap-1">
      {members.map(m => {
        const sel = selected.includes(m.id)
        return (
          <button key={m.id} type="button" onClick={() => onToggle(m.id)}
            className={`text-xs px-2 py-0.5 rounded-full border font-semibold transition-all ${sel ? 'bg-primary text-white border-primary' : 'bg-background text-muted-foreground border-border hover:border-primary/50'}`}>
            {m.name}
          </button>
        )
      })}
    </div>
  )
  const toggle = (list: string[], id: string) => list.includes(id) ? list.filter(x => x !== id) : [...list, id]

  return (
    <div className="mt-5 pt-4 border-t border-border space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Eras &amp; semi-fixed spots</p>
          <p className="text-xs text-muted-foreground mt-0.5">Semi-fixed joiners are auto-added to the era&apos;s orders and get +1 raffle entry. One order joined = one event.</p>
        </div>
        <Button variant="outline" size="sm" onClick={openNewEra}><Plus size={13} /> New era</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-4"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : eras.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-3">No eras yet.</p>
      ) : eras.map(e => {
        const active = e.status === 'active'
        const openSpots = (e.spots || []).filter((s: any) => s.status === 'active')
        const closedSpots = (e.spots || []).filter((s: any) => s.status !== 'active')
        const takenIds = new Set(openSpots.map((s: any) => String(s.joiner_id)))
        return (
          <div key={e.id} className={`border rounded-xl overflow-hidden ${active ? 'border-border' : 'border-border/60 opacity-80'}`}>
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-secondary/30">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold truncate">{e.name}</span>
                  {active
                    ? <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800">Active</Badge>
                    : <Badge className="bg-secondary text-muted-foreground border border-border">Ended {e.ended_at ? formatDate(e.ended_at) : ''}</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {e.events_per_round} event{e.events_per_round === 1 ? '' : 's'} per round · {e.renewal_days} day{e.renewal_days === 1 ? '' : 's'} to renew · {e.order_count} order{e.order_count === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <Button variant="ghost" size="icon" title="Edit era" onClick={() => openEditEra(e)}><Pencil size={13} /></Button>
                {active
                  ? <Button variant="ghost" size="sm" title="End era" onClick={() => endEra(e)}><Flag size={13} /> End era</Button>
                  : <Button variant="ghost" size="icon" title="Reopen era" onClick={() => reopenEra(e)}><RotateCcw size={13} /></Button>}
                <Button variant="ghost" size="icon" title="Delete era" onClick={() => deleteEra(e)}><Trash2 size={13} className="text-destructive/60" /></Button>
              </div>
            </div>

            <div className="divide-y divide-border">
              {openSpots.map((s: any) => {
                const pct = s.target > 0 ? Math.min(100, Math.round(s.progress / s.target * 100)) : 0
                const waiting = s.state === 'awaiting_renewal'
                return (
                  <div key={s.id} className={`px-3 py-2.5 space-y-1.5 ${waiting ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{joinerName(s)}</span>
                      {editSpot !== s.id && (s.member_ids.length > 0
                        ? s.member_ids.map((id: string) => <span key={id} className="text-[11px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">{memberName(id)}</span>)
                        : <span className="text-[11px] text-muted-foreground">no member set</span>)}
                      <span className="text-[11px] text-muted-foreground">· round {s.round}</span>
                      {waiting && (
                        <Badge className="bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700">
                          Renewal needed · by {s.renewal_deadline ? formatDate(s.renewal_deadline) : '—'}
                        </Badge>
                      )}
                      <div className="ml-auto flex gap-1">
                        {waiting && <Button variant="ghost" size="sm" onClick={() => renew(s)} title="Renew on their behalf"><RotateCcw size={12} /> Renew</Button>}
                        <Button variant="ghost" size="icon" title="Edit members" onClick={() => { setEditSpot(s.id); setEditMembers(s.member_ids) }}><Pencil size={12} /></Button>
                        <Button variant="ghost" size="icon" title="Release spot" onClick={() => release(s)}><UserMinus size={12} className="text-destructive/60" /></Button>
                      </div>
                    </div>
                    {editSpot === s.id && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <MemberPills selected={editMembers} onToggle={id => setEditMembers(l => toggle(l, id))} />
                        <Button variant="ghost" size="icon" onClick={() => saveSpotMembers(s.id)}><Check size={13} className="text-emerald-600" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setEditSpot(null)}><X size={13} /></Button>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className={`h-full rounded-full ${waiting ? 'bg-amber-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-semibold tabular-nums text-muted-foreground">{s.progress} / {s.target}</span>
                    </div>
                  </div>
                )
              })}

              {active && (addFor === e.id ? (
                <div className="px-3 py-3 space-y-2 bg-primary/[0.03]">
                  <Select
                    options={joiners.filter(j => !takenIds.has(String(j.id))).map(j => ({ value: j.id, label: j.display_name || j.username }))}
                    placeholder="Select joiner…" value={newJoiner} onChange={ev => setNewJoiner(ev.target.value)} className="py-2 text-sm" />
                  {members.length > 0 && <MemberPills selected={newMembers} onToggle={id => setNewMembers(l => toggle(l, id))} />}
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setAddFor(null); setNewJoiner(''); setNewMembers([]) }}>Cancel</Button>
                    <Button size="sm" disabled={!newJoiner} onClick={() => addSpot(e.id)}>Add spot</Button>
                  </div>
                </div>
              ) : (
                <button onClick={() => { setAddFor(e.id); setNewJoiner(''); setNewMembers([]) }}
                  className="w-full px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/5 transition-colors flex items-center justify-center gap-1">
                  <Plus size={12} /> Add semi-fixed joiner
                </button>
              ))}

              {closedSpots.length > 0 && (
                <div className="px-3 py-2">
                  <button className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setShowClosed(m => ({ ...m, [e.id]: !m[e.id] }))}>
                    {showClosed[e.id] ? 'Hide' : 'Show'} {closedSpots.length} past spot{closedSpots.length === 1 ? '' : 's'}
                  </button>
                  {showClosed[e.id] && (
                    <div className="mt-1.5 space-y-1">
                      {closedSpots.map((s: any) => (
                        <div key={s.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium">{joinerName(s)}</span>
                          <span>{s.status === 'lost' ? 'Lost (not renewed / released)' : 'Ended with era'}{s.ended_at ? ` · ${formatDate(s.ended_at)}` : ''}</span>
                          <span>· round {s.round}, {s.progress}/{s.target}</span>
                          <button className="ml-auto hover:text-destructive" title="Delete record" onClick={() => removeSpot(s)}><Trash2 size={11} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}

      <Modal open={eraModal} onClose={() => setEraModal(false)} title={editingEra ? 'Edit Era' : 'New Era'} size="sm">
        <div className="space-y-4">
          <FormField label="Era name (album)" required>
            <Input placeholder="e.g. 5th Mini – Supernova" value={eraForm.name} onChange={ev => setEraForm(f => ({ ...f, name: ev.target.value }))} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Events per round" required>
              <Input type="number" min="1" value={eraForm.events_per_round} onChange={ev => setEraForm(f => ({ ...f, events_per_round: ev.target.value }))} />
            </FormField>
            <FormField label="Days to renew" required>
              <Input type="number" min="0" value={eraForm.renewal_days} onChange={ev => setEraForm(f => ({ ...f, renewal_days: ev.target.value }))} />
            </FormField>
          </div>
          <p className="text-xs text-muted-foreground">When a semi-fixed joiner has joined this many orders of the era, they&apos;re asked to renew. If they don&apos;t within the set days, they lose the spot.</p>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setEraModal(false)}>Cancel</Button>
            <Button onClick={saveEra} disabled={saving || !eraForm.name || !eraForm.events_per_round}>{saving ? 'Saving…' : editingEra ? 'Update' : 'Create'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
