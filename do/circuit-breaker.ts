/**
 * Circuit Breaker Pattern Implementation for DO Graceful Degradation
 *
 * Implements the circuit breaker pattern to protect against cascading failures
 * when Durable Objects become unavailable or slow to respond.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit is open, requests fail fast with fallback response
 * - HALF_OPEN: Testing if service has recovered, limited requests pass through
 *
 * @module @dotdo/do/circuit-breaker
 */

/**
 * Circuit breaker states
 */
export type CircuitState = 'closed' | 'open' | 'half_open'

/**
 * Configuration for a circuit breaker instance
 */
export interface CircuitBreakerConfig {
  /** Name/identifier for this circuit (e.g., DO namespace) */
  name: string

  /** Number of failures before opening the circuit (default: 5) */
  failureThreshold?: number

  /** Time in ms to wait before transitioning from OPEN to HALF_OPEN (default: 30000) */
  resetTimeoutMs?: number

  /** Number of successful requests in HALF_OPEN needed to close circuit (default: 3) */
  successThreshold?: number

  /** Request timeout in ms - requests taking longer count as failures (default: 10000) */
  timeoutMs?: number

  /** Percentage of requests to allow in HALF_OPEN state (default: 0.1 = 10%) */
  halfOpenRequestRatio?: number

  /** Called when circuit state changes */
  onStateChange?: (name: string, fromState: CircuitState, toState: CircuitState) => void

  /** Called on each failure */
  onFailure?: (name: string, error: Error, stats: CircuitStats) => void

  /** Called on each success */
  onSuccess?: (name: string, latencyMs: number, stats: CircuitStats) => void
}

/**
 * Statistics tracked by the circuit breaker
 */
export interface CircuitStats {
  /** Total number of requests */
  totalRequests: number

  /** Number of successful requests */
  successCount: number

  /** Number of failed requests */
  failureCount: number

  /** Number of requests rejected due to open circuit */
  rejectedCount: number

  /** Number of timeout failures */
  timeoutCount: number

  /** Current consecutive failure count */
  consecutiveFailures: number

  /** Current consecutive success count */
  consecutiveSuccesses: number

  /** Last failure time */
  lastFailureTime: number | null

  /** Last success time */
  lastSuccessTime: number | null

  /** Time circuit was opened */
  circuitOpenedAt: number | null

  /** Average latency of successful requests (ms) */
  avgLatencyMs: number

  /** 95th percentile latency (ms) */
  p95LatencyMs: number

  /** Current state */
  state: CircuitState
}

/**
 * Result of a circuit breaker execution
 */
export type CircuitBreakerResult<T> =
  | { success: true; value: T; latencyMs: number; fromCache?: boolean }
  | { success: false; error: Error; rejected: boolean; fallbackUsed: boolean }

