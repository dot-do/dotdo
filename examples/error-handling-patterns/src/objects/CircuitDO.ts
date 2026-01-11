/**
 * CircuitDO - Durable Object for Circuit Breaker Pattern
 *
 * Demonstrates:
 * - Circuit states: Closed, Open, Half-Open
 * - Failure threshold and recovery
 * - Fallback mechanisms
 * - Service health monitoring
 * - Distributed circuit breaker state
 */

import { DO } from 'dotdo'
import { CircuitOpenError, isRetryableError } from '../errors'

// ============================================================================
// CIRCUIT BREAKER TYPES
// ============================================================================

export type CircuitState = 'closed' | 'open' | 'half-open'

export interface CircuitBreakerConfig {
  /** Number of failures before circuit opens */
  failureThreshold: number
  /** Time in ms before attempting reset (open -> half-open) */
  resetTimeoutMs: number
  /** Number of successful calls in half-open to close circuit */
  successThreshold: number
  /** Number of test calls allowed in half-open state */
  halfOpenMaxCalls: number
  /** Sliding window size for failure rate calculation */
  windowSize: number
  /** Minimum calls in window before circuit can trip */
  minimumCalls: number
  /** Failure rate percentage to trip circuit (0-100) */
  failureRateThreshold: number
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  successThreshold: 3,
  halfOpenMaxCalls: 3,
  windowSize: 10,
  minimumCalls: 5,
  failureRateThreshold: 50,
}

export interface CircuitMetrics {
  state: CircuitState
  failures: number
  successes: number
  lastFailureAt?: Date
  lastSuccessAt?: Date
  openedAt?: Date
  halfOpenAt?: Date
  callsInWindow: number
  failureRate: number
  consecutiveSuccesses: number
}

interface CallRecord {
  timestamp: number
  success: boolean
  durationMs: number
  error?: string
}

// ============================================================================
// CIRCUIT BREAKER IMPLEMENTATION
// ============================================================================

class CircuitBreaker {
  private state: CircuitState = 'closed'
  private failures: number = 0
  private successes: number = 0
  private consecutiveSuccesses: number = 0
  private halfOpenCalls: number = 0
  private lastFailureAt?: Date
  private lastSuccessAt?: Date
  private openedAt?: Date
  private halfOpenAt?: Date
  private callHistory: CallRecord[] = []
  private config: CircuitBreakerConfig

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config }
  }

  /**
   * Check if the circuit allows execution
   */
  canExecute(): boolean {
    this.updateState()
    return this.state !== 'open'
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    this.updateState()
    return this.state
  }

  /**
   * Update state based on time (open -> half-open transition)
   */
  private updateState(): void {
    if (this.state === 'open' && this.openedAt) {
      const elapsed = Date.now() - this.openedAt.getTime()
      if (elapsed >= this.config.resetTimeoutMs) {
        this.state = 'half-open'
        this.halfOpenAt = new Date()
        this.halfOpenCalls = 0
        this.consecutiveSuccesses = 0
      }
    }
  }

  /**
   * Record a successful call
   */
  recordSuccess(durationMs: number): void {
    this.successes++
    this.consecutiveSuccesses++
    this.lastSuccessAt = new Date()

    this.addToHistory({ timestamp: Date.now(), success: true, durationMs })

    if (this.state === 'half-open') {
      this.halfOpenCalls++
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.close()
      }
    }
  }

  /**
   * Record a failed call
   */
  recordFailure(durationMs: number, error?: string): void {
    this.failures++
    this.consecutiveSuccesses = 0
    this.lastFailureAt = new Date()

    this.addToHistory({ timestamp: Date.now(), success: false, durationMs, error })

    if (this.state === 'half-open') {
      this.open()
    } else if (this.state === 'closed') {
      if (this.shouldTrip()) {
        this.open()
      }
    }
  }

  /**
   * Add record to sliding window history
   */
  private addToHistory(record: CallRecord): void {
    this.callHistory.push(record)
    // Trim to window size
    const windowStart = Date.now() - this.config.windowSize * 1000
    this.callHistory = this.callHistory.filter(r => r.timestamp >= windowStart)
  }

  /**
   * Check if circuit should trip based on failure rate
   */
  private shouldTrip(): boolean {
    if (this.callHistory.length < this.config.minimumCalls) {
      // Not enough calls to make a decision, use simple threshold
      return this.failures >= this.config.failureThreshold
    }

    const failureRate = this.getFailureRate()
    return failureRate >= this.config.failureRateThreshold
  }

  /**
   * Get current failure rate in the sliding window
   */
  getFailureRate(): number {
    if (this.callHistory.length === 0) return 0
    const failures = this.callHistory.filter(r => !r.success).length
    return (failures / this.callHistory.length) * 100
  }

  /**
   * Open the circuit
   */
  private open(): void {
    this.state = 'open'
    this.openedAt = new Date()
    this.halfOpenAt = undefined
    this.halfOpenCalls = 0
  }

  /**
   * Close the circuit (recover)
   */
  private close(): void {
    this.state = 'closed'
    this.failures = 0
    this.openedAt = undefined
    this.halfOpenAt = undefined
    this.halfOpenCalls = 0
    this.callHistory = []
  }

  /**
   * Force reset the circuit
   */
  reset(): void {
    this.close()
    this.successes = 0
    this.consecutiveSuccesses = 0
    this.lastFailureAt = undefined
    this.lastSuccessAt = undefined
  }

  /**
   * Get circuit metrics
   */
  getMetrics(): CircuitMetrics {
    this.updateState()
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      openedAt: this.openedAt,
      halfOpenAt: this.halfOpenAt,
      callsInWindow: this.callHistory.length,
      failureRate: this.getFailureRate(),
      consecutiveSuccesses: this.consecutiveSuccesses,
    }
  }

  /**
   * Time until circuit attempts to close (if open)
   */
  getTimeUntilReset(): number {
    if (this.state !== 'open' || !this.openedAt) return 0
    const elapsed = Date.now() - this.openedAt.getTime()
    return Math.max(0, this.config.resetTimeoutMs - elapsed)
  }
}

