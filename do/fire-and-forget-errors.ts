/**
 * Fire-and-Forget Error Tracking Module
 *
 * Provides error tracking infrastructure for fire-and-forget event handlers.
 * Errors from non-awaited handlers are captured and can be queried later.
 *
 * Features:
 * - Captures errors from fire-and-forget handlers
 * - Stores errors in SQLite for persistence
 * - Provides query interface for failed operations
 * - Supports in-memory fallback when SQLite is unavailable
 *
 * @module do/fire-and-forget-errors
 */

import type { SqlStorage } from '@dotdo/db'
import { createLogger } from '@dotdo/utils'

const logger = createLogger('[FireAndForget]')

/**
 * Represents a captured error from a fire-and-forget operation
 */
export interface FireAndForgetError {
  /** Unique error ID */
  id: string
  /** Operation type (e.g., 'event.handler', 'workflow.send') */
  operation: string
  /** Event type if applicable (e.g., 'Order.placed') */
  eventType?: string | undefined
  /** Handler index if multiple handlers for same event */
  handlerIndex?: number | undefined
  /** Error message */
  message: string
  /** Error stack trace if available */
  stack?: string | undefined
  /** Error name/type (e.g., 'NetworkError', 'ValidationError') */
  errorType: string
  /** Whether the error is retriable */
  retriable: boolean
  /** Additional context data */
  context?: Record<string, unknown> | undefined
  /** Timestamp when error occurred */
  timestamp: number
  /** Number of attempts made before final failure */
  attempts?: number | undefined
  /** Whether error was recovered (retried successfully) */
  recovered: boolean
  /** Recovery timestamp if recovered */
  recoveredAt?: number | undefined
}

/**
 * Query options for fire-and-forget errors
 */
export interface ErrorQueryOptions {
  /** Filter by operation type */
  operation?: string
  /** Filter by event type */
  eventType?: string
  /** Filter by error type */
  errorType?: string
  /** Only show recovered errors */
  recoveredOnly?: boolean
  /** Only show unrecovered errors */
  unresolvedOnly?: boolean
  /** Filter errors since timestamp */
  since?: number
  /** Filter errors until timestamp */
  until?: number
  /** Limit results */
  limit?: number
  /** Offset for pagination */
  offset?: number
}

/**
 * Error statistics
 */
export interface ErrorStats {
  /** Total errors captured */
  total: number
  /** Errors by operation type */
  byOperation: Record<string, number>
  /** Errors by event type */
  byEventType: Record<string, number>
  /** Errors by error type */
  byErrorType: Record<string, number>
  /** Total recovered */
  recovered: number
  /** Total unrecovered */
  unresolved: number
  /** Recovery rate (recovered / total) */
  recoveryRate: number
}

/**
 * Fire-and-Forget Error Store Interface
 */
export interface FireAndForgetErrorStore {
  /**
   * Track an error from a fire-and-forget operation
   */
  track(error: Omit<FireAndForgetError, 'id' | 'timestamp' | 'recovered'>): void

  /**
   * Query tracked errors
   */
  query(options?: ErrorQueryOptions): FireAndForgetError[]

  /**
   * Get a specific error by ID
   */
  get(id: string): FireAndForgetError | null

  /**
   * Mark an error as recovered
   */
  markRecovered(id: string): boolean

  /**
   * Get error statistics
   */
  getStats(): ErrorStats

  /**
   * Clear all tracked errors (for testing/cleanup)
   */
  clear(): void

  /**
   * Get recent errors (last N)
   */
  getRecent(count?: number): FireAndForgetError[]

  /**
   * Count errors matching criteria
   */
  count(options?: ErrorQueryOptions): number
}

/**
 * Generate a unique error ID
 */
