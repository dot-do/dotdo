/**
 * Collection Limits Manager
 *
 * Provides efficient handling for large collections in DO storage.
 * Features:
 * - Cursor-based pagination for 10K+ item collections
 * - Streaming iterator for memory-efficient processing
 * - Configurable size limits with warnings
 * - Graceful degradation when at limits
 */

import type { ThingsStore, ThingEntity, ThingsListOptions } from '../db/stores'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Paginated result from collection queries
 */
export interface PaginatedResult<T> {
  items: T[]
  cursor: string | null
  hasMore: boolean
  totalEstimate?: number
}

/**
 * Configuration for collection limits
 */
export interface CollectionConfig {
  /** Maximum number of items in the collection (default: unlimited) */
  maxSize?: number
  /** Percentage threshold for warnings (default: 80%) */
  warnAtPercentage?: number
  /** Default page size for pagination (default: 100) */
  pageSize?: number
  /** Maximum allowed page size (default: 1000) */
  maxPageSize?: number
  /** Collection name for warnings */
  name?: string
}

/**
 * Warning types for collection limit events
 */
export type LimitWarningType = 'approaching_limit' | 'at_limit' | 'memory_pressure' | 'slow_query'

/**
 * Limit warning event
 */
export interface LimitWarning {
  type: LimitWarningType
  collection: string
  currentCount: number
  limit?: number
  percentage?: number
  message: string
  timestamp: number
}

/**
 * Collection statistics
 */
export interface CollectionStats {
  count: number
  limit: number | null
  percentage: number | null
  isAtWarning: boolean
  isAtLimit: boolean
}

/**
 * List options for paginated queries
 */
export interface ListOptions {
  cursor?: string
  limit?: number
  direction?: 'forward' | 'backward'
}

// ============================================================================
// CURSOR ENCODING/DECODING
// ============================================================================

interface CursorData {
  pos: number
  v: number
}

/**
 * Encode cursor from position
 */
export function encodeCursor(position: number): string {
  return Buffer.from(JSON.stringify({ pos: position, v: 1 })).toString('base64')
}

/**
 * Decode cursor to position
 */
export function decodeCursor(cursor: string): CursorData | null {
  try {
    const data = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'))
    if (typeof data.pos === 'number' && typeof data.v === 'number') {
      return data
    }
    return null
  } catch {
    return null
  }
}

// ============================================================================
// COLLECTION MANAGER
// ============================================================================

/**
 * CollectionManager - manages bounded collections with pagination and limits
 */
export class CollectionManager<T = unknown> {
  private storage: Map<string, T>
  private config: Required<CollectionConfig>
  private warningCallbacks: Set<(warning: LimitWarning) => void> = new Set()

  constructor(storage: Map<string, T>, config: CollectionConfig = {}) {
    this.storage = storage
    this.config = {
      maxSize: config.maxSize ?? Infinity,
      warnAtPercentage: config.warnAtPercentage ?? 80,
      pageSize: config.pageSize ?? 100,
      maxPageSize: config.maxPageSize ?? 1000,
      name: config.name ?? 'default',
    }
  }

  /**
   * List items with cursor-based pagination
   */
  async list(options: ListOptions = {}): Promise<PaginatedResult<T>> {
    const limit = this.normalizeLimit(options.limit)
    let startPosition = 0

    // Decode cursor if provided
    if (options.cursor) {
      const cursorData = decodeCursor(options.cursor)
      if (cursorData) {
        startPosition = cursorData.pos
      }
    }

    // Handle backward direction
    const direction = options.direction ?? 'forward'
    const entries = Array.from(this.storage.entries())

    let items: T[]
    let nextPosition: number

    if (direction === 'backward') {
      // Go back from current position
      const endPosition = Math.max(0, startPosition - limit)
      items = entries
        .slice(endPosition, startPosition)
        .map(([_, value]) => value)
        .reverse()
      nextPosition = endPosition
    } else {
      // Go forward from current position
      items = entries
        .slice(startPosition, startPosition + limit)
        .map(([_, value]) => value)
      nextPosition = startPosition + limit
    }

    const hasMore = direction === 'forward'
      ? nextPosition < entries.length
      : nextPosition > 0

    const cursor = hasMore ? encodeCursor(nextPosition) : null

    return {
      items,
      cursor,
      hasMore,
      totalEstimate: entries.length,
    }
  }

