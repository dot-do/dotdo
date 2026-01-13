/**
 * Worker Routing Module
 *
 * Consolidates routing functionality for DO proxy workers:
 * - Namespace resolution (hostname, path, fixed)
 * - DO binding discovery and stub creation
 * - Request forwarding utilities
 *
 * @module workers/routing
 */

import type { CloudflareEnv } from '../types/CloudflareBindings'
import type {
  ProxyMode,
  ProxyConfig,
  NamespaceResolveResult,
  APIConfig,
} from './types'

// Re-export types
export type { ProxyMode, ProxyConfig, NamespaceResolveResult, APIConfig }

// =============================================================================
// NAMESPACE RESOLUTION
// =============================================================================

/**
 * Check if hostname has a subdomain using 4-part heuristic for multi-tenant SaaS:
 * - 4+ parts: tenant.api.dotdo.dev -> true (has subdomain)
 * - 3 parts: api.dotdo.dev -> false (apex, no subdomain)
 * - 2 parts: dotdo.dev -> false (apex)
 * - 1 part: localhost -> false
 */
export function hasSubdomain(hostname: string): boolean {
  const parts = hostname.split('.')
  return parts.length >= 4
}

/**
 * Resolve namespace from hostname
 *
 * @param host - Full hostname (e.g., 'tenant.api.dotdo.dev')
 * @param rootDomain - Root domain to strip (e.g., 'api.dotdo.dev')
 * @param levels - Number of subdomain levels to extract
 * @returns Extracted namespace or null
 */
export function resolveHostnameNamespace(
  host: string,
  rootDomain: string,
  levels: number = 1
): string | null {
  // Check if host ends with root domain
  if (!host.endsWith(rootDomain)) {
    return null
  }

  // Extract prefix before root domain
  const prefixLength = host.length - rootDomain.length
  if (prefixLength <= 1) {
    // Apex domain (no subdomain prefix) or just the dot
    return null
  }

  // Remove trailing dot from prefix
  const prefix = host.slice(0, prefixLength - 1)
  if (!prefix) {
    return null
  }

  const parts = prefix.split('.')

  // Extract specified number of levels
  return parts.slice(0, levels).join('.') || null
}

/**
 * Resolve namespace from path segments
 *
 * @param pathname - URL pathname (e.g., '/acme/users')
 * @param paramCount - Number of path segments to use as namespace
 * @returns Object with namespace and remaining path
 */
export function resolvePathNamespace(
  pathname: string,
  paramCount: number = 1
): { ns: string | null; remainingPath: string } {
  const segments = pathname.split('/').filter(Boolean)

  if (segments.length < paramCount) {
    return { ns: null, remainingPath: pathname }
  }

  const nsParts = segments.slice(0, paramCount)
  const ns = nsParts.join(':')

  const remaining = segments.slice(paramCount)
  const remainingPath = '/' + remaining.join('/')

  return { ns: ns || null, remainingPath }
}

/**
 * Extract namespace from path using Express-style pattern
 *
 * @param url - Full URL object
 * @param pattern - Pattern like '/:org' or '/:org/:project'
 * @returns Object with namespace URL and remaining path
 */
export function extractPathParams(url: URL, pattern: string): NamespaceResolveResult {
  // Parse pattern to get param names
  const patternParts = pattern.split('/').filter(Boolean)
  const paramCount = patternParts.filter(p => p.startsWith(':')).length

  // Parse pathname
  const pathParts = url.pathname.split('/').filter(Boolean)

  // Need enough path segments for all params
  if (pathParts.length < paramCount) {
    return { ns: null, remainingPath: url.pathname }
  }

  // Extract namespace parts
  const nsParts = pathParts.slice(0, paramCount)
  const nsPath = '/' + nsParts.join('/')

  // Build full namespace URL
  const ns = url.origin + nsPath

  // Remaining path
  const remaining = pathParts.slice(paramCount)
  const remainingPath = '/' + remaining.join('/')

  return { ns, remainingPath }
}

/**
 * Unified namespace resolution based on config
 */
export function resolveNamespace(request: Request, config: ProxyConfig): NamespaceResolveResult {
  const url = new URL(request.url)

  switch (config.mode) {
    case 'fixed':
      return {
        ns: config.fixed?.namespace || null,
        remainingPath: url.pathname,
      }

    case 'hostname': {
      const root = config.hostname?.rootDomain || ''
      const levels = config.hostname?.stripLevels || 1

      const ns = resolveHostnameNamespace(url.hostname, root, levels)

      if (!ns) {
        return {
          ns: config.defaultNs || null,
          remainingPath: url.pathname,
        }
      }

      return { ns, remainingPath: url.pathname }
    }

    case 'path': {
      let pathname = url.pathname

      // Apply basepath stripping first
      if (config.basepath && pathname.startsWith(config.basepath)) {
        pathname = pathname.slice(config.basepath.length) || '/'
      }

      const segments = pathname.split('/').filter(Boolean)
      const ns = segments[0] || config.defaultNs || null
      const remaining = segments.slice(1)
      const remainingPath = '/' + remaining.join('/')

      return { ns, remainingPath }
    }

    default:
      return { ns: null, remainingPath: url.pathname }
  }
}

