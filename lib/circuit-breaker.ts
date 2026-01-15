/**
 * @module lib/circuit-breaker
 *
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascade failures by:
 * - Opening circuit after N consecutive failures (or percentage threshold)
 * - Failing fast when circuit is open
 * - Probing with half-open state after reset timeout
 * - Supporting timeout protection and bulkhead pattern
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for CircuitBreaker
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit (count-based) or percentage (percentage-based) */
  failureThreshold: number
  /** Time in ms before transitioning from open to half-open */
  resetTimeout: number
  /** Optional timeout for individual operations */
  timeout?: number
  /** How to count failures: 'count' or 'percentage' */
  thresholdType?: 'count' | 'percentage'
  /** Minimum calls before percentage threshold kicks in */
  minimumThroughput?: number
  /** Time window for failure counting (ms) */
  failureWindow?: number
  /** Max concurrent calls in half-open state */
  halfOpenMaxCalls?: number
  /** Max concurrent calls total (bulkhead) */
  maxConcurrent?: number
  /** Max queued calls when maxConcurrent reached */
  maxQueued?: number
  /** Callback on state change */
  onStateChange?: (change: {
    from: string
    to: string
    reason: string
    timestamp: Date
  }) => void
}

/**
 * Statistics returned by CircuitBreaker
 */
export interface CircuitBreakerStats {
  successCount: number
  failureCount: number
  totalCount: number
  consecutiveFailures: number
  stateChanges: Array<{ from: string; to: string; timestamp: Date }>
  averageResponseTime?: number
  p99ResponseTime?: number
  config: CircuitBreakerConfig
}

/**
 * Circuit state type
 */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open'

// ============================================================================
// CIRCUIT BREAKER IMPLEMENTATION
// ============================================================================

/**
 * Circuit Breaker implementation
 *
 * States:
 * - closed: Normal operation, tracking failures
 * - open: Failing fast, not allowing calls through
 * - half-open: Allowing limited probe calls to test recovery
 */
export class CircuitBreaker {
  private _state: CircuitBreakerState = 'closed'
  private config: CircuitBreakerConfig
  private consecutiveFailures = 0
  private successCount = 0
  private failureCount = 0
  private totalCount = 0
  private stateChanges: Array<{ from: string; to: string; timestamp: Date }> = []
  private responseTimes: number[] = []
  private openedAt: number | null = null
  private halfOpenCallsInProgress = 0
  private concurrentCalls = 0
  private queuedCalls: Array<{
    resolve: (value: unknown) => void
    reject: (reason: unknown) => void
    fn: (signal?: AbortSignal) => Promise<unknown>
  }> = []
  private resetTimer: ReturnType<typeof setTimeout> | null = null

  constructor(config: CircuitBreakerConfig) {
    // Validate config
    if (config.failureThreshold < 0) {
      throw new Error('failureThreshold must be non-negative')
    }
    if (config.resetTimeout < 0) {
      throw new Error('resetTimeout must be non-negative')
    }

    this.config = {
      ...config,
      timeout: config.timeout ?? 30000,
      thresholdType: config.thresholdType ?? 'count',
      minimumThroughput: config.minimumThroughput ?? 10,
      halfOpenMaxCalls: config.halfOpenMaxCalls ?? 1,
    }
  }

  get state(): CircuitBreakerState {
    return this._state
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: (signal?: AbortSignal) => Promise<T>): Promise<T> {
    // Check bulkhead limits
    if (this.config.maxConcurrent !== undefined) {
      if (this.concurrentCalls >= this.config.maxConcurrent) {
        // Check queue limits
        if (this.config.maxQueued !== undefined && this.queuedCalls.length >= this.config.maxQueued) {
          throw new Error('Circuit breaker queue full')
        }

        // Queue this call
        return new Promise<T>((resolve, reject) => {
          this.queuedCalls.push({
            resolve: resolve as (value: unknown) => void,
            reject,
            fn: fn as (signal?: AbortSignal) => Promise<unknown>,
          })
        })
      }
    }

    return this.executeInternal(fn)
  }

  private async executeInternal<T>(fn: (signal?: AbortSignal) => Promise<T>): Promise<T> {
    // Check state transitions
    this.checkStateTransition()

    // Handle open state - fail fast
    if (this._state === 'open') {
      throw new Error('Circuit is open')
    }

    // Handle half-open state - limit concurrent calls
    if (this._state === 'half-open') {
      if (this.halfOpenCallsInProgress >= (this.config.halfOpenMaxCalls ?? 1)) {
        throw new Error('Circuit is open')
      }
      this.halfOpenCallsInProgress++
    }

    this.concurrentCalls++
    const startTime = Date.now()

    try {
      let result: T

      if (this.config.timeout) {
        const abortController = new AbortController()
        const timeoutId = setTimeout(() => {
          abortController.abort()
        }, this.config.timeout)

        try {
          result = await Promise.race([
            fn(abortController.signal),
            new Promise<T>((_, reject) => {
              const timeoutReject = () => reject(new Error('Timeout'))
              setTimeout(timeoutReject, this.config.timeout!)
            }),
          ])
        } finally {
          clearTimeout(timeoutId)
        }
      } else {
        result = await fn()
      }

      this.recordSuccess(Date.now() - startTime)
      return result
    } catch (error) {
      this.recordFailure()
      throw error
    } finally {
      this.concurrentCalls--
      if (this._state === 'half-open') {
        this.halfOpenCallsInProgress--
      }
      this.processQueue()
    }
  }

