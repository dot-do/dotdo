/**
 * Payment Provider Failover - Multi-provider failover support for ChargeProcessor
 *
 * Provides automatic failover between payment providers (Stripe/Square/PayPal) with:
 * - Circuit breaker pattern per provider
 * - Health checks with configurable intervals
 * - Automatic provider rotation on failures
 * - Priority-based provider selection
 * - Sliding window failure tracking
 * - Event callbacks for monitoring
 *
 * @example
 * ```typescript
 * import { createChargeProcessorWithFailover } from 'db/primitives/payments/provider-failover'
 *
 * const processor = createChargeProcessorWithFailover({
 *   providers: [
 *     { name: 'stripe', provider: stripeProvider, priority: 1 },
 *     { name: 'square', provider: squareProvider, priority: 2 },
 *     { name: 'paypal', provider: paypalProvider, priority: 3 },
 *   ],
 *   circuitBreaker: {
 *     failureThreshold: 5,
 *     resetTimeout: 30000,
 *     halfOpenMaxAttempts: 3,
 *   },
 *   healthCheck: {
 *     enabled: true,
 *     interval: 60000,
 *     timeout: 5000,
 *   },
 *   onProviderSwitch: (from, to, reason) => {
 *     console.log(`Switched from ${from} to ${to}: ${reason}`)
 *   },
 * })
 *
 * // Charge with automatic failover
 * const charge = await processor.charge({
 *   amount: 9999,
 *   currency: 'USD',
 *   customerId: 'cust_123',
 *   paymentMethodId: 'pm_xxx',
 * })
 *
 * // Get provider health stats
 * const stats = processor.getProviderStats()
 * ```
 *
 * @module db/primitives/payments/provider-failover
 */

import type {
  ChargeProvider,
  ChargeCreateOptions,
  ChargeAuthorizeOptions,
  ChargeCaptureOptions,
  ChargeRefundOptions,
  ProviderChargeResult,
  ProviderRefundResult,
  Provider3DSecureResult,
  Provider3DSecureConfirmResult,
  ThreeDSecureExemption,
} from './charge-processor'

// =============================================================================
// Types
// =============================================================================

/**
 * Circuit breaker state
 */
export type CircuitState = 'closed' | 'open' | 'half-open'

/**
 * Provider health status
 */
export type ProviderHealthStatus = 'healthy' | 'degraded' | 'unhealthy'

/**
 * Provider registration options
 */
export interface ProviderRegistration {
  /** Unique provider name */
  name: string
  /** The charge provider implementation */
  provider: ChargeProvider
  /** Priority (lower = higher priority, default: 99) */
  priority?: number
  /** Weight for load balancing (default: 1) */
  weight?: number
  /** Custom health check function */
  healthCheck?: () => Promise<boolean>
  /** Custom error classifier for retryable errors */
  isRetryableError?: (error: Error) => boolean
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold: number
  /** Time in ms before attempting recovery (default: 30000) */
  resetTimeout: number
  /** Number of successes needed to close circuit in half-open (default: 1) */
  successThreshold?: number
  /** Max attempts in half-open state before reopening (default: 3) */
  halfOpenMaxAttempts?: number
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  /** Enable health checks (default: true) */
  enabled?: boolean
  /** Interval between health checks in ms (default: 60000) */
  interval?: number
  /** Timeout for health check in ms (default: 5000) */
  timeout?: number
  /** Consecutive failures to mark unhealthy (default: 3) */
  unhealthyThreshold?: number
}

/**
 * Failover configuration
 */
export interface ProviderFailoverConfig {
  /** List of providers to use */
  providers: ProviderRegistration[]
  /** Circuit breaker settings */
  circuitBreaker?: CircuitBreakerConfig
  /** Health check settings */
  healthCheck?: HealthCheckConfig
  /** Maximum providers to try before failing (default: all) */
  maxAttempts?: number
  /** Timeout for provider operations in ms (default: 30000) */
  operationTimeout?: number
  /** Callback when switching providers */
  onProviderSwitch?: (from: string, to: string, reason: string) => void
  /** Callback when provider fails */
  onProviderFail?: (provider: string, error: Error) => void
  /** Callback when provider recovers */
  onProviderRecover?: (provider: string) => void
  /** Callback when all providers fail */
  onAllProvidersFailed?: (errors: Map<string, Error>) => void
}

/**
 * Sliding window entry for tracking metrics
 */
