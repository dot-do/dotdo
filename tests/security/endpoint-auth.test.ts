/**
 * Security Tests - Endpoint Authentication [do-5pf]
 *
 * TDD RED Phase: Tests for missing authentication on sensitive endpoints.
 *
 * Security Issue:
 * - /capabilities endpoint in MCP server lacks auth middleware (mcp/server.ts line 174)
 * - DOCore /admin/* endpoints lack auth middleware
 * - DOCore /api/state-read endpoint exposes internal state without auth
 * - Internal API surface exposed without authentication
 *
 * Expected Behavior (after fix):
 * - Sensitive endpoints require valid JWT Bearer token
 * - Unauthenticated requests return 401 Unauthorized
 * - Invalid tokens return 401 Unauthorized
 * - Valid tokens grant access with appropriate permissions
 *
 * These tests should FAIL initially until the fix is implemented.
 *
 * Note: MCP tests are skipped when the MCP binding is not available in the test
 * environment. The core security issue is demonstrated by DOCore tests.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import * as jose from 'jose'

// ============================================================================
// Test Setup
// ============================================================================

const TEST_JWT_SECRET = 'test-jwt-secret-for-security-tests-minimum-32-chars'

/**
 * Create a valid JWT for testing
 */
async function createTestJwt(options: {
  sub?: string
  permissions?: string[]
  expiresIn?: string
} = {}): Promise<string> {
  const secretKey = new TextEncoder().encode(TEST_JWT_SECRET)

  const jwt = await new jose.SignJWT({
    sub: options.sub || 'test-user-123',
    permissions: options.permissions || ['capabilities:read'],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(options.expiresIn || '1h')
    .sign(secretKey)

  return jwt
}

/**
 * Create an expired JWT for testing
 */
async function createExpiredJwt(): Promise<string> {
  const secretKey = new TextEncoder().encode(TEST_JWT_SECRET)

  // Create a token that expired 1 hour ago
  const jwt = await new jose.SignJWT({
    sub: 'test-user-123',
    permissions: ['capabilities:read'],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200) // 2 hours ago
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // 1 hour ago
    .sign(secretKey)

  return jwt
}

/**
 * Create a JWT with invalid signature
 */
function createInvalidSignatureJwt(): string {
  // Valid JWT structure but tampered signature
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

/**
 * Check if MCP binding is available in test environment
 * Note: MCP server is not exported from core/index.ts, so MCP tests will be skipped
 */
const MCP_AVAILABLE = false // MCP is not in the test bindings

/**
 * Get a stub for the MCP server DO (if available)
 */
function getMcpStub() {
  if (!MCP_AVAILABLE) {
    throw new Error('MCP binding not available in test environment')
  }
  const id = (env as unknown as { MCP: DurableObjectNamespace }).MCP.idFromName('test-mcp')
  return (env as unknown as { MCP: DurableObjectNamespace }).MCP.get(id)
}

// ============================================================================
// MCP /capabilities Endpoint Authentication Tests
// SKIPPED: MCP server is not exported from core/index.ts in this workspace
// The security issue still exists in mcp/server.ts line 174
// ============================================================================

describe.skipIf(!MCP_AVAILABLE)('[SEC-4] MCP /capabilities Endpoint Authentication', () => {
  describe('Unauthenticated Requests', () => {
    it('should return 401 for request without Authorization header', async () => {
      const stub = getMcpStub()

      // Request without any auth header
      const response = await stub.fetch(
        new Request('https://mcp.test.dotdo.dev/capabilities', {
          method: 'GET',
        })
      )

      // EXPECTED: 401 Unauthorized
      // CURRENT (BUG): Returns 200 with capabilities (auth context undefined)
      expect(response.status).toBe(401)

      const body = await response.json() as { error?: string }
      expect(body.error).toBeDefined()
    })

    it('should return 401 for request with empty Authorization header', async () => {
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

    it('should return 401 for request with non-Bearer auth scheme', async () => {
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
    it('should return 401 for malformed JWT token', async () => {
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

    it('should return 401 for expired JWT token', async () => {
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

    it('should return 401 for JWT with invalid signature', async () => {
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

    it('should return 401 for JWT signed with wrong secret', async () => {
      const stub = getMcpStub()

      // Sign with a different secret than what the server uses
      const wrongSecretKey = new TextEncoder().encode('wrong-secret-key-for-testing')
      const jwt = await new jose.SignJWT({
        sub: 'test-user-123',
        permissions: ['capabilities:read'],
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(wrongSecretKey)

      const response = await stub.fetch(
        new Request('https://mcp.test.dotdo.dev/capabilities', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${jwt}`,
          },
        })
      )

      expect(response.status).toBe(401)
    })
  })

  describe('Valid Token Requests', () => {
    it('should return 200 with valid JWT token', async () => {
      const stub = getMcpStub()
      const validToken = await createTestJwt()

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

      // Token with limited permissions
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

      // Should only include tools the user has permission for
      // The exact filtering depends on implementation
      expect(body.tools).toBeDefined()
    })

    it('should accept token from query parameter for SSE clients', async () => {
      const stub = getMcpStub()
      const validToken = await createTestJwt()

      // SSE clients often can't set headers, so token is passed in query
      const response = await stub.fetch(
        new Request(`https://mcp.test.dotdo.dev/capabilities?token=${validToken}`, {
          method: 'GET',
        })
      )

      expect(response.status).toBe(200)
    })
  })
})

// ============================================================================
// MCP /meta Endpoint Authentication Tests (if endpoint exists or is added)
// SKIPPED: MCP server is not exported from core/index.ts in this workspace
// ============================================================================

describe.skipIf(!MCP_AVAILABLE)('[SEC-4] MCP /meta Endpoint Authentication', () => {
  describe('Unauthenticated Requests', () => {
    it('should return 401 for request without Authorization header', async () => {
      const stub = getMcpStub()

      const response = await stub.fetch(
        new Request('https://mcp.test.dotdo.dev/meta', {
          method: 'GET',
        })
      )

      // If /meta exists, it should require auth
      // If /meta doesn't exist, expect 404
      // After fix, should return 401 for unauthenticated request
      expect([401, 404]).toContain(response.status)

      if (response.status === 401) {
        const body = await response.json() as { error?: string }
        expect(body.error).toBeDefined()
      }
    })
  })

  describe('Valid Token Requests', () => {
    it('should return 200 or 404 with valid JWT token', async () => {
      const stub = getMcpStub()
      const validToken = await createTestJwt()

      const response = await stub.fetch(
        new Request('https://mcp.test.dotdo.dev/meta', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${validToken}`,
          },
        })
      )

      // If /meta exists, should return 200 with valid auth
      // If /meta doesn't exist, should return 404
      expect([200, 404]).toContain(response.status)
    })
  })
})

// ============================================================================
// MCP Cross-Endpoint Authentication Consistency Tests
// SKIPPED: MCP server is not exported from core/index.ts in this workspace
// ============================================================================

describe.skipIf(!MCP_AVAILABLE)('[SEC-4] MCP Authentication Consistency Across Sensitive Endpoints', () => {
  const sensitiveEndpoints = [
    '/capabilities',
    '/tools',
    '/sse',
  ]

  for (const endpoint of sensitiveEndpoints) {
    describe(`${endpoint} endpoint`, () => {
      it(`should require authentication for ${endpoint}`, async () => {
        const stub = getMcpStub()

        const response = await stub.fetch(
          new Request(`https://mcp.test.dotdo.dev${endpoint}`, {
            method: 'GET',
          })
        )

        // All sensitive endpoints should return 401 without auth
        expect(response.status).toBe(401)
      })
    })
  }

  it('should have consistent error response format across endpoints', async () => {
    const stub = getMcpStub()

    const responses = await Promise.all(
      sensitiveEndpoints.map(endpoint =>
        stub.fetch(
          new Request(`https://mcp.test.dotdo.dev${endpoint}`, {
            method: 'GET',
          })
        )
      )
    )

    // All should return 401
    for (const response of responses) {
      expect(response.status).toBe(401)
    }

    // All should have consistent error format
    const bodies = await Promise.all(
      responses.map(r => r.json() as Promise<{ error?: unknown; message?: string }>)
    )

    for (const body of bodies) {
      expect(body.error).toBeDefined()
      expect(body.message).toBeDefined()
    }
  })
})

// ============================================================================
// DOCore Sensitive Endpoint Tests
// ============================================================================

describe('[SEC-4] DOCore Admin Endpoint Authentication', () => {
  function getDOCoreStub(name = 'test-docore') {
    const id = env.DOCore.idFromName(name)
    return env.DOCore.get(id)
  }

  describe('/admin/users endpoint', () => {
    it('should return 401 without authentication', async () => {
      const stub = getDOCoreStub()

      const response = await stub.fetch(
        new Request('https://test.api.dotdo.dev/admin/users', {
          method: 'GET',
        })
      )

      // Currently this returns 200 (BUG)
      // After fix, should return 401
      expect(response.status).toBe(401)
    })

    it('should return 200 with valid admin token', async () => {
      const stub = getDOCoreStub()
      const adminToken = await createTestJwt({
        permissions: ['admin:users:read'],
      })

      const response = await stub.fetch(
        new Request('https://test.api.dotdo.dev/admin/users', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${adminToken}`,
          },
        })
      )

      expect(response.status).toBe(200)
    })
  })

  describe('/api/state-read endpoint', () => {
    it('should return 401 without authentication', async () => {
      const stub = getDOCoreStub()

      const response = await stub.fetch(
        new Request('https://test.api.dotdo.dev/api/state-read', {
          method: 'GET',
        })
      )

      // State access should require authentication
      expect(response.status).toBe(401)
    })
  })
})

// ============================================================================
// Security Headers Tests
// SKIPPED: MCP server is not exported from core/index.ts in this workspace
// ============================================================================

describe.skipIf(!MCP_AVAILABLE)('[SEC-4] MCP Security Headers on Auth Responses', () => {
  it('should not leak sensitive info in 401 response headers', async () => {
    const stub = getMcpStub()

    const response = await stub.fetch(
      new Request('https://mcp.test.dotdo.dev/capabilities', {
        method: 'GET',
      })
    )

    // After fix, should be 401
    if (response.status === 401) {
      // Should not expose internal details
      expect(response.headers.get('X-Powered-By')).toBeNull()
      expect(response.headers.get('Server')).toBeNull()

      // Should have security headers
      expect(response.headers.get('Content-Type')).toBe('application/json')
    }
  })

  it('should include WWW-Authenticate header on 401 responses', async () => {
    const stub = getMcpStub()

    const response = await stub.fetch(
      new Request('https://mcp.test.dotdo.dev/capabilities', {
        method: 'GET',
      })
    )

    // Standard practice to include WWW-Authenticate header
    if (response.status === 401) {
      const wwwAuth = response.headers.get('WWW-Authenticate')
      expect(wwwAuth).toBeDefined()
      expect(wwwAuth).toContain('Bearer')
    }
  })
})

// ============================================================================
// DOCore Security Headers Tests
// ============================================================================

describe('[SEC-4] DOCore Security Headers on Auth Responses', () => {
  function getDOCoreStub(name = 'test-docore-headers') {
    const id = env.DOCore.idFromName(name)
    return env.DOCore.get(id)
  }

  it('should not leak sensitive info in 401 response headers', async () => {
    const stub = getDOCoreStub()

    const response = await stub.fetch(
      new Request('https://test.api.dotdo.dev/admin/users', {
        method: 'GET',
      })
    )

    // After fix, should be 401
    // Currently returns 200 (BUG)
    expect(response.status).toBe(401)

    if (response.status === 401) {
      // Should not expose internal details
      expect(response.headers.get('X-Powered-By')).toBeNull()
      expect(response.headers.get('Server')).toBeNull()

      // Should have security headers
      expect(response.headers.get('Content-Type')).toBe('application/json')
    }
  })
})