  private processQueue(): void {
    if (
      this.queuedCalls.length > 0 &&
      this.config.maxConcurrent !== undefined &&
      this.concurrentCalls < this.config.maxConcurrent
    ) {
      const next = this.queuedCalls.shift()
      if (next) {
        this.executeInternal(next.fn).then(next.resolve).catch(next.reject)
      }
    }
  }

  private checkStateTransition(): void {
    if (this._state === 'open' && this.openedAt !== null) {
      const elapsed = Date.now() - this.openedAt
      if (elapsed >= this.config.resetTimeout) {
        this.transitionTo('half-open', 'Reset timeout elapsed')
      }
    }
  }

  private recordSuccess(responseTime: number): void {
    this.successCount++
    this.totalCount++
    this.consecutiveFailures = 0
    this.responseTimes.push(responseTime)

    // Keep only last 1000 response times
    if (this.responseTimes.length > 1000) {
      this.responseTimes.shift()
    }

    // If in half-open state and call succeeded, close the circuit
    if (this._state === 'half-open') {
      this.transitionTo('closed', 'Successful probe in half-open state')
    }
  }

  private recordFailure(): void {
    this.failureCount++
    this.totalCount++
    this.consecutiveFailures++

    // If in half-open state and call failed, re-open the circuit
    if (this._state === 'half-open') {
      this.transitionTo('open', 'Failed probe in half-open state')
      return
    }

    // Check if we should open the circuit
    if (this.shouldOpen()) {
      this.transitionTo('open', `Failure threshold reached (${this.consecutiveFailures} consecutive failures)`)
    }
  }

  private shouldOpen(): boolean {
    if (this._state !== 'closed') {
      return false
    }

    if (this.config.thresholdType === 'percentage') {
      // Don't trigger until minimum throughput is met
      if (this.totalCount < (this.config.minimumThroughput ?? 10)) {
        return false
      }

      const failureRate = (this.failureCount / this.totalCount) * 100
      return failureRate >= this.config.failureThreshold
    }

    // Count-based threshold
    return this.consecutiveFailures >= this.config.failureThreshold
  }

  private transitionTo(newState: CircuitBreakerState, reason: string): void {
    const oldState = this._state
    if (oldState === newState) return

    this._state = newState

    const change = {
      from: oldState,
      to: newState,
      timestamp: new Date(),
    }

    this.stateChanges.push(change)

    if (newState === 'open') {
      this.openedAt = Date.now()
      this.scheduleHalfOpen()
    } else if (newState === 'closed') {
      this.openedAt = null
      if (this.resetTimer) {
        clearTimeout(this.resetTimer)
        this.resetTimer = null
      }
    }

    // Invoke callback
    if (this.config.onStateChange) {
      this.config.onStateChange({
        ...change,
        reason,
      })
    }
  }

  private scheduleHalfOpen(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer)
    }

    this.resetTimer = setTimeout(() => {
      if (this._state === 'open') {
        this.transitionTo('half-open', 'Reset timeout elapsed')
      }
    }, this.config.resetTimeout)
  }

  /**
   * Get current statistics
   */
  getStats(): CircuitBreakerStats {
    const sortedTimes = [...this.responseTimes].sort((a, b) => a - b)
    const averageResponseTime =
      sortedTimes.length > 0 ? sortedTimes.reduce((a, b) => a + b, 0) / sortedTimes.length : undefined

    const p99Index = Math.floor(sortedTimes.length * 0.99)
    const p99ResponseTime = sortedTimes.length > 0 ? sortedTimes[p99Index] : undefined

    return {
      successCount: this.successCount,
      failureCount: this.failureCount,
      totalCount: this.totalCount,
      consecutiveFailures: this.consecutiveFailures,
      stateChanges: [...this.stateChanges],
      averageResponseTime,
      p99ResponseTime,
      config: { ...this.config },
    }
  }

  /**
   * Manually open the circuit
   */
  open(): void {
    if (this._state !== 'open') {
      this.transitionTo('open', 'Manual open')
    }
  }

  /**
   * Manually close the circuit
   */
  close(): void {
    if (this._state !== 'closed') {
      this.transitionTo('closed', 'Manual close')
      this.consecutiveFailures = 0
    }
  }

  /**
   * Reset all stats and return to closed state
   */
  reset(): void {
    this.consecutiveFailures = 0
    this.successCount = 0
    this.failureCount = 0
    this.totalCount = 0
    this.stateChanges = []
    this.responseTimes = []
    this.openedAt = null
    this.halfOpenCallsInProgress = 0

    if (this.resetTimer) {
      clearTimeout(this.resetTimer)
      this.resetTimer = null
    }

    if (this._state !== 'closed') {
      this._state = 'closed'
    }
  }
}
