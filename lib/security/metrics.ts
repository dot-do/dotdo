/**
 * Security Metrics
 *
 * Provides metrics collection and reporting for security operations:
 * - Rate limit metrics (requests blocked, remaining capacity)
 * - Authentication metrics (success/failure rates)
 * - Validation metrics (rejection counts by type)
 *
 * @module lib/security/metrics
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Rate limit metrics for a specific identifier
 */
export interface RateLimitMetric {
  /** Identifier (IP, user ID, etc.) */
  identifier: string
  /** Total requests in current window */
  requests: number
  /** Requests blocked in current window */
  blocked: number
  /** Window start timestamp */
  windowStart: number
  /** Window end timestamp */
  windowEnd: number
  /** Last request timestamp */
  lastRequest: number
}

/**
 * Aggregated rate limit metrics
 */
export interface RateLimitSummary {
  /** Total unique identifiers tracked */
  totalIdentifiers: number
  /** Total requests across all identifiers */
  totalRequests: number
  /** Total blocked requests */
  totalBlocked: number
  /** Block rate (blocked / total) */
  blockRate: number
  /** Average requests per identifier */
  avgRequestsPerIdentifier: number
  /** Top blocked identifiers */
  topBlocked: Array<{ identifier: string; blocked: number }>
  /** Collection window */
  window: {
    start: number
    end: number
    durationMs: number
  }
}

/**
 * Validation metrics
 */
export interface ValidationMetrics {
  /** Total validations performed */
  total: number
  /** Successful validations */
  passed: number
  /** Failed validations */
  failed: number
  /** Failures by type */
  failuresByType: Record<string, number>
  /** Pass rate */
  passRate: number
}

// ============================================================================
// RATE LIMIT METRICS COLLECTOR
// ============================================================================

/**
 * Rate Limit Metrics Collector
 *
 * Collects and aggregates metrics for rate limiting operations.
 *
 * @example
 * ```typescript
 * const metrics = new RateLimitMetricsCollector()
 *
 * // Record a rate limit check
 * metrics.record('user:123', { allowed: true, remaining: 95 })
 * metrics.record('user:123', { allowed: false, remaining: 0 })
 *
 * // Get summary
 * const summary = metrics.getSummary()
 * console.log(`Block rate: ${summary.blockRate * 100}%`)
 * ```
 */
export class RateLimitMetricsCollector {
  private metrics: Map<string, RateLimitMetric> = new Map()
  private windowMs: number
  private windowStart: number

  constructor(windowMs: number = 60 * 60 * 1000) {
    this.windowMs = windowMs
    this.windowStart = Date.now()
  }

  /**
   * Record a rate limit check
   */
  record(
    identifier: string,
    result: { allowed: boolean; remaining: number }
  ): void {
    const now = Date.now()

    // Check if we need to rotate the window
    if (now - this.windowStart >= this.windowMs) {
      this.rotateWindow()
    }

    const existing = this.metrics.get(identifier)
    if (existing) {
      existing.requests++
      if (!result.allowed) {
        existing.blocked++
      }
      existing.lastRequest = now
    } else {
      this.metrics.set(identifier, {
        identifier,
        requests: 1,
        blocked: result.allowed ? 0 : 1,
        windowStart: this.windowStart,
        windowEnd: this.windowStart + this.windowMs,
        lastRequest: now,
      })
    }
  }

  /**
   * Get metrics for a specific identifier
   */
  get(identifier: string): RateLimitMetric | undefined {
    return this.metrics.get(identifier)
  }

  /**
   * Get summary of all metrics
   */
  getSummary(): RateLimitSummary {
    const now = Date.now()
    let totalRequests = 0
    let totalBlocked = 0

    const blockedByIdentifier: Array<{ identifier: string; blocked: number }> = []

    for (const metric of this.metrics.values()) {
      totalRequests += metric.requests
      totalBlocked += metric.blocked

      if (metric.blocked > 0) {
        blockedByIdentifier.push({
          identifier: metric.identifier,
          blocked: metric.blocked,
        })
      }
    }

    // Sort by blocked count descending
    blockedByIdentifier.sort((a, b) => b.blocked - a.blocked)

    return {
      totalIdentifiers: this.metrics.size,
      totalRequests,
      totalBlocked,
      blockRate: totalRequests > 0 ? totalBlocked / totalRequests : 0,
      avgRequestsPerIdentifier: this.metrics.size > 0
        ? totalRequests / this.metrics.size
        : 0,
      topBlocked: blockedByIdentifier.slice(0, 10),
      window: {
        start: this.windowStart,
        end: now,
        durationMs: now - this.windowStart,
      },
    }
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear()
    this.windowStart = Date.now()
  }

  /**
   * Get all metrics as array
   */
  getAll(): RateLimitMetric[] {
    return Array.from(this.metrics.values())
  }

  /**
   * Rotate to a new window
   */
  private rotateWindow(): void {
    this.metrics.clear()
    this.windowStart = Date.now()
  }
}

// ============================================================================
// VALIDATION METRICS COLLECTOR
// ============================================================================

/**
 * Validation Metrics Collector
 *
 * Tracks validation operations and their outcomes.
 */
export class ValidationMetricsCollector {
  private total: number = 0
  private passed: number = 0
  private failed: number = 0
  private failuresByType: Map<string, number> = new Map()

  /**
   * Record a validation result
   */
  record(success: boolean, failureType?: string): void {
    this.total++

    if (success) {
      this.passed++
    } else {
      this.failed++
      if (failureType) {
        this.failuresByType.set(
          failureType,
          (this.failuresByType.get(failureType) ?? 0) + 1
        )
      }
    }
  }

  /**
   * Get validation metrics
   */
  getMetrics(): ValidationMetrics {
    return {
      total: this.total,
      passed: this.passed,
      failed: this.failed,
      failuresByType: Object.fromEntries(this.failuresByType),
      passRate: this.total > 0 ? this.passed / this.total : 1,
    }
  }

  /**
   * Reset metrics
   */
  reset(): void {
    this.total = 0
    this.passed = 0
    this.failed = 0
    this.failuresByType.clear()
  }
}

// ============================================================================
// SINGLETON INSTANCES
// ============================================================================

/**
 * Global rate limit metrics collector
 */
export const rateLimitMetrics = new RateLimitMetricsCollector()

/**
 * Global validation metrics collector
 */
export const validationMetrics = new ValidationMetricsCollector()
