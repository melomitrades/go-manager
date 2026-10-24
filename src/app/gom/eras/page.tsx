'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Disc3, ChevronRight, AlertTriangle, Settings } from 'lucide-react'
import { PageHeader, EmptyState } from '@/components/ui'
import { PackCount } from '@/components/shared/EraAlbum'

// Eras list: every group's eras with their inclusion-pack totals. One album copy = one pack.

export default function ErasPage() {
  const [eras, setEras] = useState<any[] | null>(null)
  const [showEnded, setShowEnded] = useState(true)

  useEffect(() => {
    fetch('/api/era-albums').then(r => r.json()).then(d => setEras(Array.isArray(d) ? d : [])).catch(() => setEras([]))
  }, [])

  const groups = useMemo(() => {
    const m = new Map<string, { name: string; eras: any[] }>()
    for (const e of eras || []) {
      if (!showEnded && e.status !== 'active') continue
      const k = e.group_id || '__none__'
      if (!m.has(k)) m.set(k, { name: e.group_name || 'No group', eras: [] })
      m.get(k)!.eras.push(e)
    }
    return Array.from(m.values())
  }, [eras, showEnded])

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Eras" subtitle="Albums, versions and inclusion packs per era"
        action={<Link href="/gom/settings" className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground border border-border rounded-xl px-3 py-2"><Settings size={13}/> Create / end eras</Link>}/>
      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-5">
        {eras === null ? (
          <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>
        ) : eras.length === 0 ? (
          <EmptyState icon={Disc3} title="No eras yet" description="Create an era for a group in Settings → Groups & Members, then manage its album here."/>
        ) : (
          <>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground cursor-pointer w-fit">
              <input type="checkbox" className="accent-primary" checked={showEnded} onChange={e => setShowEnded(e.target.checked)}/> Show ended eras
            </label>
            {groups.map(g => (
              <section key={g.name} className="space-y-2">
                <h2 className="font-display font-semibold text-base">{g.name}</h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {g.eras.map(e => {
                    const t = e.totals || { bought: 0, claimed: 0, unclaimed: 0 }
                    return (
                      <Link key={e.id} href={`/gom/eras/${e.id}`}
                        className="group bg-card border border-border rounded-2xl px-4 py-3.5 hover:border-primary/40 hover:shadow-sm transition-all block">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold truncate">{e.name}</p>
                              {e.status !== 'active' && <span className="text-[10px] uppercase font-bold text-muted-foreground/70 border border-border rounded px-1 flex-shrink-0">ended</span>}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {e.album_name ? `💿 ${e.album_name}` : <span className="italic">No album name yet</span>} · {e.version_count} version{e.version_count === 1 ? '' : 's'} · {e.order_count} order{e.order_count === 1 ? '' : 's'}
                            </p>
                          </div>
                          <ChevronRight size={16} className="text-muted-foreground group-hover:text-primary flex-shrink-0 mt-1"/>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mt-3">
                          <PackCount label="Inclusions bought" value={t.bought}/>
                          <PackCount label="Claimed" value={t.claimed} tone="muted"/>
                          <PackCount label="Unclaimed" value={t.unclaimed} tone={t.unclaimed < 0 ? 'bad' : t.unclaimed > 0 ? 'good' : 'muted'}/>
                        </div>
                        {e.unlinked > 0 && (
                          <p className="mt-2 text-[11px] font-semibold text-amber-600 flex items-center gap-1"><AlertTriangle size={11}/> {e.unlinked} part{e.unlinked === 1 ? '' : 's'} of orders not linked to a version</p>
                        )}
                      </Link>
                    )
                  })}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
