/**
 * Compat layer core exports
 *
 * Stream infrastructure for Cloudflare Pipelines integration.
 *
 * Note: Shard, Replica, Tier, and Vector infrastructure has been moved to db/core
 * @see db/core for ShardManager, ReplicaManager, TierManager, VectorManager
 */

// Re-export streaming/core for backwards compatibility
export {
  StreamBridge,
  createStreamEvent,
  DEFAULT_STREAM_CONFIG,
} from '../../streaming/core'
export type {
  StreamConfig,
  StreamSink,
  StreamEvent,
  StreamOperation,
  StreamBridgeOptions,
} from '../../streaming/core'

// Re-export db/core infrastructure for backwards compatibility
// This allows existing compat layer consumers to continue importing from here
export * from '../../db/core'