/**
 * CircuitBreaker - Protects against cascading failures
 *
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker({
 *   name: 'customer-do',
 *   failureThreshold: 5,
 *   resetTimeoutMs: 30000,
 * })
 *
 * // Execute with circuit breaker protection
 * const result = await breaker.execute(
 *   () => stub.fetch(request),
 *   () => new Response(JSON.stringify({ error: 'Service unavailable' }), { status: 503 })
 * )
 *
 * if (result.success) {
 *   return result.value
 * } else if (result.fallbackUsed) {
 *   return result.error // This is actually the fallback response
 * }
 * ```
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed'
  private config: Required<CircuitBreakerConfig>
  private stats: CircuitStats
  private latencies: number[] = []
  private readonly maxLatencySamples = 100

  constructor(config: CircuitBreakerConfig) {
    this.config = {
      name: config.name,
      failureThreshold: config.failureThreshold ?? 5,
      resetTimeoutMs: config.resetTimeoutMs ?? 30000,
      successThreshold: config.successThreshold ?? 3,
      timeoutMs: config.timeoutMs ?? 10000,
      halfOpenRequestRatio: config.halfOpenRequestRatio ?? 0.1,
      onStateChange: config.onStateChange ?? (() => {}),
      onFailure: config.onFailure ?? (() => {}),
      onSuccess: config.onSuccess ?? (() => {}),
    }

    this.stats = {
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      rejectedCount: 0,
      timeoutCount: 0,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastFailureTime: null,
      lastSuccessTime: null,
      circuitOpenedAt: null,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      state: 'closed',
    }
  }

  /**
   * Get the current circuit state
   */
  getState(): CircuitState {
    return this.state
  }

  /**
   * Get current circuit statistics
   */
  getStats(): CircuitStats {
    return { ...this.stats, state: this.state }
  }

  /**
   * Get the circuit breaker name
   */
  getName(): string {
    return this.config.name
  }

  /**
   * Check if the circuit is allowing requests
   */
  isAllowingRequests(): boolean {
    this.checkStateTransition()
    return this.state === 'closed' || (this.state === 'half_open' && this.shouldAllowHalfOpenRequest())
  }

  /**
   * Execute an operation with circuit breaker protection
   *
   * @param operation - The operation to execute
   * @param fallback - Optional fallback to use when circuit is open or operation fails
   * @returns Result indicating success/failure with value or error
   */
  async execute<T>(
    operation: () => Promise<T>,
    fallback?: () => T | Promise<T>
  ): Promise<CircuitBreakerResult<T>> {
    this.stats.totalRequests++
    this.checkStateTransition()

    // Check if circuit is open
    if (this.state === 'open') {
      this.stats.rejectedCount++
      return this.handleRejection(fallback)
    }

    // In half-open state, only allow a percentage of requests through
    if (this.state === 'half_open' && !this.shouldAllowHalfOpenRequest()) {
      this.stats.rejectedCount++
      return this.handleRejection(fallback)
    }

    // Execute the operation with timeout
    const startTime = Date.now()
    try {
      const result = await this.executeWithTimeout(operation)
      const latencyMs = Date.now() - startTime

      this.recordSuccess(latencyMs)
      return { success: true, value: result, latencyMs }
    } catch (error) {
      const latencyMs = Date.now() - startTime
      const err = error instanceof Error ? error : new Error(String(error))

      // Check if it was a timeout
      if (err.message === 'Circuit breaker timeout') {
        this.stats.timeoutCount++
      }

      this.recordFailure(err)
      return this.handleFailure(err, fallback)
    }
  }

  /**
   * Force the circuit to open (useful for maintenance or known outages)
   */
  forceOpen(): void {
    this.transitionTo('open')
  }

  /**
   * Force the circuit to close (useful for testing or manual recovery)
   */
  forceClose(): void {
    this.transitionTo('closed')
    this.stats.consecutiveFailures = 0
    this.stats.consecutiveSuccesses = 0
  }

  /**
   * Reset the circuit breaker to initial state
   */
  reset(): void {
    this.state = 'closed'
    this.stats = {
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      rejectedCount: 0,
      timeoutCount: 0,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastFailureTime: null,
      lastSuccessTime: null,
      circuitOpenedAt: null,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      state: 'closed',
    }
    this.latencies = []
  }

  /**
   * Execute operation with timeout
   */
  private async executeWithTimeout<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Circuit breaker timeout'))
      }, this.config.timeoutMs)

      operation()
        .then((result) => {
          clearTimeout(timeoutId)
          resolve(result)
        })
        .catch((error) => {
          clearTimeout(timeoutId)
          reject(error)
        })
    })
  }

  /**
   * Check and perform state transitions based on timing
   */
  private checkStateTransition(): void {
    if (this.state === 'open' && this.stats.circuitOpenedAt) {
      const timeSinceOpen = Date.now() - this.stats.circuitOpenedAt
      if (timeSinceOpen >= this.config.resetTimeoutMs) {
        this.transitionTo('half_open')
      }
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    if (this.state !== newState) {
      const oldState = this.state
      this.state = newState

      if (newState === 'open') {
        this.stats.circuitOpenedAt = Date.now()
      } else if (newState === 'closed') {
        this.stats.circuitOpenedAt = null
      }

      this.config.onStateChange(this.config.name, oldState, newState)
    }
  }

  /**
   * Record a successful operation
   */
  private recordSuccess(latencyMs: number): void {
    this.stats.successCount++
    this.stats.consecutiveSuccesses++
    this.stats.consecutiveFailures = 0
    this.stats.lastSuccessTime = Date.now()

    // Update latency tracking
    this.latencies.push(latencyMs)
    if (this.latencies.length > this.maxLatencySamples) {
      this.latencies.shift()
    }
    this.updateLatencyStats()

    this.config.onSuccess(this.config.name, latencyMs, this.getStats())

    // In half-open state, check if we should close the circuit
    if (this.state === 'half_open' && this.stats.consecutiveSuccesses >= this.config.successThreshold) {
      this.transitionTo('closed')
    }
  }

  /**
   * Record a failed operation
   */
  private recordFailure(error: Error): void {
    this.stats.failureCount++
    this.stats.consecutiveFailures++
    this.stats.consecutiveSuccesses = 0
    this.stats.lastFailureTime = Date.now()

    this.config.onFailure(this.config.name, error, this.getStats())

    // Check if we should open the circuit
    if (this.state === 'closed' && this.stats.consecutiveFailures >= this.config.failureThreshold) {
      this.transitionTo('open')
    }

    // In half-open state, any failure opens the circuit again
    if (this.state === 'half_open') {
      this.transitionTo('open')
    }
  }

  /**
   * Determine if a request should be allowed in half-open state
   */
  private shouldAllowHalfOpenRequest(): boolean {
    return Math.random() < this.config.halfOpenRequestRatio
  }

  /**
   * Handle a rejected request (circuit open)
   */
  private async handleRejection<T>(fallback?: () => T | Promise<T>): Promise<CircuitBreakerResult<T>> {
    if (fallback) {
      try {
        const value = await fallback()
        return { success: false, error: new Error('Circuit open'), rejected: true, fallbackUsed: true }
      } catch {
        return { success: false, error: new Error('Circuit open and fallback failed'), rejected: true, fallbackUsed: false }
      }
    }
    return { success: false, error: new Error('Circuit open'), rejected: true, fallbackUsed: false }
  }

  /**
   * Handle a failed operation
   */
  private async handleFailure<T>(error: Error, fallback?: () => T | Promise<T>): Promise<CircuitBreakerResult<T>> {
    if (fallback) {
      try {
        await fallback()
        return { success: false, error, rejected: false, fallbackUsed: true }
      } catch {
        return { success: false, error, rejected: false, fallbackUsed: false }
      }
    }
    return { success: false, error, rejected: false, fallbackUsed: false }
  }

  /**
   * Update latency statistics
   */
  private updateLatencyStats(): void {
    if (this.latencies.length === 0) {
      this.stats.avgLatencyMs = 0
      this.stats.p95LatencyMs = 0
      return
    }

    const sum = this.latencies.reduce((a, b) => a + b, 0)
    this.stats.avgLatencyMs = sum / this.latencies.length

    const sorted = [...this.latencies].sort((a, b) => a - b)
    const p95Index = Math.floor(sorted.length * 0.95)
    this.stats.p95LatencyMs = sorted[p95Index] ?? sorted[sorted.length - 1] ?? 0
  }
}

