/**
 * RED Phase Tests: JWT Signature Verification Security
 *
 * SECURITY ISSUE: JWT signature verification is optional in auth-layer.ts
 *
 * The vulnerability (lines 244-319):
 * - Signature is only verified IF options.secret is provided
 * - Without a secret, ANY JWT payload is accepted as valid
 * - Attackers can forge tokens by base64-encoding arbitrary claims
 *
 * These tests document the vulnerability and MUST FAIL with the current
 * implementation. When the GREEN phase fix is applied, they will pass.
 *
 * Attack vectors demonstrated:
 * 1. Unsigned JWTs (alg: none) accepted when no secret configured
 * 2. Forged JWTs with invalid signatures accepted without verification
 * 3. Configuration allows bypassing signature checks in production
 * 4. Production vs development mode not enforced
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createAuthMiddleware,
  validateToken,
  AuthHandler,
  type AuthMiddlewareOptions,
} from '../../objects/transport/auth-layer'

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a base64url-encoded string (JWT-safe encoding)
 */
function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Create an unsigned JWT (algorithm: none attack)
 * This is a classic JWT attack where the attacker sets alg: none
 * to bypass signature verification
 */
function createUnsignedJWT(payload: Record<string, unknown>): string {
  const header = { alg: 'none', typ: 'JWT' }
  const b64Header = base64UrlEncode(JSON.stringify(header))
  const b64Payload = base64UrlEncode(JSON.stringify(payload))
  // Unsigned JWT has empty signature segment
  return `${b64Header}.${b64Payload}.`
}

/**
 * Create a JWT with a forged/invalid signature
 * Attacker creates arbitrary payload and adds random signature
 */
function createForgedJWT(payload: Record<string, unknown>): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const b64Header = base64UrlEncode(JSON.stringify(header))
  const b64Payload = base64UrlEncode(JSON.stringify(payload))
  // Forged signature - just random base64 that won't verify
  const forgedSignature = base64UrlEncode('this-is-not-a-valid-signature-12345')
  return `${b64Header}.${b64Payload}.${forgedSignature}`
}

/**
 * Create a properly signed JWT (for comparison)
 */
async function createSignedJWT(
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const b64Header = base64UrlEncode(JSON.stringify(header))
  const b64Payload = base64UrlEncode(JSON.stringify(payload))
  const signatureInput = `${b64Header}.${b64Payload}`

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(signatureInput)
  )

  const signature = base64UrlEncode(
    String.fromCharCode(...new Uint8Array(signatureBuffer))
  )

  return `${b64Header}.${b64Payload}.${signature}`
}

/**
 * Create a mock request with Authorization header
 */