interface WindowEntry {
  timestamp: number
  success: boolean
  durationMs: number
  errorType?: string
}

/**
 * Provider health metrics
 */
export interface ProviderHealthMetrics {
  /** Provider name */
  name: string
  /** Current health status */
  status: ProviderHealthStatus
  /** Circuit breaker state */
  circuitState: CircuitState
  /** Success rate (0-1) */
  successRate: number
  /** Total requests in window */
  totalRequests: number
  /** Failed requests in window */
  failedRequests: number
  /** Average response time in ms */
  avgResponseTimeMs: number
  /** Last successful operation timestamp */
  lastSuccess?: number
  /** Last failure timestamp */
  lastFailure?: number
  /** Consecutive failures */
  consecutiveFailures: number
  /** Health check passing */
  healthCheckPassing?: boolean
  /** Last health check timestamp */
  lastHealthCheck?: number
}

/**
 * Overall failover stats
 */
export interface FailoverStats {
  /** Total operations attempted */
  totalOperations: number
  /** Successful operations */
  successfulOperations: number
  /** Failed operations (all providers exhausted) */
  failedOperations: number
  /** Failover count (switched providers) */
  failoversTriggered: number
  /** Per-provider metrics */
  providers: ProviderHealthMetrics[]
  /** Currently preferred provider */
  preferredProvider: string | null
}

/**
 * Failover result for operations
 */
export interface FailoverResult<T> {
  success: boolean
  result?: T
  error?: Error
  providerUsed: string
  attemptsCount: number
  attemptedProviders: string[]
  durationMs: number
  failoverOccurred: boolean
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_WINDOW_SIZE_MS = 60_000 // 1 minute sliding window
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 5
const DEFAULT_CIRCUIT_RESET_TIMEOUT = 30_000
const DEFAULT_CIRCUIT_SUCCESS_THRESHOLD = 1
const DEFAULT_CIRCUIT_HALF_OPEN_MAX = 3
const DEFAULT_HEALTH_CHECK_INTERVAL = 60_000
const DEFAULT_HEALTH_CHECK_TIMEOUT = 5_000
const DEFAULT_HEALTH_CHECK_UNHEALTHY_THRESHOLD = 3
const DEFAULT_OPERATION_TIMEOUT = 30_000
const DEFAULT_DEGRADED_SUCCESS_RATE = 0.9
const DEFAULT_UNHEALTHY_SUCCESS_RATE = 0.5

// =============================================================================
// Circuit Breaker Implementation
// =============================================================================

/**
 * Per-provider circuit breaker
 */
class ProviderCircuitBreaker {
  private state: CircuitState = 'closed'
  private failureCount = 0
  private successCount = 0
  private halfOpenAttempts = 0
  private lastFailureTime = 0
  private openedAt = 0

  constructor(private readonly config: Required<CircuitBreakerConfig>) {}

  getState(): CircuitState {
    // Check if should transition from open to half-open
    if (this.state === 'open') {
      const now = Date.now()
      if (now - this.openedAt >= this.config.resetTimeout) {
        this.state = 'half-open'
        this.halfOpenAttempts = 0
        this.successCount = 0
      }
    }
    return this.state
  }

  isRequestAllowed(): boolean {
    const currentState = this.getState()
    if (currentState === 'closed') return true
    if (currentState === 'half-open') {
      return this.halfOpenAttempts < this.config.halfOpenMaxAttempts
    }
    return false
  }

  recordSuccess(): void {
    this.failureCount = 0

    if (this.state === 'half-open') {
      this.successCount++
      if (this.successCount >= this.config.successThreshold) {
        this.state = 'closed'
        this.successCount = 0
        this.halfOpenAttempts = 0
      }
    }
  }

  recordFailure(): void {
    this.lastFailureTime = Date.now()

    if (this.state === 'half-open') {
      this.halfOpenAttempts++
      if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        this.openCircuit()
      }
    } else if (this.state === 'closed') {
      this.failureCount++
      if (this.failureCount >= this.config.failureThreshold) {
        this.openCircuit()
      }
    }
  }

  recordHalfOpenAttempt(): void {
    if (this.state === 'half-open') {
      this.halfOpenAttempts++
    }
  }

  private openCircuit(): void {
    this.state = 'open'
    this.openedAt = Date.now()
  }

  reset(): void {
    this.state = 'closed'
    this.failureCount = 0
    this.successCount = 0
    this.halfOpenAttempts = 0
  }