/**
 * Circuit breaker registry for managing multiple circuits
 */
export class CircuitBreakerRegistry {
  private circuits: Map<string, CircuitBreaker> = new Map()
  private defaultConfig: Partial<CircuitBreakerConfig>

  constructor(defaultConfig: Partial<CircuitBreakerConfig> = {}) {
    this.defaultConfig = defaultConfig
  }

  /**
   * Get or create a circuit breaker for a name
   */
  get(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    let circuit = this.circuits.get(name)
    if (!circuit) {
      circuit = new CircuitBreaker({
        ...this.defaultConfig,
        ...config,
        name,
      })
      this.circuits.set(name, circuit)
    }
    return circuit
  }

  /**
   * Check if a circuit exists
   */
  has(name: string): boolean {
    return this.circuits.has(name)
  }

  /**
   * Remove a circuit breaker
   */
  remove(name: string): boolean {
    return this.circuits.delete(name)
  }

  /**
   * Get all circuit names
   */
  getNames(): string[] {
    return Array.from(this.circuits.keys())
  }

  /**
   * Get stats for all circuits
   */
  getAllStats(): Record<string, CircuitStats> {
    const stats: Record<string, CircuitStats> = {}
    for (const [name, circuit] of this.circuits) {
      stats[name] = circuit.getStats()
    }
    return stats
  }