  /**
   * Normalize limit to valid range
   */
  private normalizeLimit(limit?: number): number {
    if (limit === undefined || limit === null) {
      return this.config.pageSize
    }
    if (limit <= 0) {
      return this.config.pageSize
    }
    return Math.min(limit, this.config.maxPageSize)
  }

  /**
   * Stream items as an async iterator (memory efficient for large collections)
   */
  async *stream(): AsyncGenerator<T> {
    for (const [_, value] of this.storage) {
      yield value
    }
  }

  /**
   * Get collection statistics
   */
  getCollectionStats(): CollectionStats {
    const count = this.storage.size
    const limit = this.config.maxSize === Infinity ? null : this.config.maxSize
    const percentage = limit !== null ? (count / limit) * 100 : null
    const isAtWarning = percentage !== null && percentage >= this.config.warnAtPercentage
    const isAtLimit = limit !== null && count >= limit

    return {
      count,
      limit,
      percentage,
      isAtWarning,
      isAtLimit,
    }
  }

  /**
   * Register a callback for limit warnings
   */
  onLimitWarning(callback: (warning: LimitWarning) => void): () => void {
    this.warningCallbacks.add(callback)
    return () => {
      this.warningCallbacks.delete(callback)
    }
  }

  /**
   * Emit a warning to all registered callbacks
   */
  private emitWarning(warning: LimitWarning): void {
    for (const callback of this.warningCallbacks) {
      callback(warning)
    }
  }

  /**
   * Add an item to the collection (may fail if at limit)
   */
  async add(item: T): Promise<void> {
    const stats = this.getCollectionStats()

    // Check if at limit
    if (stats.isAtLimit) {
      throw new Error(
        `Collection '${this.config.name}' is at limit (${stats.limit} items). Cannot add more items.`
      )
    }

    // Generate a unique key for the item
    const key = `item:${Date.now()}:${Math.random().toString(36).slice(2)}`
    this.storage.set(key, item)

    // Check for warnings after adding
    const newStats = this.getCollectionStats()

    if (newStats.isAtLimit) {
      this.emitWarning({
        type: 'at_limit',
        collection: this.config.name,
        currentCount: newStats.count,
        limit: newStats.limit ?? undefined,
        percentage: newStats.percentage ?? undefined,
        message: `Collection '${this.config.name}' has reached its limit of ${newStats.limit} items`,
        timestamp: Date.now(),
      })
    } else if (newStats.isAtWarning && !stats.isAtWarning) {
      this.emitWarning({
        type: 'approaching_limit',
        collection: this.config.name,
        currentCount: newStats.count,
        limit: newStats.limit ?? undefined,
        percentage: newStats.percentage ?? undefined,
        message: `Collection '${this.config.name}' is approaching its limit (${newStats.percentage?.toFixed(1)}%)`,
        timestamp: Date.now(),
      })
    }
  }

  /**
   * Delete an item from the collection
   */
  async delete(key: string): Promise<boolean> {
    return this.storage.delete(key)
  }

  /**
   * Get current item count
   */
  async count(): Promise<number> {
    return this.storage.size
  }

  /**
   * Check if collection can accept new items
   */
  async canAdd(): Promise<boolean> {
    const stats = this.getCollectionStats()
    return !stats.isAtLimit
  }
}

// ============================================================================
// THINGS STORE WRAPPER
// ============================================================================

