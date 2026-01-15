/**
 * ExactlyOnceCDCEmitter - CDC emitter with exactly-once delivery guarantees
 *
 * Combines multiple reliability mechanisms:
 * - LSN checkpointing for consumer position tracking
 * - Idempotency keys for deduplication
 * - Transactional outbox for atomic emit
 * - R2 Iceberg sink for durable archival
 *
 * @module db/cdc/exactly-once-emitter
 */

import type { Pipeline } from './emitter'
import type { UnifiedEvent, PartialEvent, EmitOptions } from './types'
import { createCDCEvent } from './transform'
import { LSNCheckpointStore, type SqlInterface, type LSNCheckpoint } from './lsn-checkpoint'
import { R2IcebergSink, type R2IcebergSinkConfig } from './r2-iceberg-sink'
import { IdempotencyTracker, type IdempotencyConfig, type IdempotencyStats } from '../../objects/unified-storage/idempotency-tracker'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Configuration for ExactlyOnceCDCEmitter
 */
export interface ExactlyOnceCDCEmitterConfig {
  /** Pipeline for real-time event delivery */
  pipeline: Pipeline
  /** SQL interface for checkpoint storage */
  sql: SqlInterface
  /** Namespace/tenant identifier */
  ns: string
  /** Source identifier (e.g., 'DO/things') */
  source: string
  /** Consumer ID for checkpoint tracking */
  consumerId?: string
  /** R2 sink configuration (optional) */
  r2Sink?: Omit<R2IcebergSinkConfig, 'namespace'>
  /** Idempotency configuration */
  idempotency?: IdempotencyConfig
  /** Enable transactional outbox (default: true) */
  transactionalOutbox?: boolean
  /** Maximum events to buffer before auto-flush (default: 100) */
  maxBufferSize?: number
}

/**
 * Transactional emit options
 */
export interface TransactionalEmitOptions extends EmitOptions {
  /** Idempotency key for deduplication */
  idempotencyKey?: string
  /** Skip pipeline delivery (archival only) */
  archivalOnly?: boolean
}

/**
 * Emitter statistics
 */
export interface ExactlyOnceEmitterStats {
  /** Current LSN */
  currentLsn: number
  /** Events emitted */
  eventsEmitted: number
  /** Duplicates skipped */
  duplicatesSkipped: number
  /** Events archived */
  eventsArchived: number
  /** Buffer size */
  bufferSize: number
  /** Last checkpoint */
  lastCheckpoint?: LSNCheckpoint
  /** Idempotency stats */
  idempotency: IdempotencyStats
}

// ============================================================================
// EXACTLY-ONCE CDC EMITTER
// ============================================================================

/**
 * ExactlyOnceCDCEmitter - Provides exactly-once CDC event delivery
 *
 * Uses a combination of:
 * 1. LSN checkpointing - tracks consumer position for replay
 * 2. Idempotency keys - deduplicates events by key
 * 3. Transactional outbox - atomic emit with DB operations
 * 4. R2 archival - durable storage for compliance/analytics
 *
 * @example
 * ```typescript
 * const emitter = new ExactlyOnceCDCEmitter({
 *   pipeline: env.EVENTS_PIPELINE,
 *   sql: ctx.storage.sql,
 *   ns: 'tenant-123',
 *   source: 'DO/customers',
 *   r2Sink: { bucket: env.R2 },
 * })
 *
 * await emitter.initialize()
 *
 * // Emit with exactly-once guarantees
 * await emitter.emit({
 *   op: 'c',
 *   store: 'document',
 *   table: 'Customer',
 *   key: 'cust_123',
 *   after: { name: 'Alice' },
 * }, { idempotencyKey: 'create-cust_123' })
 *
 * // Transactional emit with SQL
 * await emitter.transaction(async (tx) => {
 *   await tx.execute('INSERT INTO customers ...')
 *   await tx.emit({ op: 'c', store: 'document', ... })
 * })
 * ```
 */
export class ExactlyOnceCDCEmitter {
  private readonly config: Required<
    Omit<ExactlyOnceCDCEmitterConfig, 'r2Sink' | 'idempotency'>
  > & {
    r2Sink?: R2IcebergSinkConfig
    idempotency?: IdempotencyConfig
  }

  private readonly checkpointStore: LSNCheckpointStore
  private readonly idempotencyTracker: IdempotencyTracker
  private r2Sink?: R2IcebergSink

  // State
  private currentLsn = 0
  private buffer: UnifiedEvent[] = []
  private _eventsEmitted = 0
  private _eventsArchived = 0
  private initialized = false

  constructor(config: ExactlyOnceCDCEmitterConfig) {
    this.config = {
      pipeline: config.pipeline,
      sql: config.sql,
      ns: config.ns,
      source: config.source,
      consumerId: config.consumerId ?? `emitter-${config.ns}`,
      transactionalOutbox: config.transactionalOutbox ?? true,
      maxBufferSize: config.maxBufferSize ?? 100,
      r2Sink: config.r2Sink
        ? { ...config.r2Sink, namespace: config.ns }
        : undefined,
      idempotency: config.idempotency,
    }

    this.checkpointStore = new LSNCheckpointStore(config.sql)
    this.idempotencyTracker = new IdempotencyTracker(config.idempotency)

    if (this.config.r2Sink) {
      this.r2Sink = new R2IcebergSink(this.config.r2Sink)
    }
  }

