/**
 * CLI Auth Utility Module
 *
 * Handles session management for CLI authentication.
 */

// ============================================================================
// Types
// ============================================================================

export interface Session {
  userId: string
  email: string
  accessToken: string
  expiresAt: string
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Get the current session
 */
export async function getSession(): Promise<Session | null> {
  return null
}
