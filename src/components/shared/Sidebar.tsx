'use client'
import { NotificationBell } from './NotificationBell'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/types'
import {
  ShoppingBag, Box, CreditCard, Star, MapPin,
  Send, Music, Settings, LayoutDashboard, Users,
  Calendar, Truck, Package, Sun, Moon, LogOut, ToggleLeft, ToggleRight,
  Menu, X,
} from 'lucide-react'

const GOM_NAV = [
  { href: '/gom/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/gom/orders', label: 'Orders', icon: ShoppingBag },
  { href: '/gom/payments', label: 'Payments', icon: CreditCard },
  { href: '/gom/addy', label: 'Addy', icon: MapPin },
  { href: '/gom/boxes', label: 'Boxes', icon: Box },
  { href: '/gom/pc-sorter', label: 'Sorting', icon: Music },
  { href: '/gom/sending-out', label: 'Sending Out', icon: Send },
  { href: '/gom/fancalls', label: 'Fancalls', icon: Star },
  { href: '/gom/settings', label: 'Settings', icon: Settings },
]

const JOINER_NAV = [
  { href: '/joiner/orders', label: 'My Orders', icon: ShoppingBag },
  { href: '/joiner/deadlines', label: 'Deadlines', icon: Calendar },
  { href: '/joiner/shipping', label: 'Shipping', icon: Truck },
  { href: '/joiner/boxes', label: 'Boxes', icon: Package },
  { href: '/joiner/payments', label: 'Payments', icon: CreditCard },
  { href: '/joiner/pc-sorter', label: 'Sorting', icon: Music },
]

const ADMIN_NAV = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  ...GOM_NAV,
]

// Bottom nav items (most important 5 for mobile)
const GOM_BOTTOM_NAV = [
  { href: '/gom/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/gom/orders', label: 'Orders', icon: ShoppingBag },
  { href: '/gom/payments', label: 'Payments', icon: CreditCard },
  { href: '/gom/addy', label: 'Addy', icon: MapPin },
  { href: '/gom/boxes', label: 'Boxes', icon: Box },
]

const JOINER_BOTTOM_NAV = [
  { href: '/joiner/orders', label: 'Orders', icon: ShoppingBag },
  { href: '/joiner/deadlines', label: 'Deadlines', icon: Calendar },
  { href: '/joiner/payments', label: 'Payments', icon: CreditCard },
  { href: '/joiner/boxes', label: 'Boxes', icon: Package },
  { href: '/joiner/shipping', label: 'Shipping', icon: Truck },
]

interface SidebarProps {
  role: UserRole
  username: string
  onSignOut: () => void
}

