/**
 * @dotdo/clerk - Clerk Sessions Compatibility Layer Tests
 *
 * RED Phase TDD tests for Clerk session handling compatibility.
 * These tests should FAIL because the implementation doesn't exist yet.
 *
 * Tests cover the Clerk Backend API for sessions:
 * - Create session
 * - Get session
 * - Revoke session
 * - List sessions
 * - Session token verification
 * - Session expiration handling
 *
 * @see https://clerk.com/docs/reference/backend-api/tag/Sessions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Clerk,
  ClerkAPIError,
  type Session,
  type SessionList,
  type SessionToken,
  type VerifySessionOptions,
  type CreateSessionParams,
  type RevokeSessionParams,
  type ListSessionsParams,
} from '../index'

// =============================================================================
// Mock Helpers
// =============================================================================

const mockFetch = vi.fn()

function createMockResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Creates a mock Clerk session object matching the Clerk API response format
 */
function mockSession(overrides: Partial<Session> = {}): Session {
  const now = Date.now()
  return {
    id: 'sess_test123',
    object: 'session',
    client_id: 'client_test123',
    user_id: 'user_test123',
    status: 'active',
    last_active_at: now,
    expire_at: now + 7 * 24 * 60 * 60 * 1000, // 7 days from now
    abandon_at: now + 30 * 24 * 60 * 60 * 1000, // 30 days from now
    created_at: now - 60 * 60 * 1000, // 1 hour ago
    updated_at: now,
    ...overrides,
  }
}

/**
 * Creates a mock Clerk session list response
 */
function mockSessionList(sessions: Session[], totalCount?: number): SessionList {
  return {
    data: sessions,
    total_count: totalCount ?? sessions.length,
  }
}

/**
 * Creates a mock session token response
 */
function mockSessionToken(overrides: Partial<SessionToken> = {}): SessionToken {
  return {
    object: 'token',
    jwt: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyX3Rlc3QxMjMiLCJpYXQiOjE2MDk0NTkyMDAsImV4cCI6MTYwOTQ2MjgwMH0.signature',
    ...overrides,
  }
}

// =============================================================================
// Clerk Client Initialization Tests
// =============================================================================

describe('@dotdo/clerk - Client Initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should create a Clerk instance with secret key', () => {
      const clerk = new Clerk({ secretKey: 'sk_test_xxx' })

      expect(clerk).toBeDefined()
      expect(clerk.sessions).toBeDefined()
    })

    it('should throw error without secret key', () => {
      expect(() => new Clerk({ secretKey: '' })).toThrow('Clerk secret key is required')
    })

    it('should accept publishable key for frontend operations', () => {
      const clerk = new Clerk({
        secretKey: 'sk_test_xxx',
        publishableKey: 'pk_test_xxx',
      })

      expect(clerk).toBeDefined()
    })

    it('should accept custom API URL', () => {
      const clerk = new Clerk({
        secretKey: 'sk_test_xxx',
        apiUrl: 'https://custom.clerk.dev',
      })

      expect(clerk).toBeDefined()
    })

    it('should accept API version override', () => {
      const clerk = new Clerk({
        secretKey: 'sk_test_xxx',
        apiVersion: '2024-01-01',
      })

      expect(clerk).toBeDefined()
    })
  })
})

// =============================================================================
// Sessions Resource Tests
// =============================================================================

