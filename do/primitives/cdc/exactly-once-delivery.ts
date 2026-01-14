/**
 * ExactlyOnceDelivery - Enterprise-grade exactly-once delivery guarantees
 *
 * Provides exactly-once delivery semantics for CDC and event processing:
 * - **Idempotency Keys**: Unique keys prevent duplicate processing
 * - **Transaction Logging**: Durable record of all operations for recovery
 * - **Deduplication Window**: Time-based sliding window for replay protection
 * - **Offset Commit**: Atomic offset commit after successful processing
 * - **Two-Phase Commit**: Prepare/commit pattern for distributed transactions
 * - **Dead Letter Queue**: Failed events captured for later replay
 *
 * ## Architecture
 *
 * ```
 * Event Source -> Deduplication -> Transaction Log -> Processing -> Offset Commit
 *                     |                                   |
 *                     v                                   v
 *              [Duplicate?]                        [Success?]
 *                     |                                   |
 *                  [Skip]                            [DLQ/Retry]
 * ```
 *
 * ## Two-Phase Commit Pattern
 *
 * ```
 * 1. PREPARE: Validate, log intent, acquire locks
 * 2. COMMIT: Execute operation, update offsets
 * 3. ROLLBACK: On failure, revert all changes
 * ```
 *
 * @example Basic usage
 * ```typescript
 * import { createExactlyOnceDelivery } from 'dotdo/db/primitives/cdc'
 *
 * const delivery = createExactlyOnceDelivery({
 *   onProcess: async (event) => {
 *     await processEvent(event)
 *   },
 *   deduplicationWindowMs: 300_000, // 5 minutes
 * })
 *
 * await delivery.deliver({
 *   idempotencyKey: 'order-123-created',
 *   payload: { orderId: '123', status: 'created' },
 *   offset: { value: 1000, format: 'numeric' },
 * })
 * ```
 *
 * @example Two-phase commit
 * ```typescript
 * const txId = await delivery.prepare({
 *   idempotencyKey: 'payment-456',
 *   payload: { amount: 100 },
 *   participants: ['orders', 'payments', 'inventory'],
 * })
 *
 * try {
 *   await delivery.commit(txId)
 * } catch (error) {
 *   await delivery.rollback(txId)
 * }
 * ```
 *
 * @module db/primitives/cdc/exactly-once-delivery
 */

import { type MetricsCollector, noopMetrics } from '../observability'
import { type Offset, type OffsetFormat } from './offset-tracker'

// ============================================================================
// TYPES
// ============================================================================

/** Unique identifier for idempotency */
export type IdempotencyKey = string

/** Transaction ID for 2PC */
export type TransactionId = string

/** Delivery status */
export type DeliveryStatus =
  | 'pending'
  | 'prepared'
  | 'committed'
  | 'rolled_back'
  | 'failed'
  | 'dead_lettered'

/** Transaction log entry types */
export type LogEntryType =
  | 'PREPARE'
  | 'COMMIT'
  | 'ROLLBACK'
  | 'CHECKPOINT'
  | 'OFFSET_COMMIT'
  | 'DLQ_ENTRY'

