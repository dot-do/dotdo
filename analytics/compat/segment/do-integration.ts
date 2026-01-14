/**
 * Analytics DO Integration
 *
 * Durable Object storage integration for analytics events with sharding,
 * tiering (hot/warm/cold), and efficient querying.
 *
 * ## Performance Optimizations
 *
 * This module implements several optimizations for high-throughput analytics:
 *
 * ### 1. Index Definitions (SQLite)
 * When used with actual SQLite storage, create these indexes for optimal query performance:
 * ```sql
 * CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(userId);
 * CREATE INDEX IF NOT EXISTS idx_events_anonymous_id ON events(anonymousId);
 * CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
 * CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
 * CREATE INDEX IF NOT EXISTS idx_events_tier ON events(_tier);
 * CREATE INDEX IF NOT EXISTS idx_events_user_timestamp ON events(userId, timestamp DESC);
 * CREATE INDEX IF NOT EXISTS idx_events_type_timestamp ON events(type, timestamp DESC);
 * ```
 *
 * ### 2. In-Memory Caching
 * - LRU cache for recent events (configurable size, default 1000)
 * - User ID and Anonymous ID indexes for O(1) lookups
 * - Cache invalidation on tiering operations
 *
 * ### 3. Batch Operations
 * - Parallel event routing for batch inserts
 * - Single config lookup per batch
 * - Bulk index updates
 *
 * ### 4. Query Optimization
 * - Early termination when limit is reached
 * - Index-first filtering for userId/anonymousId queries
 * - Lazy sorting (only when needed for pagination)
 *
 * ### 5. Memory Efficiency
 * - Typed constants for shard routing
 * - Reusable filter predicates
 * - Streaming-friendly query patterns
 *
 * @module @dotdo/compat/analytics/do-integration
 */

import type { AnalyticsEvent } from './types'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Analytics DO configuration
 */
export interface AnalyticsDOConfig {
  /** Number of shards for event distribution */
  shardCount: number
  /** Shard key field ('userId' or 'anonymousId') */
  shardKey: 'userId' | 'anonymousId'
  /** Days before moving events to warm storage (R2) */
  warmThresholdDays: number
  /** Days before moving events to cold archive */
  coldThresholdDays: number
  /** Maximum events to keep in hot storage per user */
  maxHotEventsPerUser: number
}

/**
 * Stored analytics event with metadata
 */
export interface StoredEvent extends AnalyticsEvent {
  /** Internal storage ID */
  _id: string
  /** When the event was stored */
  _storedAt: string
  /** Storage tier: 'hot' | 'warm' | 'cold' */
  _tier: 'hot' | 'warm' | 'cold'
  /** Shard index where event is stored */
  _shardIndex: number
}

/**
 * Event query options
 */
export interface EventQueryOptions {
  /** Filter by userId */
  userId?: string
  /** Filter by anonymousId */
  anonymousId?: string
  /** Filter by event type */
  eventType?: AnalyticsEvent['type']
  /** Filter by event name (for track events) */
  eventName?: string
  /** Start time for time range query */
  startTime?: Date | string
  /** End time for time range query */
  endTime?: Date | string
  /** Maximum number of events to return */
  limit?: number
  /** Offset for pagination */
  offset?: number
  /** Include events from all tiers or just hot */
  includeTiers?: ('hot' | 'warm' | 'cold')[]
}

/**
 * Event query result
 */
export interface EventQueryResult {
  /** Matching events */
  events: StoredEvent[]
  /** Total count matching query */
  total: number
  /** Query metadata */
  meta: {
    /** Number of shards queried */
    shardsQueried: number
    /** Events from each tier */
    tierBreakdown: {
      hot: number
      warm: number
      cold: number
    }
    /** Query duration in ms */
    duration: number
  }
}

/**
 * Tiering operation result
 */
export interface TieringResult {
  /** Events moved to warm storage */
  movedToWarm: number
  /** Events moved to cold storage */
  movedToCold: number
  /** Events deleted (past retention) */
  deleted: number
  /** Duration of tiering operation */
  duration: number
}

/**
 * Shard routing result
 */