  /**
   * Get circuits in a specific state
   */
  getByState(state: CircuitState): CircuitBreaker[] {
    return Array.from(this.circuits.values()).filter((c) => c.getState() === state)
  }

  /**
   * Reset all circuits
   */
  resetAll(): void {
    for (const circuit of this.circuits.values()) {
      circuit.reset()
    }
  }

  /**
   * Clear all circuits
   */
  clear(): void {
    this.circuits.clear()
  }
}

/**
 * Create a circuit breaker instance
 */
export function createCircuitBreaker(config: CircuitBreakerConfig): CircuitBreaker {
  return new CircuitBreaker(config)
}

/**
 * Create a circuit breaker registry with default configuration
 */
export function createCircuitBreakerRegistry(defaultConfig?: Partial<CircuitBreakerConfig>): CircuitBreakerRegistry {
  return new CircuitBreakerRegistry(defaultConfig)
}

// ============================================================================
// Request-Scoped Circuit Breaker Context (do-wffs)
// ============================================================================
// The global registry pattern causes state leakage between requests/tenants.
// This module provides request-scoped contexts for isolation.

/**
 * Minimal AsyncLocalStorage interface for type safety.
 * Compatible with Node.js AsyncLocalStorage and Cloudflare Workers.
 */
interface AsyncLocalStorageInterface<T> {
  run<R>(store: T, callback: () => R): R
  getStore(): T | undefined
}

/**
 * AsyncLocalStorage instance for circuit breaker context - lazily initialized.
 */
let circuitBreakerALS: AsyncLocalStorageInterface<CircuitBreakerRegistry> | null = null

// Lazy initialization to avoid issues in environments without AsyncLocalStorage
async function getCircuitBreakerALS(): Promise<AsyncLocalStorageInterface<CircuitBreakerRegistry>> {
  if (!circuitBreakerALS) {
    try {
      // Try dynamic import for Node.js/Workers environments
      const moduleName = 'node:async_hooks'
      const asyncHooks = await (import(moduleName) as Promise<{
        AsyncLocalStorage: new <T>() => AsyncLocalStorageInterface<T>
      }>)

      if (typeof asyncHooks?.AsyncLocalStorage !== 'function') {
        throw new Error('AsyncLocalStorage not available')
      }

      circuitBreakerALS = new asyncHooks.AsyncLocalStorage<CircuitBreakerRegistry>()
    } catch {
      // Fallback: Simple stack-based implementation for non-ALS environments
      const contextStack: CircuitBreakerRegistry[] = []

      circuitBreakerALS = {
        run<R>(store: CircuitBreakerRegistry, callback: () => R): R {
          contextStack.push(store)

          const result = callback()

          const isPromiseLike = (val: unknown): val is PromiseLike<unknown> =>
            val !== null &&
            typeof val === 'object' &&
            typeof (val as PromiseLike<unknown>).then === 'function'

          if (isPromiseLike(result)) {
            const resultPromise = Promise.resolve(result).finally(() => {
              contextStack.pop()
            })
            return resultPromise as unknown as R
          }

          contextStack.pop()
          return result
        },
        getStore(): CircuitBreakerRegistry | undefined {
          return contextStack[contextStack.length - 1]
        },
      }
    }
  }
  return circuitBreakerALS!
}

