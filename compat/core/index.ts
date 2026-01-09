/**
 * Compat layer core exports
 *
 * Stream infrastructure for Cloudflare Pipelines integration.
 *
 * Note: Shard, Replica, Tier, and Vector infrastructure has been moved to db/core
 * @see db/core for ShardRouter, ReplicaManager, TierManager, VectorRouter
 */

// Stream types (local to stream.ts until moved to streaming/core)
export type {
  StreamConfig,
  StreamSink,
} from './stream'

// Stream bridge
export {
  StreamBridge,
  createStreamEvent,
  DEFAULT_STREAM_CONFIG,
} from './stream'
export type { StreamEvent, StreamOperation, StreamBridgeOptions } from './stream'

// Re-export db/core infrastructure for backwards compatibility
// This allows existing compat layer consumers to continue importing from here
export * from '../../db/core'
