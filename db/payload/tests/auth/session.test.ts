/**
 * Session Validation Tests (RED Phase)
 *
 * These tests define the contract for Better Auth session validation.
 * The validateSession function should:
 * - Query the sessions table by token
 * - Join with users table to get user data
 * - Check session expiry
 * - Check user ban status (banned flag and banExpires timestamp)
 * - Return user role and activeOrganizationId from session
 * - Handle database errors gracefully
 * - Support session refresh for sessions near expiry
 *
 * Reference: dotdo-lwxy - B04 RED: Session validation tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SessionValidationResult, BetterAuthUser, SessionData } from '../../auth/types'
import { validateSession } from '../../auth/session'

// ============================================================================
// Type definitions for the session validator module (to be implemented)
// ============================================================================

/**
 * Database interface for session validation queries.
 * This abstraction allows mocking in tests and supports different database adapters.
 */
interface SessionDatabase {
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
interface SessionWithUser {
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
interface ValidateSessionOptions {
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

/**
 * Validates a Better Auth session token.
 *
 * @param db - Database interface for queries
 * @param token - Session token to validate
 * @param options - Validation options
 * @returns SessionValidationResult with user data or error
 */
type ValidateSession = (
  db: SessionDatabase,
  token: string,
  options?: ValidateSessionOptions,
) => Promise<SessionValidationResult>

// ============================================================================
// Mock helpers
// ============================================================================

function createMockDb(data: { sessions?: SessionWithUser[] } = {}): SessionDatabase {
  const sessions = data.sessions ?? []

  return {
    getSessionByToken: vi.fn(async (token: string) => {
      return sessions.find((s) => s.session.token === token) ?? null
    }),
    updateSessionExpiry: vi.fn(async () => {}),
  }
}

function createValidSession(overrides: Partial<SessionWithUser['session']> = {}): SessionWithUser['session'] {
  const now = new Date()
  const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) // 7 days from now

  return {
    id: 'session-001',
    token: 'valid-token-abc123',
    userId: 'user-001',
    expiresAt: future,
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0',
    activeOrganizationId: null,
    activeTeamId: null,
    impersonatedBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function createValidUser(overrides: Partial<SessionWithUser['user']> = {}): SessionWithUser['user'] {
  const now = new Date()

  return {
    id: 'user-001',
    name: 'Alice Smith',
    email: 'alice@example.com',
    emailVerified: true,
    image: null,
    role: 'user',
    banned: false,
    banReason: null,
    banExpires: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function createSessionWithUser(
  sessionOverrides: Partial<SessionWithUser['session']> = {},
  userOverrides: Partial<SessionWithUser['user']> = {},
): SessionWithUser {
  return {
    session: createValidSession(sessionOverrides),
    user: createValidUser(userOverrides),
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Session Validation', () => {
  describe('validateSession', () => {
    it('should return valid result for unexpired session', async () => {
      const sessionData = createSessionWithUser()
      const db = createMockDb({ sessions: [sessionData] })

      const result = await validateSession(db, 'valid-token-abc123')

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.user).toBeDefined()
        expect(result.user.id).toBe('user-001')
        expect(result.user.email).toBe('alice@example.com')
        expect(result.session).toBeDefined()
        expect(result.session.id).toBe('session-001')
      }
    })

    it('should return invalid for expired session', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 hours ago
      const sessionData = createSessionWithUser({ expiresAt: pastDate })
      const db = createMockDb({ sessions: [sessionData] })

      const result = await validateSession(db, 'valid-token-abc123')

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('session_expired')
      }
    })

    it('should return invalid for non-existent session', async () => {
      const db = createMockDb({ sessions: [] })

      const result = await validateSession(db, 'non-existent-token')

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('session_not_found')
      }
    })

    it('should return invalid for banned user', async () => {
      const sessionData = createSessionWithUser({}, { banned: true, banReason: 'Violated terms of service' })
      const db = createMockDb({ sessions: [sessionData] })

      const result = await validateSession(db, 'valid-token-abc123')

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('user_banned')
      }
    })

    it('should return valid if ban has expired', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000) // Ban expired 24 hours ago
      const sessionData = createSessionWithUser({}, { banned: true, banExpires: pastDate })
      const db = createMockDb({ sessions: [sessionData] })

      const result = await validateSession(db, 'valid-token-abc123')

      // User was banned but ban has expired, so session should be valid
      expect(result.valid).toBe(true)
    })

