/**
 * Clean API Factory for DO Proxy Workers
 *
 * Simple, expressive API for routing requests to Durable Objects.
 *
 * @example
 * ```typescript
 * import { API } from 'dotdo'
 *
 * // Default: hostname-based routing
 * // tenant.api.dotdo.dev -> DO('tenant')
 * export default API()
 *
 * // Path param routing (Express-style)
 * // api.dotdo.dev/acme/users -> DO('acme')
 * export default API({ ns: '/:org' })
 *
 * // Nested path params
 * // api.dotdo.dev/acme/proj1/tasks -> DO('acme:proj1')
 * export default API({ ns: '/:org/:project' })
 *
 * // Fixed namespace
 * export default API({ ns: 'main' })
 * ```
 *
 * @module workers/api
 */

/**
 * Configuration for API proxy
 */
export interface APIConfig {
  /**
   * Namespace pattern for routing:
   * - undefined: hostname-based (subdomain extraction)
   * - '/:param': single path param (Express-style)
   * - '/:param1/:param2': nested path params (joined by colon)
   * - 'literal': fixed namespace (no colon prefix)
   */
  ns?: string
}

/**
 * Result of namespace resolution
 */
interface ResolveResult {
  ns: string | null
  remainingPath: string
}

/**
 * Find the first DurableObjectNamespace binding in env
 */
function findDOBinding(env: Record<string, unknown>): DurableObjectNamespace | null {
  for (const value of Object.values(env)) {
    // Check if it looks like a DurableObjectNamespace
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

/**
 * Extract subdomain from hostname
 * e.g., 'tenant.api.dotdo.dev' -> 'tenant'
 *
 * Uses a 4-part heuristic for multi-tenant SaaS:
 * - 4+ parts: tenant.api.dotdo.dev -> 'tenant' (subdomain)
 * - 3 parts: api.dotdo.dev -> null (apex, no subdomain)
 * - 2 parts: dotdo.dev -> null (apex)
 * - 1 part: localhost -> null
 */
function extractSubdomain(hostname: string): string | null {
  const parts = hostname.split('.')
  // Need at least 4 parts for a subdomain in typical SaaS setup
  // e.g., tenant.api.dotdo.dev (4 parts) has subdomain 'tenant'
  // but api.dotdo.dev (3 parts) is apex, no subdomain
  if (parts.length < 4) {
    return null
  }
  // Return the first part as the subdomain
  return parts[0] || null
}

/**
 * Extract namespace from path using Express-style pattern
 * Pattern: '/:param' or '/:param1/:param2'
 */
function extractPathParams(pathname: string, pattern: string): ResolveResult {
  // Parse pattern to get param names
  const patternParts = pattern.split('/').filter(Boolean)
  const paramCount = patternParts.filter(p => p.startsWith(':')).length

  // Parse pathname
  const pathParts = pathname.split('/').filter(Boolean)

  // Need enough path segments for all params
  if (pathParts.length < paramCount) {
    return { ns: null, remainingPath: pathname }
  }

  // Extract namespace parts and join with colon
  const nsParts = pathParts.slice(0, paramCount)
  const ns = nsParts.join(':')

  // Remaining path
  const remaining = pathParts.slice(paramCount)
  const remainingPath = '/' + remaining.join('/')

  return { ns: ns || null, remainingPath }
}

/**
 * Resolve namespace from request based on pattern
 */
function resolveNs(request: Request, pattern?: string): ResolveResult {
  const url = new URL(request.url)

  // No pattern = hostname mode (extract subdomain)
  if (!pattern) {
    const subdomain = extractSubdomain(url.hostname)
    return { ns: subdomain, remainingPath: url.pathname }
  }

  // Literal namespace (no colon = not a path param)
  if (!pattern.startsWith('/') || !pattern.includes(':')) {
    return { ns: pattern, remainingPath: url.pathname }
  }

  // Path params (/:org or /:org/:project)
  return extractPathParams(url.pathname, pattern)
}

/**
 * Create error response
 */
function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Create an API proxy worker
 *
 * @param config - Optional configuration
 * @returns Worker handler object with fetch method
 */
export function API(config?: APIConfig): ExportedHandler {
  return {
    async fetch(request: Request, env: unknown): Promise<Response> {
      // 1. Find DO binding
      const DO = findDOBinding(env as Record<string, unknown>)
      if (!DO) {
        return errorResponse(500, 'No DO binding found')
      }

      // 2. Resolve namespace
      const { ns, remainingPath } = resolveNs(request, config?.ns)
      if (!ns) {
        return errorResponse(404, 'Namespace not found')
      }

      try {
        // 3. Get DO stub
        const doId = DO.idFromName(ns)
        const stub = DO.get(doId)

        // 4. Build forwarded URL
        const url = new URL(request.url)
        const forwardUrl = new URL(remainingPath + url.search, url.origin)

        // 5. Forward request to DO
        const forwardRequest = new Request(forwardUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.body,
          duplex: 'half',
        } as RequestInit)

        return await stub.fetch(forwardRequest)
      } catch (error) {
        return errorResponse(
          503,
          error instanceof Error ? error.message : 'Service Unavailable'
        )
      }
    },
  }
}

// Default export for convenience
export default API
