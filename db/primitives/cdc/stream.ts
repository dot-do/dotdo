/**
 * CDCStream - Change Data Capture stream with checkpointing
 *
 * Provides Debezium-style change data capture:
 * - Change types: INSERT, UPDATE, DELETE
 * - Before/after snapshots for updates
 * - Checkpointing with ExactlyOnceContext integration
 * - Backfill support for initial sync
 * - Schema change handling
 * - Filtering and transformation
 *
 * @see https://debezium.io/documentation/reference/stable/connectors/
 */

import {
  ExactlyOnceContext,
  createExactlyOnceContext,
  type CheckpointState,
} from '../exactly-once-context'
import { createTemporalStore, type TemporalStore } from '../temporal-store'
import {
  WindowManager,
  CountTrigger,
  ProcessingTimeTrigger,
  Trigger,
  TriggerResult,
  milliseconds,
} from '../window-manager'
import { type MetricsCollector, noopMetrics } from '../observability'

// ============================================================================
// TYPES
// ============================================================================

/** Change operation types */
export enum ChangeType {
  INSERT = 'INSERT',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

/** Position in the change stream */
export interface CDCPosition {
  /** Monotonically increasing sequence number */
  sequence: number
  /** Timestamp when change was captured */
  timestamp: number
}

/** Metadata associated with a change */
export interface ChangeMetadata {
  /** Source system identifier */
  source?: string
  /** Processing timestamp */
  processedAt?: number
  /** Custom metadata */
  [key: string]: unknown
}

/** Schema change event */
export interface SchemaChangeEvent {
  type: 'ADD_COLUMN' | 'DROP_COLUMN' | 'MODIFY_COLUMN' | 'ADD_INDEX' | 'DROP_INDEX' | 'RENAME_TABLE'
  table: string
  column?: string
  columnType?: string
  oldColumnType?: string
  newTableName?: string
  timestamp?: number
}

/** Change event representing a single data change */
export interface ChangeEvent<T> {
  /** Unique event identifier for deduplication */
  eventId: string
  /** Type of change operation */
  type: ChangeType
  /** State before the change (null for INSERT) */
  before: T | null
  /** State after the change (null for DELETE) */
  after: T | null
  /** Timestamp of the change */
  timestamp: number
  /** Position in the stream */
  position: CDCPosition
  /** Whether this is a backfill record */
  isBackfill: boolean
  /** Table/collection name */
  table?: string
  /** Optional metadata */
  metadata?: ChangeMetadata
  /** Log sequence number (for transaction log capture) */
  lsn?: string
  /** Partition identifier */
  partition?: string
}

/** Handler for change events */
export type ChangeHandler<T> = (event: ChangeEvent<T>) => Promise<void>

/** Handler for batched change events */
export type BatchHandler<T> = (events: ChangeEvent<T>[]) => Promise<void>

/** Handler for schema changes */
export type SchemaChangeHandler = (change: SchemaChangeEvent) => Promise<void>

/** Handler for dead letter events */
export type DeadLetterHandler<T> = (event: ChangeEvent<T>, error: Error) => Promise<void>

/** Filter predicate for changes */
export type ChangeFilter<T> = (event: ChangeEvent<T>) => boolean

/** Metadata enricher function */
export type MetadataEnricher<T> = (event: ChangeEvent<T>) => ChangeMetadata

/** Options for insert/update/delete operations */
export interface ChangeOptions {
  /** Table/collection name */
  table?: string
  /** Custom event ID (auto-generated if not provided) */
  eventId?: string
  /** Custom metadata */
  metadata?: ChangeMetadata
}

/** CDC stream statistics */
export interface CDCStreamStats {
  insertCount: number
  updateCount: number
  deleteCount: number
  totalChanges: number
  backfillCount: number
  errorCount: number
  deadLetterCount: number
  avgProcessingLatencyMs: number
  lastProcessedPosition: CDCPosition | null
  lastCommittedPosition: CDCPosition | null
}

/** Checkpoint state for CDC stream */
export interface CDCCheckpointState {
  position: CDCPosition
  exactlyOnceState: CheckpointState
  processedEventIds: Set<string>
}

/** Options for creating a CDC stream */
export interface CDCStreamOptions<T, O = T> {
  /** Starting position for stream (for resumption) */
  startPosition?: CDCPosition
  /** Handler for individual changes */
  onChange?: ChangeHandler<O>
  /** Handler for batched changes */
  onBatch?: BatchHandler<O>
  /** Handler for schema changes */
  onSchemaChange?: SchemaChangeHandler
  /** Handler for dead letter events */
  onDeadLetter?: DeadLetterHandler<T>
  /** Batch size for triggering batch handler */
  batchSize?: number
  /** Batch timeout in milliseconds */
  batchTimeoutMs?: number
  /** Number of retry attempts */
  retryAttempts?: number
  /** Keep change history in temporal store */
  keepHistory?: boolean
  /** Filter predicate for changes */
  filter?: ChangeFilter<T>
  /** Change types to include */
  changeTypes?: ChangeType[]
  /** Tables/collections to include */
  tables?: string[]
  /** Transform function for changes */
  transform?: (event: ChangeEvent<T>) => ChangeEvent<O>
  /** Metadata enricher */
  enrichMetadata?: MetadataEnricher<T>
  /** Optional metrics collector */
  metrics?: MetricsCollector
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * CDCStream - Change Data Capture stream with exactly-once processing
 */
export class CDCStream<T, O = T> {
  private options: CDCStreamOptions<T, O>
  private exactlyOnce: ExactlyOnceContext
  private temporalStore: TemporalStore<ChangeEvent<T>> | null = null
  private windowManager: WindowManager<ChangeEvent<T>> | null = null
  private currentSequence: number = 0
  private lastCommittedPosition: CDCPosition | null = null
  private pendingChanges: ChangeEvent<T>[] = []
  private changeHistory: Map<string, ChangeEvent<T>[]> = new Map()
  private isBackfillMode: boolean = false
  private running: boolean = false
  private metrics: MetricsCollector
  private batchTrigger: Trigger<ChangeEvent<T>> | null = null
  private batchBuffer: ChangeEvent<T>[] = []
  private batchTimer: ReturnType<typeof setTimeout> | null = null

