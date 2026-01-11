/**
 * RetryDO - Durable Object for Retry Pattern with Exponential Backoff
 *
 * Demonstrates:
 * - $.try() - Single attempt with timeout
 * - $.do() - Durable execution with configurable retries
 * - Exponential backoff with jitter
 * - Retry budgets and rate limiting
 * - Per-operation retry tracking
 */

import { DO } from 'dotdo'
import type { RetryPolicy, DoOptions, TryOptions } from 'dotdo'
import {
  RetryableError,
  NonRetryableError,
  TimeoutError,
  RateLimitError,
  isRetryableError,
  shouldRetry,
  getRetryDelay,
} from '../errors'

// ============================================================================
// RETRY CONFIGURATION
// ============================================================================

export interface RetryConfig {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
  jitter: boolean
  timeout?: number
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 200,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  jitter: true,
  timeout: 30000,
}

// Aggressive retry for critical operations
export const CRITICAL_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  initialDelayMs: 100,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
  timeout: 60000,
}

// Light retry for non-critical operations
export const LIGHT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 2,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  jitter: true,
  timeout: 10000,
}

// ============================================================================
// RETRY TRACKING
// ============================================================================

interface RetryAttempt {
  attemptNumber: number
  timestamp: Date
  durationMs: number
  success: boolean
  error?: string
}

interface OperationRetryRecord {
  operationId: string
  operationType: string
  attempts: RetryAttempt[]
  totalAttempts: number
  finalStatus: 'success' | 'failed' | 'in_progress'
  createdAt: Date
  completedAt?: Date
}

// ============================================================================
// RETRY DURABLE OBJECT
// ============================================================================

export class RetryDO extends DO {
  static readonly $type = 'RetryDO'

  // Track retry operations
  private operations: Map<string, OperationRetryRecord> = new Map()

  // Retry budget: max retries per minute per operation type
  private retryBudget: Map<string, { count: number; resetAt: number }> = new Map()
  private readonly RETRY_BUDGET_LIMIT = 100
  private readonly RETRY_BUDGET_WINDOW_MS = 60000