/**
 * Options for wrapping a ThingsStore with collection limits
 */
export interface WrapThingsStoreOptions extends CollectionConfig {
  /** Callback for limit warnings */
  onWarning?: (warning: LimitWarning) => void
}

/**
 * Wrapped ThingsStore with pagination and limit support
 */
export interface WrappedThingsStore {
  list(options?: ListOptions & ThingsListOptions): Promise<PaginatedResult<ThingEntity>>
  onLimitWarning(callback: (warning: LimitWarning) => void): () => void
  getCollectionStats(): Promise<CollectionStats>
}

/**
 * Wrap a ThingsStore with collection limits and pagination
 */
export function wrapThingsStore(
  store: ThingsStore,
  options: WrapThingsStoreOptions = {}
): WrappedThingsStore {
  const config: Required<Omit<WrapThingsStoreOptions, 'onWarning'>> = {
    maxSize: options.maxSize ?? Infinity,
    warnAtPercentage: options.warnAtPercentage ?? 80,
    pageSize: options.pageSize ?? 100,
    maxPageSize: options.maxPageSize ?? 1000,
    name: options.name ?? 'things',
  }

  const warningCallbacks = new Set<(warning: LimitWarning) => void>()

  // Add initial warning callback if provided
  if (options.onWarning) {
    warningCallbacks.add(options.onWarning)
  }

  function emitWarning(warning: LimitWarning): void {
    for (const callback of warningCallbacks) {
      callback(warning)
    }
  }

  function normalizeLimit(limit?: number): number {
    if (limit === undefined || limit === null) {
      return config.pageSize
    }
    if (limit <= 0) {
      return config.pageSize
    }
    return Math.min(limit, config.maxPageSize)
  }

  return {
    async list(listOptions: ListOptions & ThingsListOptions = {}): Promise<PaginatedResult<ThingEntity>> {
      const limit = normalizeLimit(listOptions.limit)
      let offset = 0

      // Decode cursor if provided
      if (listOptions.cursor) {
        const cursorData = decodeCursor(listOptions.cursor)
        if (cursorData) {
          offset = cursorData.pos
        }
      }

      // Call underlying store
      const items = await store.list({
        ...listOptions,
        limit: limit + 1, // Fetch one extra to check hasMore
        offset,
      })

      const hasMore = items.length > limit
      const resultItems = hasMore ? items.slice(0, limit) : items
      const nextPosition = offset + resultItems.length
      const cursor = hasMore ? encodeCursor(nextPosition) : null

      // Check limits and emit warnings if needed
      if (config.maxSize !== Infinity) {
        const totalItems = await store.list({ limit: 1 }) // Get count estimate
        const percentage = (totalItems.length / config.maxSize) * 100

        if (percentage >= config.warnAtPercentage) {
          emitWarning({
            type: 'approaching_limit',
            collection: config.name,
            currentCount: totalItems.length,
            limit: config.maxSize,
            percentage,
            message: `Collection '${config.name}' is approaching its limit (${percentage.toFixed(1)}%)`,
            timestamp: Date.now(),
          })
        }
      }

      return {
        items: resultItems,
        cursor,
        hasMore,
      }
    },

    onLimitWarning(callback: (warning: LimitWarning) => void): () => void {
      warningCallbacks.add(callback)
      return () => {
        warningCallbacks.delete(callback)
      }
    },

    async getCollectionStats(): Promise<CollectionStats> {
      const items = await store.list({ limit: 1000000 }) // Large limit to get count
      const count = items.length
      const limit = config.maxSize === Infinity ? null : config.maxSize
      const percentage = limit !== null ? (count / limit) * 100 : null
      const isAtWarning = percentage !== null && percentage >= config.warnAtPercentage
      const isAtLimit = limit !== null && count >= limit

      return {
        count,
        limit,
        percentage,
        isAtWarning,
        isAtLimit,
      }
    },
  }
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default CollectionManager
