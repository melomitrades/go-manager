'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus, ShoppingBag, Search, X, Pencil, Trash2 } from 'lucide-react'
import {
  Button, Badge, Card, Table, Th, Td, Tr,
  Modal, Input, Select, FormField, Checkbox,
  PageHeader, EmptyState, StatusBadge
} from '@/components/ui'
import { formatDate } from '@/lib/utils'
import { OrderDetail } from '@/components/shared/OrderDetail'
import { PackSummary } from '@/components/shared/PackMark'
import { WeightVariantPicker } from '@/components/shared/WeightVariantPicker'
import { GomPaidPrompt, type PromptOrder } from '@/components/shared/GomPaidModal'
import type { Order, Shop, Group, Member, Profile, OrderStatus, OrderType } from '@/types'
import { ORDER_STATUS_LABELS } from '@/types'

const STATUS_OPTIONS = Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => ({ value, label }))

const ITEM_TYPES = [
  { value: 'photocard', label: '🃏 Photocard' },
  { value: 'album', label: '💿 Album' },
  { value: 'photobook', label: '📖 Photobook' },
  { value: 'custom', label: '✏️ Custom' },
]

interface PricingOption {
  id: string; label: string; price_eur: string; price_krw: string; weight_category: string; weight_g: string; entries: string
  // Which named weight profile (e.g. "Ver A", "Lightstick") this pricing option's weight comes
  // from — see WeightVariantPicker below. '' means none picked yet.
  weight_variant_id?: string
}

interface ItemLine {
  id: string; member_ids: string[]; qty: number; description: string; pricing_option_id: string; inclusions_count: number
}
interface JoinerRow {
  joiner_id: string; items: ItemLine[]
}

function uid() { return Math.random().toString(36).slice(2) }
function newItemLine(pid: string, description = ''): ItemLine {
  return { id: uid(), member_ids: [], qty: 1, description, pricing_option_id: pid, inclusions_count: 0 }
}

