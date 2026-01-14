/**
 * Circuit Breaker Implementation
 *
 * A comprehensive circuit breaker pattern implementation with:
 * - Sliding window failure tracking
 * - Fallback handling
 * - Health checking
 * - Bulkhead pattern (concurrency limiting)
 * - Retry policies
 * - Registry for managing multiple circuits
 */

import {
  CircuitState,
  CircuitConfig,
  CircuitStats,
  CircuitEvent,
  CircuitOpenError,
  BulkheadFullError,
  QueueTimeoutError,
  StateChangeCallback,
  EventCallback,
  SlidingWindowConfig,
  FallbackConfig,
  HealthCheckConfig,
  BulkheadConfig,
  RetryPolicyConfig,
  SlidingWindowEntry,
} from './types'

export {
  CircuitOpenError,
  BulkheadFullError,
  QueueTimeoutError,
} from './types'

/**
 * Sliding window for tracking failures over time
 */
export class SlidingWindow {
  private entries: SlidingWindowEntry[] = []
  private readonly windowSize: number
  private readonly minRequests: number

  constructor(config: SlidingWindowConfig) {
    this.windowSize = config.windowSize
    this.minRequests = config.minRequests ?? 1
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowSize
    this.entries = this.entries.filter((e) => e.timestamp > cutoff)
  }

  recordSuccess(): void {
    this.prune()
    this.entries.push({ timestamp: Date.now(), success: true })
  }

  recordFailure(): void {
    this.prune()
    this.entries.push({ timestamp: Date.now(), success: false })
  }

  getSuccessCount(): number {
    this.prune()
    return this.entries.filter((e) => e.success).length
  }

  getFailureCount(): number {
    this.prune()
    return this.entries.filter((e) => !e.success).length
  }

  getTotalCount(): number {
    this.prune()
    return this.entries.length
  }

  getFailureRate(): number {
    this.prune()
    const total = this.entries.length
    if (total === 0) return 0
    return this.getFailureCount() / total
  }

  hasMinimumRequests(): boolean {
    this.prune()
    return this.entries.length >= this.minRequests
  }

  clear(): void {
    this.entries = []
  }
}

/**
 * Fallback handler for executing alternative logic when circuit is open
 */
export class FallbackHandler {
  private readonly handler: <T>() => T | Promise<T>
  private readonly timeout?: number

  constructor(config: FallbackConfig) {
    this.handler = config.handler
    this.timeout = config.timeout
  }

  async execute<T>(): Promise<T> {
    if (!this.timeout) {
      return this.handler<T>()
    }

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Fallback timeout'))
      }, this.timeout)

      Promise.resolve(this.handler<T>())
        .then((result) => {
          clearTimeout(timeoutId)
          resolve(result)
        })
        .catch((err) => {
          clearTimeout(timeoutId)
          reject(err)
        })
    })
  }
}

/**
 * Health checker for periodic health probing
 */
export class HealthChecker {
  private readonly interval: number
  private readonly checker: () => boolean | Promise<boolean>
  private healthy: boolean = false
  private intervalId?: ReturnType<typeof setInterval>
  private recoveryCallbacks: Array<() => void> = []
  private wasHealthy: boolean = false

  constructor(config: HealthCheckConfig) {
    this.interval = config.interval
    this.checker = config.checker
  }

  start(): void {
    this.intervalId = setInterval(async () => {
      try {
        const result = await this.checker()
        const wasUnhealthy = !this.healthy
        this.healthy = result

        if (wasUnhealthy && this.healthy && this.wasHealthy) {
          this.recoveryCallbacks.forEach((cb) => cb())
        }
        this.wasHealthy = true
      } catch {
        this.healthy = false
        this.wasHealthy = true
      }
    }, this.interval)
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = undefined
    }
  }

  isHealthy(): boolean {
    return this.healthy
  }

  onRecovery(callback: () => void): void {
    this.recoveryCallbacks.push(callback)
  }
}

/**
 * Bulkhead for limiting concurrent executions
 */
export class Bulkhead {
  private readonly maxConcurrent: number
  private readonly queueSize: number
  private readonly queueTimeout?: number
  private activeCount: number = 0
  private queue: Array<{
    fn: () => Promise<unknown>
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timeoutId?: ReturnType<typeof setTimeout>
  }> = []

  constructor(config: BulkheadConfig) {
    this.maxConcurrent = config.maxConcurrent
    this.queueSize = config.queueSize ?? 0
    this.queueTimeout = config.queueTimeout
  }