  // Statistics
  private stats: CDCStreamStats = {
    insertCount: 0,
    updateCount: 0,
    deleteCount: 0,
    totalChanges: 0,
    backfillCount: 0,
    errorCount: 0,
    deadLetterCount: 0,
    avgProcessingLatencyMs: 0,
    lastProcessedPosition: null,
    lastCommittedPosition: null,
  }
  private totalLatencyMs: number = 0
  private processedCount: number = 0

  constructor(options?: CDCStreamOptions<T, O>) {
    this.options = options ?? {}
    this.metrics = options?.metrics ?? noopMetrics

    // Initialize from start position if provided
    if (options?.startPosition) {
      this.currentSequence = options.startPosition.sequence
    }

    // Initialize exactly-once context for deduplication
    this.exactlyOnce = createExactlyOnceContext({
      onDeliver: async (events) => {
        // Process delivered events
        for (const event of events as ChangeEvent<O>[]) {
          if (this.options.onChange) {
            await this.options.onChange(event)
          }
        }
      },
    })

    // Initialize temporal store for history if enabled
    if (options?.keepHistory) {
      this.temporalStore = createTemporalStore<ChangeEvent<T>>()
    }

    // Initialize window manager for batching if batch handler provided
    if (options?.onBatch) {
      this.setupBatching()
    }
  }

  private setupBatching(): void {
    // Simple batching with count and/or time triggers
  }

  private addToBatch(event: ChangeEvent<T>): void {
    const batchSize = this.options.batchSize ?? 100
    const batchTimeoutMs = this.options.batchTimeoutMs

    this.batchBuffer.push(event)

    // Check count-based trigger
    if (this.batchBuffer.length >= batchSize) {
      this.flushBatch()
      return
    }

    // Setup time-based trigger if configured and not already set
    if (batchTimeoutMs && !this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.flushBatch()
      }, batchTimeoutMs)
    }
  }

  private async flushBatch(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    if (this.batchBuffer.length === 0) return

    const batch = [...this.batchBuffer]
    this.batchBuffer = []

    if (this.options.onBatch) {
      const transformed = batch.map((e) => this.transformEvent(e))
      await this.options.onBatch(transformed as ChangeEvent<O>[])
    }
  }

  // ============================================================================
  // PUBLIC API - Change Operations
  // ============================================================================

  /**
   * Emit an INSERT change event
   */
  async insert(record: T, options?: ChangeOptions): Promise<void> {
    const event = this.createChangeEvent(ChangeType.INSERT, null, record, options)
    await this.processEvent(event)
  }

  /**
   * Emit an UPDATE change event
   */
  async update(before: T, after: T, options?: ChangeOptions): Promise<void> {
    const event = this.createChangeEvent(ChangeType.UPDATE, before, after, options)
    await this.processEvent(event)
  }

  /**
   * Emit a DELETE change event
   */
  async delete(record: T, options?: ChangeOptions): Promise<void> {
    const event = this.createChangeEvent(ChangeType.DELETE, record, null, options)
    await this.processEvent(event)
  }

  /**
   * Process a pre-constructed change event (for deduplication)
   */
  async processChange(event: ChangeEvent<T>): Promise<void> {
    await this.processEvent(event)
  }

