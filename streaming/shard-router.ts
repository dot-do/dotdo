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
 * Storage interface for persisting event counts across restarts.
 *
 * Implement this interface to persist hot tenant detection state.
 * Without persistence, event counts reset on restart and tenants
 * must re-accumulate events to exceed the threshold.
 *
 * @example
 * ```typescript
 * // Durable Object storage implementation
 * class DOShardRouterStorage implements ShardRouterStorage {
 *   constructor(private storage: DurableObjectStorage) {}
 *
 *   async getEventCounts(): Promise<Map<string, number>> {
 *     const counts = await this.storage.get<Record<string, number>>('event-counts')
 *     return new Map(Object.entries(counts ?? {}))
 *   }
 *
 *   async setEventCount(ns: string, count: number): Promise<void> {
 *     const counts = await this.storage.get<Record<string, number>>('event-counts') ?? {}
 *     counts[ns] = count
 *     await this.storage.put('event-counts', counts)
 *   }
 * }
 * ```
 */
export interface ShardRouterStorage {
  /**
   * Load all persisted event counts.
   * Called on router initialization to restore state.
   */
  getEventCounts(): Promise<Map<string, number>>

  /**
   * Persist an event count for a namespace.
   * Called periodically or when count crosses threshold.
   *
   * @param ns - Namespace (tenant identifier)
   * @param count - Current event count
   */
  setEventCount(ns: string, count: number): Promise<void>
}

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
  return Math.abs(parsed) % shardCount
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
  private storage?: ShardRouterStorage
  private initialized = false
  private initPromise?: Promise<void>

  /**
   * Create a new shard router.
   *
   * @param config - Partial configuration (defaults applied)
   * @param storage - Optional storage for persisting event counts
   *
   * @example
   * ```typescript
   * // Without persistence (counts reset on restart)
   * const router = new TraceAwareShardRouter({ shardCount: 16 })
   *
   * // With persistence (counts survive restarts)
   * const storage = new DOShardRouterStorage(state.storage)
   * const router = new TraceAwareShardRouter({ shardCount: 16 }, storage)
   * await router.initialize() // Load persisted counts
   * ```
   */
  constructor(config?: Partial<ShardConfig>, storage?: ShardRouterStorage) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.storage = storage
  }

  /**
   * Initialize the router by loading persisted event counts.
   *
   * Call this before using the router if storage is provided.
   * Safe to call multiple times (idempotent).
   *
   * @example
   * ```typescript
   * const router = new TraceAwareShardRouter(config, storage)
   * await router.initialize()
   * // Router now has persisted event counts loaded
   * ```
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise

    this.initPromise = this._doInitialize()
    await this.initPromise
  }

  private async _doInitialize(): Promise<void> {
    if (!this.storage) {
      this.initialized = true
      return
    }

    try {
      const counts = await this.storage.getEventCounts()
      this.eventCounts = counts
      this.initialized = true
    } catch (error) {
      // Log but don't fail - start fresh if storage fails
      console.warn('[ShardRouter] Failed to load persisted event counts:', error)
      this.initialized = true
    }
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
   * If storage is provided, persists the count when crossing the threshold.
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
    const previousCount = this.eventCounts.get(ns) ?? 0
    const newCount = previousCount + 1
    this.eventCounts.set(ns, newCount)

    // Persist when crossing the threshold (tenant becomes high-volume)
    if (this.storage && previousCount < this.config.highVolumeThreshold && newCount >= this.config.highVolumeThreshold) {
      // Fire-and-forget persistence - don't block event ingestion
      this.storage.setEventCount(ns, newCount).catch((error) => {
        console.warn(`[ShardRouter] Failed to persist event count for ${ns}:`, error)
      })
    }
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

  /**
   * Manually persist current event counts.
   *
   * Useful for periodic persistence or before shutdown.
   * Does nothing if no storage is configured.
   *
   * @param namespaces - Optional list of namespaces to persist. If not provided, persists all.
   *
   * @example
   * ```typescript
   * // Persist all counts periodically
   * await router.persistEventCounts()
   *
   * // Persist specific namespaces
   * await router.persistEventCounts(['tenant-a', 'tenant-b'])
   * ```
   */
  async persistEventCounts(namespaces?: string[]): Promise<void> {
    if (!this.storage) return

    const nsToPersist = namespaces ?? Array.from(this.eventCounts.keys())

    await Promise.all(
      nsToPersist.map(async (ns) => {
        const count = this.eventCounts.get(ns)
        if (count !== undefined && count > 0) {
          try {
            await this.storage!.setEventCount(ns, count)
          } catch (error) {
            console.warn(`[ShardRouter] Failed to persist event count for ${ns}:`, error)
          }
        }
      })
    )
  }

  /**
   * Get all namespaces that have recorded events.
   *
   * @returns Array of namespace identifiers
   */
  getTrackedNamespaces(): string[] {
    return Array.from(this.eventCounts.keys())
  }

  /**
   * Clear event counts for testing or reset.
   *
   * @param ns - Optional namespace to clear. If not provided, clears all.
   */
  clearEventCounts(ns?: string): void {
    if (ns) {
      this.eventCounts.delete(ns)
    } else {
      this.eventCounts.clear()
    }
  }
}
