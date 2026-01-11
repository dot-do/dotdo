/**
 * ErrorsDO - Durable Object for Error Tracking and Dead Letter Handling
 *
 * Demonstrates:
 * - Dead letter queue (DLQ) for failed events
 * - Error aggregation and metrics
 * - Compensation/rollback patterns
 * - Error replay and recovery
 * - Alert thresholds and monitoring
 */

import { DO } from 'dotdo'
import {
  AppError,
  RetryableError,
  NonRetryableError,
  AggregateError,
  isAppError,
  isRetryableError,
  ensureError,
} from '../errors'

// ============================================================================
// DEAD LETTER QUEUE TYPES
// ============================================================================

export interface DeadLetterEntry {
  id: string
  event: string
  source: string
  data: unknown
  error: string
  errorCode?: string
  attempts: number
  maxRetries: number
  createdAt: Date
  lastAttemptAt: Date
  nextRetryAt?: Date
  status: 'pending' | 'retrying' | 'exhausted' | 'resolved'
  metadata?: Record<string, unknown>
}

export interface DLQConfig {
  maxRetries: number
  retryDelayMs: number
  retryBackoffMultiplier: number
  maxRetryDelayMs: number
  expirationMs: number
}

export const DEFAULT_DLQ_CONFIG: DLQConfig = {
  maxRetries: 5,
  retryDelayMs: 60000, // 1 minute
  retryBackoffMultiplier: 2,
  maxRetryDelayMs: 3600000, // 1 hour
  expirationMs: 7 * 24 * 60 * 60 * 1000, // 7 days
}

// ============================================================================
// ERROR METRICS TYPES
// ============================================================================

interface ErrorMetric {
  errorCode: string
  errorType: string
  count: number
  firstSeen: Date
  lastSeen: Date
  samples: Array<{ message: string; timestamp: Date }>
}

interface CompensationAction {
  id: string
  operation: string
  compensatingOperation: string
  data: unknown
  status: 'pending' | 'executed' | 'failed'
  executedAt?: Date
  error?: string
}

// ============================================================================
// ERRORS DURABLE OBJECT
// ============================================================================

export class ErrorsDO extends DO {
  static readonly $type = 'ErrorsDO'

  // Dead Letter Queue
  private dlq: Map<string, DeadLetterEntry> = new Map()
  private dlqConfig: DLQConfig = DEFAULT_DLQ_CONFIG

  // Error Metrics
  private errorMetrics: Map<string, ErrorMetric> = new Map()

  // Compensation tracking
  private compensations: Map<string, CompensationAction> = new Map()

  // Alert state
  private alertThresholds: Map<string, number> = new Map()
  private alertsSent: Map<string, Date> = new Map()