// ============================================================================
// CIRCUIT DURABLE OBJECT
// ============================================================================

export class CircuitDO extends DO {
  static readonly $type = 'CircuitDO'

  // Circuit breakers for different services
  private circuits: Map<string, CircuitBreaker> = new Map()

  // Service configurations
  private serviceConfigs: Map<string, CircuitBreakerConfig> = new Map()

  // Fallback handlers
  private fallbacks: Map<string, () => unknown> = new Map()

  async onStart() {
    // Monitor circuit breakers every 30 seconds
    this.$.every('30 seconds', async () => {
      await this.monitorCircuits()
    })

    // Emit events for circuit state changes
    this.$.on.Circuit.stateChanged(async (event) => {
      const { service, from, to } = event.data as {
        service: string
        from: CircuitState
        to: CircuitState
      }
      console.log(`[CircuitDO] ${service}: ${from} -> ${to}`)
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CIRCUIT MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get or create a circuit breaker for a service
   */
  private getCircuit(service: string): CircuitBreaker {
    if (!this.circuits.has(service)) {
      const config = this.serviceConfigs.get(service)
      this.circuits.set(service, new CircuitBreaker(config))
    }
    return this.circuits.get(service)!
  }

  /**
   * Configure circuit breaker for a service
   */
  configureCircuit(service: string, config: Partial<CircuitBreakerConfig>): void {
    this.serviceConfigs.set(service, { ...DEFAULT_CIRCUIT_CONFIG, ...config })

    // Update existing circuit if present
    if (this.circuits.has(service)) {
      // Reset with new config
      this.circuits.set(service, new CircuitBreaker(config))
    }
  }

  /**
   * Register a fallback for a service
   */
  registerFallback<T>(service: string, fallback: () => T | Promise<T>): void {
    this.fallbacks.set(service, fallback as () => unknown)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROTECTED EXECUTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute an operation with circuit breaker protection.
   * If circuit is open, throws CircuitOpenError or uses fallback.
   *
   * @example
   * const result = await circuitDO.call('payment-service', async () => {
   *   return await paymentAPI.charge(amount)
   * })
   */
  async call<T>(
    service: string,
    operation: () => Promise<T>,
    options: { useFallback?: boolean } = {}
  ): Promise<T> {
    const circuit = this.getCircuit(service)
    const previousState = circuit.getState()

    // Check if circuit allows execution
    if (!circuit.canExecute()) {
      const error = new CircuitOpenError(
        service,
        Date.now() + circuit.getTimeUntilReset()
      )

      // Try fallback if available and requested
      if (options.useFallback && this.fallbacks.has(service)) {
        console.warn(`[CircuitDO] ${service} circuit open, using fallback`)
        return this.fallbacks.get(service)!() as T
      }

      throw error
    }

    const startTime = Date.now()
    try {
      const result = await operation()
      const durationMs = Date.now() - startTime

      circuit.recordSuccess(durationMs)

      // Check for state change
      const newState = circuit.getState()
      if (newState !== previousState) {
        this.emitStateChange(service, previousState, newState)
      }

      return result
    } catch (error) {
      const durationMs = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)

      circuit.recordFailure(durationMs, errorMessage)

      // Check for state change
      const newState = circuit.getState()
      if (newState !== previousState) {
        this.emitStateChange(service, previousState, newState)
      }

      // Try fallback if available, operation failed, and error is retryable
      if (options.useFallback && this.fallbacks.has(service) && isRetryableError(error)) {
        console.warn(`[CircuitDO] ${service} failed, using fallback:`, errorMessage)
        return this.fallbacks.get(service)!() as T
      }

      throw error
    }
  }

  /**
   * Execute with automatic fallback on circuit open or failure
   */
  async callWithFallback<T>(
    service: string,
    operation: () => Promise<T>,
    fallback: () => T | Promise<T>
  ): Promise<T> {
    // Temporarily register fallback
    this.fallbacks.set(service, fallback as () => unknown)

    try {
      return await this.call<T>(service, operation, { useFallback: true })
    } finally {
      // Don't remove fallback - it might be registered permanently
    }
  }

  /**
   * Execute multiple operations, continuing even if some circuits are open
   */
  async callMany<T>(
    operations: Array<{
      service: string
      operation: () => Promise<T>
      fallback?: () => T | Promise<T>
    }>
  ): Promise<Array<{ service: string; success: boolean; result?: T; error?: string }>> {
    const results: Array<{ service: string; success: boolean; result?: T; error?: string }> = []

    for (const op of operations) {
      try {
        const result = op.fallback
          ? await this.callWithFallback(op.service, op.operation, op.fallback)
          : await this.call(op.service, op.operation)

        results.push({ service: op.service, success: true, result })
      } catch (error) {
        results.push({
          service: op.service,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return results
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CIRCUIT STATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get circuit breaker status for a service
   */
  getCircuitStatus(service: string): CircuitMetrics & { service: string; timeUntilReset: number } {
    const circuit = this.getCircuit(service)
    return {
      service,
      ...circuit.getMetrics(),
      timeUntilReset: circuit.getTimeUntilReset(),
    }
  }

  /**
   * Get status for all circuits
   */
  getAllCircuitStatus(): Array<CircuitMetrics & { service: string; timeUntilReset: number }> {
    return Array.from(this.circuits.keys()).map(service => this.getCircuitStatus(service))
  }

  /**
   * Get services with open circuits
   */
  getOpenCircuits(): string[] {
    return Array.from(this.circuits.entries())
      .filter(([_, circuit]) => circuit.getState() === 'open')
      .map(([service, _]) => service)
  }

  /**
   * Reset circuit for a service
   */
  resetCircuit(service: string): void {
    const circuit = this.circuits.get(service)
    if (circuit) {
      const previousState = circuit.getState()
      circuit.reset()
      this.emitStateChange(service, previousState, 'closed')
    }
  }

  /**
   * Reset all circuits
   */
  resetAllCircuits(): void {
    for (const service of this.circuits.keys()) {
      this.resetCircuit(service)
    }
  }

  /**
   * Force open a circuit (for testing or manual intervention)
   */
  forceOpen(service: string): void {
    const circuit = this.getCircuit(service)
    const previousState = circuit.getState()

    // Record enough failures to trip
    for (let i = 0; i < DEFAULT_CIRCUIT_CONFIG.failureThreshold; i++) {
      circuit.recordFailure(0)
    }

    if (circuit.getState() !== previousState) {
      this.emitStateChange(service, previousState, 'open')
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HEALTH MONITORING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Monitor and emit health events for all circuits
   */
  private async monitorCircuits(): Promise<void> {
    const openCircuits = this.getOpenCircuits()

    if (openCircuits.length > 0) {
      console.warn(`[CircuitDO] Open circuits: ${openCircuits.join(', ')}`)

      this.$.send('Circuit.healthCheck', {
        healthy: false,
        openCircuits,
        totalCircuits: this.circuits.size,
        timestamp: new Date().toISOString(),
      })
    }
  }

  /**
   * Emit circuit state change event
   */
  private emitStateChange(service: string, from: CircuitState, to: CircuitState): void {
    this.$.send('Circuit.stateChanged', { service, from, to })
  }

  /**
   * Get overall health status
   */
  getHealthStatus(): {
    healthy: boolean
    services: Record<string, { state: CircuitState; healthy: boolean }>
    openCount: number
    totalCount: number
  } {
    const services: Record<string, { state: CircuitState; healthy: boolean }> = {}
    let openCount = 0

    for (const [service, circuit] of this.circuits) {
      const state = circuit.getState()
      const healthy = state !== 'open'
      services[service] = { state, healthy }
      if (state === 'open') openCount++
    }

    return {
      healthy: openCount === 0,
      services,
      openCount,
      totalCount: this.circuits.size,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATISTICS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get detailed statistics for all circuits
   */
  getStats(): {
    totalCalls: number
    totalSuccesses: number
    totalFailures: number
    averageFailureRate: number
    byService: Record<string, CircuitMetrics>
  } {
    let totalSuccesses = 0
    let totalFailures = 0
    let totalFailureRate = 0
    const byService: Record<string, CircuitMetrics> = {}

    for (const [service, circuit] of this.circuits) {
      const metrics = circuit.getMetrics()
      byService[service] = metrics
      totalSuccesses += metrics.successes
      totalFailures += metrics.failures
      totalFailureRate += metrics.failureRate
    }

    return {
      totalCalls: totalSuccesses + totalFailures,
      totalSuccesses,
      totalFailures,
      averageFailureRate: this.circuits.size > 0 ? totalFailureRate / this.circuits.size : 0,
      byService,
    }
  }
}
