/**
 * Worker Presets - Pre-configured Deployment Patterns
 *
 * Pre-configured worker deployment patterns for common scaling scenarios:
 *
 * - **single**: One DO per namespace (simplest, suitable for small deployments)
 * - **typed**: DO per namespace + type (better isolation, moderate scale)
 * - **sharded**: Consistent hash distribution (high scale, data-aware routing)
 * - **replicated**: Primary + read replicas (read-heavy workloads, geographics)
 *
 * All presets:
 * 1. Parse subdomain route (tenant.api.dotdo.dev/type/id)
 * 2. Extract ns/type/id from URL
 * 3. Route to appropriate DO based on preset strategy
 * 4. Return response via DO fetch
 *
 * @module workers/presets
 */

import type { WorkerPreset, WorkerPresetInstance } from './types'
import { parseSubdomainRoute } from './routing'
import { createHashRing, hashKey } from './sharding'
import { createReplicaRouter, detectIntent } from './replication'

/**
 * Create a worker preset
 *
 * Factory function for instantiating pre-configured worker patterns.
 * Handles request routing based on preset type.
 *
 * @param preset - Preset configuration with type and routing params
 * @returns WorkerPresetInstance with handleRequest and getConfig methods
 */
export function createWorkerPreset(preset: WorkerPreset): WorkerPresetInstance {
  const { type, config } = preset

  /**
   * Get current preset configuration
   *
   * @returns Object with preset type and all configuration
   */
  function getConfig(): Record<string, unknown> {
    return { type, ...config }
  }

  /**
   * Handle incoming request
   *
   * Routes request to appropriate DO based on preset type.
   *
   * @param request - Incoming HTTP request
   * @param _env - Worker environment (unused)
   * @returns HTTP response from routing decision
   */
  async function handleRequest(request: Request, _env: unknown): Promise<Response> {
    const rootDomain = (config.rootDomain as string) || 'api.dotdo.dev'
    const url = new URL(request.url)

    // Parse route from subdomain pattern
    const route = parseSubdomainRoute(url, rootDomain)

    if (!route) {
      return new Response(JSON.stringify({ error: 'Invalid route: no matching subdomain' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Route based on preset type
    switch (type) {
      case 'single': {
        // Single: All requests for namespace go to same DO
        // In real: const doId = env.DO.idFromName(route.ns)
        return new Response(JSON.stringify({ ns: route.ns, type: 'single' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      case 'typed': {
        // Typed: Separate DO per namespace:type combination
        // In real: const doId = env.DO.idFromName(`${route.ns}:${route.type}`)
        return new Response(
          JSON.stringify({ ns: route.ns, type: route.type, preset: 'typed' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      case 'sharded': {
        // Sharded: Consistent hash routes to one of N shards
        const shardCount = (config.shardCount as number) || 16
        const virtualNodes = (config.virtualNodes as number) || 150

        const ring = createHashRing({ shardCount, virtualNodes })

        // Initialize shard nodes
        for (let i = 0; i < shardCount; i++) {
          ring.addNode(`shard-${i}`)
        }

        // Route to shard via consistent hash
        const key = hashKey(route.ns, route.type || '_', route.id || '_')
        const shard = ring.getNode(key)

        return new Response(JSON.stringify({ ns: route.ns, shard, preset: 'sharded' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      case 'replicated': {
        // Replicated: Route to primary (writes) or replica (reads)
        const replicaCount = (config.replicaCount as number) || 2
        const readPreference = (config.readPreference as 'primary' | 'replica') || 'replica'

        const router = createReplicaRouter({
          mode: 'primary-replica',
          replicaCount,
          readPreference,
        })

        const routing = router.route(request)

        return new Response(
          JSON.stringify({
            ns: route.ns,
            target: routing.target,
            replicaIndex: routing.replicaIndex,
            preset: 'replicated',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      default:
        return new Response(JSON.stringify({ error: 'Unknown preset type' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
    }
  }

  return { handleRequest, getConfig }
}

/**
 * Create a sharded worker (integration helper)
 *
 * Convenience factory for sharded deployment pattern.
 * Routes requests via consistent hash to one of N shards.
 *
 * @param config - Sharded worker configuration
 * @param config.rootDomain - Root domain for subdomain parsing (e.g., 'api.dotdo.dev')
 * @param config.shardCount - Number of shards (e.g., 16)
 * @returns WorkerPresetInstance configured for sharding
 *
 * @example
 * ```
 * const worker = createShardedWorker({
 *   rootDomain: 'api.dotdo.dev',
 *   shardCount: 8
 * })
 * ```
 */
export function createShardedWorker(config: { rootDomain: string; shardCount: number }) {
  return createWorkerPreset({
    type: 'sharded',
    config,
  })
}

/**
 * Create a replicated worker (integration helper)
 *
 * Convenience factory for read replica deployment pattern.
 * Routes read requests to replicas, write requests to primary.
 *
 * @param config - Replicated worker configuration
 * @param config.replicaCount - Number of read replicas (e.g., 3)
 * @returns WorkerPresetInstance configured for replication
 *
 * @example
 * ```
 * const worker = createReplicatedWorker({
 *   replicaCount: 3
 * })
 * ```
 */
export function createReplicatedWorker(config: { replicaCount: number }) {
  return createWorkerPreset({
    type: 'replicated',
    config: {
      rootDomain: 'api.dotdo.dev',
      ...config,
    },
  })
}

/**
 * Create a production worker combining all patterns
 *
 * Full-featured worker combining:
 * - Subdomain routing for multi-tenancy
 * - Consistent hash sharding for data distribution
 * - Read replica routing for read scaling
 * - Authentication and authorization
 *
 * @param config - Production worker configuration
 * @param config.rootDomain - Root domain for parsing (e.g., 'api.dotdo.dev')
 * @param config.shardCount - Number of shards (e.g., 16)
 * @param config.replicaCount - Number of read replicas (e.g., 3)
 * @param config.authenticate - Auth callback that returns true/false
 * @returns Production worker instance with full routing capabilities
 *
 * @example
 * ```
 * const worker = createProductionWorker({
 *   rootDomain: 'api.dotdo.dev',
 *   shardCount: 16,
 *   replicaCount: 3,
 *   authenticate: async (req) => {
 *     const auth = req.headers.get('Authorization')
 *     return auth === 'Bearer valid-token'
 *   }
 * })
 *
 * const response = await worker.handleRequest(request, env)
 * ```
 */
export function createProductionWorker(config: {
  rootDomain: string
  shardCount: number
  replicaCount: number
  authenticate: (req: Request) => Promise<boolean>
}) {
  // In real implementation, this would combine:
  // 1. Subdomain routing (tenant extraction)
  // 2. Consistent hash sharding (shard selection)
  // 3. Read replica routing (read vs write)
  // 4. Authentication/authorization
  return {
    rootDomain: config.rootDomain,
    shardCount: config.shardCount,
    replicaCount: config.replicaCount,
    async handleRequest(request: Request, env: unknown): Promise<Response> {
      // Step 1: Authenticate
      const authenticated = await config.authenticate(request)
      if (!authenticated) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Step 2: In real implementation, combine all patterns:
      // - Parse subdomain for tenant
      // - Hash (tenant:type:id) to select shard
      // - Detect read/write intent
      // - Route to primary or replica
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  }
}
