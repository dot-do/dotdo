/**
 * Worker Presets - Pre-configured Deployment Patterns
 *
 * Pre-configured worker deployment patterns for common use cases.
 * - single: one DO per namespace
 * - typed: DO per type
 * - sharded: consistent hash distribution
 * - replicated: primary + read replicas
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
 * @param preset - Preset configuration
 * @returns WorkerPresetInstance
 */
export function createWorkerPreset(preset: WorkerPreset): WorkerPresetInstance {
  const { type, config } = preset

  function getConfig(): Record<string, unknown> {
    return { type, ...config }
  }

  async function handleRequest(request: Request, _env: unknown): Promise<Response> {
    const rootDomain = (config.rootDomain as string) || 'api.dotdo.dev'
    const url = new URL(request.url)

    // Parse route
    const route = parseSubdomainRoute(url, rootDomain)

    if (!route) {
      return new Response(JSON.stringify({ error: 'Invalid route' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Different routing logic based on preset type
    switch (type) {
      case 'single': {
        // All requests for a namespace go to same DO
        // In real implementation: const doId = env.DO.idFromName(route.ns)
        return new Response(JSON.stringify({ ns: route.ns, type: 'single' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      case 'typed': {
        // Different DOs for different types
        // In real implementation: const doId = env.DO.idFromName(`${route.ns}:${route.type}`)
        return new Response(
          JSON.stringify({ ns: route.ns, type: route.type, preset: 'typed' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      case 'sharded': {
        // Consistent hash to select shard
        const shardCount = (config.shardCount as number) || 16
        const virtualNodes = (config.virtualNodes as number) || 150

        const ring = createHashRing({ shardCount, virtualNodes })

        // Add shard nodes
        for (let i = 0; i < shardCount; i++) {
          ring.addNode(`shard-${i}`)
        }

        // Route to shard
        const key = hashKey(route.ns, route.type || '_', route.id || '_')
        const shard = ring.getNode(key)

        return new Response(JSON.stringify({ ns: route.ns, shard, preset: 'sharded' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      case 'replicated': {
        // Route based on read/write intent
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
 */
export function createShardedWorker(config: { rootDomain: string; shardCount: number }) {
  return createWorkerPreset({
    type: 'sharded',
    config,
  })
}

/**
 * Create a replicated worker (integration helper)
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
 */
export function createProductionWorker(config: {
  rootDomain: string
  shardCount: number
  replicaCount: number
  authenticate: (req: Request) => Promise<boolean>
}) {
  // This would combine sharding + replication in real implementation
  return {
    rootDomain: config.rootDomain,
    shardCount: config.shardCount,
    replicaCount: config.replicaCount,
    async handleRequest(request: Request, env: unknown): Promise<Response> {
      // Authentication
      const authenticated = await config.authenticate(request)
      if (!authenticated) {
        return new Response('Unauthorized', { status: 401 })
      }

      // In real implementation: combine routing, sharding, and replication
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  }
}