describe('@dotdo/clerk - Sessions', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Create Session
  // ===========================================================================

  describe('createSession', () => {
    it('should create a session for a user', async () => {
      const expectedSession = mockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedSession))

      const session = await clerk.sessions.createSession({
        userId: 'user_test123',
      })

      expect(session.id).toBe('sess_test123')
      expect(session.user_id).toBe('user_test123')
      expect(session.status).toBe('active')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/sessions'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk_test_xxx',
            'Content-Type': 'application/json',
          }),
        })
      )
    })

    it('should create a session with custom expiration', async () => {
      const customExpiry = Date.now() + 24 * 60 * 60 * 1000 // 24 hours
      const expectedSession = mockSession({ expire_at: customExpiry })
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedSession))

      const session = await clerk.sessions.createSession({
        userId: 'user_test123',
        expireAt: customExpiry,
      })

      expect(session.expire_at).toBe(customExpiry)
    })

    it('should create a session with actor (impersonation)', async () => {
      const expectedSession = mockSession({
        actor: {
          sub: 'user_admin123',
          actor_id: 'user_admin123',
        },
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedSession))

      const session = await clerk.sessions.createSession({
        userId: 'user_test123',
        actor: {
          sub: 'user_admin123',
        },
      })

      expect(session.actor).toBeDefined()
      expect(session.actor?.sub).toBe('user_admin123')
    })

    it('should handle invalid user ID error', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'User not found',
                long_message: 'The requested user could not be found',
              },
            ],
          },
          404
        )
      )

      await expect(
        clerk.sessions.createSession({ userId: 'user_nonexistent' })
      ).rejects.toThrow(ClerkAPIError)

      try {
        await clerk.sessions.createSession({ userId: 'user_nonexistent' })
      } catch (error) {
        expect(error).toBeInstanceOf(ClerkAPIError)
        const clerkError = error as ClerkAPIError
        expect(clerkError.code).toBe('resource_not_found')
        expect(clerkError.status).toBe(404)
      }
    })
  })

  // ===========================================================================
  // Get Session
  // ===========================================================================

  describe('getSession', () => {
    it('should retrieve a session by ID', async () => {
      const expectedSession = mockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedSession))

      const session = await clerk.sessions.getSession('sess_test123')

      expect(session.id).toBe('sess_test123')
      expect(session.object).toBe('session')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/sessions/sess_test123'),
        expect.objectContaining({
          method: 'GET',
        })
      )
    })

    it('should return session with all fields populated', async () => {
      const expectedSession = mockSession({
        last_active_organization_id: 'org_test123',
        actor: {
          sub: 'user_admin123',
          actor_id: 'user_admin123',
        },
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedSession))

      const session = await clerk.sessions.getSession('sess_test123')

      expect(session.last_active_organization_id).toBe('org_test123')
      expect(session.actor).toBeDefined()
    })

    it('should handle session not found error', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'Session not found',
              },
            ],
          },
          404
        )
      )

      await expect(
        clerk.sessions.getSession('sess_nonexistent')
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle expired session status', async () => {
      const expiredSession = mockSession({
        status: 'expired',
        expire_at: Date.now() - 1000,
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(expiredSession))

      const session = await clerk.sessions.getSession('sess_test123')

      expect(session.status).toBe('expired')
    })

    it('should handle revoked session status', async () => {
      const revokedSession = mockSession({
        status: 'revoked',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(revokedSession))

      const session = await clerk.sessions.getSession('sess_test123')

      expect(session.status).toBe('revoked')
    })
  })

  // ===========================================================================
  // Revoke Session
  // ===========================================================================

  describe('revokeSession', () => {
    it('should revoke a session by ID', async () => {
      const revokedSession = mockSession({ status: 'revoked' })
      mockFetch.mockResolvedValueOnce(createMockResponse(revokedSession))

      const session = await clerk.sessions.revokeSession('sess_test123')

      expect(session.status).toBe('revoked')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/sessions/sess_test123/revoke'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should handle revoking an already revoked session', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'session_already_revoked',
                message: 'Session has already been revoked',
              },
            ],
          },
          400
        )
      )

      await expect(
        clerk.sessions.revokeSession('sess_test123')
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle revoking an expired session', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'session_expired',
                message: 'Session has expired',
              },
            ],
          },
          400
        )
      )

      await expect(
        clerk.sessions.revokeSession('sess_test123')
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle revoking a non-existent session', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'Session not found',
              },
            ],
          },
          404
        )
      )

      await expect(
        clerk.sessions.revokeSession('sess_nonexistent')
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  // ===========================================================================
  // List Sessions
  // ===========================================================================

  describe('listSessions', () => {
    it('should list all sessions', async () => {
      const sessions = [mockSession(), mockSession({ id: 'sess_test456' })]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSessionList(sessions)))

      const result = await clerk.sessions.listSessions()

      expect(result.data).toHaveLength(2)
      expect(result.total_count).toBe(2)
    })

    it('should list sessions for a specific user', async () => {
      const sessions = [mockSession()]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSessionList(sessions)))

      const result = await clerk.sessions.listSessions({
        userId: 'user_test123',
      })

      expect(result.data).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('user_id=user_test123'),
        expect.anything()
      )
    })

    it('should list sessions for a specific client', async () => {
      const sessions = [mockSession()]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSessionList(sessions)))

      const result = await clerk.sessions.listSessions({
        clientId: 'client_test123',
      })

      expect(result.data).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('client_id=client_test123'),
        expect.anything()
      )
    })

    it('should filter sessions by status', async () => {
      const activeSessions = [mockSession({ status: 'active' })]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSessionList(activeSessions)))

      const result = await clerk.sessions.listSessions({
        status: 'active',
      })

      expect(result.data).toHaveLength(1)
      expect(result.data[0].status).toBe('active')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=active'),
        expect.anything()
      )
    })

    it('should support pagination with limit', async () => {
      const sessions = [mockSession()]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSessionList(sessions, 10)))

      const result = await clerk.sessions.listSessions({
        limit: 1,
      })

      expect(result.data).toHaveLength(1)
      expect(result.total_count).toBe(10)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=1'),
        expect.anything()
      )
    })

    it('should support pagination with offset', async () => {
      const sessions = [mockSession({ id: 'sess_test456' })]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSessionList(sessions, 10)))

      const result = await clerk.sessions.listSessions({
        offset: 5,
      })

      expect(result.data).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('offset=5'),
        expect.anything()
      )
    })

    it('should return empty list when no sessions exist', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSessionList([])))

      const result = await clerk.sessions.listSessions()

      expect(result.data).toHaveLength(0)
      expect(result.total_count).toBe(0)
    })
  })

  // ===========================================================================
  // Session Token Verification
  // ===========================================================================

  describe('verifySession', () => {
    it('should verify a valid session token', async () => {
      const token = mockSessionToken()
      mockFetch.mockResolvedValueOnce(createMockResponse(token))

      const result = await clerk.sessions.verifySession('sess_test123', 'valid_token')

      expect(result.object).toBe('token')
      expect(result.jwt).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/sessions/sess_test123/verify'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('valid_token'),
        })
      )
    })

    it('should reject an invalid session token', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'invalid_token',
                message: 'Token is invalid',
              },
            ],
          },
          401
        )
      )

      await expect(
        clerk.sessions.verifySession('sess_test123', 'invalid_token')
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should reject an expired session token', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'token_expired',
                message: 'Token has expired',
              },
            ],
          },
          401
        )
      )

      await expect(
        clerk.sessions.verifySession('sess_test123', 'expired_token')
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should reject when session is revoked', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'session_revoked',
                message: 'Session has been revoked',
              },
            ],
          },
          401
        )
      )

      await expect(
        clerk.sessions.verifySession('sess_test123', 'token_for_revoked_session')
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  // ===========================================================================
  // Get Session Token
  // ===========================================================================

  describe('getSessionToken', () => {
    it('should get a new token for a session', async () => {
      const token = mockSessionToken()
      mockFetch.mockResolvedValueOnce(createMockResponse(token))

      const result = await clerk.sessions.getSessionToken('sess_test123')

      expect(result.jwt).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/sessions/sess_test123/tokens'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should get a token with custom template', async () => {
      const token = mockSessionToken({
        jwt: 'custom_template_jwt',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(token))

      const result = await clerk.sessions.getSessionToken('sess_test123', {
        template: 'custom-template',
      })

      expect(result.jwt).toBe('custom_template_jwt')
    })

    it('should fail for expired session', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'session_expired',
                message: 'Session has expired',
              },
            ],
          },
          401
        )
      )

      await expect(
        clerk.sessions.getSessionToken('sess_expired')
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should fail for revoked session', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'session_revoked',
                message: 'Session has been revoked',
              },
            ],
          },
          401
        )
      )

      await expect(
        clerk.sessions.getSessionToken('sess_revoked')
      ).rejects.toThrow(ClerkAPIError)
    })
  })
})