export default function GomOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [shops, setShops] = useState<Shop[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [joiners, setJoiners] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [showArchive, setShowArchive] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterShop, setFilterShop] = useState('')
  const [filterGroup, setFilterGroup] = useState('')
  const [filterType, setFilterType] = useState('')
  const [search, setSearch] = useState('')
  const [orderType, setOrderType] = useState<OrderType>('group')
  const [form, setForm] = useState({ shop_id:'', group_id:'', round_number:'', is_fancall:false, is_vce_fansign:false, status:'to_be_ordered' as OrderStatus, notes:'', deadline:'', ordered_at:'', preview_image_url:'', hide_leftovers:false, payment_info:'', is_multi_version:false, albums_bought:'', era_id:'', exclude_from_semi_fixed:false })
  const [albumsPerVersion, setAlbumsPerVersion] = useState<Record<string, string>>({})
  // Which era album version each part of the order buys, saved as orders.era_version_map:
  // { section: era_version_id } — section = version name (multi-version), 'vce' / 'fansign', or '__all__'
  const [versionLinks, setVersionLinks] = useState<Record<string, string>>({})
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)
  const [pricingOptions, setPricingOptions] = useState<PricingOption[]>([{ id: uid(), label:'', price_eur:'0', price_krw:'', weight_category:'photocard', weight_g:'1', entries:'' }])
  const [versionSections, setVersionSections] = useState<{id:string;name:string;options:PricingOption[]}[]>([])
  const [vceOptions, setVceOptions] = useState<PricingOption[]>([{ id: uid(), label:'', price_eur:'0', price_krw:'', weight_category:'photocard', weight_g:'1', entries:'' }])
  const [fansignOptions, setFansignOptions] = useState<PricingOption[]>([{ id: uid(), label:'', price_eur:'0', price_krw:'', weight_category:'photocard', weight_g:'1', entries:'' }])
  const [joinerRows, setJoinerRows] = useState<JoinerRow[]>([])
  const [saving, setSaving] = useState(false)
  const [joinerSearch, setJoinerSearch] = useState<Record<number,string>>({})
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  // Eras (per group) and active semi-fixed spots — semi-fixed joiners are auto-added like fixed ones
  const [eras, setEras] = useState<any[]>([])
  const [semiSpots, setSemiSpots] = useState<any[]>([])
  // Multi-select for bulk status changes, and the "amount paid" prompt shown when orders become Ordered
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkStatus, setBulkStatus] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [paidPrompt, setPaidPrompt] = useState<PromptOrder[]>([])
  const [toast, setToast] = useState('')

  // silent = refresh in the background without the full-page spinner
  const fetchData = useCallback(async (silent: boolean = false) => {
    if (!silent) setLoading(true)
    const [ordersRes, shopsRes, groupsRes, joinersRes, erasRes, spotsRes] = await Promise.all([
      fetch('/api/orders').then(r => r.json()),
      fetch('/api/shops').then(r => r.json()),
      fetch('/api/groups').then(r => r.json()),
      fetch('/api/users').then(r => r.json()),
      fetch('/api/eras').then(r => r.json()).catch(() => []),
      fetch('/api/semi-fixed').then(r => r.json()).catch(() => []),
    ])
    setEras(Array.isArray(erasRes) ? erasRes : [])
    setSemiSpots(Array.isArray(spotsRes) ? spotsRes : [])
    const STATUS_ORDER = ['to_be_ordered','ordered','at_k_addy','otw_to_gom','at_gom','at_c_addy','at_j_addy','otw_to_joiners','delivered','closed']
    const raw = Array.isArray(ordersRes) ? ordersRes : []
    const sorted = [...raw].sort((a: any,b: any) => (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)) || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
    setOrders(sorted)
    setShops(Array.isArray(shopsRes) ? shopsRes : [])
    setGroups(Array.isArray(groupsRes) ? groupsRes : [])
    setJoiners(Array.isArray(joinersRes) ? joinersRes : [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t) }, [toast])

  function promptLabel(o: any): PromptOrder {
    const who = o.type === 'personal'
      ? (() => { const j = joiners.find(jj => jj.id === o.personal_joiner_id); return j ? `→ ${j.display_name || j.username}` : 'Personal' })()
      : (o.group?.name || null)
    return { id: o.id, label: [o.shop?.name || 'No shop', o.round_number ? (/^\d+$/.test(String(o.round_number)) ? `R${o.round_number}` : String(o.round_number)) : null].filter(Boolean).join(' · '), sublabel: [who, o.era_name].filter(Boolean).join(' · '), already_eur: o.gom_paid_eur != null ? parseFloat(o.gom_paid_eur) : null }
  }

  // Change the status of one or several orders in place — no reload. Orders that just became
  // "Ordered" and have no amount paid yet open the amount prompt.
  async function changeStatus(ids: string[], status: string) {
    if (!ids.length || !status) return
    const before = new Map(orders.map(o => [o.id, o]))
    setOrders(prev => prev.map(o => ids.includes(o.id) ? { ...o, status: status as OrderStatus } : o))
    const res = await fetch('/api/orders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids.length === 1 ? { id: ids[0], status } : { ids, status }) }).catch(() => null)
    if (!res || !res.ok) {
      setOrders(prev => prev.map(o => before.has(o.id) && ids.includes(o.id) ? before.get(o.id)! : o))
      setToast('Could not change the status — nothing was saved')
      return
    }
    const data = await res.json().catch(() => null)
    const updated: any[] = ids.length === 1 ? (data ? [data] : []) : (data?.updated || [])
    if (updated.length) {
      const byId = new Map(updated.map(u => [u.id, u]))
      setOrders(prev => prev.map(o => byId.has(o.id) ? { ...o, status: byId.get(o.id).status, ordered_at: byId.get(o.id).ordered_at ?? o.ordered_at, addy_country: byId.get(o.id).addy_country } : o))
    }
    if (ids.length > 1) setToast(`${ids.length} orders set to ${ORDER_STATUS_LABELS[status as OrderStatus] || status}`)
    if (status === 'ordered') {
      const need = ids.map(id => before.get(id)).filter((o: any) => o && !o.gom_payments_legacy && o.status !== 'ordered' && !(o.gom_paid_lines > 0))
      if (need.length) setPaidPrompt(need.map(promptLabel))
    }
  }

  async function applyBulk() {
    const ids = filteredOrders.filter(o => selected.has(o.id)).map(o => o.id)
    if (!ids.length || !bulkStatus) return
    setBulkBusy(true)
    await changeStatus(ids, bulkStatus)
    setBulkBusy(false); setSelected(new Set()); setBulkStatus('')
  }
  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  // Legacy orders (already Ordered when the new payments went live) are never tracked
  const missingPaid = (o: any) => !o.gom_payments_legacy && o.status !== 'to_be_ordered' && !(o.gom_paid_lines > 0)

  // Joiners auto-added to a new order: the group's fixed joiners + everyone holding an active
  // semi-fixed spot in the chosen era. Someone who's both gets one row with both member sets.
  function buildAutoRows(g: Group | null, eraId: string): JoinerRow[] {
    if (!g) return []
    const byJoiner = new Map<string, string[]>()
    const add = (joinerId: string, memberIds: string[]) => {
      const prev = byJoiner.get(joinerId) || []
      byJoiner.set(joinerId, Array.from(new Set([...prev, ...memberIds])))
    }
    try {
      const fixed: { joiner_id: string; member_ids?: string[]; member_id?: string }[] = JSON.parse((g as any).fixed_joiners || '[]')
      for (const f of fixed) add(f.joiner_id, f.member_ids || (f.member_id ? [f.member_id] : []))
    } catch {}
    if (eraId) for (const s of semiSpots) if (s.era_id === eraId && s.status === 'active') add(s.joiner_id, s.member_ids || [])
    return Array.from(byJoiner.entries()).map(([joiner_id, memberIds]) => {
      const qty = memberIds.length || 1
      if (form.is_multi_version && versionSections.length > 0) {
        return { joiner_id, items: versionSections.map(v => ({ ...newItemLine(v.options[0]?.id || ''), member_ids: memberIds, qty })) }
      } else if (form.is_vce_fansign) {
        return { joiner_id, items: [
          { ...newItemLine(vceOptions[0]?.id || ''), member_ids: memberIds, qty },
          { ...newItemLine(fansignOptions[0]?.id || ''), member_ids: memberIds, qty },
        ] }
      }
      return { joiner_id, items: [{ ...newItemLine(pricingOptions[0]?.id || ''), member_ids: memberIds, qty }] }
    })
  }

  function handleGroupSelect(groupId: string) {
    const g = groups.find(gr => gr.id === groupId) || null
    // Default to the group's current (active) era
    const activeEra = eras.find(e => String(e.group_id) === String(groupId) && e.status === 'active')
    const eraId = activeEra?.id || ''
    setForm(f => ({ ...f, group_id: groupId, era_id: eraId }))
    setSelectedGroup(g)
    if (!editingOrder) setJoinerRows(buildAutoRows(g, eraId))
  }

  function handleEraSelect(eraId: string) {
    setForm(f => ({ ...f, era_id: eraId }))
    setVersionLinks({})
    // On a new order, switching era swaps in that era's semi-fixed joiners
    if (!editingOrder) setJoinerRows(buildAutoRows(selectedGroup, eraId))
  }

  // Era album versions of the era picked in the form
  const formEraVersions: any[] = (eras.find(e => e.id === form.era_id)?.versions) || []
  const linkSelect = (key: string, className = '') => formEraVersions.length === 0 ? null : (
    <select value={versionLinks[key] || ''} title="Era album version"
      onChange={e => { const v = e.target.value; setVersionLinks(prev => { const n = { ...prev }; if (v) n[key] = v; else delete n[key]; return n }) }}
      className={`text-xs border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary/30 ${className}`}>
      <option value="">{key === '__all__' ? 'Album version…' : 'Era version (match by name)'}</option>
      {formEraVersions.map(v => <option key={v.id} value={v.id}>💿 {v.name}</option>)}
      <option value="none">Not one of the era versions</option>
    </select>
  )
  // Add a multi-version section for an era version (named after it, linked, its weight profile
  // put on the section's album options that don't have one yet)
  function newSectionFromEraVersion(v: any) {
    return { id: uid(), name: v.name, options: [{ id: uid(), label: '', price_eur: '0', price_krw: '', weight_category: 'photocard', weight_g: '1', entries: '' }] as PricingOption[] }
  }
  function addEraVersionSection(v: any) {
    setVersionSections(prev => [...prev, newSectionFromEraVersion(v)])
    setVersionLinks(prev => ({ ...prev, [v.name]: v.id }))
  }
  function linkSectionToEraVersion(vi: number, versionId: string) {
    const cur = versionSections[vi]; if (!cur) return
    const v = formEraVersions.find(x => x.id === versionId)
    const newName = v ? v.name : cur.name
    setVersionLinks(links => { const n = { ...links }; delete n[cur.name]; if (versionId) n[newName] = versionId; return n })
    setAlbumsPerVersion(ap => { if (!(cur.name in ap) || cur.name === newName) return ap; const n: Record<string, string> = { ...ap, [newName]: ap[cur.name] }; delete n[cur.name]; return n })
    setVersionSections(prev => prev.map((sec, i) => i !== vi ? sec : {
      ...sec, name: newName,
      options: v?.weight_variant_id ? sec.options.map(o => o.weight_category === 'album' && !o.weight_variant_id ? { ...o, weight_variant_id: v.weight_variant_id } : o) : sec.options,
    }))
  }

  function openNew() {
    setEditingOrder(null)
    setOrderType('group')
    setForm({ shop_id:'', group_id:'', round_number:'', is_fancall:false, is_vce_fansign:false, status:'to_be_ordered', notes:'', deadline:'', ordered_at:'', preview_image_url:'', hide_leftovers:false, payment_info:'', is_multi_version:false, albums_bought:'', era_id:'', exclude_from_semi_fixed:false }); setAlbumsPerVersion({}); setVersionLinks({})
    setSelectedGroup(null)
    setPricingOptions([{ id: uid(), label:'', price_eur:'0', price_krw:'', weight_category:'photocard', weight_g:'1', entries:'' }])
    setVceOptions([{ id: uid(), label:'', price_eur:'0', price_krw:'', weight_category:'photocard', weight_g:'1', entries:'' }])
    setFansignOptions([{ id: uid(), label:'', price_eur:'0', price_krw:'', weight_category:'photocard', weight_g:'1', entries:'' }])
    setVersionSections([])
    setJoinerRows([])
    setModalOpen(true)
  }

  async function openEdit(order: Order) {
    setEditingOrder(order)
    setOrderType(order.type)
    // The orders list no longer sends preview_image_url (it's stripped server-side to keep the
    // list payload small — see /api/orders). If this order actually has one, has_preview_image
    // tells us so, and we fetch the single order to get the real base64 value only when the edit
    // form is actually opened, instead of every order in the list carrying its full image.
    let previewImageUrl = (order as any).preview_image_url || ''
    if (!previewImageUrl && (order as any).has_preview_image) {
      try {
        const fresh = await fetch(`/api/orders/${order.id}`).then(r => r.json())
        previewImageUrl = fresh?.order?.preview_image_url || ''
      } catch {}
    }
    setForm({
      shop_id: order.shop_id || '',
      group_id: order.type === 'personal' ? ((order as any).personal_joiner_id || '') : (order.group_id || ''),
      round_number: order.round_number ? String(order.round_number) : '',
      is_fancall: order.is_fancall,
      status: order.status,
      notes: order.notes || '',
      deadline: order.deadline?.slice(0, 16) || '',
      ordered_at: order.ordered_at?.slice(0, 16) || '',
      preview_image_url: previewImageUrl,
      hide_leftovers: (order as any).hide_leftovers || false,
      is_vce_fansign: !!(order as any).is_vce_fansign,
      is_multi_version: !!(order as any).is_multi_version,
      payment_info: (order as any).payment_info || '',
      albums_bought: (order as any).albums_bought != null && typeof (order as any).albums_bought !== 'object' ? String((order as any).albums_bought) : '',
      era_id: (order as any).era_id || '',
      exclude_from_semi_fixed: !!(order as any).exclude_from_semi_fixed,
    })
    setVersionLinks((() => { try { const m = (order as any).era_version_map; const o = typeof m === 'string' ? JSON.parse(m) : m; return o && typeof o === 'object' ? o : {} } catch { return {} } })())
    // If albums_bought is a per-version object, restore it
    if ((order as any).albums_bought && typeof (order as any).albums_bought === 'object') {
      setAlbumsPerVersion(Object.fromEntries(Object.entries((order as any).albums_bought).map(([k,v]) => [k, String(v)])))
    } else {
      setAlbumsPerVersion({})
    }
    // Set selected group
    const g = groups.find(gr => gr.id === order.group_id) || null
    setSelectedGroup(g)

    // Rebuild pricing options + joiner rows from existing items
    // Leftover rows from lost claims (lost_claim_id set) aren't anyone's claim anymore — they're
    // managed from the Leftovers page and preserved server-side on save, so keep them out of the
    // editable joiner rows entirely.
    const existingItems: any[] = ((order as any).items || []).filter((it: any) => !it.lost_claim_id)
    if (existingItems.length > 0) {

      // ── For multi-version: restore version sections first, then build optMap from those ──
      let resolvedVersionSections: {id:string;name:string;options:PricingOption[]}[] = []
      if ((order as any).is_multi_version) {
        const storedOpts = (() => { try { const vo = (order as any).version_options; return Array.isArray(vo) ? vo : (vo ? JSON.parse(vo) : null) } catch { return null } })()
        if (storedOpts && storedOpts.length > 0) {
          resolvedVersionSections = storedOpts.map((v: any) => ({
            id: uid(), name: v.name,
            options: (v.options || []).map((o: any) => ({ ...o, id: o.id || uid() }))
          }))
        } else {
          const vnames: string[] = (() => { try { const vn = (order as any).version_names; return Array.isArray(vn) ? vn : JSON.parse(vn || '[]') } catch { return [] } })()
          resolvedVersionSections = vnames.length > 0
            ? vnames.map((name: string) => ({ id: uid(), name, options: [{ id: uid(), label: '', price_eur: '0', price_krw: '', weight_category: 'photocard', weight_g: '1', entries: '' }] }))
            : [{ id: uid(), name: 'Version A', options: [{ id: uid(), label: '', price_eur: '0', price_krw: '', weight_category: 'photocard', weight_g: '1', entries: '' }] }]
        }
        setVersionSections(resolvedVersionSections)
      }

      // ── Build optMap: for multi-version use version section options (same IDs!); else from items ──
      const optMap: Record<string, PricingOption> = {}
      if ((order as any).is_multi_version && resolvedVersionSections.length > 0) {
        // Use the version section options directly — these have the IDs the dropdown will show
        for (const ver of resolvedVersionSections) {
          for (const opt of ver.options) {
            const key = `${opt.label || ''}__${opt.price_eur ?? ''}__${opt.weight_category || 'photocard'}`
            if (!optMap[key]) optMap[key] = opt
          }
        }
        // Also map by description+price_eur from items → version opt (for row building below)
        // Build a lookup: description+price → opt.id from version sections
      } else {
        // Standard: extract unique pricing options from items
        for (const item of existingItems) {
          const key = `${item.description || ''}__${item.price_eur ?? ''}__${item.item_type || 'photocard'}`
          if (!optMap[key]) {
            optMap[key] = {
              id: uid(),
              label: item.description || '',
              price_eur: item.price_eur ? String(item.price_eur) : '0',
              price_krw: item.price_krw ? String(item.price_krw) : '',
              entries: item.entries_count ? String(item.entries_count) : '',
              weight_category: item.item_type || 'photocard',
              weight_g: String(item.weight_g != null && item.weight_g !== '' ? item.weight_g : ((!item.item_type || item.item_type === 'photocard') ? '1' : '')),
              weight_variant_id: item.weight_variant_id || '',
            }
          }
        }
      }

      // Build all opts list — for version sections this is the flat list across all versions
      const opts: PricingOption[] = (order as any).is_multi_version && resolvedVersionSections.length > 0
        ? resolvedVersionSections.flatMap(v => v.options)
        : Object.values(optMap)
      if (opts.length === 0) opts.push({ id: uid(), label:'', price_eur:'0', price_krw:'', weight_category:'photocard', weight_g:'1', entries:'' })
      setPricingOptions(opts)

      // If vce/fansign order, split opts by label keyword
      if ((order as any).is_vce_fansign) {
        setVceOptions(opts.filter(o => /vce/i.test(o.label)).length > 0 ? opts.filter(o => /vce/i.test(o.label)) : [{ id:uid(), label:'', price_eur:'0', price_krw:'', weight_category:'photocard', weight_g:'1', entries:'' }])
        setFansignOptions(opts.filter(o => /fansign/i.test(o.label)).length > 0 ? opts.filter(o => /fansign/i.test(o.label)) : [{ id:uid(), label:'', price_eur:'0', price_krw:'', weight_category:'photocard', weight_g:'1', entries:'' }])
      }

      // Group items by joiner, then by pricing option (description+price) within each joiner
      const byJoiner: Record<string, any[]> = {}
      for (const item of existingItems) {
        const jid = item.joiner_id || '__none__'
        if (!byJoiner[jid]) byJoiner[jid] = []
        byJoiner[jid].push(item)
      }

      const rows: JoinerRow[] = Object.entries(byJoiner).map(([jid, items]) => {
        // Within this joiner's items, group by version_name+description+price into one ItemLine each
        const lineMap: Record<string, ItemLine> = {}
        for (const item of items) {
          // Include version_name in key so same-label items from different versions stay separate
          const key = `${item.version_name || ''}__${item.description || ''}__${item.price_eur ?? ''}`
          const optId = (() => {
            // For multi-version: match strictly by version_name first, then description+price
            if ((order as any).is_multi_version && resolvedVersionSections.length > 0) {
              const vn = item.version_name
              const ver = vn ? resolvedVersionSections.find(v => v.name === vn) : null
              const priceMatch = (o: PricingOption) => Math.abs(parseFloat(o.price_eur||'0') - parseFloat(item.price_eur||'0')) < 0.001
              if (ver) {
                // Search within the correct version only
                return ver.options.find((o: PricingOption) => o.label === (item.description || '') && priceMatch(o))?.id
                  || ver.options.find((o: PricingOption) => o.label === (item.description || ''))?.id
                  || ver.options[0]?.id || ''
              }
              // No version_name on item — positional fallback
              const allOpts = resolvedVersionSections.flatMap(v => v.options)
              return allOpts.find((o: PricingOption) => o.label === (item.description || '') && priceMatch(o))?.id
                || allOpts[0]?.id || ''
            }
            // Standard: match by label+price (use parseFloat to handle '12' vs '12.00')
            const stdPriceMatch = (o: PricingOption) => Math.abs(parseFloat(o.price_eur||'0') - parseFloat(item.price_eur||'0')) < 0.001
            return opts.find(o => o.label === (item.description || '') && stdPriceMatch(o) && (o.weight_category === (item.item_type || 'photocard')))?.id
              || opts.find(o => o.label === (item.description || '') && stdPriceMatch(o))?.id
              || opts[0]?.id || ''
          })()
          if (!lineMap[key]) {
            lineMap[key] = {
              id: uid(),
              member_ids: [],
              qty: 0,
              description: item.description || '',
              pricing_option_id: optId,
              inclusions_count: item.inclusions_count || 0,
            }
          }
          // Accumulate members and qty
          if (item.member_id) {
            // Push once per amount_claimed so duplicate claims (e.g. 2x Koko) are preserved
            const times = item.amount_claimed || 1
            for (let n = 0; n < times; n++) lineMap[key].member_ids.push(item.member_id)
          }
          lineMap[key].qty += item.amount_claimed || 1
        }
        // If members were collected, use member count as qty
        const itemLines = Object.values(lineMap).map(line => ({
          ...line,
          qty: line.member_ids.length > 0 ? line.member_ids.length : line.qty,
        }))
        return {
          joiner_id: jid === '__none__' ? '' : jid,
          items: itemLines,
        }
      })
      setJoinerRows(rows)
    } else {
      setPricingOptions([{ id: uid(), label:'', price_eur:'0', price_krw:'', weight_category:'photocard', weight_g:'1', entries:'' }])
      setJoinerRows([])
    }
    setModalOpen(true)
  }

  // Pricing options
  function addPricingOption() { setPricingOptions(p => [...p, { id: uid(), label:'', price_eur:'0', price_krw:'', weight_category:'photocard', weight_g:'1', entries:'' }]) }
  function updatePricingOption(id: string, field: keyof PricingOption, value: string) { setPricingOptions(p => p.map(o => o.id === id ? { ...o, [field]: value } : o)) }
  function removePricingOption(id: string) {
    setPricingOptions(p => p.filter(o => o.id !== id))
    setJoinerRows(r => r.map(row => ({ ...row, items: row.items.map(it => it.pricing_option_id === id ? { ...it, pricing_option_id: '' } : it) })))
  }

  // Joiner rows
  function addJoinerRow() {
    if (form.is_multi_version && versionSections.length > 0) {
      setJoinerRows(r => [...r, {
        joiner_id: '',
        items: versionSections.map(v => newItemLine(v.options[0]?.id || '', v.options[0]?.label || ''))
      }])
    } else if (form.is_vce_fansign) {
      setJoinerRows(r => [...r, {
        joiner_id: '',
        items: [
          newItemLine(vceOptions[0]?.id || '', vceOptions[0]?.label || ''),
          newItemLine(fansignOptions[0]?.id || '', fansignOptions[0]?.label || ''),
        ]
      }])
    } else {
      setJoinerRows(r => [...r, { joiner_id:'', items:[newItemLine(pricingOptions[0]?.id||'')] }])
    }
  }
  function updateJoinerId(idx: number, id: string) { setJoinerRows(r => r.map((row,i) => i===idx ? {...row, joiner_id:id} : row)) }
  function removeJoinerRow(idx: number) { setJoinerRows(r => r.filter((_,i) => i!==idx)) }

  // Item lines
  function addItemLine(rowIdx: number) {
    setJoinerRows(r => r.map((row, i) => {
      if (i !== rowIdx) return row
      // In VCE/Fansign mode, alternate: if last item was VCE add fansign and vice versa
      let pid: string
      let desc = ''
      if (form.is_multi_version && versionSections.length > 0) {
        const lastItem = row.items[row.items.length - 1]
        const lastVerIdx = versionSections.findIndex(v => v.options.some(o => o.id === lastItem?.pricing_option_id))
        const nextVer = versionSections[(lastVerIdx + 1) % versionSections.length]
        pid = nextVer?.options[0]?.id || ''
        desc = nextVer?.options[0]?.label || ''
      } else if (form.is_vce_fansign) {
        const lastItem = row.items[row.items.length - 1]
        const lastIsVce = vceOptions.some(o => o.id === lastItem?.pricing_option_id)
        pid = lastIsVce ? (fansignOptions[0]?.id || '') : (vceOptions[0]?.id || '')
        desc = lastIsVce ? (fansignOptions[0]?.label || '') : (vceOptions[0]?.label || '')
      } else {
        pid = pricingOptions[0]?.id || ''
        desc = pricingOptions[0]?.label || ''
      }
      return { ...row, items: [...row.items, newItemLine(pid, desc)] }
    }))
  }
  function removeItemLine(rowIdx: number, itemId: string) { setJoinerRows(r => r.map((row,i) => i===rowIdx ? {...row, items:row.items.filter(it => it.id!==itemId)} : row)) }
  function updateItemLine(rowIdx: number, itemId: string, field: keyof ItemLine, value: any) {
    setJoinerRows(r => r.map((row,i) => {
      if (i!==rowIdx) return row
      return { ...row, items: row.items.map(item => {
        if (item.id!==itemId) return item
        const updated = {...item, [field]: value}
        if (field==='member_ids') updated.qty = (value as string[]).length || 1
        return updated
      })}
    }))
  }
  function toggleMember(rowIdx: number, itemId: string, memberId: string) {
    setJoinerRows(r => r.map((row,i) => {
      if (i!==rowIdx) return row
      return { ...row, items: row.items.map(item => {
        if (item.id!==itemId) return item
        const hasOne = item.member_ids.includes(memberId)
        // If not selected yet, add one. If already selected, add another (allows 2x claims).
        const newIds = [...item.member_ids, memberId]
        // Right-click / not present logic handled separately; default click always adds
        return hasOne ? { ...item, member_ids:newIds, qty:newIds.length } : { ...item, member_ids:newIds, qty:newIds.length }
      })}
    }))
  }
  // Removes a single instance of memberId (used by the "-" control on a pill with qty>1, or to deselect when qty===1)
  function decrementMember(rowIdx: number, itemId: string, memberId: string) {
    setJoinerRows(r => r.map((row,i) => {
      if (i!==rowIdx) return row
      return { ...row, items: row.items.map(item => {
        if (item.id!==itemId) return item
        const idx = item.member_ids.lastIndexOf(memberId)
        if (idx === -1) return item
        const newIds = [...item.member_ids.slice(0,idx), ...item.member_ids.slice(idx+1)]
        return { ...item, member_ids:newIds, qty:newIds.length||1 }
      })}
    }))
  }

  async function handleSave() {
    setSaving(true)
    const itemsPayload = ['group','personal'].includes(orderType) ? joinerRows.flatMap(row => {
      // For multi-version: build a map from option id → version name
      const versionByOptId: Record<string, string> = {}
      if (form.is_multi_version) { versionSections.forEach(v => v.options.forEach(o => { versionByOptId[o.id] = v.name })) }
      const allOpts = form.is_multi_version ? versionSections.flatMap(v=>v.options) : form.is_vce_fansign ? [...vceOptions, ...fansignOptions] : pricingOptions
      // For personal orders, the joiner is the linked joiner (form.group_id = personal_joiner_id)
      const rowJoinerId = orderType === 'personal' ? (form.group_id || null) : (row.joiner_id || null)
      return row.items.flatMap(item => {
        // Find the matching option; for multi-version use version_name to scope the search
        const opt = (() => {
          const byId = allOpts.find(o => o.id===item.pricing_option_id)
          if (byId) return byId
          if (form.is_multi_version && versionSections.length > 0) {
            // Fallback: find opt by version_name + description stored on item
            const vn = versionByOptId[item.pricing_option_id] || null
            const ver = vn ? versionSections.find(v => v.name === vn) : null
            const searchIn = ver ? ver.options : versionSections.flatMap(v => v.options)
            return searchIn.find(o => o.label === item.description) || searchIn[0] || null
          }
          return allOpts[0] || null
        })()
        // Use opt label (current price option name) when available — this ensures renames are saved
        const itemDescription = opt?.label || item.description || null
        const priceKrw = opt?.price_krw && opt.price_krw !== '' ? Math.round(parseFloat(opt.price_krw)) : null
        const entriesPerItem = opt?.entries && opt.entries !== '' ? parseInt(opt.entries) : 0
        const versionName = form.is_multi_version ? (versionByOptId[item.pricing_option_id] || null) : null
        const base = { joiner_id: rowJoinerId as string|null, pricing_type:'custom' as const, description:itemDescription, price_eur:opt?.price_eur?parseFloat(opt.price_eur):null, price_krw:priceKrw, entries_count:0, item_type:opt?.weight_category||'photocard', weight_g:opt?.weight_g?parseFloat(opt.weight_g):null, weight_variant_id:opt?.weight_variant_id||null, inclusions_count:item.inclusions_count||0, version_name:versionName, claim_group_id:item.id }
        // NOTE: "Inclusions" is entered ONCE per item line — it's the total this whole claim
        // represents, not a per-member value. When the line explodes into one order_items ROW
        // PER MEMBER PILL below, every resulting row intentionally carries the SAME
        // inclusions_count value (not divided/split) — this mirrors how the edit-modal loader
        // above (line ~274) reconstructs a line from saved rows: it reads inclusions_count from
        // only the first row of the group, not a sum. Any code that reads inclusions_count back
        // out across a group of rows (auto-fill, Order Detail, Boxes) MUST take it once per
        // group, never sum it — summing multiplies the entered total by the member-pill count.
        // claim_group_id (= this line's own client-side id) ties all of a line's exploded rows
        // together explicitly, so readers can dedupe reliably instead of guessing "same line"
        // from matching description+price+version, which breaks the moment two genuinely
        // separate claims happen to share the same pricing option.
        if (item.member_ids.length>0) return item.member_ids.map(mid => ({...base, member_id:mid, amount_claimed:1, entries_count:entriesPerItem}))
        return [{ ...base, member_id:null as string|null, amount_claimed:item.qty, entries_count:entriesPerItem*item.qty }]
      })
    }) : []

    const body = {
      type:orderType, shop_id:form.shop_id||null,
      group_id:orderType==='group'?(form.group_id||null):null,
      joiner_id:orderType==='personal'?(form.group_id||null):null,
      round_number:form.round_number||null,
      era_id: orderType==='group' ? (form.era_id||null) : null,
      exclude_from_semi_fixed: form.exclude_from_semi_fixed,
      is_fancall:form.is_fancall, is_vce_fansign:form.is_vce_fansign, is_multi_version:form.is_multi_version, version_names: form.is_multi_version ? versionSections.map(v=>v.name) : null, version_options: form.is_multi_version ? versionSections.map(v=>({name:v.name, options:v.options})) : null, status:form.status, notes:form.notes||null,
      deadline: form.deadline || null,
      ordered_at: form.ordered_at || null,
      preview_image_url: form.preview_image_url || null,
      hide_leftovers: form.hide_leftovers,
      payment_info: form.payment_info || null,
      albums_bought: (() => {
        if (form.is_multi_version && versionSections.length > 0) {
          const obj: Record<string, number> = {}
          for (const v of versionSections) { if (albumsPerVersion[v.name]) obj[v.name] = parseInt(albumsPerVersion[v.name]) }
          return Object.keys(obj).length > 0 ? obj : null
        }
        if (form.is_vce_fansign) {
          const obj: Record<string, number> = {}
          if (albumsPerVersion['vce']) obj['vce'] = parseInt(albumsPerVersion['vce'])
          if (albumsPerVersion['fansign']) obj['fansign'] = parseInt(albumsPerVersion['fansign'])
          return Object.keys(obj).length > 0 ? obj : null
        }
        return form.albums_bought ? parseInt(form.albums_bought) : null
      })(),
      items:itemsPayload,
      // Only the sections this order actually has, and only for an era order
      era_version_map: (() => {
        if (orderType !== 'group' || !form.era_id) return null
        const keys = form.is_multi_version ? versionSections.map(v => v.name) : form.is_vce_fansign ? ['vce', 'fansign'] : ['__all__']
        const m: Record<string, string> = {}
        for (const k of keys) if (versionLinks[k]) m[k] = versionLinks[k]
        return Object.keys(m).length ? m : null
      })(),
    }

    let saved: any = null
    if (editingOrder) {
      saved = await fetch('/api/orders', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({...body, id:editingOrder.id}) }).then(r => r.ok ? r.json() : null).catch(() => null)
    } else {
      saved = await fetch('/api/orders', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }).then(r => r.ok ? r.json() : null).catch(() => null)
    }
    // Became "Ordered" with this save → ask for the amount paid (unless already entered)
    const wasOrdered = editingOrder?.status === 'ordered'
    const hasPaid = ((editingOrder as any)?.gom_paid_lines || 0) > 0
    if (saved?.id && form.status === 'ordered' && !wasOrdered && !hasPaid && !saved.gom_payments_legacy) {
      setPaidPrompt([promptLabel({ ...saved, shop: shops.find(sh => sh.id === saved.shop_id), group: groups.find(g => g.id === saved.group_id), era_name: eras.find(e => e.id === saved.era_id)?.name, gom_paid_eur: (editingOrder as any)?.gom_paid_eur })])
    }

    resetModal(); fetchData(true); setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this order and all its items?')) return
    setOrders(prev => prev.filter(o => o.id !== id))
    await fetch('/api/orders', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) })
    fetchData(true)
  }

  function resetModal() {
    setModalOpen(false); setEditingOrder(null); setOrderType('group')
    setForm({ shop_id:'', group_id:'', round_number:'', is_fancall:false, is_vce_fansign:false, status:'to_be_ordered', notes:'', deadline:'', ordered_at:'', preview_image_url:'', hide_leftovers:false, payment_info:'', is_multi_version:false, albums_bought:'', era_id:'', exclude_from_semi_fixed:false }); setAlbumsPerVersion({}); setVersionLinks({})
    setSelectedGroup(null); setPricingOptions([{ id:uid(), label:'', price_eur:'0', price_krw:'', weight_category:'photocard', weight_g:'1', entries:'' }]); setJoinerRows([])
  }

  const archivedOrders = orders.filter(o => o.status === 'closed')
  const activeOrders = orders.filter(o => o.status !== 'closed')
  const filteredOrders = showArchive ? archivedOrders : activeOrders.filter(o => {
    if (filterStatus && o.status!==filterStatus) return false
    if (filterShop && o.shop_id!==filterShop) return false
    if (filterGroup && (o as any).group_id!==filterGroup) return false
    if (filterType === 'group' && (o as any).type !== 'group') return false
    if (filterType === 'personal' && (o as any).type !== 'personal') return false
    if (search) { const q=search.toLowerCase(); if (!o.shop?.name?.toLowerCase().includes(q) && !(o.group as any)?.name?.toLowerCase().includes(q)) return false }
    return true
  })

  const members: Member[] = (selectedGroup?.members||[]) as Member[]

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="All Orders" subtitle={`${orders.length} orders`} action={<Button onClick={openNew}><Plus size={14}/> New Order</Button>}/>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border bg-background">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"/>
          <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search shop, group…" className="pl-9 py-2 text-xs"/>
        </div>
        <Select options={STATUS_OPTIONS} placeholder="All statuses" value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} className="w-44 py-2 text-xs"/>
        <Select options={shops.map(s=>({value:s.id,label:s.name}))} placeholder="All shops" value={filterShop} onChange={e=>setFilterShop(e.target.value)} className="w-40 py-2 text-xs"/>
        <Select options={groups.map(g=>({value:g.id,label:g.name}))} placeholder="All groups" value={filterGroup} onChange={e=>setFilterGroup(e.target.value)} className="w-36 py-2 text-xs"/>
        <Select options={[{value:'group',label:'Group orders'},{value:'personal',label:'Personal orders'}]} placeholder="All types" value={filterType} onChange={e=>setFilterType(e.target.value)} className="w-40 py-2 text-xs"/>
        {(filterStatus||filterShop||filterGroup||filterType||search) && <Button variant="ghost" size="sm" onClick={()=>{setFilterStatus('');setFilterShop('');setFilterGroup('');setFilterType('');setSearch('')}}>Clear</Button>}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {loading ? <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>
        : filteredOrders.length===0 ? <EmptyState icon={ShoppingBag} title="No orders yet" action={<Button onClick={openNew}><Plus size={14}/> New Order</Button>}/>
        : <>
          <div className="flex items-center justify-between mb-3">
            <div className="flex gap-2">
              <button onClick={()=>{setShowArchive(false);setSelected(new Set())}} className={`px-4 py-2 text-sm font-semibold rounded-xl border transition-all ${!showArchive?'bg-primary text-primary-foreground border-primary shadow-rose-sm':'bg-card text-muted-foreground border-border hover:border-primary/30'}`}>Active ({activeOrders.length})</button>
              <button onClick={()=>{setShowArchive(true);setSelected(new Set())}} className={`px-4 py-2 text-sm font-semibold rounded-xl border transition-all ${showArchive?'bg-primary text-primary-foreground border-primary shadow-rose-sm':'bg-card text-muted-foreground border-border hover:border-primary/30'}`}>Archive ({archivedOrders.length})</button>
            </div>
          </div>
        <div className="hidden sm:block"><Card><Table><thead><tr><Th className="w-10 pr-0"><input type="checkbox" aria-label="Select all" className="w-4 h-4 accent-primary cursor-pointer align-middle"
            checked={filteredOrders.length > 0 && filteredOrders.every(o => selected.has(o.id))}
            ref={el => { if (el) el.indeterminate = filteredOrders.some(o => selected.has(o.id)) && !filteredOrders.every(o => selected.has(o.id)) }}
            onChange={e => setSelected(e.target.checked ? new Set(filteredOrders.map(o => o.id)) : new Set())}/></Th><Th>Type</Th><Th>Shop</Th><Th>Group</Th><Th>Round</Th><Th>Status</Th><Th>Fancall</Th><Th>Deadline</Th><Th>Date</Th><Th></Th></tr></thead>
          <tbody>{filteredOrders.map(order => (
            <Tr key={order.id} onClick={() => setSelectedOrderId(order.id)} className={`cursor-pointer ${selected.has(order.id) ? 'bg-primary/[0.05]' : ''}`}>
              <Td className="w-10 pr-0" onClick={e => e.stopPropagation()}><input type="checkbox" aria-label="Select order" className="w-4 h-4 accent-primary cursor-pointer align-middle" checked={selected.has(order.id)} onChange={() => toggleSelect(order.id)}/></Td>
              <Td><Badge className="capitalize bg-secondary text-secondary-foreground">{order.type}</Badge></Td>
              <Td className="font-semibold">{order.shop?.name||'—'}{(order as any).pack_summary && <span className="block mt-1"><PackSummary summary={(order as any).pack_summary}/></span>}</Td>
              <Td className="text-muted-foreground">
                {order.type === 'personal'
                  ? (() => { const j = joiners.find(jj => jj.id === (order as any).personal_joiner_id); return j ? <span className="text-xs text-primary font-semibold">→ {j.display_name || j.username}</span> : '—' })()
                  : (order.group as any)?.name || '—'
                }
              </Td>
              <Td className="text-muted-foreground">{order.round_number||'—'}{(order as any).era_name && <span className="block text-[11px] text-muted-foreground/70">{(order as any).era_name}{(order as any).exclude_from_semi_fixed ? ' · not counted' : ''}</span>}</Td>
              <Td onClick={e => e.stopPropagation()}>
                <select value={order.status} onChange={e => changeStatus([order.id], e.target.value)} className="text-xs border border-border rounded-lg px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary/30 cursor-pointer">
                  {STATUS_OPTIONS.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                {missingPaid(order) && <button onClick={() => setPaidPrompt([promptLabel(order)])} title="Amount paid not entered yet" className="block mt-1 text-[11px] font-semibold text-amber-600 hover:underline">€ paid missing</button>}
              </Td>
              <Td>{order.is_fancall?<Badge className="bg-rose-50 text-rose-600 border border-rose-200 dark:bg-rose-900/20 dark:text-rose-300">Fancall</Badge>:<span className="text-muted-foreground/40 text-xs">—</span>}</Td>
              <Td className="text-xs text-muted-foreground">{order.deadline ? <span className={new Date(order.deadline) < new Date() ? 'text-destructive font-semibold' : ''}>{formatDate(order.deadline)}</span> : '—'}</Td>
              <Td className="text-xs text-muted-foreground">{formatDate(order.created_at)}</Td>
              <Td onClick={e => e.stopPropagation()}>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={()=>openEdit(order)}><Pencil size={13}/></Button>
                  <Button variant="ghost" size="icon" onClick={()=>handleDelete(order.id)}><Trash2 size={13} className="text-destructive/50 hover:text-destructive"/></Button>
                </div>
              </Td>
            </Tr>
          ))}</tbody></Table></Card></div>

          {/* Mobile card list */}
          <div className="sm:hidden space-y-3 px-4 py-4">
            {filteredOrders.map(order => (
              <div key={order.id} className={`bg-card border rounded-2xl overflow-hidden ${selected.has(order.id) ? 'border-primary ring-1 ring-primary/30' : 'border-border'}`}>
                <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3" onClick={() => setSelectedOrderId(order.id)}>
                  <input type="checkbox" aria-label="Select order" className="w-5 h-5 mt-0.5 accent-primary flex-shrink-0" checked={selected.has(order.id)} onClick={e => e.stopPropagation()} onChange={() => toggleSelect(order.id)}/>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">{order.type}</span>
                      {order.is_fancall && <span className="text-xs font-bold text-amber-600">⭐ Fancall</span>}
                    </div>
                    <p className="font-display font-semibold text-base leading-tight">{(order as any).shop?.name || '—'}{order.round_number ? ` · ${order.round_number}` : ''}</p>
                    {(order as any).group?.name && <p className="text-xs text-muted-foreground mt-0.5">{(order as any).group.name}</p>}
                    {(order as any).pack_summary && <div className="mt-1.5"><PackSummary summary={(order as any).pack_summary}/></div>}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <StatusBadge status={order.status}/>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={e=>{e.stopPropagation();openEdit(order)}}><Pencil size={13}/></Button>
                      <Button variant="ghost" size="icon" onClick={e=>{e.stopPropagation();handleDelete(order.id)}}><Trash2 size={13} className="text-destructive/50"/></Button>
                    </div>
                  </div>
                </div>
                {order.deadline && (
                  <div className="px-4 pb-3">
                    <p className={`text-xs font-medium ${new Date(order.deadline) < new Date() ? 'text-destructive' : 'text-muted-foreground'}`}>Due {formatDate(order.deadline)}</p>
                  </div>
                )}
                <div className="px-4 pb-3">
                  <select value={order.status} onChange={e => changeStatus([order.id], e.target.value)} onClick={e=>e.stopPropagation()} className="text-xs border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary/30 w-full">
                    {STATUS_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {missingPaid(order) && <button onClick={() => setPaidPrompt([promptLabel(order)])} className="mt-1.5 text-xs font-semibold text-amber-600">€ amount paid missing — enter it</button>}
                </div>
              </div>
            ))}
          </div>
        </>
        }
      </div>

      {/* Bulk action bar */}
      {filteredOrders.filter(o => selected.has(o.id)).length > 0 && (
        <div className="fixed md:sticky left-0 right-0 bottom-16 md:bottom-0 z-[45] border-t border-border bg-card/95 backdrop-blur-sm px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          <span className="text-sm font-semibold">{filteredOrders.filter(o => selected.has(o.id)).length} selected</span>
          <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} className="text-sm border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary/30">
            <option value="">Set status to…</option>
            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <Button size="sm" onClick={applyBulk} disabled={!bulkStatus || bulkBusy}>{bulkBusy ? 'Applying…' : 'Apply'}</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
        </div>
      )}

      <GomPaidPrompt open={paidPrompt.length > 0} orders={paidPrompt} onClose={() => setPaidPrompt([])}
        onSaved={ids => { setToast(ids.length > 1 ? `Amount paid saved for ${ids.length} orders` : 'Amount paid saved'); setOrders(prev => prev.map(o => ids.includes(o.id) ? { ...o, gom_paid_lines: ((o as any).gom_paid_lines || 0) + 1 } as any : o)); fetchData(true) }}/>

      {toast && <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] bg-foreground text-background text-sm font-medium px-4 py-2 rounded-xl shadow-lg">{toast}</div>}

      {/* Modal */}
      <Modal open={modalOpen} onClose={resetModal} title={editingOrder ? 'Edit Order' : 'New Order'} subtitle={editingOrder ? `Editing ${editingOrder.shop?.name || ''}` : undefined} size="xl">
        <div className="space-y-5">
          {/* Type toggle */}
          <div className="flex rounded-xl border border-border overflow-hidden">
            {(['group','personal'] as OrderType[]).map(t => (
              <button key={t} onClick={()=>setOrderType(t)} className={`flex-1 py-2.5 text-sm font-semibold transition-colors capitalize ${orderType===t?'bg-primary text-white':'hover:bg-secondary text-muted-foreground'}`}>{t} Order</button>
            ))}
          </div>

          {/* Shop + Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <FormField label="Shop" required><Select options={shops.map(s=>({value:s.id,label:s.name}))} placeholder="Select shop…" value={form.shop_id} onChange={e=>setForm(f=>({...f,shop_id:e.target.value}))}/></FormField>
            <FormField label="Status" required><Select options={STATUS_OPTIONS} value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value as OrderStatus}))}/></FormField>
          </div>

          {orderType==='group' && (<>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <FormField label="Group"><Select options={groups.map(g=>({value:g.id,label:g.name}))} placeholder="Select group…" value={form.group_id} onChange={e=>handleGroupSelect(e.target.value)}/></FormField>
              <FormField label="Round"><Input type="text" placeholder="e.g. 1 or POB" value={form.round_number} onChange={e=>setForm(f=>({...f,round_number:e.target.value}))}/></FormField>
            </div>
            {form.group_id && (() => {
              const groupEras = eras.filter(e => String(e.group_id) === String(form.group_id))
              return (
                <FormField label="Era">
                  {groupEras.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-1 py-2">No eras for this group yet — create one in Settings → Groups &amp; Members.</p>
                  ) : (
                    <Select
                      options={groupEras.map(e => ({ value: e.id, label: e.status === 'active' ? e.name : `${e.name} (ended)` }))}
                      placeholder="No era"
                      value={form.era_id}
                      onChange={e => handleEraSelect(e.target.value)}
                    />
                  )}
                  {form.era_id && (
                    <div className="mt-2">
                      <Checkbox id="exclude_from_semi_fixed" label="Don't count this order for semi-fixed rounds" checked={form.exclude_from_semi_fixed} onChange={e=>setForm(f=>({...f,exclude_from_semi_fixed:e.target.checked}))}/>
                    </div>
                  )}
                </FormField>
              )
            })()}
            <Checkbox id="is_fancall" label="This order is a fancall" checked={form.is_fancall} onChange={e=>setForm(f=>({...f,is_fancall:e.target.checked}))}/>
            <Checkbox id="is_vce_fansign" label="VCE/Fansign combined" checked={form.is_vce_fansign} onChange={e=>setForm(f=>({...f,is_vce_fansign:e.target.checked}))}/>
            <Checkbox id="is_multi_version" label="Multi-version album" checked={form.is_multi_version} onChange={e=>{
              setForm(f=>({...f,is_multi_version:e.target.checked}))
              if (e.target.checked && versionSections.length === 0) {
                if (formEraVersions.length > 0) {
                  // One section per era version, already linked
                  setVersionSections(formEraVersions.map(newSectionFromEraVersion))
                  setVersionLinks(prev => ({ ...prev, ...Object.fromEntries(formEraVersions.map(v => [v.name, v.id])) }))
                } else {
                  setVersionSections([{ id:uid(), name:'Version A', options:[{ id:uid(), label:'', price_eur:'0', price_krw:'', weight_category:'photocard', weight_g:'1', entries:'' }] }])
                }
              }
            }}/>

            {/* Pricing options */}
            {form.is_vce_fansign ? (
              // VCE/Fansign mode: two separate sections
              <div className="space-y-3">
                {[
                  { label: '🎤 VCE', opts: vceOptions, setOpts: setVceOptions, prefix: 'vce ' },
                  { label: '✍️ Fansign', opts: fansignOptions, setOpts: setFansignOptions, prefix: 'fansign ' },
                ].map(({ label: sectionLabel, opts, setOpts, prefix }) => {
                  const updateOpt = (id: string, field: keyof PricingOption, val: string) => setOpts((p: PricingOption[]) => p.map(o => o.id===id ? {...o,[field]:val} : o))
                  const removeOpt = (id: string) => setOpts((p: PricingOption[]) => p.filter(o => o.id !== id))
                  const addOpt = () => setOpts((p: PricingOption[]) => [...p, { id:uid(), label:prefix, price_eur:'0', price_krw:'', weight_category:'photocard', weight_g:'1', entries:'' }])
                  return (
                    <div key={sectionLabel} className="border border-border rounded-xl p-4 space-y-3 bg-secondary/20">
                      <div><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{sectionLabel} Pricing</p></div>
                      <div className={`grid gap-2 ${form.is_fancall ? 'grid-cols-[1fr_100px_110px_80px_130px_32px]' : 'grid-cols-[1fr_100px_110px_130px_32px]'}`}>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Label</p>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">€</p>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">₩</p>
                        {form.is_fancall && <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Entries</p>}
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Type</p>
                        <span/>
                      </div>
                      <div className="space-y-2">
                        {opts.map((opt: PricingOption) => (
                          <div key={opt.id} className="space-y-1.5">
                            <div className={`grid gap-2 items-center ${form.is_fancall ? 'grid-cols-[1fr_100px_110px_80px_130px_32px]' : 'grid-cols-[1fr_100px_110px_130px_32px]'}`}>
                              <Input placeholder={`e.g. "${prefix}POB only"`} value={opt.label} onChange={e=>updateOpt(opt.id,'label',e.target.value)}/>
                              <Input type="number" placeholder="€" value={opt.price_eur} onChange={e=>updateOpt(opt.id,'price_eur',e.target.value)}/>
                              <Input type="number" placeholder="₩" value={opt.price_krw||''} onChange={e=>updateOpt(opt.id,'price_krw',e.target.value)}/>
                              {form.is_fancall && <Input type="number" placeholder="0" min="0" value={opt.entries||''} onChange={e=>updateOpt(opt.id,'entries',e.target.value)}/>}
                              <Select options={ITEM_TYPES} value={opt.weight_category||'photocard'} onChange={e=>{updateOpt(opt.id,'weight_category',e.target.value); updateOpt(opt.id,'weight_variant_id','')}}/>
                              <button onClick={()=>removeOpt(opt.id)} disabled={opts.length===1} className="text-muted-foreground hover:text-destructive disabled:opacity-20 transition-colors"><X size={15}/></button>
                            </div>
                            <div className="pl-1">
                              <WeightVariantPicker
                                itemType={opt.weight_category || 'photocard'}
                                groupId={orderType === 'group' ? (form.group_id || null) : null}
                                value={opt.weight_variant_id || ''}
                                onChange={v => updateOpt(opt.id, 'weight_variant_id', v)}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                      <button onClick={addOpt} className="text-sm font-semibold text-primary hover:underline flex items-center gap-1"><Plus size={13}/> Add {sectionLabel} option</button>
                    </div>
                  )
                })}
              </div>
            ) : form.is_multi_version ? (
              // Multi-version mode: one pricing section per version
              <div className="space-y-3">
                {/* Version name inputs */}
                <div className="border border-border rounded-xl p-4 space-y-3 bg-secondary/20">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Versions</p>
                    <button onClick={() => setVersionSections(prev => [...prev, { id:uid(), name:`Version ${String.fromCharCode(65+prev.length)}`, options:[{ id:uid(), label:'', price_eur:'0', price_krw:'', weight_category:'photocard', weight_g:'1', entries:'' }] }])}
                      className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"><Plus size={13}/> Add version</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {versionSections.map((ver, vi) => (
                      <div key={ver.id} className="flex items-center gap-1.5 bg-background border border-border rounded-xl px-2 py-1">
                        <input
                          type="text"
                          value={ver.name}
                          onChange={e => {
                            const newName = e.target.value
                            setVersionLinks(links => { if (!(ver.name in links)) return links; const n = { ...links, [newName]: links[ver.name] }; delete n[ver.name]; return n })
                            setAlbumsPerVersion(ap => { if (!(ver.name in ap) || ver.name === newName) return ap; const n: Record<string, string> = { ...ap, [newName]: ap[ver.name] }; delete n[ver.name]; return n })
                            setVersionSections(prev => prev.map((v,i) => i===vi ? {...v, name:newName} : v))
                          }}
                          className="text-sm font-semibold bg-transparent focus:outline-none w-24"
                          placeholder="Version name"
                        />
                        {formEraVersions.length > 0 && (
                          <select value={versionLinks[ver.name] || ''} title="Era album version" onChange={e => linkSectionToEraVersion(vi, e.target.value)}
                            className={`text-[11px] border rounded-md px-1 py-0.5 bg-background focus:outline-none ${versionLinks[ver.name] && versionLinks[ver.name] !== 'none' ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground'}`}>
                            <option value="">💿 by name</option>
                            {formEraVersions.map(v => <option key={v.id} value={v.id}>💿 {v.name}</option>)}
                            <option value="none">not an era version</option>
                          </select>
                        )}
                        {versionSections.length > 1 && (
                          <button onClick={() => setVersionSections(prev => prev.filter((_,i) => i!==vi))}
                            className="text-muted-foreground/50 hover:text-destructive transition-colors"><X size={13}/></button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                {formEraVersions.some(v => !versionSections.some(sec => sec.name.trim().toLowerCase() === v.name.trim().toLowerCase())) && (
                  <div className="flex flex-wrap items-center gap-1.5 -mt-1">
                    <span className="text-xs text-muted-foreground">Add from era:</span>
                    {formEraVersions.filter(v => !versionSections.some(sec => sec.name.trim().toLowerCase() === v.name.trim().toLowerCase())).map(v => (
                      <button key={v.id} type="button" onClick={() => addEraVersionSection(v)}
                        className="text-xs font-semibold border border-primary/30 text-primary rounded-full px-2.5 py-0.5 hover:bg-primary/5 flex items-center gap-1"><Plus size={11}/> {v.name}</button>
                    ))}
                  </div>
                )}
                {/* Pricing per version */}
                {versionSections.map((ver, vi) => {
                  const updateOpt = (id: string, field: keyof PricingOption, val: string) =>
                    setVersionSections(prev => prev.map((v,i) => i===vi ? {...v, options:v.options.map(o => o.id===id ? {...o,[field]:val} : o)} : v))
                  const removeOpt = (id: string) =>
                    setVersionSections(prev => prev.map((v,i) => i===vi ? {...v, options:v.options.filter(o => o.id!==id)} : v))
                  const addOpt = () =>
                    setVersionSections(prev => prev.map((v,i) => i===vi ? {...v, options:[...v.options, { id:uid(), label:'', price_eur:'0', price_krw:'', weight_category:'photocard', weight_g:'1', entries:'' }]} : v))
                  return (
                    <div key={ver.id} className="border border-border rounded-xl p-4 space-y-3 bg-secondary/20">
                      <div><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">📀 {ver.name || `Version ${vi+1}`}</p></div>
                      <div className={`grid gap-2 ${form.is_fancall ? 'grid-cols-[1fr_100px_110px_80px_130px_32px]' : 'grid-cols-[1fr_100px_110px_130px_32px]'}`}>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Label</p>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">€</p>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">₩</p>
                        {form.is_fancall && <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Entries</p>}
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Type</p>
                        <span/>
                      </div>
                      <div className="space-y-2">
                        {ver.options.map((opt: PricingOption) => (
                          <div key={opt.id} className="space-y-1.5">
                            <div className={`grid gap-2 items-center ${form.is_fancall ? 'grid-cols-[1fr_100px_110px_80px_130px_32px]' : 'grid-cols-[1fr_100px_110px_130px_32px]'}`}>
                              <Input placeholder='e.g. "POB only"' value={opt.label} onChange={e=>updateOpt(opt.id,'label',e.target.value)}/>
                              <Input type="number" placeholder="€" value={opt.price_eur} onChange={e=>updateOpt(opt.id,'price_eur',e.target.value)}/>
                              <Input type="number" placeholder="₩" value={opt.price_krw||''} onChange={e=>updateOpt(opt.id,'price_krw',e.target.value)}/>
                              {form.is_fancall && <Input type="number" placeholder="0" min="0" value={opt.entries||''} onChange={e=>updateOpt(opt.id,'entries',e.target.value)}/>}
                              <Select options={ITEM_TYPES} value={opt.weight_category||'photocard'} onChange={e=>{updateOpt(opt.id,'weight_category',e.target.value); updateOpt(opt.id,'weight_variant_id','')}}/>
                              <button onClick={()=>removeOpt(opt.id)} disabled={ver.options.length===1} className="text-muted-foreground hover:text-destructive disabled:opacity-20 transition-colors"><X size={15}/></button>
                            </div>
                            <div className="pl-1">
                              <WeightVariantPicker
                                itemType={opt.weight_category || 'photocard'}
                                groupId={orderType === 'group' ? (form.group_id || null) : null}
                                value={opt.weight_variant_id || ''}
                                onChange={v => updateOpt(opt.id, 'weight_variant_id', v)}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                      <button onClick={addOpt} className="text-sm font-semibold text-primary hover:underline flex items-center gap-1"><Plus size={13}/> Add option</button>
                    </div>
                  )
                })}
              </div>
            ) : (
            <div className="border border-border rounded-xl p-4 space-y-3 bg-secondary/20">
              <div><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Pricing Options</p><p className="text-xs text-muted-foreground mt-0.5">Set once — reused across all joiner items</p></div>
              {/* Headers — match input columns exactly */}
              <div className={`grid gap-2 ${form.is_fancall ? 'grid-cols-[1fr_100px_110px_80px_130px_32px]' : 'grid-cols-[1fr_100px_110px_130px_32px]'}`}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Label</p>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">€</p>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">₩</p>
                {form.is_fancall && <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Entries</p>}
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Type</p>
                <span/>
              </div>
              <div className="space-y-2">
                {pricingOptions.map(opt => (
                  <div key={opt.id} className="space-y-1.5">
                    <div className={`grid gap-2 items-center ${form.is_fancall ? 'grid-cols-[1fr_100px_110px_80px_130px_32px]' : 'grid-cols-[1fr_100px_110px_130px_32px]'}`}>
                      <Input placeholder='e.g. "POB only"' value={opt.label} onChange={e=>updatePricingOption(opt.id,'label',e.target.value)}/>
                      <Input type="number" placeholder="€" value={opt.price_eur} onChange={e=>updatePricingOption(opt.id,'price_eur',e.target.value)}/>
                      <Input type="number" placeholder="₩" value={opt.price_krw||''} onChange={e=>updatePricingOption(opt.id,'price_krw',e.target.value)}/>
                      {form.is_fancall && <Input type="number" placeholder="0" min="0" value={opt.entries||''} onChange={e=>updatePricingOption(opt.id,'entries',e.target.value)} title="Entries per item"/>}
                      <Select options={ITEM_TYPES} value={opt.weight_category||'photocard'} onChange={e=>{updatePricingOption(opt.id,'weight_category',e.target.value); updatePricingOption(opt.id,'weight_variant_id','')}}/>
                      <button onClick={()=>removePricingOption(opt.id)} disabled={pricingOptions.length===1} className="text-muted-foreground hover:text-destructive disabled:opacity-20 transition-colors"><X size={15}/></button>
                    </div>
                    <div className="pl-1">
                      <WeightVariantPicker
                        itemType={opt.weight_category || 'photocard'}
                        groupId={orderType === 'group' ? (form.group_id || null) : null}
                        value={opt.weight_variant_id || ''}
                        onChange={v => updatePricingOption(opt.id, 'weight_variant_id', v)}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={addPricingOption} className="text-sm font-semibold text-primary hover:underline flex items-center gap-1"><Plus size={13}/> Add pricing option</button>
            </div>
            )}

            {/* Item log */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div><p className="text-sm font-semibold">Item Log</p><p className="text-xs text-muted-foreground">One section per joiner</p></div>
                <Button variant="outline" size="sm" onClick={addJoinerRow}><Plus size={13}/> Add Joiner</Button>
              </div>
              {joinerRows.length===0 && (
                <div className="text-sm text-muted-foreground text-center py-6 border border-dashed border-border rounded-xl">Click "Add Joiner" to start logging items</div>
              )}
              {joinerRows.map((row,rowIdx) => (
                <div key={rowIdx} className="border border-border rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 bg-secondary/30 border-b border-border">
                    <div className="flex-1 relative">
                    <Input
                      placeholder="Search joiner…"
                      value={joinerSearch[rowIdx]??joiners.find(j=>j.id===row.joiner_id)?.display_name??joiners.find(j=>j.id===row.joiner_id)?.username??''}
                      onChange={e=>setJoinerSearch(p=>({...p,[rowIdx]:e.target.value}))}
                      onFocus={e=>setJoinerSearch(p=>({...p,[rowIdx]:e.target.value||''}))}
                    />
                    {joinerSearch[rowIdx]!==undefined && (
                      <div className="absolute top-full left-0 right-0 z-50 bg-card border border-border rounded-xl shadow-rose-md mt-1 max-h-48 overflow-y-auto">
                        {joiners.filter(j=>{const q=joinerSearch[rowIdx].toLowerCase();return!q||(j.display_name||j.username||'').toLowerCase().includes(q)}).map(j=>(
                          <button key={j.id} type="button" onMouseDown={()=>{updateJoinerId(rowIdx,j.id);setJoinerSearch(p=>{const n={...p};delete n[rowIdx];return n})}}
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors ${row.joiner_id===j.id?'font-semibold text-primary':''}`}>
                            {j.display_name||j.username}
                          </button>
                        ))}
                        {joiners.filter(j=>{const q=joinerSearch[rowIdx].toLowerCase();return!q||(j.display_name||j.username||'').toLowerCase().includes(q)}).length===0 && (
                          <p className="px-3 py-2 text-sm text-muted-foreground">No joiners found</p>
                        )}
                      </div>
                    )}
                  </div>
                    <span className="text-xs text-muted-foreground">{row.items.length} item{row.items.length!==1?'s':''}</span>
                    <button onClick={()=>removeJoinerRow(rowIdx)} className="text-muted-foreground hover:text-destructive transition-colors"><X size={15}/></button>
                  </div>
                  <div className="divide-y divide-border">
                    {row.items.map((item,_itemIdx) => (
                      <div key={item.id} className="px-4 py-3 space-y-2">
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-5 text-center font-semibold flex-shrink-0">{_itemIdx+1}</span>
                          <div className="flex-1 min-w-0">{(() => {
                            const displayOpts = form.is_multi_version && versionSections.length > 0
                              ? versionSections.flatMap(v => v.options.map((o,i) => ({value:o.id, label:`${v.name}: ${o.label||`Option ${i+1}`}`})))
                              : form.is_vce_fansign ? [
                                ...vceOptions.map((o,i) => ({value:o.id, label:`VCE: ${o.label||`Option ${i+1}`}`})),
                                ...fansignOptions.map((o,i) => ({value:o.id, label:`Fansign: ${o.label||`Option ${i+1}`}`}))
                              ] : pricingOptions.map((o,i) => ({value:o.id, label:o.label||`Option ${i+1}`}))
                            return <Select options={displayOpts} placeholder="Pricing…" value={item.pricing_option_id} onChange={e=>{
                              updateItemLine(rowIdx,item.id,'pricing_option_id',e.target.value)
                              // Also store the selected option's label as description
                              const selectedOpt = (form.is_multi_version ? versionSections.flatMap(v=>v.options) : form.is_vce_fansign ? [...vceOptions,...fansignOptions] : pricingOptions).find(o=>o.id===e.target.value)
                              if (selectedOpt?.label) updateItemLine(rowIdx,item.id,'description',selectedOpt.label)
                            }}/>
                          })()}</div>
                          <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
                            <span className="text-xs font-semibold text-muted-foreground">Quantity</span>
                            <div className="w-14"><Input type="number" min="1" value={item.qty} onChange={e=>updateItemLine(rowIdx,item.id,'qty',parseInt(e.target.value)||1)} className="text-center"/></div>
                          </div>
                          {pricingOptions.some(o=>o.label?.toLowerCase().includes('inclusion')) && (
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <span className="text-xs font-semibold text-muted-foreground">Inclusions</span>
                              <div className="w-14"><Input type="number" min="0" value={item.inclusions_count||0} onChange={e=>updateItemLine(rowIdx,item.id,'inclusions_count',parseInt(e.target.value)||0)} className="text-center"/></div>
                            </div>
                          )}
                          <button onClick={()=>removeItemLine(rowIdx,item.id)} disabled={row.items.length===1} className="text-muted-foreground hover:text-destructive disabled:opacity-20 transition-colors flex-shrink-0"><X size={13}/></button>
                        </div>
                        {members.length>0 && (
                          <div className="flex flex-wrap gap-1.5 pl-7">
                            {members.map(m => {
                              const count = item.member_ids.filter(id => id===m.id).length
                              const sel = count > 0
                              return (
                                <div key={m.id} className={`flex items-center rounded-full text-xs font-semibold border transition-all overflow-hidden ${sel?'bg-primary text-white border-primary':'bg-background text-muted-foreground border-border hover:border-primary/50'}`}>
                                  <button type="button" onClick={()=>toggleMember(rowIdx,item.id,m.id)} className="px-2.5 py-0.5">
                                    {m.name}{count>1 && ` ×${count}`}
                                  </button>
                                  {sel && (
                                    <button type="button" onClick={()=>decrementMember(rowIdx,item.id,m.id)}
                                      className="px-1.5 py-0.5 border-l border-white/30 hover:bg-black/10 transition-colors" title="Remove one">
                                      −
                                    </button>
                                  )}
                                </div>
                              )
                            })}
                            {item.member_ids.length>0 && <span className="text-xs text-muted-foreground self-center ml-1">→ {item.member_ids.length} item{item.member_ids.length!==1?'s':''}{item.qty!==item.member_ids.length&&<span className="text-primary font-semibold"> (override: {item.qty})</span>}</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="px-4 py-2 border-t border-border bg-secondary/10">
                    <button onClick={()=>addItemLine(rowIdx)} className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"><Plus size={11}/> Add item</button>
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addJoinerRow} className="w-full mt-2"><Plus size={13}/> Add Joiner</Button>
            </div>
          </>)}

          {orderType === 'personal' && (<>
            <FormField label="Round"><Input type="text" placeholder="e.g. 1 or POB" value={form.round_number} onChange={e=>setForm(f=>({...f,round_number:e.target.value}))}/></FormField>
            {/* Linked joiner for personal orders */}
            <FormField label="Linked Joiner">
              <Select
                options={joiners.map(j => ({ value: j.id, label: j.display_name || j.username }))}
                placeholder="Link to a joiner (optional)…"
                value={form.group_id}
                onChange={e => setForm(f => ({ ...f, group_id: e.target.value }))}
              />
            </FormField>
            <p className="text-xs text-muted-foreground -mt-2">The linked joiner will see this order in their Orders view.</p>
            {/* Pricing options for personal orders */}
            <div className="border border-border rounded-xl p-4 space-y-3 bg-secondary/20">
              <div><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Pricing Options</p></div>
              <div className="grid grid-cols-[1fr_100px_110px_130px_70px_32px] gap-2">
                {['Label','Price (€)','Type','Wt (g)',''].map(h=><p key={h} className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</p>)}
              </div>
              <div className="space-y-2">
                {pricingOptions.map(opt=>(
                  <div key={opt.id} className="grid grid-cols-[1fr_120px_130px_150px_32px] gap-2 items-center">
                    <Input placeholder='e.g. "POB only"' value={opt.label} onChange={e=>updatePricingOption(opt.id,'label',e.target.value)}/>
                    <Input type="number" placeholder="€" value={opt.price_eur} onChange={e=>updatePricingOption(opt.id,'price_eur',e.target.value)}/>
                    <Input type="number" placeholder="₩" value={opt.price_krw||''} onChange={e=>updatePricingOption(opt.id,'price_krw',e.target.value)} title="Price in KRW"/>
                    <Select options={ITEM_TYPES} value={opt.weight_category||'photocard'} onChange={e=>{updatePricingOption(opt.id,'weight_category',e.target.value); if(e.target.value==='photocard') updatePricingOption(opt.id,'weight_g','1')}}/>
                    <button onClick={()=>removePricingOption(opt.id)} disabled={pricingOptions.length===1} className="text-muted-foreground hover:text-destructive disabled:opacity-20 transition-colors"><X size={15}/></button>
                  </div>
                ))}
              </div>
              <button onClick={addPricingOption} className="text-sm font-semibold text-primary hover:underline flex items-center gap-1"><Plus size={13}/> Add pricing option</button>
            </div>

            {/* Personal order item log — no joiner grouping, just a flat list */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div><p className="text-sm font-semibold">Items</p><p className="text-xs text-muted-foreground">Personal order items</p></div>
                <Button variant="outline" size="sm" onClick={addJoinerRow}><Plus size={13}/> Add Item</Button>
              </div>
              {joinerRows.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-4 border border-dashed border-border rounded-xl">Click "Add Item" to log items</div>
              )}
              {joinerRows.map((row, rowIdx) => (
                <div key={rowIdx} className="border border-border rounded-xl overflow-hidden">
                  <div className="divide-y divide-border">
                    {row.items.map((item, itemIdx) => (
                      <div key={item.id} className="px-4 py-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-5 text-center font-semibold">{itemIdx+1}</span>
                          <div className="w-36 flex-shrink-0">{(() => {
                            const displayOpts = form.is_multi_version && versionSections.length > 0
                              ? versionSections.flatMap(v => v.options.map((o,i) => ({value:o.id, label:`${v.name}: ${o.label||`Option ${i+1}`}`})))
                              : form.is_vce_fansign ? [
                                ...vceOptions.map((o,i) => ({value:o.id, label:`VCE: ${o.label||`Option ${i+1}`}`})),
                                ...fansignOptions.map((o,i) => ({value:o.id, label:`Fansign: ${o.label||`Option ${i+1}`}`}))
                              ] : pricingOptions.map((o,i) => ({value:o.id, label:o.label||`Option ${i+1}`}))
                            return <Select options={displayOpts} placeholder="Pricing…" value={item.pricing_option_id} onChange={e=>{
                              updateItemLine(rowIdx,item.id,'pricing_option_id',e.target.value)
                              // Also store the selected option's label as description
                              const selectedOpt = (form.is_multi_version ? versionSections.flatMap(v=>v.options) : form.is_vce_fansign ? [...vceOptions,...fansignOptions] : pricingOptions).find(o=>o.id===e.target.value)
                              if (selectedOpt?.label) updateItemLine(rowIdx,item.id,'description',selectedOpt.label)
                            }}/>
                          })()}</div>
                          <div className="w-16 flex-shrink-0"><Input type="number" min="1" value={item.qty} onChange={e=>updateItemLine(rowIdx,item.id,'qty',parseInt(e.target.value)||1)} className="text-center" title="Qty"/></div>
                          {pricingOptions.find(o=>o.id===item.pricing_option_id)?.label?.toLowerCase().includes('inclusion') && (
                            <div className="w-20 flex-shrink-0"><Input type="number" min="0" value={item.inclusions_count||0} onChange={e=>updateItemLine(rowIdx,item.id,'inclusions_count',parseInt(e.target.value)||0)} className="text-center" title="Inclusions count" placeholder="Incl."/></div>
                          )}
                          <button onClick={()=>removeItemLine(rowIdx,item.id)} disabled={row.items.length===1} className="text-muted-foreground hover:text-destructive disabled:opacity-20 flex-shrink-0"><X size={13}/></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="px-4 py-2 border-t border-border bg-secondary/10">
                    <button onClick={()=>addItemLine(rowIdx)} className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"><Plus size={11}/> Add item</button>
                  </div>
                </div>
              ))}
            </div>
          </>)}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <FormField label="Order Date"><Input type="datetime-local" value={form.ordered_at} onChange={e=>setForm(f=>({...f,ordered_at:e.target.value}))}/></FormField>
            <FormField label="Deadline"><Input type="datetime-local" value={form.deadline} onChange={e=>setForm(f=>({...f,deadline:e.target.value}))}/></FormField>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={form.hide_leftovers} onChange={e=>setForm(f=>({...f,hide_leftovers:e.target.checked}))} className="w-4 h-4 rounded accent-primary"/>
              <span className="text-sm font-medium">Hide leftover members count</span>
            </label>
          </div>

          <FormField label="Preview Image">
            <div className="space-y-2">
              {form.preview_image_url && <img src={form.preview_image_url} alt="Preview" className="w-full max-h-40 object-cover rounded-xl border border-border"/>}
              <label className="flex items-center gap-2 px-4 py-2.5 border border-dashed border-border rounded-xl cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all text-sm text-muted-foreground">
                <span>📷 {form.preview_image_url ? 'Replace image' : 'Upload image'}</span>
                <input type="file" accept="image/*" className="hidden" onChange={e => { const f=e.target.files?.[0]; if(!f) return; if(f.size>2_000_000){alert('Max 2MB');return}; const r=new FileReader(); r.onload=ev=>setForm(fm=>({...fm,preview_image_url:ev.target?.result as string})); r.readAsDataURL(f) }}/>
              </label>
              {form.preview_image_url && <button onClick={()=>setForm(f=>({...f,preview_image_url:''}))} className="text-xs text-destructive hover:underline">Remove image</button>}
            </div>
          </FormField>

          <FormField label="Notes"><textarea className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30" rows={2} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/></FormField>

          <FormField label="Albums Bought">
            <p className="text-xs text-muted-foreground mb-1.5">Total albums purchased. Used to calculate guaranteed sets vs random claims in the order detail.</p>
            {form.is_multi_version && versionSections.length > 0 ? (
              <div className="space-y-2">
                {versionSections.map(v => (
                  <div key={v.id} className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground w-24 truncate">{v.name || 'Version'}</span>
                    <Input type="number" min="0" step="1" placeholder="0"
                      value={albumsPerVersion[v.name] || ''}
                      onChange={e => setAlbumsPerVersion(prev => ({ ...prev, [v.name]: e.target.value }))}/>
                  </div>
                ))}
              </div>
            ) : form.is_vce_fansign ? (
              <div className="space-y-2">
                {[['vce', 'VCE'], ['fansign', 'Fansign']].map(([key, label]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground w-24">{label}</span>
                    <Input type="number" min="0" step="1" placeholder="0"
                      value={albumsPerVersion[key] || ''}
                      onChange={e => setAlbumsPerVersion(prev => ({ ...prev, [key]: e.target.value }))}/>
                    {form.era_id && linkSelect(key)}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input type="number" min="0" step="1" placeholder="e.g. 10" value={form.albums_bought} onChange={e=>setForm(f=>({...f,albums_bought:e.target.value}))}/>
                {form.era_id && linkSelect('__all__', 'py-2.5')}
              </div>
            )}
            {form.era_id && formEraVersions.length === 0 && <p className="text-xs text-muted-foreground mt-1.5">Add album versions to this era on the Eras page to link what this order buys.</p>}
          </FormField>

          <FormField label="Payment Info">
            <p className="text-xs text-muted-foreground mb-1.5">Shown to all joiners when they open this order</p>
            <textarea
              className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/25 min-h-[72px]"
              placeholder="e.g. Pay via Wise to @username, ref: izna order"
              rows={3}
              value={form.payment_info}
              onChange={e=>setForm(f=>({...f,payment_info:e.target.value}))}
            />
          </FormField>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={resetModal}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving||!form.shop_id}>{saving?'Saving…':editingOrder?'Update Order':'Save Order'}</Button>
          </div>
        </div>
      </Modal>

      {/* Order detail panel */}
      <OrderDetail
        orderId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
        viewAs="gom"
      />
    </div>
  )
}
