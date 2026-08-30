'use client'
import { useEffect, useState } from 'react'
import { Bell, X, Clock } from 'lucide-react'

interface DeadlineAlert {
  id: string
  label: string
  sublabel?: string
  deadline: string
  hoursLeft: number
}

export function DeadlineNotifications() {
  const [alerts, setAlerts] = useState<DeadlineAlert[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState(true)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    // Only show once per session
    const sessionKey = 'deadline_notif_shown'
    if (sessionStorage.getItem(sessionKey)) { setLoaded(true); return }

    async function load() {
      const found: DeadlineAlert[] = []
      const now = new Date()

      // Independent fetches — run them together instead of one after the other. This runs on
      // every joiner page load (it's mounted in the joiner layout), so the two sequential
      // round trips it used to make were pure added latency for something that's often not
      // even going to show anything.
      const [orders, boxes] = await Promise.all([
        fetch('/api/orders?viewAs=joiner').then(r => r.json()).catch(() => []),
        fetch('/api/boxes').then(r => r.json()).catch(() => []),
      ])

      try {
        for (const o of (Array.isArray(orders) ? orders : [])) {
          if (!o.deadline) continue
          const d = new Date(o.deadline)
          const hoursLeft = (d.getTime() - now.getTime()) / 3_600_000
          if (hoursLeft < 0 || hoursLeft > 72) continue // only show within 72h
          found.push({
            id: `order-${o.id}`,
            label: `${o.shop?.name || 'Order'} deadline`,
            sublabel: `${o.group?.name || ''} ${o.round_number ? '· ' + o.round_number : ''}`.trim(),
            deadline: o.deadline,
            hoursLeft,
          })
        }
      } catch {}

      try {
        for (const b of (Array.isArray(boxes) ? boxes : [])) {
          for (const [key, label] of [['ems_deadline', 'EMS Payment'], ['customs_deadline', 'Customs Payment']] as const) {
            if (!b[key]) continue
            const d = new Date(b[key])
            const hoursLeft = (d.getTime() - now.getTime()) / 3_600_000
            if (hoursLeft < 0 || hoursLeft > 72) continue
            found.push({ id: `${key}-${b.id}`, label: `${label}: ${b.label || 'Box'}`, deadline: b[key], hoursLeft })
          }
        }
      } catch {}

      if (found.length > 0) {
        setAlerts(found.sort((a, b) => a.hoursLeft - b.hoursLeft))
        sessionStorage.setItem(sessionKey, '1')
      }
      setLoaded(true)
    }
    load()
  }, [])

  const visible = alerts.filter(a => !dismissed.has(a.id))
  if (!loaded || visible.length === 0) return null

  function urgencyColor(h: number) {
    if (h < 24) return 'bg-red-500'
    if (h < 48) return 'bg-amber-500'
    return 'bg-amber-400'
  }

  function formatHours(h: number) {
    if (h < 24) return `${Math.floor(h)}h left`
    return `${Math.floor(h / 24)}d left`
  }

  return (
    <div className="fixed top-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] shadow-2xl rounded-2xl overflow-hidden border border-amber-200 bg-card animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200">
        <div className="flex items-center gap-2">
          <Bell size={14} className="text-amber-600" />
          <span className="text-sm font-bold text-amber-800 dark:text-amber-300">
            {visible.length} upcoming deadline{visible.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex gap-1">
          <button onClick={() => setExpanded(v => !v)} className="text-amber-600 hover:text-amber-800 text-xs px-1.5 py-0.5 rounded">
            {expanded ? 'Hide' : 'Show'}
          </button>
          <button onClick={() => setAlerts([])} className="text-amber-600 hover:text-amber-800">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Alerts list */}
      {expanded && (
        <div className="divide-y divide-border max-h-72 overflow-y-auto">
          {visible.map(a => (
            <div key={a.id} className="flex items-start gap-3 px-4 py-3 hover:bg-secondary/30">
              <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${urgencyColor(a.hoursLeft)}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-snug">{a.label}</p>
                {a.sublabel && <p className="text-xs text-muted-foreground">{a.sublabel}</p>}
                <p className="text-xs font-bold text-amber-600 mt-0.5 flex items-center gap-1">
                  <Clock size={10} /> {formatHours(a.hoursLeft)}
                </p>
              </div>
              <button onClick={() => setDismissed(s => new Set([...s, a.id]))} className="text-muted-foreground/50 hover:text-muted-foreground flex-shrink-0 mt-0.5">
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