function createMockRequest(token: string, path = '/rpc/test'): Request {
  return new Request(`http://localhost${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

// ============================================================================
// TEST DATA
// ============================================================================

const VALID_PAYLOAD = {
  sub: 'user-123',
  email: 'attacker@evil.com',
  name: 'Attacker',
  roles: ['admin', 'superuser'],
  permissions: ['read', 'write', 'delete', 'admin'],
  org: 'victim-org',
  iss: 'https://id.org.ai',
  aud: 'dotdo',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
}

const JWT_SECRET = 'super-secret-key-that-should-be-required'

// ============================================================================
// VULNERABILITY TESTS - THESE SHOULD FAIL WITH CURRENT IMPLEMENTATION
// ============================================================================

describe('JWT signature verification security vulnerabilities', () => {
  describe('CRITICAL: Unsigned JWTs (alg: none attack)', () => {
    it('VULNERABILITY: unsigned JWT is ACCEPTED when no secret configured', async () => {
      // Create middleware WITHOUT a secret (current default behavior)
      const middleware = createAuthMiddleware({
        // No jwtSecret provided - this is the vulnerability
        trustedIssuers: ['https://id.org.ai'],
        audience: 'dotdo',
      })

      // Create an unsigned JWT with admin claims
      const unsignedToken = createUnsignedJWT(VALID_PAYLOAD)
      const request = createMockRequest(unsignedToken)

      // Current behavior: This SUCCEEDS (vulnerability!)
      // Expected behavior: This should FAIL with 401
      const result = await middleware.authenticate(request)

      // This assertion documents the vulnerability
      // When fixed, the token should be REJECTED
      expect(result.success).toBe(false)
      expect(result.statusCode).toBe(401)
      // Error can mention signature OR alg:none - both indicate proper rejection
      expect(result.error).toMatch(/signature|alg.*none|unsigned/i)
    })

    it('VULNERABILITY: alg:none bypass grants admin access', async () => {
      const middleware = createAuthMiddleware({
        trustedIssuers: ['https://id.org.ai'],
        audience: 'dotdo',
      })

      const maliciousPayload = {
        ...VALID_PAYLOAD,
        roles: ['admin', 'root', 'superuser'],
        permissions: ['*'],
      }

      const unsignedToken = createUnsignedJWT(maliciousPayload)
      const request = createMockRequest(unsignedToken)

      const result = await middleware.authenticate(request)

      // Attacker should NOT be able to forge admin tokens
      expect(result.success).toBe(false)
      // When token is rejected, there should be no authenticated user context
      // (roles is undefined when there's no user)
      expect(result.context?.user).toBeUndefined()
    })
  })

  describe('CRITICAL: Forged JWTs with invalid signatures', () => {
    it('VULNERABILITY: forged JWT is ACCEPTED when no secret configured', async () => {
      const middleware = createAuthMiddleware({
        // No jwtSecret - vulnerability allows forged tokens
        trustedIssuers: ['https://id.org.ai'],
        audience: 'dotdo',
      })

      const forgedToken = createForgedJWT(VALID_PAYLOAD)
      const request = createMockRequest(forgedToken)

      const result = await middleware.authenticate(request)

      // Current behavior: This SUCCEEDS (vulnerability!)
      // Expected behavior: Forged tokens must be REJECTED
      expect(result.success).toBe(false)
      expect(result.statusCode).toBe(401)
    })

    it('VULNERABILITY: attacker can impersonate any user', async () => {
      const middleware = createAuthMiddleware({
        trustedIssuers: ['https://id.org.ai'],
        audience: 'dotdo',
      })

      const impersonationPayload = {
        sub: 'ceo@victim-company.com',
        email: 'ceo@victim-company.com',
        name: 'CEO Target',
        roles: ['admin', 'billing', 'owner'],
        permissions: ['*'],
        org: 'victim-company',
        iss: 'https://id.org.ai',
        aud: 'dotdo',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }

      const forgedToken = createForgedJWT(impersonationPayload)
      const request = createMockRequest(forgedToken)

      const result = await middleware.authenticate(request)

      // Impersonation attacks must be blocked
      expect(result.success).toBe(false)
    })

    it('VULNERABILITY: token signed with wrong key is accepted without verification', async () => {
      // Create a token signed with attacker's key
      const attackerSecret = 'attacker-controlled-secret'
      const signedWithWrongKey = await createSignedJWT(VALID_PAYLOAD, attackerSecret)

      // Middleware with a different secret (or no secret)
      const middleware = createAuthMiddleware({
        jwtSecret: 'the-real-server-secret',
        trustedIssuers: ['https://id.org.ai'],
        audience: 'dotdo',
      })

      const request = createMockRequest(signedWithWrongKey)
      const result = await middleware.authenticate(request)

      // Token signed with wrong key must be rejected
      expect(result.success).toBe(false)
      expect(result.statusCode).toBe(401)
      expect(result.error).toMatch(/invalid signature/i)
    })
  })

  describe('CRITICAL: Configuration bypass vulnerabilities', () => {
    it('VULNERABILITY: signature verification can be bypassed by not providing secret', async () => {
      // This is the core vulnerability - omitting jwtSecret bypasses all signature checks

      // Configuration 1: With secret - signatures verified
      const secureMiddleware = createAuthMiddleware({
        jwtSecret: JWT_SECRET,
        trustedIssuers: ['https://id.org.ai'],
      })

      // Configuration 2: Without secret - signatures NOT verified (vulnerability!)
      const insecureMiddleware = createAuthMiddleware({
        // No jwtSecret - this should NOT be allowed in production
        trustedIssuers: ['https://id.org.ai'],
      })

      const forgedToken = createForgedJWT(VALID_PAYLOAD)
      const request = createMockRequest(forgedToken)

      // Secure middleware correctly rejects
      const secureResult = await secureMiddleware.authenticate(request)
      expect(secureResult.success).toBe(false)

      // Insecure middleware incorrectly accepts (vulnerability!)
      // This test FAILS with current implementation, which is correct for RED phase
      const insecureResult = await insecureMiddleware.authenticate(request)
      expect(insecureResult.success).toBe(false) // Should also reject
    })

    it('VULNERABILITY: empty string secret bypasses verification', async () => {
      const middleware = createAuthMiddleware({
        jwtSecret: '', // Empty string might be treated as "no secret"
        trustedIssuers: ['https://id.org.ai'],
      })

      const forgedToken = createForgedJWT(VALID_PAYLOAD)
      const request = createMockRequest(forgedToken)

      const result = await middleware.authenticate(request)

      // Empty secret should be treated as misconfiguration, not valid
      expect(result.success).toBe(false)
    })

    it('VULNERABILITY: undefined secret bypasses verification', async () => {
      const middleware = createAuthMiddleware({
        jwtSecret: undefined,
        trustedIssuers: ['https://id.org.ai'],
      })

      const forgedToken = createForgedJWT(VALID_PAYLOAD)
      const request = createMockRequest(forgedToken)

      const result = await middleware.authenticate(request)

      expect(result.success).toBe(false)
    })
  })

  describe('CRITICAL: Production vs Development mode', () => {
    // Store original NODE_ENV
    let originalNodeEnv: string | undefined

    beforeEach(() => {
      originalNodeEnv = process.env.NODE_ENV
    })

    afterEach(() => {
      if (originalNodeEnv !== undefined) {
        process.env.NODE_ENV = originalNodeEnv
      } else {
        delete process.env.NODE_ENV
      }
    })

    it('VULNERABILITY: no production mode enforcement for signature verification', async () => {
      // Set production mode
      process.env.NODE_ENV = 'production'

      // FIXED: In production, middleware creation without jwtSecret throws
      // This is the secure behavior - prevent insecure configuration entirely
      expect(() => {
        createAuthMiddleware({
          // No jwtSecret in production - this now throws!
          trustedIssuers: ['https://id.org.ai'],
        })
      }).toThrow(/production/i)

      // With proper secret, forged tokens are rejected
      const middleware = createAuthMiddleware({
        jwtSecret: JWT_SECRET,
        trustedIssuers: ['https://id.org.ai'],
      })

      const forgedToken = createForgedJWT(VALID_PAYLOAD)
      const request = createMockRequest(forgedToken)

      const result = await middleware.authenticate(request)

      // In production with proper secret, forged tokens MUST be rejected
      expect(result.success).toBe(false)
      expect(result.statusCode).toBe(401)
    })

    it('should throw error when creating middleware without secret in production', () => {
      process.env.NODE_ENV = 'production'

      // Creating middleware without jwtSecret in production should throw
      expect(() => {
        createAuthMiddleware({
          trustedIssuers: ['https://id.org.ai'],
          // No jwtSecret - should throw in production
        })
      }).toThrow(/production/i)
    })

    it('development mode may allow optional signature verification with warning', async () => {
      process.env.NODE_ENV = 'development'

      // In development, might allow unsigned tokens for testing convenience
      // but should still log a warning
      const middleware = createAuthMiddleware({
        trustedIssuers: ['https://id.org.ai'],
      })

      // Even in dev mode, this should be documented/warned behavior
      expect(middleware).toBeDefined()
    })
  })

  describe('CRITICAL: validateToken function vulnerabilities', () => {
    it('VULNERABILITY: validateToken accepts forged JWT without secret', async () => {
      const forgedToken = createForgedJWT(VALID_PAYLOAD)

      // validateToken without secret option
      const result = await validateToken(forgedToken, 'jwt', {
        trustedIssuers: ['https://id.org.ai'],
        audience: 'dotdo',
        // No secret provided - vulnerability
      })

      // Should return null (rejected) but currently returns valid context
      expect(result).toBeNull()
    })

    it('VULNERABILITY: validateToken accepts unsigned JWT', async () => {
      const unsignedToken = createUnsignedJWT(VALID_PAYLOAD)

      const result = await validateToken(unsignedToken, 'jwt', {
        trustedIssuers: ['https://id.org.ai'],
        audience: 'dotdo',
      })

      // Unsigned tokens must be rejected
      expect(result).toBeNull()
    })
  })

  describe('CRITICAL: AuthHandler class vulnerabilities', () => {
    it('VULNERABILITY: AuthHandler accepts forged tokens without secret', async () => {
      const handler = new AuthHandler({
        trustedIssuers: ['https://id.org.ai'],
        audience: 'dotdo',
        // No jwtSecret
        protectedRoutes: ['/api/data'],
      })

      const forgedToken = createForgedJWT(VALID_PAYLOAD)
      const request = createMockRequest(forgedToken, '/api/data/sensitive')

      // Create minimal context
      const context = {
        namespace: 'test',
        doStub: null as any,
        storage: null as any,
      }

      // Should reject forged token
      const response = await handler.handle(request, context)
      expect(response.status).toBe(401)
    })
  })
})

// ============================================================================
// CORRECT BEHAVIOR TESTS - THESE SHOULD PASS
// ============================================================================

describe('JWT signature verification correct behavior', () => {
  describe('properly signed tokens should work', () => {
    it('accepts valid token signed with correct secret', async () => {
      const middleware = createAuthMiddleware({
        jwtSecret: JWT_SECRET,
        trustedIssuers: ['https://id.org.ai'],
        audience: 'dotdo',
      })

      const validToken = await createSignedJWT(VALID_PAYLOAD, JWT_SECRET)
      const request = createMockRequest(validToken)

      const result = await middleware.authenticate(request)

      expect(result.success).toBe(true)
      expect(result.context?.authenticated).toBe(true)
      expect(result.context?.user?.id).toBe('user-123')
    })

    it('rejects expired token even with valid signature', async () => {
      const middleware = createAuthMiddleware({
        jwtSecret: JWT_SECRET,
        trustedIssuers: ['https://id.org.ai'],
        audience: 'dotdo',
      })

      const expiredPayload = {
        ...VALID_PAYLOAD,
        exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      }

      const expiredToken = await createSignedJWT(expiredPayload, JWT_SECRET)
      const request = createMockRequest(expiredToken)

      const result = await middleware.authenticate(request)

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/expired/i)
    })

    it('rejects token with wrong issuer', async () => {
      const middleware = createAuthMiddleware({
        jwtSecret: JWT_SECRET,
        trustedIssuers: ['https://id.org.ai'],
        audience: 'dotdo',
      })

      const wrongIssuerPayload = {
        ...VALID_PAYLOAD,
        iss: 'https://evil-issuer.com',
      }

      const token = await createSignedJWT(wrongIssuerPayload, JWT_SECRET)
      const request = createMockRequest(token)

      const result = await middleware.authenticate(request)

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/issuer/i)
    })

    it('rejects token with wrong audience', async () => {
      const middleware = createAuthMiddleware({
        jwtSecret: JWT_SECRET,
        trustedIssuers: ['https://id.org.ai'],
        audience: 'dotdo',
      })

      const wrongAudiencePayload = {
        ...VALID_PAYLOAD,
        aud: 'wrong-audience',
      }

      const token = await createSignedJWT(wrongAudiencePayload, JWT_SECRET)
      const request = createMockRequest(token)

      const result = await middleware.authenticate(request)

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/audience/i)
    })
  })
})
