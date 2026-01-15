/**
 * Trace-Aware Shard Router
 *
 * Production shard routing for horizontal scaling of high-volume tenants
 * with 100% trace locality guarantee. All events for a single trace are
 * routed to the same shard, enabling efficient trace-based queries.
 *
 * Architecture:
 * - Low-volume tenants: Single DO instance (ns)
 * - High-volume tenants: N shards (ns-shard-0, ns-shard-1, ...)
 * - Trace locality: Same trace_id always routes to same shard
 * - Query routing: Single shard with trace_id, scatter-gather without
 *
 * @example
 * ```typescript
 * import { TraceAwareShardRouter } from 'dotdo/streaming/shard-router'
 *
 * const router = new TraceAwareShardRouter({
 *   shardCount: 16,
 *   highVolumeTenants: new Set(['enterprise-acme']),
 * })
 *
 * // Write: route to specific shard
 * const shardId = router.getShardId('enterprise-acme', event.trace_id)
 * const stub = env.EventStreamDO.get(env.EventStreamDO.idFromName(shardId))
 * await stub.write(event)
 *
 * // Query with trace_id: efficient single-shard query
 * const shards = router.getQueryShards('enterprise-acme', 'trace-123')
 * // shards = ['enterprise-acme-shard-7'] (single shard)
 *
 * // Query without trace_id: scatter-gather across all shards
 * const allShards = router.getQueryShards('enterprise-acme')
 * // allShards = ['enterprise-acme-shard-0', ..., 'enterprise-acme-shard-15']
 * ```
 *
 * @module
 */

/**
 * Configuration for the shard router.
 */
export interface ShardConfig {
  /**
   * Number of shards for high-volume tenants.
   * @default 16
   */
  shardCount: number

  /**
   * Event count threshold to consider a tenant high-volume.
   * Used when highVolumeTenants set is not provided or tenant not in set.
   * @default 100_000
   */
  highVolumeThreshold: number

  /**
   * Pre-configured set of high-volume tenants.
   * Takes precedence over threshold-based detection.
   */
  highVolumeTenants?: Set<string>
}

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: ShardConfig = {
  shardCount: 16,
  highVolumeThreshold: 100_000,
}

/**
 * Deterministically map a trace ID to a shard number.
 *
 * Uses the first 4 hex characters of the trace ID to compute a consistent
 * shard assignment. This ensures all spans of a trace route to the same shard.
 *
 * @param traceId - The trace ID (hex string, e.g., 'abc123def456')
 * @param shardCount - Total number of shards
 * @returns Shard number (0 to shardCount-1)
 *
 * @example
 * ```typescript
 * const shard = traceToShard('abc123def456', 16)
 * // shard is consistently 11 for this trace
 * ```
 */
export function traceToShard(traceId: string, shardCount: number): number {
  // Use first 4 hex chars (16 bits) for distribution
  // Pad short IDs to ensure consistent behavior
  const prefix = traceId.slice(0, 4).padEnd(4, '0')
  const parsed = parseInt(prefix, 16)
  // Handle non-hex characters by using hash-based fallback
  if (Number.isNaN(parsed)) {
    // Simple hash for non-hex trace IDs
    let hash = 0
    for (let i = 0; i < traceId.length; i++) {
      hash = ((hash << 5) - hash + traceId.charCodeAt(i)) | 0
    }
    return Math.abs(hash) % shardCount
  }
  return parsed % shardCount
}

/**
 * Trace-aware shard router for horizontal scaling.
 *
 * Routes events to shards based on tenant volume and trace locality:
 * - Low-volume tenants use a single DO instance
 * - High-volume tenants are sharded across multiple DOs
 * - Same trace_id always routes to same shard (100% locality)
 *
 * @example
 * ```typescript
 * const router = new TraceAwareShardRouter({
 *   shardCount: 16,
 *   highVolumeTenants: new Set(['big-corp']),
 * })
 *
 * // Low-volume tenant
 * router.getShardId('startup', 'trace1')  // 'startup'
 *
 * // High-volume tenant
 * router.getShardId('big-corp', 'abc1')   // 'big-corp-shard-5'
 * router.getShardId('big-corp', 'abc1')   // 'big-corp-shard-5' (same)
 * ```
 */
