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
 * Parse a path pattern to extract parameter names
 * e.g., '/:org/:project' -> ['org', 'project']
 */
function parsePattern(pattern: string): string[] {
  const params: string[] = []
  const segments = pattern.split('/').filter(Boolean)

  for (const segment of segments) {
    if (segment.startsWith(':')) {
      params.push(segment.slice(1))
    }
  }

  return params
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
    const paramNames = parsePattern(config.pattern)
    const paramCount = paramNames.length

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