  async onStart() {
    // Process dead letter queue periodically
    this.$.every('1 minute', async () => {
      await this.processDLQ()
    })

    // Clean up expired entries hourly
    this.$.every.hour(async () => {
      await this.cleanupExpired()
    })

    // Generate error report daily
    this.$.every.day(async () => {
      await this.generateErrorReport()
    })

    // Listen for error events
    this.$.on.Error.captured(async (event) => {
      const { error, source, event: eventName, data } = event.data as {
        error: Error
        source: string
        event: string
        data: unknown
      }
      await this.captureError(error, { source, event: eventName, data })
    })

    // Listen for operation exhausted events (from RetryDO)
    this.$.on.Operation.exhausted(async (event) => {
      const { operationId, operationType, error, data } = event.data as {
        operationId: string
        operationType: string
        error: string
        data: unknown
      }
      await this.addToDeadLetter({
        event: operationType,
        source: operationId,
        data,
        error,
      })
    })

    // Listen for compensation requests
    this.$.on.Compensation.requested(async (event) => {
      const { operation, compensatingOperation, data } = event.data as {
        operation: string
        compensatingOperation: string
        data: unknown
      }
      await this.registerCompensation(operation, compensatingOperation, data)
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEAD LETTER QUEUE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add a failed event to the dead letter queue
   */
  async addToDeadLetter(options: {
    event: string
    source: string
    data: unknown
    error: string | Error
    errorCode?: string
    maxRetries?: number
    metadata?: Record<string, unknown>
  }): Promise<DeadLetterEntry> {
    const id = crypto.randomUUID()
    const error = options.error instanceof Error ? options.error.message : options.error
    const errorCode = options.errorCode ?? (options.error instanceof AppError ? options.error.code : undefined)

    const entry: DeadLetterEntry = {
      id,
      event: options.event,
      source: options.source,
      data: options.data,
      error,
      errorCode,
      attempts: 1,
      maxRetries: options.maxRetries ?? this.dlqConfig.maxRetries,
      createdAt: new Date(),
      lastAttemptAt: new Date(),
      nextRetryAt: this.calculateNextRetry(1),
      status: 'pending',
      metadata: options.metadata,
    }

    this.dlq.set(id, entry)

    // Track error metrics
    this.trackErrorMetric(error, errorCode ?? 'UNKNOWN', options.event)

    // Emit event for monitoring
    this.$.send('DLQ.added', {
      id,
      event: options.event,
      error,
      totalInQueue: this.dlq.size,
    })

    // Check alert thresholds
    await this.checkAlertThresholds()

    console.log(`[ErrorsDO] Added to DLQ: ${options.event} (${id})`)
    return entry
  }

  /**
   * Process dead letter queue - retry eligible entries
   */
  private async processDLQ(): Promise<{ processed: number; succeeded: number; failed: number }> {
    const now = Date.now()
    let processed = 0
    let succeeded = 0
    let failed = 0

    for (const [id, entry] of this.dlq) {
      // Skip if not ready for retry
      if (entry.status !== 'pending' || !entry.nextRetryAt || entry.nextRetryAt.getTime() > now) {
        continue
      }

      processed++
      entry.status = 'retrying'
      entry.attempts++
      entry.lastAttemptAt = new Date()

      try {
        // Re-emit the event for retry
        this.$.send(entry.event, entry.data)
        succeeded++

        // Mark as resolved
        entry.status = 'resolved'
        console.log(`[ErrorsDO] DLQ replay succeeded: ${entry.event} (${id})`)

        // Emit success event
        this.$.send('DLQ.resolved', {
          id,
          event: entry.event,
          attempts: entry.attempts,
        })
      } catch (error) {
        failed++

        const err = ensureError(error)

        if (entry.attempts >= entry.maxRetries) {
          entry.status = 'exhausted'
          console.error(`[ErrorsDO] DLQ entry exhausted: ${entry.event} (${id})`)

          this.$.send('DLQ.exhausted', {
            id,
            event: entry.event,
            attempts: entry.attempts,
            error: err.message,
          })
        } else {
          entry.status = 'pending'
          entry.nextRetryAt = this.calculateNextRetry(entry.attempts)
          entry.error = err.message
          console.warn(
            `[ErrorsDO] DLQ retry failed: ${entry.event} (${id}), next retry at ${entry.nextRetryAt?.toISOString()}`
          )
        }
      }
    }

    return { processed, succeeded, failed }
  }

  /**
   * Calculate next retry time using exponential backoff
   */
  private calculateNextRetry(attempt: number): Date {
    const baseDelay = this.dlqConfig.retryDelayMs
    const multiplier = this.dlqConfig.retryBackoffMultiplier
    const delay = Math.min(
      baseDelay * Math.pow(multiplier, attempt - 1),
      this.dlqConfig.maxRetryDelayMs
    )
    return new Date(Date.now() + delay)
  }

  /**
   * Manually replay a specific DLQ entry
   */
  async replayEntry(id: string): Promise<boolean> {
    const entry = this.dlq.get(id)
    if (!entry) {
      throw new Error(`DLQ entry ${id} not found`)
    }

    entry.status = 'retrying'
    entry.attempts++
    entry.lastAttemptAt = new Date()

    try {
      this.$.send(entry.event, entry.data)
      entry.status = 'resolved'
      return true
    } catch (error) {
      const err = ensureError(error)
      entry.status = entry.attempts >= entry.maxRetries ? 'exhausted' : 'pending'
      entry.error = err.message
      entry.nextRetryAt = this.calculateNextRetry(entry.attempts)
      return false
    }
  }

  /**
   * Get DLQ entries with optional filters
   */
  getDLQEntries(filters?: {
    status?: DeadLetterEntry['status']
    event?: string
    limit?: number
  }): DeadLetterEntry[] {
    let entries = Array.from(this.dlq.values())

    if (filters?.status) {
      entries = entries.filter(e => e.status === filters.status)
    }
    if (filters?.event) {
      entries = entries.filter(e => e.event === filters.event)
    }

    // Sort by createdAt descending
    entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    if (filters?.limit) {
      entries = entries.slice(0, filters.limit)
    }

    return entries
  }

  /**
   * Get DLQ statistics
   */
  getDLQStats(): {
    total: number
    pending: number
    retrying: number
    exhausted: number
    resolved: number
    byEvent: Record<string, number>
    oldestPending?: Date
  } {
    const stats = {
      total: this.dlq.size,
      pending: 0,
      retrying: 0,
      exhausted: 0,
      resolved: 0,
      byEvent: {} as Record<string, number>,
      oldestPending: undefined as Date | undefined,
    }

    for (const entry of this.dlq.values()) {
      stats[entry.status]++
      stats.byEvent[entry.event] = (stats.byEvent[entry.event] || 0) + 1

      if (entry.status === 'pending') {
        if (!stats.oldestPending || entry.createdAt < stats.oldestPending) {
          stats.oldestPending = entry.createdAt
        }
      }
    }

    return stats
  }

  /**
   * Remove a DLQ entry
   */
  removeDLQEntry(id: string): boolean {
    return this.dlq.delete(id)
  }

  /**
   * Purge resolved or exhausted entries
   */
  purgeDLQ(status?: 'resolved' | 'exhausted'): number {
    let purged = 0
    for (const [id, entry] of this.dlq) {
      if (!status || entry.status === status) {
        if (status || entry.status === 'resolved' || entry.status === 'exhausted') {
          this.dlq.delete(id)
          purged++
        }
      }
    }
    return purged
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ERROR AGGREGATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Capture and track an error
   */
  async captureError(
    error: unknown,
    context: { source: string; event?: string; data?: unknown }
  ): Promise<void> {
    const err = ensureError(error)
    const errorCode = isAppError(error) ? error.code : 'UNKNOWN'
    const errorType = err.constructor.name

    this.trackErrorMetric(err.message, errorCode, errorType)

    // Add to DLQ if retryable
    if (isRetryableError(error) && context.event) {
      await this.addToDeadLetter({
        event: context.event,
        source: context.source,
        data: context.data,
        error: err,
        errorCode,
      })
    }

    // Emit for monitoring
    this.$.send('Error.tracked', {
      code: errorCode,
      type: errorType,
      message: err.message,
      source: context.source,
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * Track error metric
   */
  private trackErrorMetric(message: string, errorCode: string, errorType: string): void {
    const key = `${errorCode}:${errorType}`
    const existing = this.errorMetrics.get(key)

    if (existing) {
      existing.count++
      existing.lastSeen = new Date()
      existing.samples.push({ message, timestamp: new Date() })
      // Keep only last 10 samples
      if (existing.samples.length > 10) {
        existing.samples.shift()
      }
    } else {
      this.errorMetrics.set(key, {
        errorCode,
        errorType,
        count: 1,
        firstSeen: new Date(),
        lastSeen: new Date(),
        samples: [{ message, timestamp: new Date() }],
      })
    }
  }

  /**
   * Get error metrics
   */
  getErrorMetrics(options?: { since?: Date; limit?: number }): ErrorMetric[] {
    let metrics = Array.from(this.errorMetrics.values())

    if (options?.since) {
      metrics = metrics.filter(m => m.lastSeen >= options.since!)
    }

    // Sort by count descending
    metrics.sort((a, b) => b.count - a.count)

    if (options?.limit) {
      metrics = metrics.slice(0, options.limit)
    }

    return metrics
  }

  /**
   * Get error summary
   */
  getErrorSummary(): {
    totalErrors: number
    uniqueErrorCodes: number
    topErrors: Array<{ code: string; type: string; count: number }>
    errorsByHour: Record<string, number>
  } {
    let totalErrors = 0
    const topErrors: Array<{ code: string; type: string; count: number }> = []
    const errorsByHour: Record<string, number> = {}

    for (const metric of this.errorMetrics.values()) {
      totalErrors += metric.count
      topErrors.push({
        code: metric.errorCode,
        type: metric.errorType,
        count: metric.count,
      })

      // Group by hour
      for (const sample of metric.samples) {
        const hour = sample.timestamp.toISOString().slice(0, 13) + ':00'
        errorsByHour[hour] = (errorsByHour[hour] || 0) + 1
      }
    }

    topErrors.sort((a, b) => b.count - a.count)

    return {
      totalErrors,
      uniqueErrorCodes: this.errorMetrics.size,
      topErrors: topErrors.slice(0, 10),
      errorsByHour,
    }
  }

  /**
   * Reset error metrics
   */
  resetErrorMetrics(): void {
    this.errorMetrics.clear()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPENSATION / ROLLBACK
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register a compensation action for later execution if needed
   */
  async registerCompensation(
    operation: string,
    compensatingOperation: string,
    data: unknown
  ): Promise<string> {
    const id = crypto.randomUUID()

    this.compensations.set(id, {
      id,
      operation,
      compensatingOperation,
      data,
      status: 'pending',
    })

    console.log(`[ErrorsDO] Registered compensation: ${operation} -> ${compensatingOperation} (${id})`)
    return id
  }

  /**
   * Execute a compensation action
   */
  async executeCompensation(id: string): Promise<boolean> {
    const compensation = this.compensations.get(id)
    if (!compensation) {
      throw new Error(`Compensation ${id} not found`)
    }

    if (compensation.status !== 'pending') {
      throw new Error(`Compensation ${id} already ${compensation.status}`)
    }

    try {
      this.$.send(compensation.compensatingOperation, compensation.data)
      compensation.status = 'executed'
      compensation.executedAt = new Date()

      this.$.send('Compensation.executed', {
        id,
        operation: compensation.operation,
        compensatingOperation: compensation.compensatingOperation,
      })

      console.log(`[ErrorsDO] Executed compensation: ${compensation.compensatingOperation} (${id})`)
      return true
    } catch (error) {
      const err = ensureError(error)
      compensation.status = 'failed'
      compensation.error = err.message

      this.$.send('Compensation.failed', {
        id,
        operation: compensation.operation,
        error: err.message,
      })

      console.error(`[ErrorsDO] Compensation failed: ${compensation.compensatingOperation} (${id})`)
      return false
    }
  }

  /**
   * Execute all pending compensations (for saga rollback)
   */
  async executeAllCompensations(operationPrefix?: string): Promise<{
    total: number
    succeeded: number
    failed: number
  }> {
    let total = 0
    let succeeded = 0
    let failed = 0

    for (const [id, compensation] of this.compensations) {
      if (compensation.status !== 'pending') continue
      if (operationPrefix && !compensation.operation.startsWith(operationPrefix)) continue

      total++
      try {
        const success = await this.executeCompensation(id)
        if (success) succeeded++
        else failed++
      } catch {
        failed++
      }
    }

    return { total, succeeded, failed }
  }

  /**
   * Cancel a pending compensation
   */
  cancelCompensation(id: string): boolean {
    const compensation = this.compensations.get(id)
    if (!compensation || compensation.status !== 'pending') {
      return false
    }
    return this.compensations.delete(id)
  }

  /**
   * Get pending compensations
   */
  getPendingCompensations(): CompensationAction[] {
    return Array.from(this.compensations.values()).filter(c => c.status === 'pending')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ALERTING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set alert threshold for error count
   */
  setAlertThreshold(errorCode: string, threshold: number): void {
    this.alertThresholds.set(errorCode, threshold)
  }

  /**
   * Check and trigger alerts if thresholds exceeded
   */
  private async checkAlertThresholds(): Promise<void> {
    const now = Date.now()
    const alertCooldown = 5 * 60 * 1000 // 5 minutes

    for (const [code, threshold] of this.alertThresholds) {
      const metric = Array.from(this.errorMetrics.values()).find(m => m.errorCode === code)
      if (!metric || metric.count < threshold) continue

      // Check cooldown
      const lastAlert = this.alertsSent.get(code)
      if (lastAlert && now - lastAlert.getTime() < alertCooldown) continue

      // Send alert
      this.alertsSent.set(code, new Date())
      this.$.send('Alert.triggered', {
        errorCode: code,
        count: metric.count,
        threshold,
        lastSeen: metric.lastSeen,
      })

      console.warn(`[ErrorsDO] Alert triggered: ${code} count (${metric.count}) exceeded threshold (${threshold})`)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP & MAINTENANCE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Clean up expired entries
   */
  private async cleanupExpired(): Promise<number> {
    const cutoff = Date.now() - this.dlqConfig.expirationMs
    let cleaned = 0

    for (const [id, entry] of this.dlq) {
      if (entry.createdAt.getTime() < cutoff) {
        this.dlq.delete(id)
        cleaned++
      }
    }

    // Clean old compensations
    for (const [id, comp] of this.compensations) {
      if (comp.status !== 'pending' && comp.executedAt) {
        if (comp.executedAt.getTime() < cutoff) {
          this.compensations.delete(id)
          cleaned++
        }
      }
    }

    if (cleaned > 0) {
      console.log(`[ErrorsDO] Cleaned up ${cleaned} expired entries`)
    }

    return cleaned
  }

  /**
   * Generate error report
   */
  private async generateErrorReport(): Promise<void> {
    const summary = this.getErrorSummary()
    const dlqStats = this.getDLQStats()

    this.$.send('ErrorReport.generated', {
      timestamp: new Date().toISOString(),
      summary,
      dlqStats,
    })

    console.log('[ErrorsDO] Error report generated:', {
      totalErrors: summary.totalErrors,
      dlqPending: dlqStats.pending,
    })
  }

  /**
   * Configure DLQ settings
   */
  configureDLQ(config: Partial<DLQConfig>): void {
    this.dlqConfig = { ...this.dlqConfig, ...config }
  }

  /**
   * Get overall health status
   */
  getHealthStatus(): {
    healthy: boolean
    dlq: { pending: number; exhausted: number }
    compensations: { pending: number }
    errors: { total: number; recent: number }
  } {
    const dlqStats = this.getDLQStats()
    const pendingCompensations = this.getPendingCompensations().length
    const recentErrors = Array.from(this.errorMetrics.values())
      .filter(m => m.lastSeen.getTime() > Date.now() - 3600000) // Last hour
      .reduce((sum, m) => sum + m.count, 0)

    const healthy = dlqStats.pending < 100 && dlqStats.exhausted === 0 && pendingCompensations === 0

    return {
      healthy,
      dlq: {
        pending: dlqStats.pending,
        exhausted: dlqStats.exhausted,
      },
      compensations: {
        pending: pendingCompensations,
      },
      errors: {
        total: this.getErrorSummary().totalErrors,
        recent: recentErrors,
      },
    }
  }
}
