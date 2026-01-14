/**
 * Minimal DO Proxy Worker
 *
 * Simple Hono-based passthrough worker that routes requests to Durable Objects.
 *
 * Flow: HTTP Request → Worker → DO.fetch() → Response
 *
 * @example
 * ```typescript
 * import { API } from 'dotdo/workers'
 *
 * // Default: hostname-based routing
 * // tenant.api.dotdo.dev -> DO('tenant')
 * export default API()
 *
 * // Path-based routing
 * // api.dotdo.dev/acme/users -> DO('acme')
 * export default API({ ns: '/:org' })
 *
 * // Fixed namespace (singleton DO)
 * export default API({ ns: 'main' })
 * ```
 *
 * @module workers
 */

import { Hono } from 'hono'

// =============================================================================
// TYPES
// =============================================================================

/**
 * API factory configuration
 */
export interface APIConfig {
  /**
   * Namespace pattern for routing:
   * - undefined: hostname-based (subdomain extraction)
   * - '/:param': single path param
   * - '/:param1/:param2': nested path params (joined by colon)
   * - 'literal': fixed namespace
   */
  ns?: string
}

// =============================================================================
// NAMESPACE RESOLUTION
// =============================================================================

/**
 * Check if hostname has a subdomain (4+ parts for multi-tenant SaaS)
 */
function hasSubdomain(hostname: string): boolean {
  return hostname.split('.').length >= 4
}

/**
 * Resolve namespace from request
 */
function resolveNamespace(
  request: Request,
  pattern?: string
): { ns: string | null; remainingPath: string } {
  const url = new URL(request.url)

  // No pattern = hostname mode
  if (!pattern) {
    if (!hasSubdomain(url.hostname)) {
      return { ns: null, remainingPath: url.pathname }
    }
    return { ns: url.origin, remainingPath: url.pathname }
  }

  // Fixed namespace (no path params)
  if (!pattern.startsWith('/') || !pattern.includes(':')) {
    return { ns: pattern, remainingPath: url.pathname }
  }

  // Path param mode: /:org or /:org/:project
  const patternParts = pattern.split('/').filter(Boolean)
  const paramCount = patternParts.filter((p) => p.startsWith(':')).length
  const pathParts = url.pathname.split('/').filter(Boolean)

  if (pathParts.length < paramCount) {
    return { ns: null, remainingPath: url.pathname }
  }

  const nsParts = pathParts.slice(0, paramCount)
  const ns = url.origin + '/' + nsParts.join('/')
  const remainingPath = '/' + pathParts.slice(paramCount).join('/')

  return { ns, remainingPath }
}

// =============================================================================
// DO BINDING
// =============================================================================

/**
 * Find the first DurableObjectNamespace binding in env
 */
function findDOBinding(env: Record<string, unknown>): DurableObjectNamespace | null {
  for (const value of Object.values(env)) {
    if (
      value &&
      typeof value === 'object' &&
      'idFromName' in value &&
      'get' in value &&
      typeof (value as DurableObjectNamespace).idFromName === 'function' &&
      typeof (value as DurableObjectNamespace).get === 'function'
    ) {
      return value as DurableObjectNamespace
    }
  }
  return null
}

// =============================================================================
// API FACTORY
// =============================================================================

/**
 * Create a minimal DO proxy worker using Hono
 *
 * @param config - Optional namespace configuration
 * @returns Hono app that forwards all requests to DOs
 */
export function API(config?: APIConfig) {
  const app = new Hono()

  // Catch-all route - forward everything to DO
  app.all('*', async (c) => {
    const env = c.env as Record<string, unknown>

    // Find DO binding
    const DO = findDOBinding(env)
    if (!DO) {
      return c.json({ error: 'No DO binding found' }, 500)
    }

    // Resolve namespace
    const { ns, remainingPath } = resolveNamespace(c.req.raw, config?.ns)
    if (!ns) {
      return c.json({ error: 'Namespace not found' }, 404)
    }

    try {
      // Get DO stub
      const doId = DO.idFromName(ns)
      const stub = DO.get(doId)

      // Build forward URL
      const url = new URL(c.req.url)
      const forwardUrl = new URL(remainingPath + url.search, url.origin)

      // Forward request to DO
      const forwardRequest = new Request(forwardUrl.toString(), {
        method: c.req.method,
        headers: c.req.raw.headers,
        body: c.req.raw.body,
        duplex: 'half',
      } as RequestInit)

      return await stub.fetch(forwardRequest)
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Service Unavailable' },
        503
      )
    }
  })

  return app
}

// Default export
export default API
