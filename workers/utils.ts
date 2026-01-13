/**
 * Worker Utilities
 *
 * Shared utility functions for all worker modules:
 * - DO binding discovery and stub creation
 * - Request forwarding helpers
 * - Response factories (error, success)
 * - Namespace resolution helpers
 *
 * This module consolidates duplicated utilities from:
 * - api.ts
 * - hostname-proxy.ts
 * - routing.ts
 * - hateoas.ts
 * - jsonapi.ts
 *
 * @module workers/utils
 */

import type { CloudflareEnv } from '../types/CloudflareBindings'

// =============================================================================
// DO BINDING UTILITIES
// =============================================================================

/**
 * Find the first DurableObjectNamespace binding in env.
 * Searches all env values for objects that have the DO namespace interface.
 *
 * @param env - Environment bindings object
 * @returns The first DO namespace found, or null if none exists
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
 * Get a DO stub from namespace and name.
 *
 * @param namespace - The DurableObjectNamespace binding
 * @param name - The namespace name to get a stub for
 * @returns A DurableObjectStub for the named DO instance
 */
export function getDOStub(
  namespace: DurableObjectNamespace,
  name: string
): DurableObjectStub {
  const id = namespace.idFromName(name)
  return namespace.get(id)
}

/**
 * Get a DO stub from CloudflareEnv using the standard DO binding.
 * Convenience wrapper for common use case.
 *
 * @param env - CloudflareEnv with DO binding
 * @param name - The namespace name to get a stub for
 * @returns A DurableObjectStub, or null if DO binding doesn't exist
 */
export function getDOStubFromEnv(
  env: CloudflareEnv,
  name: string
): DurableObjectStub | null {
  if (!env?.DO) {
    return null
  }
  return getDOStub(env.DO, name)
}

// =============================================================================
// HOSTNAME UTILITIES
// =============================================================================

/**
 * Check if hostname has a subdomain using 4-part heuristic for multi-tenant SaaS.
 *
 * Examples:
 * - 4+ parts: tenant.api.dotdo.dev -> true (has subdomain)
 * - 3 parts: api.dotdo.dev -> false (apex, no subdomain)
 * - 2 parts: dotdo.dev -> false (apex)
 * - 1 part: localhost -> false
 *
 * @param hostname - The hostname to check
 * @returns true if hostname has a subdomain (4+ parts)
 */
export function hasSubdomain(hostname: string): boolean {
  const parts = hostname.split('.')
  return parts.length >= 4
}

/**
 * Extract subdomain from hostname.
 *
 * @param hostname - Full hostname (e.g., 'tenant.api.dotdo.dev')
 * @param rootDomain - Root domain to strip (e.g., 'api.dotdo.dev')
 * @returns Extracted subdomain or null
 */
export function extractSubdomain(hostname: string, rootDomain: string): string | null {
  if (!hostname.endsWith(rootDomain)) {
    return null
  }

  const prefixLength = hostname.length - rootDomain.length
  if (prefixLength <= 1) {
    return null
  }

  // Remove trailing dot from prefix
  const prefix = hostname.slice(0, prefixLength - 1)
  return prefix || null
}

// =============================================================================
// REQUEST FORWARDING
// =============================================================================

/**
 * Create a forwarded request for DO.
 * Preserves method, headers, body with proper duplex configuration.
 *
 * @param request - Original request
 * @param forwardUrl - URL to forward to
 * @returns New Request object configured for DO forwarding
 */
export function createForwardRequest(
  request: Request,
  forwardUrl: string | URL
): Request {
  return new Request(forwardUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    duplex: 'half',
  } as RequestInit)
}

/**
 * Forward a request to a DO stub.
 *
 * @param request - Original request
 * @param stub - DO stub to forward to
 * @param forwardPath - Path to forward to (will be combined with origin)
 * @returns Response from the DO
 */
export async function forwardToDO(
  request: Request,
  stub: DurableObjectStub,
  forwardPath: string
): Promise<Response> {
  const url = new URL(request.url)
  const forwardUrl = new URL(forwardPath + url.search, url.origin)
  const forwardRequest = createForwardRequest(request, forwardUrl)
  return await stub.fetch(forwardRequest)
}

