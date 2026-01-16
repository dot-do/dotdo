/**
 * Security Tests - Logout Session Invalidation [do-6aoa]
 *
 * TDD RED Phase: Tests for proper logout session invalidation.
 *
 * Security Issue:
 * - handleLogoutRequest in mcp/auth/oauth.ts (lines 315-332) does NOT actually
 *   invalidate the session. It just returns a success message without deleting
 *   session data from KV storage.
 * - This allows session reuse after logout, which is a critical security vulnerability.
 *
 * Expected Behavior (after fix):
 * - Session token should be deleted from KV storage on logout
 * - User session index should be deleted from KV storage on logout
 * - Old session tokens should be rejected after logout
 * - Multiple logout calls should be idempotent
 *
 * These tests should FAIL initially until the fix is implemented.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  handleLogoutRequest,
  storeSession,
  getSession,
  getSessionByUserId,
  createSession,
  createSessionJwt,
  extractBearerToken,
} from '../../mcp/auth'
import type { McpEnv, Session, KVStore } from '../../mcp/types'

// ============================================================================
// Test Utilities
// ============================================================================

const TEST_JWT_SECRET = 'test-jwt-secret-for-security-tests-minimum-32-chars'

/**
 * Mock KV store for testing
 */
function createMockKVStore(): KVStore & { store: Map<string, { value: string; expiration?: number }> } {
  const store = new Map<string, { value: string; expiration?: number }>()

  return {
    store,
    async get(key: string): Promise<string | null> {
      const entry = store.get(key)
      if (!entry) return null
      // Check expiration
      if (entry.expiration && Date.now() > entry.expiration) {
        store.delete(key)
        return null
      }
      return entry.value
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
      const expiration = options?.expirationTtl
        ? Date.now() + options.expirationTtl * 1000
        : undefined
      store.set(key, { value, expiration })
    },
    async delete(key: string): Promise<void> {
      store.delete(key)
    },
  }
}

/**
 * Create a mock WorkOS user for testing
 */
function createMockWorkOSUser(id = 'test-user-123') {
  return {
    id,
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    organizationMemberships: [
      {
        id: 'org-member-1',
        organizationId: 'org-123',
        role: { slug: 'member' },
      },
    ],
  }
}

/**
 * Create a mock environment for testing
 */
function createMockEnv(kvStore: KVStore): McpEnv {
  return {
    MCP: {} as unknown as McpEnv['MCP'],
    OAUTH_KV: kvStore as unknown as McpEnv['OAUTH_KV'],
    AI: {} as unknown as McpEnv['AI'],
    WORKOS_API_KEY: 'test-api-key',
    WORKOS_CLIENT_ID: 'test-client-id',
    OAUTH_REDIRECT_URI: 'https://test.dotdo.dev/callback',
    JWT_SECRET: TEST_JWT_SECRET,
  }
}

// ============================================================================
// Session Invalidation Tests
// ============================================================================