/**
 * Run a function with a circuit breaker registry scoped to this request.
 *
 * @param fn - The async function to run with the scoped registry
 * @param config - Optional default configuration for circuit breakers
 * @returns The result of the function
 *
 * @example
 * ```ts
 * // In middleware - ensures tenant isolation
 * app.use(async (c, next) => {
 *   await runWithCircuitBreakerRegistry(async () => {
 *     await next()
 *   })
 * })
 *
 * // In handler - circuits are isolated per request
 * const circuit = getCircuitBreaker('customer-service')
 * await circuit.execute(() => fetchCustomer(id))
 * ```
 */
export async function runWithCircuitBreakerRegistry<T>(
  fn: () => Promise<T>,
  config?: Partial<CircuitBreakerConfig>
): Promise<T> {
  const registry = new CircuitBreakerRegistry(config)
  const als = await getCircuitBreakerALS()

  try {
    return await als.run(registry, fn)
  } finally {
    // Clear the registry to release resources
    registry.clear()
  }
}

/**
 * Get the current circuit breaker registry from the request context.
 * Returns undefined if not running within runWithCircuitBreakerRegistry().
 *
 * @returns The current CircuitBreakerRegistry or undefined
 */
export function getCurrentCircuitBreakerRegistry(): CircuitBreakerRegistry | undefined {
  if (!circuitBreakerALS) {
    return undefined
  }
  return circuitBreakerALS.getStore()
}

/**
 * Get or create a circuit breaker for the given name.
 *
 * When running within runWithCircuitBreakerRegistry(), returns a circuit
 * from the request-scoped registry (tenant-isolated).
 *
 * When running outside a context, falls back to the global registry
 * (deprecated behavior - use runWithCircuitBreakerRegistry for proper isolation).
 *
 * @param name - The circuit breaker name
 * @param config - Optional configuration
 * @returns A CircuitBreaker instance
 */
export function getCircuitBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
  const registry = getCurrentCircuitBreakerRegistry()
  if (registry) {
    return registry.get(name, config)
  }
  // Fall back to global registry for backward compatibility
  return getGlobalCircuitBreakerRegistry().get(name, config)
}

// ============================================================================
// Global Circuit Breaker Registry (DEPRECATED - do-wffs)
// ============================================================================
// DEPRECATED: The global registry pattern causes state leakage between
// requests/tenants. Use runWithCircuitBreakerRegistry() for proper isolation.
//
// Migration guide:
// 1. Wrap request handlers with runWithCircuitBreakerRegistry()
// 2. Use getCurrentCircuitBreakerRegistry() or getCircuitBreaker() to get circuits
// 3. Circuits will be automatically isolated per request

/**
 * @deprecated Global registry causes tenant state leakage. Use runWithCircuitBreakerRegistry() instead.
 * @internal
 */
let globalRegistry: CircuitBreakerRegistry | null = null

/**
 * @deprecated Use runWithCircuitBreakerRegistry() and getCurrentCircuitBreakerRegistry() instead.
 */
export function getGlobalCircuitBreakerRegistry(): CircuitBreakerRegistry {
  if (!globalRegistry) {
    globalRegistry = new CircuitBreakerRegistry()
  }
  return globalRegistry
}

/**
 * @deprecated Use runWithCircuitBreakerRegistry() instead.
 */
export function resetGlobalCircuitBreakerRegistry(): void {
  if (globalRegistry) {
    globalRegistry.clear()
  }
  globalRegistry = null
}