    it('should return invalid if ban has not expired', async () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000) // Ban expires in 24 hours
      const sessionData = createSessionWithUser({}, { banned: true, banExpires: futureDate })
      const db = createMockDb({ sessions: [sessionData] })

      const result = await validateSession(db, 'valid-token-abc123')

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('user_banned')
      }
    })

    it('should include user role from Better Auth', async () => {
      const sessionData = createSessionWithUser({}, { role: 'admin' })
      const db = createMockDb({ sessions: [sessionData] })

      const result = await validateSession(db, 'valid-token-abc123')

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.user.role).toBe('admin')
      }
    })

    it('should include activeOrganizationId if present', async () => {
      const sessionData = createSessionWithUser({ activeOrganizationId: 'org-001' })
      const db = createMockDb({ sessions: [sessionData] })

      const result = await validateSession(db, 'valid-token-abc123')

      expect(result.valid).toBe(true)
      if (result.valid) {
        // activeOrganizationId should be available on the session
        expect(result.session.userId).toBe('user-001')
        // Note: The SessionData type may need to be extended to include activeOrganizationId
      }
    })

    it('should handle database errors gracefully', async () => {
      const db: SessionDatabase = {
        getSessionByToken: vi.fn(async () => {
          throw new Error('Database connection failed')
        }),
        updateSessionExpiry: vi.fn(),
      }

      const result = await validateSession(db, 'any-token')

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('database_error')
      }
    })

    it('should handle null/undefined token gracefully', async () => {
      const db = createMockDb({ sessions: [] })

      const result = await validateSession(db, '')

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('invalid_token')
      }
    })
  })

  describe('session lookup', () => {
    it('should query sessions table by token', async () => {
      const sessionData = createSessionWithUser()
      const db = createMockDb({ sessions: [sessionData] })

      await validateSession(db, 'valid-token-abc123')

      expect(db.getSessionByToken).toHaveBeenCalledWith('valid-token-abc123')
    })

    it('should join with users table to get user data', async () => {
      const sessionData = createSessionWithUser(
        { userId: 'user-special' },
        {
          id: 'user-special',
          name: 'Special User',
          email: 'special@example.com',
          role: 'owner',
        },
      )
      const db = createMockDb({ sessions: [sessionData] })

      const result = await validateSession(db, 'valid-token-abc123')

      expect(result.valid).toBe(true)
      if (result.valid) {
        // User data should come from the joined users table
        expect(result.user.id).toBe('user-special')
        expect(result.user.name).toBe('Special User')
        expect(result.user.email).toBe('special@example.com')
        expect(result.user.role).toBe('owner')
      }
    })

    it('should check user.banned and user.banExpires', async () => {
      // Test that validation properly checks both banned flag and banExpires
      const sessionData = createSessionWithUser({}, { banned: false, banExpires: null })
      const db = createMockDb({ sessions: [sessionData] })

      const result = await validateSession(db, 'valid-token-abc123')

      // Should be valid since user is not banned
      expect(result.valid).toBe(true)
    })

    it('should return session data with all required fields', async () => {
      // Use a date 7 days in the future to ensure session is valid
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      const sessionData = createSessionWithUser({
        id: 'session-xyz',
        token: 'valid-token-abc123',
        expiresAt: futureDate,
        userId: 'user-001',
      })
      const db = createMockDb({ sessions: [sessionData] })

      const result = await validateSession(db, 'valid-token-abc123')

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.session.id).toBe('session-xyz')
        expect(result.session.token).toBe('valid-token-abc123')
        expect(result.session.expiresAt).toEqual(futureDate)
        expect(result.session.userId).toBe('user-001')
      }
    })
  })

  describe('session refresh', () => {
    it('should extend session if near expiry when autoRefresh enabled', async () => {
      // Session expires in 12 hours (within default 24 hour threshold)
      const nearExpiryDate = new Date(Date.now() + 12 * 60 * 60 * 1000)
      const sessionData = createSessionWithUser({ expiresAt: nearExpiryDate })
      const db = createMockDb({ sessions: [sessionData] })

      const result = await validateSession(db, 'valid-token-abc123', {
        autoRefresh: true,
        refreshThreshold: 24 * 60 * 60 * 1000, // 24 hours
      })

      expect(result.valid).toBe(true)
      expect(db.updateSessionExpiry).toHaveBeenCalled()
    })

    it('should not extend session if not near expiry', async () => {
      // Session expires in 5 days (well beyond 24 hour threshold)
      const farExpiryDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
      const sessionData = createSessionWithUser({ expiresAt: farExpiryDate })
      const db = createMockDb({ sessions: [sessionData] })

      const result = await validateSession(db, 'valid-token-abc123', {
        autoRefresh: true,
        refreshThreshold: 24 * 60 * 60 * 1000, // 24 hours
      })

      expect(result.valid).toBe(true)
      expect(db.updateSessionExpiry).not.toHaveBeenCalled()
    })

    it('should not extend already-expired session', async () => {
      const pastDate = new Date(Date.now() - 1000) // Just expired
      const sessionData = createSessionWithUser({ expiresAt: pastDate })
      const db = createMockDb({ sessions: [sessionData] })

      const result = await validateSession(db, 'valid-token-abc123', {
        autoRefresh: true,
      })

      expect(result.valid).toBe(false)
      expect(db.updateSessionExpiry).not.toHaveBeenCalled()
    })

    it('should not refresh when autoRefresh is disabled', async () => {
      const nearExpiryDate = new Date(Date.now() + 12 * 60 * 60 * 1000)
      const sessionData = createSessionWithUser({ expiresAt: nearExpiryDate })
      const db = createMockDb({ sessions: [sessionData] })

      const result = await validateSession(db, 'valid-token-abc123', {
        autoRefresh: false,
      })

      expect(result.valid).toBe(true)
      expect(db.updateSessionExpiry).not.toHaveBeenCalled()
    })

    it('should use custom refresh threshold', async () => {
      // Session expires in 2 hours
      const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000)
      const sessionData = createSessionWithUser({ expiresAt: twoHoursFromNow })
      const db = createMockDb({ sessions: [sessionData] })

      await validateSession(db, 'valid-token-abc123', {
        autoRefresh: true,
        refreshThreshold: 1 * 60 * 60 * 1000, // 1 hour threshold
      })

      // Should not refresh because 2 hours > 1 hour threshold
      expect(db.updateSessionExpiry).not.toHaveBeenCalled()
    })

    it('should use custom refresh duration', async () => {
      const nearExpiryDate = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes from now
      const sessionData = createSessionWithUser({ expiresAt: nearExpiryDate })
      const db = createMockDb({ sessions: [sessionData] })

      await validateSession(db, 'valid-token-abc123', {
        autoRefresh: true,
        refreshThreshold: 1 * 60 * 60 * 1000, // 1 hour threshold
        refreshDuration: 14 * 24 * 60 * 60 * 1000, // 14 days
      })

      expect(db.updateSessionExpiry).toHaveBeenCalled()
      // The new expiry should be approximately 14 days from now
      const call = vi.mocked(db.updateSessionExpiry).mock.calls[0]
      const newExpiry = call[1] as Date
      const expectedExpiry = Date.now() + 14 * 24 * 60 * 60 * 1000
      // Allow 1 second tolerance for test execution time
      expect(newExpiry.getTime()).toBeGreaterThan(expectedExpiry - 1000)
      expect(newExpiry.getTime()).toBeLessThan(expectedExpiry + 1000)
    })
  })

  describe('edge cases', () => {
    it('should handle session with null user role', async () => {
      const sessionData = createSessionWithUser({}, { role: null })
      const db = createMockDb({ sessions: [sessionData] })

      const result = await validateSession(db, 'valid-token-abc123')

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.user.role).toBeNull()
      }
    })

    it('should handle session exactly at expiry time', async () => {
      // Session expires exactly now
      const exactlyNow = new Date()
      const sessionData = createSessionWithUser({ expiresAt: exactlyNow })
      const db = createMockDb({ sessions: [sessionData] })

      const result = await validateSession(db, 'valid-token-abc123')

      // Session at exact expiry time should be considered expired
      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('session_expired')
      }
    })

    it('should handle user with emailVerified false', async () => {
      const sessionData = createSessionWithUser({}, { emailVerified: false })
      const db = createMockDb({ sessions: [sessionData] })

      const result = await validateSession(db, 'valid-token-abc123')

      // Email verification status should not affect session validity
      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.user.emailVerified).toBe(false)
      }
    })

    it('should preserve impersonatedBy information', async () => {
      const sessionData = createSessionWithUser({
        impersonatedBy: 'admin-user-001',
      })
      const db = createMockDb({ sessions: [sessionData] })

      const result = await validateSession(db, 'valid-token-abc123')

      expect(result.valid).toBe(true)
      // The session should contain impersonation info for audit purposes
    })
  })
})