function generateErrorId(): string {
  return `ffe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Extract error information from any thrown value
 */
export function extractErrorInfo(error: unknown): {
  message: string
  stack?: string | undefined
  errorType: string
  retriable: boolean
} {
  if (error instanceof Error) {
    // Check for retriable property
    const retriable = 'retriable' in error
      ? Boolean((error as { retriable?: boolean }).retriable)
      : isRetriableByType(error)

    // Build result, only including stack if defined (exactOptionalPropertyTypes)
    const result: { message: string; stack?: string | undefined; errorType: string; retriable: boolean } = {
      message: error.message,
      errorType: error.name || 'Error',
      retriable
    }
    if (error.stack !== undefined) result.stack = error.stack
    return result
  }

  if (typeof error === 'string') {
    return {
      message: error,
      errorType: 'StringError',
      retriable: false
    }
  }

  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>
    return {
      message: obj.message ? String(obj.message) : JSON.stringify(error),
      errorType: obj.name ? String(obj.name) : 'ObjectError',
      retriable: 'retriable' in obj ? Boolean(obj.retriable) : false
    }
  }

  return {
    message: String(error),
    errorType: 'UnknownError',
    retriable: false
  }
}

/**
 * Check if an error type is retriable by its class name
 */
function isRetriableByType(error: Error): boolean {
  const retriableTypes = [
    'NetworkError',
    'TimeoutError',
    'ServiceUnavailableError',
    'RateLimitError',
    'ConnectionError',
    'TemporaryError'
  ]

  const nonRetriableTypes = [
    'ValidationError',
    'AuthenticationError',
    'AuthorizationError',
    'NotFoundError',
    'BadRequestError'
  ]

  if (nonRetriableTypes.includes(error.name)) {
    return false
  }

  if (retriableTypes.includes(error.name)) {
    return true
  }

  // Default: assume generic errors are not retriable
  return false
}

/**
 * Options for configuring the in-memory error store
 */
export interface InMemoryErrorStoreOptions {
  /**
   * Maximum number of errors to store in memory.
   * When exceeded, oldest errors are evicted (FIFO).
   * Default: 1000
   */
  maxSize?: number
}

/**
 * Default maximum size for in-memory error store
 */
const DEFAULT_MAX_ERROR_STORE_SIZE = 1000

/**
 * Create an in-memory fire-and-forget error store
 * Used when SQLite is not available or for testing
 *
 * @param options Configuration options including maxSize to prevent unbounded memory growth
 */
export function createInMemoryErrorStore(options: InMemoryErrorStoreOptions = {}): FireAndForgetErrorStore {
  const { maxSize = DEFAULT_MAX_ERROR_STORE_SIZE } = options
  const errors: FireAndForgetError[] = []

  return {
    track(data) {
      const error: FireAndForgetError = {
        ...data,
        id: generateErrorId(),
        timestamp: Date.now(),
        recovered: false
      }
      errors.push(error)

      // Evict oldest errors if we exceed maxSize (FIFO eviction)
      while (errors.length > maxSize) {
        errors.shift()
      }
    },

    query(options = {}) {
      let results = [...errors]

      if (options.operation) {
        results = results.filter(e => e.operation === options.operation)
      }

      if (options.eventType) {
        results = results.filter(e => e.eventType === options.eventType)
      }

      if (options.errorType) {
        results = results.filter(e => e.errorType === options.errorType)
      }

      if (options.recoveredOnly) {
        results = results.filter(e => e.recovered)
      }

      if (options.unresolvedOnly) {
        results = results.filter(e => !e.recovered)
      }

      if (options.since) {
        results = results.filter(e => e.timestamp >= options.since!)
      }

      if (options.until) {
        results = results.filter(e => e.timestamp <= options.until!)
      }

      // Sort by timestamp descending (newest first)
      results.sort((a, b) => b.timestamp - a.timestamp)

      const offset = options.offset || 0
      const limit = options.limit || 100

      return results.slice(offset, offset + limit)
    },

    get(id) {
      return errors.find(e => e.id === id) || null
    },

    markRecovered(id) {
      const error = errors.find(e => e.id === id)
      if (error && !error.recovered) {
        error.recovered = true
        error.recoveredAt = Date.now()
        return true
      }
      return false
    },

    getStats() {
      const byOperation: Record<string, number> = {}
      const byEventType: Record<string, number> = {}
      const byErrorType: Record<string, number> = {}
      let recovered = 0

      for (const error of errors) {
        byOperation[error.operation] = (byOperation[error.operation] || 0) + 1

        if (error.eventType) {
          byEventType[error.eventType] = (byEventType[error.eventType] || 0) + 1
        }

        byErrorType[error.errorType] = (byErrorType[error.errorType] || 0) + 1

        if (error.recovered) {
          recovered++
        }
      }

      const total = errors.length

      return {
        total,
        byOperation,
        byEventType,
        byErrorType,
        recovered,
        unresolved: total - recovered,
        recoveryRate: total > 0 ? recovered / total : 0
      }
    },

    clear() {
      errors.length = 0
    },

    getRecent(count = 10) {
      return this.query({ limit: count })
    },

    count(options = {}) {
      return this.query({ ...options, limit: Infinity }).length
    }
  }
}

/**
 * Create a SQLite-backed fire-and-forget error store
 */
export function createSQLiteErrorStore(sql: SqlStorage): FireAndForgetErrorStore {
  // Initialize table if needed (assumes migration has been run)
  // Table schema is in the migration

  return {
    track(data) {
      const id = generateErrorId()
      const timestamp = Date.now()

      sql.prepare(`
        INSERT INTO fire_and_forget_errors
        (id, operation, event_type, handler_index, message, stack, error_type, retriable, context, timestamp, attempts, recovered)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        data.operation,
        data.eventType || null,
        data.handlerIndex ?? null,
        data.message,
        data.stack || null,
        data.errorType,
        data.retriable ? 1 : 0,
        data.context ? JSON.stringify(data.context) : null,
        timestamp,
        data.attempts ?? null,
        0 // recovered = false
      ).run()
    },

    query(options = {}) {
      let query = 'SELECT * FROM fire_and_forget_errors WHERE 1=1'
      const params: unknown[] = []

      if (options.operation) {
        query += ' AND operation = ?'
        params.push(options.operation)
      }

      if (options.eventType) {
        query += ' AND event_type = ?'
        params.push(options.eventType)
      }

      if (options.errorType) {
        query += ' AND error_type = ?'
        params.push(options.errorType)
      }

      if (options.recoveredOnly) {
        query += ' AND recovered = 1'
      }

      if (options.unresolvedOnly) {
        query += ' AND recovered = 0'
      }

      if (options.since) {
        query += ' AND timestamp >= ?'
        params.push(options.since)
      }

      if (options.until) {
        query += ' AND timestamp <= ?'
        params.push(options.until)
      }

      query += ' ORDER BY timestamp DESC'

      const limit = options.limit || 100
      const offset = options.offset || 0
      query += ' LIMIT ? OFFSET ?'
      params.push(limit, offset)

      const result = sql.prepare(query).bind(...params).all() as { results: Record<string, unknown>[] }

      return result.results.map(mapRowToError)
    },

    get(id) {
      const row = sql.prepare('SELECT * FROM fire_and_forget_errors WHERE id = ?')
        .bind(id)
        .first() as Record<string, unknown> | null

      return row ? mapRowToError(row) : null
    },

    markRecovered(id) {
      const result = sql.prepare(`
        UPDATE fire_and_forget_errors
        SET recovered = 1, recovered_at = ?
        WHERE id = ? AND recovered = 0
      `).bind(Date.now(), id).run() as { meta?: { changes?: number } }

      return (result.meta?.changes ?? 0) > 0
    },

    getStats() {
      // Total count
      const totalRow = sql.prepare('SELECT COUNT(*) as count FROM fire_and_forget_errors').bind().first() as Record<string, unknown> | null
      const total = (totalRow?.count as number) || 0

      // Recovered count
      const recoveredRow = sql.prepare('SELECT COUNT(*) as count FROM fire_and_forget_errors WHERE recovered = 1').bind().first() as Record<string, unknown> | null
      const recovered = (recoveredRow?.count as number) || 0

      // By operation
      const opResults = sql.prepare('SELECT operation, COUNT(*) as count FROM fire_and_forget_errors GROUP BY operation').bind().all() as { results: Record<string, unknown>[] }
      const byOperation: Record<string, number> = {}
      for (const row of opResults.results) {
        byOperation[row.operation as string] = row.count as number
      }

      // By event type
      const etResults = sql.prepare('SELECT event_type, COUNT(*) as count FROM fire_and_forget_errors WHERE event_type IS NOT NULL GROUP BY event_type').bind().all() as { results: Record<string, unknown>[] }
      const byEventType: Record<string, number> = {}
      for (const row of etResults.results) {
        byEventType[row.event_type as string] = row.count as number
      }

      // By error type
      const errResults = sql.prepare('SELECT error_type, COUNT(*) as count FROM fire_and_forget_errors GROUP BY error_type').bind().all() as { results: Record<string, unknown>[] }
      const byErrorType: Record<string, number> = {}
      for (const row of errResults.results) {
        byErrorType[row.error_type as string] = row.count as number
      }

      return {
        total,
        byOperation,
        byEventType,
        byErrorType,
        recovered,
        unresolved: total - recovered,
        recoveryRate: total > 0 ? recovered / total : 0
      }
    },

    clear() {
      sql.prepare('DELETE FROM fire_and_forget_errors').bind().run()
    },

    getRecent(count = 10) {
      return this.query({ limit: count })
    },

    count(options = {}) {
      let query = 'SELECT COUNT(*) as count FROM fire_and_forget_errors WHERE 1=1'
      const params: unknown[] = []

      if (options.operation) {
        query += ' AND operation = ?'
        params.push(options.operation)
      }

      if (options.eventType) {
        query += ' AND event_type = ?'
        params.push(options.eventType)
      }

      if (options.errorType) {
        query += ' AND error_type = ?'
        params.push(options.errorType)
      }

      if (options.recoveredOnly) {
        query += ' AND recovered = 1'
      }

      if (options.unresolvedOnly) {
        query += ' AND recovered = 0'
      }

      if (options.since) {
        query += ' AND timestamp >= ?'
        params.push(options.since)
      }

      if (options.until) {
        query += ' AND timestamp <= ?'
        params.push(options.until)
      }

      const result = sql.prepare(query).bind(...params).first() as Record<string, unknown> | null
      return (result?.count as number) || 0
    }
  }
}

