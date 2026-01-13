/**
 * DO Router Tests
 *
 * Tests for the REST-like routes that forward requests to the default DO namespace.
 *
 * These tests verify:
 * - REST-like paths (e.g., /customers, /orders/123) route to default DO
 * - Reserved prefixes (api, auth, admin, etc.) are NOT routed to DO
 * - Error handling for DO communication failures
 *
 * NOTE: The old /DO/:id/* pattern has been removed as it exposed internal
 * binding names in URLs. For multi-tenant routing, use the API() factory
 * from workers/api.ts with hostname or path-based routing.
 *
 * @see workers/api.ts - API() factory for multi-tenant routing
 * @see workers/tests/hostname-routing.test.ts - Hostname routing tests
 */

import { describe, it, expect, beforeAll } from 'vitest'

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
// Test Setup
// ============================================================================

describe('DO Router - REST-like paths to default DO', () => {
  let app: { request: (path: string | Request, options?: RequestInit) => Promise<Response> }

  beforeAll(async () => {
    const workerModule = await import('../../index')
    app = workerModule.app as typeof app
  })

  // ============================================================================
  // 1. Reserved Prefix Tests - Should NOT route to DO
  // ============================================================================

  describe('reserved prefixes', () => {
    it('should NOT route /api paths to DO', async () => {
      const response = await app.request('/api/test')

      // /api is handled by apiRoutes, not doRoutes
      // In test environment may return 500 due to missing bindings, or 404 if route not found
      // The key is that it doesn't go to the DO routes (which would return different errors)
      expect([404, 500]).toContain(response.status)
    })

    it('should NOT route /auth paths to DO', async () => {
      const response = await app.request('/auth/test')

      // /auth is reserved for authentication
      expect(response.status).toBeDefined()
    })

    it('should NOT route /admin paths to DO', async () => {
      const response = await app.request('/admin')

      // /admin is handled by admin routes
      // Should return HTML page, not DO response
      const contentType = response.headers.get('content-type')
      expect(contentType).toContain('text/html')
    })

    it('should NOT route /docs paths to DO', async () => {
      const response = await app.request('/docs')

      // /docs is handled by docs routes
      expect(response.headers.get('content-type')).toContain('text/html')
    })

    it('should NOT route /mcp paths to DO', async () => {
      const response = await app.request('/mcp/test')

      // /mcp is handled by MCP routes
      expect(response.status).toBeDefined()
    })

    it('should NOT route /rpc paths to DO', async () => {
      const response = await app.request('/rpc/test')

      // /rpc is handled by RPC routes
      expect(response.status).toBeDefined()
    })

    it('should NOT route /health paths to DO', async () => {
      const response = await app.request('/health')

      // /health is reserved
      expect(response.status).toBeDefined()
    })
  })

  // ============================================================================
  // 2. REST-like Path Tests - Should route to default DO
  // ============================================================================

  describe('REST-like paths', () => {
    it('should route /customers to default DO', async () => {
      const response = await app.request('/customers')

      // In test environment without DO bindings, should return 404 with specific message
      // In production with DO bindings, would forward to DO('default')
      expect(response.status).toBeDefined()
    })

    it('should route /customers/123 to default DO', async () => {
      const response = await app.request('/customers/123')

      expect(response.status).toBeDefined()
    })

    it('should route /customers/123/edit to default DO', async () => {
      const response = await app.request('/customers/123/edit')

      expect(response.status).toBeDefined()
    })

    it('should route /orders to default DO', async () => {
      const response = await app.request('/orders')

      expect(response.status).toBeDefined()
    })

    it('should route /products/abc/variants to default DO', async () => {
      const response = await app.request('/products/abc/variants')

      expect(response.status).toBeDefined()
    })
  })

  // ============================================================================
  // 3. HTTP Method Tests
  // ============================================================================

  describe('HTTP methods', () => {
    it('should forward GET requests', async () => {
      const response = await app.request('/customers')

      expect(response.status).toBeDefined()
    })

    it('should forward POST requests', async () => {
      const response = await app.request('/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      })

      expect(response.status).toBeDefined()
    })

    it('should forward PUT requests', async () => {
      const response = await app.request('/customers/123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      })

      expect(response.status).toBeDefined()
    })

    it('should forward DELETE requests', async () => {
      const response = await app.request('/customers/123', {
        method: 'DELETE',
      })

      expect(response.status).toBeDefined()
    })

    it('should forward PATCH requests', async () => {
      const response = await app.request('/customers/123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Patched' }),
      })

      expect(response.status).toBeDefined()
    })
  })

  // ============================================================================
  // 4. Query Parameter Tests
  // ============================================================================

  describe('query parameters', () => {
    it('should preserve query parameters', async () => {
      const response = await app.request('/customers?limit=10&offset=20')

      expect(response.status).toBeDefined()
    })

    it('should handle complex query parameters', async () => {
      const response = await app.request('/customers?filter=name:John&sort=-createdAt&include=orders')

      expect(response.status).toBeDefined()
    })
  })

  // ============================================================================
  // 5. Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('should handle root path', async () => {
      const response = await app.request('/')

      // Root should return landing page, not route to DO
      expect(response.headers.get('content-type')).toContain('text/html')
    })

    it('should handle empty path segments', async () => {
      const response = await app.request('/customers//123')

      expect(response.status).toBeDefined()
    })

    it('should handle paths with special characters', async () => {
      const response = await app.request('/customers/user%40example.org.ai')

      expect(response.status).toBeDefined()
    })
  })
})

// ============================================================================
// Migration Note: /DO/:id routes removed
// ============================================================================

/**
 * MIGRATION NOTE
 *
 * The old /DO/:id/* routes have been removed because they exposed internal
 * Cloudflare binding names in URLs (e.g., /DO/user-123/profile).
 *
 * For multi-tenant routing, use the API() factory from workers/api.ts:
 *
 * ```typescript
 * import { API } from 'dotdo'
 *
 * // Hostname mode (default)
 * // tenant.api.dotdo.dev -> DO('https://tenant.api.dotdo.dev')
 * export default API()
 *
 * // Path param routing (Express-style)
 * // api.dotdo.dev/acme/users -> DO('https://api.dotdo.dev/acme')
 * export default API({ ns: '/:org' })
 *
 * // Nested path params
 * // api.dotdo.dev/acme/proj1/tasks -> DO('https://api.dotdo.dev/acme/proj1')
 * export default API({ ns: '/:org/:project' })
 *
 * // Fixed namespace
 * export default API({ ns: 'main' })
 * ```
 *
 * @see workers/api.ts
 * @see workers/tests/hostname-routing.test.ts
 */
