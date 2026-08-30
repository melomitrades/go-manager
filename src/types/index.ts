// ============================================================
// GO MANAGER – TypeScript Types
// ============================================================

export type UserRole = 'admin' | 'gom' | 'joiner'

export interface Profile {
  id: string
  username: string
  display_name: string | null
  role: UserRole
  avatar_url: string | null
  created_at: string
  updated_at: string
}

// ── Groups & Members ──────────────────────────────────────
export interface Group {
  id: string
  name: string
  created_at: string
  members?: Member[]
}

export interface Member {
  id: string
  group_id: string
  name: string
  created_at: string
  group?: Group
}

// ── Shops ─────────────────────────────────────────────────
export interface Shop {
  id: string
  name: string
  website: string | null
  ships_to_korea: boolean
  accepts_id: boolean
  created_at: string
  updated_at: string
}

// ── Orders ────────────────────────────────────────────────
export type OrderType = 'group' | 'personal'
export type OrderStatus =
  | 'to_be_ordered'
  | 'ordered'
  | 'at_k_addy'
  | 'at_c_addy'
  | 'at_j_addy'
  | 'otw_to_gom'
  | 'at_gom'
  | 'closed'

export type PricingType = 'pob_only' | 'pob_inclusions' | 'custom'
export type AddyCountry = 'KR' | 'CN' | 'JP'

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  to_be_ordered: 'To Be Ordered',
  ordered: 'Ordered',
  at_k_addy: 'At K-Addy',
  at_c_addy: 'At C-Addy',
  at_j_addy: 'At J-Addy',
  otw_to_gom: 'OTW to GOM',
  at_gom: 'At GOM',
  closed: 'Closed',
}

export const PRICING_LABELS: Record<PricingType, string> = {
  pob_only: 'POB Only',
  pob_inclusions: 'POB + Inclusions',
  custom: 'Custom Price',
}

export interface Order {
  id: string
  type: OrderType
  shop_id: string | null
  group_id: string | null
  round_number: number | null
  is_fancall: boolean
  status: OrderStatus
  addy_country: AddyCountry | null
  notes: string | null
  deadline: string | null
  ordered_at: string | null
  personal_joiner_id: string | null
  preview_image_url: string | null
  hide_leftovers: boolean | null
  is_vce_fansign: boolean | null
  is_multi_version: boolean | null
  version_names: string[] | null
  created_by: string | null
  created_at: string
  updated_at: string
  // Joined
  shop?: Shop
  group?: Group
  items?: OrderItem[]
  creator?: Profile
}

export interface OrderItem {
  id: string
  order_id: string
  member_id: string | null
  joiner_id: string | null
  pricing_type: PricingType
  description: string | null
  amount_claimed: number
  price_eur: number | null
  weight_g: number | null
  created_at: string
  // Joined
  member?: Member
  joiner?: Profile
}

// ── Boxes ─────────────────────────────────────────────────
export interface Box {
  id: string
  order_id: string
  label: string | null
  ems_total_eur: number
  ems_total_krw: number
  customs_total_eur: number
  customs_total_krw: number
  created_at: string
  updated_at: string
  order?: Order
}

// ── Payments ──────────────────────────────────────────────
export type PaymentRecipient = 'kaddy' | 'shop' | 'proxy' | 'seller'

export interface Payment {
  id: string
  recipient_type: PaymentRecipient
  amount_eur: number
  amount_krw: number | null
  shop_id: string | null
  order_id: string | null
  payment_method: string | null
  deadline: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  // Joined
  shop?: Shop
  order?: Order
  covering_log?: CoveringLog
}

export interface CoveringLog {
  id: string
  payment_id: string
  amount_to_send_eur: number
  amount_claimed_eur: number
  amount_difference_eur: number
  created_at: string
}

// ── Fancalls ──────────────────────────────────────────────
export interface Fancall {
  id: string
  order_id: string | null
  shop_id: string | null
  entered_by: string | null
  fancall_datetime: string | null
  won: boolean
  received: boolean
  benefits_to_kaddy: string | null
  created_at: string
  updated_at: string
  // Joined
  order?: Order
  shop?: Shop
  enterer?: Profile
}

// ── Addy ──────────────────────────────────────────────────
export interface AddyAddress {
  id: string
  country: AddyCountry
  address: string | null
  updated_at: string
}

export interface AddyItem {
  id: string
  country: AddyCountry
  order_id: string | null
  shop_id: string | null
  description: string | null
  arrived_at: string | null
  picture_url: string | null
  is_personal: boolean
  created_at: string
  order?: Order
  shop?: Shop
}

// ── Sending Out ───────────────────────────────────────────
export type ShippingStatus = 'unpacked' | 'packing' | 'sorting' | 'sent'
export type WeightType = 'letter' | 'package'