/**
 * Map a database row to a FireAndForgetError
 */
function mapRowToError(row: Record<string, unknown>): FireAndForgetError {
  return {
    id: row.id as string,
    operation: row.operation as string,
    eventType: row.event_type as string | undefined,
    handlerIndex: row.handler_index as number | undefined,
    message: row.message as string,
    stack: row.stack as string | undefined,
    errorType: row.error_type as string,
    retriable: (row.retriable as number) === 1,
    context: row.context ? JSON.parse(row.context as string) : undefined,
    timestamp: row.timestamp as number,
    attempts: row.attempts as number | undefined,
    recovered: (row.recovered as number) === 1,
    recoveredAt: row.recovered_at as number | undefined
  }
}

/**
 * Wrap a fire-and-forget operation with error tracking
 *
 * Use this to wrap any promise that is not awaited to ensure errors are captured.
 *
 * @example
 * ```ts
 * // Instead of:
 * doSomethingAsync().catch(console.error)
 *
 * // Use:
 * trackFireAndForget(
 *   errorStore,
 *   doSomethingAsync(),
 *   'my-operation',
 *   { eventType: 'Order.placed' }
 * )
 * ```
 */
export function trackFireAndForget(
  store: FireAndForgetErrorStore,
  promise: Promise<unknown>,
  operation: string,
  options: {
    eventType?: string
    handlerIndex?: number
    context?: Record<string, unknown>
    attempts?: number
  } = {}
): void {
  promise.catch((error: unknown) => {
    const errorInfo = extractErrorInfo(error)

    store.track({
      operation,
      eventType: options.eventType,
      handlerIndex: options.handlerIndex,
      message: errorInfo.message,
      stack: errorInfo.stack,
      errorType: errorInfo.errorType,
      retriable: errorInfo.retriable,
      context: options.context,
      attempts: options.attempts
    })

    // Still log for visibility
    logger.error(`[${operation}] Fire-and-forget error:`, error)
  })
}

