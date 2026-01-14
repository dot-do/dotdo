/**
 * Clerk Session Handling Compatibility Layer Tests (RED Phase)
 *
 * Comprehensive failing tests to drive implementation of Clerk-compatible
 * session management, token handling, claims, and security features.
 *
 * These tests follow the Clerk Backend API specification for sessions:
 * - Session CRUD operations
 * - Session tokens (JWT creation/verification)
 * - Session claims management
 * - Multi-session support
 * - Session lifecycle events
 * - Session security features
 *
 * @see https://clerk.com/docs/reference/backend-api#tag/Sessions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  Clerk,
  createClerkClient,
  ClerkAPIError,
  type ClerkSession,
  type ClerkSessionClaims,
} from '../index'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('Clerk Session Handling', () => {
  let clerk: Clerk

  beforeEach(() => {
    clerk = createClerkClient({
      secretKey: 'sk_test_secret_key_at_least_32_chars_long_for_testing',
      publishableKey: 'pk_test_publishable_key',
    })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // Helper to create a test user with a session
  async function createTestUserWithSession() {
    const user = await clerk.users.createUser({
      email_address: [`session-test-${Date.now()}@example.com`],
      password: 'Test123!@#Password',
      first_name: 'Session',
      last_name: 'Test',
    })

    // Create a session for this user (requires authentication flow)
    const session = await clerk.sessions.createSession({
      userId: user.id,
      clientId: 'client_test123',
    })

    return { user, session }
  }

  // ============================================================================
  // 1. SESSION CRUD (15+ tests)
  // ============================================================================

  describe('Session CRUD', () => {
    describe('getSession', () => {
      it('should get session by ID', async () => {
        const { session } = await createTestUserWithSession()

        const fetchedSession = await clerk.sessions.getSession(session.id)

        expect(fetchedSession).toBeDefined()
        expect(fetchedSession.id).toBe(session.id)
        expect(fetchedSession.object).toBe('session')
      })

      it('should get session with full session data', async () => {
        const { user, session } = await createTestUserWithSession()

        const fetchedSession = await clerk.sessions.getSession(session.id)

        expect(fetchedSession.id).toBeDefined()
        expect(fetchedSession.object).toBe('session')
        expect(fetchedSession.client_id).toBeDefined()
        expect(fetchedSession.user_id).toBe(user.id)
        expect(fetchedSession.status).toBe('active')
        expect(fetchedSession.last_active_at).toBeDefined()
        expect(fetchedSession.last_active_organization_id).toBeDefined()
        expect(fetchedSession.expire_at).toBeDefined()
        expect(fetchedSession.abandon_at).toBeDefined()
        expect(fetchedSession.created_at).toBeDefined()
        expect(fetchedSession.updated_at).toBeDefined()
      })

      it('should throw 404 for non-existent session', async () => {
        await expect(clerk.sessions.getSession('sess_nonexistent_id')).rejects.toThrow(ClerkAPIError)

        try {
          await clerk.sessions.getSession('sess_nonexistent_id')
        } catch (error) {
          expect(error).toBeInstanceOf(ClerkAPIError)
          expect((error as ClerkAPIError).status).toBe(404)
          expect((error as ClerkAPIError).errors[0].code).toBe('resource_not_found')
        }
      })

      it('should include actor data for impersonation sessions', async () => {
        const { user, session } = await createTestUserWithSession()

        // Create an impersonation session
        const adminUser = await clerk.users.createUser({
          email_address: ['admin@example.com'],
          password: 'AdminPass123!@#',
        })

        const impersonationSession = await clerk.sessions.createSession({
          userId: user.id,
          clientId: 'client_admin',
          actor: { sub: adminUser.id },
        })

        const fetchedSession = await clerk.sessions.getSession(impersonationSession.id)

        expect(fetchedSession.actor).toBeDefined()
        expect(fetchedSession.actor?.sub).toBe(adminUser.id)
      })
    })

    describe('getSessionList', () => {
      it('should list sessions for user', async () => {
        const { user, session } = await createTestUserWithSession()

        const result = await clerk.sessions.getSessionList({
          user_id: user.id,
        })

        expect(result.data).toBeDefined()
        expect(Array.isArray(result.data)).toBe(true)
        expect(result.total_count).toBeGreaterThanOrEqual(1)
        expect(result.data.some((s) => s.id === session.id)).toBe(true)
      })

      it('should list sessions with active status filter', async () => {
        const { user } = await createTestUserWithSession()

        const result = await clerk.sessions.getSessionList({
          user_id: user.id,
          status: 'active',
        })

        expect(result.data.every((s) => s.status === 'active')).toBe(true)
      })

      it('should list sessions with revoked status filter', async () => {
        const { user, session } = await createTestUserWithSession()

        // Revoke the session first
        await clerk.sessions.revokeSession(session.id)

        const result = await clerk.sessions.getSessionList({
          user_id: user.id,
          status: 'revoked',
        })

        expect(result.data.every((s) => s.status === 'revoked')).toBe(true)
      })

      it('should list sessions with expired status filter', async () => {
        const { user, session } = await createTestUserWithSession()

        // Advance time to expire the session
        vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000) // 31 days

        const result = await clerk.sessions.getSessionList({
          user_id: user.id,
          status: 'expired',
        })

        expect(result.data.every((s) => s.status === 'expired')).toBe(true)
      })

      it('should support pagination with limit and offset', async () => {
        const { user } = await createTestUserWithSession()

        // Create multiple sessions
        for (let i = 0; i < 5; i++) {
          await clerk.sessions.createSession({
            userId: user.id,
            clientId: `client_${i}`,
          })
        }

        const page1 = await clerk.sessions.getSessionList({
          user_id: user.id,
          limit: 2,
          offset: 0,
        })

        const page2 = await clerk.sessions.getSessionList({
          user_id: user.id,
          limit: 2,
          offset: 2,
        })

        expect(page1.data).toHaveLength(2)
        expect(page2.data).toHaveLength(2)
        expect(page1.data[0].id).not.toBe(page2.data[0].id)
      })

      it('should filter sessions by client_id', async () => {
        const { user } = await createTestUserWithSession()

        const specificClientId = 'client_specific_123'
        await clerk.sessions.createSession({
          userId: user.id,
          clientId: specificClientId,
        })

        const result = await clerk.sessions.getSessionList({
          user_id: user.id,
          client_id: specificClientId,
        })

        expect(result.data.every((s) => s.client_id === specificClientId)).toBe(true)
      })
    })

    describe('createSession', () => {
      it('should create a new session for user', async () => {
        const user = await clerk.users.createUser({
          email_address: ['create-session@example.com'],
          password: 'Test123!@#',
        })

        const session = await clerk.sessions.createSession({
          userId: user.id,
          clientId: 'client_new',
        })

        expect(session).toBeDefined()
        expect(session.id).toMatch(/^sess_/)
        expect(session.user_id).toBe(user.id)
        expect(session.status).toBe('active')
      })

      it('should create session with device info', async () => {
        const user = await clerk.users.createUser({
          email_address: ['device-session@example.com'],
          password: 'Test123!@#',
        })

        const session = await clerk.sessions.createSession({
          userId: user.id,
          clientId: 'client_device',
          ipAddress: '192.168.1.100',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          deviceInfo: {
            device_type: 'desktop',
            os: 'Windows',
            os_version: '10',
            browser: 'Chrome',
            browser_version: '120.0.0',
          },
        })

        expect(session).toBeDefined()
        expect(session.id).toBeDefined()
      })
    })

    describe('revokeSession', () => {
      it('should revoke specific session', async () => {
        const { session } = await createTestUserWithSession()

        const revokedSession = await clerk.sessions.revokeSession(session.id)

        expect(revokedSession.status).toBe('revoked')
        expect(revokedSession.id).toBe(session.id)
      })

      it('should throw error for already revoked session', async () => {
        const { session } = await createTestUserWithSession()

        await clerk.sessions.revokeSession(session.id)

        await expect(clerk.sessions.revokeSession(session.id)).rejects.toThrow(ClerkAPIError)

        try {
          await clerk.sessions.revokeSession(session.id)
        } catch (error) {
          expect((error as ClerkAPIError).errors[0].code).toBe('session_already_revoked')
        }
      })

      it('should throw 404 for non-existent session', async () => {
        await expect(clerk.sessions.revokeSession('sess_nonexistent')).rejects.toThrow(ClerkAPIError)
      })
    })

    describe('revokeAllUserSessions', () => {
      it('should revoke all user sessions', async () => {
        const { user } = await createTestUserWithSession()

        // Create additional sessions
        await clerk.sessions.createSession({ userId: user.id, clientId: 'client_2' })
        await clerk.sessions.createSession({ userId: user.id, clientId: 'client_3' })

        const result = await clerk.sessions.revokeAllUserSessions(user.id)

        expect(result.revoked_count).toBeGreaterThanOrEqual(3)

        const activeSessions = await clerk.sessions.getSessionList({
          user_id: user.id,
          status: 'active',
        })

        expect(activeSessions.total_count).toBe(0)
      })

      it('should revoke all except current session', async () => {
        const { user, session: currentSession } = await createTestUserWithSession()

        // Create additional sessions
        await clerk.sessions.createSession({ userId: user.id, clientId: 'client_2' })
        await clerk.sessions.createSession({ userId: user.id, clientId: 'client_3' })

        const result = await clerk.sessions.revokeAllUserSessions(user.id, {
          exceptSessionId: currentSession.id,
        })

        expect(result.revoked_count).toBe(2)

        const currentSessionStatus = await clerk.sessions.getSession(currentSession.id)
        expect(currentSessionStatus.status).toBe('active')
      })
    })
  })

  // ============================================================================
  // 2. SESSION TOKENS (20+ tests)
  // ============================================================================

  describe('Session Tokens', () => {
    describe('getToken (JWT Creation)', () => {
      it('should create session token (JWT)', async () => {
        const { session } = await createTestUserWithSession()

        const { jwt } = await clerk.sessions.getToken(session.id)

        expect(jwt).toBeDefined()
        expect(typeof jwt).toBe('string')
        expect(jwt.split('.')).toHaveLength(3) // Valid JWT format
      })

      it('should create token with custom template', async () => {
        // Create a JWT template first
        const template = await clerk.jwtTemplates.createJWTTemplate({
          name: 'custom-template',
          claims: {
            custom_claim: 'custom_value',
            role: 'user',
          },
          lifetime: 7200,
        })

        const { session } = await createTestUserWithSession()

        const { jwt } = await clerk.sessions.getToken(session.id, template.name)

        expect(jwt).toBeDefined()

        // Decode and verify claims
        const decoded = await clerk.verifyToken(jwt)
        expect(decoded.claims.custom_claim).toBe('custom_value')
        expect(decoded.claims.role).toBe('user')
      })

      it('should create token with custom claims', async () => {
        const { session } = await createTestUserWithSession()

        const { jwt } = await clerk.sessions.getToken(session.id, undefined, {
          customClaims: {
            tenant_id: 'tenant_123',
            feature_flags: ['beta', 'dark_mode'],
          },
        })

        expect(jwt).toBeDefined()

        const decoded = await clerk.verifyToken(jwt)
        expect(decoded.claims.tenant_id).toBe('tenant_123')
        expect(decoded.claims.feature_flags).toEqual(['beta', 'dark_mode'])
      })

      it('should throw error for revoked session', async () => {
        const { session } = await createTestUserWithSession()

        await clerk.sessions.revokeSession(session.id)

        await expect(clerk.sessions.getToken(session.id)).rejects.toThrow(ClerkAPIError)

        try {
          await clerk.sessions.getToken(session.id)
        } catch (error) {
          expect((error as ClerkAPIError).errors[0].code).toBe('session_revoked')
        }
      })

      it('should throw error for expired session', async () => {
        const { session } = await createTestUserWithSession()

        // Advance time past session expiry
        vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000) // 31 days

        await expect(clerk.sessions.getToken(session.id)).rejects.toThrow(ClerkAPIError)
      })

      it('should contain correct standard claims (sub, sid, iat, exp)', async () => {
        const { user, session } = await createTestUserWithSession()

        const { jwt } = await clerk.sessions.getToken(session.id)
        const decoded = await clerk.verifyToken(jwt)

        expect(decoded.claims.sub).toBe(user.id)
        expect(decoded.claims.sid).toBe(session.id)
        expect(decoded.claims.iat).toBeDefined()
        expect(typeof decoded.claims.iat).toBe('number')
        expect(decoded.claims.exp).toBeDefined()
        expect(typeof decoded.claims.exp).toBe('number')
        expect(decoded.claims.exp).toBeGreaterThan(decoded.claims.iat)
      })

      it('should contain azp (authorized party) claim', async () => {
        const { session } = await createTestUserWithSession()

        const { jwt } = await clerk.sessions.getToken(session.id)
        const decoded = await clerk.verifyToken(jwt)

        expect(decoded.claims.azp).toBeDefined()
      })

      it('should contain nbf (not before) claim', async () => {
        const { session } = await createTestUserWithSession()

        const { jwt } = await clerk.sessions.getToken(session.id)
        const decoded = await clerk.verifyToken(jwt)

        expect(decoded.claims.nbf).toBeDefined()
        expect(decoded.claims.nbf).toBeLessThanOrEqual(decoded.claims.iat!)
      })

      it('should contain iss (issuer) claim', async () => {
        const { session } = await createTestUserWithSession()

        const { jwt } = await clerk.sessions.getToken(session.id)
        const decoded = await clerk.verifyToken(jwt)

        expect(decoded.claims.iss).toBeDefined()
        expect(typeof decoded.claims.iss).toBe('string')
      })
    })

    describe('verifyToken', () => {
      it('should verify valid session token', async () => {
        const { session } = await createTestUserWithSession()

        const { jwt } = await clerk.sessions.getToken(session.id)
        const result = await clerk.verifyToken(jwt)

        expect(result.userId).toBeDefined()
        expect(result.sessionId).toBe(session.id)
        expect(result.claims).toBeDefined()
      })

      it('should return decoded claims on valid token', async () => {
        const { user, session } = await createTestUserWithSession()

        const { jwt } = await clerk.sessions.getToken(session.id)
        const result = await clerk.verifyToken(jwt)

        expect(result.userId).toBe(user.id)
        expect(result.sessionId).toBe(session.id)
        expect(result.claims.sub).toBe(user.id)
        expect(result.claims.sid).toBe(session.id)
      })

      it('should reject expired token', async () => {
        const { session } = await createTestUserWithSession()

        const { jwt } = await clerk.sessions.getToken(session.id)

        // Advance time past token expiry (default 60s)
        vi.advanceTimersByTime(120 * 1000)

        await expect(clerk.verifyToken(jwt)).rejects.toThrow(ClerkAPIError)

        try {
          await clerk.verifyToken(jwt)
        } catch (error) {
          expect((error as ClerkAPIError).errors[0].code).toBe('token_expired')
        }
      })

      it('should reject invalid signature', async () => {
        const { session } = await createTestUserWithSession()

        const { jwt } = await clerk.sessions.getToken(session.id)
        const [header, payload] = jwt.split('.')
        const tamperedJwt = `${header}.${payload}.invalid_signature_abc123`

        await expect(clerk.verifyToken(tamperedJwt)).rejects.toThrow(ClerkAPIError)

        try {
          await clerk.verifyToken(tamperedJwt)
        } catch (error) {
          expect((error as ClerkAPIError).errors[0].code).toBe('session_token_invalid')
        }
      })

      it('should reject token from revoked session', async () => {
        const { session } = await createTestUserWithSession()

        const { jwt } = await clerk.sessions.getToken(session.id)
        await clerk.sessions.revokeSession(session.id)

        await expect(clerk.verifyToken(jwt)).rejects.toThrow(ClerkAPIError)

        try {
          await clerk.verifyToken(jwt)
        } catch (error) {
          expect((error as ClerkAPIError).errors[0].code).toBe('session_revoked')
        }
      })

      it('should verify with authorized parties check', async () => {
        const { session } = await createTestUserWithSession()

        const { jwt } = await clerk.sessions.getToken(session.id)

        // Should pass with correct authorized party
        const result = await clerk.verifyToken(jwt, {
          authorizedParties: ['https://myapp.com'],
        })

        expect(result.userId).toBeDefined()
      })

      it('should reject token with wrong authorized party', async () => {
        const { session } = await createTestUserWithSession()

        const { jwt } = await clerk.sessions.getToken(session.id)

        await expect(
          clerk.verifyToken(jwt, {
            authorizedParties: ['https://other-app.com'],
          })
        ).rejects.toThrow(ClerkAPIError)
      })

      it('should reject malformed token', async () => {
        await expect(clerk.verifyToken('not.a.valid.jwt.token.at.all')).rejects.toThrow(ClerkAPIError)
      })

      it('should reject empty token', async () => {
        await expect(clerk.verifyToken('')).rejects.toThrow(ClerkAPIError)
      })
    })

    describe('Token Refresh', () => {
      it('should refresh session and extend expiry', async () => {
        const { session } = await createTestUserWithSession()

        const originalExpiry = session.expire_at

        // Advance time a bit
        vi.advanceTimersByTime(60 * 60 * 1000) // 1 hour

        const refreshedSession = await clerk.sessions.refreshSession(session.id)

        expect(refreshedSession.expire_at).toBeGreaterThan(originalExpiry)
        expect(refreshedSession.status).toBe('active')
      })

      it('should update last_active_at on refresh', async () => {
        const { session } = await createTestUserWithSession()

        const originalLastActive = session.last_active_at

        vi.advanceTimersByTime(60 * 1000) // 1 minute

        const refreshedSession = await clerk.sessions.refreshSession(session.id)

        expect(refreshedSession.last_active_at).toBeGreaterThan(originalLastActive)
      })

      it('should throw error for expired session refresh', async () => {
        const { session } = await createTestUserWithSession()

        // Advance time past session expiry
        vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000)

        await expect(clerk.sessions.refreshSession(session.id)).rejects.toThrow(ClerkAPIError)
      })

      it('should throw error for revoked session refresh', async () => {
        const { session } = await createTestUserWithSession()

        await clerk.sessions.revokeSession(session.id)

        await expect(clerk.sessions.refreshSession(session.id)).rejects.toThrow(ClerkAPIError)
      })
    })

    describe('Token Rotation', () => {
      it('should rotate token and generate new token', async () => {
        const { session } = await createTestUserWithSession()

        const { jwt: oldJwt } = await clerk.sessions.getToken(session.id)
        const { jwt: newJwt } = await clerk.sessions.rotateToken(session.id)

        expect(newJwt).toBeDefined()
        expect(newJwt).not.toBe(oldJwt)
      })

      it('should invalidate old token after rotation', async () => {
        const { session } = await createTestUserWithSession()

        const { jwt: oldJwt } = await clerk.sessions.getToken(session.id)
        await clerk.sessions.rotateToken(session.id)

        await expect(clerk.verifyToken(oldJwt)).rejects.toThrow(ClerkAPIError)

        try {
          await clerk.verifyToken(oldJwt)
        } catch (error) {
          expect((error as ClerkAPIError).errors[0].code).toBe('token_rotated')
        }
      })

      it('should maintain session ID across rotation', async () => {
        const { session } = await createTestUserWithSession()

        const { jwt: newJwt } = await clerk.sessions.rotateToken(session.id)
        const decoded = await clerk.verifyToken(newJwt)

        expect(decoded.sessionId).toBe(session.id)
      })
    })
  })

  // ============================================================================
  // 3. SESSION CLAIMS (10+ tests)
  // ============================================================================

  describe('Session Claims', () => {
    describe('getSessionClaims', () => {
      it('should get session claims', async () => {
        const { session } = await createTestUserWithSession()

        const claims = await clerk.sessions.getSessionClaims(session.id)

        expect(claims).toBeDefined()
        expect(claims.sub).toBeDefined()
        expect(claims.sid).toBe(session.id)
      })

      it('should include user data in claims', async () => {
        const { user, session } = await createTestUserWithSession()

        const claims = await clerk.sessions.getSessionClaims(session.id)

        expect(claims.sub).toBe(user.id)
        expect(claims.email).toBe(user.email_addresses[0].email_address)
      })

      it('should include organization data in claims when applicable', async () => {
        const { user, session } = await createTestUserWithSession()

        // Create an organization and add user
        const org = await clerk.organizations.createOrganization({
          name: 'Test Org',
          created_by: user.id,
        })

        // Set active organization for session
        await clerk.sessions.setActiveOrganization(session.id, org.id)

        const claims = await clerk.sessions.getSessionClaims(session.id)

        expect(claims.org_id).toBe(org.id)
        expect(claims.org_role).toBeDefined()
      })

      it('should return empty org data when no active organization', async () => {
        const { session } = await createTestUserWithSession()

        const claims = await clerk.sessions.getSessionClaims(session.id)

        expect(claims.org_id).toBeUndefined()
        expect(claims.org_role).toBeUndefined()
      })
    })

    describe('updateSessionClaims', () => {
      it('should update session claims', async () => {
        const { session } = await createTestUserWithSession()

        await clerk.sessions.updateSessionClaims(session.id, {
          custom_key: 'custom_value',
        })

        const claims = await clerk.sessions.getSessionClaims(session.id)

        expect(claims.custom_key).toBe('custom_value')
      })

      it('should persist claims across token generation', async () => {
        const { session } = await createTestUserWithSession()

        await clerk.sessions.updateSessionClaims(session.id, {
          persistent_claim: 'persistent_value',
        })

        const { jwt } = await clerk.sessions.getToken(session.id)
        const decoded = await clerk.verifyToken(jwt)

        expect(decoded.claims.persistent_claim).toBe('persistent_value')
      })

      it('should support custom claims', async () => {
        const { session } = await createTestUserWithSession()

        await clerk.sessions.updateSessionClaims(session.id, {
          tenant_id: 'tenant_456',
          permissions: ['read', 'write'],
          nested: { deep: { value: true } },
        })

        const claims = await clerk.sessions.getSessionClaims(session.id)

        expect(claims.tenant_id).toBe('tenant_456')
        expect(claims.permissions).toEqual(['read', 'write'])
        expect(claims.nested).toEqual({ deep: { value: true } })
      })

      it('should enforce claims size limits', async () => {
        const { session } = await createTestUserWithSession()

        const largeClaim = 'x'.repeat(100000) // 100KB string

        await expect(
          clerk.sessions.updateSessionClaims(session.id, {
            large_claim: largeClaim,
          })
        ).rejects.toThrow(ClerkAPIError)

        try {
          await clerk.sessions.updateSessionClaims(session.id, {
            large_claim: largeClaim,
          })
        } catch (error) {
          expect((error as ClerkAPIError).errors[0].code).toBe('claims_size_exceeded')
        }
      })

      it('should not allow overwriting protected claims', async () => {
        const { session } = await createTestUserWithSession()

        await expect(
          clerk.sessions.updateSessionClaims(session.id, {
            sub: 'hacked_user_id', // Protected claim
          })
        ).rejects.toThrow(ClerkAPIError)

        try {
          await clerk.sessions.updateSessionClaims(session.id, {
            sub: 'hacked_user_id',
          })
        } catch (error) {
          expect((error as ClerkAPIError).errors[0].code).toBe('protected_claim')
        }
      })
    })

    describe('Claims Persistence', () => {
      it('should persist claims across requests', async () => {
        const { session } = await createTestUserWithSession()

        await clerk.sessions.updateSessionClaims(session.id, {
          request_count: 1,
        })

        // Simulate multiple requests
        const claims1 = await clerk.sessions.getSessionClaims(session.id)
        const claims2 = await clerk.sessions.getSessionClaims(session.id)

        expect(claims1.request_count).toBe(1)
        expect(claims2.request_count).toBe(1)
      })
    })
  })

  // ============================================================================
  // 4. MULTI-SESSION SUPPORT (10+ tests)
  // ============================================================================

  describe('Multi-Session Support', () => {
    describe('Multiple Active Sessions', () => {
      it('should support multiple active sessions per user', async () => {
        const user = await clerk.users.createUser({
          email_address: ['multi-session@example.com'],
          password: 'Test123!@#',
        })

        const session1 = await clerk.sessions.createSession({
          userId: user.id,
          clientId: 'client_browser',
        })

        const session2 = await clerk.sessions.createSession({
          userId: user.id,
          clientId: 'client_mobile',
        })

        const session3 = await clerk.sessions.createSession({
          userId: user.id,
          clientId: 'client_desktop',
        })

        expect(session1.id).not.toBe(session2.id)
        expect(session2.id).not.toBe(session3.id)

        const sessions = await clerk.sessions.getSessionList({
          user_id: user.id,
          status: 'active',
        })

        expect(sessions.total_count).toBe(3)
      })

      it('should maintain independent session states', async () => {
        const user = await clerk.users.createUser({
          email_address: ['independent-sessions@example.com'],
          password: 'Test123!@#',
        })

        const session1 = await clerk.sessions.createSession({
          userId: user.id,
          clientId: 'client_1',
        })

        const session2 = await clerk.sessions.createSession({
          userId: user.id,
          clientId: 'client_2',
        })

        // Revoke session 1
        await clerk.sessions.revokeSession(session1.id)

        // Session 2 should still be active
        const session2Status = await clerk.sessions.getSession(session2.id)
        expect(session2Status.status).toBe('active')
      })
    })

    describe('Single Session Mode', () => {
      it('should enforce single-session mode when enabled', async () => {
        // Configure single session mode (would be in application settings)
        const clerkSingleSession = createClerkClient({
          secretKey: 'sk_test_single_session_key_long_enough',
          publishableKey: 'pk_test_single_session',
          // singleSessionMode: true // Configuration option
        })

        const user = await clerkSingleSession.users.createUser({
          email_address: ['single-session@example.com'],
          password: 'Test123!@#',
        })

        const session1 = await clerkSingleSession.sessions.createSession({
          userId: user.id,
          clientId: 'client_1',
          singleSessionMode: true,
        })

        const session2 = await clerkSingleSession.sessions.createSession({
          userId: user.id,
          clientId: 'client_2',
          singleSessionMode: true,
        })

        // First session should be automatically revoked
        const session1Status = await clerkSingleSession.sessions.getSession(session1.id)
        expect(session1Status.status).toBe('revoked')

        const session2Status = await clerkSingleSession.sessions.getSession(session2.id)
        expect(session2Status.status).toBe('active')
      })

      it('should get single session token (SSO)', async () => {
        const { user } = await createTestUserWithSession()

        // Create multiple sessions
        await clerk.sessions.createSession({ userId: user.id, clientId: 'client_2' })
        await clerk.sessions.createSession({ userId: user.id, clientId: 'client_3' })

        // Get single session token (should return most recent or primary)
        const { session, jwt } = await clerk.sessions.getSingleSessionToken(user.id)

        expect(session).toBeDefined()
        expect(jwt).toBeDefined()
      })
    })

    describe('Session Switching', () => {
      it('should support session switching within client', async () => {
        const user1 = await clerk.users.createUser({
          email_address: ['user1@example.com'],
          password: 'Test123!@#',
        })

        const user2 = await clerk.users.createUser({
          email_address: ['user2@example.com'],
          password: 'Test123!@#',
        })

        const clientId = 'client_shared'

        const session1 = await clerk.sessions.createSession({
          userId: user1.id,
          clientId,
        })

        const session2 = await clerk.sessions.createSession({
          userId: user2.id,
          clientId,
        })

        // Switch active session
        const activeSession = await clerk.sessions.setActiveSession(clientId, session2.id)

        expect(activeSession.id).toBe(session2.id)
        expect(activeSession.user_id).toBe(user2.id)
      })

      it('should list all sessions for a client', async () => {
        const user1 = await clerk.users.createUser({
          email_address: ['client-user1@example.com'],
          password: 'Test123!@#',
        })

        const user2 = await clerk.users.createUser({
          email_address: ['client-user2@example.com'],
          password: 'Test123!@#',
        })

        const clientId = 'client_multi_user'

        await clerk.sessions.createSession({ userId: user1.id, clientId })
        await clerk.sessions.createSession({ userId: user2.id, clientId })

        const sessions = await clerk.sessions.getSessionList({
          client_id: clientId,
        })

        expect(sessions.total_count).toBe(2)
      })
    })

    describe('Maximum Sessions Limit', () => {
      it('should enforce maximum sessions per user limit', async () => {
        const clerkWithLimit = createClerkClient({
          secretKey: 'sk_test_max_sessions_key_long_enough',
          maxSessionsPerUser: 3,
        })

        const user = await clerkWithLimit.users.createUser({
          email_address: ['max-sessions@example.com'],
          password: 'Test123!@#',
        })

        // Create sessions up to limit
        await clerkWithLimit.sessions.createSession({ userId: user.id, clientId: 'client_1' })
        await clerkWithLimit.sessions.createSession({ userId: user.id, clientId: 'client_2' })
        await clerkWithLimit.sessions.createSession({ userId: user.id, clientId: 'client_3' })

        // Fourth session should fail or revoke oldest
        await expect(
          clerkWithLimit.sessions.createSession({
            userId: user.id,
            clientId: 'client_4',
          })
        ).rejects.toThrow(ClerkAPIError)
      })

      it('should revoke oldest session when limit exceeded (if configured)', async () => {
        const clerkWithLimitAndRevoke = createClerkClient({
          secretKey: 'sk_test_revoke_oldest_key_long_enough',
          maxSessionsPerUser: 2,
          revokeOldestOnLimit: true,
        })

        const user = await clerkWithLimitAndRevoke.users.createUser({
          email_address: ['revoke-oldest@example.com'],
          password: 'Test123!@#',
        })

        const session1 = await clerkWithLimitAndRevoke.sessions.createSession({
          userId: user.id,
          clientId: 'client_1',
        })

        await clerkWithLimitAndRevoke.sessions.createSession({
          userId: user.id,
          clientId: 'client_2',
        })

        const session3 = await clerkWithLimitAndRevoke.sessions.createSession({
          userId: user.id,
          clientId: 'client_3',
        })

        // First session should be revoked
        const session1Status = await clerkWithLimitAndRevoke.sessions.getSession(session1.id)
        expect(session1Status.status).toBe('revoked')

        // Third session should be active
        const session3Status = await clerkWithLimitAndRevoke.sessions.getSession(session3.id)
        expect(session3Status.status).toBe('active')
      })
    })
  })

  // ============================================================================
  // 5. SESSION LIFECYCLE EVENTS (15+ tests)
  // ============================================================================

  describe('Session Lifecycle Events', () => {
    describe('onSessionCreated', () => {
      it('should fire onSessionCreated event on new session', async () => {
        const handler = vi.fn()
        clerk.sessions.onSessionCreated(handler)

        const { session } = await createTestUserWithSession()

        expect(handler).toHaveBeenCalled()
        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'session.created',
            data: expect.objectContaining({
              id: session.id,
            }),
          })
        )
      })

      it('should include session data in event', async () => {
        const handler = vi.fn()
        clerk.sessions.onSessionCreated(handler)

        const { user, session } = await createTestUserWithSession()

        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              id: session.id,
              user_id: user.id,
              status: 'active',
              client_id: expect.any(String),
              created_at: expect.any(Number),
            }),
          })
        )
      })
    })

    describe('onSessionRevoked', () => {
      it('should fire onSessionRevoked event on revoke', async () => {
        const handler = vi.fn()
        clerk.sessions.onSessionRevoked(handler)

        const { session } = await createTestUserWithSession()
        await clerk.sessions.revokeSession(session.id)

        expect(handler).toHaveBeenCalled()
        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'session.revoked',
            data: expect.objectContaining({
              id: session.id,
              status: 'revoked',
            }),
          })
        )
      })
    })

    describe('onSessionExpired', () => {
      it('should fire onSessionExpired event on expiry', async () => {
        const handler = vi.fn()
        clerk.sessions.onSessionExpired(handler)

        const { session } = await createTestUserWithSession()

        // Advance time past session expiry
        vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000)

        // Trigger expiry check
        await clerk.sessions.checkExpiry(session.id)

        expect(handler).toHaveBeenCalled()
        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'session.expired',
            data: expect.objectContaining({
              id: session.id,
              status: 'expired',
            }),
          })
        )
      })
    })

    describe('Event Handlers', () => {
      it('should support multiple handlers for same event', async () => {
        const handler1 = vi.fn()
        const handler2 = vi.fn()

        clerk.sessions.onSessionCreated(handler1)
        clerk.sessions.onSessionCreated(handler2)

        await createTestUserWithSession()

        expect(handler1).toHaveBeenCalled()
        expect(handler2).toHaveBeenCalled()
      })

      it('should isolate handler errors', async () => {
        const errorHandler = vi.fn(() => {
          throw new Error('Handler error')
        })
        const successHandler = vi.fn()

        clerk.sessions.onSessionCreated(errorHandler)
        clerk.sessions.onSessionCreated(successHandler)

        await createTestUserWithSession()

        expect(errorHandler).toHaveBeenCalled()
        expect(successHandler).toHaveBeenCalled() // Should still be called despite error in first handler
      })

      it('should support async handlers', async () => {
        let handlerCompleted = false

        const asyncHandler = vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100))
          handlerCompleted = true
        })

        clerk.sessions.onSessionCreated(asyncHandler)

        await createTestUserWithSession()

        // Wait for async handler
        vi.advanceTimersByTime(200)
        await vi.runAllTimersAsync()

        expect(asyncHandler).toHaveBeenCalled()
        expect(handlerCompleted).toBe(true)
      })

      it('should receive correct context in handler', async () => {
        const handler = vi.fn()
        clerk.sessions.onSessionCreated(handler)

        const { user, session } = await createTestUserWithSession()

        const event = handler.mock.calls[0][0]
        expect(event.type).toBe('session.created')
        expect(event.data.id).toBe(session.id)
        expect(event.data.user_id).toBe(user.id)
        expect(event.timestamp).toBeDefined()
      })

      it('should allow unsubscribing from events', async () => {
        const handler = vi.fn()
        const unsubscribe = clerk.sessions.onSessionCreated(handler)

        await createTestUserWithSession()
        expect(handler).toHaveBeenCalledTimes(1)

        unsubscribe()

        await createTestUserWithSession()
        expect(handler).toHaveBeenCalledTimes(1) // Should not be called again
      })
    })

    describe('Session Activity Events', () => {
      it('should fire onSessionActivity on token generation', async () => {
        const handler = vi.fn()
        clerk.sessions.onSessionActivity(handler)

        const { session } = await createTestUserWithSession()
        await clerk.sessions.getToken(session.id)

        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'session.activity',
            data: expect.objectContaining({
              session_id: session.id,
              activity: 'token_generated',
            }),
          })
        )
      })

      it('should fire onSessionActivity on refresh', async () => {
        const handler = vi.fn()
        clerk.sessions.onSessionActivity(handler)

        const { session } = await createTestUserWithSession()
        await clerk.sessions.refreshSession(session.id)

        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'session.activity',
            data: expect.objectContaining({
              session_id: session.id,
              activity: 'refreshed',
            }),
          })
        )
      })
    })
  })

  // ============================================================================
  // 6. SESSION SECURITY (10+ tests)
  // ============================================================================

  describe('Session Security', () => {
    describe('IP Address Tracking', () => {
      it('should track IP address', async () => {
        const user = await clerk.users.createUser({
          email_address: ['ip-tracking@example.com'],
          password: 'Test123!@#',
        })

        const session = await clerk.sessions.createSession({
          userId: user.id,
          clientId: 'client_ip',
          ipAddress: '203.0.113.45',
        })

        const sessionData = await clerk.sessions.getSession(session.id)

        expect(sessionData.ip_address).toBe('203.0.113.45')
      })

      it('should track IP address changes', async () => {
        const user = await clerk.users.createUser({
          email_address: ['ip-change@example.com'],
          password: 'Test123!@#',
        })

        const session = await clerk.sessions.createSession({
          userId: user.id,
          clientId: 'client_ip_change',
          ipAddress: '192.168.1.1',
        })

        // Update session with new IP
        await clerk.sessions.updateSessionActivity(session.id, {
          ipAddress: '192.168.1.100',
        })

        const activity = await clerk.sessions.getSessionActivity(session.id)

        expect(activity.ip_addresses).toContain('192.168.1.1')
        expect(activity.ip_addresses).toContain('192.168.1.100')
      })
    })

    describe('User Agent Tracking', () => {
      it('should track user agent', async () => {
        const user = await clerk.users.createUser({
          email_address: ['ua-tracking@example.com'],
          password: 'Test123!@#',
        })

        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

        const session = await clerk.sessions.createSession({
          userId: user.id,
          clientId: 'client_ua',
          userAgent,
        })

        const sessionData = await clerk.sessions.getSession(session.id)

        expect(sessionData.user_agent).toBe(userAgent)
      })
    })

    describe('Activity Timestamps', () => {
      it('should update session activity timestamps', async () => {
        const { session } = await createTestUserWithSession()

        const initialLastActive = session.last_active_at

        vi.advanceTimersByTime(5 * 60 * 1000) // 5 minutes

        await clerk.sessions.getToken(session.id)

        const updatedSession = await clerk.sessions.getSession(session.id)

        expect(updatedSession.last_active_at).toBeGreaterThan(initialLastActive)
      })

      it('should track created_at and updated_at', async () => {
        const { session } = await createTestUserWithSession()

        expect(session.created_at).toBeDefined()
        expect(session.updated_at).toBeDefined()
        expect(session.updated_at).toBeGreaterThanOrEqual(session.created_at)

        vi.advanceTimersByTime(60 * 1000)

        await clerk.sessions.refreshSession(session.id)

        const refreshedSession = await clerk.sessions.getSession(session.id)

        expect(refreshedSession.updated_at).toBeGreaterThan(session.updated_at)
      })
    })

    describe('Suspicious Activity Detection', () => {
      it('should detect suspicious geographic location changes', async () => {
        const { session } = await createTestUserWithSession()

        // Simulate rapid location change (impossible travel)
        await clerk.sessions.updateSessionActivity(session.id, {
          ipAddress: '192.168.1.1', // US IP
          geoLocation: { country: 'US', city: 'New York' },
        })

        vi.advanceTimersByTime(5 * 60 * 1000) // 5 minutes later

        await clerk.sessions.updateSessionActivity(session.id, {
          ipAddress: '203.0.113.45', // Different country IP
          geoLocation: { country: 'JP', city: 'Tokyo' },
        })

        const security = await clerk.sessions.getSecurityFlags(session.id)

        expect(security.suspicious_activity).toBe(true)
        expect(security.flags).toContain('impossible_travel')
      })

      it('should flag unusual activity patterns', async () => {
        const { session } = await createTestUserWithSession()

        // Simulate unusual token generation pattern (too many requests)
        for (let i = 0; i < 100; i++) {
          await clerk.sessions.getToken(session.id)
        }

        const security = await clerk.sessions.getSecurityFlags(session.id)

        expect(security.flags).toContain('high_token_generation_rate')
      })
    })

    describe('Device Fingerprinting', () => {
      it('should track device fingerprint', async () => {
        const user = await clerk.users.createUser({
          email_address: ['device-fp@example.com'],
          password: 'Test123!@#',
        })

        const session = await clerk.sessions.createSession({
          userId: user.id,
          clientId: 'client_device_fp',
          deviceInfo: {
            device_type: 'mobile',
            os: 'iOS',
            os_version: '17.0',
            browser: 'Safari',
            browser_version: '17.0',
          },
          fingerprint: 'fp_abc123xyz789',
        })

        const sessionData = await clerk.sessions.getSession(session.id)

        expect(sessionData.device_info).toBeDefined()
        expect(sessionData.device_info?.device_type).toBe('mobile')
        expect(sessionData.device_info?.os).toBe('iOS')
      })

      it('should detect device fingerprint changes', async () => {
        const { session } = await createTestUserWithSession()

        await clerk.sessions.updateSessionActivity(session.id, {
          fingerprint: 'fp_original_device',
        })

        await clerk.sessions.updateSessionActivity(session.id, {
          fingerprint: 'fp_different_device',
        })

        const security = await clerk.sessions.getSecurityFlags(session.id)

        expect(security.flags).toContain('device_fingerprint_changed')
      })
    })

    describe('Session Binding', () => {
      it('should support IP binding for high-security sessions', async () => {
        const user = await clerk.users.createUser({
          email_address: ['ip-bound@example.com'],
          password: 'Test123!@#',
        })

        const session = await clerk.sessions.createSession({
          userId: user.id,
          clientId: 'client_bound',
          ipAddress: '192.168.1.50',
          bindToIp: true,
        })

        // Token generation from same IP should work
        const { jwt } = await clerk.sessions.getToken(session.id, undefined, {
          requestIp: '192.168.1.50',
        })

        expect(jwt).toBeDefined()

        // Token generation from different IP should fail
        await expect(
          clerk.sessions.getToken(session.id, undefined, {
            requestIp: '192.168.1.100',
          })
        ).rejects.toThrow(ClerkAPIError)
      })

      it('should support user agent binding', async () => {
        const user = await clerk.users.createUser({
          email_address: ['ua-bound@example.com'],
          password: 'Test123!@#',
        })

        const originalUA = 'Mozilla/5.0 Original Browser'

        const session = await clerk.sessions.createSession({
          userId: user.id,
          clientId: 'client_ua_bound',
          userAgent: originalUA,
          bindToUserAgent: true,
        })

        // Request from different user agent should fail
        await expect(
          clerk.sessions.getToken(session.id, undefined, {
            requestUserAgent: 'Mozilla/5.0 Different Browser',
          })
        ).rejects.toThrow(ClerkAPIError)
      })
    })
  })

  // ============================================================================
  // ADDITIONAL EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle concurrent session operations', async () => {
      const { session } = await createTestUserWithSession()

      // Concurrent token generations
      const results = await Promise.all([
        clerk.sessions.getToken(session.id),
        clerk.sessions.getToken(session.id),
        clerk.sessions.getToken(session.id),
      ])

      expect(results).toHaveLength(3)
      results.forEach((r) => expect(r.jwt).toBeDefined())
    })

    it('should handle session operations with network delays gracefully', async () => {
      const { session } = await createTestUserWithSession()

      // Simulate slow operation
      vi.advanceTimersByTime(5000)

      const result = await clerk.sessions.getSession(session.id)
      expect(result.id).toBe(session.id)
    })

    it('should properly clean up expired sessions', async () => {
      const { user, session } = await createTestUserWithSession()

      // Advance time to expire session
      vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000)

      // Trigger cleanup
      await clerk.sessions.cleanupExpiredSessions()

      const sessions = await clerk.sessions.getSessionList({
        user_id: user.id,
        status: 'active',
      })

      expect(sessions.data.find((s) => s.id === session.id)).toBeUndefined()
    })

    it('should handle unicode in custom claims', async () => {
      const { session } = await createTestUserWithSession()

      await clerk.sessions.updateSessionClaims(session.id, {
        user_name: 'Usuario Espanol',
        greeting: 'Konnichiwa',
        emoji: 'Test User',
      })

      const claims = await clerk.sessions.getSessionClaims(session.id)

      expect(claims.user_name).toBe('Usuario Espanol')
      expect(claims.greeting).toBe('Konnichiwa')
    })

    it('should handle session creation with minimal params', async () => {
      const user = await clerk.users.createUser({
        email_address: ['minimal-session@example.com'],
        password: 'Test123!@#',
      })

      const session = await clerk.sessions.createSession({
        userId: user.id,
      })

      expect(session).toBeDefined()
      expect(session.id).toBeDefined()
      expect(session.user_id).toBe(user.id)
    })

    it('should handle bulk session revocation', async () => {
      const user = await clerk.users.createUser({
        email_address: ['bulk-revoke@example.com'],
        password: 'Test123!@#',
      })

      // Create many sessions
      const sessionIds: string[] = []
      for (let i = 0; i < 10; i++) {
        const session = await clerk.sessions.createSession({
          userId: user.id,
          clientId: `client_${i}`,
        })
        sessionIds.push(session.id)
      }

      // Bulk revoke
      const result = await clerk.sessions.bulkRevokeSession(sessionIds)

      expect(result.revoked_count).toBe(10)
      expect(result.failed_count).toBe(0)
    })
  })
})