// =============================================================================
// Session Expiration Handling Tests
// =============================================================================

describe('@dotdo/clerk - Session Expiration', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('expiration behavior', () => {
    it('should correctly identify an active session', async () => {
      const activeSession = mockSession({
        status: 'active',
        expire_at: Date.now() + 3600000, // 1 hour in future
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(activeSession))

      const session = await clerk.sessions.getSession('sess_test123')

      expect(session.status).toBe('active')
      expect(session.expire_at).toBeGreaterThan(Date.now())
    })

    it('should correctly identify an expired session', async () => {
      const expiredSession = mockSession({
        status: 'expired',
        expire_at: Date.now() - 1000, // 1 second in past
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(expiredSession))

      const session = await clerk.sessions.getSession('sess_test123')

      expect(session.status).toBe('expired')
      expect(session.expire_at).toBeLessThan(Date.now())
    })

    it('should correctly identify an abandoned session', async () => {
      const abandonedSession = mockSession({
        status: 'abandoned',
        abandon_at: Date.now() - 1000,
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(abandonedSession))

      const session = await clerk.sessions.getSession('sess_test123')

      expect(session.status).toBe('abandoned')
    })

    it('should correctly identify a removed session', async () => {
      const removedSession = mockSession({
        status: 'removed',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(removedSession))

      const session = await clerk.sessions.getSession('sess_test123')

      expect(session.status).toBe('removed')
    })

    it('should correctly identify a replaced session', async () => {
      const replacedSession = mockSession({
        status: 'replaced',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(replacedSession))

      const session = await clerk.sessions.getSession('sess_test123')

      expect(session.status).toBe('replaced')
    })

    it('should correctly identify an ended session', async () => {
      const endedSession = mockSession({
        status: 'ended',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(endedSession))

      const session = await clerk.sessions.getSession('sess_test123')

      expect(session.status).toBe('ended')
    })
  })

  describe('last_active_at tracking', () => {
    it('should update last_active_at on session activity', async () => {
      const now = Date.now()
      const sessionBefore = mockSession({
        last_active_at: now - 60000, // 1 minute ago
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(sessionBefore))

      const session = await clerk.sessions.getSession('sess_test123')

      expect(session.last_active_at).toBeDefined()
      expect(typeof session.last_active_at).toBe('number')
    })

    it('should reflect recent activity timestamp', async () => {
      const recentTime = Date.now() - 5000 // 5 seconds ago
      const activeSession = mockSession({
        last_active_at: recentTime,
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(activeSession))

      const session = await clerk.sessions.getSession('sess_test123')

      expect(session.last_active_at).toBe(recentTime)
    })
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('@dotdo/clerk - Error Handling', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('ClerkAPIError', () => {
    it('should parse single error response', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'Session not found',
                long_message: 'The requested session could not be found in the system',
                meta: { session_id: 'sess_test123' },
              },
            ],
          },
          404
        )
      )

      try {
        await clerk.sessions.getSession('sess_test123')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ClerkAPIError)
        const clerkError = error as ClerkAPIError
        expect(clerkError.code).toBe('resource_not_found')
        expect(clerkError.message).toBe('Session not found')
        expect(clerkError.status).toBe(404)
        expect(clerkError.meta?.session_id).toBe('sess_test123')
      }
    })

    it('should parse multiple errors response', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'invalid_parameter',
                message: 'user_id is required',
              },
              {
                code: 'invalid_parameter',
                message: 'expire_at must be in the future',
              },
            ],
          },
          400
        )
      )

      try {
        await clerk.sessions.createSession({ userId: '' } as CreateSessionParams)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ClerkAPIError)
        const clerkError = error as ClerkAPIError
        expect(clerkError.errors).toHaveLength(2)
      }
    })

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(
        clerk.sessions.getSession('sess_test123')
      ).rejects.toThrow('Network error')
    })

    it('should handle malformed JSON response', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Not JSON', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      await expect(
        clerk.sessions.getSession('sess_test123')
      ).rejects.toThrow()
    })

    it('should handle rate limit errors', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'rate_limit_exceeded',
                message: 'Rate limit exceeded',
              },
            ],
          },
          429
        )
      )

      try {
        await clerk.sessions.listSessions()
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ClerkAPIError)
        const clerkError = error as ClerkAPIError
        expect(clerkError.code).toBe('rate_limit_exceeded')
        expect(clerkError.status).toBe(429)
      }
    })

    it('should handle authentication errors', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'authentication_invalid',
                message: 'Invalid API key',
              },
            ],
          },
          401
        )
      )

      try {
        await clerk.sessions.getSession('sess_test123')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ClerkAPIError)
        const clerkError = error as ClerkAPIError
        expect(clerkError.code).toBe('authentication_invalid')
        expect(clerkError.status).toBe(401)
      }
    })

    it('should handle server errors', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'internal_server_error',
                message: 'An unexpected error occurred',
              },
            ],
          },
          500
        )
      )

      try {
        await clerk.sessions.getSession('sess_test123')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ClerkAPIError)
        const clerkError = error as ClerkAPIError
        expect(clerkError.status).toBe(500)
      }
    })
  })
})