// ============================================================================
// Retry Queue System
// ============================================================================

/**
 * Represents an item in the retry queue
 */
export interface RetryQueueItem {
  /** Unique ID for this retry attempt */
  id: string
  /** Reference to the original error ID in the error store */
  errorId: string
  /** Event type to retry */
  eventType: string
  /** Event payload to pass to handlers */
  payload: unknown
  /** Handler function to retry */
  handlerFn?: (() => Promise<void>) | undefined
  /** Number of attempts so far */
  attempts: number
  /** Maximum retry attempts allowed */
  maxAttempts: number
  /** Timestamp when added to queue */
  addedAt: number
  /** Timestamp for next retry attempt */
  nextRetryAt: number
  /** Current backoff delay in milliseconds */
  backoffDelay: number
  /** Status of this retry item */
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'abandoned'
  /** Last error message if failed */
  lastError?: string | undefined
}

/**
 * Options for configuring the retry queue
 */
export interface RetryQueueOptions {
  /** Maximum retry attempts (default: 5) */
  maxAttempts?: number
  /** Initial backoff delay in ms (default: 100) */
  initialBackoff?: number
  /** Maximum backoff delay in ms (default: 60000) */
  maxBackoff?: number
  /** Backoff multiplier (default: 2 for exponential) */
  backoffMultiplier?: number
  /** Whether to process retries automatically (default: true) */
  autoProcess?: boolean
  /** Interval in ms to check for pending retries (default: 1000) */
  processInterval?: number
}

/**
 * Retry queue statistics
 */
