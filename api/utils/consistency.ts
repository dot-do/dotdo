type ConsistencyMode = 'strong' | 'eventual' | 'causal'

interface NounConfig {
  consistencyMode?: ConsistencyMode
  [key: string]: unknown
}

/**
 * Parse the consistency mode from request or noun config.
 * Priority: request header > query param > noun config > default 'eventual'
 */
export function parseConsistencyMode(
  request: Request,
  nounConfig?: NounConfig,
): ConsistencyMode {
  // Check X-Consistency-Mode header
  const headerMode = request.headers.get('X-Consistency-Mode')
  if (headerMode && isValidConsistencyMode(headerMode)) {
    return headerMode as ConsistencyMode
  }

  // Check query param
  const url = new URL(request.url)
  const paramMode = url.searchParams.get('consistency')
  if (paramMode && isValidConsistencyMode(paramMode)) {
    return paramMode as ConsistencyMode
  }

  // Noun config default
  if (nounConfig?.consistencyMode) {
    return nounConfig.consistencyMode
  }

  // Default
  return 'eventual'
}

function isValidConsistencyMode(mode: string): boolean {
  return ['strong', 'eventual', 'causal'].includes(mode)
}

/**
 * Determine if a request should route to a replica.
 * Only GET requests with eventual consistency route to replicas.
 */
export function shouldRouteToReplica(
  method: string,
  consistencyMode: ConsistencyMode,
): boolean {
  // Write operations always go to primary
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase())) {
    return false
  }

  // Only eventual consistency routes to replicas
  return method.toUpperCase() === 'GET' && consistencyMode === 'eventual'
}