export class TraceAwareShardRouter {
  private config: ShardConfig
  private eventCounts: Map<string, number> = new Map()

  /**
   * Create a new shard router.
   *
   * @param config - Partial configuration (defaults applied)
   */
  constructor(config?: Partial<ShardConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Check if a tenant is considered high-volume.
   *
   * A tenant is high-volume if:
   * 1. It's in the highVolumeTenants set, OR
   * 2. Its recorded event count exceeds highVolumeThreshold
   *
   * @param ns - Namespace (tenant identifier)
   * @returns true if tenant should use sharding
   */
  isHighVolume(ns: string): boolean {
    if (this.config.highVolumeTenants?.has(ns)) return true
    return (this.eventCounts.get(ns) ?? 0) >= this.config.highVolumeThreshold
  }

  /**
   * Get the shard ID for writing an event.
   *
   * - Low-volume tenants: returns `ns`
   * - High-volume tenants with trace_id: returns `ns-shard-N`
   * - High-volume tenants without trace_id: returns `ns-shard-0`
   *
   * @param ns - Namespace (tenant identifier)
   * @param traceId - Optional trace ID for deterministic routing
   * @returns Shard ID to use for DO lookup
   *
   * @example
   * ```typescript
   * const shardId = router.getShardId('tenant', 'abc123')
   * const id = env.DO.idFromName(shardId)
   * const stub = env.DO.get(id)
   * ```
   */
  getShardId(ns: string, traceId?: string): string {
    if (!this.isHighVolume(ns)) return ns
    if (!traceId) return `${ns}-shard-0`
    const shard = traceToShard(traceId, this.config.shardCount)
    return `${ns}-shard-${shard}`
  }

  /**
   * Get shard IDs for querying events.
   *
   * - Low-volume tenants: returns `[ns]`
   * - High-volume with trace_id: returns single shard (efficient)
   * - High-volume without trace_id: returns all shards (scatter-gather)
   *
   * @param ns - Namespace (tenant identifier)
   * @param traceId - Optional trace ID for single-shard query
   * @returns Array of shard IDs to query
   *
   * @example
   * ```typescript
   * // Efficient trace query (single shard)
   * const shards = router.getQueryShards('tenant', 'trace-123')
   *
   * // Scatter-gather query (all shards)
   * const allShards = router.getQueryShards('tenant')
   * const results = await Promise.all(
   *   allShards.map(s => env.DO.get(env.DO.idFromName(s)).query(sql))
   * )
   * ```
   */
  getQueryShards(ns: string, traceId?: string): string[] {
    if (!this.isHighVolume(ns)) return [ns]
    if (traceId) return [this.getShardId(ns, traceId)]
    return Array.from(
      { length: this.config.shardCount },
      (_, i) => `${ns}-shard-${i}`
    )
  }

  /**
   * Record an event for threshold-based high-volume detection.
   *
   * Call this when ingesting events to track tenant volume.
   * When count exceeds highVolumeThreshold, tenant is marked high-volume.
   *
   * @param ns - Namespace (tenant identifier)
   *
   * @example
   * ```typescript
   * // In event ingestion pipeline
   * router.recordEvent(event.ns)
   * const shardId = router.getShardId(event.ns, event.trace_id)
   * ```
   */
  recordEvent(ns: string): void {
    this.eventCounts.set(ns, (this.eventCounts.get(ns) ?? 0) + 1)
  }

  /**
   * Get the recorded event count for a tenant.
   *
   * @param ns - Namespace (tenant identifier)
   * @returns Event count (0 if not tracked)
   */
  getEventCount(ns: string): number {
    return this.eventCounts.get(ns) ?? 0
  }
}
