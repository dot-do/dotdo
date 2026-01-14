/**
 * dotdo Worker - Unified API Layer
 *
 * This module provides a unified API layer that routes requests to the
 * appropriate Durable Object (DO). Supports multiple DO bindings, sharding,
 * and replica routing.
 *
 * Architecture:
 * - Request → Worker → Route to DO binding → DO.fetch() → rest-router.ts
 * - All REST operations handled by the target DO
 * - JSON-LD formatted responses with $context, $id, $type
 *
 * DO Routing:
 * - Default: env.DO - main data store
 * - /test-collection: env.COLLECTION_DO - test collection DO
 * - Sharding: Based on collection/id hashing
 *
 * Exports:
 * - default: Cloudflare Worker with fetch handler
 * - app: Hono app for testing (wraps DO)
 * - DO: Durable Object class
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './types'

export { DO } from '../objects/DO'

// ============================================================================
// DO ROUTING
// ============================================================================

/**
 * Route configuration for different DO bindings
 *
 * Maps route prefixes to DO bindings and namespace strategies.
 * Default binding is 'DO' for unmatched routes.
 */
interface DORoute {
  /** DO binding name in env */
  binding: keyof Pick<Env, 'DO' | 'COLLECTION_DO' | 'BROWSER_DO' | 'SANDBOX_DO' | 'OBS_BROADCASTER'>
  /** Namespace strategy: 'tenant' (from hostname), 'singleton', 'sharded' */
  nsStrategy: 'tenant' | 'singleton' | 'sharded'
  /** For sharded strategy, number of shards */
  shardCount?: number
}

const DO_ROUTES: Record<string, DORoute> = {
  'test-collection': { binding: 'COLLECTION_DO', nsStrategy: 'singleton' },
  'browsers': { binding: 'BROWSER_DO', nsStrategy: 'tenant' },
  'sandboxes': { binding: 'SANDBOX_DO', nsStrategy: 'tenant' },
  'obs': { binding: 'OBS_BROADCASTER', nsStrategy: 'singleton' },
}

/**
 * Get DO binding and namespace for a request
 *
 * @param env - Cloudflare env with DO bindings
 * @param pathname - Request pathname
 * @param hostname - Request hostname for tenant derivation
 * @returns DO namespace binding and namespace string
 */
function getDOBinding(
  env: Env,
  pathname: string,
  hostname: string
): { ns: DurableObjectNamespace; nsName: string } | null {
  // Extract first path segment (e.g., '/browsers/123' → 'browsers')
  const segments = pathname.slice(1).split('/')
  const firstSegment = segments[0]?.toLowerCase() ?? ''

  // Check for special routes
  const route = DO_ROUTES[firstSegment]

  if (route) {
    const binding = env[route.binding]
    if (!binding) {
      return null // Binding not available
    }

    let nsName: string
    switch (route.nsStrategy) {
      case 'singleton':
        nsName = firstSegment
        break
      case 'sharded':
        // Hash the ID to determine shard
        const id = segments[1] ?? ''
        const shardCount = route.shardCount ?? 16
        const hash = simpleHash(id)
        nsName = `${firstSegment}-shard-${hash % shardCount}`
        break
      case 'tenant':
      default:
        nsName = getTenantFromHostname(hostname)
        break
    }

    return { ns: binding, nsName }
  }

  // Default: use main DO binding with tenant namespace
  if (!env.DO) {
    return null
  }

  return {
    ns: env.DO,
    nsName: getTenantFromHostname(hostname),
  }
}

/**
 * Extract tenant from hostname
 *
 * Examples:
 * - acme.api.dotdo.dev → 'acme'
 * - localhost:8787 → 'default'
 * - api.dotdo.dev → 'default'
 */
function getTenantFromHostname(hostname: string): string {
  const hostParts = hostname.split('.')
  // If 3+ parts (e.g., tenant.api.dotdo.dev), use first part
  return hostParts.length > 2 ? hostParts[0] : 'default'
}

/**
 * Simple hash function for sharding
 */
function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

// Legacy function for backward compatibility
function getNamespace(url: URL): string {
  return getTenantFromHostname(url.hostname)
}

// ============================================================================
// HONO APP - For testing and direct use
// ============================================================================

/**
 * Hono app that forwards all requests to the DO
 *
 * This provides:
 * - CORS handling
 * - Request ID tracking
 * - Unified routing through DO
 */
export const app = new Hono<{ Bindings: Env }>()

// CORS middleware
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}))

// Request ID middleware
app.use('*', async (c, next) => {
  const requestId = c.req.header('X-Request-ID') || crypto.randomUUID()
  c.header('X-Request-ID', requestId)
  await next()
})

// Health check - handled directly (not forwarded to DO)
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
})

app.all('/api/health', (c) => {
  return c.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed. Allowed: GET' } },
    405,
    { Allow: 'GET' }
  )
})

// API info
app.get('/api', (c) => {
  return c.json({
    name: 'dotdo',
    version: '0.1.0',
    endpoints: ['/api/health', '/:collection', '/:collection/:id'],
  })
})

app.get('/api/', (c) => {
  return c.json({
    name: 'dotdo',
    version: '0.1.0',
    endpoints: ['/api/health', '/:collection', '/:collection/:id'],
  })
})

// Forward /api/* routes to DO (stripping /api prefix)
app.all('/api/*', async (c) => {
  const env = c.env
  const url = new URL(c.req.url)

  // Strip /api prefix for DO routing
  const pathWithoutApi = url.pathname.replace(/^\/api/, '') || '/'

  // Get appropriate DO binding based on route
  const doBinding = getDOBinding(env, pathWithoutApi, url.hostname)
  if (!doBinding) {
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'DO binding not available' } }, 503)
  }

  const doUrl = new URL(pathWithoutApi + url.search, url.origin)

  const id = doBinding.ns.idFromName(doBinding.nsName)
  const stub = doBinding.ns.get(id)

  // Forward request to DO
  const doRequest = new Request(doUrl.toString(), {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
  })

  return stub.fetch(doRequest)
})

// Forward all other routes directly to DO
app.all('*', async (c) => {
  const env = c.env
  const url = new URL(c.req.url)

  // Get appropriate DO binding based on route
  const doBinding = getDOBinding(env, url.pathname, url.hostname)
  if (!doBinding) {
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'DO binding not available' } }, 503)
  }

  const id = doBinding.ns.idFromName(doBinding.nsName)
  const stub = doBinding.ns.get(id)

  return stub.fetch(c.req.raw)
})

// ============================================================================
// WORKER DEFAULT EXPORT
// ============================================================================

/**
 * Cloudflare Worker - Default export
 *
 * In production, requests go directly to DO via this handler.
 * The Hono app above is primarily for testing.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Use the Hono app for all requests
    // This ensures consistent behavior between production and tests
    return app.fetch(request, env)
  },
}
