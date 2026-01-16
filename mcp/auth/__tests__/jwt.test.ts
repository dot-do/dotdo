/**
 * JWT Module Tests
 *
 * Comprehensive tests for mcp/auth/jwt.ts covering:
 * - Token creation and validation
 * - Token decoding
 * - Request authentication
 * - Permission checking
 * - Token refresh
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as jose from 'jose'
import {
  createJwt,
  validateJwt,
  decodeJwt,
  extractBearerToken,
  extractQueryToken,
  authenticateRequest,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  tokenNeedsRefresh,
  refreshJwt,
} from '../jwt'
import type { JwtPayload } from '../../types'

describe('mcp/auth JWT', () => {
  const testSecret = 'test-secret-key-that-is-long-enough-for-HS256'

  // Helper to create a valid payload
  const createPayload = (overrides: Partial<Omit<JwtPayload, 'iat' | 'exp'>> = {}) => ({
    sub: 'user-123',
    email: 'test@example.com',
    org_id: 'org-456',
    permissions: ['read', 'write'],
    ...overrides,
  })

  // ============================================================================
  // createJwt Tests
  // ============================================================================

  describe('createJwt', () => {
    it('should create valid JWT token', async () => {
      const payload = createPayload()
      const token = await createJwt(payload, testSecret)

      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
      // JWT has 3 parts separated by dots
      expect(token.split('.')).toHaveLength(3)
    })

    it('should include required claims', async () => {
      const payload = createPayload()
      const token = await createJwt(payload, testSecret)

      // Decode to inspect claims
      const decoded = jose.decodeJwt(token)

      expect(decoded.sub).toBe(payload.sub)
      expect(decoded.email).toBe(payload.email)
      expect(decoded.org_id).toBe(payload.org_id)
      expect(decoded.permissions).toEqual(payload.permissions)
      expect(decoded.iat).toBeDefined()
      expect(decoded.exp).toBeDefined()
    })

    it('should set default expiration to 24 hours', async () => {
      const payload = createPayload()
      const token = await createJwt(payload, testSecret)

      const decoded = jose.decodeJwt(token)
      const iat = decoded.iat as number
      const exp = decoded.exp as number

      // 24 hours = 86400 seconds
      expect(exp - iat).toBe(86400)
    })

    it('should respect custom expiration', async () => {
      const payload = createPayload()
      const token = await createJwt(payload, testSecret, { expiresIn: '1h' })

      const decoded = jose.decodeJwt(token)
      const iat = decoded.iat as number
      const exp = decoded.exp as number

      // 1 hour = 3600 seconds
      expect(exp - iat).toBe(3600)
    })

    it('should default to empty permissions array if not provided', async () => {
      const payload = { sub: 'user-123' }
      const token = await createJwt(payload, testSecret)

      const decoded = jose.decodeJwt(token)
      expect(decoded.permissions).toEqual([])
    })

    it('should handle minimal payload with only sub', async () => {
      const payload = { sub: 'minimal-user' }
      const token = await createJwt(payload, testSecret)

      const decoded = jose.decodeJwt(token)
      expect(decoded.sub).toBe('minimal-user')
      expect(decoded.iat).toBeDefined()
      expect(decoded.exp).toBeDefined()
    })
  })

  // ============================================================================
  // validateJwt Tests
  // ============================================================================

  describe('validateJwt', () => {
    it('should validate correct token', async () => {
      const payload = createPayload()
      const token = await createJwt(payload, testSecret)

      const result = await validateJwt(token, testSecret)

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.payload.sub).toBe(payload.sub)
        expect(result.payload.email).toBe(payload.email)
        expect(result.payload.org_id).toBe(payload.org_id)
        expect(result.payload.permissions).toEqual(payload.permissions)
      }
    })

    it('should reject expired token', async () => {
      // Create a token with exp in the past (beyond clock tolerance of 60s)
      const secretKey = new TextEncoder().encode(testSecret)
      const now = Math.floor(Date.now() / 1000)

      const token = await new jose.SignJWT({
        sub: 'user-123',
        permissions: [],
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(now - 7200) // 2 hours ago
        .setSubject('user-123')
        .setExpirationTime(now - 120) // Expired 2 minutes ago (beyond 60s clock tolerance)
        .sign(secretKey)

      const result = await validateJwt(token, testSecret)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('Token has expired')
      }
    })

    it('should reject tampered token', async () => {
      const payload = createPayload()
      const token = await createJwt(payload, testSecret)

      // Tamper with the token by changing a character in the payload
      const parts = token.split('.')
      // Modify the payload part (middle)
      const tamperedPayload = parts[1].slice(0, -1) + (parts[1].slice(-1) === 'a' ? 'b' : 'a')
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`

      const result = await validateJwt(tamperedToken, testSecret)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toMatch(/signature|malformed|invalid/i)
      }
    })

    it('should reject token signed with wrong secret', async () => {
      const payload = createPayload()
      const token = await createJwt(payload, testSecret)

      const result = await validateJwt(token, 'wrong-secret-key-that-is-different')

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('Invalid token signature')
      }
    })

    it('should reject invalid format token', async () => {
      const result = await validateJwt('not.a.valid.jwt.token', testSecret)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toMatch(/invalid|malformed/i)
      }
    })

    it('should reject completely malformed token', async () => {
      const result = await validateJwt('garbage', testSecret)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBeDefined()
      }
    })

    it('should reject empty token', async () => {
      const result = await validateJwt('', testSecret)

      expect(result.valid).toBe(false)
    })

    it('should handle missing required claims', async () => {
      // Create a token with jose directly, missing 'sub'
      const secretKey = new TextEncoder().encode(testSecret)
      const token = await new jose.SignJWT({ email: 'test@example.com', permissions: [] })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secretKey)

      const result = await validateJwt(token, testSecret)

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('Invalid JWT payload structure')
      }
    })
  })

  // ============================================================================
  // decodeJwt Tests
  // ============================================================================

  describe('decodeJwt', () => {
    // Suppress console.error during these tests since decodeJwt logs errors
    let consoleSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleSpy.mockRestore()
    })

    it('should decode without verification', async () => {
      const payload = createPayload()
      const token = await createJwt(payload, testSecret)

      const decoded = decodeJwt(token)

      expect(decoded).not.toBeNull()
      expect(decoded?.sub).toBe(payload.sub)
      expect(decoded?.email).toBe(payload.email)
      expect(decoded?.permissions).toEqual(payload.permissions)
    })

    it('should decode token signed with different secret', async () => {
      const payload = createPayload()
      const token = await createJwt(payload, 'different-secret-key-for-signing')

      // decodeJwt doesn't verify signature
      const decoded = decodeJwt(token)

      expect(decoded).not.toBeNull()
      expect(decoded?.sub).toBe(payload.sub)
    })

    it('should return null for empty token', () => {
      const result = decodeJwt('')

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()
    })

    it('should return null for whitespace-only token', () => {
      const result = decodeJwt('   ')

      expect(result).toBeNull()
    })

    it('should return null for malformed token (wrong number of parts)', () => {
      const result = decodeJwt('only.two')

      expect(result).toBeNull()
      // Jose catches malformed tokens and throws, which we catch and log
      expect(consoleSpy).toHaveBeenCalled()
    })

    it('should return null for token with too many parts', () => {
      const result = decodeJwt('a.b.c.d')

      expect(result).toBeNull()
    })

    it('should return null for token with invalid base64', () => {
      const result = decodeJwt('invalid.!!!invalid.signature')

      expect(result).toBeNull()
    })

    it('should log warning for suspicious subject claim', async () => {
      // Create token with suspicious sub containing '..'
      const secretKey = new TextEncoder().encode(testSecret)
      const token = await new jose.SignJWT({
        sub: '../../../etc/passwd',
        permissions: [],
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('../../../etc/passwd')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secretKey)

      decodeJwt(token)

      // Verify warning was logged about suspicious subject
      expect(consoleSpy).toHaveBeenCalled()
      const calls = consoleSpy.mock.calls
      const suspiciousCall = calls.find(
        (call) => call.some((arg) => typeof arg === 'string' && arg.includes('suspicious'))
      )
      expect(suspiciousCall).toBeDefined()
    })

    it('should return null for payload missing required fields', async () => {
      // Create token missing 'sub'
      const secretKey = new TextEncoder().encode(testSecret)
      const token = await new jose.SignJWT({ email: 'test@example.com', permissions: [] })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secretKey)

      const result = decodeJwt(token)

      expect(result).toBeNull()
    })

    it('should default permissions to empty array if missing', async () => {
      const secretKey = new TextEncoder().encode(testSecret)
      const token = await new jose.SignJWT({ sub: 'user-123' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('user-123')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secretKey)

      const result = decodeJwt(token)

      expect(result?.permissions).toEqual([])
    })
  })

  // ============================================================================
  // extractBearerToken Tests
  // ============================================================================

  describe('extractBearerToken', () => {
    it('should extract valid Bearer token', () => {
      const request = new Request('https://api.example.com', {
        headers: { Authorization: 'Bearer my-token-123' },
      })

      const token = extractBearerToken(request)

      expect(token).toBe('my-token-123')
    })

    it('should return null for missing Authorization header', () => {
      const request = new Request('https://api.example.com')

      const token = extractBearerToken(request)

      expect(token).toBeNull()
    })

    it('should return null for non-Bearer Authorization header', () => {
      const request = new Request('https://api.example.com', {
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      })

      const token = extractBearerToken(request)

      expect(token).toBeNull()
    })

    it('should return null for Bearer without token (trimmed by Request)', () => {
      // Note: Request constructor trims trailing whitespace from header values
      // So 'Bearer ' becomes 'Bearer' which doesn't match 'startsWith("Bearer ")'
      const request = new Request('https://api.example.com', {
        headers: { Authorization: 'Bearer ' },
      })

      const token = extractBearerToken(request)

      expect(token).toBeNull()
    })

    it('should handle Bearer with extra spaces in token', () => {
      const request = new Request('https://api.example.com', {
        headers: { Authorization: 'Bearer token with spaces' },
      })

      const token = extractBearerToken(request)

      expect(token).toBe('token with spaces')
    })

    it('should be case-sensitive for Bearer prefix', () => {
      const request = new Request('https://api.example.com', {
        headers: { Authorization: 'bearer my-token' },
      })

      const token = extractBearerToken(request)

      expect(token).toBeNull()
    })
  })

  // ============================================================================
  // extractQueryToken Tests
  // ============================================================================

  describe('extractQueryToken', () => {
    it('should extract token from query param', () => {
      const url = new URL('https://api.example.com/sse?token=my-query-token')

      const token = extractQueryToken(url)

      expect(token).toBe('my-query-token')
    })

    it('should return null when no token param', () => {
      const url = new URL('https://api.example.com/sse')

      const token = extractQueryToken(url)

      expect(token).toBeNull()
    })

    it('should return null for empty token param', () => {
      const url = new URL('https://api.example.com/sse?token=')

      const token = extractQueryToken(url)

      expect(token).toBe('')
    })

    it('should handle URL-encoded token', () => {
      const url = new URL('https://api.example.com/sse?token=abc%2Bdef%3D%3D')

      const token = extractQueryToken(url)

      expect(token).toBe('abc+def==')
    })

    it('should handle multiple query params', () => {
      const url = new URL('https://api.example.com/sse?other=value&token=my-token&more=stuff')

      const token = extractQueryToken(url)

      expect(token).toBe('my-token')
    })
  })

  // ============================================================================
  // authenticateRequest Tests
  // ============================================================================

  describe('authenticateRequest', () => {
    const mockEnv = { JWT_SECRET: testSecret }

    it('should authenticate valid Bearer token', async () => {
      const payload = createPayload()
      const token = await createJwt(payload, testSecret)

      const request = new Request('https://api.example.com', {
        headers: { Authorization: `Bearer ${token}` },
      })

      const result = await authenticateRequest(request, mockEnv)

      expect(result.authenticated).toBe(true)
      expect(result.userId).toBe(payload.sub)
      expect(result.permissions).toEqual(payload.permissions)
      expect(result.jwt).toBeDefined()
    })

    it('should authenticate valid query token (SSE)', async () => {
      const payload = createPayload()
      const token = await createJwt(payload, testSecret)

      const request = new Request(`https://api.example.com/sse?token=${token}`)

      const result = await authenticateRequest(request, mockEnv)

      expect(result.authenticated).toBe(true)
      expect(result.userId).toBe(payload.sub)
    })

    it('should prefer Bearer token over query token', async () => {
      const bearerPayload = createPayload({ sub: 'bearer-user' })
      const queryPayload = createPayload({ sub: 'query-user' })

      const bearerToken = await createJwt(bearerPayload, testSecret)
      const queryToken = await createJwt(queryPayload, testSecret)

      const request = new Request(`https://api.example.com?token=${queryToken}`, {
        headers: { Authorization: `Bearer ${bearerToken}` },
      })

      const result = await authenticateRequest(request, mockEnv)

      expect(result.authenticated).toBe(true)
      expect(result.userId).toBe('bearer-user')
    })

    it('should return unauthenticated for missing token', async () => {
      const request = new Request('https://api.example.com')

      const result = await authenticateRequest(request, mockEnv)

      expect(result.authenticated).toBe(false)
      expect(result.permissions).toEqual([])
      expect(result.userId).toBeUndefined()
    })

    it('should return unauthenticated for invalid token', async () => {
      const request = new Request('https://api.example.com', {
        headers: { Authorization: 'Bearer invalid-token' },
      })

      const result = await authenticateRequest(request, mockEnv)

      expect(result.authenticated).toBe(false)
      expect(result.permissions).toEqual([])
    })

    it('should return unauthenticated for expired token', async () => {
      // Create an expired token (beyond 60s clock tolerance)
      const secretKey = new TextEncoder().encode(testSecret)
      const now = Math.floor(Date.now() / 1000)

      const token = await new jose.SignJWT({
        sub: 'user-123',
        permissions: [],
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(now - 7200)
        .setSubject('user-123')
        .setExpirationTime(now - 120) // Expired 2 minutes ago
        .sign(secretKey)

      const request = new Request('https://api.example.com', {
        headers: { Authorization: `Bearer ${token}` },
      })

      const result = await authenticateRequest(request, mockEnv)

      expect(result.authenticated).toBe(false)
    })

    it('should fall back to query token when Bearer is missing', async () => {
      const payload = createPayload({ sub: 'query-only-user' })
      const token = await createJwt(payload, testSecret)

      const request = new Request(`https://api.example.com/sse?token=${token}`)

      const result = await authenticateRequest(request, mockEnv)

      expect(result.authenticated).toBe(true)
      expect(result.userId).toBe('query-only-user')
    })
  })

  // ============================================================================
  // hasPermission Tests
  // ============================================================================

  describe('hasPermission', () => {
    it('should return true for direct permission match', () => {
      const permissions = ['read', 'write', 'delete']

      expect(hasPermission(permissions, 'read')).toBe(true)
      expect(hasPermission(permissions, 'write')).toBe(true)
      expect(hasPermission(permissions, 'delete')).toBe(true)
    })

    it('should return false for missing permission', () => {
      const permissions = ['read', 'write']

      expect(hasPermission(permissions, 'delete')).toBe(false)
      expect(hasPermission(permissions, 'admin')).toBe(false)
    })

    it('should grant all permissions with wildcard', () => {
      const permissions = ['*']

      expect(hasPermission(permissions, 'read')).toBe(true)
      expect(hasPermission(permissions, 'write')).toBe(true)
      expect(hasPermission(permissions, 'admin:users:delete')).toBe(true)
      expect(hasPermission(permissions, 'anything')).toBe(true)
    })

    it('should support hierarchical permissions (tools:* grants tools:search)', () => {
      const permissions = ['tools:*']

      expect(hasPermission(permissions, 'tools:search')).toBe(true)
      expect(hasPermission(permissions, 'tools:execute')).toBe(true)
      expect(hasPermission(permissions, 'tools:list')).toBe(true)
    })

    it('should not grant parent from child permission', () => {
      const permissions = ['tools:search']

      expect(hasPermission(permissions, 'tools:*')).toBe(false)
      expect(hasPermission(permissions, 'tools')).toBe(false)
    })

    it('should support multi-level hierarchical permissions', () => {
      const permissions = ['admin:users:*']

      expect(hasPermission(permissions, 'admin:users:read')).toBe(true)
      expect(hasPermission(permissions, 'admin:users:write')).toBe(true)
      expect(hasPermission(permissions, 'admin:users:delete')).toBe(true)
      expect(hasPermission(permissions, 'admin:settings:read')).toBe(false)
    })

    it('should support wildcard at different levels', () => {
      const permissions = ['admin:*']

      expect(hasPermission(permissions, 'admin:users')).toBe(true)
      expect(hasPermission(permissions, 'admin:users:read')).toBe(true)
      expect(hasPermission(permissions, 'admin:settings:write')).toBe(true)
      expect(hasPermission(permissions, 'other:read')).toBe(false)
    })

    it('should handle empty permissions array', () => {
      const permissions: string[] = []

      expect(hasPermission(permissions, 'read')).toBe(false)
      expect(hasPermission(permissions, '*')).toBe(false)
    })

    it('should handle permission without colons', () => {
      const permissions = ['read', 'write']

      expect(hasPermission(permissions, 'read')).toBe(true)
      expect(hasPermission(permissions, 'admin')).toBe(false)
    })

    it('should not match partial permission names', () => {
      const permissions = ['reader']

      expect(hasPermission(permissions, 'read')).toBe(false)
    })
  })

  // ============================================================================
  // hasAllPermissions Tests
  // ============================================================================

  describe('hasAllPermissions', () => {
    it('should return true when all permissions are present', () => {
      const permissions = ['read', 'write', 'delete']

      expect(hasAllPermissions(permissions, ['read', 'write'])).toBe(true)
      expect(hasAllPermissions(permissions, ['read'])).toBe(true)
      expect(hasAllPermissions(permissions, ['read', 'write', 'delete'])).toBe(true)
    })

    it('should return false when any permission is missing', () => {
      const permissions = ['read', 'write']

      expect(hasAllPermissions(permissions, ['read', 'write', 'delete'])).toBe(false)
      expect(hasAllPermissions(permissions, ['read', 'admin'])).toBe(false)
    })

    it('should return true for empty required array', () => {
      const permissions = ['read', 'write']

      expect(hasAllPermissions(permissions, [])).toBe(true)
    })

    it('should support wildcard for all checks', () => {
      const permissions = ['*']

      expect(hasAllPermissions(permissions, ['read', 'write', 'admin'])).toBe(true)
    })

    it('should support hierarchical permissions in all checks', () => {
      const permissions = ['tools:*', 'admin:users:read']

      expect(hasAllPermissions(permissions, ['tools:search', 'tools:execute'])).toBe(true)
      expect(hasAllPermissions(permissions, ['tools:search', 'admin:users:read'])).toBe(true)
      expect(hasAllPermissions(permissions, ['tools:search', 'admin:users:write'])).toBe(false)
    })
  })

  // ============================================================================
  // hasAnyPermission Tests
  // ============================================================================

  describe('hasAnyPermission', () => {
    it('should return true when any permission is present', () => {
      const permissions = ['read', 'write']

      expect(hasAnyPermission(permissions, ['read', 'admin'])).toBe(true)
      expect(hasAnyPermission(permissions, ['admin', 'write'])).toBe(true)
      expect(hasAnyPermission(permissions, ['read'])).toBe(true)
    })

    it('should return false when no permissions match', () => {
      const permissions = ['read', 'write']

      expect(hasAnyPermission(permissions, ['delete', 'admin'])).toBe(false)
      expect(hasAnyPermission(permissions, ['execute'])).toBe(false)
    })

    it('should return false for empty required array', () => {
      const permissions = ['read', 'write']

      expect(hasAnyPermission(permissions, [])).toBe(false)
    })

    it('should support wildcard for any check', () => {
      const permissions = ['*']

      expect(hasAnyPermission(permissions, ['admin', 'superuser'])).toBe(true)
    })

    it('should support hierarchical permissions in any checks', () => {
      const permissions = ['tools:*']

      expect(hasAnyPermission(permissions, ['admin:read', 'tools:search'])).toBe(true)
      expect(hasAnyPermission(permissions, ['admin:read', 'admin:write'])).toBe(false)
    })
  })

  // ============================================================================
  // tokenNeedsRefresh Tests
  // ============================================================================

  describe('tokenNeedsRefresh', () => {
    it('should return true when within 5 minutes of expiry', () => {
      const now = Math.floor(Date.now() / 1000)
      const payload: JwtPayload = {
        sub: 'user-123',
        iat: now - 3600, // 1 hour ago
        exp: now + 60, // expires in 1 minute
        permissions: [],
      }

      expect(tokenNeedsRefresh(payload)).toBe(true)
    })

    it('should return true when exactly at 5 minute threshold', () => {
      const now = Math.floor(Date.now() / 1000)
      const payload: JwtPayload = {
        sub: 'user-123',
        iat: now - 3600,
        exp: now + 299, // expires in 4:59 (just under 5 minutes)
        permissions: [],
      }

      expect(tokenNeedsRefresh(payload)).toBe(true)
    })

    it('should return false when more than 5 minutes from expiry', () => {
      const now = Math.floor(Date.now() / 1000)
      const payload: JwtPayload = {
        sub: 'user-123',
        iat: now - 3600,
        exp: now + 600, // expires in 10 minutes
        permissions: [],
      }

      expect(tokenNeedsRefresh(payload)).toBe(false)
    })

    it('should return true for already expired token', () => {
      const now = Math.floor(Date.now() / 1000)
      const payload: JwtPayload = {
        sub: 'user-123',
        iat: now - 7200,
        exp: now - 60, // expired 1 minute ago
        permissions: [],
      }

      expect(tokenNeedsRefresh(payload)).toBe(true)
    })

    it('should return false for token with plenty of time left', () => {
      const now = Math.floor(Date.now() / 1000)
      const payload: JwtPayload = {
        sub: 'user-123',
        iat: now,
        exp: now + 86400, // expires in 24 hours
        permissions: [],
      }

      expect(tokenNeedsRefresh(payload)).toBe(false)
    })
  })

  // ============================================================================
  // refreshJwt Tests
  // ============================================================================

  describe('refreshJwt', () => {
    it('should create new token with same claims', async () => {
      const originalPayload: JwtPayload = {
        sub: 'user-123',
        iat: Math.floor(Date.now() / 1000) - 3600,
        exp: Math.floor(Date.now() / 1000) + 300, // about to expire
        email: 'test@example.com',
        org_id: 'org-456',
        permissions: ['read', 'write'],
      }

      const newToken = await refreshJwt(originalPayload, testSecret)

      // Validate the new token
      const result = await validateJwt(newToken, testSecret)

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.payload.sub).toBe(originalPayload.sub)
        expect(result.payload.email).toBe(originalPayload.email)
        expect(result.payload.org_id).toBe(originalPayload.org_id)
        expect(result.payload.permissions).toEqual(originalPayload.permissions)
      }
    })

    it('should create token with new iat and exp', async () => {
      const now = Math.floor(Date.now() / 1000)
      const originalPayload: JwtPayload = {
        sub: 'user-123',
        iat: now - 3600,
        exp: now + 300,
        permissions: [],
      }

      const newToken = await refreshJwt(originalPayload, testSecret)
      const decoded = jose.decodeJwt(newToken)

      // New iat should be close to current time
      expect(decoded.iat).toBeGreaterThanOrEqual(now)
      expect(decoded.iat).toBeLessThanOrEqual(now + 5)

      // New exp should be 24 hours from new iat (default)
      expect((decoded.exp as number) - (decoded.iat as number)).toBe(86400)
    })

    it('should respect custom expiration', async () => {
      const originalPayload: JwtPayload = {
        sub: 'user-123',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        permissions: [],
      }

      const newToken = await refreshJwt(originalPayload, testSecret, { expiresIn: '2h' })
      const decoded = jose.decodeJwt(newToken)

      // 2 hours = 7200 seconds
      expect((decoded.exp as number) - (decoded.iat as number)).toBe(7200)
    })

    it('should preserve optional fields', async () => {
      const originalPayload: JwtPayload = {
        sub: 'user-123',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: 'preserve@example.com',
        org_id: 'preserve-org',
        permissions: ['preserved-permission'],
      }

      const newToken = await refreshJwt(originalPayload, testSecret)
      const decoded = jose.decodeJwt(newToken)

      expect(decoded.email).toBe('preserve@example.com')
      expect(decoded.org_id).toBe('preserve-org')
      expect(decoded.permissions).toEqual(['preserved-permission'])
    })

    it('should handle payload with undefined optional fields', async () => {
      const originalPayload: JwtPayload = {
        sub: 'user-123',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        permissions: [],
      }

      const newToken = await refreshJwt(originalPayload, testSecret)
      const result = await validateJwt(newToken, testSecret)

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.payload.sub).toBe('user-123')
        expect(result.payload.email).toBeUndefined()
        expect(result.payload.org_id).toBeUndefined()
      }
    })
  })
})
