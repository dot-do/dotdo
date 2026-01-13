/**
 * RetryExecutor - Error handling and retry policies for sync operations
 *
 * This module provides configurable retry policies with different backoff
 * strategies, error classification, and failed record tracking for manual review.
 *
 * ## Overview
 *
 * In sync operations, transient failures (network issues, rate limits) should be
 * retried with appropriate backoff, while permanent failures (validation errors,
 * auth failures) should fail immediately.
 *
 * ## Usage Example
 *
 * ```typescript
 * import { RetryExecutor, RetryErrorTracker, createRetryExecutor } from './retry-executor'
 *
 * const policy: RetryPolicy = {
 *   maxAttempts: 3,
 *   backoff: 'exponential',
 *   initialDelayMs: 100,
 *   maxDelayMs: 5000,
 *   retryableErrors: ['RATE_LIMIT', 'TIMEOUT', 'NETWORK_ERROR'],
 * }
 *
 * const executor = new RetryExecutor(policy)
 * const tracker = new RetryErrorTracker()
 *
 * const result = await executor.execute(async () => {
 *   return await api.syncRecord(record)
 * }, { recordKey: record.id })
 *
 * if (!result.success) {
 *   tracker.trackFailure({
 *     recordKey: record.id,
 *     error: result.error!,
 *     data: record,
 *     timestamp: new Date(),
 *   })
 * }
 * ```
 *
 * @module db/primitives/sync/retry-executor
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  /** Maximum number of attempts (including initial attempt) */
  maxAttempts: number
  /** Backoff strategy: exponential doubles, linear adds, constant stays same */
  backoff: 'exponential' | 'linear' | 'constant'
  /** Initial delay in milliseconds before first retry */
  initialDelayMs: number
  /** Maximum delay between retries in milliseconds */
  maxDelayMs: number
  /** Error codes that should trigger retries */
  retryableErrors: string[]
}

/**
 * Error information from a retry operation
 */
export interface RetryError {
  /** Error code identifying the type of error */
  code: string
  /** Human-readable error message */
  message: string
  /** Key of the record that failed (if applicable) */
  recordKey?: string
  /** Whether this error is eligible for retry */
  retryable: boolean
  /** Number of attempts made before this error was returned */
  attempts: number
}

/**
 * Result of a retry execution
 */
export interface RetryResult<T> {
  /** Whether the operation succeeded */
  success: boolean
  /** The value returned on success */
  value?: T
  /** Error information on failure */
  error?: RetryError
  /** Number of attempts made */
  attempts: number
}

/**
 * A failed record tracked for manual review
 */
export interface FailedRecord {
  /** Key of the record that failed */
  recordKey: string
  /** Error that caused the failure */
  error: RetryError
  /** Original record data (if available) */
  data?: unknown
  /** When the failure occurred */
  timestamp: Date
}

/**
 * Input for tracking a failure
 */
export interface TrackFailureInput {
  /** Key of the record that failed */
  recordKey: string
  /** Error that caused the failure */
  error: RetryError
  /** Original record data (if available) */
  data?: unknown
  /** When the failure occurred */
  timestamp: Date
}

/**
 * Filter options for retrieving failed records
 */
export interface FailedRecordFilter {
  /** Filter by retryable status */
  retryable?: boolean
  /** Filter by error code */
  errorCode?: string
}

/**
 * Summary of tracked failures
 */
export interface FailureSummary {
  /** Total number of failures */
  total: number
  /** Count of failures by error code */
  byErrorCode: Record<string, number>
  /** Number of retryable failures */
  retryable: number
  /** Number of non-retryable failures */
  nonRetryable: number
}

/**
 * Exported failure record with ISO timestamp
 */
export interface ExportedFailure {
  recordKey: string
  error: RetryError
  data?: unknown
  timestamp: string
}

/**
 * Options for RetryExecutor
 */
export interface RetryExecutorOptions {
  /** Custom delay function (for testing) */
  delayFn?: (ms: number) => Promise<void>
}

/**
 * Context for a single execution
 */
export interface ExecutionContext {
  /** Key of the record being processed */
  recordKey?: string
}

/**
 * Result of batch execution
 */
export interface RetryRetryBatchResult<T, R> {
  /** Successfully processed items with their results */
  successful: Array<{ item: T; result: R }>
  /** Failed items with their errors */
  failed: Array<{ item: T; key: string; error: RetryError }>
}

