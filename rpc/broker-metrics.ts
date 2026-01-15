/**
 * Broker Routing Metrics and Monitoring
 *
 * This module provides metrics collection for the BrokerDO class to monitor
 * performance, track errors, and detect issues in WebSocket RPC routing.
 *
 * Key features:
 * - Request counting (total and per-target)
 * - Error tracking (total and per-target)
 * - Latency percentiles (p50, p95, p99) with memory-efficient sampling
 * - In-flight request tracking (current and peak)
 * - Hibernation wake statistics
 * - JSON export for /metrics endpoint
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Latency statistics for a target or globally
 */
export interface LatencyStats {
  /** Raw latency samples (limited by maxSamples) */
  samples: number[]
  /** 50th percentile latency in milliseconds */
  p50: number
  /** 95th percentile latency in milliseconds */
  p95: number
  /** 99th percentile latency in milliseconds */
  p99: number
}

/**
 * Complete broker metrics structure
 */
export interface BrokerMetrics {
  /** Request counters */
  requests: {
    /** Total number of requests processed */
    total: number
    /** Request count per target */
    byTarget: Map<string, number>
    /** Total number of errors */
    errors: number
    /** Error count per target */
    errorsByTarget: Map<string, number>
  }
  /** Latency measurements */
  latency: LatencyStats & {
    /** Per-target latency statistics */
    byTarget: Map<string, LatencyStats>
  }
  /** In-flight request tracking */
  inflight: {
    /** Current number of in-flight requests */
    current: number
    /** Peak number of concurrent in-flight requests */
    peak: number
  }
  /** Hibernation recovery statistics */
  hibernation: {
    /** Number of times the DO woke from hibernation */
    wakeCount: number
    /** Total number of requests successfully recovered after wake */
    recoveredRequests: number
    /** Total number of requests lost during hibernation */
    lostRequests: number
  }
}

/**
 * Configuration options for BrokerMetricsCollector
 */
export interface BrokerMetricsOptions {
  /** Maximum number of latency samples to keep in memory (default: 1000) */
  maxSamples?: number
}

/**
 * JSON-serializable version of BrokerMetrics (Maps converted to objects)
 */
export interface BrokerMetricsJSON {
  requests: {
    total: number
    byTarget: Record<string, number>
    errors: number
    errorsByTarget: Record<string, number>
  }
  latency: {
    p50: number
    p95: number
    p99: number
    sampleCount: number
    byTarget: Record<
      string,
      {
        p50: number
        p95: number
        p99: number
        sampleCount: number
      }
    >
  }
  inflight: {
    current: number
    peak: number
  }
  hibernation: {
    wakeCount: number
    recoveredRequests: number
    lostRequests: number
  }
}

// =============================================================================
// BrokerMetricsCollector Class
// =============================================================================

/**
 * Collects and manages metrics for broker routing.
 *
 * Usage:
 * ```typescript
 * const metrics = new BrokerMetricsCollector({ maxSamples: 1000 })
 *
 * // Track a request
 * const complete = metrics.recordRequestStart('worker-1')
 * // ... do work ...
 * complete() // Records latency
 *
 * // Track an error
 * metrics.recordError('worker-1')
 *
 * // Track hibernation wake
 * metrics.recordWake(recoveredCount, lostCount)
 *
 * // Export for /metrics endpoint
 * const json = metrics.toJSON()
 * ```
 */
export class BrokerMetricsCollector {
  /** Current metrics state */
  private metrics: BrokerMetrics

  /** Maximum number of latency samples to keep */
  private maxSamples: number

  /**
   * Create a new BrokerMetricsCollector
   *
   * @param options - Configuration options
   */
  constructor(options?: BrokerMetricsOptions) {
    this.maxSamples = options?.maxSamples ?? 1000
    this.metrics = this.createEmptyMetrics()
  }

  /**
   * Create a fresh empty metrics object
   */
  private createEmptyMetrics(): BrokerMetrics {
    return {
      requests: {
        total: 0,
        byTarget: new Map(),
        errors: 0,
        errorsByTarget: new Map(),
      },
      latency: {
        samples: [],
        p50: 0,
        p95: 0,
        p99: 0,
        byTarget: new Map(),
      },
      inflight: {
        current: 0,
        peak: 0,
      },
      hibernation: {
        wakeCount: 0,
        recoveredRequests: 0,
        lostRequests: 0,
      },
    }
  }

  // ===========================================================================
  // Request Tracking
  // ===========================================================================

  /**
   * Record the start of a request.
   *
   * Increments request count and in-flight count.
   * Returns a function to call when the request completes, which will
   * record the latency and decrement in-flight count.
   *
   * @param target - The target identifier (e.g., worker name)
   * @returns A completion function to call when the request finishes
   */
  recordRequestStart(target: string): () => void {
    // Increment total count
    this.metrics.requests.total++

    // Increment per-target count
    const currentCount = this.metrics.requests.byTarget.get(target) ?? 0
    this.metrics.requests.byTarget.set(target, currentCount + 1)

    // Update in-flight tracking
    this.metrics.inflight.current++
    if (this.metrics.inflight.current > this.metrics.inflight.peak) {
      this.metrics.inflight.peak = this.metrics.inflight.current
    }

    // Capture start time for latency calculation
    const startTime = Date.now()

    // Return completion callback
    return () => {
      // Decrement in-flight
      this.metrics.inflight.current--

      // Calculate and record latency
      const latency = Date.now() - startTime
      this.recordLatency(target, latency)
    }
  }

