'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { Bell, X, Check } from 'lucide-react'

interface Notification {
  id: string
  message: string
  order_id: string | null
  created_at: string
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const fetch_ = useCallback(async () => {
    try {
      const data = await fetch('/api/notifications').then(r => r.json())
      setNotifications(Array.isArray(data) ? data : [])
    } catch {}
  }, [])

  useEffect(() => {
    fetch_()
    const interval = setInterval(fetch_, 30_000) // poll every 30s
    return () => clearInterval(interval)
  }, [fetch_])

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  async function dismiss(id: string) {
    setNotifications(prev => prev.filter(n => n.id !== id))
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
  }

  async function dismissAll() {
    setNotifications([])
    setOpen(false)
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read_all: true }),
    })
  }

  function timeAgo(ts: string) {
    const diff = (Date.now() - new Date(ts).getTime()) / 1000
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  const count = notifications.length

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="relative flex items-center justify-center w-8 h-8 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-80 bg-card border border-border rounded-2xl shadow-2xl z-50 overflow-hidden animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/30">
            <span className="text-sm font-bold">Notifications {count > 0 && <span className="text-primary">({count})</span>}</span>
            {count > 0 && (
              <button onClick={dismissAll} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <Check size={12}/> Mark all read
              </button>
            )}
          </div>

          {/* List */}
          {count === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              <Bell size={24} className="mx-auto mb-2 opacity-30" />
              All caught up!
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y divide-border">
              {notifications.map(n => (
                <div key={n.id} className="flex items-start gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors">
                  <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-snug">{n.message}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(n.created_at)}</p>
                  </div>
                  <button
                    onClick={() => dismiss(n.id)}
                    className="text-muted-foreground/50 hover:text-muted-foreground flex-shrink-0 mt-0.5 transition-colors"
                    title="Mark as read"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