export interface RetryQueueStats {
  /** Total items in queue */
  total: number
  /** Items pending retry */
  pending: number
  /** Items currently being processed */
  processing: number
  /** Items that succeeded */
  succeeded: number
  /** Items that permanently failed */
  failed: number
  /** Items abandoned (max attempts exceeded) */
  abandoned: number
  /** Items by event type */
  byEventType: Record<string, number>
}

/**
 * Query options for retry queue
 */
export interface RetryQueueQueryOptions {
  /** Filter by event type */
  eventType?: string
  /** Filter by status */
  status?: RetryQueueItem['status']
  /** Items ready for retry (nextRetryAt <= now) */
  readyForRetry?: boolean
  /** Limit results */
  limit?: number
}

/**
 * Retry Queue interface for managing failed handler retries
 */
export interface RetryQueue {
  /**
   * Add a failed handler to the retry queue
   */
  add(item: {
    errorId: string
    eventType: string
    payload: unknown
    handlerFn?: () => Promise<void>
  }): string

  /**
   * Get a specific retry item
   */
  get(id: string): RetryQueueItem | null | Promise<RetryQueueItem | null>

  /**
   * Query items in the retry queue
   */
  query(options?: RetryQueueQueryOptions): RetryQueueItem[]

  /**
   * Get items ready for retry
   */
  getReadyItems(): RetryQueueItem[]

  /**
   * Process a single retry item
   * Returns true if succeeded, false if failed
   */
  processItem(id: string): Promise<boolean>

  /**
   * Process all ready items
   * Returns count of items processed and succeeded
   */
  processReady(): Promise<{ processed: number; succeeded: number }>

  /**
   * Mark an item as succeeded
   */
  markSucceeded(id: string): void

  /**
   * Mark an item as failed (will be retried if attempts < maxAttempts)
   */
  markFailed(id: string, error: string): void

  /**
   * Remove an item from the queue
   */
  remove(id: string): boolean

  /**
   * Get queue statistics
   */
  getStats(): RetryQueueStats

  /**
   * Clear all items from queue
   */
  clear(): void

  /**
   * Start automatic processing of the queue
   */
  startAutoProcess(): void

  /**
   * Stop automatic processing
   */
  stopAutoProcess(): void
}

/**
 * Generate a unique retry queue item ID
 */