  // ===========================================================================
  // Error Tracking
  // ===========================================================================

  /**
   * Record an error for a target.
   *
   * @param target - The target identifier where the error occurred
   */
  recordError(target: string): void {
    // Increment total error count
    this.metrics.requests.errors++

    // Increment per-target error count
    const currentCount = this.metrics.requests.errorsByTarget.get(target) ?? 0
    this.metrics.requests.errorsByTarget.set(target, currentCount + 1)
  }

  // ===========================================================================
  // Latency Tracking
  // ===========================================================================

  /**
   * Record a latency sample for a target.
   *
   * @param target - The target identifier
   * @param latencyMs - The latency in milliseconds
   */
  private recordLatency(target: string, latencyMs: number): void {
    // Update global latency
    this.addLatencySample(this.metrics.latency, latencyMs)

    // Update per-target latency
    let targetLatency = this.metrics.latency.byTarget.get(target)
    if (!targetLatency) {
      targetLatency = { samples: [], p50: 0, p95: 0, p99: 0 }
      this.metrics.latency.byTarget.set(target, targetLatency)
    }
    this.addLatencySample(targetLatency, latencyMs)
  }

  /**
   * Add a latency sample to a stats object and update percentiles.
   *
   * @param stats - The latency stats object to update
   * @param latencyMs - The latency sample to add
   */
  private addLatencySample(stats: LatencyStats, latencyMs: number): void {
    // Add sample
    stats.samples.push(latencyMs)

    // Enforce maxSamples limit (FIFO: remove oldest)
    if (stats.samples.length > this.maxSamples) {
      stats.samples.shift()
    }

    // Update percentiles
    this.updatePercentiles(stats)
  }

  /**
   * Recalculate percentiles for a latency stats object.
   *
   * @param stats - The latency stats object to update
   */
  private updatePercentiles(stats: LatencyStats): void {
    if (stats.samples.length === 0) {
      stats.p50 = 0
      stats.p95 = 0
      stats.p99 = 0
      return
    }

    // Sort samples for percentile calculation
    const sorted = [...stats.samples].sort((a, b) => a - b)

    stats.p50 = this.percentile(sorted, 50)
    stats.p95 = this.percentile(sorted, 95)
    stats.p99 = this.percentile(sorted, 99)
  }

  /**
   * Calculate the percentile value from a sorted array.
   *
   * Uses the "nearest rank" method.
   *
   * @param sorted - Sorted array of values
   * @param p - Percentile to calculate (0-100)
   * @returns The percentile value
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const index = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, index)]
  }

  // ===========================================================================
  // Hibernation Tracking
  // ===========================================================================

  /**
   * Record a hibernation wake event.
   *
   * @param recoveredCount - Number of requests successfully recovered
   * @param lostCount - Number of requests lost during hibernation
   */
  recordWake(recoveredCount: number, lostCount: number): void {
    this.metrics.hibernation.wakeCount++
    this.metrics.hibernation.recoveredRequests += recoveredCount
    this.metrics.hibernation.lostRequests += lostCount
  }

  // ===========================================================================
  // Metrics Access
  // ===========================================================================

  /**
   * Get the current metrics object.
   *
   * Note: This returns the internal object. Do not modify directly.
   *
   * @returns The current metrics
   */
  getMetrics(): BrokerMetrics {
    return this.metrics
  }

  /**
   * Export metrics as a JSON-serializable object.
   *
   * Converts Map instances to plain objects for JSON serialization.
   * Omits raw sample arrays to reduce payload size.
   *
   * @returns JSON-serializable metrics object
   */
  toJSON(): BrokerMetricsJSON {
    return {
      requests: {
        total: this.metrics.requests.total,
        byTarget: Object.fromEntries(this.metrics.requests.byTarget),
        errors: this.metrics.requests.errors,
        errorsByTarget: Object.fromEntries(this.metrics.requests.errorsByTarget),
      },
      latency: {
        p50: this.metrics.latency.p50,
        p95: this.metrics.latency.p95,
        p99: this.metrics.latency.p99,
        sampleCount: this.metrics.latency.samples.length,
        byTarget: Object.fromEntries(
          Array.from(this.metrics.latency.byTarget.entries()).map(([key, stats]) => [
            key,
            {
              p50: stats.p50,
              p95: stats.p95,
              p99: stats.p99,
              sampleCount: stats.samples.length,
            },
          ])
        ),
      },
      inflight: {
        current: this.metrics.inflight.current,
        peak: this.metrics.inflight.peak,
      },
      hibernation: {
        wakeCount: this.metrics.hibernation.wakeCount,
        recoveredRequests: this.metrics.hibernation.recoveredRequests,
        lostRequests: this.metrics.hibernation.lostRequests,
      },
    }
  }

  // ===========================================================================
  // Reset
  // ===========================================================================

  /**
   * Reset all metrics to initial state.
   *
   * Useful for periodic metric snapshots or testing.
   */
  reset(): void {
    this.metrics = this.createEmptyMetrics()
  }
}
