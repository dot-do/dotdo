/**
 * Session Validation Module
 *
 * Provides Better Auth session validation functionality.
 * Validates session tokens, checks expiry, handles bans, and supports auto-refresh.
 *
 * @module @dotdo/payload/auth/session
 */

import type { SessionValidationResult, BetterAuthUser, SessionData } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Database interface for session validation queries.
 * This abstraction allows mocking in tests and supports different database adapters.
 */
export interface SessionDatabase {
  /**
   * Query session by token with joined user data.
   */
  getSessionByToken(token: string): Promise<SessionWithUser | null>

  /**
   * Update session expiry for refresh.
   */
  updateSessionExpiry(sessionId: string, newExpiresAt: Date): Promise<void>
}

/**
 * Session record joined with user data from database.
 */
export interface SessionWithUser {
  session: {
    id: string
    token: string
    userId: string
    expiresAt: Date
    ipAddress: string | null
    userAgent: string | null
    activeOrganizationId: string | null
    activeTeamId: string | null
    impersonatedBy: string | null
    createdAt: Date
    updatedAt: Date
  }
  user: {
    id: string
    name: string
    email: string
    emailVerified: boolean
    image: string | null
    role: 'user' | 'admin' | 'owner' | null
    banned: boolean | null
    banReason: string | null
    banExpires: Date | null
    createdAt: Date
    updatedAt: Date
  }
}

/**
 * Options for session validation.
 */
export interface ValidateSessionOptions {
  /**
   * Whether to extend session if near expiry.
   * Default: false
   */
  autoRefresh?: boolean

  /**
   * Session refresh threshold in milliseconds.
   * If session expires within this time, it will be refreshed.
   * Default: 24 hours (86400000ms)
   */
  refreshThreshold?: number

  /**
   * New session duration when refreshed, in milliseconds.
   * Default: 7 days (604800000ms)
   */
  refreshDuration?: number
}

// ============================================================================
// Constants
// ============================================================================

/** Default refresh threshold: 24 hours */
const DEFAULT_REFRESH_THRESHOLD = 24 * 60 * 60 * 1000

/** Default refresh duration: 7 days */
const DEFAULT_REFRESH_DURATION = 7 * 24 * 60 * 60 * 1000

// ============================================================================
// Session Validation
// ============================================================================

/**
 * Validates a Better Auth session token.
 *
 * @param db - Database interface for queries
 * @param token - Session token to validate
 * @param options - Validation options
 * @returns SessionValidationResult with user data or error
 *
 * @example
 * ```typescript
 * const result = await validateSession(db, sessionToken)
 * if (result.valid) {
 *   console.log('User:', result.user.email)
 * } else {
 *   console.error('Invalid session:', result.error)
 * }
 * ```
 */
export async function validateSession(
  db: SessionDatabase,
  token: string,
  options: ValidateSessionOptions = {},
): Promise<SessionValidationResult> {
  // Check for empty/null/undefined token
  if (!token) {
    return { valid: false, error: 'invalid_token' }
  }

  try {
    // Query session with user data
    const sessionWithUser = await db.getSessionByToken(token)

    // Session not found
    if (!sessionWithUser) {
      return { valid: false, error: 'session_not_found' }
    }

    const { session, user } = sessionWithUser
    const now = new Date()

    // Check if session is expired (at or past expiry time)
    if (now >= session.expiresAt) {
      return { valid: false, error: 'session_expired' }
    }

    // Check if user is banned
    if (user.banned) {
      // If banExpires is set, check if ban has expired
      if (user.banExpires && now >= user.banExpires) {
        // Ban has expired, user is allowed
      } else {
        // User is still banned (either no expiry or not yet expired)
        return { valid: false, error: 'user_banned' }
      }
    }

    // Handle auto-refresh if enabled
    if (options.autoRefresh) {
      const threshold = options.refreshThreshold ?? DEFAULT_REFRESH_THRESHOLD
      const timeUntilExpiry = session.expiresAt.getTime() - now.getTime()

      if (timeUntilExpiry < threshold) {
        // Session is near expiry, refresh it
        const duration = options.refreshDuration ?? DEFAULT_REFRESH_DURATION
        const newExpiresAt = new Date(now.getTime() + duration)
        await db.updateSessionExpiry(session.id, newExpiresAt)
      }
    }

    // Build successful result
    const betterAuthUser: BetterAuthUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      role: user.role,
      image: user.image,
      banned: user.banned ?? false,
      banReason: user.banReason,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }

    const sessionData: SessionData = {
      id: session.id,
      token: session.token,
      expiresAt: session.expiresAt,
      userId: session.userId,
    }

    return {
      valid: true,
      user: betterAuthUser,
      session: sessionData,
    }
  } catch (error) {
    // Handle any database errors gracefully
    return { valid: false, error: 'database_error' }
  }
}
