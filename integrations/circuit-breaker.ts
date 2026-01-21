/**
 * Circuit Breaker Integration for External Integrations
 *
 * Provides circuit breaker protection for third-party integrations to prevent
 * cascading failures when external services become unavailable or slow.
 *
 * Features:
 * - Per-integration failure tracking
 * - Configurable thresholds per integration
 * - Half-open state for testing recovery
 * - Automatic circuit closure on recovery
 *
 * This is a self-contained implementation that does not depend on @dotdo/do.
 *
 * @module @dotdo/integrations/circuit-breaker
 */

import type {
  Integration,
  IntegrationConfig,
  IntegrationResult,
  IntegrationMethods,
} from './types'

// ============================================================================
// Circuit Breaker Types
// ============================================================================

/**
 * Circuit breaker states
 */
export type CircuitState = 'closed' | 'open' | 'half_open'

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
type CircuitBreakerResult<T> =
  | { success: true; value: T; latencyMs: number; fromCache?: boolean }
  | { success: false; error: Error; rejected: boolean; fallbackUsed: boolean }

/**
 * Configuration for circuit breaker protected integration
 */
export interface CircuitBreakerIntegrationConfig {
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
  onStateChange?: (integrationName: string, fromState: CircuitState, toState: CircuitState) => void

  /** Called on each failure */
  onFailure?: (integrationName: string, error: Error, stats: CircuitStats) => void

  /** Called on each success */
  onSuccess?: (integrationName: string, latencyMs: number, stats: CircuitStats) => void
}

/**
 * Default circuit breaker configuration for integrations
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: Required<CircuitBreakerIntegrationConfig> = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  successThreshold: 3,
  timeoutMs: 10000,
  halfOpenRequestRatio: 0.1,
  onStateChange: () => {},
  onFailure: () => {},
  onSuccess: () => {},
}

// ============================================================================
// Internal Circuit Breaker Implementation
// ============================================================================

/**
 * Internal circuit breaker implementation for integrations
 */
class IntegrationCircuitBreaker {
  private state: CircuitState = 'closed'
  private config: Required<CircuitBreakerIntegrationConfig>
  private stats: CircuitStats
  private latencies: number[] = []
  private readonly maxLatencySamples = 100

  constructor(
    private readonly name: string,
    config: CircuitBreakerIntegrationConfig
  ) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config }

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

  getState(): CircuitState {
    return this.state
  }

  getStats(): CircuitStats {
    return { ...this.stats, state: this.state }
  }

  getName(): string {
    return this.name
  }

  isAllowingRequests(): boolean {
    this.checkStateTransition()
    return this.state === 'closed' || (this.state === 'half_open' && this.shouldAllowHalfOpenRequest())
  }

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
      const err = error instanceof Error ? error : new Error(String(error))

      // Check if it was a timeout
      if (err.message === 'Circuit breaker timeout') {
        this.stats.timeoutCount++
      }

      this.recordFailure(err)
      return this.handleFailure(err, fallback)
    }
  }

  forceOpen(): void {
    this.transitionTo('open')
  }

  forceClose(): void {
    this.transitionTo('closed')
    this.stats.consecutiveFailures = 0
    this.stats.consecutiveSuccesses = 0
  }

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

  private checkStateTransition(): void {
    if (this.state === 'open' && this.stats.circuitOpenedAt) {
      const timeSinceOpen = Date.now() - this.stats.circuitOpenedAt
      if (timeSinceOpen >= this.config.resetTimeoutMs) {
        this.transitionTo('half_open')
      }
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state !== newState) {
      const oldState = this.state
      this.state = newState

      if (newState === 'open') {
        this.stats.circuitOpenedAt = Date.now()
      } else if (newState === 'closed') {
        this.stats.circuitOpenedAt = null
      }

      this.config.onStateChange(this.name, oldState, newState)
    }
  }

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

    this.config.onSuccess(this.name, latencyMs, this.getStats())

    // In half-open state, check if we should close the circuit
    if (this.state === 'half_open' && this.stats.consecutiveSuccesses >= this.config.successThreshold) {
      this.transitionTo('closed')
    }
  }

  private recordFailure(error: Error): void {
    this.stats.failureCount++
    this.stats.consecutiveFailures++
    this.stats.consecutiveSuccesses = 0
    this.stats.lastFailureTime = Date.now()

    this.config.onFailure(this.name, error, this.getStats())

    // Check if we should open the circuit
    if (this.state === 'closed' && this.stats.consecutiveFailures >= this.config.failureThreshold) {
      this.transitionTo('open')
    }

    // In half-open state, any failure opens the circuit again
    if (this.state === 'half_open') {
      this.transitionTo('open')
    }
  }

  private shouldAllowHalfOpenRequest(): boolean {
    return Math.random() < this.config.halfOpenRequestRatio
  }

  private async handleRejection<T>(fallback?: () => T | Promise<T>): Promise<CircuitBreakerResult<T>> {
    if (fallback) {
      try {
        await fallback()
        return { success: false, error: new Error('Circuit open'), rejected: true, fallbackUsed: true }
      } catch {
        return { success: false, error: new Error('Circuit open and fallback failed'), rejected: true, fallbackUsed: false }
      }
    }
    return { success: false, error: new Error('Circuit open'), rejected: true, fallbackUsed: false }
  }

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