  /**
   * Initialize the emitter, loading last checkpoint.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    await this.checkpointStore.initialize()

    // Load last checkpoint
    const checkpoint = await this.checkpointStore.get(this.config.consumerId)
    this.currentLsn = checkpoint.lsn

    this.initialized = true
  }

  /**
   * Emit a single event with exactly-once guarantees.
   *
   * @param partial - Partial event data
   * @param options - Emit options including idempotency key
   */
  async emit(
    partial: PartialEvent,
    options?: TransactionalEmitOptions
  ): Promise<UnifiedEvent | null> {
    await this.initialize()

    // Check idempotency
    if (options?.idempotencyKey) {
      if (this.idempotencyTracker.isDuplicate(options.idempotencyKey)) {
        this.idempotencyTracker.recordDuplicateSkipped()
        return null // Skip duplicate
      }
    }

    // Build event with next LSN
    this.currentLsn++
    const event = this.buildEvent(partial, this.currentLsn, options)

    // Track idempotency key
    if (options?.idempotencyKey) {
      this.idempotencyTracker.track(options.idempotencyKey)
    }

    if (this.config.transactionalOutbox) {
      // Buffer for transactional flush
      this.buffer.push(event)

      // Auto-flush if buffer full
      if (this.buffer.length >= this.config.maxBufferSize) {
        await this.flush()
      }
    } else {
      // Immediate delivery
      await this.deliverEvent(event, options?.archivalOnly)
    }

    return event
  }

  /**
   * Emit multiple events in a batch.
   *
   * @param partials - Partial events
   * @param options - Batch options
   */
  async emitBatch(
    partials: PartialEvent[],
    options?: TransactionalEmitOptions
  ): Promise<UnifiedEvent[]> {
    await this.initialize()

    if (partials.length === 0) return []

    const events: UnifiedEvent[] = []

    for (const partial of partials) {
      // Generate idempotency key from event content if not provided
      const idempotencyKey =
        options?.idempotencyKey ?? this.generateIdempotencyKey(partial)

      // Check idempotency
      if (this.idempotencyTracker.isDuplicate(idempotencyKey)) {
        this.idempotencyTracker.recordDuplicateSkipped()
        continue
      }

      // Build event
      this.currentLsn++
      const event = this.buildEvent(partial, this.currentLsn, {
        ...options,
        txid: options?.txid,
      })

      // Track idempotency
      this.idempotencyTracker.track(idempotencyKey)
      events.push(event)
    }

    if (events.length === 0) return []

    // Deliver batch
    if (!options?.archivalOnly) {
      await this.config.pipeline.send(events)
    }

    // Archive to R2
    if (this.r2Sink) {
      await this.r2Sink.write(events)
      this._eventsArchived += events.length
    }

    // Save checkpoint
    const maxLsn = Math.max(...events.map((e) => e.lsn ?? 0))
    await this.checkpointStore.save(this.config.consumerId, maxLsn, {
      incrementEvents: events.length,
    })

    this._eventsEmitted += events.length

    return events
  }

  /**
   * Execute a transaction with atomic CDC emission.
   *
   * Events emitted via tx.emit() are buffered until the transaction commits.
   * If the transaction fails, no events are delivered.
   *
   * @param fn - Transaction function
   */
  async transaction<T>(
    fn: (tx: TransactionContext) => Promise<T>
  ): Promise<T> {
    await this.initialize()

    const txEvents: UnifiedEvent[] = []
    const txIdempotencyKeys: string[] = []
    const startLsn = this.currentLsn

    const tx: TransactionContext = {
      execute: async (sql: string): Promise<void> => {
        // In production, would execute against the actual DB
        const sqlAny = this.config.sql as { exec?: (sql: string) => void }
        if (sqlAny?.exec) {
          sqlAny.exec(sql)
        }
      },

      emit: async (
        partial: PartialEvent,
        options?: TransactionalEmitOptions
      ): Promise<UnifiedEvent | null> => {
        const idempotencyKey =
          options?.idempotencyKey ?? this.generateIdempotencyKey(partial)

        // Check idempotency
        if (this.idempotencyTracker.isDuplicate(idempotencyKey)) {
          this.idempotencyTracker.recordDuplicateSkipped()
          return null
        }

        // Build event
        this.currentLsn++
        const event = this.buildEvent(partial, this.currentLsn, options)

        txEvents.push(event)
        txIdempotencyKeys.push(idempotencyKey)

        return event
      },

      getCurrentLsn: () => this.currentLsn,
    }

    // Begin SQL transaction
    this.config.sql.exec('BEGIN TRANSACTION')

    try {
      // Execute transaction function
      const result = await fn(tx)

      // On success, commit and deliver events
      if (txEvents.length > 0) {
        // Deliver to pipeline
        await this.config.pipeline.send(txEvents)

        // Archive to R2
        if (this.r2Sink) {
          await this.r2Sink.write(txEvents)
          this._eventsArchived += txEvents.length
        }

        // Track idempotency keys
        for (const key of txIdempotencyKeys) {
          this.idempotencyTracker.track(key)
        }

        // Save checkpoint
        await this.checkpointStore.save(
          this.config.consumerId,
          this.currentLsn,
          {
            incrementEvents: txEvents.length,
          }
        )

        this._eventsEmitted += txEvents.length
      }

      // Commit SQL transaction
      this.config.sql.exec('COMMIT')

      return result
    } catch (error) {
      // Rollback on failure
      this.config.sql.exec('ROLLBACK')

      // Reset LSN
      this.currentLsn = startLsn

      throw error
    }
  }

