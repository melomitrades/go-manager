'use client'
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, RefreshCw, PackageOpen } from 'lucide-react'

interface LeftoverMember { id: string; name: string; leftover: number }
interface LeftoverSection { versionLabel?: string; members: LeftoverMember[]; type: 'album' | 'standard' }
interface LeftoverOrder { id: string; label: string; type: string; status: string; sections: LeftoverSection[] }

export default function LeftoversWidget({ onSelectOrder }: { onSelectOrder?: (id: string) => void }) {
  const [data, setData]       = useState<LeftoverOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState(false)

  const fetch_ = async () => {
    setLoading(true)
    const res = await fetch('/api/leftovers').then(r => r.json()).catch(() => [])
    setData(Array.isArray(res) ? res : [])
    setLoading(false)
  }

  useEffect(() => { fetch_() }, [])

  const totalLeftovers = data.reduce((s, o) =>
    s + o.sections.reduce((ss, sec) =>
      ss + sec.members.reduce((sss, m) => sss + m.leftover, 0), 0), 0)

  return (
    <div className="border border-border rounded-2xl overflow-hidden bg-card mb-6">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3.5 cursor-pointer select-none hover:bg-muted/30 transition-colors"
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-2.5">
          <PackageOpen size={16} className="text-primary" />
          <span className="font-bold text-sm">Available Leftovers</span>
          {!loading && totalLeftovers > 0 && (
            <span className="text-xs font-bold bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
              {totalLeftovers}
            </span>
          )}
          {!loading && data.length > 0 && (
            <span className="text-xs text-muted-foreground">across {data.length} order{data.length !== 1 ? 's' : ''}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={e => { e.stopPropagation(); fetch_() }}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
            title="Refresh"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          {collapsed ? <ChevronDown size={15} className="text-muted-foreground" /> : <ChevronUp size={15} className="text-muted-foreground" />}
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="border-t border-border">
          {loading ? (
            <div className="flex justify-center py-6">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : data.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No leftover slots across active orders 🎉</div>
          ) : (
            <div className="divide-y divide-border">
              {data.map(order => (
                <div key={order.id} className="px-5 py-3.5">
                  {/* Order label */}
                  <button
                    onClick={() => onSelectOrder?.(order.id)}
                    className="text-sm font-bold hover:text-primary transition-colors text-left mb-2.5"
                  >
                    {order.label}
                    <span className={`ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${order.type === 'personal' ? 'bg-violet-50 text-violet-600 border-violet-200' : 'bg-sky-50 text-sky-600 border-sky-200'}`}>
                      {order.type}
                    </span>
                  </button>

                  {/* Sections (one per version/type if multi) */}
                  <div className="space-y-2">
                    {order.sections.map((sec, si) => (
                      <div key={si}>
                        {sec.versionLabel && (
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                            {sec.versionLabel}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          {sec.members.map(m => (
                            <span
                              key={m.id}
                              className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                                sec.type === 'album'
                                  ? 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-300 dark:border-sky-800'
                                  : 'bg-muted text-muted-foreground border-border'
                              }`}
                            >
                              {m.name}
                              {m.leftover > 1 && (
                                <span className={`ml-1 font-bold ${sec.type === 'album' ? 'text-sky-500' : 'text-muted-foreground/60'}`}>
                                  ×{m.leftover}
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