// ============================================================================
// Integration Method Wrapping
// ============================================================================

/**
 * Wraps an integration method with circuit breaker protection
 */
function wrapMethod<T>(
  circuit: IntegrationCircuitBreaker,
  method: (...args: unknown[]) => Promise<IntegrationResult<T>>,
  methodName: string
): (...args: unknown[]) => Promise<IntegrationResult<T>> {
  return async (...args: unknown[]): Promise<IntegrationResult<T>> => {
    const result = await circuit.execute(
      async () => method(...args),
      // Fallback returns a circuit open error
      () => ({
        success: false as const,
        error: {
          code: 'CIRCUIT_OPEN',
          message: `Circuit breaker is open for method ${methodName}. Service may be unavailable.`,
          retryable: true,
        },
      })
    )

    if (result.success) {
      return result.value as IntegrationResult<T>
    }

    // If circuit is open/rejected, the fallback result is used
    if (result.rejected && result.fallbackUsed) {
      return {
        success: false,
        error: {
          code: 'CIRCUIT_OPEN',
          message: `Circuit breaker is open. Service may be unavailable.`,
          retryable: true,
        },
      }
    }

    // Operation failed but circuit may still be closed
    return {
      success: false,
      error: {
        code: 'INTEGRATION_ERROR',
        message: result.error.message,
        originalError: result.error,
        retryable: true,
      },
    }
  }
}

/**
 * Create circuit breaker protected methods for an integration
 */