// =============================================================================
// Request Configuration Tests
// =============================================================================

describe('@dotdo/clerk - Request Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should include correct authorization header', async () => {
    const clerk = new Clerk({ secretKey: 'sk_test_xxx' })
    mockFetch.mockResolvedValueOnce(createMockResponse(mockSession()))

    await clerk.sessions.getSession('sess_test123')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk_test_xxx',
        }),
      })
    )
  })

  it('should include correct content-type for POST requests', async () => {
    const clerk = new Clerk({ secretKey: 'sk_test_xxx' })
    mockFetch.mockResolvedValueOnce(createMockResponse(mockSession()))

    await clerk.sessions.createSession({ userId: 'user_test123' })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    )
  })

  it('should use correct base URL', async () => {
    const clerk = new Clerk({ secretKey: 'sk_test_xxx' })
    mockFetch.mockResolvedValueOnce(createMockResponse(mockSession()))

    await clerk.sessions.getSession('sess_test123')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api.clerk.com'),
      expect.anything()
    )
  })

  it('should use custom base URL when provided', async () => {
    const clerk = new Clerk({
      secretKey: 'sk_test_xxx',
      apiUrl: 'https://custom.clerk.dev',
    })
    mockFetch.mockResolvedValueOnce(createMockResponse(mockSession()))

    await clerk.sessions.getSession('sess_test123')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('custom.clerk.dev'),
      expect.anything()
    )
  })

  it('should include Clerk-SDK header for tracking', async () => {
    const clerk = new Clerk({ secretKey: 'sk_test_xxx' })
    mockFetch.mockResolvedValueOnce(createMockResponse(mockSession()))

    await clerk.sessions.getSession('sess_test123')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Clerk-SDK': expect.stringContaining('@dotdo/clerk'),
        }),
      })
    )
  })
})
