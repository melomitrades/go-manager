'use client'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Sidebar } from '@/components/shared/Sidebar'
import { DeadlineNotifications } from '@/components/shared/DeadlineNotifications'

export default function JoinerLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status])
  if (status === 'loading' || !session) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const user = session.user as any
  return (
    <div className="flex min-h-screen">
      <Sidebar role={user.role} username={user.display_name || user.username} onSignOut={() => signOut({ callbackUrl: '/login' })} />
      <main className="flex-1 overflow-auto pt-14 pb-16 md:pt-0 md:pb-0">{children}</main>
      <DeadlineNotifications />
    </div>
  )
}
