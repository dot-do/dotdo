/**
 * CDCStream - Change Data Capture Engine
 *
 * Captures row-level changes (INSERT/UPDATE/DELETE) as ordered streams,
 * enabling real-time data synchronization and event-driven architectures.
 * Provides Kafka-like consumer groups with offset tracking.
 *
 * ## Features
 * - **Before/After State** - Full document snapshots for each change
 * - **Ordered Streams** - Sequential offsets per entity
 * - **Consumer Groups** - Multiple consumers with offset tracking
 * - **Replay Support** - Re-process changes from any offset or timestamp
 * - **Filtering** - By operation type, fields, key patterns, predicates
 * - **Transaction Correlation** - Group changes by transaction ID
 * - **Lag Monitoring** - Track consumer progress vs latest offset
 *
 * ## Use Cases
 * - Real-time data synchronization between services
 * - Materialized view maintenance
 * - Audit logging with full change history
 * - Event sourcing / CQRS patterns
 * - Search index updates
 *
 * @example Basic Usage
 * ```typescript
 * import { createCDCStream } from 'dotdo/db/primitives/cdc-stream'
 *
 * const cdc = createCDCStream()
 *
 * // Enable CDC on entity
 * await cdc.enable('users')
 *
 * // Capture changes
 * await cdc.capture('users', {
 *   operation: 'INSERT',
 *   key: 'user-123',
 *   after: { id: 'user-123', name: 'Alice', email: 'alice@example.com' },
 * })
 *
 * await cdc.capture('users', {
 *   operation: 'UPDATE',
 *   key: 'user-123',
 *   before: { id: 'user-123', name: 'Alice', email: 'alice@example.com' },
 *   after: { id: 'user-123', name: 'Alice Smith', email: 'alice@example.com' },
 * })
 * ```
 *
 * @example Consumer Groups
 * ```typescript
 * // Create consumer with group ID for offset tracking
 * const consumer = cdc.createConsumer('users', {
 *   groupId: 'search-indexer',
 *   startOffset: 'earliest',
 *   autoCommit: false,
 * })
 *
 * // Process changes
 * for await (const change of consumer) {
 *   await updateSearchIndex(change)
 *   await consumer.commit() // Commit offset after processing
 * }
 *
 * // Check consumer lag
 * const lag = await cdc.getConsumerLag('users', 'search-indexer')
 * ```
 *
 * @example Filtered Replay
 * ```typescript
 * // Replay only DELETE operations from last 24 hours
 * await cdc.replay('users', {
 *   fromTimestamp: Date.now() - 24 * 60 * 60 * 1000,
 *   batchSize: 100,
 * }, async (change) => {
 *   if (change.operation === 'DELETE') {
 *     await archiveUser(change.before)
 *   }
 * })
 * ```
 *
 * @module db/primitives/cdc-stream
 */

// ============================================================================
// Types
// ============================================================================

export type Operation = 'INSERT' | 'UPDATE' | 'DELETE'

export interface ChangeEvent<T = unknown> {
  /** Sequential offset in the change stream */
  offset: number
  /** Type of operation */
  operation: Operation
  /** Entity/table name */
  entity: string
  /** Primary key or identifier */
  key: string
  /** State before the change (null for INSERTs) */
  before: T | null
  /** State after the change (null for DELETEs) */
  after: T | null
  /** Timestamp of the change */
  timestamp: number
  /** Optional transaction identifier */
  transactionId?: string
}

export interface CaptureInput<T = unknown> {
  operation: Operation
  key: string
  before?: T | null
  after?: T | null
  transactionId?: string
  timestamp?: number
}

export interface CDCConfig {
  entity: string
  captureInserts: boolean
  captureUpdates: boolean
  captureDeletes: boolean
  trackFields?: string[]
}

export interface EnableOptions {
  captureInserts?: boolean
  captureUpdates?: boolean
  captureDeletes?: boolean
  trackFields?: string[]
}

export interface ChangeFilter<T = unknown> {
  operations?: Operation[]
  fields?: string[]
  keyPattern?: RegExp
  predicate?: (change: ChangeEvent<T>) => boolean
}

export interface ConsumerConfig<T = unknown> {
  groupId?: string
  startOffset?: number | 'earliest' | 'latest'
  autoCommit?: boolean
  filter?: ChangeFilter<T>
}

export interface ReplayOptions {
  fromOffset?: number
  toOffset?: number
  fromTimestamp?: number
  toTimestamp?: number
  batchSize?: number
}

export interface CDCStats {
  totalChanges: number
  inserts: number
  updates: number
  deletes: number
  latestOffset: number
  earliestTimestamp: number | null
  latestTimestamp: number | null
}

