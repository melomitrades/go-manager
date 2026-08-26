'use client'
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    const res = await signIn('credentials', { username, password, redirect: false })
    if (res?.error) { setError('Invalid username or password'); setLoading(false); return }
    const session = await fetch('/api/auth/session').then(r => r.json())
    const role = session?.user?.role
    if (role === 'admin') router.push('/admin/dashboard')
    else if (role === 'gom') router.push('/gom/orders')
    else router.push('/joiner/orders')
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* Decorative left panel */}
      <div className="hidden md:flex w-[42%] bg-gradient-to-br from-primary via-primary/80 to-rose-400 flex-col items-center justify-center relative overflow-hidden">
        {/* Dot grid */}
        <div className="absolute inset-0 opacity-[0.08]" style={{backgroundImage:'radial-gradient(circle, white 1px, transparent 0)',backgroundSize:'28px 28px'}}/>
        {/* Decorative circles */}
        <div className="absolute -top-20 -right-20 w-72 h-72 bg-white/5 rounded-full" />
        <div className="absolute -bottom-16 -left-16 w-56 h-56 bg-white/5 rounded-full" />
        <div className="absolute top-1/3 right-8 w-4 h-4 bg-white/30 rounded-full sparkle" />
        <div className="absolute bottom-1/3 left-12 w-3 h-3 bg-white/20 rounded-full sparkle" />

        <div className="relative text-center text-white px-12 z-10">
          <div className="mb-8">
            <div className="text-5xl mb-3">✦</div>
            <p className="text-white/60 text-xs uppercase tracking-[0.3em] font-semibold mb-2">by Giantz</p>
          </div>
          <h1 className="font-display text-4xl font-bold leading-tight mb-4">
            Group Order<br/>Manager
          </h1>
          <p className="text-white/65 text-base leading-relaxed max-w-[240px] mx-auto">
            Your K-pop GO management platform — orders, shipping & more
          </p>
          <div className="flex justify-center gap-4 mt-10">
            <span className="text-white/20 sparkle text-2xl">✦</span>
            <span className="text-white/40 sparkle text-lg">♡</span>
            <span className="text-white/20 sparkle text-2xl">✦</span>
          </div>
        </div>
      </div>

      {/* Right: form */}
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="w-full max-w-[360px]">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-rose-md">
              <span className="text-white font-display font-bold">G</span>
            </div>
            <div>
              <p className="font-display font-semibold">Giantz GO</p>
              <p className="text-xs text-muted-foreground">Group Order Manager</p>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="font-display text-3xl font-semibold">Welcome back</h2>
            <p className="text-muted-foreground mt-1.5 text-sm">Sign in to your account ✦</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Username</label>
              <input type="text" value={username} onChange={e=>setUsername(e.target.value)} required placeholder="your_username"
                className="w-full px-4 py-3 rounded-xl border border-input bg-background text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/60 transition-all" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Password</label>
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required placeholder="••••••••"
                className="w-full px-4 py-3 rounded-xl border border-input bg-background text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/60 transition-all" />
            </div>
            {error && <div className="bg-destructive/6 border border-destructive/20 text-destructive text-sm rounded-xl px-4 py-3">{error}</div>}
            <button type="submit" disabled={loading}
              className="w-full py-3 bg-primary text-white rounded-xl text-sm font-bold hover:opacity-90 active:scale-[0.98] transition-all shadow-rose-sm hover:shadow-rose-md disabled:opacity-50 mt-1">
              {loading ? 'Signing in…' : 'Sign in →'}
            </button>
          </form>
          <p className="text-center text-xs text-muted-foreground/60 mt-8">Access by invitation only</p>
        </div>
      </div>
    </div>
  )
}
