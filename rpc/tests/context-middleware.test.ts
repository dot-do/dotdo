/**
 * Tests for $Context Hono Middleware (do-99vxp)
 *
 * Covers:
 * - Middleware extracts context from fresh requests
 * - Middleware propagates context from upstream headers
 * - Custom tenant/user extractors
 * - Trust settings for propagated headers
 * - getContext helper
 */

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import {
  contextMiddleware,
  getContext,
  type ContextVariables,
} from '../context-middleware'
import {
  contextToHeaders,
  createContext,
  CONTEXT_HEADERS,
  type $Context,
} from '../context'
import { CORRELATION_ID_HEADER } from '../headers'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a minimal Hono app with context middleware for testing.
 */
function createTestApp(options?: Parameters<typeof contextMiddleware>[0]) {
  const app = new Hono<{ Variables: ContextVariables }>()

  app.use('/*', contextMiddleware(options))

  // Test endpoint that returns the extracted context
  app.get('/whoami', (c) => {
    const $ctx = c.get('$context') as $Context
    return c.json({
      correlationId: $ctx.correlationId,
      tenantId: $ctx.tenantId,
      userId: $ctx.userId,
      agentId: $ctx.agentId,
      sessionId: $ctx.sessionId,
      permissions: [...$ctx.permissions],
      capabilities: [...$ctx.capabilities],
      trusted: $ctx.trusted,
      sourceDoId: $ctx.sourceDoId,
    })
  })

  // Test endpoint that uses getContext helper
  app.get('/tenant', (c) => {
    const $ctx = getContext(c)
    return c.json({ tenantId: $ctx.tenantId })
  })

  return app
}

// ============================================================================
// Fresh Request Context
// ============================================================================

