'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus, Star, Pencil, Trash2, Shuffle, X } from 'lucide-react'
import { Button, Card, Table, Th, Td, Tr, Modal, Input, Select, FormField, Checkbox, EmptyState, Badge } from '@/components/ui'
import { formatDateTime } from '@/lib/utils'

// Archive of the old fancall records (before Events). Still fully editable, raffle included.
// New fancalls are Fancall events (src/components/shared/Events.tsx).
export function FancallArchive() {
  const [fancalls, setFancalls] = useState<any[]>([])
  const [shops, setShops] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [fancallModal, setFancallModal] = useState(false)
  const [editingFancall, setEditingFancall] = useState<any>(null)
  const [fcForm, setFcForm] = useState({ shop_id:'', entered_by:'', fancall_datetime:'', won:false, received:false, benefits_to_kaddy:'' })
  const [saving, setSaving] = useState(false)

  // Raffle state
  const [raffleModal, setRaffleModal] = useState<any>(null)   // the fancall being raffled
  const [raffleEntries, setRaffleEntries] = useState<{ joiner_id: string; display_name: string; entries: number; base: number; bonus: number; bonus_type: 'fixed' | 'semi_fixed' | null }[]>([])
  const [raffleLoading, setRaffleLoading] = useState(false)
  const [raffleWinner, setRaffleWinner] = useState<{ joiner_id: string; display_name: string } | null>(null)
  const [raffleAnimation, setRaffleAnimation] = useState(false)
  const [raffleSaving, setRaffleSaving] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [fc, s, u] = await Promise.all([
      fetch('/api/fancalls').then(r=>r.json()),
      fetch('/api/shops').then(r=>r.json()),
      fetch('/api/users').then(r=>r.json()),
    ])
    setFancalls(Array.isArray(fc)?fc:[])
    setShops(Array.isArray(s)?s:[])
    setUsers(Array.isArray(u)?u:[])
    setLoading(false)
  }, [])
  useEffect(() => { fetchData() }, [fetchData])

  function openNew() { setEditingFancall(null); setFcForm({ shop_id:'', entered_by:'', fancall_datetime:'', won:false, received:false, benefits_to_kaddy:'' }); setFancallModal(true) }
  function openEdit(fc: any) { setEditingFancall(fc); setFcForm({ shop_id:fc.shop_id||'', entered_by:fc.entered_by||'', fancall_datetime:fc.fancall_datetime?.slice(0,16)||'', won:fc.won, received:fc.received, benefits_to_kaddy:fc.benefits_to_kaddy||'' }); setFancallModal(true) }

  async function saveFancall() {
    setSaving(true)
    const method = editingFancall ? 'PATCH' : 'POST'
    const body = editingFancall ? { ...fcForm, id: editingFancall.id } : fcForm
    await fetch('/api/fancalls', { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
    setFancallModal(false); fetchData(); setSaving(false)
  }

  async function deleteFancall(id: string) {
    if (!confirm('Delete this fancall?')) return
    await fetch('/api/fancalls', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) })
    fetchData()
  }

  // Load entries for a fancall's linked order
  async function openRaffle(fc: any) {
    if (!fc.order_id) {
      alert('This fancall has no linked order. Make sure the order has "This order is a fancall" checked.')
      return
    }
    setRaffleModal(fc)
    setRaffleWinner(null)
    setRaffleLoading(true)
    // Bought entries (qty × entries per pricing option) + bonus, computed server-side:
    //   +2 for fixed joiners of this order's group, +1 for semi-fixed spot holders in that group.
    // Bonuses only go to joiners who have a claim in this order.
    const data = await fetch(`/api/raffle-entries?order_id=${fc.order_id}`).then(r => r.json()).catch(() => [])
    setRaffleEntries(Array.isArray(data) ? data : [])
    setRaffleLoading(false)
  }

  function runRaffle() {
    if (raffleEntries.length === 0) return
    setRaffleAnimation(true)
    setRaffleWinner(null)

    // Build weighted pool
    const pool: { joiner_id: string; display_name: string }[] = []
    for (const e of raffleEntries) {
      for (let i = 0; i < e.entries; i++) pool.push({ joiner_id: e.joiner_id, display_name: e.display_name })
    }

    // Animate through random names for 2 seconds then reveal winner
    let tick = 0
    const interval = setInterval(() => {
      tick++
      const random = pool[Math.floor(Math.random() * pool.length)]
      setRaffleWinner({ joiner_id: random.joiner_id, display_name: random.display_name })
      if (tick > 20) {
        clearInterval(interval)
        // Final pick
        const winner = pool[Math.floor(Math.random() * pool.length)]
        setRaffleWinner(winner)
        setRaffleAnimation(false)
      }
    }, 80)
  }

  async function saveWinner() {
    if (!raffleWinner || !raffleModal) return
    setRaffleSaving(true)
    await fetch('/api/fancalls', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: raffleModal.id, raffle_winner_id: raffleWinner.joiner_id }),
    })
    setRaffleModal(null)
    setRaffleWinner(null)
    fetchData()
    setRaffleSaving(false)
  }

  const totalEntries = raffleEntries.reduce((s, e) => s + e.entries, 0)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 px-4 sm:px-6 pt-4">
        <p className="text-xs text-muted-foreground">🗄 Fancalls entered before Events existed · {fancalls.length} entries. Still editable.</p>
        <Button size="sm" variant="outline" onClick={openNew}><Plus size={13}/> Archive fancall</Button>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {loading ? <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>
        : fancalls.length === 0 ? <EmptyState icon={Star} title="No archived fancalls"/>
        : <Card>
            <Table>
              <thead><tr>
                <Th>Shop</Th><Th>Date</Th><Th>Won</Th><Th>Received</Th><Th>Winner</Th><Th></Th>
              </tr></thead>
              <tbody>
                {fancalls.map(fc => (
                  <Tr key={fc.id}>
                    <Td className="font-semibold">{fc.shop?.name||'—'}</Td>
                    <Td>{fc.fancall_datetime ? formatDateTime(fc.fancall_datetime) : '—'}</Td>
                    <Td>{fc.won ? <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs">Won ✓</Badge> : <span className="text-muted-foreground/40 text-xs">—</span>}</Td>
                    <Td>{fc.received ? <Badge className="bg-sky-50 text-sky-700 border border-sky-200 text-xs">Received</Badge> : <span className="text-muted-foreground/40 text-xs">—</span>}</Td>
                    <Td>
                      {fc.raffle_winner ? (
                        <Badge className="bg-amber-50 text-amber-700 border border-amber-300 text-xs">🏆 {fc.raffle_winner.display_name || fc.raffle_winner.username}</Badge>
                      ) : fc.order_id ? (
                        <span className="text-xs text-muted-foreground">Not raffled</span>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">No order linked</span>
                      )}
                    </Td>
                    <Td>
                      <div className="flex gap-1">
                        {fc.order_id && (
                          <Button variant="ghost" size="sm" onClick={() => openRaffle(fc)}
                            className="text-primary hover:text-primary font-semibold">
                            <Shuffle size={13}/> Raffle
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => openEdit(fc)}><Pencil size={13}/></Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteFancall(fc.id)}><Trash2 size={13} className="text-destructive/50"/></Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        }
      </div>

      {/* Edit/New Fancall Modal */}
      <Modal open={fancallModal} onClose={() => { setFancallModal(false); setEditingFancall(null) }} title={editingFancall ? 'Edit Fancall' : 'New Fancall'} size="md">
        <div className="space-y-4">
          <FormField label="Shop"><Select options={shops.map(s=>({value:s.id,label:s.name}))} placeholder="Select shop…" value={fcForm.shop_id} onChange={e=>setFcForm(f=>({...f,shop_id:e.target.value}))}/></FormField>
          <FormField label="Fancall Date & Time"><Input type="datetime-local" value={fcForm.fancall_datetime} onChange={e=>setFcForm(f=>({...f,fancall_datetime:e.target.value}))}/></FormField>
          <FormField label="Benefits to K-Addy"><Input placeholder="e.g. Photocard, signed album…" value={fcForm.benefits_to_kaddy} onChange={e=>setFcForm(f=>({...f,benefits_to_kaddy:e.target.value}))}/></FormField>
          <div className="flex gap-4">
            <Checkbox id="won" label="Won" checked={fcForm.won} onChange={e=>setFcForm(f=>({...f,won:e.target.checked}))}/>
            <Checkbox id="received" label="Received" checked={fcForm.received} onChange={e=>setFcForm(f=>({...f,received:e.target.checked}))}/>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={()=>{setFancallModal(false);setEditingFancall(null)}}>Cancel</Button>
            <Button onClick={saveFancall} disabled={saving}>{saving?'Saving…':editingFancall?'Update':'Save'}</Button>
          </div>
        </div>
      </Modal>

      {/* Raffle Modal */}
      {raffleModal && (
        <Modal open={true} onClose={() => { setRaffleModal(null); setRaffleWinner(null) }} title="🎟 Raffle" subtitle={`${raffleModal.shop?.name || 'Fancall'} — ${totalEntries} total entries`} size="md">
          <div className="space-y-5">
            {raffleLoading ? (
              <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>
            ) : raffleEntries.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground text-sm">No entries found for this order.</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Make sure joiners have been logged with entries in the Orders page.</p>
              </div>
            ) : (
              <>
                {/* Entries list */}
                <div className="space-y-2">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Participants</p>
                  <div className="bg-secondary/30 rounded-2xl divide-y divide-border overflow-hidden">
                    {raffleEntries.map(e => (
                      <div key={e.joiner_id} className="flex items-center justify-between px-4 py-2.5">
                        <span className="text-sm font-semibold">{e.display_name}</span>
                        <div className="flex items-center gap-2">
                          {e.bonus > 0 && (
                            <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full border ${e.bonus_type === 'fixed' ? 'bg-primary/10 text-primary border-primary/30' : 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-800'}`}>
                              {e.base} + {e.bonus} {e.bonus_type === 'fixed' ? 'fixed' : 'semi-fixed'}
                            </span>
                          )}
                          <span className="text-xs font-bold text-primary">{e.entries}</span>
                          <span className="text-xs text-muted-foreground">entr{e.entries === 1 ? 'y' : 'ies'}</span>
                          <span className="text-xs text-muted-foreground">({Math.round(e.entries / totalEntries * 100)}%)</span>
                          <button
                            onClick={() => setRaffleEntries(prev => prev.filter(r => r.joiner_id !== e.joiner_id))}
                            className="text-muted-foreground/50 hover:text-destructive transition-colors ml-1"
                            title="Remove from raffle"
                          >
                            <X size={13}/>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Winner reveal */}
                {raffleWinner && (
                  <div className={`rounded-2xl border-2 px-6 py-5 text-center transition-all ${raffleAnimation ? 'border-primary/30 bg-primary/5' : 'border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700'}`}>
                    {raffleAnimation ? (
                      <p className="font-display font-bold text-2xl text-primary animate-pulse">{raffleWinner.display_name}</p>
                    ) : (
                      <>
                        <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-1">🏆 Winner</p>
                        <p className="font-display font-bold text-3xl text-amber-700 dark:text-amber-300">{raffleWinner.display_name}</p>
                      </>
                    )}
                  </div>
                )}

                <div className="flex gap-3">
                  <Button onClick={runRaffle} disabled={raffleAnimation} className="flex-1" variant={raffleWinner && !raffleAnimation ? 'outline' : 'default'}>
                    <Shuffle size={14}/> {raffleWinner && !raffleAnimation ? 'Re-roll' : 'Roll Raffle'}
                  </Button>
                  {raffleWinner && !raffleAnimation && (
                    <Button onClick={saveWinner} disabled={raffleSaving} className="flex-1">
                      {raffleSaving ? 'Saving…' : '🏆 Save Winner'}
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