  forceOpen(): void {
    this.openCircuit()
  }
}

// =============================================================================
// Provider State
// =============================================================================

/**
 * Internal state tracking for a provider
 */
class ProviderState {
  readonly registration: ProviderRegistration
  readonly circuitBreaker: ProviderCircuitBreaker

  private window: WindowEntry[] = []
  private windowSizeMs = DEFAULT_WINDOW_SIZE_MS
  private lastSuccess?: number
  private lastFailure?: number
  private lastHealthCheck?: number
  private healthCheckPassing?: boolean
  private consecutiveFailures = 0
  private consecutiveHealthCheckFailures = 0

  constructor(
    registration: ProviderRegistration,
    circuitBreakerConfig: Required<CircuitBreakerConfig>
  ) {
    this.registration = registration
    this.circuitBreaker = new ProviderCircuitBreaker(circuitBreakerConfig)
  }

  /**
   * Prune old entries from sliding window
   */
  private pruneWindow(): void {
    const cutoff = Date.now() - this.windowSizeMs
    this.window = this.window.filter((e) => e.timestamp > cutoff)
  }

  /**
   * Record a successful operation
   */
  recordSuccess(durationMs: number): void {
    this.pruneWindow()
    this.window.push({ timestamp: Date.now(), success: true, durationMs })
    this.lastSuccess = Date.now()
    this.consecutiveFailures = 0
    this.circuitBreaker.recordSuccess()
  }

  /**
   * Record a failed operation
   */
  recordFailure(durationMs: number, errorType?: string): void {
    this.pruneWindow()
    this.window.push({ timestamp: Date.now(), success: false, durationMs, errorType })
    this.lastFailure = Date.now()
    this.consecutiveFailures++
    this.circuitBreaker.recordFailure()
  }

  /**
   * Record health check result
   */
  recordHealthCheck(passed: boolean): void {
    this.lastHealthCheck = Date.now()
    this.healthCheckPassing = passed

    if (passed) {
      this.consecutiveHealthCheckFailures = 0
    } else {
      this.consecutiveHealthCheckFailures++
    }
  }

  /**
   * Check if provider is available
   */
  isAvailable(): boolean {
    return this.circuitBreaker.isRequestAllowed()
  }

  /**
   * Get priority for sorting
   */
  getPriority(): number {
    return this.registration.priority ?? 99
  }

  /**
   * Get health metrics
   */
  getMetrics(): ProviderHealthMetrics {
    this.pruneWindow()

    const totalRequests = this.window.length
    const failedRequests = this.window.filter((e) => !e.success).length
    const successRate = totalRequests > 0 ? (totalRequests - failedRequests) / totalRequests : 1

    const totalDuration = this.window.reduce((sum, e) => sum + e.durationMs, 0)
    const avgResponseTimeMs = totalRequests > 0 ? totalDuration / totalRequests : 0

    // Determine health status
    let status: ProviderHealthStatus = 'healthy'
    if (successRate < DEFAULT_UNHEALTHY_SUCCESS_RATE || this.consecutiveFailures >= 5) {
      status = 'unhealthy'
    } else if (successRate < DEFAULT_DEGRADED_SUCCESS_RATE || this.consecutiveFailures >= 3) {
      status = 'degraded'
    }

    // Override if health check is failing
    if (
      this.healthCheckPassing === false &&
      this.consecutiveHealthCheckFailures >= DEFAULT_HEALTH_CHECK_UNHEALTHY_THRESHOLD
    ) {
      status = 'unhealthy'
    }

    // Override: a passing health check can promote from unhealthy back to degraded
    // This allows recovery when the provider passes health checks again
    if (this.healthCheckPassing === true && status === 'unhealthy') {
      status = 'degraded'
    }

    return {
      name: this.registration.name,
      status,
      circuitState: this.circuitBreaker.getState(),
      successRate,
      totalRequests,
      failedRequests,
      avgResponseTimeMs,
      lastSuccess: this.lastSuccess,
      lastFailure: this.lastFailure,
      consecutiveFailures: this.consecutiveFailures,
      healthCheckPassing: this.healthCheckPassing,
      lastHealthCheck: this.lastHealthCheck,
    }
  }

  /**
   * Reset state
   */
  reset(): void {
    this.window = []
    this.consecutiveFailures = 0
    this.consecutiveHealthCheckFailures = 0
    this.circuitBreaker.reset()
  }
}