export interface SendingOut {
  id: string
  order_id: string
  joiner_id: string | null
  courier: string | null
  address: string | null
  status: ShippingStatus
  weight_type: WeightType | null
  weight_g: number | null
  claims_picture_url: string | null
  shipping_deadline: string | null
  notes: string | null
  created_at: string
  updated_at: string
  order?: Order
  joiner?: Profile
}

// ── PC Sorter ─────────────────────────────────────────────
// A session can hold multiple "packs" (e.g. Ver. A / Ver. B). Each pack holds one or more
// "items" (photocard, postcard, lenticular...) — one inclusion for a pack = one of every
// item in it. Joiners rank members fully independently per item.
export type SortMethod = 'timestamp' | 'fair'

export interface PCSortingSession {
  id: string
  group_id: string | null
  box_id: string | null
  order_ids: string[] | null
  // Per-order album-version narrowing. Only orders that are multi-version AND where the GOM
  // deliberately excluded at least one version get an entry here — { order_id: [version names
  // still included] }. An order with no entry (or a non-multi-version order) means "every
  // version of this order counts", same as before this field existed.
  order_versions: Record<string, string[]> | null
  title: string
  form_open: boolean
  deadline: string | null
  sort_method: SortMethod | null
  sort_run_at: string | null
  // Set once the GOM locks the sort as final — packs, items, quantities, inclusions, and the
  // sort itself all become read-only until this is cleared again. NULL = unlocked (editable).
  locked_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  group?: Group
  box?: Box
  packs?: PCPack[]
}

export interface PCPack {
  id: string
  session_id: string
  name: string
  sort_order: number
  created_at: string
  items?: PCItem[]
}

export interface PCItem {
  id: string
  pack_id: string
  name: string
  sort_order: number
  // When true, this item's sortable options are PCItemUnit combos (several real members
  // packaged as one option, e.g. "Mai + Jungeun") instead of one option per real group member.
  // Set once at creation — there's no way to flip it afterward.
  is_unit: boolean
  created_at: string
  quantities?: PCItemQuantity[]
  units?: PCItemUnit[]
}

// A combo of several real members packaged as one sortable option for a single unit-tagged
// item (e.g. "Mai + Jungeun" for a unit photocard). Scoped to that one item, not the group's
// member roster — it never appears anywhere outside PC Sorter. Wherever a PCItemQuantity /
// PCPriorityEntry / PCAssignment's member_id shows up for a unit item, it's actually one of
// these ids, not a real members.id.
export interface PCItemUnit {
  id: string
  item_id: string
  name: string
  member_ids: string[]
  sort_order: number
  created_at: string
}

export interface PCItemQuantity {
  id: string
  item_id: string
  // A real members.id, OR — when the parent item is_unit — a PCItemUnit id.
  member_id: string | null
  total_pulled: number
  available: number
  created_at: string
  member?: Member
  member_name?: string
}

export interface PCPackInclusion {
  id: string
  session_id: string
  pack_id: string
  joiner_id: string
  inclusions_assigned: number
  created_at: string
  joiner?: Profile
  display_name?: string
  username?: string
}

export interface PCPriorityForm {
  id: string
  session_id: string
  joiner_id: string
  submitted_at: string
  joiner?: Profile
  display_name?: string
  username?: string
  entries?: PCPriorityEntry[]
}

export interface PCPriorityEntry {
  id: string
  form_id: string
  item_id: string
  member_id: string
  priority: number
}

export interface PCAssignment {
  id: string
  session_id: string
  pack_id: string
  item_id: string
  joiner_id: string
  member_id: string
  round: number
  is_repeat: boolean
  is_random: boolean
  // Handed out because the joiner's order claimed a specific version whose unit is physically
  // guaranteed to match (see computeGuaranteedUnitClaims in pcSorter.ts) — never ranked/competed
  // for, unlike is_repeat/is_random.
  is_guaranteed: boolean
  sort_method: SortMethod
  created_at: string
  joiner?: Profile
  member?: Member
  pack_name?: string
  item_name?: string
  display_name?: string
  username?: string
  session_title?: string
}

// ── Notifications ─────────────────────────────────────────
export type NotificationType =
  | 'order_status_update'
  | 'deadline_48h'
  | 'deadline_24h'
  | 'deadline_1h'
  | 'new_deadline'
  | 'payment_submitted'

export interface Notification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  body: string | null
  read: boolean
  link: string | null
  created_at: string
}

// ── UI Helpers ────────────────────────────────────────────
export interface SelectOption {
  value: string
  label: string
}

export interface ApiResponse<T> {
  data: T | null
  error: string | null
}
