import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import NextAuth from 'next-auth'

const { auth } = NextAuth({
  session: { strategy: 'jwt' },
  providers: [],
  secret: process.env.AUTH_SECRET,
  pages: { signIn: '/login' }
})

export default auth((req) => {
  const { pathname } = req.nextUrl

  // Public routes — no auth required
  const publicPaths = ['/login', '/register', '/api/auth']
  const isPublic = publicPaths.some(route => pathname.startsWith(route))

  if (isPublic) return NextResponse.next()

  // Require authentication for everything else
  if (!req.auth?.user) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const loginUrl = new URL('/login', req.url)

    loginUrl.searchParams.set('callbackUrl', pathname)

    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|images|icons).*)']
}