function generateRetryId(): string {
  return `retry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Calculate the next backoff delay with exponential backoff
 */
function calculateNextBackoff(
  currentDelay: number,
  multiplier: number,
  maxBackoff: number
): number {
  const nextDelay = currentDelay * multiplier
  return Math.min(nextDelay, maxBackoff)
}

/**
 * Create an in-memory retry queue
 */
export function createInMemoryRetryQueue(
  errorStore: FireAndForgetErrorStore,
  options: RetryQueueOptions = {}
): RetryQueue {
  const {
    maxAttempts = 5,
    initialBackoff = 100,
    maxBackoff = 60000,
    backoffMultiplier = 2,
    autoProcess = false,
    processInterval = 1000
  } = options

  const items = new Map<string, RetryQueueItem>()
  let autoProcessTimer: ReturnType<typeof setInterval> | null = null

  const queue: RetryQueue = {
    add(data) {
      const id = generateRetryId()
      const now = Date.now()

      const item: RetryQueueItem = {
        id,
        errorId: data.errorId,
        eventType: data.eventType,
        payload: data.payload,
        handlerFn: data.handlerFn,
        attempts: 0,
        maxAttempts,
        addedAt: now,
        nextRetryAt: now + initialBackoff,
        backoffDelay: initialBackoff,
        status: 'pending'
      }

      items.set(id, item)
      return id
    },

    get(id) {
      return items.get(id) || null
    },

    query(queryOptions = {}) {
      let results = Array.from(items.values())
      const now = Date.now()

      if (queryOptions.eventType) {
        results = results.filter(item => item.eventType === queryOptions.eventType)
      }

      if (queryOptions.status) {
        results = results.filter(item => item.status === queryOptions.status)
      }

      if (queryOptions.readyForRetry) {
        results = results.filter(
          item => item.status === 'pending' && item.nextRetryAt <= now
        )
      }

      // Sort by nextRetryAt ascending (earliest first)
      results.sort((a, b) => a.nextRetryAt - b.nextRetryAt)

      if (queryOptions.limit) {
        results = results.slice(0, queryOptions.limit)
      }

      return results
    },

    getReadyItems() {
      return this.query({ readyForRetry: true })
    },

    async processItem(id) {
      const item = items.get(id)
      if (!item) return false
      if (item.status !== 'pending') return false

      item.status = 'processing'
      item.attempts++

      try {
        if (item.handlerFn) {
          await item.handlerFn()
        } else {
          // If no handler function, we can't actually retry
          // This would need to be integrated with the event system
          throw new Error('No handler function available for retry')
        }

        this.markSucceeded(id)
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.markFailed(id, message)
        return false
      }
    },

    async processReady() {
      const ready = this.getReadyItems()
      let succeeded = 0

      for (const item of ready) {
        const result = await this.processItem(item.id)
        if (result) succeeded++
      }

      return { processed: ready.length, succeeded }
    },

    markSucceeded(id) {
      const item = items.get(id)
      if (!item) return

      item.status = 'succeeded'

      // Mark the original error as recovered
      errorStore.markRecovered(item.errorId)
    },

    markFailed(id, error) {
      const item = items.get(id)
      if (!item) return

      item.lastError = error

      if (item.attempts >= item.maxAttempts) {
        item.status = 'abandoned'
      } else {
        item.status = 'pending'
        item.backoffDelay = calculateNextBackoff(
          item.backoffDelay,
          backoffMultiplier,
          maxBackoff
        )
        item.nextRetryAt = Date.now() + item.backoffDelay
      }
    },

    remove(id) {
      return items.delete(id)
    },

    getStats() {
      const stats: RetryQueueStats = {
        total: 0,
        pending: 0,
        processing: 0,
        succeeded: 0,
        failed: 0,
        abandoned: 0,
        byEventType: {}
      }

      for (const item of items.values()) {
        stats.total++

        switch (item.status) {
          case 'pending':
            stats.pending++
            break
          case 'processing':
            stats.processing++
            break
          case 'succeeded':
            stats.succeeded++
            break
          case 'failed':
            stats.failed++
            break
          case 'abandoned':
            stats.abandoned++
            break
        }

        stats.byEventType[item.eventType] =
          (stats.byEventType[item.eventType] || 0) + 1
      }

      return stats
    },

    clear() {
      items.clear()
    },

    startAutoProcess() {
      if (autoProcessTimer) return

      autoProcessTimer = setInterval(async () => {
        await this.processReady()
      }, processInterval)
    },

    stopAutoProcess() {
      if (autoProcessTimer) {
        clearInterval(autoProcessTimer)
        autoProcessTimer = null
      }
    }
  }

  // Start auto-processing if enabled
  if (autoProcess) {
    queue.startAutoProcess()
  }

  return queue
}

/**
 * Create a SQLite-backed retry queue
 */
export function createSQLiteRetryQueue(
  sql: SqlStorage,
  errorStore: FireAndForgetErrorStore,
  options: RetryQueueOptions = {}
): RetryQueue {
  const {
    maxAttempts = 5,
    initialBackoff = 100,
    maxBackoff = 60000,
    backoffMultiplier = 2,
    autoProcess = false,
    processInterval = 1000
  } = options

  // Handler functions can't be stored in SQLite, so we keep them in memory
  const handlerFns = new Map<string, () => Promise<void>>()
  let autoProcessTimer: ReturnType<typeof setInterval> | null = null

  // Ensure table exists (should be created by migration)
  sql.exec(`
    CREATE TABLE IF NOT EXISTS retry_queue (
      id TEXT PRIMARY KEY,
      error_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL,
      added_at INTEGER NOT NULL,
      next_retry_at INTEGER NOT NULL,
      backoff_delay INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_retry_queue_status ON retry_queue(status);
    CREATE INDEX IF NOT EXISTS idx_retry_queue_next_retry ON retry_queue(next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_retry_queue_event_type ON retry_queue(event_type);
  `)

  function mapRowToItem(row: Record<string, unknown>): RetryQueueItem {
    const id = row.id as string
    return {
      id,
      errorId: row.error_id as string,
      eventType: row.event_type as string,
      payload: row.payload ? JSON.parse(row.payload as string) : undefined,
      handlerFn: handlerFns.get(id),
      attempts: row.attempts as number,
      maxAttempts: row.max_attempts as number,
      addedAt: row.added_at as number,
      nextRetryAt: row.next_retry_at as number,
      backoffDelay: row.backoff_delay as number,
      status: row.status as RetryQueueItem['status'],
      lastError: row.last_error as string | undefined
    }
  }

  const queue: RetryQueue = {
    add(data) {
      const id = generateRetryId()
      const now = Date.now()

      sql.prepare(`
        INSERT INTO retry_queue
        (id, error_id, event_type, payload, attempts, max_attempts, added_at, next_retry_at, backoff_delay, status)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'pending')
      `).bind(
        id,
        data.errorId,
        data.eventType,
        data.payload ? JSON.stringify(data.payload) : null,
        maxAttempts,
        now,
        now + initialBackoff,
        initialBackoff
      ).run()

      if (data.handlerFn) {
        handlerFns.set(id, data.handlerFn)
      }

      return id
    },

    get(id) {
      const row = sql.prepare('SELECT * FROM retry_queue WHERE id = ?')
        .bind(id)
        .first() as Record<string, unknown> | null

      return row ? mapRowToItem(row) : null
    },

    query(queryOptions = {}) {
      let sqlQuery = 'SELECT * FROM retry_queue WHERE 1=1'
      const params: unknown[] = []
      const now = Date.now()

      if (queryOptions.eventType) {
        sqlQuery += ' AND event_type = ?'
        params.push(queryOptions.eventType)
      }

      if (queryOptions.status) {
        sqlQuery += ' AND status = ?'
        params.push(queryOptions.status)
      }

      if (queryOptions.readyForRetry) {
        sqlQuery += ' AND status = ? AND next_retry_at <= ?'
        params.push('pending', now)
      }

      sqlQuery += ' ORDER BY next_retry_at ASC'

      if (queryOptions.limit) {
        sqlQuery += ' LIMIT ?'
        params.push(queryOptions.limit)
      }

      const result = sql.prepare(sqlQuery).bind(...params).all() as { results: Record<string, unknown>[] }
      return result.results.map(mapRowToItem)
    },

    getReadyItems() {
      return this.query({ readyForRetry: true })
    },

    async processItem(id) {
      const item = this.get(id)
      if (!item) return false
      if (item.status !== 'pending') return false

      // Update status to processing
      sql.prepare(`
        UPDATE retry_queue SET status = 'processing', attempts = attempts + 1
        WHERE id = ?
      `).bind(id).run()

      try {
        const handlerFn = handlerFns.get(id)
        if (handlerFn) {
          await handlerFn()
        } else {
          throw new Error('No handler function available for retry')
        }

        this.markSucceeded(id)
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.markFailed(id, message)
        return false
      }
    },

    async processReady() {
      const ready = this.getReadyItems()
      let succeeded = 0

      for (const item of ready) {
        const result = await this.processItem(item.id)
        if (result) succeeded++
      }

      return { processed: ready.length, succeeded }
    },

    markSucceeded(id) {
      sql.prepare(`UPDATE retry_queue SET status = 'succeeded' WHERE id = ?`)
        .bind(id)
        .run()

      const item = this.get(id)
      if (item) {
        errorStore.markRecovered(item.errorId)
      }

      // Clean up handler function
      handlerFns.delete(id)
    },

    markFailed(id, error) {
      const item = this.get(id)
      if (!item) return

      // Get current attempts from DB (already incremented during processItem)
      const row = sql.prepare('SELECT attempts FROM retry_queue WHERE id = ?').bind(id).first() as Record<string, unknown> | null
      const attempts = (row?.attempts as number) || item.attempts

      if (attempts >= item.maxAttempts) {
        sql.prepare(`UPDATE retry_queue SET status = 'abandoned', last_error = ? WHERE id = ?`)
          .bind(error, id)
          .run()

        // Clean up handler function
        handlerFns.delete(id)
      } else {
        const newBackoff = calculateNextBackoff(item.backoffDelay, backoffMultiplier, maxBackoff)
        const nextRetryAt = Date.now() + newBackoff

        sql.prepare(`
          UPDATE retry_queue
          SET status = 'pending', backoff_delay = ?, next_retry_at = ?, last_error = ?
          WHERE id = ?
        `).bind(newBackoff, nextRetryAt, error, id).run()
      }
    },

    remove(id) {
      const result = sql.prepare('DELETE FROM retry_queue WHERE id = ?')
        .bind(id)
        .run() as { meta?: { changes?: number } }

      handlerFns.delete(id)
      return (result.meta?.changes ?? 0) > 0
    },

    getStats() {
      const stats: RetryQueueStats = {
        total: 0,
        pending: 0,
        processing: 0,
        succeeded: 0,
        failed: 0,
        abandoned: 0,
        byEventType: {}
      }

      // Count by status
      const totalRow = sql.prepare('SELECT COUNT(*) as count FROM retry_queue').bind().first() as Record<string, unknown> | null
      stats.total = (totalRow?.count as number) || 0

      const statusCounts = sql.prepare(
        'SELECT status, COUNT(*) as count FROM retry_queue GROUP BY status'
      ).bind().all() as { results: Record<string, unknown>[] }

      for (const row of statusCounts.results) {
        const status = row.status as string
        const count = row.count as number

        switch (status) {
          case 'pending':
            stats.pending = count
            break
          case 'processing':
            stats.processing = count
            break
          case 'succeeded':
            stats.succeeded = count
            break
          case 'failed':
            stats.failed = count
            break
          case 'abandoned':
            stats.abandoned = count
            break
        }
      }

      // Count by event type
      const typeCounts = sql.prepare(
        'SELECT event_type, COUNT(*) as count FROM retry_queue GROUP BY event_type'
      ).bind().all() as { results: Record<string, unknown>[] }

      for (const row of typeCounts.results) {
        stats.byEventType[row.event_type as string] = row.count as number
      }

      return stats
    },

    clear() {
      sql.prepare('DELETE FROM retry_queue').bind().run()
      handlerFns.clear()
    },

    startAutoProcess() {
      if (autoProcessTimer) return

      autoProcessTimer = setInterval(async () => {
        await this.processReady()
      }, processInterval)
    },

    stopAutoProcess() {
      if (autoProcessTimer) {
        clearInterval(autoProcessTimer)
        autoProcessTimer = null
      }
    }
  }

  if (autoProcess) {
    queue.startAutoProcess()
  }

  return queue
}

// ============================================================================
// Enhanced Error Store with Retry Queue
// ============================================================================

/**
 * Extended error store interface that includes retry queue
 */
export interface EnhancedFireAndForgetErrorStore extends FireAndForgetErrorStore {
  /** Retry queue for failed handlers */
  retryQueue: RetryQueue

  /**
   * Add a failed handler to both error store and retry queue
   */
  trackAndRetry(
    error: Omit<FireAndForgetError, 'id' | 'timestamp' | 'recovered'>,
    handlerFn?: () => Promise<void>
  ): { errorId: string; retryId: string | null }

  /**
   * Query failed handlers with combined error and retry info
   */
  queryFailedHandlers(options?: ErrorQueryOptions): Array<{
    error: FireAndForgetError
    retryStatus?: RetryQueueItem
  }>
}

/**
 * Create an enhanced error store with retry queue
 */
export function createEnhancedErrorStore(
  baseStore: FireAndForgetErrorStore,
  retryQueue: RetryQueue
): EnhancedFireAndForgetErrorStore {
  return {
    // Spread all base store methods
    track: baseStore.track.bind(baseStore),
    query: baseStore.query.bind(baseStore),
    get: baseStore.get.bind(baseStore),
    markRecovered: baseStore.markRecovered.bind(baseStore),
    getStats: baseStore.getStats.bind(baseStore),
    clear: () => {
      baseStore.clear()
      retryQueue.clear()
    },
    getRecent: baseStore.getRecent.bind(baseStore),
    count: baseStore.count.bind(baseStore),

    // Retry queue
    retryQueue,

    // Enhanced methods
    trackAndRetry(errorData, handlerFn) {
      // Track in error store
      baseStore.track(errorData)

      // Get the error we just tracked (most recent)
      const errors = baseStore.getRecent(1)
      const trackedError = errors[0]

      // Only add to retry queue if retriable
      let retryId: string | null = null
      if (errorData.retriable && trackedError) {
        // Build add options, only including defined properties (exactOptionalPropertyTypes)
        const addOptions: { errorId: string; eventType: string; payload: unknown; handlerFn?: () => Promise<void> } = {
          errorId: trackedError.id,
          eventType: errorData.eventType || 'unknown',
          payload: errorData.context
        }
        if (handlerFn !== undefined) addOptions.handlerFn = handlerFn
        retryId = retryQueue.add(addOptions)
      }

      return {
        errorId: trackedError?.id || '',
        retryId
      }
    },

    queryFailedHandlers(options) {
      const errors = baseStore.query(options)
      const retryItems = retryQueue.query()

      return errors.map(error => {
        const retryStatus = retryItems.find(item => item.errorId === error.id)
        const result: { error: FireAndForgetError; retryStatus?: RetryQueueItem } = { error }
        if (retryStatus) result.retryStatus = retryStatus
        return result
      })
    }
  }
}
