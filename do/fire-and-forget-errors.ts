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

import type { SqlStorage } from '../db/sqlite'

/**
 * Represents a captured error from a fire-and-forget operation
 */
export interface FireAndForgetError {
  /** Unique error ID */
  id: string
  /** Operation type (e.g., 'event.handler', 'workflow.send') */
  operation: string
  /** Event type if applicable (e.g., 'Order.placed') */
  eventType?: string
  /** Handler index if multiple handlers for same event */
  handlerIndex?: number
  /** Error message */
  message: string
  /** Error stack trace if available */
  stack?: string
  /** Error name/type (e.g., 'NetworkError', 'ValidationError') */
  errorType: string
  /** Whether the error is retriable */
  retriable: boolean
  /** Additional context data */
  context?: Record<string, unknown>
  /** Timestamp when error occurred */
  timestamp: number
  /** Number of attempts made before final failure */
  attempts?: number
  /** Whether error was recovered (retried successfully) */
  recovered: boolean
  /** Recovery timestamp if recovered */
  recoveredAt?: number
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
  stack?: string
  errorType: string
  retriable: boolean
} {
  if (error instanceof Error) {
    // Check for retriable property
    const retriable = 'retriable' in error
      ? Boolean((error as { retriable?: boolean }).retriable)
      : isRetriableByType(error)

    return {
      message: error.message,
      stack: error.stack,
      errorType: error.name || 'Error',
      retriable
    }
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
 * Create an in-memory fire-and-forget error store
 * Used when SQLite is not available or for testing
 */
export function createInMemoryErrorStore(): FireAndForgetErrorStore {
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

      const result = sql.prepare(query).bind(...params).all()

      return result.results.map(mapRowToError)
    },

    get(id) {
      const row = sql.prepare('SELECT * FROM fire_and_forget_errors WHERE id = ?')
        .bind(id)
        .first()

      return row ? mapRowToError(row) : null
    },

    markRecovered(id) {
      const result = sql.prepare(`
        UPDATE fire_and_forget_errors
        SET recovered = 1, recovered_at = ?
        WHERE id = ? AND recovered = 0
      `).bind(Date.now(), id).run()

      return (result.meta?.changes ?? 0) > 0
    },

    getStats() {
      // Total count
      const totalRow = sql.prepare('SELECT COUNT(*) as count FROM fire_and_forget_errors').first()
      const total = (totalRow?.count as number) || 0

      // Recovered count
      const recoveredRow = sql.prepare('SELECT COUNT(*) as count FROM fire_and_forget_errors WHERE recovered = 1').first()
      const recovered = (recoveredRow?.count as number) || 0

      // By operation
      const opResults = sql.prepare('SELECT operation, COUNT(*) as count FROM fire_and_forget_errors GROUP BY operation').all()
      const byOperation: Record<string, number> = {}
      for (const row of opResults.results) {
        byOperation[row.operation as string] = row.count as number
      }

      // By event type
      const etResults = sql.prepare('SELECT event_type, COUNT(*) as count FROM fire_and_forget_errors WHERE event_type IS NOT NULL GROUP BY event_type').all()
      const byEventType: Record<string, number> = {}
      for (const row of etResults.results) {
        byEventType[row.event_type as string] = row.count as number
      }

      // By error type
      const errResults = sql.prepare('SELECT error_type, COUNT(*) as count FROM fire_and_forget_errors GROUP BY error_type').all()
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
      sql.prepare('DELETE FROM fire_and_forget_errors').run()
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

      const result = sql.prepare(query).bind(...params).first()
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

    // Still log to console for visibility
    console.error(`[${operation}] Fire-and-forget error:`, error)
  })
}