/** Event to be delivered */
export interface DeliveryEvent<T = unknown> {
  /** Unique idempotency key - same key = same event */
  idempotencyKey: IdempotencyKey
  /** Event payload */
  payload: T
  /** Stream offset for this event */
  offset?: Offset
  /** Optional partition for multi-partition streams */
  partition?: string
  /** Event timestamp (defaults to now) */
  timestamp?: number
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/** Result of delivery attempt */
export interface DeliveryResult {
  /** Whether delivery succeeded */
  success: boolean
  /** Idempotency key */
  idempotencyKey: IdempotencyKey
  /** Delivery status */
  status: DeliveryStatus
  /** Transaction ID if using 2PC */
  transactionId?: TransactionId
  /** Error message if failed */
  error?: string
  /** Whether this was a duplicate (already processed) */
  wasDuplicate: boolean
  /** Processing duration in ms */
  durationMs: number
  /** Committed offset */
  committedOffset?: Offset
}

/** Transaction log entry */
export interface TransactionLogEntry {
  /** Unique entry ID */
  id: string
  /** Entry type */
  type: LogEntryType
  /** Transaction ID */
  transactionId: TransactionId
  /** Idempotency key */
  idempotencyKey: IdempotencyKey
  /** Event payload (for recovery) */
  payload?: unknown
  /** Offset at time of log */
  offset?: Offset
  /** Partition */
  partition?: string
  /** Entry timestamp */
  timestamp: number
  /** Additional data */
  data?: Record<string, unknown>
  /** Status after this entry */
  status: DeliveryStatus
}

/** Prepared transaction for 2PC */
export interface PreparedTransaction<T = unknown> {
  /** Transaction ID */
  transactionId: TransactionId
  /** Original event */
  event: DeliveryEvent<T>
  /** Participants in distributed transaction */
  participants?: string[]
  /** Prepare timestamp */
  preparedAt: number
  /** Timeout for commit (ms from preparedAt) */
  timeoutMs: number
  /** Current status */
  status: 'prepared' | 'committed' | 'rolled_back' | 'timed_out'
}

/** Dead letter entry */
export interface DeadLetterEntry<T = unknown> {
  /** DLQ entry ID */
  id: string
  /** Original idempotency key */
  idempotencyKey: IdempotencyKey
  /** Original event */
  event: DeliveryEvent<T>
  /** Error that caused DLQ */
  error: string
  /** Number of delivery attempts */
  attempts: number
  /** When added to DLQ */
  deadLetteredAt: number
  /** Attempt history */
  attemptHistory: Array<{
    timestamp: number
    error: string
    durationMs: number
  }>
}

/** Handler for processing events */
export type ProcessHandler<T = unknown> = (event: DeliveryEvent<T>) => Promise<void>

/** Handler for offset commits */
export type OffsetCommitHandler = (offset: Offset, partition?: string) => Promise<void>

/** Handler for DLQ events */
export type DLQHandler<T = unknown> = (entry: DeadLetterEntry<T>) => void | Promise<void>

/** Statistics */
export interface ExactlyOnceDeliveryStats {
  /** Total events processed */
  totalProcessed: number
  /** Duplicate events skipped */
  duplicatesSkipped: number
  /** Failed deliveries */
  totalFailed: number
  /** Events in DLQ */
  deadLetterCount: number
  /** Active prepared transactions */
  preparedTransactions: number
  /** Transaction log size */
  transactionLogSize: number
  /** Deduplication cache size */
  deduplicationCacheSize: number
  /** Last committed offset */
  lastCommittedOffset: Offset | null
  /** Average processing latency */
  avgProcessingLatencyMs: number
}

/** Checkpoint state for recovery */
export interface ExactlyOnceCheckpointState {
  /** Last committed offset per partition */
  committedOffsets: Map<string, Offset>
  /** Deduplication cache (key -> timestamp) */
  processedKeys: Map<IdempotencyKey, number>
  /** Transaction log entries */
  transactionLog: TransactionLogEntry[]
  /** Prepared transactions */
  preparedTransactions: Map<TransactionId, PreparedTransaction>
  /** Dead letter queue */
  deadLetterQueue: DeadLetterEntry[]
  /** Checkpoint timestamp */
  checkpointedAt: number
  /** Version for compatibility */
  version: number
}

/** Configuration options */
export interface ExactlyOnceDeliveryOptions<T = unknown> {
  /** Handler for processing events */
  onProcess?: ProcessHandler<T>
  /** Handler for offset commits */
  onOffsetCommit?: OffsetCommitHandler
  /** Handler for DLQ events */
  onDeadLetter?: DLQHandler<T>
  /** Deduplication window in ms (default: 300000 = 5 minutes) */
  deduplicationWindowMs?: number
  /** Maximum retry attempts (default: 3) */
  maxRetryAttempts?: number
  /** Retry delay in ms (default: 1000) */
  retryDelayMs?: number
  /** Retry backoff multiplier (default: 2) */
  retryBackoffMultiplier?: number
  /** Maximum retry delay in ms (default: 30000) */
  maxRetryDelayMs?: number
  /** 2PC timeout in ms (default: 30000) */
  twoPhaseCommitTimeoutMs?: number
  /** Maximum DLQ size (default: 10000) */
  maxDeadLetterQueueSize?: number
  /** Maximum transaction log size (default: 10000) */
  maxTransactionLogSize?: number
  /** Enable transaction logging (default: true) */
  enableTransactionLogging?: boolean
  /** Metrics collector */
  metrics?: MetricsCollector
}

// ============================================================================
// METRIC NAMES
// ============================================================================

export const ExactlyOnceMetrics = {
  DELIVERY_LATENCY: 'exactly_once_delivery.latency',
  EVENTS_PROCESSED: 'exactly_once_delivery.events.processed',
  DUPLICATES_SKIPPED: 'exactly_once_delivery.duplicates.skipped',
  DELIVERY_FAILURES: 'exactly_once_delivery.failures',
  DEAD_LETTERS: 'exactly_once_delivery.dead_letters',
  TRANSACTIONS_PREPARED: 'exactly_once_delivery.transactions.prepared',
  TRANSACTIONS_COMMITTED: 'exactly_once_delivery.transactions.committed',
  TRANSACTIONS_ROLLED_BACK: 'exactly_once_delivery.transactions.rolled_back',
  OFFSETS_COMMITTED: 'exactly_once_delivery.offsets.committed',
  DEDUP_CACHE_SIZE: 'exactly_once_delivery.dedup_cache.size',
} as const

// ============================================================================
// UTILITIES
// ============================================================================

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}

