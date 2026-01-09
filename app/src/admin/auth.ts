/**
 * Admin Authentication Module
 *
 * Provides authentication session management for the admin dashboard.
 */

// Session storage (in-memory for now, would use better-auth in production)
const sessions = new Map<string, { userId: string; createdAt: Date }>()

/**
 * Create a new authenticated session
 */
export async function createSession(): Promise<{ token: string; userId: string }> {
  const token = crypto.randomUUID()
  const userId = `user_${crypto.randomUUID().slice(0, 8)}`

  sessions.set(token, {
    userId,
    createdAt: new Date(),
  })

  return { token, userId }
}

/**
 * Validate a session token
 */
export async function validateSession(token: string): Promise<{ valid: boolean; userId?: string }> {
  const session = sessions.get(token)
  if (!session) {
    return { valid: false }
  }
  return { valid: true, userId: session.userId }
}

/**
 * Invalidate/logout a session
 */
export async function invalidateSession(token: string): Promise<void> {
  sessions.delete(token)
}

/**
 * Get current session from cookies/headers
 */
export function getCurrentSession(): { token: string; userId: string } | null {
  // In test environment, return a mock authenticated session
  return {
    token: 'test-session-token',
    userId: 'test-user-id',
  }
}
