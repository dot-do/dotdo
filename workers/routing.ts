/**
 * URL Routing - Namespace Extraction
 *
 * Extracts namespace (tenant), resource type, and ID from request URLs.
 * Supports subdomain, path, and path-base routing patterns.
 *
 * @module workers/routing
 */

import type { RouteInfo } from './types'

/**
 * Parse route info from subdomain pattern
 *
 * Pattern: tenant.api.dotdo.dev/customers/123
 * Extracts: ns='tenant', type='customers', id='123'
 *
 * @param url - URL string or URL object
 * @param rootDomain - Root domain (e.g., 'api.dotdo.dev')
 * @returns Parsed route info or null if no subdomain match
 */
export function parseSubdomainRoute(url: string | URL, rootDomain: string): RouteInfo | null {
  const parsedUrl = typeof url === 'string' ? new URL(url) : url
  const hostname = parsedUrl.hostname

  // Check if hostname ends with the root domain
  if (!hostname.endsWith(rootDomain)) {
    return null
  }

  // Extract subdomain(s)
  const prefix = hostname.slice(0, hostname.length - rootDomain.length)

  // No subdomain (apex domain)
  if (!prefix || prefix === '.') {
    return null
  }

  // Remove trailing dot from prefix
  const subdomainPart = prefix.endsWith('.') ? prefix.slice(0, -1) : prefix

  // Get the first subdomain level only
  const subdomains = subdomainPart.split('.')
  const ns = subdomains[0]

  if (!ns) {
    return null
  }

  // Parse path
  const pathname = parsedUrl.pathname
  const pathSegments = pathname.split('/').filter(Boolean)

  const type = pathSegments[0] || undefined
  const id = pathSegments[1] || undefined

  // Build remaining path (everything after type/id)
  let remainingPath = ''
  if (pathSegments.length > 2) {
    remainingPath = '/' + pathSegments.slice(2).join('/')
  } else if (pathname === '/' && pathSegments.length === 0) {
    remainingPath = '/'
  }

  // Include query string in remaining path if present and type exists but no deep path
  const search = parsedUrl.search
  if (search && pathSegments.length <= 2) {
    remainingPath = remainingPath + search
  }

  return {
    ns,
    type,
    id,
    remainingPath,
  }
}

/**
 * Parse route info from path namespace pattern
 *
 * Pattern: api.dotdo.dev/tenant/customers/123
 * Extracts: ns='tenant', type='customers', id='123'
 *
 * @param url - URL string or URL object
 * @returns Parsed route info or null if invalid
 */
export function parsePathRoute(url: string | URL): RouteInfo | null {
  const parsedUrl = typeof url === 'string' ? new URL(url) : url
  const pathname = parsedUrl.pathname

  // Split path into segments
  const pathSegments = pathname.split('/').filter(Boolean)

  // Need at least one segment for namespace
  if (pathSegments.length === 0) {
    return null
  }

  const ns = pathSegments[0]
  const type = pathSegments[1] || undefined
  const id = pathSegments[2] || undefined

  // Build remaining path (everything after ns/type/id)
  let remainingPath = ''
  if (pathSegments.length > 3) {
    remainingPath = '/' + pathSegments.slice(3).join('/')
  }

  return {
    ns,
    type,
    id,
    remainingPath,
  }
}

/**
 * Parse route info from path base pattern
 *
 * Pattern: api.dotdo.dev/v1/tenant/customers/123
 * Supports version prefix before namespace
 *
 * @param url - URL string or URL object
 * @param basePath - Base path to strip (e.g., '/v1', '/api/v3')
 * @returns Parsed route info or null if base path doesn't match
 */
export function parsePathBaseRoute(url: string | URL, basePath: string): RouteInfo | null {
  const parsedUrl = typeof url === 'string' ? new URL(url) : url
  let pathname = parsedUrl.pathname

  // Normalize base path (remove trailing slash)
  const normalizedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath

  // Check if path starts with base path
  if (!pathname.startsWith(normalizedBase)) {
    return null
  }

  // Strip base path
  pathname = pathname.slice(normalizedBase.length)

  // If nothing left after stripping base, return null
  if (!pathname || pathname === '/') {
    return null
  }

  // Now parse as regular path route
  const pathSegments = pathname.split('/').filter(Boolean)

  if (pathSegments.length === 0) {
    return null
  }

  const ns = pathSegments[0]
  const type = pathSegments[1] || undefined
  const id = pathSegments[2] || undefined

  // Build remaining path
  let remainingPath = ''
  if (pathSegments.length > 3) {
    remainingPath = '/' + pathSegments.slice(3).join('/')
  }

  return {
    ns,
    type,
    id,
    remainingPath,
  }
}
