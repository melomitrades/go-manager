'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Fancalls moved to Events (old records: Events → Archive).
export default function FancallsRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/gom/events?tab=archive') }, [router])
  return null
}
