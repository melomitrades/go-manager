'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Pencil, Trash2, ChevronUp, ChevronDown, ImagePlus, AlertTriangle, Check, X, Disc3 } from 'lucide-react'
import { Button, Card, Input, Modal, StatusBadge } from '@/components/ui'
import { WeightVariantPicker } from '@/components/shared/WeightVariantPicker'
import { PackCount } from '@/components/shared/EraAlbum'
import { formatDate } from '@/lib/utils'

// One era = one album with several versions. Everything is counted in INCLUSION PACKS:
// one album copy bought = one pack; a claim takes its "Inclusions" number of packs, or one per
// album copy claimed (whichever is larger, never both).

const roundLabel = (r: any) => r == null || r === '' ? null : /^\d+$/.test(String(r)) ? `R${r}` : String(r)
const orderTitle = (o: any) => [o.shop_name || 'No shop', roundLabel(o.round_number)].filter(Boolean).join(' · ')

// Resize a picked photo to max 640px and JPEG, so it stays small in the database.
function resizePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const max = 640, scale = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')) }
    img.src = url
  })
}

function Unclaimed({ n }: { n: number }) {
  return <span className={`tabular-nums font-semibold ${n < 0 ? 'text-red-500' : n > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>{n}</span>
}

export default function EraPage({ params }: { params: { id: string } }) {
  const eraId = params.id
  const [data, setData] = useState<any | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [weights, setWeights] = useState<any[]>([])
  const [albumName, setAlbumName] = useState('')
  const [editingAlbum, setEditingAlbum] = useState(false)
  const [versionModal, setVersionModal] = useState<{ version: any | null } | null>(null)
  const [vForm, setVForm] = useState({ name: '', weight_variant_id: '', photo_url: '' as string | null })
  const [vSaving, setVSaving] = useState(false)
  const [vError, setVError] = useState('')
  const [deleting, setDeleting] = useState<any | null>(null)
  const [extraForm, setExtraForm] = useState({ version_id: '', qty: '', note: '' })
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/era-albums?era_id=${eraId}`)
    if (res.status === 404) { setNotFound(true); return }
    const d = await res.json().catch(() => null)
    if (d?.era) { setData(d); setAlbumName(d.era.album_name || '') }
  }, [eraId])
  useEffect(() => { load() }, [load])

  // Weight profile names, for showing on version cards
  useEffect(() => {
    if (!data?.era) return
    const qs = new URLSearchParams({ item_type: 'album' }); if (data.era.group_id) qs.set('group_id', data.era.group_id)
    fetch(`/api/weight-variants?${qs}`).then(r => r.ok ? r.json() : []).then(w => setWeights(Array.isArray(w) ? w : [])).catch(() => {})
  }, [data?.era?.group_id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 3500); return () => clearTimeout(t) }, [msg])

  async function act(body: any) {
    const res = await fetch('/api/era-albums', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(out.error || 'Something went wrong')
    return out
  }
  async function run(body: any, done?: string) {
    try { await act(body); if (done) setMsg(done); await load() } catch (e: any) { setMsg(e.message) }
  }

  function openVersion(v: any | null) {
    setVError('')
    setVForm({ name: v?.name || '', weight_variant_id: v?.weight_variant_id || '', photo_url: v?.photo_url || null })
    setVersionModal({ version: v })
  }
  async function saveVersion() {
    if (!vForm.name.trim()) { setVError('Give the version a name'); return }
    setVSaving(true); setVError('')
    try {
      const v = versionModal?.version
      await act(v ? { action: 'version_update', id: v.id, ...vForm } : { action: 'version_add', era_id: eraId, ...vForm })
      setVersionModal(null); await load()
    } catch (e: any) { setVError(e.message) }
    setVSaving(false)
  }
  async function pickPhoto(file?: File | null) {
    if (!file) return
    try { const url = await resizePhoto(file); setVForm(f => ({ ...f, photo_url: url })) } catch (e: any) { setVError(e.message) }
  }

  if (notFound) return <div className="p-8 text-sm text-muted-foreground">This era doesn&apos;t exist anymore. <Link href="/gom/eras" className="text-primary font-semibold">Back to Eras</Link></div>
  if (!data) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>

  const { era, versions, extras, orders, unlinked, totals } = data
  const weightLabel = (id: string | null) => { const w = weights.find(x => x.id === id); return w ? `${w.label}${w.weight_g != null ? ` · ${parseFloat(w.weight_g)} g` : ' · weight not set'}` : null }
  const versionName = (id: string | null) => versions.find((v: any) => v.id === id)?.name

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 sm:px-7 py-5 border-b border-border bg-card/60 backdrop-blur-sm sticky top-0 z-10">
        <Link href="/gom/eras" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground mb-2"><ArrowLeft size={13}/> Eras</Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-display text-2xl font-semibold">{era.name}</h1>
          <span className="text-sm text-muted-foreground">{era.group_name}</span>
          {era.status !== 'active' && <span className="text-[10px] uppercase font-bold text-muted-foreground/70 border border-border rounded px-1">ended {era.ended_at ? formatDate(era.ended_at) : ''}</span>}
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-sm">
          <Disc3 size={14} className="text-primary"/>
          {editingAlbum ? (
            <>
              <Input autoFocus value={albumName} onChange={e => setAlbumName(e.target.value)} placeholder="Album name" className="py-1.5 text-sm w-64"
                onKeyDown={e => { if (e.key === 'Enter') { setEditingAlbum(false); run({ action: 'album', era_id: eraId, album_name: albumName }) } if (e.key === 'Escape') { setEditingAlbum(false); setAlbumName(era.album_name || '') } }}/>
              <button onClick={() => { setEditingAlbum(false); run({ action: 'album', era_id: eraId, album_name: albumName }) }} className="p-1 text-emerald-600" title="Save"><Check size={15}/></button>
              <button onClick={() => { setEditingAlbum(false); setAlbumName(era.album_name || '') }} className="p-1 text-muted-foreground" title="Cancel"><X size={15}/></button>
            </>
          ) : (
            <button onClick={() => setEditingAlbum(true)} className="inline-flex items-center gap-1.5 hover:text-primary">
              {era.album_name ? <span className="font-semibold">{era.album_name}</span> : <span className="italic text-muted-foreground">Add the album name</span>}
              <Pencil size={12} className="text-muted-foreground"/>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-6">
        {/* Totals */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Inclusions bought', value: totals.bought, sub: 'one per album copy' },
            { label: 'Inclusions claimed', value: totals.claimed, sub: 'albums + inclusions claimed' },
            { label: totals.unclaimed < 0 ? 'Over-claimed' : 'Inclusions unclaimed', value: totals.unclaimed < 0 ? -totals.unclaimed : totals.unclaimed, sub: totals.unclaimed < 0 ? 'more claimed than bought' : 'left over' },
          ].map((c, i) => (
            <div key={i} className={`bg-card border rounded-2xl px-4 py-3 ${i === 2 && totals.unclaimed < 0 ? 'border-red-300' : 'border-border'}`}>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{c.label}</p>
              <p className={`font-display text-2xl font-bold tabular-nums mt-0.5 ${i === 2 ? (totals.unclaimed < 0 ? 'text-red-500' : totals.unclaimed > 0 ? 'text-emerald-600' : '') : ''}`}>{c.value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 hidden sm:block">{c.sub}</p>
            </div>
          ))}
        </div>

        {/* Versions */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold text-lg">Versions</h2>
            <Button size="sm" onClick={() => openVersion(null)}><Plus size={13}/> Add version</Button>
          </div>
          {versions.length === 0 && unlinked.bought === 0 && unlinked.claimed === 0 ? (
            <p className="text-sm text-muted-foreground">No versions yet. Add the album&apos;s versions (Ver. A, Digipack…) so orders can pick them.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {versions.map((v: any, i: number) => (
                <div key={v.id} className="bg-card border border-border rounded-2xl overflow-hidden flex">
                  <button onClick={() => openVersion(v)} className="w-20 flex-shrink-0 bg-secondary/40 flex items-center justify-center" title="Edit version">
                    {v.photo_url ? <img src={v.photo_url} alt={v.name} className="w-full h-full object-cover"/> : <Disc3 size={26} className="text-muted-foreground/40"/>}
                  </button>
                  <div className="flex-1 min-w-0 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{v.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{weightLabel(v.weight_variant_id) || 'No weight profile'}</p>
                      </div>
                      <div className="flex items-center -mr-1.5 -mt-1">
                        <button disabled={i === 0} onClick={() => run({ action: 'version_move', id: v.id, dir: -1 })} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-20" title="Move up"><ChevronUp size={13}/></button>
                        <button disabled={i === versions.length - 1} onClick={() => run({ action: 'version_move', id: v.id, dir: 1 })} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-20" title="Move down"><ChevronDown size={13}/></button>
                        <button onClick={() => openVersion(v)} className="p-1 text-muted-foreground hover:text-foreground" title="Edit"><Pencil size={12}/></button>
                        <button onClick={() => setDeleting(v)} className="p-1 text-destructive/50 hover:text-destructive" title="Delete"><Trash2 size={12}/></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-1 mt-2">
                      <PackCount label="Bought" value={v.bought}/>
                      <PackCount label="Claimed" value={v.claimed} tone="muted"/>
                      <PackCount label="Unclaimed" value={v.unclaimed} tone={v.unclaimed < 0 ? 'bad' : v.unclaimed > 0 ? 'good' : 'muted'}/>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">{v.orders} order{v.orders === 1 ? '' : 's'}{v.extra ? ` · +${v.extra} extra` : ''}</p>
                  </div>
                </div>
              ))}
              {(unlinked.bought > 0 || unlinked.claimed > 0) && (
                <div className="bg-amber-50/60 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-2xl px-3 py-2.5">
                  <p className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5"><AlertTriangle size={13}/> Not linked to a version</p>
                  <div className="grid grid-cols-3 gap-1 mt-2">
                    <PackCount label="Bought" value={unlinked.bought}/>
                    <PackCount label="Claimed" value={unlinked.claimed} tone="muted"/>
                    <PackCount label="Unclaimed" value={unlinked.unclaimed} tone={unlinked.unclaimed < 0 ? 'bad' : unlinked.unclaimed > 0 ? 'good' : 'muted'}/>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">Counted in the era totals. Link them below.</p>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Not linked */}
        {unlinked.sections.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-display font-semibold text-lg">Not linked to a version</h2>
            <p className="text-xs text-muted-foreground">These parts of orders don&apos;t match a version name. Pick which version they are.</p>
            <div className="border border-border rounded-2xl divide-y divide-border/60 bg-card">
              {unlinked.sections.map((s: any) => {
                const o = orders.find((x: any) => x.id === s.order_id)
                return (
                  <div key={`${s.order_id}:${s.key}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{o ? orderTitle(o) : 'Order'} <span className="font-normal text-muted-foreground">· {s.label}</span></p>
                      <p className="text-xs text-muted-foreground tabular-nums">{s.bought} bought · {s.claimed} claimed</p>
                    </div>
                    <select defaultValue="" onChange={e => e.target.value && run({ action: 'link', order_id: s.order_id, section: s.key, version_id: e.target.value }, 'Linked')}
                      className="text-xs border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary/30">
                      <option value="">Link to version…</option>
                      {versions.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Extra albums */}
        <section className="space-y-2">
          <h2 className="font-display font-semibold text-lg">Extra albums</h2>
          <p className="text-xs text-muted-foreground">Copies bought outside an order (bulk buys, spares). They count as inclusions bought.</p>
          <div className="border border-border rounded-2xl bg-card divide-y divide-border/60">
            {extras.map((x: any) => (
              <div key={x.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="font-semibold tabular-nums w-10">+{x.qty}</span>
                <span className="flex-shrink-0">{versionName(x.version_id) || <span className="italic text-muted-foreground">No version</span>}</span>
                <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">{x.note}</span>
                <span className="text-xs text-muted-foreground hidden sm:inline">{formatDate(x.created_at)}</span>
                <button onClick={() => run({ action: 'extra_delete', id: x.id })} className="p-1 text-destructive/50 hover:text-destructive" title="Remove"><Trash2 size={12}/></button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <select value={extraForm.version_id} onChange={e => setExtraForm(f => ({ ...f, version_id: e.target.value }))}
                className="text-xs border border-border rounded-lg px-2 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary/30">
                <option value="">No specific version</option>
                {versions.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <Input type="number" min="1" step="1" placeholder="Qty" value={extraForm.qty} onChange={e => setExtraForm(f => ({ ...f, qty: e.target.value }))} className="w-20 py-2 text-xs"/>
              <Input placeholder="Note (optional)" value={extraForm.note} onChange={e => setExtraForm(f => ({ ...f, note: e.target.value }))} className="flex-1 min-w-[140px] py-2 text-xs"/>
              <Button size="sm" disabled={!(parseInt(extraForm.qty) > 0)}
                onClick={async () => { await run({ action: 'extra_add', era_id: eraId, ...extraForm }, 'Extra albums added'); setExtraForm(f => ({ ...f, qty: '', note: '' })) }}>
                <Plus size={12}/> Add
              </Button>
            </div>
          </div>
        </section>

        {/* Orders */}
        <section className="space-y-2">
          <h2 className="font-display font-semibold text-lg">Orders in this era</h2>
          {orders.length === 0 ? <p className="text-sm text-muted-foreground">No orders in this era yet.</p> : (
            <Card>
              <div className="divide-y divide-border/60">
                <div className="hidden md:grid grid-cols-[1fr_80px_80px_90px] gap-3 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 bg-secondary/30">
                  <span>Order</span><span className="text-right">Bought</span><span className="text-right">Claimed</span><span className="text-right">Unclaimed</span>
                </div>
                {orders.map((o: any) => (
                  <div key={o.id} className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_80px_80px_90px] gap-x-3 gap-y-1 items-center px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold">{orderTitle(o)}</p>
                        <StatusBadge status={o.status}/>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {o.bought === 0 && o.claimed === 0 && <span className="text-[11px] text-muted-foreground italic">no albums entered</span>}
                        {o.sections.filter((s: any) => s.bought > 0 || s.claimed > 0).map((s: any) => (
                          <span key={s.key} title={s.version_id ? (s.linked === 'name' ? 'Linked by name' : 'Linked') : 'Not linked to a version'}
                            className={`text-[11px] rounded-full border px-2 py-0.5 tabular-nums ${s.version_id ? 'border-border bg-secondary/40' : 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300'}`}>
                            {s.version_id ? `💿 ${versionName(s.version_id)}` : `⚠ ${s.label}`}{s.version_id && s.key !== '__all__' && s.label !== versionName(s.version_id) ? ` (${s.label})` : ''} · {s.bought}/{s.claimed}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="md:hidden text-right text-sm"><Unclaimed n={o.unclaimed}/><span className="block text-[10px] text-muted-foreground">unclaimed</span></div>
                    <div className="hidden md:block text-right text-sm tabular-nums">{o.bought}</div>
                    <div className="hidden md:block text-right text-sm tabular-nums text-muted-foreground">{o.claimed}</div>
                    <div className="hidden md:block text-right text-sm"><Unclaimed n={o.unclaimed}/></div>
                    <p className="md:hidden col-span-2 text-xs text-muted-foreground tabular-nums">{o.bought} bought · {o.claimed} claimed</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
          <p className="text-[11px] text-muted-foreground">Chips show version · bought/claimed. Claimed counts each claim&apos;s Inclusions number, or one per album copy claimed (the larger, never both). Lost claims count as unclaimed.</p>
        </section>
      </div>

      {msg && <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] bg-foreground text-background text-sm font-medium px-4 py-2 rounded-xl shadow-lg">{msg}</div>}

      {/* Version add / edit */}
      <Modal open={!!versionModal} onClose={() => setVersionModal(null)} title={versionModal?.version ? 'Edit version' : 'Add version'} subtitle={era.album_name || era.name} size="md">
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Name</span>
            <Input autoFocus value={vForm.name} onChange={e => setVForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Ver. A, Digipack, Jewel"
              onKeyDown={e => { if (e.key === 'Enter') saveVersion() }}/>
            <span className="text-[11px] text-muted-foreground block">Orders whose version has this exact name are linked automatically.</span>
          </label>
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground block">Weight profile (optional)</span>
            <WeightVariantPicker itemType="album" groupId={era.group_id || null} value={vForm.weight_variant_id} required={false}
              onChange={id => setVForm(f => ({ ...f, weight_variant_id: id }))}/>
            <span className="text-[11px] text-muted-foreground block">Put on the album options of an order when you pick this version there.</span>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground block">Photo (optional)</span>
            <div className="flex items-center gap-3">
              <div className="w-20 h-20 rounded-xl bg-secondary/40 border border-border overflow-hidden flex items-center justify-center">
                {vForm.photo_url ? <img src={vForm.photo_url} alt="" className="w-full h-full object-cover"/> : <Disc3 size={24} className="text-muted-foreground/40"/>}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { pickPhoto(e.target.files?.[0]); e.target.value = '' }}/>
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><ImagePlus size={13}/> {vForm.photo_url ? 'Change' : 'Add photo'}</Button>
              {vForm.photo_url && <Button size="sm" variant="ghost" onClick={() => setVForm(f => ({ ...f, photo_url: null }))}>Remove</Button>}
            </div>
          </div>
          {vError && <p className="text-xs text-destructive">{vError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setVersionModal(null)}>Cancel</Button>
            <Button onClick={saveVersion} disabled={vSaving}>{vSaving ? 'Saving…' : versionModal?.version ? 'Save' : 'Add version'}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete version" size="sm">
        <p className="text-sm text-muted-foreground mb-5">
          Delete <b>{deleting?.name}</b>? Its extra albums are removed. Orders keep their albums; parts linked to it become &quot;not linked&quot; unless their name matches another version.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="destructive" onClick={async () => { const v = deleting; setDeleting(null); await run({ action: 'version_delete', id: v.id }, 'Version deleted') }}>Delete</Button>
        </div>
      </Modal>
    </div>
  )
}