  // ============================================================================
  // PUBLIC API - Backfill
  // ============================================================================

  /**
   * Start backfill mode for initial sync
   */
  async startBackfill(): Promise<void> {
    this.isBackfillMode = true
  }

  /**
   * Insert a record during backfill
   */
  async backfillInsert(record: T, options?: ChangeOptions): Promise<void> {
    if (!this.isBackfillMode) {
      throw new Error('Not in backfill mode. Call startBackfill() first.')
    }
    const event = this.createChangeEvent(ChangeType.INSERT, null, record, options)
    event.isBackfill = true
    this.stats.backfillCount++
    await this.processEvent(event)
  }

  /**
   * End backfill mode and return the end position
   */
  async endBackfill(): Promise<CDCPosition> {
    this.isBackfillMode = false
    await this.flush()
    return this.getCurrentPosition()
  }

  // ============================================================================
  // PUBLIC API - Schema Changes
  // ============================================================================

  /**
   * Emit a schema change event
   */
  async emitSchemaChange(change: SchemaChangeEvent): Promise<void> {
    change.timestamp = change.timestamp ?? Date.now()
    if (this.options.onSchemaChange) {
      await this.options.onSchemaChange(change)
    }
  }

  // ============================================================================
  // PUBLIC API - Checkpointing
  // ============================================================================

  /**
   * Get the current stream position
   */
  getCurrentPosition(): CDCPosition {
    return {
      sequence: this.currentSequence,
      timestamp: Date.now(),
    }
  }

  /**
   * Get the last committed position
   */
  getLastCommittedPosition(): CDCPosition | null {
    return this.lastCommittedPosition
  }

  /**
   * Commit changes up to a position
   */
  async commit(position: CDCPosition): Promise<void> {
    this.lastCommittedPosition = position
    this.stats.lastCommittedPosition = position

    // Clear pending changes up to this position
    this.pendingChanges = this.pendingChanges.filter(
      (c) => c.position.sequence > position.sequence
    )
  }

  /**
   * Replay changes from a position
   */
  async replayFrom(position: CDCPosition): Promise<void> {
    // Get changes after the position
    const toReplay = this.pendingChanges.filter(
      (c) => c.position.sequence > position.sequence
    )

    // Re-process without deduplication for replay
    for (const event of toReplay) {
      await this.deliverEvent(event)
    }
  }

  /**
   * Get checkpoint state for persistence
   */
  async getCheckpointState(): Promise<CDCCheckpointState> {
    const exactlyOnceState = await this.exactlyOnce.getCheckpointState()
    return {
      position: this.getCurrentPosition(),
      exactlyOnceState,
      processedEventIds: exactlyOnceState.processedIds,
    }
  }

  /**
   * Restore from checkpoint state
   */
  async restoreFromCheckpoint(state: CDCCheckpointState): Promise<void> {
    this.currentSequence = state.position.sequence
    await this.exactlyOnce.restoreFromCheckpoint(state.exactlyOnceState)
    this.lastCommittedPosition = state.position
  }

  // ============================================================================
  // PUBLIC API - History & State
  // ============================================================================

  /**
   * Get change history for a key (requires keepHistory option)
   */
  async getChangeHistory(key: string): Promise<ChangeEvent<T>[]> {
    return this.changeHistory.get(key) ?? []
  }

  /**
   * Get state at a point in time (requires keepHistory option)
   */
  async getStateAsOf(key: string, timestamp: number): Promise<T | null> {
    const history = this.changeHistory.get(key) ?? []

    // Find the most recent change at or before the timestamp
    for (let i = history.length - 1; i >= 0; i--) {
      const event = history[i]!
      if (event.timestamp <= timestamp) {
        if (event.type === ChangeType.DELETE) {
          return null
        }
        return event.after
      }
    }
    return null
  }

  // ============================================================================
  // PUBLIC API - Lifecycle
  // ============================================================================

  /**
   * Start the CDC stream
   */
  async start(): Promise<void> {
    this.running = true
  }

  /**
   * Stop the CDC stream
   */
  async stop(): Promise<void> {
    await this.flush()
    this.running = false
  }

  /**
   * Check if stream is running
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * Flush all pending changes
   */
  async flush(): Promise<void> {
    // Flush batch buffer
    await this.flushBatch()

    // Flush exactly-once buffer
    await this.exactlyOnce.flush()
  }

  /**
   * Dispose of resources
   */
  async dispose(): Promise<void> {
    await this.stop()
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
    if (this.windowManager) {
      this.windowManager.dispose()
    }
    await this.exactlyOnce.clear()
  }