/**
 * Build forward URL from request with path modification.
 *
 * @param request - Original request
 * @param newPath - New path to use (replaces original path)
 * @returns Full URL string with new path and preserved query string
 */
export function buildForwardUrl(request: Request, newPath: string): string {
  const url = new URL(request.url)
  const forwardUrl = new URL(newPath + url.search, url.origin)
  return forwardUrl.toString()
}

// =============================================================================
// RESPONSE FACTORIES
// =============================================================================

/**
 * Create a JSON error response.
 *
 * @param status - HTTP status code
 * @param message - Error message
 * @returns Response with JSON error body
 */
export function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Create a 404 Not Found response.
 *
 * @param message - Optional custom message (default: 'Not Found')
 * @returns 404 Response with JSON error body
 */
export function notFoundResponse(message: string = 'Not Found'): Response {
  return errorResponse(404, message)
}

/**
 * Create a 503 Service Unavailable response.
 *
 * @param error - Optional error object for message extraction
 * @returns 503 Response with JSON error body
 */
export function serviceUnavailableResponse(error?: Error): Response {
  return errorResponse(503, error?.message || 'Service Unavailable')
}

/**
 * Create a 500 Internal Server Error response.
 *
 * @param error - Optional error object for message extraction
 * @returns 500 Response with JSON error body
 */
export function internalServerErrorResponse(error?: Error): Response {
  return errorResponse(500, error?.message || 'Internal Server Error')
}

/**
 * Create a JSON success response.
 *
 * @param data - Data to serialize as JSON
 * @param status - HTTP status code (default: 200)
 * @returns Response with JSON body
 */
export function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// =============================================================================
// PATH UTILITIES
// =============================================================================

/**
 * Extract path segments from a pathname.
 *
 * @param pathname - URL pathname (e.g., '/ns/collection/id')
 * @returns Array of path segments (e.g., ['ns', 'collection', 'id'])
 */
export function getPathSegments(pathname: string): string[] {
  return pathname.split('/').filter(Boolean)
}

/**
 * Strip leading path segments from a pathname.
 *
 * @param pathname - Original pathname
 * @param count - Number of segments to strip
 * @returns Pathname with segments stripped (always starts with '/')
 */
export function stripPathSegments(pathname: string, count: number): string {
  const segments = getPathSegments(pathname)
  const remaining = segments.slice(count)
  return '/' + remaining.join('/')
}

/**
 * Ensure a path starts with '/'.
 *
 * @param path - Path to normalize
 * @returns Path guaranteed to start with '/'
 */
export function normalizePath(path: string): string {
  if (!path || path === '') {
    return '/'
  }
  if (!path.startsWith('/')) {
    return '/' + path
  }
  return path
}

/**
 * Strip a basepath prefix from a pathname.
 *
 * @param pathname - Full pathname
 * @param basepath - Prefix to strip
 * @returns Pathname with basepath removed (or original if no match)
 */
export function stripBasepath(pathname: string, basepath?: string): string {
  if (!basepath || !pathname.startsWith(basepath)) {
    return pathname
  }
  const stripped = pathname.slice(basepath.length)
  return normalizePath(stripped)
}

// =============================================================================
// URL BUILDING
// =============================================================================

/**
 * Build a namespace URL from origin.
 * Used for hostname-based routing where namespace is the full origin.
 *
 * @param url - URL object
 * @returns Full origin URL (protocol + hostname + port)
 */
export function buildNamespaceUrl(url: URL): string {
  return url.origin
}

/**
 * Build a context URL for HATEOAS responses.
 *
 * @param url - URL object or string
 * @param ns - Namespace to append
 * @returns Context URL (origin + '/' + namespace)
 */
export function buildContextUrl(url: URL | string, ns: string): string {
  const urlObj = typeof url === 'string' ? new URL(url) : url
  return `${urlObj.protocol}//${urlObj.host}/${ns}`
}

// =============================================================================
// ENV PARSING
// =============================================================================

/**
 * Parse a comma-separated environment variable to an array.
 *
 * @param value - Environment variable value
 * @returns Array of trimmed values, or undefined if empty
 */
export function parseEnvArray(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}