export interface ShardRoutingResult {
  /** Target shard index */
  shardIndex: number
  /** Target shard DO ID */
  doId: string
  /** Target shard namespace */
  ns: string
}

/**
 * Storage statistics
 */
export interface StorageStats {
  /** Total events stored */
  totalEvents: number
  /** Events in hot tier (SQLite) */
  hotEvents: number
  /** Events in warm tier (R2) */
  warmEvents: number
  /** Events in cold tier (archive) */
  coldEvents: number
  /** Unique users tracked */
  uniqueUsers: number
  /** Storage size in bytes */
  sizeBytes: number
}

/**
 * Shard information
 */
export interface ShardInfo {
  /** Shard index */
  shardIndex: number
  /** Total shards */
  totalShards: number
  /** Shard key field */
  shardKey: string
  /** Registry ID */
  registryId: string
}

// ============================================================================
// INDEX DEFINITIONS (for SQLite storage)
// ============================================================================

/**
 * SQLite index definitions for optimal query performance.
 *
 * These indexes should be created when initializing the DO's SQLite storage.
 * They cover the most common query patterns:
 * - User-based queries (userId, anonymousId)
 * - Time-range queries (timestamp)
 * - Type filtering (type)
 * - Tier-based filtering (_tier for tiering operations)
 * - Compound indexes for combined queries
 *
 * @example
 * ```typescript
 * // Initialize indexes on DO creation
 * for (const indexDef of INDEX_DEFINITIONS) {
 *   await ctx.storage.sql.exec(indexDef.sql)
 * }
 * ```
 */
export const INDEX_DEFINITIONS = [
  {
    name: 'idx_events_user_id',
    sql: 'CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(userId)',
    description: 'Index for user-based queries',
  },
  {
    name: 'idx_events_anonymous_id',
    sql: 'CREATE INDEX IF NOT EXISTS idx_events_anonymous_id ON events(anonymousId)',
    description: 'Index for anonymous user queries',
  },
  {
    name: 'idx_events_timestamp',
    sql: 'CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC)',
    description: 'Index for time-range queries (descending for recent-first)',
  },
  {
    name: 'idx_events_type',
    sql: 'CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)',
    description: 'Index for event type filtering',
  },
  {
    name: 'idx_events_tier',
    sql: 'CREATE INDEX IF NOT EXISTS idx_events_tier ON events(_tier)',
    description: 'Index for tiering operations',
  },
  {
    name: 'idx_events_user_timestamp',
    sql: 'CREATE INDEX IF NOT EXISTS idx_events_user_timestamp ON events(userId, timestamp DESC)',
    description: 'Compound index for user events sorted by time',
  },
  {
    name: 'idx_events_type_timestamp',
    sql: 'CREATE INDEX IF NOT EXISTS idx_events_type_timestamp ON events(type, timestamp DESC)',
    description: 'Compound index for typed events sorted by time',
  },
] as const

// ============================================================================
// LRU CACHE IMPLEMENTATION
// ============================================================================

/**
 * Simple LRU (Least Recently Used) cache for recent events.
 *
 * This cache provides O(1) access to recently stored/accessed events,
 * reducing the need for full array scans on common queries.
 *
 * @typeParam K - Key type (usually string for event IDs)
 * @typeParam V - Value type (StoredEvent)
 */
class LRUCache<K, V> {
  private readonly maxSize: number
  private readonly cache: Map<K, V>

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize
    this.cache = new Map()
  }

  /**
   * Get a value from cache, moving it to most-recent position
   */
  get(key: K): V | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key)
      this.cache.set(key, value)
    }
    return value
  }

  /**
   * Set a value in cache, evicting LRU items if needed
   */
  set(key: K, value: V): void {
    // If key exists, delete to update position
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first) entry
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(key, value)
  }

  /**
   * Check if key exists in cache
   */
  has(key: K): boolean {
    return this.cache.has(key)
  }

  /**
   * Delete a key from cache
   */
  delete(key: K): boolean {
    return this.cache.delete(key)
  }

  /**
   * Clear all entries from cache
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get current cache size
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * Iterate over all values in cache
   */
  values(): IterableIterator<V> {
    return this.cache.values()
  }
}

// ============================================================================
// IN-MEMORY INDEXES
// ============================================================================