function createProtectedMethods<TMethods extends IntegrationMethods>(
  circuit: IntegrationCircuitBreaker,
  methods: TMethods
): TMethods {
  const protectedMethods = {} as Record<string, (...args: unknown[]) => Promise<IntegrationResult>>

  for (const [name, method] of Object.entries(methods)) {
    if (typeof method === 'function') {
      protectedMethods[name] = wrapMethod(circuit, method as (...args: unknown[]) => Promise<IntegrationResult>, name)
    }
  }

  return protectedMethods as TMethods
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Circuit breaker protected integration wrapper
 *
 * Wraps an existing integration with circuit breaker protection for all methods.
 * Tracks failures per integration and opens circuit when threshold is reached.
 */
export class CircuitBreakerIntegration<
  TConfig extends IntegrationConfig = IntegrationConfig,
  TMethods extends IntegrationMethods = IntegrationMethods
> implements Integration<TConfig, TMethods> {
  private readonly circuit: IntegrationCircuitBreaker
  private readonly wrappedIntegration: Integration<TConfig, TMethods>
  private readonly _methods: TMethods

  constructor(
    integration: Integration<TConfig, TMethods>,
    circuitConfig?: CircuitBreakerIntegrationConfig
  ) {
    this.wrappedIntegration = integration
    this.circuit = new IntegrationCircuitBreaker(integration.name, circuitConfig ?? {})
    this._methods = createProtectedMethods(this.circuit, integration.methods)
  }

  // Delegate readonly properties
  get name(): string {
    return this.wrappedIntegration.name
  }

  get version(): string {
    return this.wrappedIntegration.version
  }

  get metadata() {
    return this.wrappedIntegration.metadata
  }

  get status() {
    return this.wrappedIntegration.status
  }

  get methods(): TMethods {
    return this._methods
  }

  // Delegate lifecycle methods
  async init(config: TConfig): Promise<void> {
    return this.wrappedIntegration.init(config)
  }

  async shutdown(): Promise<void> {
    return this.wrappedIntegration.shutdown?.()
  }

  async healthCheck(): Promise<boolean> {
    // Check circuit state first
    if (!this.circuit.isAllowingRequests()) {
      return false
    }
    return this.wrappedIntegration.healthCheck?.() ?? true
  }

  // Delegate event methods
  async handleWebhook(request: Request): Promise<Response> {
    if (this.wrappedIntegration.handleWebhook) {
      return this.wrappedIntegration.handleWebhook(request)
    }
    return new Response('Webhooks not supported', { status: 501 })
  }

  onEvent(handler: Parameters<NonNullable<Integration['onEvent']>>[0]): void {
    this.wrappedIntegration.onEvent?.(handler)
  }

  setHooks(hooks: Parameters<NonNullable<Integration['setHooks']>>[0]): void {
    this.wrappedIntegration.setHooks?.(hooks)
  }

  // Circuit breaker specific methods
  /**
   * Get the current circuit state
   */
  getCircuitState(): CircuitState {
    return this.circuit.getState()
  }

  /**
   * Get circuit breaker statistics
   */
  getCircuitStats(): CircuitStats {
    return this.circuit.getStats()
  }

  /**
   * Check if the circuit is allowing requests
   */
  isCircuitAllowingRequests(): boolean {
    return this.circuit.isAllowingRequests()
  }

  /**
   * Force the circuit to open (useful for maintenance or known outages)
   */
  forceCircuitOpen(): void {
    this.circuit.forceOpen()
  }

  /**
   * Force the circuit to close (useful for testing or manual recovery)
   */
  forceCircuitClose(): void {
    this.circuit.forceClose()
  }

  /**
   * Reset the circuit breaker to initial state
   */
  resetCircuit(): void {
    this.circuit.reset()
  }

  /**
   * Get the underlying integration (without circuit breaker)
   */
  getUnwrappedIntegration(): Integration<TConfig, TMethods> {
    return this.wrappedIntegration
  }
}

/**
 * Registry for managing circuit breakers across multiple integrations
 */
export class IntegrationCircuitBreakerRegistry {
  private readonly wrappedIntegrations: Map<string, CircuitBreakerIntegration> = new Map()
  private readonly defaultConfig: CircuitBreakerIntegrationConfig

  constructor(defaultConfig?: CircuitBreakerIntegrationConfig) {
    this.defaultConfig = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...defaultConfig }
  }

  /**
   * Wrap an integration with circuit breaker protection
   */
  wrap<TConfig extends IntegrationConfig, TMethods extends IntegrationMethods>(
    integration: Integration<TConfig, TMethods>,
    config?: CircuitBreakerIntegrationConfig
  ): CircuitBreakerIntegration<TConfig, TMethods> {
    const mergedConfig = { ...this.defaultConfig, ...config }
    const wrapped = new CircuitBreakerIntegration(integration, mergedConfig)
    this.wrappedIntegrations.set(integration.name, wrapped as CircuitBreakerIntegration)
    return wrapped
  }

  /**
   * Get a wrapped integration by name
   */
  get(name: string): CircuitBreakerIntegration | undefined {
    return this.wrappedIntegrations.get(name)
  }

  /**
   * Check if an integration is wrapped
   */
  has(name: string): boolean {
    return this.wrappedIntegrations.has(name)
  }

  /**
   * Remove a wrapped integration
   */
  remove(name: string): boolean {
    return this.wrappedIntegrations.delete(name)
  }

  /**
   * Get all wrapped integration names
   */
  getNames(): string[] {
    return Array.from(this.wrappedIntegrations.keys())
  }

  /**
   * Get all circuit stats for all wrapped integrations
   */
  getAllCircuitStats(): Record<string, CircuitStats> {
    const stats: Record<string, CircuitStats> = {}
    for (const [name, wrapped] of this.wrappedIntegrations) {
      stats[name] = wrapped.getCircuitStats()
    }
    return stats
  }

  /**
   * Get wrapped integrations by circuit state
   */
  getByCircuitState(state: CircuitState): CircuitBreakerIntegration[] {
    return Array.from(this.wrappedIntegrations.values()).filter(
      (wrapped) => wrapped.getCircuitState() === state
    )
  }

  /**
   * Get integrations with open circuits (unhealthy)
   */
  getUnhealthyIntegrations(): CircuitBreakerIntegration[] {
    return this.getByCircuitState('open')
  }

  /**
   * Get integrations in half-open state (recovering)
   */
  getRecoveringIntegrations(): CircuitBreakerIntegration[] {
    return this.getByCircuitState('half_open')
  }

  /**
   * Get integrations with closed circuits (healthy)
   */
  getHealthyIntegrations(): CircuitBreakerIntegration[] {
    return this.getByCircuitState('closed')
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const wrapped of this.wrappedIntegrations.values()) {
      wrapped.resetCircuit()
    }
  }

  /**
   * Clear all wrapped integrations
   */
  clear(): void {
    this.wrappedIntegrations.clear()
  }

  /**
   * Get summary of circuit breaker health
   */
  getHealthSummary(): {
    total: number
    healthy: number
    unhealthy: number
    recovering: number
  } {
    const healthy = this.getHealthyIntegrations().length
    const unhealthy = this.getUnhealthyIntegrations().length
    const recovering = this.getRecoveringIntegrations().length
    return {
      total: this.wrappedIntegrations.size,
      healthy,
      unhealthy,
      recovering,
    }
  }
}

/**
 * Factory function to create a circuit breaker protected integration
 */
export function createCircuitBreakerIntegration<
  TConfig extends IntegrationConfig,
  TMethods extends IntegrationMethods
>(
  integration: Integration<TConfig, TMethods>,
  config?: CircuitBreakerIntegrationConfig
): CircuitBreakerIntegration<TConfig, TMethods> {
  return new CircuitBreakerIntegration(integration, config)
}

/**
 * Factory function to create an integration circuit breaker registry
 */
export function createIntegrationCircuitBreakerRegistry(
  defaultConfig?: CircuitBreakerIntegrationConfig
): IntegrationCircuitBreakerRegistry {
  return new IntegrationCircuitBreakerRegistry(defaultConfig)
}