export interface TransactionInfo {
  transactionId: string
  changeCount: number
  startTimestamp: number
  endTimestamp: number
}

// ============================================================================
// Consumer Interface
// ============================================================================

export interface Consumer<T = unknown> extends AsyncIterableIterator<ChangeEvent<T>> {
  /** Entity this consumer is reading from */
  readonly entity: string
  /** Current offset position */
  readonly currentOffset: number
  /** Consumer group ID if set */
  readonly groupId?: string
  /** Commit current offset */
  commit(): Promise<void>
  /** Close the consumer */
  close(): Promise<void>
  /** Get next change event */
  next(): Promise<IteratorResult<ChangeEvent<T>>>
  /** Async iterator support */
  [Symbol.asyncIterator](): AsyncIterableIterator<ChangeEvent<T>>
}

// ============================================================================
// CDCStream Interface
// ============================================================================

export interface CDCStream {
  /** Enable CDC on an entity */
  enable(entity: string, options?: EnableOptions): Promise<void>
  /** Disable CDC on an entity */
  disable(entity: string): Promise<void>
  /** Get CDC config for an entity */
  getConfig(entity: string): Promise<CDCConfig | null>
  /** List all entities with CDC enabled */
  listEnabledEntities(): Promise<string[]>
  /** Capture a change event */
  capture<T = unknown>(entity: string, input: CaptureInput<T>): Promise<void>
  /** Create a consumer for an entity */
  createConsumer<T = unknown>(entity: string, config?: ConsumerConfig<T>): Consumer<T>
  /** Get committed offset for a consumer group */
  getCommittedOffset(entity: string, groupId: string): Promise<number | null>
  /** List all consumer groups for an entity */
  listConsumerGroups(entity: string): Promise<string[]>
  /** Get consumer lag (how far behind a consumer is) */
  getConsumerLag(entity: string, groupId: string): Promise<number>
  /** Replay changes with callback */
  replay<T = unknown>(
    entity: string,
    options: ReplayOptions,
    callback: (change: ChangeEvent<T>) => Promise<boolean | void>
  ): Promise<void>
  /** Replay changes in batches */
  replayBatch<T = unknown>(
    entity: string,
    options: ReplayOptions,
    callback: (batch: ChangeEvent<T>[]) => Promise<void>
  ): Promise<void>
  /** Get changes for a specific transaction */
  getChangesByTransaction<T = unknown>(entity: string, transactionId: string): Promise<ChangeEvent<T>[]>
  /** Get transaction info */
  getTransactionInfo(entity: string, transactionId: string): Promise<TransactionInfo | null>
  /** Get statistics for an entity */
  getStats(entity: string): Promise<CDCStats>
}

// ============================================================================
// Implementation
// ============================================================================

interface StoredChange<T = unknown> {
  offset: number
  operation: Operation
  entity: string
  key: string
  before: T | null
  after: T | null
  timestamp: number
  transactionId?: string
}

interface ConsumerState {
  groupId: string
  entity: string
  committedOffset: number
}

class InMemoryCDCStream implements CDCStream {
  private configs: Map<string, CDCConfig> = new Map()
  private changes: Map<string, StoredChange[]> = new Map()
  private offsets: Map<string, number> = new Map() // entity -> next offset
  private consumerGroups: Map<string, ConsumerState> = new Map() // `${entity}:${groupId}` -> state
  private activeConsumers: Set<string> = new Set() // active group IDs per entity

  async enable(entity: string, options?: EnableOptions): Promise<void> {
    this.configs.set(entity, {
      entity,
      captureInserts: options?.captureInserts ?? true,
      captureUpdates: options?.captureUpdates ?? true,
      captureDeletes: options?.captureDeletes ?? true,
      trackFields: options?.trackFields,
    })

    if (!this.changes.has(entity)) {
      this.changes.set(entity, [])
      this.offsets.set(entity, 0)
    }
  }

  async disable(entity: string): Promise<void> {
    this.configs.delete(entity)
  }

  async getConfig(entity: string): Promise<CDCConfig | null> {
    return this.configs.get(entity) ?? null
  }

  async listEnabledEntities(): Promise<string[]> {
    return Array.from(this.configs.keys())
  }