  // ============================================================================
  // PUBLIC API - Statistics
  // ============================================================================

  /**
   * Get stream statistics
   */
  getStats(): CDCStreamStats {
    return {
      ...this.stats,
      avgProcessingLatencyMs: this.processedCount > 0
        ? this.totalLatencyMs / this.processedCount
        : 0,
    }
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private createChangeEvent(
    type: ChangeType,
    before: T | null,
    after: T | null,
    options?: ChangeOptions
  ): ChangeEvent<T> {
    const timestamp = Date.now()
    this.currentSequence++

    const event: ChangeEvent<T> = {
      eventId: options?.eventId ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type,
      before,
      after,
      timestamp,
      position: {
        sequence: this.currentSequence,
        timestamp,
      },
      isBackfill: this.isBackfillMode,
      table: options?.table,
      metadata: options?.metadata,
    }

    // Enrich metadata if enricher provided
    if (this.options.enrichMetadata) {
      event.metadata = this.options.enrichMetadata(event)
    }

    return event
  }

  private async processEvent(event: ChangeEvent<T>): Promise<void> {
    const startTime = performance.now()

    try {
      // Apply filter
      if (!this.shouldProcess(event)) {
        return
      }

      // Deduplicate using exactly-once context
      await this.exactlyOnce.processOnce(event.eventId, async () => {
        await this.deliverEvent(event)
      })

      // Update stats
      this.updateStats(event)
      this.stats.lastProcessedPosition = event.position
    } catch (error) {
      this.stats.errorCount++
      await this.handleError(event, error as Error)
    } finally {
      const latency = performance.now() - startTime
      this.totalLatencyMs += latency
      this.processedCount++
    }
  }

  private shouldProcess(event: ChangeEvent<T>): boolean {
    // Filter by change types
    if (this.options.changeTypes && !this.options.changeTypes.includes(event.type)) {
      return false
    }

    // Filter by tables
    if (this.options.tables && event.table && !this.options.tables.includes(event.table)) {
      return false
    }

    // Apply custom filter
    if (this.options.filter && !this.options.filter(event)) {
      return false
    }

    return true
  }

  private transformEvent(event: ChangeEvent<T>): ChangeEvent<O> {
    if (this.options.transform) {
      return this.options.transform(event)
    }
    return event as unknown as ChangeEvent<O>
  }

  private async deliverEvent(event: ChangeEvent<T>): Promise<void> {
    // Store in history if enabled
    if (this.options.keepHistory) {
      const key = this.getKeyFromEvent(event)
      if (!this.changeHistory.has(key)) {
        this.changeHistory.set(key, [])
      }
      this.changeHistory.get(key)!.push(event)

      // Also store in temporal store
      if (this.temporalStore) {
        await this.temporalStore.put(key, event, event.timestamp)
      }
    }

    // Track pending for replay
    this.pendingChanges.push(event)

    // Use batching if configured
    if (this.options.onBatch) {
      this.addToBatch(event)
    } else {
      // Direct delivery if no batching
      const transformed = this.transformEvent(event)
      if (this.options.onChange) {
        await this.retryWithBackoff(async () => {
          await this.options.onChange!(transformed as ChangeEvent<O>)
        })
      }
    }
  }

  private getKeyFromEvent(event: ChangeEvent<T>): string {
    // Try to extract ID from the record
    const record = event.after ?? event.before
    if (record && typeof record === 'object' && 'id' in record) {
      return String((record as { id: unknown }).id)
    }
    return event.eventId
  }

  private async handleError(event: ChangeEvent<T>, error: Error): Promise<void> {
    if (this.options.onDeadLetter) {
      this.stats.deadLetterCount++
      await this.options.onDeadLetter(event, error)
    } else {
      throw error
    }
  }

  private async retryWithBackoff(fn: () => Promise<void>): Promise<void> {
    const maxAttempts = this.options.retryAttempts ?? 3
    let attempt = 0
    let lastError: Error | null = null

    while (attempt < maxAttempts) {
      try {
        await fn()
        return
      } catch (error) {
        lastError = error as Error
        attempt++
        if (attempt < maxAttempts) {
          // Exponential backoff
          const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
      }
    }

    throw lastError
  }

  private updateStats(event: ChangeEvent<T>): void {
    this.stats.totalChanges++
    switch (event.type) {
      case ChangeType.INSERT:
        this.stats.insertCount++
        break
      case ChangeType.UPDATE:
        this.stats.updateCount++
        break
      case ChangeType.DELETE:
        this.stats.deleteCount++
        break
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new CDC stream
 */
export function createCDCStream<T, O = T>(
  options?: CDCStreamOptions<T, O>
): CDCStream<T, O> {
  return new CDCStream<T, O>(options)
}