  async onStart() {
    // Register event handlers for retry-related events
    this.$.on.Operation.retry(async (event) => {
      const { operationId, operationType, data, config } = event.data as {
        operationId: string
        operationType: string
        data: unknown
        config?: Partial<RetryConfig>
      }
      await this.executeWithRetry(operationId, operationType, data, config)
    })

    this.$.on.Operation.completed(async (event) => {
      const { operationId, result } = event.data as { operationId: string; result: unknown }
      await this.markOperationComplete(operationId, 'success', result)
    })

    this.$.on.Operation.failed(async (event) => {
      const { operationId, error } = event.data as { operationId: string; error: string }
      await this.markOperationComplete(operationId, 'failed', undefined, error)
    })

    // Clean up old retry records every hour
    this.$.every.hour(async () => {
      await this.cleanupOldRecords()
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // $.try() PATTERN - Single attempt with timeout
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute an operation with a single attempt and timeout.
   * Good for quick checks that can fail gracefully.
   *
   * @example
   * const inventory = await retryDO.tryOnce('Inventory.check', { sku: 'WIDGET-001' })
   */
  async tryOnce<T>(
    operation: string,
    data: unknown,
    options: TryOptions = {}
  ): Promise<T> {
    const operationId = `try:${operation}:${crypto.randomUUID().slice(0, 8)}`
    const timeout = options.timeout ?? 5000

    this.trackAttempt(operationId, operation, 1, 'in_progress')

    const startTime = Date.now()
    try {
      const result = await this.$.try(operation, data, { timeout }) as T
      const durationMs = Date.now() - startTime

      this.trackAttempt(operationId, operation, 1, 'success', durationMs)
      return result
    } catch (error) {
      const durationMs = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)

      this.trackAttempt(operationId, operation, 1, 'failed', durationMs, errorMessage)
      throw error
    }
  }

  /**
   * Try an operation with graceful fallback if it fails.
   *
   * @example
   * const result = await retryDO.tryWithFallback(
   *   'Cache.get',
   *   { key: 'user:123' },
   *   () => ({ cached: false, value: null })
   * )
   */
  async tryWithFallback<T>(
    operation: string,
    data: unknown,
    fallback: () => T | Promise<T>,
    options: TryOptions = {}
  ): Promise<T> {
    try {
      return await this.tryOnce<T>(operation, data, options)
    } catch (error) {
      console.warn(`[RetryDO] ${operation} failed, using fallback:`, error)
      return await fallback()
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // $.do() PATTERN - Durable execution with retries
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute an operation with configurable retries and exponential backoff.
   * For critical operations that must succeed.
   *
   * @example
   * const payment = await retryDO.executeWithRetry(
   *   'pay-123',
   *   'Payment.charge',
   *   { amount: 99.99 },
   *   { maxAttempts: 5, timeout: 30000 }
   * )
   */
  async executeWithRetry<T>(
    operationId: string,
    operationType: string,
    data: unknown,
    config?: Partial<RetryConfig>
  ): Promise<T> {
    const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config }

    // Check retry budget
    if (!this.checkRetryBudget(operationType)) {
      throw new RateLimitError(
        `Retry budget exceeded for ${operationType}`,
        this.getRetryBudgetResetTime(operationType)
      )
    }

    // Initialize operation tracking
    this.initializeOperation(operationId, operationType)

    let lastError: Error | undefined
    let attempt = 0

    while (attempt < fullConfig.maxAttempts) {
      attempt++
      const startTime = Date.now()

      try {
        // Execute via $.do() for durability
        const result = await this.$.do(operationType, data, {
          retry: {
            maxAttempts: 1, // We handle retries ourselves
            initialDelayMs: fullConfig.initialDelayMs,
            maxDelayMs: fullConfig.maxDelayMs,
            backoffMultiplier: fullConfig.backoffMultiplier,
            jitter: fullConfig.jitter,
          },
          timeout: fullConfig.timeout,
          stepId: `${operationId}:attempt:${attempt}`,
        } as DoOptions) as T

        const durationMs = Date.now() - startTime
        this.trackAttempt(operationId, operationType, attempt, 'success', durationMs)
        this.consumeRetryBudget(operationType)

        // Emit success event
        this.$.send('Operation.succeeded', {
          operationId,
          operationType,
          attempt,
          durationMs,
          result,
        })

        return result
      } catch (error) {
        const durationMs = Date.now() - startTime
        lastError = error instanceof Error ? error : new Error(String(error))
        const errorMessage = lastError.message

        this.trackAttempt(operationId, operationType, attempt, 'failed', durationMs, errorMessage)
        this.consumeRetryBudget(operationType)

        // Check if we should retry
        if (!shouldRetry(error) || attempt >= fullConfig.maxAttempts) {
          break
        }

        // Calculate delay for next attempt
        const delay = this.calculateDelay(attempt, fullConfig)
        console.log(
          `[RetryDO] ${operationType} attempt ${attempt} failed, retrying in ${delay}ms:`,
          errorMessage
        )

        // Wait before retrying
        await this.sleep(delay)
      }
    }

    // All retries exhausted
    const finalError = lastError || new Error('Operation failed after all retries')
    this.markOperationComplete(operationId, 'failed', undefined, finalError.message)

    // Emit failure event for dead letter handling
    this.$.send('Operation.exhausted', {
      operationId,
      operationType,
      attempts: attempt,
      error: finalError.message,
      data,
    })

    throw finalError
  }

  /**
   * Execute a batch of operations with retry, continuing on individual failures.
   * Returns results for all operations, including errors.
   */
  async executeWithRetryBatch<T, D>(
    operations: Array<{ id: string; type: string; data: D }>,
    config?: Partial<RetryConfig>
  ): Promise<Array<{ id: string; success: boolean; result?: T; error?: string }>> {
    const results: Array<{ id: string; success: boolean; result?: T; error?: string }> = []

    for (const op of operations) {
      try {
        const result = await this.executeWithRetry<T>(op.id, op.type, op.data, config)
        results.push({ id: op.id, success: true, result })
      } catch (error) {
        results.push({
          id: op.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return results
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELAY CALCULATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calculate delay for next retry using exponential backoff with optional jitter.
   */
  private calculateDelay(attempt: number, config: RetryConfig): number {
    // Base delay with exponential backoff
    let delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1)

    // Apply jitter if enabled (10-50% of delay)
    if (config.jitter) {
      const jitter = delay * (0.1 + Math.random() * 0.4)
      delay += jitter
    }

    // Cap at max delay
    return Math.min(delay, config.maxDelayMs)
  }

  /**
   * Sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RETRY BUDGET MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if retry budget allows more retries for this operation type.
   */
  private checkRetryBudget(operationType: string): boolean {
    const budget = this.retryBudget.get(operationType)
    const now = Date.now()

    if (!budget || now >= budget.resetAt) {
      // Budget expired or doesn't exist, reset it
      this.retryBudget.set(operationType, {
        count: 0,
        resetAt: now + this.RETRY_BUDGET_WINDOW_MS,
      })
      return true
    }

    return budget.count < this.RETRY_BUDGET_LIMIT
  }

  /**
   * Consume one unit of retry budget.
   */
  private consumeRetryBudget(operationType: string): void {
    const budget = this.retryBudget.get(operationType)
    if (budget) {
      budget.count++
    }
  }

  /**
   * Get time until retry budget resets.
   */
  private getRetryBudgetResetTime(operationType: string): number {
    const budget = this.retryBudget.get(operationType)
    if (!budget) return 0
    return Math.max(0, budget.resetAt - Date.now())
  }

  /**
   * Get current retry budget status for all operation types.
   */
  getRetryBudgetStatus(): Record<string, { used: number; remaining: number; resetsInMs: number }> {
    const status: Record<string, { used: number; remaining: number; resetsInMs: number }> = {}
    const now = Date.now()

    for (const [type, budget] of this.retryBudget) {
      status[type] = {
        used: budget.count,
        remaining: Math.max(0, this.RETRY_BUDGET_LIMIT - budget.count),
        resetsInMs: Math.max(0, budget.resetAt - now),
      }
    }

    return status
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OPERATION TRACKING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Initialize tracking for a new operation.
   */
  private initializeOperation(operationId: string, operationType: string): void {
    if (this.operations.has(operationId)) return

    this.operations.set(operationId, {
      operationId,
      operationType,
      attempts: [],
      totalAttempts: 0,
      finalStatus: 'in_progress',
      createdAt: new Date(),
    })
  }

  /**
   * Track an attempt for an operation.
   */
  private trackAttempt(
    operationId: string,
    operationType: string,
    attemptNumber: number,
    status: 'success' | 'failed' | 'in_progress',
    durationMs?: number,
    error?: string
  ): void {
    let record = this.operations.get(operationId)

    if (!record) {
      this.initializeOperation(operationId, operationType)
      record = this.operations.get(operationId)!
    }

    record.attempts.push({
      attemptNumber,
      timestamp: new Date(),
      durationMs: durationMs ?? 0,
      success: status === 'success',
      error,
    })

    record.totalAttempts = Math.max(record.totalAttempts, attemptNumber)

    if (status !== 'in_progress') {
      record.finalStatus = status
      if (status === 'success' || status === 'failed') {
        record.completedAt = new Date()
      }
    }
  }

  /**
   * Mark an operation as complete.
   */
  private markOperationComplete(
    operationId: string,
    status: 'success' | 'failed',
    result?: unknown,
    error?: string
  ): void {
    const record = this.operations.get(operationId)
    if (record) {
      record.finalStatus = status
      record.completedAt = new Date()
    }
  }

  /**
   * Get retry statistics for an operation.
   */
  getOperationStats(operationId: string): OperationRetryRecord | undefined {
    return this.operations.get(operationId)
  }

  /**
   * Get all operation retry statistics.
   */
  getAllOperationStats(): OperationRetryRecord[] {
    return Array.from(this.operations.values())
  }

  /**
   * Get aggregated retry statistics.
   */
  getRetryStats(): {
    totalOperations: number
    successful: number
    failed: number
    inProgress: number
    totalAttempts: number
    averageAttempts: number
    byType: Record<string, { total: number; successful: number; failed: number }>
  } {
    const operations = Array.from(this.operations.values())
    const byType: Record<string, { total: number; successful: number; failed: number }> = {}

    let totalAttempts = 0

    for (const op of operations) {
      totalAttempts += op.totalAttempts

      if (!byType[op.operationType]) {
        byType[op.operationType] = { total: 0, successful: 0, failed: 0 }
      }

      byType[op.operationType].total++
      if (op.finalStatus === 'success') byType[op.operationType].successful++
      if (op.finalStatus === 'failed') byType[op.operationType].failed++
    }

    const successful = operations.filter(o => o.finalStatus === 'success').length
    const failed = operations.filter(o => o.finalStatus === 'failed').length
    const inProgress = operations.filter(o => o.finalStatus === 'in_progress').length

    return {
      totalOperations: operations.length,
      successful,
      failed,
      inProgress,
      totalAttempts,
      averageAttempts: operations.length > 0 ? totalAttempts / operations.length : 0,
      byType,
    }
  }

  /**
   * Clean up old operation records (older than 24 hours).
   */
  private async cleanupOldRecords(): Promise<number> {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    const toDelete: string[] = []

    for (const [id, record] of this.operations) {
      if (
        record.finalStatus !== 'in_progress' &&
        record.completedAt &&
        record.completedAt.getTime() < cutoff
      ) {
        toDelete.push(id)
      }
    }

    for (const id of toDelete) {
      this.operations.delete(id)
    }

    return toDelete.length
  }

  /**
   * Reset all tracking data.
   */
  resetStats(): void {
    this.operations.clear()
    this.retryBudget.clear()
  }
}
