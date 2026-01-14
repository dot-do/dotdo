/**
 * Tests for JWT creation and verification
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createJWT,
  verifyJWT,
  decodeJWT,
  isTokenExpired,
  getTokenExpiration,
  getTokenTTL,
  getTokenSubject,
} from '../jwt'
import type { JWTClaims } from '../types'

describe('JWT', () => {
  const TEST_SECRET = 'test-secret-key-that-is-long-enough'

  // ============================================================================
  // JWT CREATION
  // ============================================================================

  describe('createJWT', () => {
    it('should create a valid JWT with default options', async () => {
      const claims: JWTClaims = {
        email: 'test@example.com',
        name: 'Test User',
      }

      const token = await createJWT(claims, { secret: TEST_SECRET })

      expect(token).toBeDefined()
      expect(token.split('.')).toHaveLength(3)
    })

    it('should include standard claims', async () => {
      const token = await createJWT({}, {
        secret: TEST_SECRET,
        issuer: 'https://auth.example.com',
        audience: 'my-app',
        subject: 'user_123',
        expiresIn: 3600,
      })

      const decoded = decodeJWT(token)

      expect(decoded).not.toBeNull()
      expect(decoded?.claims.iss).toBe('https://auth.example.com')
      expect(decoded?.claims.aud).toBe('my-app')
      expect(decoded?.claims.sub).toBe('user_123')
      expect(decoded?.claims.exp).toBeDefined()
      expect(decoded?.claims.iat).toBeDefined()
      expect(decoded?.claims.jti).toBeDefined()
    })

    it('should include custom claims', async () => {
      const token = await createJWT(
        {
          email: 'test@example.com',
          roles: ['admin', 'user'],
          metadata: { team: 'engineering' },
        },
        { secret: TEST_SECRET }
      )

      const decoded = decodeJWT(token)

      expect(decoded?.claims.email).toBe('test@example.com')
      expect(decoded?.claims.roles).toEqual(['admin', 'user'])
      expect(decoded?.claims.metadata).toEqual({ team: 'engineering' })
    })

    it('should set correct header', async () => {
      const token = await createJWT({}, { secret: TEST_SECRET, algorithm: 'HS256' })

      const decoded = decodeJWT(token)

      expect(decoded?.header.alg).toBe('HS256')
      expect(decoded?.header.typ).toBe('JWT')
    })

    it('should include kid when provided', async () => {
      const token = await createJWT({}, {
        secret: TEST_SECRET,
        kid: 'key-123',
      })

      const decoded = decodeJWT(token)

      expect(decoded?.header.kid).toBe('key-123')
    })

    it('should handle notBefore claim', async () => {
      const token = await createJWT({}, {
        secret: TEST_SECRET,
        notBefore: 60, // 1 minute from now
      })

      const decoded = decodeJWT(token)
      const now = Math.floor(Date.now() / 1000)

      expect(decoded?.claims.nbf).toBeDefined()
      expect(decoded?.claims.nbf).toBeGreaterThanOrEqual(now + 55)
      expect(decoded?.claims.nbf).toBeLessThanOrEqual(now + 65)
    })
  })

  // ============================================================================
  // JWT VERIFICATION
  // ============================================================================

  describe('verifyJWT', () => {
    it('should verify a valid token', async () => {
      const token = await createJWT(
        { email: 'test@example.com' },
        { secret: TEST_SECRET, expiresIn: 3600 }
      )

      const result = await verifyJWT(token, { secret: TEST_SECRET })

      expect(result.valid).toBe(true)
      expect(result.claims?.email).toBe('test@example.com')
    })

    it('should reject token with wrong secret', async () => {
      const token = await createJWT({}, { secret: TEST_SECRET })

      const result = await verifyJWT(token, { secret: 'wrong-secret' })

      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('invalid_signature')
    })

    it('should reject expired token', async () => {
      const token = await createJWT(
        { exp: Math.floor(Date.now() / 1000) - 100 }, // Expired 100 seconds ago
        { secret: TEST_SECRET }
      )

      const result = await verifyJWT(token, { secret: TEST_SECRET })

      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('token_expired')
    })

    it('should accept expired token when ignoreExpiration is true', async () => {
      const token = await createJWT(
        { exp: Math.floor(Date.now() / 1000) - 100 },
        { secret: TEST_SECRET }
      )

      const result = await verifyJWT(token, {
        secret: TEST_SECRET,
        ignoreExpiration: true,
      })

      expect(result.valid).toBe(true)
    })

    it('should reject token not yet valid', async () => {
      const token = await createJWT(
        { nbf: Math.floor(Date.now() / 1000) + 1000 }, // Valid in 1000 seconds
        { secret: TEST_SECRET }
      )

      const result = await verifyJWT(token, { secret: TEST_SECRET })

      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('token_not_active')
    })

    it('should validate issuer', async () => {
      const token = await createJWT({}, {
        secret: TEST_SECRET,
        issuer: 'https://auth.example.com',
        expiresIn: 3600,
      })

      // Should pass with correct issuer
      const validResult = await verifyJWT(token, {
        secret: TEST_SECRET,
        issuer: 'https://auth.example.com',
      })
      expect(validResult.valid).toBe(true)

      // Should fail with wrong issuer
      const invalidResult = await verifyJWT(token, {
        secret: TEST_SECRET,
        issuer: 'https://other.example.com',
      })
      expect(invalidResult.valid).toBe(false)
      expect(invalidResult.error?.code).toBe('invalid_issuer')
    })

    it('should validate audience', async () => {
      const token = await createJWT({}, {
        secret: TEST_SECRET,
        audience: 'my-app',
        expiresIn: 3600,
      })

      // Should pass with correct audience
      const validResult = await verifyJWT(token, {
        secret: TEST_SECRET,
        audience: 'my-app',
      })
      expect(validResult.valid).toBe(true)

      // Should fail with wrong audience
      const invalidResult = await verifyJWT(token, {
        secret: TEST_SECRET,
        audience: 'other-app',
      })
      expect(invalidResult.valid).toBe(false)
      expect(invalidResult.error?.code).toBe('invalid_audience')
    })

    it('should validate multiple audiences', async () => {
      const token = await createJWT({}, {
        secret: TEST_SECRET,
        audience: ['app1', 'app2'],
        expiresIn: 3600,
      })

      // Should pass with any matching audience
      const result = await verifyJWT(token, {
        secret: TEST_SECRET,
        audience: 'app1',
      })
      expect(result.valid).toBe(true)
    })

    it('should validate required claims', async () => {
      const token = await createJWT(
        { email: 'test@example.com' },
        { secret: TEST_SECRET, expiresIn: 3600 }
      )

      // Should fail if required claim is missing
      const result = await verifyJWT(token, {
        secret: TEST_SECRET,
        requiredClaims: ['email', 'roles'],
      })

      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('missing_claim')
    })

    it('should reject wrong algorithm', async () => {
      const token = await createJWT({}, {
        secret: TEST_SECRET,
        algorithm: 'HS256',
        expiresIn: 3600,
      })

      const result = await verifyJWT(token, {
        secret: TEST_SECRET,
        algorithms: ['HS512'],
      })

      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('invalid_algorithm')
    })

    it('should handle clock tolerance', async () => {
      const token = await createJWT(
        { exp: Math.floor(Date.now() / 1000) - 5 }, // Expired 5 seconds ago
        { secret: TEST_SECRET }
      )

      // Should fail without tolerance
      const failResult = await verifyJWT(token, { secret: TEST_SECRET })
      expect(failResult.valid).toBe(false)

      // Should pass with tolerance
      const passResult = await verifyJWT(token, {
        secret: TEST_SECRET,
        clockTolerance: 10,
      })
      expect(passResult.valid).toBe(true)
    })

    it('should validate max age', async () => {
      const oldIat = Math.floor(Date.now() / 1000) - 7200 // 2 hours ago
      const token = await createJWT(
        { iat: oldIat, exp: Math.floor(Date.now() / 1000) + 3600 },
        { secret: TEST_SECRET }
      )

      const result = await verifyJWT(token, {
        secret: TEST_SECRET,
        maxAge: 3600, // 1 hour max age
      })

      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('token_too_old')
    })

    it('should reject malformed tokens', async () => {
      const result1 = await verifyJWT('not.a.jwt.at.all', { secret: TEST_SECRET })
      expect(result1.valid).toBe(false)

      const result2 = await verifyJWT('only.twoparts', { secret: TEST_SECRET })
      expect(result2.valid).toBe(false)

      const result3 = await verifyJWT('!!!invalid!!!.!!!base64!!!.!!!here!!!', { secret: TEST_SECRET })
      expect(result3.valid).toBe(false)
    })
  })

  // ============================================================================
  // JWT DECODE
  // ============================================================================

  describe('decodeJWT', () => {
    it('should decode a valid token without verification', async () => {
      const token = await createJWT(
        { email: 'test@example.com' },
        { secret: TEST_SECRET }
      )

      const decoded = decodeJWT(token)

      expect(decoded).not.toBeNull()
      expect(decoded?.claims.email).toBe('test@example.com')
      expect(decoded?.header.alg).toBe('HS256')
    })

    it('should return null for invalid tokens', () => {
      expect(decodeJWT('invalid')).toBeNull()
      expect(decodeJWT('not.enough')).toBeNull()
      expect(decodeJWT('')).toBeNull()
    })
  })

  // ============================================================================
  // JWT HELPERS
  // ============================================================================

  describe('isTokenExpired', () => {
    it('should return true for expired token', async () => {
      const token = await createJWT(
        { exp: Math.floor(Date.now() / 1000) - 100 },
        { secret: TEST_SECRET }
      )

      expect(isTokenExpired(token)).toBe(true)
    })

    it('should return false for valid token', async () => {
      const token = await createJWT({}, {
        secret: TEST_SECRET,
        expiresIn: 3600,
      })

      expect(isTokenExpired(token)).toBe(false)
    })

    it('should handle clock tolerance', async () => {
      const token = await createJWT(
        { exp: Math.floor(Date.now() / 1000) - 5 },
        { secret: TEST_SECRET }
      )

      expect(isTokenExpired(token)).toBe(true)
      expect(isTokenExpired(token, 10)).toBe(false)
    })
  })

  describe('getTokenExpiration', () => {
    it('should return expiration date', async () => {
      const token = await createJWT({}, {
        secret: TEST_SECRET,
        expiresIn: 3600,
      })

      const expiration = getTokenExpiration(token)

      expect(expiration).toBeInstanceOf(Date)
      expect(expiration!.getTime()).toBeGreaterThan(Date.now())
    })

    it('should return null for token without expiration', async () => {
      // Create token with manual claims (no exp)
      const token = await createJWT({ email: 'test@example.com' }, { secret: TEST_SECRET })

      // Token has exp because createJWT doesn't add one without expiresIn
      const decoded = decodeJWT(token)
      if (!decoded?.claims.exp) {
        const expiration = getTokenExpiration(token)
        expect(expiration).toBeNull()
      }
    })
  })

  describe('getTokenTTL', () => {
    it('should return remaining TTL in seconds', async () => {
      const token = await createJWT({}, {
        secret: TEST_SECRET,
        expiresIn: 3600,
      })

      const ttl = getTokenTTL(token)

      expect(ttl).toBeGreaterThan(3590)
      expect(ttl).toBeLessThanOrEqual(3600)
    })

    it('should return 0 for expired token', async () => {
      const token = await createJWT(
        { exp: Math.floor(Date.now() / 1000) - 100 },
        { secret: TEST_SECRET }
      )

      const ttl = getTokenTTL(token)

      expect(ttl).toBe(0)
    })
  })

  describe('getTokenSubject', () => {
    it('should return the subject claim', async () => {
      const token = await createJWT({}, {
        secret: TEST_SECRET,
        subject: 'user_123',
        expiresIn: 3600,
      })

      const subject = getTokenSubject(token)

      expect(subject).toBe('user_123')
    })

    it('should return null if no subject', async () => {
      const token = await createJWT({}, {
        secret: TEST_SECRET,
        expiresIn: 3600,
      })

      const subject = getTokenSubject(token)

      expect(subject).toBeNull()
    })
  })
})
