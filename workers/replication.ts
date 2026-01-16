/**
 * Replication - Read Replica Routing
 *
 * Implements read replica routing for horizontal scaling.
 * Routes reads to replicas and writes to primary.
 *
 * Provides:
 * - Intent detection (read vs write) via HTTP method + headers
 * - Replica routing with round-robin load balancing
 * - Consistency override via query string or headers
 *
 * @module workers/replication
 */

import type { ReplicationConfig, RequestIntent, ReplicaRouter } from './types'

// ============================================================================
// Intent Detection Constants
// ============================================================================

/** HTTP methods that are considered read operations */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** HTTP methods that are considered write operations */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Header for explicit write intent override */
const WRITE_INTENT_HEADER = 'X-Write-Intent'

/** Consistency level parameter values */
const CONSISTENCY_STRONG = 'strong'
const CONSISTENCY_EVENTUAL = 'eventual'

// ============================================================================
// Intent Detection
// ============================================================================

/**
 * Detect request intent (read vs write)
 *
 * Detection logic (in priority order):
 * 1. Explicit X-Write-Intent header overrides all
 * 2. HTTP method classification (GET/HEAD/OPTIONS = read, POST/PUT/PATCH/DELETE = write)
 * 3. Unknown methods return 'unknown' for safe handling
 *
 * @param request - Incoming request
 * @returns Intent: 'read', 'write', or 'unknown'
 *
 * @example
 * ```
 * const intent = detectIntent(new Request('http://example.com', { method: 'GET' }))
 * expect(intent).toBe('read')
 * ```
 */
export function detectIntent(request: Request): RequestIntent {
  // Explicit write intent header takes precedence
  if (request.headers.get(WRITE_INTENT_HEADER) === 'true') {
    return 'write'
  }

  const method = request.method.toUpperCase()

  // Classify by HTTP method
  if (READ_METHODS.has(method)) {
    return 'read'
  }

  if (WRITE_METHODS.has(method)) {
    return 'write'
  }

  // Unknown methods default to safe (primary)
  return 'unknown'
}

/**
 * Create a replica router
 *
 * Routing logic (in priority order):
 * 1. Explicit consistency override (?consistency=strong|eventual)
 * 2. Request intent detection (read vs write)
 * 3. Read preference configuration
 * 4. Round-robin load balancing for replicas
 *
 * @param config - Replication configuration
 * @returns ReplicaRouter instance with route() method
 *
 * @example
 * ```
 * const router = createReplicaRouter({
 *   mode: 'primary-replica',
 *   replicaCount: 3,
 *   readPreference: 'replica'
 * })
 *
 * const route = router.route(request)
 * // Returns: { target: 'replica', replicaIndex: 0 } for GET requests
 * // Returns: { target: 'primary' } for POST/PUT/DELETE requests
 * ```
 */
export function createReplicaRouter(config: ReplicationConfig): ReplicaRouter {
  let roundRobinCounter = 0

  /**
   * Route a request to primary or replica
   *
   * @param request - Incoming request
   * @returns Routing decision with target and optional replicaIndex
   */
  function route(request: Request): { target: 'primary' | 'replica'; replicaIndex?: number } {
    // Priority 1: Check for explicit consistency override
    try {
      const url = new URL(request.url)
      const consistencyParam = url.searchParams.get('consistency')
      const consistencyHeader = request.headers.get('X-Consistency')
      const consistency = consistencyParam || consistencyHeader

      if (consistency === CONSISTENCY_STRONG) {
        return { target: 'primary' }
      }

      if (consistency === CONSISTENCY_EVENTUAL) {
        const replicaIndex = roundRobinCounter % config.replicaCount
        roundRobinCounter++
        return { target: 'replica', replicaIndex }
      }
    } catch (err) {
      // URL header parsing failed - continue with intent-based routing
      console.debug(
        '[replication] URL/header parsing failed, falling back to intent-based routing:',
        'error:', err instanceof Error ? err.message : String(err),
        'url:', request.url.substring(0, 100)
      )
    }

    // Priority 2: Detect request intent
    const intent = detectIntent(request)

    // Writes always go to primary
    if (intent === 'write') {
      return { target: 'primary' }
    }

    // Reads follow read preference
    if (intent === 'read') {
      if (config.readPreference === 'primary') {
        return { target: 'primary' }
      }

      // Route to replica with round-robin load balancing
      const replicaIndex = roundRobinCounter % config.replicaCount
      roundRobinCounter++
      return { target: 'replica', replicaIndex }
    }

    // Priority 3: Unknown intent defaults to primary for safety
    return { target: 'primary' }
  }

  return { route }
}
