/**
 * Streaming core exports
 *
 * Stream infrastructure for Cloudflare Pipelines integration.
 */

// Stream bridge class
export { StreamBridge, createStreamEvent, DEFAULT_STREAM_CONFIG } from './stream'

// Stream types
export type {
  StreamConfig,
  StreamSink,
  StreamEvent,
  StreamOperation,
  StreamBridgeOptions,
} from './stream'

// Shard router for horizontal scaling
export { TraceAwareShardRouter, traceToShard } from '../shard-router'
export type { ShardConfig } from '../shard-router'
