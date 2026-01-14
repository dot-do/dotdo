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

import {
  findDOBinding,
  hasSubdomain,
  buildNamespaceUrl,
  errorResponse,
  createForwardRequest,
} from './utils'

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
  /**
   * The resolved namespace - either a full URL or a literal string.
   * - Hostname mode: 'https://tenant.api.example.org.ai'
   * - Path param mode: 'https://api.example.org.ai/acme'
   * - Fixed namespace mode: 'main' (literal)
   */
  ns: string | null
  remainingPath: string
}

/**
 * Extract namespace from path using Express-style pattern
 * Pattern: '/:param' or '/:param1/:param2'
 *
 * @returns Object with full URL namespace and remaining path
 */
function extractPathParams(url: URL, pattern: string): ResolveResult {
  // Parse pattern to get param names
  const patternParts = pattern.split('/').filter(Boolean)
  const paramCount = patternParts.filter(p => p.startsWith(':')).length

  // Parse pathname
  const pathParts = url.pathname.split('/').filter(Boolean)

  // Need enough path segments for all params
  if (pathParts.length < paramCount) {
    return { ns: null, remainingPath: url.pathname }
  }

  // Extract namespace parts (the path segments that form the namespace)
  const nsParts = pathParts.slice(0, paramCount)
  const nsPath = '/' + nsParts.join('/')

  // Build full namespace URL: origin + namespace path
  // e.g., 'https://api.example.org.ai/acme' or 'https://api.example.org.ai/acme/proj1'
  const ns = url.origin + nsPath

  // Remaining path
  const remaining = pathParts.slice(paramCount)
  const remainingPath = '/' + remaining.join('/')

  return { ns, remainingPath }
}

/**
 * Resolve namespace from request based on pattern
 *
 * Returns full URL namespaces for hostname and path modes,
 * or literal strings for fixed namespace mode.
 */
function resolveNs(request: Request, pattern?: string): ResolveResult {
  const url = new URL(request.url)

  // No pattern = hostname mode
  // Check if hostname has subdomain (4+ parts)
  // Namespace is the full origin URL: 'https://tenant.api.example.org.ai'
  if (!pattern) {
    if (!hasSubdomain(url.hostname)) {
      return { ns: null, remainingPath: url.pathname }
    }
    // Return full origin as namespace (includes protocol, hostname, port)
    return { ns: buildNamespaceUrl(url), remainingPath: url.pathname }
  }

  // Literal/fixed namespace (no colon = not a path param)
  // e.g., 'main', 'singleton' - use as-is
  if (!pattern.startsWith('/') || !pattern.includes(':')) {
    return { ns: pattern, remainingPath: url.pathname }
  }

  // Path params (/:org or /:org/:project)
  // Namespace is full URL with path: 'https://api.example.org.ai/acme'
  return extractPathParams(url, pattern)
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

        // 4. Build forwarded URL and request
        const url = new URL(request.url)
        const forwardUrl = new URL(remainingPath + url.search, url.origin)
        const forwardRequest = createForwardRequest(request, forwardUrl)

        // 5. Forward request to DO
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