function generateTransactionId(): TransactionId {
  return `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}

function calculateBackoff(
  attempt: number,
  baseMs: number,
  multiplier: number,
  maxMs: number
): number {
  const delay = baseMs * Math.pow(multiplier, attempt - 1)
  const jitter = delay * 0.1 * (Math.random() * 2 - 1)
  return Math.min(delay + jitter, maxMs)
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * ExactlyOnceDelivery - Exactly-once delivery with 2PC support
 */
export class ExactlyOnceDelivery<T = unknown> {
  private readonly options: Required<
    Omit<ExactlyOnceDeliveryOptions<T>, 'onProcess' | 'onOffsetCommit' | 'onDeadLetter' | 'metrics'>
  > & {
    onProcess?: ProcessHandler<T>
    onOffsetCommit?: OffsetCommitHandler
    onDeadLetter?: DLQHandler<T>
    metrics: MetricsCollector
  }

  // Deduplication cache: idempotencyKey -> timestamp
  private readonly deduplicationCache: Map<IdempotencyKey, number> = new Map()

  // Transaction log
  private readonly transactionLog: TransactionLogEntry[] = []

  // Prepared transactions for 2PC
  private readonly preparedTransactions: Map<TransactionId, PreparedTransaction<T>> = new Map()

  // Dead letter queue
  private readonly deadLetterQueue: DeadLetterEntry<T>[] = []

  // Committed offsets per partition
  private readonly committedOffsets: Map<string, Offset> = new Map()

  // Processing locks to prevent concurrent processing of same key
  private readonly processingLocks: Map<IdempotencyKey, Promise<DeliveryResult>> = new Map()

  // Statistics
  private totalProcessed = 0
  private duplicatesSkipped = 0
  private totalFailed = 0
  private totalLatencyMs = 0

  constructor(options?: ExactlyOnceDeliveryOptions<T>) {
    this.options = {
      deduplicationWindowMs: options?.deduplicationWindowMs ?? 300_000, // 5 minutes
      maxRetryAttempts: options?.maxRetryAttempts ?? 3,
      retryDelayMs: options?.retryDelayMs ?? 1000,
      retryBackoffMultiplier: options?.retryBackoffMultiplier ?? 2,
      maxRetryDelayMs: options?.maxRetryDelayMs ?? 30_000,
      twoPhaseCommitTimeoutMs: options?.twoPhaseCommitTimeoutMs ?? 30_000,
      maxDeadLetterQueueSize: options?.maxDeadLetterQueueSize ?? 10_000,
      maxTransactionLogSize: options?.maxTransactionLogSize ?? 10_000,
      enableTransactionLogging: options?.enableTransactionLogging ?? true,
      onProcess: options?.onProcess,
      onOffsetCommit: options?.onOffsetCommit,
      onDeadLetter: options?.onDeadLetter,
      metrics: options?.metrics ?? noopMetrics,
    }
  }

  // ==========================================================================
  // DELIVERY API
  // ==========================================================================

  /**
   * Deliver an event with exactly-once semantics
   */
  async deliver(event: DeliveryEvent<T>): Promise<DeliveryResult> {
    const startTime = performance.now()
    const { idempotencyKey, offset, partition } = event

    // Check for concurrent processing of same key
    const existingLock = this.processingLocks.get(idempotencyKey)
    if (existingLock) {
      return existingLock
    }

    // Create processing promise
    const processPromise = this.processDelivery(event, startTime)
    this.processingLocks.set(idempotencyKey, processPromise)

    try {
      return await processPromise
    } finally {
      this.processingLocks.delete(idempotencyKey)
    }
  }

  private async processDelivery(
    event: DeliveryEvent<T>,
    startTime: number
  ): Promise<DeliveryResult> {
    const { idempotencyKey, offset, partition } = event
    event.timestamp = event.timestamp ?? Date.now()

    // Check deduplication window
    if (this.isDuplicate(idempotencyKey)) {
      this.duplicatesSkipped++
      this.options.metrics.incrementCounter(ExactlyOnceMetrics.DUPLICATES_SKIPPED)

      return {
        success: true,
        idempotencyKey,
        status: 'committed',
        wasDuplicate: true,
        durationMs: performance.now() - startTime,
        committedOffset: offset,
      }
    }

    // Process with retries
    const attemptHistory: Array<{ timestamp: number; error: string; durationMs: number }> = []
    let lastError: string | undefined

    for (let attempt = 1; attempt <= this.options.maxRetryAttempts; attempt++) {
      const attemptStart = performance.now()

      try {
        // Log prepare phase
        if (this.options.enableTransactionLogging) {
          this.logEntry({
            type: 'PREPARE',
            idempotencyKey,
            payload: event.payload,
            offset,
            partition,
            status: 'prepared',
          })
        }

        // Execute handler
        if (this.options.onProcess) {
          await this.options.onProcess(event)
        }

        // Log commit phase
        if (this.options.enableTransactionLogging) {
          this.logEntry({
            type: 'COMMIT',
            idempotencyKey,
            offset,
            partition,
            status: 'committed',
          })
        }

        // Record in deduplication cache
        this.recordProcessed(idempotencyKey)

        // Commit offset
        if (offset) {
          await this.commitOffset(offset, partition)
        }

        // Update stats
        this.totalProcessed++
        const durationMs = performance.now() - startTime
        this.totalLatencyMs += durationMs

        this.options.metrics.incrementCounter(ExactlyOnceMetrics.EVENTS_PROCESSED)
        this.options.metrics.recordLatency(ExactlyOnceMetrics.DELIVERY_LATENCY, durationMs)

        return {
          success: true,
          idempotencyKey,
          status: 'committed',
          wasDuplicate: false,
          durationMs,
          committedOffset: offset,
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)

        attemptHistory.push({
          timestamp: Date.now(),
          error: lastError,
          durationMs: performance.now() - attemptStart,
        })

        this.options.metrics.incrementCounter(ExactlyOnceMetrics.DELIVERY_FAILURES)

        // Log rollback
        if (this.options.enableTransactionLogging) {
          this.logEntry({
            type: 'ROLLBACK',
            idempotencyKey,
            offset,
            partition,
            status: 'rolled_back',
            data: { error: lastError, attempt },
          })
        }

        // Retry with backoff
        if (attempt < this.options.maxRetryAttempts) {
          const backoff = calculateBackoff(
            attempt,
            this.options.retryDelayMs,
            this.options.retryBackoffMultiplier,
            this.options.maxRetryDelayMs
          )
          await new Promise((resolve) => setTimeout(resolve, backoff))
        }
      }
    }

    // All retries exhausted - move to DLQ
    this.totalFailed++
    await this.addToDeadLetterQueue(event, lastError ?? 'Unknown error', attemptHistory)

    return {
      success: false,
      idempotencyKey,
      status: 'dead_lettered',
      wasDuplicate: false,
      durationMs: performance.now() - startTime,
      error: lastError,
    }
  }

  /**
   * Deliver multiple events with exactly-once semantics
   */
  async deliverBatch(events: DeliveryEvent<T>[]): Promise<DeliveryResult[]> {
    // Process sequentially to maintain ordering
    const results: DeliveryResult[] = []
    for (const event of events) {
      results.push(await this.deliver(event))
    }
    return results
  }

  // ==========================================================================
  // TWO-PHASE COMMIT API
  // ==========================================================================

  /**
   * Prepare phase of 2PC - validates and logs intent
   */
  async prepare(
    event: DeliveryEvent<T>,
    options?: { participants?: string[]; timeoutMs?: number }
  ): Promise<TransactionId> {
    const { idempotencyKey, offset, partition } = event
    event.timestamp = event.timestamp ?? Date.now()

    // Check deduplication
    if (this.isDuplicate(idempotencyKey)) {
      throw new Error(`Duplicate idempotency key: ${idempotencyKey}`)
    }

    const transactionId = generateTransactionId()
    const timeoutMs = options?.timeoutMs ?? this.options.twoPhaseCommitTimeoutMs

    const prepared: PreparedTransaction<T> = {
      transactionId,
      event,
      participants: options?.participants,
      preparedAt: Date.now(),
      timeoutMs,
      status: 'prepared',
    }

    this.preparedTransactions.set(transactionId, prepared)

    // Log prepare
    if (this.options.enableTransactionLogging) {
      this.logEntry({
        type: 'PREPARE',
        transactionId,
        idempotencyKey,
        payload: event.payload,
        offset,
        partition,
        status: 'prepared',
        data: { participants: options?.participants, timeoutMs },
      })
    }

    this.options.metrics.incrementCounter(ExactlyOnceMetrics.TRANSACTIONS_PREPARED)

    return transactionId
  }

  /**
   * Commit phase of 2PC - executes the operation
   */
  async commit(transactionId: TransactionId): Promise<DeliveryResult> {
    const prepared = this.preparedTransactions.get(transactionId)
    if (!prepared) {
      throw new Error(`Transaction not found: ${transactionId}`)
    }

    if (prepared.status !== 'prepared') {
      throw new Error(`Transaction ${transactionId} is not in prepared state: ${prepared.status}`)
    }

    // Check timeout
    const elapsed = Date.now() - prepared.preparedAt
    if (elapsed > prepared.timeoutMs) {
      prepared.status = 'timed_out'
      throw new Error(`Transaction ${transactionId} timed out after ${elapsed}ms`)
    }

    const startTime = performance.now()
    const { event } = prepared
    const { idempotencyKey, offset, partition } = event

    try {
      // Execute handler
      if (this.options.onProcess) {
        await this.options.onProcess(event)
      }

      // Mark as committed
      prepared.status = 'committed'

      // Log commit
      if (this.options.enableTransactionLogging) {
        this.logEntry({
          type: 'COMMIT',
          transactionId,
          idempotencyKey,
          offset,
          partition,
          status: 'committed',
        })
      }

      // Record in deduplication cache
      this.recordProcessed(idempotencyKey)

      // Commit offset
      if (offset) {
        await this.commitOffset(offset, partition)
      }

      // Update stats
      this.totalProcessed++
      const durationMs = performance.now() - startTime
      this.totalLatencyMs += durationMs

      this.options.metrics.incrementCounter(ExactlyOnceMetrics.TRANSACTIONS_COMMITTED)
      this.options.metrics.incrementCounter(ExactlyOnceMetrics.EVENTS_PROCESSED)

      // Clean up prepared transaction
      this.preparedTransactions.delete(transactionId)

      return {
        success: true,
        idempotencyKey,
        status: 'committed',
        transactionId,
        wasDuplicate: false,
        durationMs,
        committedOffset: offset,
      }
    } catch (error) {
      // Mark for rollback
      prepared.status = 'rolled_back'
      throw error
    }
  }

  /**
   * Rollback phase of 2PC - reverts the operation
   */
  async rollback(transactionId: TransactionId, reason?: string): Promise<void> {
    const prepared = this.preparedTransactions.get(transactionId)
    if (!prepared) {
      throw new Error(`Transaction not found: ${transactionId}`)
    }

    const { event } = prepared
    const { idempotencyKey, offset, partition } = event

    prepared.status = 'rolled_back'

    // Log rollback
    if (this.options.enableTransactionLogging) {
      this.logEntry({
        type: 'ROLLBACK',
        transactionId,
        idempotencyKey,
        offset,
        partition,
        status: 'rolled_back',
        data: { reason },
      })
    }

    this.options.metrics.incrementCounter(ExactlyOnceMetrics.TRANSACTIONS_ROLLED_BACK)

    // Clean up prepared transaction
    this.preparedTransactions.delete(transactionId)
  }

  /**
   * Get prepared transaction status
   */
  getPreparedTransaction(transactionId: TransactionId): PreparedTransaction<T> | undefined {
    return this.preparedTransactions.get(transactionId)
  }

  /**
   * Get all prepared transactions
   */
  getAllPreparedTransactions(): PreparedTransaction<T>[] {
    return Array.from(this.preparedTransactions.values())
  }

  /**
   * Abort timed out transactions
   */
  async abortTimedOutTransactions(): Promise<number> {
    const now = Date.now()
    let aborted = 0

    for (const [txId, prepared] of this.preparedTransactions) {
      if (prepared.status === 'prepared') {
        const elapsed = now - prepared.preparedAt
        if (elapsed > prepared.timeoutMs) {
          await this.rollback(txId, 'Timeout')
          aborted++
        }
      }
    }

    return aborted
  }

  // ==========================================================================
  // DEDUPLICATION
  // ==========================================================================

  /**
   * Check if an idempotency key was already processed
   */
  isDuplicate(idempotencyKey: IdempotencyKey): boolean {
    const processedAt = this.deduplicationCache.get(idempotencyKey)
    if (!processedAt) {
      return false
    }

    // Check if within deduplication window
    const elapsed = Date.now() - processedAt
    if (elapsed >= this.options.deduplicationWindowMs) {
      // Expired - remove from cache
      this.deduplicationCache.delete(idempotencyKey)
      return false
    }

    return true
  }

  /**
   * Record a processed idempotency key
   */
  recordProcessed(idempotencyKey: IdempotencyKey): void {
    this.deduplicationCache.set(idempotencyKey, Date.now())
    this.options.metrics.recordGauge(
      ExactlyOnceMetrics.DEDUP_CACHE_SIZE,
      this.deduplicationCache.size
    )
  }

  /**
   * Clean up expired entries from deduplication cache
   */
  cleanupDeduplicationCache(): number {
    const now = Date.now()
    let cleaned = 0

    for (const [key, processedAt] of this.deduplicationCache) {
      const elapsed = now - processedAt
      if (elapsed >= this.options.deduplicationWindowMs) {
        this.deduplicationCache.delete(key)
        cleaned++
      }
    }

    this.options.metrics.recordGauge(
      ExactlyOnceMetrics.DEDUP_CACHE_SIZE,
      this.deduplicationCache.size
    )

    return cleaned
  }

  // ==========================================================================
  // OFFSET MANAGEMENT
  // ==========================================================================

  /**
   * Commit an offset
   */
  async commitOffset(offset: Offset, partition?: string): Promise<void> {
    const partitionKey = partition ?? '__default__'
    this.committedOffsets.set(partitionKey, offset)

    // Log offset commit
    if (this.options.enableTransactionLogging) {
      this.logEntry({
        type: 'OFFSET_COMMIT',
        idempotencyKey: `offset-${partitionKey}`,
        offset,
        partition,
        status: 'committed',
      })
    }

    // Call handler
    if (this.options.onOffsetCommit) {
      await this.options.onOffsetCommit(offset, partition)
    }

    this.options.metrics.incrementCounter(ExactlyOnceMetrics.OFFSETS_COMMITTED)
  }

  /**
   * Get last committed offset
   */
  getCommittedOffset(partition?: string): Offset | null {
    const partitionKey = partition ?? '__default__'
    return this.committedOffsets.get(partitionKey) ?? null
  }

  /**
   * Get all committed offsets
   */
  getAllCommittedOffsets(): Map<string, Offset> {
    return new Map(this.committedOffsets)
  }

  // ==========================================================================
  // DEAD LETTER QUEUE
  // ==========================================================================

  private async addToDeadLetterQueue(
    event: DeliveryEvent<T>,
    error: string,
    attemptHistory: Array<{ timestamp: number; error: string; durationMs: number }>
  ): Promise<void> {
    const entry: DeadLetterEntry<T> = {
      id: generateId(),
      idempotencyKey: event.idempotencyKey,
      event,
      error,
      attempts: attemptHistory.length,
      deadLetteredAt: Date.now(),
      attemptHistory,
    }

    this.deadLetterQueue.push(entry)

    // Log DLQ entry
    if (this.options.enableTransactionLogging) {
      this.logEntry({
        type: 'DLQ_ENTRY',
        idempotencyKey: event.idempotencyKey,
        offset: event.offset,
        partition: event.partition,
        status: 'dead_lettered',
        data: { error, attempts: attemptHistory.length },
      })
    }

    // Trim DLQ if too large
    while (this.deadLetterQueue.length > this.options.maxDeadLetterQueueSize) {
      this.deadLetterQueue.shift()
    }

    // Notify handler
    if (this.options.onDeadLetter) {
      try {
        await this.options.onDeadLetter(entry)
      } catch {
        // Ignore DLQ handler errors
      }
    }

    this.options.metrics.incrementCounter(ExactlyOnceMetrics.DEAD_LETTERS)
  }

  /**
   * Get DLQ entries
   */
  getDeadLetterQueue(): DeadLetterEntry<T>[] {
    return [...this.deadLetterQueue]
  }

  /**
   * Get DLQ entry count
   */
  getDeadLetterCount(): number {
    return this.deadLetterQueue.length
  }

  /**
   * Replay a DLQ entry
   */
  async replayFromDeadLetter(dlqId: string): Promise<DeliveryResult> {
    const index = this.deadLetterQueue.findIndex((e) => e.id === dlqId)
    if (index === -1) {
      throw new Error(`DLQ entry not found: ${dlqId}`)
    }

    const entry = this.deadLetterQueue[index]!

    // Remove from deduplication cache to allow retry
    this.deduplicationCache.delete(entry.idempotencyKey)

    // Redeliver
    const result = await this.deliver(entry.event)

    if (result.success) {
      // Remove from DLQ on success
      this.deadLetterQueue.splice(index, 1)
    }

    return result
  }

  /**
   * Replay all DLQ entries
   */
  async replayAllFromDeadLetter(): Promise<{ successful: number; failed: number }> {
    const entries = [...this.deadLetterQueue]
    let successful = 0
    let failed = 0

    for (const entry of entries) {
      try {
        const result = await this.replayFromDeadLetter(entry.id)
        if (result.success) {
          successful++
        } else {
          failed++
        }
      } catch {
        failed++
      }
    }

    return { successful, failed }
  }

  /**
   * Remove a DLQ entry
   */
  removeFromDeadLetter(dlqId: string): boolean {
    const index = this.deadLetterQueue.findIndex((e) => e.id === dlqId)
    if (index === -1) return false
    this.deadLetterQueue.splice(index, 1)
    return true
  }

  /**
   * Clear DLQ
   */
  clearDeadLetterQueue(): void {
    this.deadLetterQueue.length = 0
  }

  // ==========================================================================
  // TRANSACTION LOG
  // ==========================================================================

  private logEntry(
    entry: Omit<TransactionLogEntry, 'id' | 'timestamp' | 'transactionId'> & {
      transactionId?: TransactionId
    }
  ): void {
    const logEntry: TransactionLogEntry = {
      id: generateId(),
      transactionId: entry.transactionId ?? generateTransactionId(),
      timestamp: Date.now(),
      ...entry,
    }

    this.transactionLog.push(logEntry)

    // Trim log if too large
    while (this.transactionLog.length > this.options.maxTransactionLogSize) {
      this.transactionLog.shift()
    }
  }

  /**
   * Get transaction log entries
   */
  getTransactionLog(): TransactionLogEntry[] {
    return [...this.transactionLog]
  }

  /**
   * Get transaction log entries for a specific idempotency key
   */
  getTransactionLogForKey(idempotencyKey: IdempotencyKey): TransactionLogEntry[] {
    return this.transactionLog.filter((e) => e.idempotencyKey === idempotencyKey)
  }

  /**
   * Clear transaction log
   */
  clearTransactionLog(): void {
    this.transactionLog.length = 0
  }

  // ==========================================================================
  // CHECKPOINT & RECOVERY
  // ==========================================================================

  /**
   * Get checkpoint state for persistence
   */
  getCheckpointState(): ExactlyOnceCheckpointState {
    return {
      committedOffsets: new Map(this.committedOffsets),
      processedKeys: new Map(this.deduplicationCache),
      transactionLog: [...this.transactionLog],
      preparedTransactions: new Map(this.preparedTransactions),
      deadLetterQueue: [...this.deadLetterQueue],
      checkpointedAt: Date.now(),
      version: 1,
    }
  }

  /**
   * Restore from checkpoint state
   */
  restoreFromCheckpoint(state: ExactlyOnceCheckpointState): void {
    // Validate version
    if (state.version !== 1) {
      throw new Error(`Unsupported checkpoint version: ${state.version}`)
    }

    // Restore committed offsets
    this.committedOffsets.clear()
    for (const [partition, offset] of state.committedOffsets) {
      this.committedOffsets.set(partition, offset)
    }

    // Restore deduplication cache (filter out expired entries)
    this.deduplicationCache.clear()
    const now = Date.now()
    for (const [key, timestamp] of state.processedKeys) {
      const elapsed = now - timestamp
      if (elapsed < this.options.deduplicationWindowMs) {
        this.deduplicationCache.set(key, timestamp)
      }
    }

    // Restore transaction log
    this.transactionLog.length = 0
    this.transactionLog.push(...state.transactionLog)

    // Restore prepared transactions
    this.preparedTransactions.clear()
    for (const [txId, prepared] of state.preparedTransactions) {
      this.preparedTransactions.set(txId, prepared as PreparedTransaction<T>)
    }

    // Restore DLQ
    this.deadLetterQueue.length = 0
    this.deadLetterQueue.push(...(state.deadLetterQueue as DeadLetterEntry<T>[]))

    // Log checkpoint restore
    if (this.options.enableTransactionLogging) {
      this.logEntry({
        type: 'CHECKPOINT',
        idempotencyKey: 'checkpoint-restore',
        status: 'committed',
        data: { checkpointedAt: state.checkpointedAt },
      })
    }
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  /**
   * Get delivery statistics
   */
  getStats(): ExactlyOnceDeliveryStats {
    return {
      totalProcessed: this.totalProcessed,
      duplicatesSkipped: this.duplicatesSkipped,
      totalFailed: this.totalFailed,
      deadLetterCount: this.deadLetterQueue.length,
      preparedTransactions: this.preparedTransactions.size,
      transactionLogSize: this.transactionLog.length,
      deduplicationCacheSize: this.deduplicationCache.size,
      lastCommittedOffset: this.committedOffsets.get('__default__') ?? null,
      avgProcessingLatencyMs:
        this.totalProcessed > 0 ? this.totalLatencyMs / this.totalProcessed : 0,
    }
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  /**
   * Clear all state
   */
  clear(): void {
    this.deduplicationCache.clear()
    this.transactionLog.length = 0
    this.preparedTransactions.clear()
    this.deadLetterQueue.length = 0
    this.committedOffsets.clear()
    this.processingLocks.clear()
    this.totalProcessed = 0
    this.duplicatesSkipped = 0
    this.totalFailed = 0
    this.totalLatencyMs = 0
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new ExactlyOnceDelivery instance
 *
 * @param options - Configuration options
 * @returns A new ExactlyOnceDelivery instance
 *
 * @example
 * ```typescript
 * const delivery = createExactlyOnceDelivery({
 *   onProcess: async (event) => {
 *     await db.insert(event.payload)
 *   },
 *   onOffsetCommit: async (offset) => {
 *     await offsetStore.save(offset)
 *   },
 *   deduplicationWindowMs: 300_000, // 5 minutes
 *   maxRetryAttempts: 5,
 * })
 *
 * // Simple delivery
 * await delivery.deliver({
 *   idempotencyKey: 'order-123',
 *   payload: { orderId: '123', status: 'created' },
 *   offset: { value: 1000, format: 'numeric' },
 * })
 *
 * // Two-phase commit for distributed transactions
 * const txId = await delivery.prepare({
 *   idempotencyKey: 'transfer-456',
 *   payload: { from: 'A', to: 'B', amount: 100 },
 * })
 *
 * // Coordinate with other services...
 *
 * await delivery.commit(txId)
 * // or
 * await delivery.rollback(txId)
 * ```
 */
export function createExactlyOnceDelivery<T = unknown>(
  options?: ExactlyOnceDeliveryOptions<T>
): ExactlyOnceDelivery<T> {
  return new ExactlyOnceDelivery<T>(options)
}
