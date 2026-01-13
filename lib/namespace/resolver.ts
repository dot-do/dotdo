/**
 * Namespace resolution from HTTP requests
 *
 * Supports three resolution modes:
 * 1. Hostname-only (default): ns = origin
 * 2. Path pattern (e.g., '/:org'): ns = origin + extracted segments
 * 3. Fixed: ns = config.fixed value
 */

export interface NamespaceConfig {
  pattern?: string  // e.g., '/:org', '/:org/:project', or undefined for hostname-only
  fixed?: string    // fixed namespace value
}

export interface ResolvedNamespace {
  ns: string        // full namespace URL like "https://api.example.org.ai/acme"
  path: string      // remaining path after namespace extraction
}

/**
 * Cache for parsed pattern param counts
 * Key: pattern string, Value: number of params
 */
const patternParamCountCache = new Map<string, number>()

/**
 * Get the parameter count for a pattern, with caching
 * e.g., '/:org/:project' -> 2
 */
function getPatternParamCount(pattern: string): number {
  const cached = patternParamCountCache.get(pattern)
  if (cached !== undefined) {
    return cached
  }

  // Count param segments (those starting with ':')
  let count = 0
  const segments = pattern.split('/').filter(Boolean)
  for (const segment of segments) {
    if (segment.startsWith(':')) {
      count++
    }
  }

  patternParamCountCache.set(pattern, count)
  return count
}

/**
 * Build the remaining path from pathname, search, and hash
 */
function buildRemainingPath(pathname: string, search: string, hash: string): string {
  return pathname + search + hash
}

/**
 * Resolve namespace from a request based on configuration
 *
 * @param request - The incoming HTTP request
 * @param config - Optional namespace configuration
 * @returns Resolved namespace and remaining path
 */
export function resolveNamespace(request: Request, config?: NamespaceConfig): ResolvedNamespace {
  const url = new URL(request.url)

  // Fixed namespace takes precedence
  if (config?.fixed) {
    const path = buildRemainingPath(url.pathname || '/', url.search, url.hash)
    return {
      ns: config.fixed,
      path: path || '/',
    }
  }

  // Path pattern mode
  if (config?.pattern) {
    // Use cached param count instead of parsing every time
    const paramCount = getPatternParamCount(config.pattern)

    // Split pathname into segments
    const pathSegments = url.pathname.split('/').filter(Boolean)

    // Extract namespace segments
    const nsSegments = pathSegments.slice(0, paramCount)

    // Build namespace URL
    const ns = url.origin + '/' + nsSegments.join('/')

    // Build remaining path
    const remainingSegments = pathSegments.slice(paramCount)
    let remainingPath = '/' + remainingSegments.join('/')

    // Append search and hash
    remainingPath = buildRemainingPath(remainingPath, url.search, url.hash)

    return {
      ns,
      path: remainingPath || '/',
    }
  }

  // Hostname-only mode (default)
  const path = buildRemainingPath(url.pathname || '/', url.search, url.hash)
  return {
    ns: url.origin,
    path: path || '/',
  }
}
