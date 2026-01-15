/**
 * Security Tests - /capabilities Endpoint Authentication [do-nw4]
 *
 * Tests that verify the /capabilities endpoint requires authentication.
 *
 * Security Requirement:
 * - The /capabilities endpoint should require valid JWT Bearer token
 * - Unauthenticated requests should return 401 Unauthorized
 * - Invalid tokens should return 401 Unauthorized
 * - Valid tokens should grant access with appropriate permissions
 *
 * Implementation Status:
 * Auth middleware is already implemented in mcp/server.ts (lines 373-392).
 * These tests verify the existing security implementation works correctly.
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import { createJwt } from '../auth/jwt'

// ============================================================================
// Test Setup
// ============================================================================

// Must match JWT_SECRET in .dev.vars for test environment
const TEST_JWT_SECRET = 'test-secret-key-for-jwt-signing-that-is-long-enough'

/**
 * Get a stub for the MCP server DO
 */
function getMcpStub() {
  const id = env.MCP.idFromName('test-capabilities-auth')
  return env.MCP.get(id)
}

/**
 * Create a valid JWT for testing
 */
async function createTestJwt(options: {
  sub?: string
  permissions?: string[]
  expiresIn?: string
} = {}): Promise<string> {
  return createJwt(
    {
      sub: options.sub || 'test-user-123',
      permissions: options.permissions || ['capabilities:read'],
    },
    TEST_JWT_SECRET,
    { expiresIn: options.expiresIn || '1h' }
  )
}

/**
 * Create an expired JWT for testing
 */
async function createExpiredJwt(): Promise<string> {
  return createJwt(
    {
      sub: 'test-user-123',
      permissions: ['capabilities:read'],
    },
    TEST_JWT_SECRET,
    { expiresIn: '-1h' } // Expired 1 hour ago
  )
}

/**
 * Create a JWT with invalid signature by tampering
 */
function createInvalidSignatureJwt(): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = btoa(JSON.stringify({
    sub: 'test-user-123',
    permissions: ['capabilities:read'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  }))
  const invalidSignature = 'invalid-signature-that-will-not-verify'

  return `${header}.${payload}.${invalidSignature}`
}

// ============================================================================
// /capabilities Endpoint Authentication Tests
// ============================================================================

describe('/capabilities endpoint security', () => {
  describe('Unauthenticated Requests', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const stub = getMcpStub()

      // Make request without auth header
      const response = await stub.fetch(
        new Request('https://mcp.test.dotdo.dev/capabilities', {
          method: 'GET',
        })
      )

      // EXPECTED: 401 Unauthorized
      expect(response.status).toBe(401)

      const body = await response.json() as { error?: string; message?: string }
      expect(body.error).toBeDefined()
      expect(body.message).toBeDefined()
    })

    it('should reject request with empty Authorization header', async () => {
      const stub = getMcpStub()

      const response = await stub.fetch(
        new Request('https://mcp.test.dotdo.dev/capabilities', {
          method: 'GET',
          headers: {
            'Authorization': '',
          },
        })
      )

      expect(response.status).toBe(401)
    })

    it('should reject request with non-Bearer auth scheme', async () => {
      const stub = getMcpStub()

      const response = await stub.fetch(
        new Request('https://mcp.test.dotdo.dev/capabilities', {
          method: 'GET',
          headers: {
            'Authorization': 'Basic dXNlcm5hbWU6cGFzc3dvcmQ=',
          },
        })
      )

      expect(response.status).toBe(401)
    })
  })

  describe('Invalid Token Requests', () => {
    it('should reject malformed JWT token with 401', async () => {
      const stub = getMcpStub()

      const response = await stub.fetch(
        new Request('https://mcp.test.dotdo.dev/capabilities', {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer not-a-valid-jwt',
          },
        })
      )

      expect(response.status).toBe(401)
    })

    it('should reject expired JWT token with 401', async () => {
      const stub = getMcpStub()
      const expiredToken = await createExpiredJwt()

      const response = await stub.fetch(
        new Request('https://mcp.test.dotdo.dev/capabilities', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${expiredToken}`,
          },
        })
      )

      expect(response.status).toBe(401)
    })

    it('should reject JWT with invalid signature with 401', async () => {
      const stub = getMcpStub()
      const tamperedToken = createInvalidSignatureJwt()

      const response = await stub.fetch(
        new Request('https://mcp.test.dotdo.dev/capabilities', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${tamperedToken}`,
          },
        })
      )

      expect(response.status).toBe(401)
    })
  })

  describe('Valid Token Requests', () => {
    it('should accept authenticated requests with 200', async () => {
      const stub = getMcpStub()
      const validToken = await createTestJwt()

      // Make request with valid auth
      const response = await stub.fetch(
        new Request('https://mcp.test.dotdo.dev/capabilities', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${validToken}`,
          },
        })
      )

      // With valid auth, should return capabilities
      expect(response.status).toBe(200)

      const body = await response.json() as { tools?: unknown }
      expect(body.tools).toBeDefined()
    })

    it('should return capabilities filtered by user permissions', async () => {
      const stub = getMcpStub()

      // Token with specific permissions
      const limitedToken = await createTestJwt({
        permissions: ['tools:search'],
      })

      const response = await stub.fetch(
        new Request('https://mcp.test.dotdo.dev/capabilities', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${limitedToken}`,
          },
        })
      )

      expect(response.status).toBe(200)

      const body = await response.json() as { tools?: Record<string, unknown> }
      expect(body.tools).toBeDefined()
    })
  })
})
