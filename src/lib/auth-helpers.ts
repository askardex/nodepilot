import { auth } from '@/lib/auth'

/**
 * Get the authenticated user from the current request.
 * Returns null if not authenticated.
 */
export async function getAuthUser() {
  const session = await auth()

  if (!session?.user?.id) return null

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: (session.user as { role?: string }).role ?? 'admin'
  }
}

/**
 * Require authentication — throws if not authenticated.
 * Use in API routes: const user = await requireAuth()
 */
export async function requireAuth() {
  const user = await getAuthUser()

  if (!user) {
    throw new Error('UNAUTHORIZED')
  }

  return user
}