export function Sidebar({ role, username, onSignOut }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const [joinersView, setJoinersView] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    if (role === 'admin') {
      const saved = localStorage.getItem('admin-joiner-view')
      setJoinersView(saved === 'true')
    }
  }, [role])

  useEffect(() => {
    if (role === 'admin') {
      const isOnJoinerPage = pathname.startsWith('/joiner/')
      const isOnAdminPage = pathname.startsWith('/admin/') || pathname.startsWith('/gom/')
      if (isOnJoinerPage) setJoinersView(true)
      else if (isOnAdminPage) setJoinersView(false)
    }
  }, [pathname, role])

  // Close mobile menu on route change
  useEffect(() => { setMobileMenuOpen(false) }, [pathname])

  const toggleView = () => {
    const newVal = !joinersView
    setJoinersView(newVal)
    localStorage.setItem('admin-joiner-view', String(newVal))
    router.push(newVal ? '/joiner/orders' : '/gom/orders')
  }

  let nav = GOM_NAV
  let bottomNav = GOM_BOTTOM_NAV
  let viewLabel = 'GOM View'
  if (role === 'joiner') { nav = JOINER_NAV; bottomNav = JOINER_BOTTOM_NAV; viewLabel = 'Joiner View' }
  else if (role === 'admin') {
    nav = joinersView ? JOINER_NAV : GOM_NAV
    bottomNav = joinersView ? JOINER_BOTTOM_NAV : GOM_BOTTOM_NAV
    viewLabel = joinersView ? 'Joiner View' : 'Admin View'
  }

  return (
    <>
      {/* ── DESKTOP SIDEBAR ── hidden on mobile */}
      <aside className="hidden md:flex flex-col w-64 border-r border-border h-screen sticky top-0 sidebar-gradient flex-shrink-0">
        {/* Logo */}
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-shrink-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-rose-sm">
                <span className="text-white font-display font-bold text-sm">G</span>
              </div>
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 text-gold sparkle text-[8px]">✦</span>
            </div>
            <div className="min-w-0">
              <p className="font-display font-semibold text-sm leading-tight">Giantz GO</p>
              <p className="text-xs text-muted-foreground">{viewLabel}</p>
            </div>
          </div>
          {role === 'admin' && (
            <button onClick={toggleView} className={cn('mt-3 w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold border transition-all', joinersView ? 'bg-primary/10 text-primary border-primary/20' : 'bg-secondary text-muted-foreground border-border hover:bg-secondary/70')}>
              <span className="flex items-center gap-2">{joinersView ? <ToggleRight size={14}/> : <ToggleLeft size={14}/>}{joinersView ? 'Joiner view active' : 'Switch to Joiner view'}</span>
              <span className="opacity-60">{joinersView ? '→ Admin' : '→ Joiner'}</span>
            </button>
          )}
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link key={href} href={href} className={cn('flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group relative', active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary')}>
                {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full"/>}
                <Icon size={16} className={cn('transition-colors flex-shrink-0', active ? 'text-primary' : 'text-muted-foreground/70 group-hover:text-foreground')}/>
                <span className="truncate">{label}</span>
              </Link>
            )
          })}
        </nav>

        <div className="px-3 py-4 border-t border-border space-y-1">
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-secondary w-full transition-all">
            {theme === 'dark' ? <Sun size={15}/> : <Moon size={15}/>}
            <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
          </button>
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-primary/5 border border-primary/10">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center flex-shrink-0">
              <span className="text-primary text-xs font-bold">{username.slice(0,2).toUpperCase()}</span>
            </div>
            <span className="flex-1 text-sm font-medium truncate">{username}</span>
            {role === 'joiner' && <NotificationBell />}
            <button onClick={onSignOut} className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0" title="Sign out"><LogOut size={14}/></button>
          </div>
        </div>
      </aside>

      {/* ── MOBILE TOP BAR ── shown only on mobile */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-sm border-b border-border flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center">
            <span className="text-white font-display font-bold text-xs">G</span>
          </div>
          <span className="font-display font-semibold text-sm">Giantz GO</span>
        </div>
        <div className="flex items-center gap-1">
          {role === 'joiner' && <NotificationBell />}
          <button onClick={() => setMobileMenuOpen(v => !v)} className="p-2 rounded-xl hover:bg-secondary transition-colors">
            {mobileMenuOpen ? <X size={20}/> : <Menu size={20}/>}
          </button>
        </div>
      </div>

      {/* ── MOBILE SLIDE-DOWN MENU ── */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-30 flex flex-col" style={{top: 56}}>
          <div className="bg-card/98 backdrop-blur-sm border-b border-border flex-1 overflow-y-auto px-4 py-4 space-y-1 max-h-screen">
            {nav.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(href + '/')
              return (
                <Link key={href} href={href} className={cn('flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition-all', active ? 'bg-primary text-primary-foreground shadow-rose-sm' : 'text-muted-foreground hover:bg-secondary hover:text-foreground')}>
                  <Icon size={18}/><span>{label}</span>
                </Link>
              )
            })}
            <div className="pt-4 pb-2 border-t border-border mt-3 space-y-1">
              {role === 'admin' && (
                <button onClick={toggleView} className="flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold text-muted-foreground hover:bg-secondary w-full">
                  {joinersView ? <ToggleRight size={18}/> : <ToggleLeft size={18}/>}
                  {joinersView ? 'Switch to Admin view' : 'Switch to Joiner view'}
                </button>
              )}
              <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold text-muted-foreground hover:bg-secondary w-full">
                {theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}<span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
              </button>
              <button onClick={onSignOut} className="flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold text-destructive hover:bg-destructive/10 w-full">
                <LogOut size={18}/><span>Sign out</span>
              </button>
            </div>
          </div>
          <div className="flex-1" onClick={() => setMobileMenuOpen(false)}/>
        </div>
      )}

      {/* ── MOBILE BOTTOM NAV ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-sm border-t border-border flex items-stretch h-16 safe-area-pb">
        {bottomNav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link key={href} href={href} className={cn('flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-all pt-1', active ? 'text-primary' : 'text-muted-foreground')}>
              <Icon size={20} className={active ? 'text-primary' : 'text-muted-foreground'}/>
              {label}
            </Link>
          )
        })}
        {/* More button */}
        <button onClick={() => setMobileMenuOpen(v => !v)} className={cn('flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-all pt-1', mobileMenuOpen ? 'text-primary' : 'text-muted-foreground')}>
          <Menu size={20}/> More
        </button>
      </nav>
    </>
  )
}
