'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminPaymentsRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/gom/payments') }, [])
  return null
}