// =============================================================================
// Default Retryable Error Checker
// =============================================================================

/**
 * Default check for retryable errors
 *
 * By default, all errors are considered retryable except for explicit
 * non-retryable error types (validation errors, authentication errors, etc.)
 */
function isDefaultRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase()

  // Non-retryable errors - validation/client errors
  if (message.includes('invalid') && message.includes('parameter')) return false
  if (message.includes('validation')) return false
  if (message.includes('authentication')) return false
  if (message.includes('authorization')) return false
  if (message.includes('forbidden')) return false
  if (message.includes('not found')) return false
  if (message.includes('already exists')) return false
  if (message.includes('duplicate')) return false

  // Non-retryable payment-specific errors
  if (message.includes('card declined')) return false
  if (message.includes('insufficient funds')) return false
  if (message.includes('expired card')) return false
  if (message.includes('invalid card')) return false
  if (message.includes('stolen card')) return false
  if (message.includes('lost card')) return false

  // All other errors are considered retryable
  // This includes: timeouts, network errors, server errors (5xx), rate limits, etc.
  return true
}

// =============================================================================
// Provider Failover Manager
// =============================================================================

/**
 * Multi-provider failover manager for charge operations
 */
export class ChargeProviderFailover {
  private providerStates: Map<string, ProviderState> = new Map()
  private sortedProviderNames: string[] = []
  private healthCheckInterval?: ReturnType<typeof setInterval>

  // Stats
  private totalOperations = 0
  private successfulOperations = 0
  private failedOperations = 0
  private failoversTriggered = 0

  // Configuration with defaults
  private readonly circuitBreakerConfig: Required<CircuitBreakerConfig>
  private readonly healthCheckConfig: Required<HealthCheckConfig>
  private readonly maxAttempts: number
  private readonly operationTimeout: number

  constructor(private readonly config: ProviderFailoverConfig) {
    // Initialize circuit breaker config with defaults
    this.circuitBreakerConfig = {
      failureThreshold: config.circuitBreaker?.failureThreshold ?? DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
      resetTimeout: config.circuitBreaker?.resetTimeout ?? DEFAULT_CIRCUIT_RESET_TIMEOUT,
      successThreshold: config.circuitBreaker?.successThreshold ?? DEFAULT_CIRCUIT_SUCCESS_THRESHOLD,
      halfOpenMaxAttempts: config.circuitBreaker?.halfOpenMaxAttempts ?? DEFAULT_CIRCUIT_HALF_OPEN_MAX,
    }

    // Initialize health check config with defaults
    this.healthCheckConfig = {
      enabled: config.healthCheck?.enabled ?? true,
      interval: config.healthCheck?.interval ?? DEFAULT_HEALTH_CHECK_INTERVAL,
      timeout: config.healthCheck?.timeout ?? DEFAULT_HEALTH_CHECK_TIMEOUT,
      unhealthyThreshold: config.healthCheck?.unhealthyThreshold ?? DEFAULT_HEALTH_CHECK_UNHEALTHY_THRESHOLD,
    }

    this.maxAttempts = config.maxAttempts ?? config.providers.length
    this.operationTimeout = config.operationTimeout ?? DEFAULT_OPERATION_TIMEOUT

    // Initialize provider states
    for (const registration of config.providers) {
      this.providerStates.set(
        registration.name,
        new ProviderState(registration, this.circuitBreakerConfig)
      )
    }

    // Sort providers by priority
    this.updateSortedProviders()

    // Start health checks if enabled
    if (this.healthCheckConfig.enabled) {
      this.startHealthChecks()
    }
  }