/**
 * Resolve namespace using API config pattern
 */
export function resolveApiNamespace(request: Request, pattern?: string): NamespaceResolveResult {
  const url = new URL(request.url)

  // No pattern = hostname mode
  if (!pattern) {
    if (!hasSubdomain(url.hostname)) {
      return { ns: null, remainingPath: url.pathname }
    }
    return { ns: url.origin, remainingPath: url.pathname }
  }

  // Literal/fixed namespace (no colon = not a path param)
  if (!pattern.startsWith('/') || !pattern.includes(':')) {
    return { ns: pattern, remainingPath: url.pathname }
  }

  // Path params (/:org or /:org/:project)
  return extractPathParams(url, pattern)
}

// =============================================================================
// DO BINDING UTILITIES
// =============================================================================

/**
 * Find the first DurableObjectNamespace binding in env
 */
export function findDOBinding(env: Record<string, unknown>): DurableObjectNamespace | null {
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

/**
 * Get a DO stub from namespace and name
 */
export function getDOStub(
  namespace: DurableObjectNamespace,
  name: string
): DurableObjectStub {
  const id = namespace.idFromName(name)
  return namespace.get(id)
}

// =============================================================================
// REQUEST FORWARDING
// =============================================================================

/**
 * Get the path to forward to DO after namespace extraction and basepath stripping
 */
export function getForwardPath(request: Request, config: ProxyConfig): string {
  const url = new URL(request.url)
  let pathname = url.pathname

  // Strip basepath if configured
  if (config.basepath && pathname.startsWith(config.basepath)) {
    pathname = pathname.slice(config.basepath.length)
  }

  // For path mode, also strip the namespace segment
  if (config.mode === 'path') {
    const segments = pathname.split('/').filter(Boolean)
    if (segments.length > 0) {
      pathname = '/' + segments.slice(1).join('/')
    }
  }

  // Ensure path starts with /
  if (!pathname || pathname === '') {
    pathname = '/'
  } else if (!pathname.startsWith('/')) {
    pathname = '/' + pathname
  }

  return pathname
}

/**
 * Create a forwarded request for DO
 */
export function createForwardRequest(
  request: Request,
  forwardPath: string
): Request {
  const url = new URL(request.url)
  const forwardUrl = new URL(forwardPath + url.search, url.origin)

  return new Request(forwardUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    duplex: 'half',
  } as RequestInit)
}

/**
 * Forward request to DO and return response
 */
export async function forwardToDO(
  request: Request,
  stub: DurableObjectStub,
  forwardPath: string
): Promise<Response> {
  const forwardRequest = createForwardRequest(request, forwardPath)
  return await stub.fetch(forwardRequest)
}

// =============================================================================
// ERROR RESPONSES
// =============================================================================

/**
 * Create a JSON error response
 */
export function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Create a not found response
 */
export function notFoundResponse(message: string = 'Not Found'): Response {
  return errorResponse(404, message)
}

/**
 * Create a service unavailable response
 */
export function serviceUnavailableResponse(error?: Error): Response {
  return errorResponse(503, error?.message || 'Service Unavailable')
}

// =============================================================================
// PROXY HANDLER FACTORIES
// =============================================================================

/**
 * Create a proxy handler with the given configuration
 */
export function createProxyHandler(config: ProxyConfig) {
  return async function handler(request: Request, env: CloudflareEnv): Promise<Response> {
    // 1. Resolve namespace based on mode
    const { ns, remainingPath } = resolveNamespace(request, config)
    if (!ns) {
      return notFoundResponse('Namespace not found')
    }

    // 2. Check if DO binding exists
    if (!env?.DO) {
      return errorResponse(500, 'DO binding not found')
    }

    try {
      // 3. Get DO stub
      const stub = getDOStub(env.DO, ns)

      // 4. Get forward path
      const forwardPath = getForwardPath(request, config)

      // 5. Forward request to DO
      return await forwardToDO(request, stub, forwardPath)
    } catch (error) {
      return serviceUnavailableResponse(error instanceof Error ? error : undefined)
    }
  }
}

/**
 * Create an API proxy worker using pattern-based routing
 */
export function createAPIHandler(config?: APIConfig) {
  return async function handler(request: Request, env: unknown): Promise<Response> {
    // 1. Find DO binding
    const DO = findDOBinding(env as Record<string, unknown>)
    if (!DO) {
      return errorResponse(500, 'No DO binding found')
    }

    // 2. Resolve namespace
    const { ns, remainingPath } = resolveApiNamespace(request, config?.ns)
    if (!ns) {
      return notFoundResponse('Namespace not found')
    }

    try {
      // 3. Get DO stub
      const stub = getDOStub(DO, ns)

      // 4. Forward request to DO
      return await forwardToDO(request, stub, remainingPath)
    } catch (error) {
      return serviceUnavailableResponse(error instanceof Error ? error : undefined)
    }
  }
}
