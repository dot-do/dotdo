/**
 * Replication - Read Replica Routing
 *
 * Implements read replica routing for horizontal scaling.
 * Routes reads to replicas and writes to primary.
 *
 * @module workers/replication
 */

import type { ReplicationConfig, RequestIntent, ReplicaRouter } from './types'

/**
 * Detect request intent (read vs write)
 *
 * @param request - Incoming request
 * @returns Intent: 'read', 'write', or 'unknown'
 */
export function detectIntent(request: Request): RequestIntent {
  // Check for explicit write intent header
  if (request.headers.get('X-Write-Intent') === 'true') {
    return 'write'
  }

  const method = request.method.toUpperCase()

  // Read methods
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return 'read'
  }

  // Write methods
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    return 'write'
  }

  return 'unknown'
}

/**
 * Create a replica router
 *
 * @param config - Replication configuration
 * @returns ReplicaRouter instance
 */
export function createReplicaRouter(config: ReplicationConfig): ReplicaRouter {
  let roundRobinCounter = 0

  function route(request: Request): { target: 'primary' | 'replica'; replicaIndex?: number } {
    // Check for consistency override in query string
    const url = new URL(request.url)
    const consistencyParam = url.searchParams.get('consistency')
    const consistencyHeader = request.headers.get('X-Consistency')

    const consistency = consistencyParam || consistencyHeader

    // Strong consistency forces primary
    if (consistency === 'strong') {
      return { target: 'primary' }
    }

    // Eventual consistency forces replica
    if (consistency === 'eventual') {
      const replicaIndex = roundRobinCounter % config.replicaCount
      roundRobinCounter++
      return { target: 'replica', replicaIndex }
    }

    // Detect intent
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

    // Unknown intent defaults to primary for safety
    return { target: 'primary' }
  }

  return { route }
}