  async capture<T = unknown>(entity: string, input: CaptureInput<T>): Promise<void> {
    const config = this.configs.get(entity)
    if (!config) {
      throw new Error(`CDC not enabled for entity: ${entity}`)
    }

    // Check if operation should be captured
    if (input.operation === 'INSERT' && !config.captureInserts) return
    if (input.operation === 'UPDATE' && !config.captureUpdates) return
    if (input.operation === 'DELETE' && !config.captureDeletes) return

    // Check tracked fields for updates
    if (config.trackFields && input.operation === 'UPDATE' && input.before && input.after) {
      const hasTrackedFieldChange = config.trackFields.some((field) => {
        const beforeVal = (input.before as Record<string, unknown>)?.[field]
        const afterVal = (input.after as Record<string, unknown>)?.[field]
        return beforeVal !== afterVal
      })
      if (!hasTrackedFieldChange) return
    }

    const changes = this.changes.get(entity)!
    const offset = this.offsets.get(entity)!

    const change: StoredChange<T> = {
      offset,
      operation: input.operation,
      entity,
      key: input.key,
      before: input.before ?? null,
      after: input.after ?? null,
      timestamp: input.timestamp ?? Date.now(),
      transactionId: input.transactionId,
    }

    changes.push(change as StoredChange)
    this.offsets.set(entity, offset + 1)
  }

  createConsumer<T = unknown>(entity: string, config?: ConsumerConfig<T>): Consumer<T> {
    const groupId = config?.groupId
    const filter = config?.filter
    const autoCommit = config?.autoCommit ?? false

    // Determine start offset
    let startOffset: number
    if (config?.startOffset === 'earliest' || config?.startOffset === 0) {
      startOffset = 0
    } else if (config?.startOffset === 'latest') {
      startOffset = this.offsets.get(entity) ?? 0
    } else if (typeof config?.startOffset === 'number') {
      startOffset = config.startOffset
    } else if (groupId) {
      // Resume from committed offset
      const key = `${entity}:${groupId}`
      const state = this.consumerGroups.get(key)
      startOffset = state?.committedOffset ?? 0
    } else {
      startOffset = 0
    }

    // Track active consumer group
    if (groupId) {
      this.activeConsumers.add(`${entity}:${groupId}`)
    }

    return new InMemoryConsumer<T>(this, entity, startOffset, groupId, filter, autoCommit)
  }

  async getCommittedOffset(entity: string, groupId: string): Promise<number | null> {
    const key = `${entity}:${groupId}`
    const state = this.consumerGroups.get(key)
    return state?.committedOffset ?? null
  }

  async listConsumerGroups(entity: string): Promise<string[]> {
    const groups: string[] = []
    const keys = Array.from(this.activeConsumers)
    for (const key of keys) {
      if (key.startsWith(`${entity}:`)) {
        groups.push(key.substring(entity.length + 1))
      }
    }
    return groups
  }

  async getConsumerLag(entity: string, groupId: string): Promise<number> {
    const latestOffset = this.offsets.get(entity) ?? 0
    const committedOffset = await this.getCommittedOffset(entity, groupId)
    return latestOffset - (committedOffset ?? 0)
  }

  async replay<T = unknown>(
    entity: string,
    options: ReplayOptions,
    callback: (change: ChangeEvent<T>) => Promise<boolean | void>
  ): Promise<void> {
    const changes = this.changes.get(entity) ?? []
    const fromOffset = options.fromOffset ?? 0
    const toOffset = options.toOffset ?? Infinity

    for (const change of changes) {
      // Filter by offset
      if (change.offset < fromOffset) continue
      if (change.offset > toOffset) continue

      // Filter by timestamp
      if (options.fromTimestamp !== undefined && change.timestamp < options.fromTimestamp) continue
      if (options.toTimestamp !== undefined && change.timestamp > options.toTimestamp) continue

      const result = await callback(change as ChangeEvent<T>)
      if (result === false) break
    }
  }

  async replayBatch<T = unknown>(
    entity: string,
    options: ReplayOptions,
    callback: (batch: ChangeEvent<T>[]) => Promise<void>
  ): Promise<void> {
    const changes = this.changes.get(entity) ?? []
    const fromOffset = options.fromOffset ?? 0
    const toOffset = options.toOffset ?? Infinity
    const batchSize = options.batchSize ?? 100

    const filtered = changes.filter((c) => {
      if (c.offset < fromOffset || c.offset > toOffset) return false
      if (options.fromTimestamp !== undefined && c.timestamp < options.fromTimestamp) return false
      if (options.toTimestamp !== undefined && c.timestamp > options.toTimestamp) return false
      return true
    })

    for (let i = 0; i < filtered.length; i += batchSize) {
      const batch = filtered.slice(i, i + batchSize) as ChangeEvent<T>[]
      await callback(batch)
    }
  }

