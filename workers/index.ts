/**
 * Worker Layer - Main Exports
 *
 * Deployment patterns for routing, sharding, and replication.
 *
 * @module workers
 */

// Types
export * from './types'

// Routing
export { parseSubdomainRoute, parsePathRoute, parsePathBaseRoute } from './routing'

// Sharding
export { createHashRing, hashKey } from './sharding'

// Replication
export { detectIntent, createReplicaRouter } from './replication'

// RPC Proxy
export { createRPCProxy } from './rpc-proxy'

// Presets
export {
  createWorkerPreset,
  createShardedWorker,
  createReplicatedWorker,
  createProductionWorker,
} from './presets'