// =============================================================================
// RETRY EXECUTOR IMPLEMENTATION
// =============================================================================

/**
 * RetryExecutor handles retry logic with configurable policies
 *
 * @example
 * ```typescript
 * const executor = new RetryExecutor({
 *   maxAttempts: 3,
 *   backoff: 'exponential',
 *   initialDelayMs: 100,
 *   maxDelayMs: 5000,
 *   retryableErrors: ['RATE_LIMIT', 'TIMEOUT'],
 * })
 *
 * const result = await executor.execute(async () => api.call())
 * ```
 */
export class RetryExecutor {
  private readonly policy: RetryPolicy
  private readonly delayFn: (ms: number) => Promise<void>

  constructor(policy: RetryPolicy, options: RetryExecutorOptions = {}) {
    this.policy = policy
    this.delayFn = options.delayFn ?? this.defaultDelay
  }

  /**
   * Execute an operation with retry policy
   *
   * @param operation - The async operation to execute
   * @param context - Optional context with record key
   * @returns Result with success status, value or error, and attempt count
   */
  async execute<T>(
    operation: () => Promise<T>,
    context: ExecutionContext = {}
  ): Promise<RetryResult<T>> {
    let attempts = 0
    let lastError: Error | null = null

    while (attempts < this.policy.maxAttempts) {
      attempts++

      try {
        const value = await operation()
        return {
          success: true,
          value,
          attempts,
        }
      } catch (error) {
        lastError = error as Error
        const errorCode = this.getErrorCode(error)
        const isRetryable = this.isRetryable(error)

        // If not retryable, fail immediately
        if (!isRetryable) {
          return {
            success: false,
            error: this.createRetryError(lastError, errorCode, context.recordKey, attempts, false),
            attempts,
          }
        }

        // If we've exhausted retries, return failure
        if (attempts >= this.policy.maxAttempts) {
          return {
            success: false,
            error: this.createRetryError(lastError, errorCode, context.recordKey, attempts, true),
            attempts,
          }
        }

        // Calculate and apply delay before retry
        const delay = this.calculateDelay(attempts, error)
        await this.delayFn(delay)
      }
    }

    // Should not reach here, but handle edge case
    return {
      success: false,
      error: this.createRetryError(
        lastError ?? new Error('Unknown error'),
        'UNKNOWN',
        context.recordKey,
        attempts,
        false
      ),
      attempts,
    }
  }

  /**
   * Execute a batch of operations, tracking failures
   *
   * @param items - Items to process
   * @param operation - Operation to run on each item
   * @param getKey - Function to get the key from an item
   * @param tracker - Optional error tracker for failures
   * @returns Batch result with successful and failed items
   */
  async executeBatch<T, R>(
    items: T[],
    operation: (item: T) => Promise<R>,
    getKey: (item: T) => string,
    tracker?: RetryErrorTracker
  ): Promise<RetryBatchResult<T, R>> {
    const successful: Array<{ item: T; result: R }> = []
    const failed: Array<{ item: T; key: string; error: RetryError }> = []

    for (const item of items) {
      const key = getKey(item)
      const result = await this.execute(() => operation(item), { recordKey: key })

      if (result.success) {
        successful.push({ item, result: result.value! })
      } else {
        failed.push({ item, key, error: result.error! })

        if (tracker) {
          tracker.trackFailure({
            recordKey: key,
            error: result.error!,
            data: item,
            timestamp: new Date(),
          })
        }
      }
    }

    return { successful, failed }
  }

  /**
   * Calculate delay based on backoff strategy and attempt number
   */
  private calculateDelay(attempt: number, error: unknown): number {
    // Check for rate limit retry-after header
    const retryAfterMs = (error as any)?.retryAfterMs
    if (typeof retryAfterMs === 'number') {
      return Math.min(retryAfterMs, this.policy.maxDelayMs)
    }

    let delay: number

    switch (this.policy.backoff) {
      case 'exponential':
        // Exponential: initialDelay * 2^(attempt-1)
        // attempt 1 -> initialDelay, attempt 2 -> initialDelay*2, etc.
        delay = this.policy.initialDelayMs * Math.pow(2, attempt - 1)
        break

      case 'linear':
        // Linear: initialDelay * attempt
        delay = this.policy.initialDelayMs * attempt
        break

      case 'constant':
      default:
        delay = this.policy.initialDelayMs
        break
    }

    return Math.min(delay, this.policy.maxDelayMs)
  }