  async getChangesByTransaction<T = unknown>(entity: string, transactionId: string): Promise<ChangeEvent<T>[]> {
    const changes = this.changes.get(entity) ?? []
    return changes.filter((c) => c.transactionId === transactionId) as ChangeEvent<T>[]
  }

  async getTransactionInfo(entity: string, transactionId: string): Promise<TransactionInfo | null> {
    const changes = await this.getChangesByTransaction(entity, transactionId)
    if (changes.length === 0) return null

    return {
      transactionId,
      changeCount: changes.length,
      startTimestamp: Math.min(...changes.map((c) => c.timestamp)),
      endTimestamp: Math.max(...changes.map((c) => c.timestamp)),
    }
  }

  async getStats(entity: string): Promise<CDCStats> {
    const changes = this.changes.get(entity) ?? []

    if (changes.length === 0) {
      return {
        totalChanges: 0,
        inserts: 0,
        updates: 0,
        deletes: 0,
        latestOffset: -1,
        earliestTimestamp: null,
        latestTimestamp: null,
      }
    }

    return {
      totalChanges: changes.length,
      inserts: changes.filter((c) => c.operation === 'INSERT').length,
      updates: changes.filter((c) => c.operation === 'UPDATE').length,
      deletes: changes.filter((c) => c.operation === 'DELETE').length,
      latestOffset: changes[changes.length - 1]!.offset,
      earliestTimestamp: Math.min(...changes.map((c) => c.timestamp)),
      latestTimestamp: Math.max(...changes.map((c) => c.timestamp)),
    }
  }

  // Internal methods for consumer
  _getChanges(entity: string): StoredChange[] {
    return this.changes.get(entity) ?? []
  }

  _commitOffset(entity: string, groupId: string, offset: number): void {
    const key = `${entity}:${groupId}`
    this.consumerGroups.set(key, {
      groupId,
      entity,
      committedOffset: offset,
    })
  }

  _getLatestOffset(entity: string): number {
    return this.offsets.get(entity) ?? 0
  }
}

class InMemoryConsumer<T = unknown> implements Consumer<T> {
  private _currentOffset: number
  private closed = false
  private pendingResolve: ((result: IteratorResult<ChangeEvent<T>>) => void) | null = null

  constructor(
    private cdc: InMemoryCDCStream,
    public readonly entity: string,
    startOffset: number,
    public readonly groupId?: string,
    private filter?: ChangeFilter<T>,
    private autoCommit: boolean = false
  ) {
    this._currentOffset = startOffset
  }

  get currentOffset(): number {
    return this._currentOffset
  }

  async commit(): Promise<void> {
    if (this.groupId) {
      this.cdc._commitOffset(this.entity, this.groupId, this._currentOffset)
    }
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.pendingResolve) {
      this.pendingResolve({ done: true, value: undefined as unknown as ChangeEvent<T> })
      this.pendingResolve = null
    }
  }

  async next(): Promise<IteratorResult<ChangeEvent<T>>> {
    if (this.closed) {
      return { done: true, value: undefined as unknown as ChangeEvent<T> }
    }

    const changes = this.cdc._getChanges(this.entity)

    // Find next change that passes filter
    while (this._currentOffset < changes.length) {
      const change = changes[this._currentOffset] as ChangeEvent<T>

      if (this.matchesFilter(change)) {
        this._currentOffset++
        if (this.autoCommit && this.groupId) {
          await this.commit()
        }
        return { done: false, value: change }
      }

      this._currentOffset++
    }

    // No more changes available
    return { done: true, value: undefined as unknown as ChangeEvent<T> }
  }

  private matchesFilter(change: ChangeEvent<T>): boolean {
    if (!this.filter) return true

    // Check operations filter
    if (this.filter.operations && !this.filter.operations.includes(change.operation)) {
      return false
    }

    // Check key pattern
    if (this.filter.keyPattern && !this.filter.keyPattern.test(change.key)) {
      return false
    }

    // Check fields filter (only for updates)
    if (this.filter.fields && change.operation === 'UPDATE' && change.before && change.after) {
      const hasMatchingFieldChange = this.filter.fields.some((field) => {
        const beforeVal = (change.before as Record<string, unknown>)?.[field]
        const afterVal = (change.after as Record<string, unknown>)?.[field]
        return beforeVal !== afterVal
      })
      if (!hasMatchingFieldChange) return false
    }

    // Check custom predicate
    if (this.filter.predicate && !this.filter.predicate(change)) {
      return false
    }

    return true
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<ChangeEvent<T>> {
    return this
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createCDCStream(): CDCStream {
  return new InMemoryCDCStream()
}

export { InMemoryCDCStream as CDCStreamImpl }
