import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'

/**
 * CORS Security Validation Tests - TDD RED Phase
 *
 * These tests verify secure CORS behavior in DOCore. They are designed to FAIL
 * against the current implementation which uses `origin: '*'` wildcard configuration.
 *
 * Security issues being tested:
 * 1. Wildcard origin with credentials - allows any origin to access authenticated endpoints
 * 2. Missing explicit allowed origins list - no origin validation
 * 3. Preflight requests with credentials - should require strict origin matching
 * 4. Credentials exposure to arbitrary origins - security vulnerability
 *
 * RFC 6454 and CORS spec require:
 * - When Access-Control-Allow-Credentials is true, Access-Control-Allow-Origin MUST NOT be '*'
 * - Origins should be explicitly validated against an allowlist
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
 * @see https://fetch.spec.whatwg.org/#http-cors-protocol
 */

// Helper to get a fresh DOCore instance
function getCore(name = 'cors-test') {
  const id = env.DOCore.idFromName(name)
  return env.DOCore.get(id)
}

describe('CORS Security Validation', () => {
  describe('Origin validation', () => {
    it('should NOT allow wildcard origin when credentials are included', async () => {
      const core = getCore('cors-wildcard-1')

      // Request with credentials (Authorization header)
      const response = await core.fetch('https://test.local/api/status', {
        method: 'GET',
        headers: {
          Origin: 'https://malicious-site.com',
          Authorization: 'Bearer some-token',
        },
      })

      const allowOrigin = response.headers.get('Access-Control-Allow-Origin')
      const allowCredentials = response.headers.get('Access-Control-Allow-Credentials')

      // SECURITY: When credentials are sent, wildcard origin is a security risk
      // The server should either:
      // 1. Reject the request from unknown origins
      // 2. Or echo back only the specific allowed origin (not '*')

      // This test FAILS because current config uses origin: '*'
      expect(allowOrigin).not.toBe('*')

      // If credentials are allowed, origin must be specific
      if (allowCredentials === 'true') {
        expect(allowOrigin).not.toBe('*')
        expect(allowOrigin).toMatch(/^https?:\/\//)
      }
    })

    it('should reject requests from non-allowed origins', async () => {
      const core = getCore('cors-reject-1')

      const response = await core.fetch('https://test.local/protected/data', {
        method: 'GET',
        headers: {
          Origin: 'https://evil-attacker-site.com',
          Authorization: 'Bearer valid-token',
        },
      })

      const allowOrigin = response.headers.get('Access-Control-Allow-Origin')

      // SECURITY: A secure CORS config should NOT allow arbitrary origins
      // This test FAILS because current config allows '*' (any origin)
      // Expected: allowOrigin should be null/undefined OR match the configured allowlist
      expect(allowOrigin).not.toBe('*')

      // If there's an origin header, it should be a specific trusted origin
      if (allowOrigin) {
        // Should be from an explicit allowlist, not echo back any origin
        expect(['https://dotdo.dev', 'https://api.dotdo.dev', 'http://localhost:3000']).toContain(allowOrigin)
      }
    })

    it('should validate origin against explicit allowlist', async () => {
      const core = getCore('cors-allowlist-1')

      // Test with a legitimate origin
      const legitResponse = await core.fetch('https://test.local/api/status', {
        method: 'GET',
        headers: {
          Origin: 'https://dotdo.dev',
        },
      })

      // Test with an unknown origin
      const unknownResponse = await core.fetch('https://test.local/api/status', {
        method: 'GET',
        headers: {
          Origin: 'https://random-unknown-site.xyz',
        },
      })

      const legitAllowOrigin = legitResponse.headers.get('Access-Control-Allow-Origin')
      const unknownAllowOrigin = unknownResponse.headers.get('Access-Control-Allow-Origin')

      // SECURITY: Should allow legitimate origin
      // This may pass if the origin is echoed back (which is also insecure)
      expect(legitAllowOrigin).toBeDefined()

      // SECURITY: Should NOT allow unknown origin (critical test)
      // This test FAILS because current config uses '*'
      expect(unknownAllowOrigin).not.toBe('*')

      // Unknown origins should either get no CORS header or be rejected
      // Current implementation allows any origin, which is insecure
      expect(unknownAllowOrigin === null || unknownAllowOrigin === 'https://dotdo.dev').toBe(true)
    })
  })

  describe('Preflight request handling', () => {
    it('should handle preflight with strict origin validation', async () => {
      const core = getCore('cors-preflight-1')

      // OPTIONS preflight from untrusted origin
      const response = await core.fetch('https://test.local/api/items', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://phishing-site.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
      })

      const allowOrigin = response.headers.get('Access-Control-Allow-Origin')
      const allowMethods = response.headers.get('Access-Control-Allow-Methods')

      // SECURITY: Preflight should NOT grant access to untrusted origins
      // This test FAILS because current config uses '*'
      expect(allowOrigin).not.toBe('*')

      // If origin is not allowed, methods should not be granted either
      if (allowOrigin === null || allowOrigin === undefined) {
        // No CORS headers for untrusted origins - secure behavior
        expect(true).toBe(true)
      } else {
        // If headers are present, origin must be from allowlist
        expect(allowOrigin).not.toBe('*')
      }
    })

    it('should NOT include credentials header with wildcard origin', async () => {
      const core = getCore('cors-preflight-2')

      const response = await core.fetch('https://test.local/api/status', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://any-site.com',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'Authorization',
        },
      })

      const allowOrigin = response.headers.get('Access-Control-Allow-Origin')
      const allowCredentials = response.headers.get('Access-Control-Allow-Credentials')

      // SECURITY: Per CORS spec, if Allow-Credentials is 'true', Allow-Origin MUST NOT be '*'
      // This is a critical security requirement
      if (allowCredentials === 'true') {
        // This test FAILS if credentials are allowed with wildcard
        expect(allowOrigin).not.toBe('*')
        // Origin must be the specific requesting origin or from allowlist
        expect(allowOrigin).toMatch(/^https?:\/\/[a-zA-Z0-9.-]+/)
      }

      // Even without credentials, wildcard is risky with auth headers
      if (allowOrigin === '*') {
        // If wildcard is used, credentials MUST be false/absent
        expect(allowCredentials).not.toBe('true')
      }
    })

    it('should properly validate Access-Control-Request-Headers in preflight', async () => {
      const core = getCore('cors-preflight-3')

      // Preflight requesting sensitive headers
      const response = await core.fetch('https://test.local/api/items', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://untrusted-origin.net',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Authorization, X-Custom-Header',
        },
      })

      const allowHeaders = response.headers.get('Access-Control-Allow-Headers')
      const allowOrigin = response.headers.get('Access-Control-Allow-Origin')

      // SECURITY: Should not expose Authorization header handling to untrusted origins
      // Current implementation allows this which is a security issue
      if (allowOrigin === '*') {
        // If wildcard origin is allowed (insecure), at minimum shouldn't expose auth headers
        // This test documents the current insecure behavior
        // It FAILS to demonstrate the vulnerability

        // Note: This is the actual security issue - allowing Authorization from any origin
        // The test expects this NOT to happen
        expect(allowHeaders?.includes('Authorization')).toBe(false)
      }
    })
  })

  describe('Credentials protection', () => {
    it('should require strict origin matching when credentials are involved', async () => {
      const core = getCore('cors-credentials-1')

      // Request with credentials to a protected endpoint
      const response = await core.fetch('https://test.local/protected/data', {
        method: 'GET',
        headers: {
          Origin: 'https://suspicious-origin.io',
          Authorization: 'Bearer user-session-token',
          Cookie: 'session=abc123',
        },
      })

      const allowOrigin = response.headers.get('Access-Control-Allow-Origin')

      // SECURITY: When credentials (Authorization, Cookie) are sent:
      // - Origin '*' is a critical vulnerability
      // - Must validate against explicit allowlist
      // This test FAILS because current config uses '*'
      expect(allowOrigin).not.toBe('*')
    })

    it('should not expose sensitive endpoints to cross-origin requests without validation', async () => {
      const core = getCore('cors-credentials-2')

      // Try to access admin endpoint from cross-origin
      const response = await core.fetch('https://test.local/admin/users', {
        method: 'GET',
        headers: {
          Origin: 'https://attacker-controlled.com',
          Authorization: 'Bearer admin-token',
        },
      })

      const allowOrigin = response.headers.get('Access-Control-Allow-Origin')

      // SECURITY: Admin endpoints should have stricter CORS or no CORS at all
      // This test FAILS because wildcard allows any origin
      expect(allowOrigin).not.toBe('*')

      // For admin endpoints, ideally no CORS headers for untrusted origins
      // or explicit allowlist of internal domains only
    })

    it('should handle Vary header correctly for caching security', async () => {
      const core = getCore('cors-vary-1')

      const response = await core.fetch('https://test.local/api/status', {
        method: 'GET',
        headers: {
          Origin: 'https://some-origin.com',
        },
      })

      const vary = response.headers.get('Vary')

      // SECURITY: When CORS headers vary by Origin, Vary header must include Origin
      // This prevents cache poisoning attacks
      // If Access-Control-Allow-Origin varies (not static '*'), Vary: Origin is required
      const allowOrigin = response.headers.get('Access-Control-Allow-Origin')

      if (allowOrigin && allowOrigin !== '*') {
        // If origin-specific CORS, must have Vary: Origin for cache safety
        expect(vary).toContain('Origin')
      }

      // With wildcard, this test passes but documents the security concern
      // Wildcard means any cached response can be reused for any origin
    })
  })

  describe('Method and header restrictions', () => {
    it('should restrict allowed methods to necessary ones only', async () => {
      const core = getCore('cors-methods-1')

      const response = await core.fetch('https://test.local/api/status', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://any-site.com',
          'Access-Control-Request-Method': 'DELETE',
        },
      })

      const allowMethods = response.headers.get('Access-Control-Allow-Methods')

      // SECURITY: For public/untrusted origins, dangerous methods should be restricted
      // Current config allows DELETE which combined with '*' origin is risky
      // This test documents the current permissive behavior

      // When origin is not validated, dangerous methods increase attack surface
      const allowOrigin = response.headers.get('Access-Control-Allow-Origin')
      if (allowOrigin === '*') {
        // With wildcard, should at least restrict to safe methods (GET, HEAD, OPTIONS)
        // This test FAILS because DELETE is allowed with wildcard origin
        expect(allowMethods).not.toContain('DELETE')
      }
    })

    it('should not allow Authorization header from untrusted origins', async () => {
      const core = getCore('cors-headers-1')

      const response = await core.fetch('https://test.local/api/status', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://malicious.example',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Authorization',
        },
      })

      const allowHeaders = response.headers.get('Access-Control-Allow-Headers')
      const allowOrigin = response.headers.get('Access-Control-Allow-Origin')

      // SECURITY: Authorization header with wildcard origin = credential exposure
      // This test FAILS because current config allows Authorization from any origin
      if (allowOrigin === '*') {
        // Should NOT allow Authorization header with wildcard origin
        expect(allowHeaders?.toLowerCase().includes('authorization')).toBe(false)
      }
    })
  })

  describe('Security-critical endpoints', () => {
    it('should have stricter CORS for protected routes', async () => {
      const core = getCore('cors-protected-1')

      // Request to protected endpoint
      const response = await core.fetch('https://test.local/protected/data', {
        method: 'GET',
        headers: {
          Origin: 'https://unknown-origin.xyz',
          Authorization: 'Bearer test-token',
        },
      })

      const allowOrigin = response.headers.get('Access-Control-Allow-Origin')

      // SECURITY: Protected routes should have explicit origin allowlist
      // This test FAILS because current global CORS config uses '*'
      expect(allowOrigin).not.toBe('*')
    })

    it('should not expose error details cross-origin', async () => {
      const core = getCore('cors-errors-1')

      // Trigger an error from cross-origin
      const response = await core.fetch('https://test.local/api/error-trigger', {
        method: 'GET',
        headers: {
          Origin: 'https://attacker.com',
        },
      })

      // Error responses should still have appropriate CORS restrictions
      const allowOrigin = response.headers.get('Access-Control-Allow-Origin')

      // SECURITY: Even error responses shouldn't use wildcard CORS
      // This prevents information leakage to attackers
      // Test FAILS because error responses also get '*' CORS
      expect(allowOrigin).not.toBe('*')
    })
  })
})
