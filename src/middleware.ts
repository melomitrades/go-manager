import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl
    const role = req.nextauth.token?.role as string | undefined

    // Admin-only
    if (pathname.startsWith('/admin') && role !== 'admin') {
      return NextResponse.redirect(new URL('/login', req.url))
    }
    // GOM+ only
    if (pathname.startsWith('/gom') && !['gom', 'admin'].includes(role ?? '')) {
      return NextResponse.redirect(new URL('/joiner/orders', req.url))
    }
    // Joiner routes — accessible by all authenticated users (admin can browse as joiner)
    return NextResponse.next()
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const { pathname } = req.nextUrl
        if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) return true
        return !!token
      },
    },
  }
)

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