  /**
   * Update sorted provider list based on priority and health
   */
  private updateSortedProviders(): void {
    this.sortedProviderNames = Array.from(this.providerStates.keys()).sort((a, b) => {
      const stateA = this.providerStates.get(a)!
      const stateB = this.providerStates.get(b)!
      const metricsA = stateA.getMetrics()
      const metricsB = stateB.getMetrics()

      // First sort by health status
      const statusOrder = { healthy: 0, degraded: 1, unhealthy: 2 }
      const statusDiff = statusOrder[metricsA.status] - statusOrder[metricsB.status]
      if (statusDiff !== 0) return statusDiff

      // Then by priority
      return stateA.getPriority() - stateB.getPriority()
    })
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.runHealthChecks()
    }, this.healthCheckConfig.interval)

    // Run initial health checks
    this.runHealthChecks()
  }

  /**
   * Run health checks on all providers
   */
  private async runHealthChecks(): Promise<void> {
    for (const [name, state] of Array.from(this.providerStates.entries())) {
      const healthCheck = state.registration.healthCheck

      if (!healthCheck) continue

      try {
        const result = await Promise.race([
          healthCheck(),
          new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), this.healthCheckConfig.timeout)
          ),
        ])

        const previousMetrics = state.getMetrics()
        state.recordHealthCheck(result)

        // Check if provider recovered
        if (
          previousMetrics.status === 'unhealthy' &&
          result &&
          state.getMetrics().status !== 'unhealthy'
        ) {
          this.config.onProviderRecover?.(name)
        }
      } catch {
        state.recordHealthCheck(false)
      }
    }

    // Update provider ordering
    this.updateSortedProviders()
  }

  /**
   * Stop health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = undefined
    }
  }

  /**
   * Get available providers in priority order
   */
  private getAvailableProviders(): ProviderState[] {
    return this.sortedProviderNames
      .map((name) => this.providerStates.get(name)!)
      .filter((state) => state.isAvailable())
  }

  /**
   * Check if error is retryable for a provider
   */
  private isRetryableError(state: ProviderState, error: Error): boolean {
    const customCheck = state.registration.isRetryableError
    if (customCheck) {
      return customCheck(error)
    }
    return isDefaultRetryableError(error)
  }

  /**
   * Execute an operation with failover support
   */
  async execute<T>(
    operation: (provider: ChargeProvider) => Promise<T>
  ): Promise<FailoverResult<T>> {
    const startTime = Date.now()
    this.totalOperations++

    const availableProviders = this.getAvailableProviders()
    const attemptedProviders: string[] = []
    const errors = new Map<string, Error>()
    let lastError: Error | undefined
    let failoverOccurred = false

    const maxAttempts = Math.min(this.maxAttempts, availableProviders.length)

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const providerState = availableProviders[attempt]
      if (!providerState) break

      const providerName = providerState.registration.name
      attemptedProviders.push(providerName)

      // Track failover
      if (attempt > 0) {
        failoverOccurred = true
        this.failoversTriggered++
        const previousProvider = attemptedProviders[attempt - 1]
        this.config.onProviderSwitch?.(previousProvider, providerName, lastError?.message ?? 'Unknown error')
      }

      const attemptStart = Date.now()

      try {
        // Execute with timeout
        const result = await Promise.race([
          operation(providerState.registration.provider),
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error('Operation timeout')), this.operationTimeout)
          ),
        ])

        const durationMs = Date.now() - attemptStart
        providerState.recordSuccess(durationMs)
        this.successfulOperations++

        // Update provider ordering after success
        this.updateSortedProviders()

        return {
          success: true,
          result,
          providerUsed: providerName,
          attemptsCount: attempt + 1,
          attemptedProviders,
          durationMs: Date.now() - startTime,
          failoverOccurred,
        }
      } catch (error) {
        const durationMs = Date.now() - attemptStart
        const err = error instanceof Error ? error : new Error(String(error))
        lastError = err
        errors.set(providerName, err)

        providerState.recordFailure(durationMs, err.name)
        this.config.onProviderFail?.(providerName, err)

        // Check if error is retryable
        if (!this.isRetryableError(providerState, err)) {
          break
        }
      }
    }

    // All providers failed
    this.failedOperations++
    this.config.onAllProvidersFailed?.(errors)

    // Update provider ordering after failures
    this.updateSortedProviders()

    return {
      success: false,
      error: lastError ?? new Error('All providers failed'),
      providerUsed: attemptedProviders[0] ?? 'none',
      attemptsCount: attemptedProviders.length,
      attemptedProviders,
      durationMs: Date.now() - startTime,
      failoverOccurred,
    }
  }

  /**
   * Execute charge operation with failover
   */
  async charge(options: ChargeCreateOptions): Promise<FailoverResult<ProviderChargeResult>> {
    return this.execute((provider) => provider.charge(options))
  }

  /**
   * Execute authorize operation with failover
   */
  async authorize(options: ChargeAuthorizeOptions): Promise<FailoverResult<ProviderChargeResult>> {
    return this.execute((provider) => provider.authorize(options))
  }

  /**
   * Execute capture operation with failover
   */
  async capture(chargeId: string, options?: ChargeCaptureOptions): Promise<FailoverResult<{ status: string }>> {
    return this.execute((provider) => provider.capture(chargeId, options))
  }

  /**
   * Execute refund operation with failover
   */
  async refund(chargeId: string, options?: ChargeRefundOptions): Promise<FailoverResult<ProviderRefundResult>> {
    return this.execute((provider) => provider.refund(chargeId, options))
  }

  /**
   * Execute void operation with failover
   */
  async void(chargeId: string): Promise<FailoverResult<{ status: string }>> {
    return this.execute((provider) => provider.void(chargeId))
  }

  /**
   * Execute 3D Secure session creation with failover
   */
  async create3DSecureSession(options: {
    chargeId: string
    amount: number
    currency: string
    returnUrl: string
    exemption?: ThreeDSecureExemption
  }): Promise<FailoverResult<Provider3DSecureResult>> {
    return this.execute((provider) => provider.create3DSecureSession(options))
  }

  /**
   * Execute 3D Secure confirmation with failover
   */
  async confirm3DSecure(transactionId: string): Promise<FailoverResult<Provider3DSecureConfirmResult>> {
    return this.execute((provider) => provider.confirm3DSecure(transactionId))
  }

  /**
   * Get health metrics for a specific provider
   */
  getProviderHealth(providerName: string): ProviderHealthMetrics | null {
    const state = this.providerStates.get(providerName)
    return state?.getMetrics() ?? null
  }

  /**
   * Get overall failover stats
   */
  getStats(): FailoverStats {
    const availableProviders = this.getAvailableProviders()

    return {
      totalOperations: this.totalOperations,
      successfulOperations: this.successfulOperations,
      failedOperations: this.failedOperations,
      failoversTriggered: this.failoversTriggered,
      providers: this.sortedProviderNames.map((name) =>
        this.providerStates.get(name)!.getMetrics()
      ),
      preferredProvider: availableProviders[0]?.registration.name ?? null,
    }
  }

  /**
   * List provider names in priority order
   */
  listProviders(): string[] {
    return [...this.sortedProviderNames]
  }

  /**
   * Get the currently preferred provider
   */
  getPreferredProvider(): ChargeProvider | null {
    const available = this.getAvailableProviders()
    return available[0]?.registration.provider ?? null
  }

  /**
   * Reset all provider states
   */
  reset(): void {
    for (const state of Array.from(this.providerStates.values())) {
      state.reset()
    }
    this.totalOperations = 0
    this.successfulOperations = 0
    this.failedOperations = 0
    this.failoversTriggered = 0
    this.updateSortedProviders()
  }

  /**
   * Add a provider dynamically
   */
  addProvider(registration: ProviderRegistration): void {
    if (this.providerStates.has(registration.name)) {
      throw new Error(`Provider already exists: ${registration.name}`)
    }
    this.providerStates.set(
      registration.name,
      new ProviderState(registration, this.circuitBreakerConfig)
    )
    this.updateSortedProviders()
  }

  /**
   * Remove a provider dynamically
   */
  removeProvider(providerName: string): boolean {
    const removed = this.providerStates.delete(providerName)
    if (removed) {
      this.updateSortedProviders()
    }
    return removed
  }

  /**
   * Manually set provider health status
   */
  setProviderStatus(providerName: string, available: boolean): void {
    const state = this.providerStates.get(providerName)
    if (!state) {
      throw new Error(`Provider not found: ${providerName}`)
    }

    if (available) {
      state.recordHealthCheck(true)
      state.circuitBreaker.reset()
    } else {
      // Force circuit open
      state.circuitBreaker.forceOpen()
    }

    this.updateSortedProviders()
  }

  /**
   * Destroy the failover manager
   */
  destroy(): void {
    this.stopHealthChecks()
    this.providerStates.clear()
    this.sortedProviderNames = []
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a charge provider failover manager
 */
export function createChargeProviderFailover(
  config: ProviderFailoverConfig
): ChargeProviderFailover {
  return new ChargeProviderFailover(config)
}

// =============================================================================
// Re-exports
// =============================================================================

export type {
  ChargeProvider,
  ChargeCreateOptions,
  ChargeAuthorizeOptions,
  ChargeCaptureOptions,
  ChargeRefundOptions,
  ProviderChargeResult,
  ProviderRefundResult,
  Provider3DSecureResult,
  Provider3DSecureConfirmResult,
  ThreeDSecureExemption,
}