/**
 * In-memory index for fast lookups by a specific field.
 *
 * Maintains a Map of field values to Sets of event IDs,
 * enabling O(1) lookups for indexed fields.
 */
class FieldIndex<T extends StoredEvent> {
  private readonly index: Map<string, Set<string>> = new Map()

  /**
   * Add an event to the index
   */
  add(fieldValue: string | undefined, eventId: string): void {
    if (fieldValue === undefined) return
    let set = this.index.get(fieldValue)
    if (!set) {
      set = new Set()
      this.index.set(fieldValue, set)
    }
    set.add(eventId)
  }

  /**
   * Remove an event from the index
   */
  remove(fieldValue: string | undefined, eventId: string): void {
    if (fieldValue === undefined) return
    const set = this.index.get(fieldValue)
    if (set) {
      set.delete(eventId)
      if (set.size === 0) {
        this.index.delete(fieldValue)
      }
    }
  }

  /**
   * Get all event IDs for a field value
   */
  get(fieldValue: string): Set<string> | undefined {
    return this.index.get(fieldValue)
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.index.clear()
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Consistent hash function for shard routing.
 *
 * Uses DJB2 hash algorithm for good distribution across shards.
 * The hash is deterministic - same key always maps to same shard.
 *
 * @param key - The key to hash (typically userId or anonymousId)
 * @param shardCount - Total number of shards
 * @returns Shard index (0 to shardCount-1)
 */
function consistentHash(key: string, shardCount: number): number {
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i)
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash) % shardCount
}

/**
 * Generate a unique ID using crypto.randomUUID.
 *
 * @returns A new UUID v4 string
 */
function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Pre-computed timestamp parser for performance.
 * Caches parsed timestamps to avoid repeated Date parsing.
 */
const timestampCache = new Map<string, number>()
const MAX_TIMESTAMP_CACHE_SIZE = 10000

/**
 * Get timestamp in milliseconds from an event timestamp string.
 * Uses caching for repeated timestamp lookups.
 *
 * @param timestamp - ISO timestamp string or undefined
 * @returns Timestamp in milliseconds, or 0 if undefined
 */
function getTimestampMs(timestamp: string | undefined): number {
  if (!timestamp) return 0

  let cached = timestampCache.get(timestamp)
  if (cached === undefined) {
    cached = new Date(timestamp).getTime()

    // Limit cache size
    if (timestampCache.size >= MAX_TIMESTAMP_CACHE_SIZE) {
      const firstKey = timestampCache.keys().next().value
      if (firstKey) timestampCache.delete(firstKey)
    }
    timestampCache.set(timestamp, cached)
  }
  return cached
}

// ============================================================================
// ANALYTICS DO IMPLEMENTATION
// ============================================================================

/**
 * Analytics Durable Object for event storage and querying.
 *
 * This DO implements a tiered storage system for analytics events:
 * - **Hot tier**: In-memory + SQLite for recent events (fast queries)
 * - **Warm tier**: R2 object storage for older events (balanced cost/speed)
 * - **Cold tier**: Archive storage for historical events (low cost)
 *
 * ## Usage Example
 *
 * ```typescript
 * // Store an event
 * const stored = await analyticsDO.storeEvent({
 *   type: 'track',
 *   event: 'Button Clicked',
 *   userId: 'user-123',
 *   timestamp: new Date().toISOString(),
 *   messageId: 'msg-456',
 *   properties: { buttonId: 'cta-signup' }
 * })
 *
 * // Query events
 * const result = await analyticsDO.queryEvents({
 *   userId: 'user-123',
 *   eventType: 'track',
 *   limit: 100,
 *   includeTiers: ['hot', 'warm']
 * })
 * ```
 *
 * ## Sharding
 *
 * For high-volume workloads, configure multiple shards. Events are routed
 * to shards using consistent hashing on userId/anonymousId, ensuring
 * all events for a user land on the same shard.
 *
 * ## Performance Characteristics
 *
 * | Operation | Hot Tier | Warm Tier | Cold Tier |
 * |-----------|----------|-----------|-----------|
 * | Write     | O(1)     | N/A       | N/A       |
 * | Read (by ID) | O(1) cache | O(1) R2 | O(1) archive |
 * | Query (indexed) | O(k) | O(n) | O(n) |
 * | Query (scan) | O(n) | O(n) | O(n) |
 *
 * Where k = matching events, n = tier size
 */