  async execute<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.activeCount < this.maxConcurrent) {
      return this.runExecution(fn)
    }

    if (this.queue.length >= this.queueSize) {
      throw new BulkheadFullError()
    }

    return new Promise<T>((resolve, reject) => {
      const queueEntry: (typeof this.queue)[0] = {
        fn: fn as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      }

      if (this.queueTimeout) {
        queueEntry.timeoutId = setTimeout(() => {
          const index = this.queue.indexOf(queueEntry)
          if (index !== -1) {
            this.queue.splice(index, 1)
            reject(new QueueTimeoutError())
          }
        }, this.queueTimeout)
      }

      this.queue.push(queueEntry)
    })
  }

  private async runExecution<T>(fn: () => T | Promise<T>): Promise<T> {
    this.activeCount++
    try {
      return await fn()
    } finally {
      this.activeCount--
      this.processQueue()
    }
  }

  private processQueue(): void {
    if (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
      const entry = this.queue.shift()!
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId)
      }
      this.runExecution(entry.fn)
        .then(entry.resolve)
        .catch(entry.reject)
    }
  }

  getActiveCount(): number {
    return this.activeCount
  }

  getQueueSize(): number {
    return this.queue.length
  }
}

/**
 * Retry policy for retrying before recording failure
 */
export class RetryPolicy {
  private readonly maxRetries: number
  private readonly baseDelay: number
  private readonly maxDelay: number
  private readonly backoffMultiplier: number
  private readonly retryableErrors?: (error: Error) => boolean

  constructor(config: RetryPolicyConfig) {
    this.maxRetries = config.maxRetries
    this.baseDelay = config.baseDelay ?? 100
    this.maxDelay = config.maxDelay ?? 30000
    this.backoffMultiplier = config.backoffMultiplier ?? 1
    this.retryableErrors = config.retryableErrors
  }