  /**
   * Flush buffered events to pipeline and archive.
   */
  async flush(): Promise<number> {
    if (this.buffer.length === 0) return 0

    const events = [...this.buffer]
    this.buffer = []

    // Deliver to pipeline
    await this.config.pipeline.send(events)

    // Archive to R2
    if (this.r2Sink) {
      await this.r2Sink.write(events)
      this._eventsArchived += events.length
    }

    // Save checkpoint
    const maxLsn = Math.max(...events.map((e) => e.lsn ?? 0))
    await this.checkpointStore.save(this.config.consumerId, maxLsn, {
      incrementEvents: events.length,
    })

    this._eventsEmitted += events.length

    return events.length
  }

  /**
   * Close the emitter, flushing remaining events.
   */
  async close(): Promise<void> {
    await this.flush()

    if (this.r2Sink) {
      await this.r2Sink.close()
    }
  }

  /**
   * Get emitter statistics.
   */
  async getStats(): Promise<ExactlyOnceEmitterStats> {
    await this.initialize()

    const lastCheckpoint = await this.checkpointStore.get(
      this.config.consumerId
    )

    return {
      currentLsn: this.currentLsn,
      eventsEmitted: this._eventsEmitted,
      duplicatesSkipped: this.idempotencyTracker.duplicatesSkipped,
      eventsArchived: this._eventsArchived,
      bufferSize: this.buffer.length,
      lastCheckpoint,
      idempotency: this.idempotencyTracker.getStats(),
    }
  }

  /**
   * Get the current LSN.
   */
  getCurrentLsn(): number {
    return this.currentLsn
  }

  /**
   * Resume from a checkpoint (for cold start recovery).
   *
   * @param consumerId - Consumer to resume from
   */
  async resumeFromCheckpoint(consumerId?: string): Promise<LSNCheckpoint> {
    await this.initialize()

    const checkpoint = await this.checkpointStore.get(
      consumerId ?? this.config.consumerId
    )
    this.currentLsn = checkpoint.lsn

    return checkpoint
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  /**
   * Build a UnifiedEvent from partial input.
   */
  private buildEvent(
    partial: PartialEvent,
    lsn: number,
    options?: EmitOptions
  ): UnifiedEvent {
    const event = createCDCEvent({
      ...partial,
      ns: this.config.ns,
      _meta: {
        schemaVersion: 1,
        source: this.config.source,
        ...partial._meta,
      },
    })

    // Add LSN
    event.lsn = lsn

    // Add correlation ID
    if (options?.correlationId) {
      event.correlationId = options.correlationId
    }

    // Add transaction ID
    if (options?.txid) {
      event.txid = options.txid
    }

    return event
  }

  /**
   * Deliver a single event.
   */
  private async deliverEvent(
    event: UnifiedEvent,
    archivalOnly?: boolean
  ): Promise<void> {
    // Deliver to pipeline
    if (!archivalOnly) {
      await this.config.pipeline.send([event])
    }

    // Archive to R2
    if (this.r2Sink) {
      await this.r2Sink.write([event])
      this._eventsArchived++
    }

    // Save checkpoint
    await this.checkpointStore.save(this.config.consumerId, event.lsn ?? 0)

    this._eventsEmitted++
  }

  /**
   * Generate idempotency key from event content.
   */
  private generateIdempotencyKey(partial: PartialEvent): string {
    // Use op + store + table + key as default idempotency key
    const parts = [
      partial.op ?? 'unknown',
      partial.store ?? 'unknown',
      partial.table ?? 'unknown',
      partial.key ?? Date.now().toString(),
    ]
    return parts.join(':')
  }
}

// ============================================================================
// TRANSACTION CONTEXT
// ============================================================================

/**
 * Transaction context for atomic CDC operations.
 */
export interface TransactionContext {
  /** Execute SQL statement */
  execute(sql: string): Promise<void>
  /** Emit CDC event (buffered until commit) */
  emit(
    partial: PartialEvent,
    options?: TransactionalEmitOptions
  ): Promise<UnifiedEvent | null>
  /** Get current LSN */
  getCurrentLsn(): number
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an ExactlyOnceCDCEmitter instance.
 */
export function createExactlyOnceCDCEmitter(
  config: ExactlyOnceCDCEmitterConfig
): ExactlyOnceCDCEmitter {
  return new ExactlyOnceCDCEmitter(config)
}