  /**
   * Check if an error is retryable based on the policy
   */
  private isRetryable(error: unknown): boolean {
    const errorCode = this.getErrorCode(error)
    if (!errorCode) {
      return false // Unknown errors are not retryable by default
    }
    return this.policy.retryableErrors.includes(errorCode)
  }

  /**
   * Extract error code from an error object
   */
  private getErrorCode(error: unknown): string {
    if (error && typeof error === 'object') {
      const code = (error as any).code
      if (typeof code === 'string') {
        return code
      }
    }
    return 'UNKNOWN'
  }

  /**
   * Create a RetryError from an error
   */
  private createRetryError(
    error: Error,
    code: string,
    recordKey: string | undefined,
    attempts: number,
    retryable: boolean
  ): RetryError {
    return {
      code,
      message: error.message,
      recordKey,
      retryable,
      attempts,
    }
  }

  /**
   * Default delay function using setTimeout
   */
  private async defaultDelay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// =============================================================================
// SYNC ERROR TRACKER IMPLEMENTATION
// =============================================================================

/**
 * RetryErrorTracker tracks failed records for manual review and retry
 *
 * @example
 * ```typescript
 * const tracker = new RetryErrorTracker()
 *
 * // Track a failure
 * tracker.trackFailure({
 *   recordKey: 'user-123',
 *   error: { code: 'VALIDATION_ERROR', message: 'Bad data', retryable: false, attempts: 1 },
 *   data: { name: 'Alice' },
 *   timestamp: new Date(),
 * })
 *
 * // Get summary
 * const summary = tracker.getSummary()
 *
 * // Get retryable failures for reprocessing
 * const toRetry = tracker.getRetryQueue()
 * ```
 */
export class RetryErrorTracker {
  private failures: Map<string, FailedRecord> = new Map()

  /**
   * Track a failed record
   */
  trackFailure(input: TrackFailureInput): void {
    this.failures.set(input.recordKey, {
      recordKey: input.recordKey,
      error: input.error,
      data: input.data,
      timestamp: input.timestamp,
    })
  }

  /**
   * Get all failed records, optionally filtered
   */
  getFailedRecords(filter?: FailedRecordFilter): FailedRecord[] {
    let records = Array.from(this.failures.values())

    if (filter?.retryable !== undefined) {
      records = records.filter((r) => r.error.retryable === filter.retryable)
    }

    if (filter?.errorCode !== undefined) {
      records = records.filter((r) => r.error.code === filter.errorCode)
    }

    return records
  }

  /**
   * Get summary of all failures
   */
  getSummary(): FailureSummary {
    const records = Array.from(this.failures.values())

    const byErrorCode: Record<string, number> = {}
    let retryable = 0
    let nonRetryable = 0

    for (const record of records) {
      byErrorCode[record.error.code] = (byErrorCode[record.error.code] || 0) + 1

      if (record.error.retryable) {
        retryable++
      } else {
        nonRetryable++
      }
    }

    return {
      total: records.length,
      byErrorCode,
      retryable,
      nonRetryable,
    }
  }

  /**
   * Get records that can be retried
   */
  getRetryQueue(): FailedRecord[] {
    return this.getFailedRecords({ retryable: true })
  }

  /**
   * Remove a specific failure from tracking
   */
  removeFailure(recordKey: string): boolean {
    return this.failures.delete(recordKey)
  }

  /**
   * Clear all tracked failures
   */
  clear(): void {
    this.failures.clear()
  }

  /**
   * Export failures for external review
   */
  export(): ExportedFailure[] {
    return Array.from(this.failures.values()).map((record) => ({
      recordKey: record.recordKey,
      error: record.error,
      data: record.data,
      timestamp: record.timestamp.toISOString(),
    }))
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a new RetryExecutor instance
 *
 * @param policy - Retry policy configuration
 * @param options - Optional executor options
 * @returns A new RetryExecutor instance
 */
export function createRetryExecutor(
  policy: RetryPolicy,
  options?: RetryExecutorOptions
): RetryExecutor {
  return new RetryExecutor(policy, options)
}

/**
 * Create a new RetryErrorTracker instance
 *
 * @returns A new RetryErrorTracker instance
 */
export function createRetryErrorTracker(): RetryErrorTracker {
  return new RetryErrorTracker()
}
