'use client'
import { useEffect, useState, useCallback } from 'react'
import { Input } from '@/components/ui'

export interface WeightVariant { id: string; item_type: string; group_id: string | null; label: string; weight_g: number | null }

// Lets a GOM pick which named weight profile something uses (e.g. a pricing option's "Album" ->
// "Ver A" vs "Ver B" for a comeback with lighter/heavier versions, or a PC Sorter pack/item ->
// the exact same "Ver A"), or create a new one inline. The list is scoped to the given item TYPE
// plus GROUP (izna's "Ver A" is a different row from Heart Of Woman's "Ver A") — group-less
// contexts (personal orders, ungrouped sessions) only see/create global variants. The actual gram
// weight is intentionally optional here: a GOM naming a version before it's arrived can leave it
// blank and fill it in later from the Boxes page, once the physical item has been weighed — every
// box (and, via this same shared library, every PC Sorter pack/item) using that variant then picks
// it up automatically. Shared between Orders (pricing options) and PC Sorter (packs/items) so a
// version name typed once shows up everywhere it's relevant instead of being retyped per feature.
//
// `required` controls only the cosmetic "Required" hint shown when nothing is picked — Orders
// pricing options need a variant to compute weight, so they pass true; PC Sorter packs/items are
// purely a naming convenience and work fine with no variant linked, so they pass false (default).
export function WeightVariantPicker({ itemType, groupId, value, onChange, required = true, placeholder }: {
  itemType: string; groupId: string | null; value: string
  // Second arg is the full variant (label, weight_g, ...) whenever one was just picked or
  // created, so a caller that wants to mirror the label somewhere (e.g. auto-filling a PC
  // Sorter pack/item's name) doesn't need its own separate fetch — omitted (undefined) when
  // the selection is cleared back to "".
  onChange: (id: string, variant?: WeightVariant) => void
  required?: boolean
  placeholder?: string
}) {
  const [variants, setVariants] = useState<WeightVariant[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const qs = new URLSearchParams({ item_type: itemType })
    if (groupId) qs.set('group_id', groupId)
    const res = await fetch(`/api/weight-variants?${qs.toString()}`).then(r => r.ok ? r.json() : []).catch(() => [])
    setVariants(Array.isArray(res) ? res : [])
    setLoading(false)
  }, [itemType, groupId])

  useEffect(() => { load() }, [load])

  // If the currently-selected variant doesn't belong to this type/group list (e.g. the GOM just
  // switched the Type dropdown), clear the stale selection so it can't silently keep pointing at
  // a variant from a different category.
  useEffect(() => {
    if (value && !loading && variants.length > 0 && !variants.some(v => v.id === value)) onChange('')
  }, [variants, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  async function createVariant() {
    if (!newLabel.trim() || saving) return
    setSaving(true)
    const res = await fetch('/api/weight-variants', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_type: itemType, group_id: groupId || null, label: newLabel.trim() }),
    }).then(r => r.ok ? r.json() : null).catch(() => null)
    setSaving(false)
    if (res?.id) {
      setNewLabel(''); setCreating(false)
      await load()
      onChange(res.id, res)
    }
  }

  if (creating) {
    return (
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus placeholder="e.g. Ver A, Lightstick…" value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') createVariant(); if (e.key === 'Escape') setCreating(false) }}
          className="py-1.5 text-xs max-w-[170px]"
        />
        <button onClick={createVariant} disabled={saving || !newLabel.trim()} className="text-xs font-semibold text-primary hover:underline disabled:opacity-40">Save</button>
        <button onClick={() => { setCreating(false); setNewLabel('') }} className="text-xs text-muted-foreground hover:underline">Cancel</button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={value || ''}
        onChange={e => {
          if (e.target.value === '__new__') setCreating(true)
          else onChange(e.target.value, variants.find(v => v.id === e.target.value))
        }}
        className="px-2.5 py-1.5 rounded-lg border border-input bg-background text-xs max-w-[190px] focus:outline-none focus:ring-2 focus:ring-primary/25"
      >
        <option value="">{loading ? 'Loading…' : (placeholder || 'Weight variant…')}</option>
        {variants.map(v => (
          <option key={v.id} value={v.id}>{v.label}{v.weight_g != null ? ` — ${v.weight_g}g` : ' (unweighed)'}</option>
        ))}
        <option value="__new__">+ Create new…</option>
      </select>
      {required && !value && <span className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide">Required</span>}
    </div>
  )
}
