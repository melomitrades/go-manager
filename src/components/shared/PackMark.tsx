'use client'
import { Package, PackageX, Mail, CheckCircle2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'

// Little packing-state icons shown next to claims, sorted photocards and winner items
// (computed server-side by getPackMarks in src/lib/shipments.ts):
//   📦 packed   — confirmed in the Pack wizard
//   ⊠  skipped  — skipped in the Pack wizard (it did NOT go in the parcel)
//   ✉️ shipped  — its parcel was shipped (hover for the tracking code)
//   ✅ complete — the joiner confirmed they received it

export type PackMarkData = {
  state: 'packed' | 'skipped' | 'shipped' | 'complete'
  form_title?: string | null
  tracking_code?: string | null
  shipping_type?: string | null
  at?: string | null
}

const STATES = {
  packed:   { Icon: Package,      label: 'Packed',                 cls: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-800' },
  skipped:  { Icon: PackageX,     label: 'Skipped while packing',  cls: 'text-red-600 bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-900/20 dark:border-red-800' },
  shipped:  { Icon: Mail,         label: 'Shipped',                cls: 'text-sky-700 bg-sky-50 border-sky-200 dark:text-sky-300 dark:bg-sky-900/20 dark:border-sky-800' },
  complete: { Icon: CheckCircle2, label: 'Received',               cls: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-900/20 dark:border-emerald-800' },
} as const

const ORDER: PackMarkData['state'][] = ['complete', 'shipped', 'packed', 'skipped']

function tooltip(m: PackMarkData): string {
  const s = STATES[m.state]
  return [
    s.label + (m.at ? ` ${formatDate(m.at)}` : ''),
    m.form_title ? `Shipment: ${m.form_title}` : null,
    m.tracking_code ? `Tracking: ${m.tracking_code}` : (m.state === 'shipped' ? 'No tracking code' : null),
  ].filter(Boolean).join('\n')
}

// One item's mark. Renders nothing when the item hasn't been packed yet.
export function PackMark({ mark, size = 12 }: { mark?: PackMarkData | null; size?: number }) {
  if (!mark || !STATES[mark.state]) return null
  const s = STATES[mark.state]
  return (
    <span title={tooltip(mark)} aria-label={s.label}
      className={`inline-flex items-center justify-center rounded-md border p-0.5 align-middle flex-shrink-0 ${s.cls} ${mark.state === 'skipped' ? 'opacity-80' : ''}`}>
      <s.Icon size={size} strokeWidth={2.2} />
    </span>
  )
}

// Several items shown together (one claim line covering several rows, a pack of sorted cards…):
// one icon per state present, with a count when there's more than one of it. Hover lists the
// tracking codes involved.
export function PackMarks({ marks, size = 12 }: { marks: (PackMarkData | null | undefined)[]; size?: number }) {
  const present = marks.filter(Boolean) as PackMarkData[]
  if (present.length === 0) return null
  if (marks.length === 1) return <PackMark mark={present[0]} size={size} />
  return (
    <span className="inline-flex items-center gap-1 align-middle flex-shrink-0">
      {ORDER.map(state => {
        const these = present.filter(m => m.state === state)
        if (these.length === 0) return null
        const s = STATES[state]
        const codes = Array.from(new Set(these.map(m => m.tracking_code).filter(Boolean)))
        const forms = Array.from(new Set(these.map(m => m.form_title).filter(Boolean)))
        const title = [`${s.label}: ${these.length} of ${marks.length}`, forms.length ? `Shipment: ${forms.join(', ')}` : null, codes.length ? `Tracking: ${codes.join(', ')}` : null].filter(Boolean).join('\n')
        return (
          <span key={state} title={title} aria-label={title}
            className={`inline-flex items-center gap-0.5 rounded-md border px-0.5 py-0.5 text-[10px] font-bold leading-none ${s.cls}`}>
            <s.Icon size={size} strokeWidth={2.2} />
            {(these.length > 1 || these.length !== marks.length) && <span className="pr-0.5">{these.length}</span>}
          </span>
        )
      })}
    </span>
  )
}

// Orders list: counts per state over the claims in scope ("📦 2  ✉️ 1 /5").
export type PackSummaryData = { total: number; packed: number; skipped: number; shipped: number; complete: number }
export function PackSummary({ summary, size = 11 }: { summary?: PackSummaryData | null; size?: number }) {
  if (!summary || !summary.total) return null
  const any = summary.packed + summary.skipped + summary.shipped + summary.complete
  if (any === 0) return null
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {ORDER.map(state => {
        const n = summary[state]
        if (!n) return null
        const s = STATES[state]
        return (
          <span key={state} title={`${s.label}: ${n} of ${summary.total} claim${summary.total === 1 ? '' : 's'}`}
            className={`inline-flex items-center gap-0.5 rounded-md border px-1 py-0.5 text-[10px] font-bold leading-none ${s.cls}`}>
            <s.Icon size={size} strokeWidth={2.2} />{n}
          </span>
        )
      })}
      <span className="text-[10px] text-muted-foreground font-medium">/{summary.total}</span>
    </span>
  )
}
