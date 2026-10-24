'use client'

// Small pieces shared by the Eras list and the era page.

export function PackCount({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' | 'muted' }) {
  const color = tone === 'bad' ? 'text-red-500' : tone === 'good' ? 'text-emerald-600' : tone === 'muted' ? 'text-muted-foreground' : 'text-foreground'
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 truncate">{label}</p>
      <p className={`font-display text-lg font-bold tabular-nums leading-tight ${color}`}>{value}</p>
    </div>
  )
}