describe('contextMiddleware', () => {
  describe('fresh request (no propagated headers)', () => {
    it('should extract tenant from subdomain', async () => {
      const app = createTestApp()
      const res = await app.request('https://crm.headless.ly/whoami')
      const body = await res.json() as Record<string, unknown>

      expect(body.tenantId).toBe('crm')
    })

    it('should extract tenant from tilda path', async () => {
      // The tilda path extractor works by inspecting the URL,
      // but the route must still match. Add a wildcard route.
      const app = new Hono<{ Variables: ContextVariables }>()
      app.use('/*', contextMiddleware())
      app.get('/*', (c) => {
        const $ctx = c.get('$context') as $Context
        return c.json({ tenantId: $ctx.tenantId })
      })

      const res = await app.request('https://headless.ly/~acme/whoami')
      const body = await res.json() as Record<string, unknown>

      expect(body.tenantId).toBe('acme')
    })

    it('should use default tenant when first path segment is the route', async () => {
      // When the path is just /whoami and there's no subdomain,
      // the first path segment ('whoami') is used as tenant by the default extractor.
      // To get 'fallback', we need a URL with no extractable tenant.
      const app = new Hono<{ Variables: ContextVariables }>()
      app.use('/*', contextMiddleware({
        defaultTenant: 'fallback',
        // Override to only use subdomain, not path
        extractTenant: (c) => {
          const url = new URL(c.req.url)
          const hostParts = url.hostname.split('.')
          return hostParts.length > 2 ? hostParts[0] : undefined
        },
      }))
      app.get('/whoami', (c) => {
        const $ctx = c.get('$context') as $Context
        return c.json({ tenantId: $ctx.tenantId })
      })

      const res = await app.request('https://headless.ly/whoami')
      const body = await res.json() as Record<string, unknown>

      expect(body.tenantId).toBe('fallback')
    })

    it('should extract tenant from first path segment by default', async () => {
      const app = createTestApp()
      // Two-part hostname has no subdomain and path is /whoami
      const res = await app.request('http://localhost/whoami')
      const body = await res.json() as Record<string, unknown>
      // The first path segment is 'whoami', which gets used as tenant
      expect(body.tenantId).toBe('whoami')
    })

    it('should generate a correlationId automatically', async () => {
      const app = createTestApp()
      const res = await app.request('https://crm.headless.ly/whoami')
      const body = await res.json() as Record<string, unknown>

      expect(body.correlationId).toBeDefined()
      expect(typeof body.correlationId).toBe('string')
      expect((body.correlationId as string).length).toBeGreaterThan(0)
    })

    it('should use correlationId from request header', async () => {
      const app = createTestApp()
      const res = await app.request('https://crm.headless.ly/whoami', {
        headers: { [CORRELATION_ID_HEADER]: 'custom-corr-id' },
      })
      const body = await res.json() as Record<string, unknown>

      expect(body.correlationId).toBe('custom-corr-id')
    })

    it('should set trusted to false for external requests', async () => {
      const app = createTestApp()
      const res = await app.request('https://crm.headless.ly/whoami')
      const body = await res.json() as Record<string, unknown>

      expect(body.trusted).toBe(false)
    })
  })

  // ============================================================================
  // Propagated Context
  // ============================================================================

  describe('propagated context (from upstream headers)', () => {
    it('should restore full context from propagated headers', async () => {
      const app = createTestApp()

      const upstream = createContext({
        correlationId: 'upstream-corr',
        tenantId: 'acme',
        userId: 'user_upstream',
        agentId: 'agent_upstream',
        sessionId: 'sess_upstream',
        permissions: ['read', 'write'],
        capabilities: ['crm:contacts:create'],
        trusted: true,
        sourceDoId: 'do-upstream',
      })

      const headers = contextToHeaders(upstream)

      const res = await app.request('https://target.headless.ly/whoami', {
        headers,
      })
      const body = await res.json() as Record<string, unknown>

      expect(body.correlationId).toBe('upstream-corr')
      expect(body.tenantId).toBe('acme')
      expect(body.userId).toBe('user_upstream')
      expect(body.agentId).toBe('agent_upstream')
      expect(body.sessionId).toBe('sess_upstream')
      expect(body.permissions).toEqual(['read', 'write'])
      expect(body.capabilities).toEqual(['crm:contacts:create'])
      expect(body.trusted).toBe(true)
      expect(body.sourceDoId).toBe('do-upstream')
    })

    it('should reject propagated headers when trustPropagatedHeaders is false', async () => {
      const app = createTestApp({ trustPropagatedHeaders: false })

      const upstream = createContext({
        tenantId: 'acme',
        userId: 'injected-user',
        permissions: ['admin'],
        trusted: true,
      })

      const headers = contextToHeaders(upstream)

      const res = await app.request('https://target.headless.ly/whoami', {
        headers,
      })
      const body = await res.json() as Record<string, unknown>

      // Should NOT use the propagated context
      expect(body.userId).toBeUndefined()
      expect(body.permissions).toEqual([])
      expect(body.trusted).toBe(false)
      // Tenant should come from subdomain extraction, not propagated headers
      expect(body.tenantId).toBe('target')
    })
  })

  // ============================================================================
  // Custom Extractors
  // ============================================================================

  describe('custom extractors', () => {
    it('should use custom tenant extractor', async () => {
      const app = createTestApp({
        extractTenant: (c) => {
          const url = new URL(c.req.url)
          // Custom: extract from query param
          return url.searchParams.get('tenant') ?? undefined
        },
      })

      const res = await app.request('https://headless.ly/whoami?tenant=custom-tenant')
      const body = await res.json() as Record<string, unknown>

      expect(body.tenantId).toBe('custom-tenant')
    })

    it('should use custom userId extractor', async () => {
      const app = createTestApp({
        extractUserId: (c) => {
          return c.req.header('X-Custom-User') ?? undefined
        },
      })

      const res = await app.request('https://crm.headless.ly/whoami', {
        headers: { 'X-Custom-User': 'custom-user-id' },
      })
      const body = await res.json() as Record<string, unknown>

      expect(body.userId).toBe('custom-user-id')
    })

    it('should use custom agentId extractor', async () => {
      const app = createTestApp({
        extractAgentId: (c) => {
          return c.req.header('X-Agent-ID') ?? undefined
        },
      })

      const res = await app.request('https://crm.headless.ly/whoami', {
        headers: { 'X-Agent-ID': 'bot-007' },
      })
      const body = await res.json() as Record<string, unknown>

      expect(body.agentId).toBe('bot-007')
    })

    it('should use custom permissions extractor', async () => {
      const app = createTestApp({
        extractPermissions: () => ['admin', 'owner'],
      })

      const res = await app.request('https://crm.headless.ly/whoami')
      const body = await res.json() as Record<string, unknown>

      expect(body.permissions).toEqual(['admin', 'owner'])
    })
  })

  // ============================================================================
  // getContext Helper
  // ============================================================================

  describe('getContext helper', () => {
    it('should return context when middleware is applied', async () => {
      const app = createTestApp()
      const res = await app.request('https://crm.headless.ly/tenant')
      const body = await res.json() as Record<string, unknown>

      expect(body.tenantId).toBe('crm')
    })

    it('should throw when middleware is not applied', async () => {
      const app = new Hono()
      // No middleware applied
      app.get('/tenant', (c) => {
        const $ctx = getContext(c)
        return c.json({ tenantId: $ctx.tenantId })
      })

      const res = await app.request('https://crm.headless.ly/tenant')
      // Should result in 500 error
      expect(res.status).toBe(500)
    })
  })
})
