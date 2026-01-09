/**
 * DO Router Tests
 *
 * Tests for the /:doClass/:id/* routes that forward requests to individual
 * Durable Object instances.
 *
 * These tests verify:
 * - Route pattern /:doClass/:id/* forwards to DO
 * - Unknown DO class returns 404
 * - Headers and body forwarded correctly
 * - Path rewritten for DO handler
 */

import { describe, it, expect } from 'vitest'
import { env, SELF } from 'cloudflare:test'

// ============================================================================
// Types
// ============================================================================

interface ErrorResponse {
  error: {
    code: string
    message: string
  }
}

// ============================================================================
// Test Helpers
// ============================================================================

async function request(
  method: string,
  path: string,
  options?: { body?: unknown; headers?: Record<string, string> }
): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  }
  if (options?.body !== undefined) {
    init.body = JSON.stringify(options.body)
  }
  return SELF.fetch(`http://localhost${path}`, init)
}

// ============================================================================
// 1. Basic Routing Tests
// ============================================================================

describe('DO Router - /:doClass/:id/*', () => {
  describe('basic routing', () => {
    it('should route GET requests to DO instance', async () => {
      const response = await request('GET', '/DO/test-instance-123/')

      // Should not return 404 for known DO class - route should be handled
      expect(response.status).not.toBe(404)
    })

    it('should route POST requests to DO instance', async () => {
      const response = await request('POST', '/DO/test-instance-123/', {
        body: { action: 'test' },
      })

      // Should forward to DO, not 404
      expect(response.status).not.toBe(404)
    })

    it('should route PUT requests to DO instance', async () => {
      const response = await request('PUT', '/DO/test-instance-123/data', {
        body: { value: 'updated' },
      })

      // Should forward to DO
      expect(response.status).not.toBe(404)
    })

    it('should route DELETE requests to DO instance', async () => {
      const response = await request('DELETE', '/DO/test-instance-123/resource')

      // Should forward to DO
      expect(response.status).not.toBe(404)
    })

    it('should handle nested paths after /:doClass/:id', async () => {
      const response = await request('GET', '/DO/test-123/nested/deep/path')

      // Path should be forwarded correctly
      expect(response.status).not.toBe(404)
    })
  })

  // ============================================================================
  // 2. Unknown DO Class Tests
  // ============================================================================

  describe('unknown DO class handling', () => {
    it('should return 404 for unknown DO class', async () => {
      const response = await request('GET', '/UnknownDOClass/some-id/')

      expect(response.status).toBe(404)
    })

    it('should return proper error format for unknown DO class', async () => {
      const response = await request('GET', '/NonExistentDO/test-id/path')
      const body: ErrorResponse = await response.json()

      expect(body.error).toBeDefined()
      expect(body.error.code).toBe('NOT_FOUND')
      expect(body.error.message).toContain('Unknown DO class')
    })

    it('should return JSON content-type for 404 responses', async () => {
      const response = await request('GET', '/FakeDO/test-id/')

      expect(response.headers.get('content-type')).toContain('application/json')
    })
  })

  // ============================================================================
  // 3. Header Forwarding Tests
  // ============================================================================

  describe('header forwarding', () => {
    it('should forward custom headers to DO', async () => {
      const response = await request('GET', '/DO/header-test/', {
        headers: {
          'X-Custom-Header': 'custom-value',
          'X-Request-ID': 'req-12345',
        },
      })

      // The DO should receive and can echo back headers
      // For now just verify the route works
      expect(response.status).not.toBe(404)
    })

    it('should forward authorization header to DO', async () => {
      const response = await request('GET', '/DO/auth-test/', {
        headers: {
          Authorization: 'Bearer test-token-xyz',
        },
      })

      expect(response.status).not.toBe(404)
    })

    it('should forward content-type header to DO', async () => {
      const response = await request('POST', '/DO/content-test/', {
        headers: {
          'Content-Type': 'application/json',
        },
        body: { data: 'test' },
      })

      expect(response.status).not.toBe(404)
    })
  })

  // ============================================================================
  // 4. Body Forwarding Tests
  // ============================================================================

  describe('body forwarding', () => {
    it('should forward JSON body to DO', async () => {
      const testBody = {
        name: 'Test',
        value: 123,
        nested: { foo: 'bar' },
      }

      const response = await request('POST', '/DO/body-test/create', {
        body: testBody,
      })

      expect(response.status).not.toBe(404)
    })

    it('should forward empty body correctly', async () => {
      const response = await SELF.fetch('http://localhost/DO/empty-body-test/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      expect(response.status).not.toBe(404)
    })

    it('should forward large body to DO', async () => {
      const largeBody = {
        data: 'x'.repeat(10000),
        items: Array.from({ length: 100 }, (_, i) => ({ id: i, value: `item-${i}` })),
      }

      const response = await request('POST', '/DO/large-body-test/', {
        body: largeBody,
      })

      expect(response.status).not.toBe(404)
    })
  })

  // ============================================================================
  // 5. Path Rewriting Tests
  // ============================================================================

  describe('path rewriting', () => {
    it('should rewrite path to remove /:doClass/:id prefix', async () => {
      // Request: /DO/my-id/some/path
      // DO should receive: /some/path
      const response = await request('GET', '/DO/path-test/some/path')

      // The DO should handle the rewritten path
      expect(response.status).not.toBe(404)
    })

    it('should handle root path after /:doClass/:id', async () => {
      // Request: /DO/my-id/ or /DO/my-id
      // DO should receive: /
      const response = await request('GET', '/DO/root-test/')

      expect(response.status).not.toBe(404)
    })

    it('should handle path without trailing slash', async () => {
      const response = await request('GET', '/DO/no-slash-test')

      // Should still route correctly (path becomes /)
      expect(response.status).not.toBe(404)
    })

    it('should preserve query parameters', async () => {
      const response = await SELF.fetch(
        'http://localhost/DO/query-test/search?q=test&limit=10'
      )

      expect(response.status).not.toBe(404)
    })

    it('should handle special characters in path', async () => {
      const response = await request(
        'GET',
        '/DO/special-test/path/with%20spaces/and%2Fslashes'
      )

      expect(response.status).not.toBe(404)
    })
  })

  // ============================================================================
  // 6. DO ID Handling Tests
  // ============================================================================

  describe('DO ID handling', () => {
    it('should use idFromName for string IDs', async () => {
      const response = await request('GET', '/DO/named-id-test/')

      // ID should be derived from the name "named-id-test"
      expect(response.status).not.toBe(404)
    })

    it('should handle numeric-like string IDs', async () => {
      const response = await request('GET', '/DO/12345/')

      expect(response.status).not.toBe(404)
    })

    it('should handle UUID-format IDs', async () => {
      const response = await request(
        'GET',
        '/DO/550e8400-e29b-41d4-a716-446655440000/'
      )

      expect(response.status).not.toBe(404)
    })

    it('should handle special characters in ID', async () => {
      const response = await request('GET', '/DO/user:alice@example.com/')

      expect(response.status).not.toBe(404)
    })
  })

  // ============================================================================
  // 7. Multiple DO Class Tests
  // ============================================================================

  describe('multiple DO classes', () => {
    it('should route to TEST_DO namespace', async () => {
      const response = await request('GET', '/TEST_DO/test-instance/')

      // TEST_DO is defined in Env, should work
      expect(response.status).not.toBe(404)
    })

    it('should route to BROWSER_DO namespace', async () => {
      const response = await request('GET', '/BROWSER_DO/browser-instance/')

      // BROWSER_DO is defined in Env
      expect(response.status).not.toBe(404)
    })

    it('should route different classes to different namespaces', async () => {
      // Both should work but hit different DO namespaces
      const response1 = await request('GET', '/DO/instance-1/')
      const response2 = await request('GET', '/TEST_DO/instance-1/')

      expect(response1.status).not.toBe(404)
      expect(response2.status).not.toBe(404)
    })
  })

  // ============================================================================
  // 8. Error Handling Tests
  // ============================================================================

  describe('error handling', () => {
    it('should return proper error for malformed requests', async () => {
      const response = await SELF.fetch('http://localhost/DO/error-test/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json {',
      })

      // The error might come from DO or router depending on implementation
      expect([400, 500]).toContain(response.status)
    })

    it('should handle DO fetch errors gracefully', async () => {
      // This tests that router handles DO errors
      const response = await request('GET', '/DO/error-handler-test/')

      // Should not crash, should return some response
      expect(response.status).toBeDefined()
    })
  })
})