describe('[SEC-P0] Logout Session Invalidation', () => {
  let kvStore: ReturnType<typeof createMockKVStore>
  let env: McpEnv
  let testSession: Session
  let testJwt: string

  beforeEach(async () => {
    // Setup fresh KV store and environment
    kvStore = createMockKVStore()
    env = createMockEnv(kvStore)

    // Create and store a test session
    const user = createMockWorkOSUser()
    testSession = await createSession(
      user,
      'test-access-token',
      'test-refresh-token',
      env
    )

    // Store the session in KV
    await storeSession(testSession, kvStore)

    // Create JWT for the session
    testJwt = await createSessionJwt(testSession, env)
  })

  describe('Session Deletion on Logout', () => {
    it('should delete session from KV storage on logout', async () => {
      // Verify session exists before logout
      const sessionBefore = await getSession(testSession.id, kvStore)
      expect(sessionBefore).not.toBeNull()
      expect(sessionBefore?.id).toBe(testSession.id)

      // Create logout request with session token
      const request = new Request('https://test.dotdo.dev/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${testJwt}`,
        },
      })

      // Perform logout
      const response = await handleLogoutRequest(request, env)
      expect(response.status).toBe(200)

      // CRITICAL: Session should be deleted from KV
      // This is the failing test - current implementation does NOT delete
      const sessionAfter = await getSession(testSession.id, kvStore)
      expect(sessionAfter).toBeNull()
    })

    it('should delete user session index from KV storage on logout', async () => {
      // Verify user session index exists before logout
      const sessionByUser = await getSessionByUserId(testSession.userId, kvStore)
      expect(sessionByUser).not.toBeNull()

      // Create logout request
      const request = new Request('https://test.dotdo.dev/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${testJwt}`,
        },
      })

      // Perform logout
      const response = await handleLogoutRequest(request, env)
      expect(response.status).toBe(200)

      // CRITICAL: User session index should be deleted
      const sessionByUserAfter = await getSessionByUserId(testSession.userId, kvStore)
      expect(sessionByUserAfter).toBeNull()
    })

    it('should verify both session:id and user_session:userId keys are deleted', async () => {
      // Verify both keys exist before logout
      const sessionKey = `session:${testSession.id}`
      const userSessionKey = `user_session:${testSession.userId}`

      expect(kvStore.store.has(sessionKey)).toBe(true)
      expect(kvStore.store.has(userSessionKey)).toBe(true)

      // Create logout request
      const request = new Request('https://test.dotdo.dev/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${testJwt}`,
        },
      })

      // Perform logout
      await handleLogoutRequest(request, env)

      // CRITICAL: Both keys should be deleted
      expect(kvStore.store.has(sessionKey)).toBe(false)
      expect(kvStore.store.has(userSessionKey)).toBe(false)
    })
  })

  describe('Token Rejection After Logout', () => {
    it('should reject the session token after logout', async () => {
      // Create logout request
      const request = new Request('https://test.dotdo.dev/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${testJwt}`,
        },
      })

      // Perform logout
      await handleLogoutRequest(request, env)

      // The session should no longer exist
      // Any subsequent request using the same session ID should fail
      const session = await getSession(testSession.id, kvStore)
      expect(session).toBeNull()
    })
  })

  describe('Idempotent Logout', () => {
    it('should handle multiple logout calls gracefully', async () => {
      const request = new Request('https://test.dotdo.dev/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${testJwt}`,
        },
      })

      // First logout
      const response1 = await handleLogoutRequest(request, env)
      expect(response1.status).toBe(200)

      // Second logout (should not error)
      const response2 = await handleLogoutRequest(request, env)
      expect(response2.status).toBe(200)

      // Session should still be deleted
      const session = await getSession(testSession.id, kvStore)
      expect(session).toBeNull()
    })

    it('should return success even if session is already expired or deleted', async () => {
      // Manually delete the session first
      await kvStore.delete(`session:${testSession.id}`)
      await kvStore.delete(`user_session:${testSession.userId}`)

      // Logout should still succeed
      const request = new Request('https://test.dotdo.dev/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${testJwt}`,
        },
      })

      const response = await handleLogoutRequest(request, env)
      expect(response.status).toBe(200)
    })
  })

  describe('Logout Without Token', () => {
    it('should handle logout request without Authorization header', async () => {
      // Logout without token should still succeed (no-op)
      // This is idempotent - we can't invalidate a session we don't know about
      const request = new Request('https://test.dotdo.dev/logout', {
        method: 'POST',
      })

      const response = await handleLogoutRequest(request, env)

      // Should return success (logout is idempotent)
      expect(response.status).toBe(200)

      const body = await response.json() as { success?: boolean }
      expect(body.success).toBe(true)
    })
  })

  describe('Response Format', () => {
    it('should return proper JSON response on successful logout', async () => {
      const request = new Request('https://test.dotdo.dev/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${testJwt}`,
        },
      })

      const response = await handleLogoutRequest(request, env)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')

      const body = await response.json() as { success?: boolean; message?: string }
      expect(body.success).toBe(true)
      expect(body.message).toBeDefined()
    })
  })
})

// ============================================================================
// Security Boundary Tests
// ============================================================================

describe('[SEC-P0] Logout Security Boundaries', () => {
  let kvStore: ReturnType<typeof createMockKVStore>
  let env: McpEnv

  beforeEach(() => {
    kvStore = createMockKVStore()
    env = createMockEnv(kvStore)
  })

  it('should only delete the specific user session, not other sessions', async () => {
    // Create two sessions for different users
    const user1 = createMockWorkOSUser('user-1')
    const user2 = createMockWorkOSUser('user-2')

    const session1 = await createSession(user1, 'token1', 'refresh1', env)
    const session2 = await createSession(user2, 'token2', 'refresh2', env)

    await storeSession(session1, kvStore)
    await storeSession(session2, kvStore)

    const jwt1 = await createSessionJwt(session1, env)

    // Logout user1
    const request = new Request('https://test.dotdo.dev/logout', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt1}`,
      },
    })

    await handleLogoutRequest(request, env)

    // User1's session should be deleted
    expect(await getSession(session1.id, kvStore)).toBeNull()

    // User2's session should still exist
    const session2After = await getSession(session2.id, kvStore)
    expect(session2After).not.toBeNull()
    expect(session2After?.userId).toBe('user-2')
  })

  it('should not leak session information in logout response', async () => {
    const user = createMockWorkOSUser()
    const session = await createSession(user, 'token', 'refresh', env)
    await storeSession(session, kvStore)
    const jwt = await createSessionJwt(session, env)

    const request = new Request('https://test.dotdo.dev/logout', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
      },
    })

    const response = await handleLogoutRequest(request, env)
    const body = await response.json() as Record<string, unknown>

    // Response should NOT contain sensitive session info
    expect(body).not.toHaveProperty('sessionId')
    expect(body).not.toHaveProperty('userId')
    expect(body).not.toHaveProperty('accessToken')
    expect(body).not.toHaveProperty('refreshToken')
    expect(body).not.toHaveProperty('email')
  })
})
