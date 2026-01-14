/**
 * Auth Utility Tests
 *
 * Tests for the authentication utility functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getAccessToken,
  getSession,
  isAuthenticated,
  checkSession,
  requireSession,
  type Session,
  type SessionResult,
} from '../utils/auth'
import * as deviceAuth from '../device-auth'

// Mock the device-auth module
vi.mock('../device-auth', () => ({
  getStoredToken: vi.fn(),
}))

const mockGetStoredToken = deviceAuth.getStoredToken as ReturnType<typeof vi.fn>

describe('Auth Utility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getAccessToken', () => {
    it('returns access token when stored', async () => {
      mockGetStoredToken.mockResolvedValue({
        access_token: 'test_token_123',
        token_type: 'Bearer',
      })

      const token = await getAccessToken()

      expect(token).toBe('test_token_123')
    })

    it('returns null when no token is stored', async () => {
      mockGetStoredToken.mockResolvedValue(null)

      const token = await getAccessToken()

      expect(token).toBeNull()
    })
  })

  describe('isAuthenticated', () => {
    it('returns true when valid token exists', async () => {
      mockGetStoredToken.mockResolvedValue({
        access_token: 'test_token',
        token_type: 'Bearer',
        expires_at: Date.now() + 3600000, // 1 hour from now
      })

      const authenticated = await isAuthenticated()

      expect(authenticated).toBe(true)
    })

    it('returns false when no token exists', async () => {
      mockGetStoredToken.mockResolvedValue(null)

      const authenticated = await isAuthenticated()

      expect(authenticated).toBe(false)
    })

    it('returns false when token is expired without refresh token', async () => {
      mockGetStoredToken.mockResolvedValue({
        access_token: 'test_token',
        token_type: 'Bearer',
        expires_at: Date.now() - 3600000, // 1 hour ago
      })

      const authenticated = await isAuthenticated()

      expect(authenticated).toBe(false)
    })

    it('returns true when token is expired but has refresh token', async () => {
      mockGetStoredToken.mockResolvedValue({
        access_token: 'test_token',
        token_type: 'Bearer',
        expires_at: Date.now() - 3600000, // 1 hour ago
        refresh_token: 'refresh_token_123',
      })

      const authenticated = await isAuthenticated()

      expect(authenticated).toBe(true)
    })
  })

  describe('getSession', () => {
    it('returns session with user info from JWT', async () => {
      // Create a mock JWT token with user claims
      const claims = {
        sub: 'user_123',
        email: 'test@example.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      const mockJwt = `eyJ.${payload}.sig`

      mockGetStoredToken.mockResolvedValue({
        access_token: mockJwt,
        token_type: 'Bearer',
        expires_at: Date.now() + 3600000,
      })

      const session = await getSession()

      expect(session).toBeDefined()
      expect(session?.userId).toBe('user_123')
      expect(session?.email).toBe('test@example.com')
      expect(session?.accessToken).toBe(mockJwt)
    })

    it('returns null when no token exists', async () => {
      mockGetStoredToken.mockResolvedValue(null)

      const session = await getSession()

      expect(session).toBeNull()
    })

    it('includes refresh token when present', async () => {
      const claims = { sub: 'user_123', email: 'test@example.com' }
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      const mockJwt = `eyJ.${payload}.sig`

      mockGetStoredToken.mockResolvedValue({
        access_token: mockJwt,
        token_type: 'Bearer',
        refresh_token: 'refresh_123',
        expires_at: Date.now() + 3600000,
      })

      const session = await getSession()

      expect(session?.refreshToken).toBe('refresh_123')
    })

    it('includes scope when present', async () => {
      const claims = { sub: 'user_123', email: 'test@example.com' }
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      const mockJwt = `eyJ.${payload}.sig`

      mockGetStoredToken.mockResolvedValue({
        access_token: mockJwt,
        token_type: 'Bearer',
        scope: 'openid profile email',
        expires_at: Date.now() + 3600000,
      })

      const session = await getSession()

      expect(session?.scope).toBe('openid profile email')
    })

    it('generates placeholder user info for non-JWT tokens', async () => {
      mockGetStoredToken.mockResolvedValue({
        access_token: 'simple_token_12345678',
        token_type: 'Bearer',
        expires_at: Date.now() + 3600000,
      })

      const session = await getSession()

      expect(session).toBeDefined()
      expect(session?.userId).toContain('user_')
    })
  })

  describe('checkSession', () => {
    it('returns authenticated true with valid session', async () => {
      const claims = { sub: 'user_123', email: 'test@example.com' }
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      const mockJwt = `eyJ.${payload}.sig`

      mockGetStoredToken.mockResolvedValue({
        access_token: mockJwt,
        token_type: 'Bearer',
        expires_at: Date.now() + 3600000,
      })

      const result = await checkSession()

      expect(result.authenticated).toBe(true)
      expect(result.session).toBeDefined()
      expect(result.error).toBeUndefined()
    })

    it('returns authenticated false when no session', async () => {
      mockGetStoredToken.mockResolvedValue(null)

      const result = await checkSession()

      expect(result.authenticated).toBe(false)
      expect(result.session).toBeUndefined()
      expect(result.error).toContain('No active session')
    })

    it('returns error for expired session without refresh token', async () => {
      const claims = { sub: 'user_123', email: 'test@example.com' }
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      const mockJwt = `eyJ.${payload}.sig`

      mockGetStoredToken.mockResolvedValue({
        access_token: mockJwt,
        token_type: 'Bearer',
        expires_at: Date.now() - 3600000, // Expired
      })

      const result = await checkSession()

      expect(result.authenticated).toBe(false)
      expect(result.error).toContain('Session expired')
    })

    it('returns authenticated with warning for expired session with refresh token', async () => {
      const claims = { sub: 'user_123', email: 'test@example.com' }
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      const mockJwt = `eyJ.${payload}.sig`

      mockGetStoredToken.mockResolvedValue({
        access_token: mockJwt,
        token_type: 'Bearer',
        expires_at: Date.now() - 3600000, // Expired
        refresh_token: 'refresh_123',
      })

      const result = await checkSession()

      expect(result.authenticated).toBe(true)
      expect(result.session).toBeDefined()
      expect(result.error).toContain('refresh')
    })
  })

  describe('requireSession', () => {
    it('returns session when authenticated', async () => {
      const claims = { sub: 'user_123', email: 'test@example.com' }
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      const mockJwt = `eyJ.${payload}.sig`

      mockGetStoredToken.mockResolvedValue({
        access_token: mockJwt,
        token_type: 'Bearer',
        expires_at: Date.now() + 3600000,
      })

      const session = await requireSession()

      expect(session).toBeDefined()
      expect(session.userId).toBe('user_123')
    })

    it('throws when not authenticated', async () => {
      mockGetStoredToken.mockResolvedValue(null)

      await expect(requireSession()).rejects.toThrow(/not authenticated|login/i)
    })

    it('throws when session is expired without refresh token', async () => {
      const claims = { sub: 'user_123', email: 'test@example.com' }
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      const mockJwt = `eyJ.${payload}.sig`

      mockGetStoredToken.mockResolvedValue({
        access_token: mockJwt,
        token_type: 'Bearer',
        expires_at: Date.now() - 3600000, // Expired
      })

      await expect(requireSession()).rejects.toThrow(/expired/i)
    })
  })

  describe('Session type', () => {
    it('has all required properties', async () => {
      const claims = { sub: 'user_123', email: 'test@example.com' }
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      const mockJwt = `eyJ.${payload}.sig`

      mockGetStoredToken.mockResolvedValue({
        access_token: mockJwt,
        token_type: 'Bearer',
        expires_at: Date.now() + 3600000,
        refresh_token: 'refresh_123',
        scope: 'openid profile',
      })

      const session = await getSession()

      // Required properties
      expect(typeof session?.userId).toBe('string')
      expect(typeof session?.email).toBe('string')
      expect(typeof session?.accessToken).toBe('string')
      expect(typeof session?.expiresAt).toBe('string')

      // Optional properties
      expect(session?.refreshToken).toBeDefined()
      expect(session?.scope).toBeDefined()
    })

    it('expiresAt is a valid ISO 8601 string', async () => {
      const claims = { sub: 'user_123', email: 'test@example.com' }
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      const mockJwt = `eyJ.${payload}.sig`

      mockGetStoredToken.mockResolvedValue({
        access_token: mockJwt,
        token_type: 'Bearer',
        expires_at: Date.now() + 3600000,
      })

      const session = await getSession()

      expect(session?.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      expect(new Date(session!.expiresAt).getTime()).toBeGreaterThan(0)
    })
  })
})