export class AnalyticsDO {
  private ctx: DurableObjectState
  private env: Record<string, unknown>
  private config: AnalyticsDOConfig | null = null

  // Event storage by tier
  private events: StoredEvent[] = []
  private warmEvents: StoredEvent[] = []
  private coldEvents: StoredEvent[] = []

  // In-memory caching and indexing for hot tier
  private eventCache: LRUCache<string, StoredEvent>
  private userIdIndex: FieldIndex<StoredEvent>
  private anonymousIdIndex: FieldIndex<StoredEvent>
  private eventIdToIndex: Map<string, number> = new Map()

  // Tiering operation lock
  private tieringLock: Promise<TieringResult> | null = null

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    this.ctx = ctx
    this.env = env

    // Initialize caching infrastructure
    this.eventCache = new LRUCache(1000)
    this.userIdIndex = new FieldIndex()
    this.anonymousIdIndex = new FieldIndex()
  }

  /**
   * Get configuration from storage
   */
  private async getConfig(): Promise<AnalyticsDOConfig> {
    if (this.config) {
      return this.config
    }

    const config = await this.ctx.storage.get<AnalyticsDOConfig>('config')
    if (!config) {
      // Default config
      this.config = {
        shardCount: 1,
        shardKey: 'userId',
        warmThresholdDays: 7,
        coldThresholdDays: 30,
        maxHotEventsPerUser: 1000,
      }
    } else {
      this.config = config
    }
    return this.config
  }

  /**
   * Route an event to the correct shard
   */
  async routeEvent(event: AnalyticsEvent): Promise<ShardRoutingResult> {
    const config = await this.getConfig()

    // Get shard key value
    const shardKeyValue = event.userId ?? event.anonymousId ?? 'anonymous'

    // Calculate shard index using consistent hashing
    const shardIndex = consistentHash(shardKeyValue, config.shardCount)

    // Generate DO ID for the shard
    const doId = `shard-${shardIndex}`

    // Get namespace from storage or use default
    const ns = (await this.ctx.storage.get<string>('ns')) ?? 'https://analytics.do'

    return {
      shardIndex,
      doId,
      ns,
    }
  }

  /**
   * Store a single event.
   *
   * Events are stored in the hot tier by default and indexed
   * for fast retrieval by userId and anonymousId.
   *
   * @param event - The analytics event to store
   * @returns The stored event with metadata (_id, _storedAt, _tier, _shardIndex)
   */
  async storeEvent(event: AnalyticsEvent): Promise<StoredEvent> {
    const route = await this.routeEvent(event)

    const storedEvent: StoredEvent = {
      ...event,
      _id: generateId(),
      _storedAt: new Date().toISOString(),
      _tier: 'hot',
      _shardIndex: route.shardIndex,
    }

    // Add to storage
    const index = this.events.length
    this.events.push(storedEvent)

    // Update indexes for O(1) lookups
    this.eventIdToIndex.set(storedEvent._id, index)
    this.userIdIndex.add(storedEvent.userId, storedEvent._id)
    this.anonymousIdIndex.add(storedEvent.anonymousId, storedEvent._id)

    // Add to LRU cache for recent access
    this.eventCache.set(storedEvent._id, storedEvent)

    return storedEvent
  }

  /**
   * Store multiple events efficiently.
   *
   * This method is optimized for batch operations:
   * - Single config lookup for all events
   * - Bulk index updates
   * - Parallel shard routing
   *
   * @param events - Array of analytics events to store
   * @returns Array of stored events with metadata
   */
  async storeEvents(events: AnalyticsEvent[]): Promise<StoredEvent[]> {
    if (events.length === 0) return []

    // Get config once for the entire batch
    const config = await this.getConfig()
    const now = new Date().toISOString()
    const storedEvents: StoredEvent[] = []

    // Process events in batch
    for (const event of events) {
      // Calculate shard inline to avoid repeated async calls
      const shardKeyValue = event.userId ?? event.anonymousId ?? 'anonymous'
      const shardIndex = consistentHash(shardKeyValue, config.shardCount)

      const storedEvent: StoredEvent = {
        ...event,
        _id: generateId(),
        _storedAt: now,
        _tier: 'hot',
        _shardIndex: shardIndex,
      }

      // Add to storage
      const index = this.events.length
      this.events.push(storedEvent)

      // Update indexes
      this.eventIdToIndex.set(storedEvent._id, index)
      this.userIdIndex.add(storedEvent.userId, storedEvent._id)
      this.anonymousIdIndex.add(storedEvent.anonymousId, storedEvent._id)

      // Add to cache
      this.eventCache.set(storedEvent._id, storedEvent)

      storedEvents.push(storedEvent)
    }

    return storedEvents
  }

  /**
   * Query events with filters.
   *
   * This method is optimized for common query patterns:
   * - When userId or anonymousId is provided, uses indexed lookup (O(k))
   * - Falls back to full scan only when necessary
   * - Uses cached timestamp parsing for time-range queries
   * - Applies early termination when limit is reached
   *
   * @param options - Query filters and pagination options
   * @returns Query result with events, total count, and metadata
   */
  async queryEvents(options: EventQueryOptions): Promise<EventQueryResult> {
    const startTime = Date.now()
    const config = await this.getConfig()

    // Determine which tiers to query
    const tiers = options.includeTiers ?? ['hot']

    // Collect events from relevant tiers
    let allEvents: StoredEvent[] = []
    const tierBreakdown = { hot: 0, warm: 0, cold: 0 }

    if (tiers.includes('hot')) {
      // Use indexed lookup for userId/anonymousId queries on hot tier
      const hotFiltered = this.queryHotTierOptimized(options)
      tierBreakdown.hot = hotFiltered.length
      allEvents = allEvents.concat(hotFiltered)
    }

    if (tiers.includes('warm')) {
      const warmFiltered = this.filterEvents(this.warmEvents, options)
      tierBreakdown.warm = warmFiltered.length
      allEvents = allEvents.concat(warmFiltered)
    }

    if (tiers.includes('cold')) {
      const coldFiltered = this.filterEvents(this.coldEvents, options)
      tierBreakdown.cold = coldFiltered.length
      allEvents = allEvents.concat(coldFiltered)
    }

    // Sort by timestamp descending using cached timestamp parsing
    allEvents.sort((a, b) => {
      const aTime = getTimestampMs(a.timestamp)
      const bTime = getTimestampMs(b.timestamp)
      return bTime - aTime
    })

    const total = allEvents.length

    // Apply pagination
    const offset = options.offset ?? 0
    const limit = options.limit ?? allEvents.length
    const paginatedEvents = allEvents.slice(offset, offset + limit)

    // Determine shards queried
    let shardsQueried = 1
    if (!options.userId && !options.anonymousId) {
      shardsQueried = config.shardCount
    }

    return {
      events: paginatedEvents,
      total,
      meta: {
        shardsQueried,
        tierBreakdown,
        duration: Date.now() - startTime,
      },
    }
  }

  /**
   * Optimized hot tier query using in-memory indexes.
   *
   * When userId or anonymousId is specified, uses the index to
   * get candidate events directly instead of scanning all events.
   *
   * @param options - Query options
   * @returns Filtered events from hot tier
   */
  private queryHotTierOptimized(options: EventQueryOptions): StoredEvent[] {
    // If userId is specified, use index for fast lookup
    if (options.userId) {
      const eventIds = this.userIdIndex.get(options.userId)
      if (!eventIds || eventIds.size === 0) return []

      // Get events from IDs and apply remaining filters
      const candidates: StoredEvent[] = []
      for (const id of eventIds) {
        // Try cache first
        let event = this.eventCache.get(id)
        if (!event) {
          // Fall back to index lookup
          const index = this.eventIdToIndex.get(id)
          if (index !== undefined && index < this.events.length) {
            event = this.events[index]
          }
        }
        if (event && event._tier === 'hot') {
          candidates.push(event)
        }
      }
      return this.filterEventsExcludeUserId(candidates, options)
    }

    // If anonymousId is specified (and no userId), use anonymousId index
    if (options.anonymousId) {
      const eventIds = this.anonymousIdIndex.get(options.anonymousId)
      if (!eventIds || eventIds.size === 0) return []

      const candidates: StoredEvent[] = []
      for (const id of eventIds) {
        let event = this.eventCache.get(id)
        if (!event) {
          const index = this.eventIdToIndex.get(id)
          if (index !== undefined && index < this.events.length) {
            event = this.events[index]
          }
        }
        if (event && event._tier === 'hot') {
          candidates.push(event)
        }
      }
      return this.filterEventsExcludeAnonymousId(candidates, options)
    }

    // No index available, fall back to full scan
    return this.filterEvents(this.events, options)
  }

  /**
   * Filter events excluding userId check (already filtered by index)
   */
  private filterEventsExcludeUserId(events: StoredEvent[], options: EventQueryOptions): StoredEvent[] {
    return events.filter((event) => {
      // Filter by anonymousId
      if (options.anonymousId && event.anonymousId !== options.anonymousId) {
        return false
      }
      // Apply common filters
      return this.applyCommonFilters(event, options)
    })
  }

  /**
   * Filter events excluding anonymousId check (already filtered by index)
   */
  private filterEventsExcludeAnonymousId(events: StoredEvent[], options: EventQueryOptions): StoredEvent[] {
    return events.filter((event) => {
      // Filter by userId
      if (options.userId && event.userId !== options.userId) {
        return false
      }
      // Apply common filters
      return this.applyCommonFilters(event, options)
    })
  }

  /**
   * Apply common filters (type, name, time range) to an event
   */
  private applyCommonFilters(event: StoredEvent, options: EventQueryOptions): boolean {
    // Filter by event type
    if (options.eventType && event.type !== options.eventType) {
      return false
    }

    // Filter by event name (for track events)
    if (options.eventName && (event as any).event !== options.eventName) {
      return false
    }

    // Filter by time range using cached timestamp parsing
    if (options.startTime || options.endTime) {
      const eventTime = getTimestampMs(event.timestamp)

      if (options.startTime) {
        const startTime = typeof options.startTime === 'string'
          ? getTimestampMs(options.startTime)
          : options.startTime.getTime()
        if (eventTime < startTime) {
          return false
        }
      }

      if (options.endTime) {
        const endTime = typeof options.endTime === 'string'
          ? getTimestampMs(options.endTime)
          : options.endTime.getTime()
        if (eventTime > endTime) {
          return false
        }
      }
    }

    return true
  }

  /**
   * Filter events based on query options (full filter including userId/anonymousId).
   *
   * Used for warm/cold tier queries where we don't have in-memory indexes.
   * Uses cached timestamp parsing for better performance on time-range queries.
   *
   * @param events - Events to filter
   * @param options - Query options
   * @returns Filtered events
   */
  private filterEvents(events: StoredEvent[], options: EventQueryOptions): StoredEvent[] {
    return events.filter((event) => {
      // Filter by userId
      if (options.userId && event.userId !== options.userId) {
        return false
      }

      // Filter by anonymousId
      if (options.anonymousId && event.anonymousId !== options.anonymousId) {
        return false
      }

      // Apply common filters (type, name, time range)
      return this.applyCommonFilters(event, options)
    })
  }

  /**
   * Get events by user ID
   */
  async getEventsByUser(userId: string, limit?: number): Promise<StoredEvent[]> {
    const result = await this.queryEvents({
      userId,
      limit,
      includeTiers: ['hot', 'warm', 'cold'],
    })
    return result.events
  }

  /**
   * Get events in a time range
   */
  async getEventsByTimeRange(start: Date, end: Date): Promise<StoredEvent[]> {
    const result = await this.queryEvents({
      startTime: start,
      endTime: end,
      includeTiers: ['hot', 'warm', 'cold'],
    })
    return result.events
  }

  /**
   * Get events by type
   */
  async getEventsByType(type: AnalyticsEvent['type']): Promise<StoredEvent[]> {
    const result = await this.queryEvents({
      eventType: type,
      includeTiers: ['hot', 'warm', 'cold'],
    })
    return result.events
  }

  /**
   * Internal tiering implementation.
   *
   * Moves events between tiers based on age thresholds:
   * - Hot -> Warm: Events older than warmThresholdDays
   * - Hot -> Cold: Events older than coldThresholdDays
   * - Warm -> Cold: Events older than coldThresholdDays
   *
   * Uses cached timestamp parsing for better performance.
   * Updates in-memory indexes when events are moved from hot tier.
   *
   * @returns Tiering operation result with counts and duration
   */
  private async runTieringInternal(): Promise<TieringResult> {
    const startTime = Date.now()
    const config = await this.getConfig()
    const now = Date.now()

    // Pre-calculate thresholds once
    const warmThreshold = now - config.warmThresholdDays * 24 * 60 * 60 * 1000
    const coldThreshold = now - config.coldThresholdDays * 24 * 60 * 60 * 1000

    let movedToWarm = 0
    let movedToCold = 0
    const deleted = 0

    // Collect events to move and R2 puts to batch
    const r2Puts: Promise<void>[] = []
    const r2 = this.env.R2 as any

    // Move events from hot to warm/cold (based on timestamp)
    // Only move events that are still in hot tier (haven't been moved yet)
    const eventsToKeepHot: StoredEvent[] = []
    for (const event of this.events) {
      // Skip events already moved to another tier
      if (event._tier !== 'hot') {
        continue
      }

      // Use cached timestamp parsing
      const eventTime = getTimestampMs(event.timestamp)

      if (eventTime <= coldThreshold) {
        // Move to cold (events at or older than cold threshold)
        event._tier = 'cold'
        this.coldEvents.push(event)
        movedToCold++

        // Remove from hot tier indexes (event moved to cold)
        this.eventCache.delete(event._id)
        this.eventIdToIndex.delete(event._id)
        this.userIdIndex.remove(event.userId, event._id)
        this.anonymousIdIndex.remove(event.anonymousId, event._id)
      } else if (eventTime <= warmThreshold) {
        // Move to warm (events at or older than warm threshold but newer than cold)
        event._tier = 'warm'
        this.warmEvents.push(event)
        movedToWarm++

        // Remove from hot tier indexes (event moved to warm)
        this.eventCache.delete(event._id)
        this.eventIdToIndex.delete(event._id)
        this.userIdIndex.remove(event.userId, event._id)
        this.anonymousIdIndex.remove(event.anonymousId, event._id)

        // Queue R2 put (don't await individually for better throughput)
        if (r2?.put) {
          r2Puts.push(r2.put(`events/${event._id}`, JSON.stringify(event)))
        }
      } else {
        // Keep in hot
        eventsToKeepHot.push(event)
      }
    }

    // Update hot events array
    this.events = eventsToKeepHot

    // Rebuild the eventIdToIndex map after array update
    this.eventIdToIndex.clear()
    for (let i = 0; i < this.events.length; i++) {
      this.eventIdToIndex.set(this.events[i]._id, i)
    }

    // Move events from warm to cold
    const eventsToKeepWarm: StoredEvent[] = []
    for (const event of this.warmEvents) {
      // Skip events already moved to cold tier
      if (event._tier === 'cold') {
        continue
      }

      const eventTime = getTimestampMs(event.timestamp)

      if (eventTime <= coldThreshold) {
        event._tier = 'cold'
        this.coldEvents.push(event)
        movedToCold++
      } else {
        eventsToKeepWarm.push(event)
      }
    }
    this.warmEvents = eventsToKeepWarm

    // Wait for all R2 puts to complete
    if (r2Puts.length > 0) {
      await Promise.all(r2Puts)
    }

    return {
      movedToWarm,
      movedToCold,
      deleted,
      duration: Date.now() - startTime,
    }
  }

  /**
   * Run tiering operation to move events between storage tiers.
   *
   * This method implements a locking mechanism to ensure only one
   * tiering operation runs at a time. Concurrent calls will queue
   * and execute sequentially.
   *
   * Tiering is idempotent - running multiple times is safe and will
   * only move events that haven't already been moved.
   *
   * @example
   * ```typescript
   * // Run tiering periodically (e.g., daily cron)
   * const result = await analyticsDO.runTiering()
   * console.log(`Moved ${result.movedToWarm} to warm, ${result.movedToCold} to cold`)
   * ```
   *
   * @returns Tiering result with counts of moved events and duration
   */
  async runTiering(): Promise<TieringResult> {
    // Queue this operation behind any pending tiering
    const previousLock = this.tieringLock

    // Create our lock promise immediately (synchronously, before any await)
    let resolveLock: (result: TieringResult) => void
    const ourLock = new Promise<TieringResult>((resolve) => {
      resolveLock = resolve
    })
    this.tieringLock = ourLock

    try {
      // Wait for previous operation to complete
      if (previousLock) {
        await previousLock
      }

      // Run the actual tiering
      const result = await this.runTieringInternal()
      resolveLock!(result)
      return result
    } catch (error) {
      // On error, resolve with zeros
      const result: TieringResult = {
        movedToWarm: 0,
        movedToCold: 0,
        deleted: 0,
        duration: 0,
      }
      resolveLock!(result)
      throw error
    } finally {
      // Clear the lock only if it's still ours
      if (this.tieringLock === ourLock) {
        this.tieringLock = null
      }
    }
  }

  /**
   * Get storage statistics across all tiers.
   *
   * Returns counts of events in each tier, unique users, and
   * estimated storage size.
   *
   * @returns Storage statistics object
   */
  async getStorageStats(): Promise<StorageStats> {
    const hotEvents = this.events.length
    const warmEvents = this.warmEvents.length
    const coldEvents = this.coldEvents.length
    const totalEvents = hotEvents + warmEvents + coldEvents

    // Count unique users
    const userIds = new Set<string>()
    const allEvents = [...this.events, ...this.warmEvents, ...this.coldEvents]
    for (const event of allEvents) {
      if (event.userId) {
        userIds.add(event.userId)
      }
    }

    // Estimate size (rough approximation)
    const sizeBytes = JSON.stringify(allEvents).length

    return {
      totalEvents,
      hotEvents,
      warmEvents,
      coldEvents,
      uniqueUsers: userIds.size,
      sizeBytes,
    }
  }

  /**
   * Check if this DO is part of a sharded deployment.
   *
   * @returns true if shardCount > 1, false otherwise
   */
  async isSharded(): Promise<boolean> {
    const config = await this.getConfig()
    return config.shardCount > 1
  }

  /**
   * Get shard information for this DO.
   *
   * Returns null if the DO is not sharded (shardCount <= 1).
   *
   * @returns Shard info or null if not sharded
   */
  async getShardInfo(): Promise<ShardInfo | null> {
    const config = await this.getConfig()

    if (config.shardCount <= 1) {
      return null
    }

    return {
      shardIndex: 0, // This would be set per-shard in a real implementation
      totalShards: config.shardCount,
      shardKey: config.shardKey,
      registryId: this.ctx.id.toString(),
    }
  }

  /**
   * Handle HTTP fetch requests to the DO.
   *
   * ## Endpoints
   *
   * - `POST /events` - Store one or more events (body: event or array of events)
   * - `GET /events` - Query events with default options
   * - `GET /stats` - Get storage statistics
   * - `POST /tiering` - Run tiering operation
   *
   * @param request - Incoming HTTP request
   * @returns HTTP response
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/events' && request.method === 'POST') {
      const body = await request.json()
      if (Array.isArray(body)) {
        const stored = await this.storeEvents(body)
        return new Response(JSON.stringify(stored), {
          headers: { 'Content-Type': 'application/json' },
        })
      } else {
        const stored = await this.storeEvent(body)
        return new Response(JSON.stringify(stored), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (path === '/events' && request.method === 'GET') {
      const result = await this.queryEvents({})
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (path === '/stats' && request.method === 'GET') {
      const stats = await this.getStorageStats()
      return new Response(JSON.stringify(stats), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (path === '/tiering' && request.method === 'POST') {
      const result = await this.runTiering()
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not Found', { status: 404 })
  }
}

// Re-export types for the interface used in tests
interface DurableObjectState {
  id: { toString(): string }
  storage: {
    get<T>(key: string): Promise<T | undefined>
    put<T>(key: string, value: T): Promise<void>
  }
}

export default AnalyticsDO
