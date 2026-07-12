'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { MapPin, Save, RefreshCw, Eye, Camera, X } from 'lucide-react'
import { Card, CardContent, CardHeader, Button, PageHeader, EmptyState, StatusBadge } from '@/components/ui'
import { formatDate } from '@/lib/utils'

const COUNTRIES = ['KR', 'CN', 'JP'] as const
type Country = typeof COUNTRIES[number]
const COUNTRY_LABELS: Record<Country, string> = { KR: '🇰🇷 K-Addy', CN: '🇨🇳 C-Addy', JP: '🇯🇵 J-Addy' }

interface AddyItem {
  id: string
  country: Country
  order_id: string | null
  notes: string | null
  arrived_at: string | null
  picture_url: string | null
  order?: {
    id: string; status: string; preview_image_url?: string | null; round_number?: string | null
    shop?: { name: string }; group?: { name: string } | null
  } | null
}

interface Draft { notes: string; picture_url: string; dirty: boolean }

export default function GomAddyPage() {
  const [activeCountry, setActiveCountry] = useState<Country>('KR')
  const [items, setItems] = useState<AddyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const filePickerOpen = React.useRef(false)

  const fetchItems = useCallback(async () => {
    setLoading(true)
    const data = await fetch(`/api/addy-items?country=${activeCountry}`).then(r => r.json()).catch(() => [])
    setItems(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [activeCountry])

  useEffect(() => { fetchItems() }, [fetchItems])
  useEffect(() => {
    const onFocus = () => {
      if (filePickerOpen.current) { filePickerOpen.current = false; return }
      fetchItems()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchItems])

  function getDraft(item: AddyItem): Draft {
    return drafts[item.id] ?? { notes: item.notes ?? '', picture_url: item.picture_url ?? '', dirty: false }
  }
  function setDraft(id: string, patch: Partial<Draft>) {
    setDrafts(prev => {
      const existing = prev[id] ?? { notes: '', picture_url: '', dirty: false }
      return { ...prev, [id]: { ...existing, ...patch, dirty: true } }
    })
  }

  function handlePhoto(item: AddyItem, file: File) {
    if (file.size > 5_000_000) { alert('Max 5MB'); return }
    const reader = new FileReader()
    reader.onload = ev => {
      const base64 = ev.target?.result as string
      if (base64) setDraft(item.id, { picture_url: base64 })
    }
    reader.readAsDataURL(file)
  }

  async function saveItem(item: AddyItem) {
    const draft = getDraft(item)
    setSaving(item.id)
    const res = await fetch('/api/addy-items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, notes: draft.notes.trim() || null, picture_url: draft.picture_url || null }),
    })
    if (res.ok) {
      setDrafts(prev => ({ ...prev, [item.id]: { ...prev[item.id], dirty: false } }))
      fetchItems()
    } else { alert('Save failed. Please try again.') }
    setSaving(null)
  }

  const orderLabel = (item: AddyItem) => {
    const o = item.order
    if (!o) return 'Item'
    return [o.shop?.name, o.round_number || null].filter(Boolean).join(' · ')
  }

  // Build group list from items
  const allGroups = [...new Set(items.map(i => i.order?.group?.name || null))]
  const namedGroups = allGroups.filter(Boolean) as string[]
  const hasPersonal = allGroups.includes(null)

  // Filter items by selected group
  const filteredItems = items.filter(item => {
    if (groupFilter === 'all') return true
    if (groupFilter === '__personal__') return !item.order?.group?.name
    return item.order?.group?.name === groupFilter
  })

  // Group filtered items by group name
  const grouped: Record<string, AddyItem[]> = {}
  for (const item of filteredItems) {
    const key = item.order?.group?.name || '__personal__'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(item)
  }
  const groupKeys = Object.keys(grouped).sort((a, b) => {
    if (a === '__personal__') return 1
    if (b === '__personal__') return -1
    return a.localeCompare(b)
  })

  return (
    <div className="flex flex-col h-full">
      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 w-9 h-9 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white"><X size={20}/></button>
          <img src={lightbox} alt="Full view" className="max-w-full max-h-[90vh] rounded-2xl object-contain shadow-2xl"/>
        </div>
      )}

      <PageHeader
        title="Addy"
        subtitle="Arrivals are logged automatically when order status changes"
        action={<Button variant="ghost" size="sm" onClick={fetchItems}><RefreshCw size={13}/> Refresh</Button>}
      />

      {/* Country tabs */}
      <div className="flex border-b border-border px-4 sm:px-6 overflow-x-auto flex-shrink-0">
        {COUNTRIES.map(c => (
          <button key={c} onClick={() => { setActiveCountry(c); setGroupFilter('all') }}
            className={`px-4 sm:px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition-all whitespace-nowrap ${activeCountry === c ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {COUNTRY_LABELS[c]}
          </button>
        ))}
      </div>

      {/* Group filter bar — only show if multiple groups */}
      {!loading && (namedGroups.length > 0) && (
        <div className="flex items-center gap-2 px-4 sm:px-6 py-3 border-b border-border overflow-x-auto flex-shrink-0">
          {(['all', ...namedGroups, ...(hasPersonal ? ['__personal__'] : [])] as string[]).map(g => (
            <button key={g} onClick={() => setGroupFilter(g)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-all whitespace-nowrap ${
                groupFilter === g
                  ? 'bg-primary text-white border-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
              }`}>
              {g === 'all' ? `All (${items.length})` : g === '__personal__' ? `Personal (${items.filter(i=>!i.order?.group?.name).length})` : `${g} (${items.filter(i=>i.order?.group?.name===g).length})`}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-6">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>
        ) : filteredItems.length === 0 ? (
          <EmptyState icon={MapPin} title="Nothing has arrived yet"
            description={`Orders set to ${COUNTRY_LABELS[activeCountry].split(' ')[1]} status will appear here.`}/>
        ) : groupKeys.map(groupKey => (
          <div key={groupKey} className="space-y-3">
            {/* Group header — only show if more than one group visible */}
            {(groupKeys.length > 1 || groupFilter === 'all') && (
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-widest">
                  {groupKey === '__personal__' ? '👤 Personal Orders' : `🎵 ${groupKey}`}
                </h3>
                <div className="flex-1 h-px bg-border"/>
                <span className="text-xs text-muted-foreground">{grouped[groupKey].length} order{grouped[groupKey].length !== 1 ? 's' : ''}</span>
              </div>
            )}

            {/* Items in this group */}
            {grouped[groupKey].map(item => {
              const draft = getDraft(item)
              const previewImg = (item.order as any)?.preview_image_url
              const arrivalSrc = draft.picture_url || item.picture_url || ''

              return (
                <Card key={item.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="font-display font-semibold">{orderLabel(item)}</p>
                        <div className="flex items-center gap-2 flex-wrap mt-1.5">
                          {item.order?.status && <StatusBadge status={item.order.status as any}/>}
                          {item.arrived_at && <span className="text-xs text-muted-foreground">{formatDate(item.arrived_at)}</span>}
                        </div>
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0 flex-wrap">
                        {previewImg && (
                          <button onClick={() => setLightbox(previewImg)}
                            className="flex items-center gap-1 text-xs font-semibold text-primary border border-primary/25 bg-primary/5 hover:bg-primary/10 px-2.5 py-1.5 rounded-lg transition-all">
                            <Eye size={12}/> Preview
                          </button>
                        )}
                        {arrivalSrc && (
                          <button onClick={() => setLightbox(arrivalSrc)}
                            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground border border-border bg-secondary/50 hover:bg-secondary px-2.5 py-1.5 rounded-lg transition-all">
                            <Eye size={12}/> Arrival
                          </button>
                        )}
                        <label className="flex items-center gap-1 text-xs font-semibold text-muted-foreground border border-border bg-secondary/50 hover:bg-secondary hover:text-primary px-2.5 py-1.5 rounded-lg transition-all cursor-pointer">
                          <Camera size={12}/> {arrivalSrc ? 'Replace' : '+ Photo'}
                          <input type="file" accept="image/*" className="hidden"
                            onClick={() => { filePickerOpen.current = true }}
                            onChange={e => { const f = e.target.files?.[0]; if (f) handlePhoto(item, f); e.target.value = '' }}
                          />
                        </label>
                        {arrivalSrc && draft.picture_url && (
                          <button onClick={() => setDraft(item.id, { picture_url: '' })}
                            className="flex items-center gap-1 text-xs font-semibold text-destructive/70 border border-destructive/20 bg-destructive/5 hover:bg-destructive/10 px-2.5 py-1.5 rounded-lg transition-all">
                            <X size={12}/> Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3">


                    {/* Notes */}
                    <textarea
                      className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/25 min-h-[72px]"
                      placeholder="Add notes about this arrival…"
                      value={draft.notes}
                      onChange={e => setDraft(item.id, { notes: e.target.value })}
                    />

                    {/* Save button */}
                    {draft.dirty && (
                      <Button onClick={() => saveItem(item)} disabled={saving === item.id} size="sm" className="w-full">
                        {saving === item.id
                          ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin mr-1.5"/> Saving…</>
                          : <><Save size={13}/> Save changes</>}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