  async execute<T>(fn: () => T | Promise<T>): Promise<T> {
    let lastError: Error
    let attempts = 0

    while (attempts <= this.maxRetries) {
      try {
        return await fn()
      } catch (err) {
        lastError = err as Error

        // Check if error is retryable before attempting retry
        if (this.retryableErrors && !this.retryableErrors(lastError)) {
          throw lastError
        }

        attempts++
        if (attempts <= this.maxRetries) {
          const delay = Math.min(
            this.baseDelay * Math.pow(this.backoffMultiplier, attempts - 1),
            this.maxDelay
          )
          await this.sleep(delay)
        }
      }
    }

    throw lastError!
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/**
 * Main Circuit Breaker class
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed'
  private failures: number = 0
  private successes: number = 0
  private lastFailure: number | null = null
  private lastStateChange: number = Date.now()

  private totalRequests: number = 0
  private totalSuccesses: number = 0
  private totalFailures: number = 0
  private totalRejected: number = 0
  private totalFallbacks: number = 0

  private halfOpenAttempts: number = 0

  private readonly config: CircuitConfig
  private readonly stateChangeCallbacks: StateChangeCallback[] = []
  private readonly eventCallbacks: Map<CircuitEvent, EventCallback[]> = new Map()

  private readonly slidingWindow?: SlidingWindow
  private readonly fallbackHandler?: FallbackHandler
  private readonly healthChecker?: HealthChecker
  private readonly bulkhead?: Bulkhead
  private readonly retryPolicy?: RetryPolicy

  constructor(config: CircuitConfig) {
    this.config = config

    if (config.slidingWindow) {
      this.slidingWindow = new SlidingWindow(config.slidingWindow)
    }

    if (config.fallback) {
      this.fallbackHandler = new FallbackHandler(config.fallback)
    }

    if (config.healthCheck) {
      this.healthChecker = new HealthChecker(config.healthCheck)
      this.healthChecker.onRecovery(() => {
        if (this.state === 'open') {
          this.transitionTo('half-open')
        }
      })
      this.healthChecker.start()
    }

    if (config.bulkhead) {
      this.bulkhead = new Bulkhead(config.bulkhead)
    }

    if (config.retryPolicy) {
      this.retryPolicy = new RetryPolicy(config.retryPolicy)
    }
  }

  async execute<T>(fn: () => T | Promise<T>): Promise<T> {
    this.checkStateTransition()

    // Check bulkhead first
    if (this.bulkhead) {
      return this.bulkhead.execute(() => this.doExecute(fn))
    }

    return this.doExecute(fn)
  }

  private async doExecute<T>(fn: () => T | Promise<T>): Promise<T> {
    this.checkStateTransition()
    this.totalRequests++

    if (this.state === 'open') {
      if (this.fallbackHandler) {
        this.totalFallbacks++
        this.emit('fallback')
        return this.fallbackHandler.execute<T>()
      }
      this.totalRejected++
      this.emit('rejected', { state: this.state })
      throw new CircuitOpenError('Circuit is open', this.config.name)
    }

    if (this.state === 'half-open') {
      this.halfOpenAttempts++
    }

    try {
      let result: T
      if (this.retryPolicy) {
        result = await this.retryPolicy.execute(fn)
      } else {
        result = await fn()
      }

      this.recordSuccess()
      return result
    } catch (err) {
      this.recordFailure(err as Error)
      throw err
    }
  }

  private checkStateTransition(): void {
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastStateChange
      if (elapsed >= this.config.resetTimeout) {
        this.transitionTo('half-open')
      }
    }
  }

  private recordSuccess(): void {
    this.successes++
    this.totalSuccesses++
    this.failures = 0

    if (this.slidingWindow) {
      this.slidingWindow.recordSuccess()
    }

    this.emit('success', { successes: this.successes })

    if (this.state === 'half-open') {
      this.transitionTo('closed')
      this.halfOpenAttempts = 0
    }
  }

  private recordFailure(error: Error): void {
    this.failures++
    this.totalFailures++
    this.lastFailure = Date.now()

    if (this.slidingWindow) {
      this.slidingWindow.recordFailure()
    }

    this.emit('failure', { error, failures: this.failures })

    if (this.state === 'half-open') {
      this.transitionTo('open')
      this.halfOpenAttempts = 0
      return
    }

    const failureCount = this.slidingWindow
      ? this.slidingWindow.getFailureCount()
      : this.failures

    if (failureCount >= this.config.failureThreshold) {
      this.transitionTo('open')
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return

    const previousState = this.state
    this.state = newState
    this.lastStateChange = Date.now()

    if (newState === 'closed') {
      this.failures = 0
      this.successes = 0
      if (this.slidingWindow) {
        this.slidingWindow.clear()
      }
    }

    const stats = this.getStats()
    this.stateChangeCallbacks.forEach((cb) => cb(previousState, newState, stats))
    this.emit(newState as CircuitEvent)
  }

  private emit(event: CircuitEvent, data?: unknown): void {
    const callbacks = this.eventCallbacks.get(event)
    if (callbacks) {
      callbacks.forEach((cb) => cb(event, data))
    }
  }

  getState(): CircuitState {
    this.checkStateTransition()
    return this.state
  }

  getStats(): CircuitStats {
    return {
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailure,
      state: this.state,
      totalRequests: this.totalRequests,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      totalRejected: this.totalRejected,
      totalFallbacks: this.totalFallbacks,
    }
  }

  reset(): void {
    this.transitionTo('closed')
  }

  open(): void {
    this.transitionTo('open')
  }

  onStateChange(callback: StateChangeCallback): void {
    this.stateChangeCallbacks.push(callback)
  }

  on(event: CircuitEvent, callback: EventCallback): void {
    if (!this.eventCallbacks.has(event)) {
      this.eventCallbacks.set(event, [])
    }
    this.eventCallbacks.get(event)!.push(callback)
  }

  destroy(): void {
    if (this.healthChecker) {
      this.healthChecker.stop()
    }
  }
}

/**
 * Registry for managing multiple circuit breakers
 */
export class CircuitBreakerRegistry {
  private circuits: Map<string, CircuitBreaker> = new Map()

  getOrCreate(name: string, config: CircuitConfig): CircuitBreaker {
    const existing = this.circuits.get(name)
    if (existing) {
      return existing
    }

    const cb = new CircuitBreaker({ ...config, name })
    this.circuits.set(name, cb)
    return cb
  }

  get(name: string): CircuitBreaker | undefined {
    return this.circuits.get(name)
  }

  remove(name: string): boolean {
    const cb = this.circuits.get(name)
    if (cb) {
      cb.destroy()
      return this.circuits.delete(name)
    }
    return false
  }

  list(): string[] {
    return Array.from(this.circuits.keys())
  }

  getAllStats(): Record<string, CircuitStats> {
    const stats: Record<string, CircuitStats> = {}
    this.circuits.forEach((cb, name) => {
      stats[name] = cb.getStats()
    })
    return stats
  }

  resetAll(): void {
    this.circuits.forEach((cb) => cb.reset())
  }
}
