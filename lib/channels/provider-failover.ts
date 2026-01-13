/**
 * Multi-Provider Failover System
 *
 * Provides robust multi-provider support with:
 * - Provider health tracking (sliding window metrics)
 * - Automatic failover on error
 * - Provider priority ordering
 * - Retry with next provider
 * - Circuit breaker integration
 * - Health check probes
 *
 * @example
 * ```typescript
 * import {
 *   createProviderFailover,
 *   type ProviderAdapter
 * } from 'lib/channels/provider-failover'
 *
 * // Define providers
 * const twilioProvider: ProviderAdapter<SMSPayload, SMSResult> = {
 *   id: 'twilio',
 *   name: 'Twilio',
 *   priority: 1, // Lower = higher priority
 *   send: async (payload) => {
 *     // Send via Twilio
 *     return { success: true, messageId: 'xxx' }
 *   },
 *   healthCheck: async () => {
 *     // Optional health check
 *     return true
 *   }
 * }
 *
 * const failover = createProviderFailover<SMSPayload, SMSResult>({
 *   providers: [twilioProvider, vonageProvider, telnyxProvider],
 *   retryOnFail: true,
 *   circuitBreaker: {
 *     failureThreshold: 5,
 *     resetTimeout: 30000,
 *   },
 * })
 *
 * // Send with automatic failover
 * const result = await failover.send(payload)
 *
 * // Get provider health stats
 * const stats = failover.getHealthStats()
 * ```
 *
 * @module lib/channels/provider-failover
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Health status for a provider
 */
export type ProviderHealthStatus = 'healthy' | 'degraded' | 'unhealthy'

/**
 * Circuit breaker state
 */
export type CircuitState = 'closed' | 'open' | 'half-open'

/**
 * Provider adapter interface
 */
export interface ProviderAdapter<TPayload, TResult> {
  /** Unique provider identifier */
  id: string
  /** Human-readable provider name */
  name: string
  /** Priority (lower = higher priority) */
  priority: number
  /** Send method */
  send(payload: TPayload): Promise<TResult>
  /** Optional health check function */
  healthCheck?(): Promise<boolean>
  /** Optional error classifier to determine if error is retryable */
  isRetryableError?(error: Error): boolean
  /** Optional weight for load balancing (default: 1) */
  weight?: number
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Send result with provider info
 */
export interface ProviderSendResult<TResult> {
  /** Whether the send was successful */
  success: boolean
  /** The result from the provider */
  result?: TResult
  /** Error if failed */
  error?: Error
  /** Provider that was used */
  providerId: string
  /** Provider name */
  providerName: string
  /** Number of providers attempted */
  attemptsCount: number
  /** All providers that were tried */
  attemptedProviders: string[]
  /** Duration in milliseconds */
  durationMs: number
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures to trip the circuit */
  failureThreshold: number
  /** Time in ms before attempting to close circuit */
  resetTimeout: number
  /** Number of successes in half-open to close circuit */
  successThreshold?: number
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  /** Interval between health checks in ms */
  interval: number
  /** Timeout for each health check */
  timeout?: number
  /** Number of consecutive failures to mark unhealthy */
  unhealthyThreshold?: number
}

/**
 * Provider failover configuration
 */
export interface ProviderFailoverConfig<TPayload, TResult> {
  /** List of providers in order of preference */
  providers: ProviderAdapter<TPayload, TResult>[]
  /** Whether to retry on fail with next provider (default: true) */
  retryOnFail?: boolean
  /** Max providers to try (default: all providers) */
  maxAttempts?: number
  /** Circuit breaker config per provider */
  circuitBreaker?: CircuitBreakerConfig
  /** Health check configuration */
  healthCheck?: HealthCheckConfig
  /** Timeout for send operations in ms */
  sendTimeout?: number
  /** Callback when provider fails */
  onProviderFail?: (providerId: string, error: Error) => void
  /** Callback when failover occurs */
  onFailover?: (fromProvider: string, toProvider: string) => void
  /** Callback when provider recovers */
  onProviderRecover?: (providerId: string) => void
}

/**
 * Sliding window entry for tracking success/failure
 */
interface WindowEntry {
  timestamp: number
  success: boolean
  durationMs: number
}

/**
 * Provider health metrics
 */
export interface ProviderHealthMetrics {
  /** Provider ID */
  providerId: string
  /** Provider name */
  providerName: string
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
  /** Last successful send timestamp */
  lastSuccess?: number
  /** Last failure timestamp */
  lastFailure?: number
  /** Last health check timestamp */
  lastHealthCheck?: number
  /** Health check result */
  healthCheckPassing?: boolean
  /** Consecutive failures */
  consecutiveFailures: number
}

/**
 * Provider failover stats
 */
export interface ProviderFailoverStats {
  /** Total sends attempted */
  totalSends: number
  /** Successful sends */
  successfulSends: number
  /** Failed sends (all providers exhausted) */
  failedSends: number
  /** Failovers triggered */
  failoversTriggered: number
  /** Per-provider metrics */
  providers: ProviderHealthMetrics[]
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_WINDOW_SIZE_MS = 60_000 // 1 minute sliding window
const DEFAULT_DEGRADED_SUCCESS_RATE = 0.9 // 90% success rate for degraded
const DEFAULT_UNHEALTHY_SUCCESS_RATE = 0.5 // 50% success rate for unhealthy
const DEFAULT_HEALTH_CHECK_TIMEOUT = 5000
const DEFAULT_HEALTH_CHECK_UNHEALTHY_THRESHOLD = 3

// =============================================================================
// Circuit Breaker Implementation
// =============================================================================

/**
 * Circuit breaker for a single provider
 */
class ProviderCircuitBreaker {
  private state: CircuitState = 'closed'
  private failureCount = 0
  private successCount = 0
  private lastFailureTime = 0
  private config: Required<CircuitBreakerConfig>

  constructor(config: CircuitBreakerConfig) {
    this.config = {
      failureThreshold: config.failureThreshold,
      resetTimeout: config.resetTimeout,
      successThreshold: config.successThreshold ?? 1,
    }
  }

  getState(): CircuitState {
    // Check if we should transition from open to half-open
    if (this.state === 'open') {
      const now = Date.now()
      if (now - this.lastFailureTime >= this.config.resetTimeout) {
        this.state = 'half-open'
        this.successCount = 0
      }
    }
    return this.state
  }

  isRequestAllowed(): boolean {
    const currentState = this.getState()
    return currentState === 'closed' || currentState === 'half-open'
  }

  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++
      if (this.successCount >= this.config.successThreshold) {
        this.state = 'closed'
        this.failureCount = 0
        this.successCount = 0
      }
    } else if (this.state === 'closed') {
      // Reset failure count on success
      this.failureCount = 0
    }
  }

  recordFailure(): void {
    if (this.state === 'half-open') {
      // Immediately re-open on failure in half-open
      this.state = 'open'
      this.lastFailureTime = Date.now()
      this.failureCount = this.config.failureThreshold
    } else if (this.state === 'closed') {
      this.failureCount++
      if (this.failureCount >= this.config.failureThreshold) {
        this.state = 'open'
        this.lastFailureTime = Date.now()
      }
    }
  }

  reset(): void {
    this.state = 'closed'
    this.failureCount = 0
    this.successCount = 0
  }
}

// =============================================================================
// Provider State
// =============================================================================

/**
 * Internal state for a provider
 */
class ProviderState<TPayload, TResult> {
  readonly provider: ProviderAdapter<TPayload, TResult>
  readonly circuitBreaker: ProviderCircuitBreaker | null

  private window: WindowEntry[] = []
  private windowSizeMs = DEFAULT_WINDOW_SIZE_MS
  private lastSuccess?: number
  private lastFailure?: number
  private lastHealthCheck?: number
  private healthCheckPassing?: boolean
  private consecutiveFailures = 0
  private consecutiveHealthCheckFailures = 0

  constructor(
    provider: ProviderAdapter<TPayload, TResult>,
    circuitBreakerConfig?: CircuitBreakerConfig
  ) {
    this.provider = provider
    this.circuitBreaker = circuitBreakerConfig
      ? new ProviderCircuitBreaker(circuitBreakerConfig)
      : null
  }

  /**
   * Prune old entries from sliding window
   */
  private pruneWindow(): void {
    const cutoff = Date.now() - this.windowSizeMs
    this.window = this.window.filter((e) => e.timestamp > cutoff)
  }

  /**
   * Record a success
   */
  recordSuccess(durationMs: number): void {
    this.pruneWindow()
    this.window.push({ timestamp: Date.now(), success: true, durationMs })
    this.lastSuccess = Date.now()
    this.consecutiveFailures = 0
    this.circuitBreaker?.recordSuccess()
  }

  /**
   * Record a failure
   */
  recordFailure(durationMs: number): void {
    this.pruneWindow()
    this.window.push({ timestamp: Date.now(), success: false, durationMs })
    this.lastFailure = Date.now()
    this.consecutiveFailures++
    this.circuitBreaker?.recordFailure()
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
   * Check if provider is available for requests
   */
  isAvailable(): boolean {
    // Check circuit breaker first
    if (this.circuitBreaker && !this.circuitBreaker.isRequestAllowed()) {
      return false
    }
    return true
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

    return {
      providerId: this.provider.id,
      providerName: this.provider.name,
      status,
      circuitState: this.circuitBreaker?.getState() ?? 'closed',
      successRate,
      totalRequests,
      failedRequests,
      avgResponseTimeMs,
      lastSuccess: this.lastSuccess,
      lastFailure: this.lastFailure,
      lastHealthCheck: this.lastHealthCheck,
      healthCheckPassing: this.healthCheckPassing,
      consecutiveFailures: this.consecutiveFailures,
    }
  }

  /**
   * Reset state
   */
  reset(): void {
    this.window = []
    this.consecutiveFailures = 0
    this.consecutiveHealthCheckFailures = 0
    this.circuitBreaker?.reset()
  }
}

// =============================================================================
// Provider Failover Implementation
// =============================================================================

/**
 * Multi-provider failover manager
 */
export class ProviderFailover<TPayload, TResult> {
  private config: Required<
    Pick<ProviderFailoverConfig<TPayload, TResult>, 'retryOnFail' | 'maxAttempts' | 'sendTimeout'>
  > &
    ProviderFailoverConfig<TPayload, TResult>
  private providerStates: Map<string, ProviderState<TPayload, TResult>> = new Map()
  private sortedProviderIds: string[] = []
  private healthCheckInterval?: ReturnType<typeof setInterval>
  private totalSends = 0
  private successfulSends = 0
  private failedSends = 0
  private failoversTriggered = 0

  constructor(config: ProviderFailoverConfig<TPayload, TResult>) {
    this.config = {
      ...config,
      retryOnFail: config.retryOnFail ?? true,
      maxAttempts: config.maxAttempts ?? config.providers.length,
      sendTimeout: config.sendTimeout ?? 30000,
    }

    // Initialize provider states
    for (const provider of config.providers) {
      this.providerStates.set(
        provider.id,
        new ProviderState(provider, config.circuitBreaker)
      )
    }

    // Sort providers by priority
    this.updateSortedProviders()

    // Start health checks if configured
    if (config.healthCheck) {
      this.startHealthChecks()
    }
  }

  /**
   * Update sorted provider list based on priority and health
   */
  private updateSortedProviders(): void {
    this.sortedProviderIds = [...this.providerStates.keys()].sort((a, b) => {
      const stateA = this.providerStates.get(a)!
      const stateB = this.providerStates.get(b)!
      const metricsA = stateA.getMetrics()
      const metricsB = stateB.getMetrics()

      // First sort by health status (healthy > degraded > unhealthy)
      const statusOrder = { healthy: 0, degraded: 1, unhealthy: 2 }
      const statusDiff = statusOrder[metricsA.status] - statusOrder[metricsB.status]
      if (statusDiff !== 0) return statusDiff

      // Then by priority
      return stateA.provider.priority - stateB.provider.priority
    })
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    const config = this.config.healthCheck!

    this.healthCheckInterval = setInterval(async () => {
      await this.runHealthChecks()
    }, config.interval)

    // Run initial health checks
    this.runHealthChecks()
  }

  /**
   * Run health checks on all providers
   */
  private async runHealthChecks(): Promise<void> {
    const timeout = this.config.healthCheck?.timeout ?? DEFAULT_HEALTH_CHECK_TIMEOUT

    for (const [providerId, state] of this.providerStates) {
      const provider = state.provider

      if (!provider.healthCheck) continue

      try {
        const result = await Promise.race([
          provider.healthCheck(),
          new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), timeout)
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
          this.config.onProviderRecover?.(providerId)
        }
      } catch {
        state.recordHealthCheck(false)
      }
    }

    // Update provider ordering after health checks
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
  private getAvailableProviders(): ProviderState<TPayload, TResult>[] {
    return this.sortedProviderIds
      .map((id) => this.providerStates.get(id)!)
      .filter((state) => state.isAvailable())
  }

  /**
   * Send through providers with failover
   */
  async send(payload: TPayload): Promise<ProviderSendResult<TResult>> {
    const startTime = Date.now()
    this.totalSends++

    const availableProviders = this.getAvailableProviders()
    const attemptedProviders: string[] = []
    let lastError: Error | undefined

    // Determine max attempts
    const maxAttempts = this.config.retryOnFail
      ? Math.min(this.config.maxAttempts, availableProviders.length)
      : 1

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const providerState = availableProviders[attempt]
      if (!providerState) break

      const provider = providerState.provider
      attemptedProviders.push(provider.id)

      const attemptStart = Date.now()

      try {
        // Apply timeout
        const result = await Promise.race([
          provider.send(payload),
          new Promise<TResult>((_, reject) =>
            setTimeout(() => reject(new Error('Send timeout')), this.config.sendTimeout)
          ),
        ])

        const durationMs = Date.now() - attemptStart
        providerState.recordSuccess(durationMs)

        this.successfulSends++

        return {
          success: true,
          result,
          providerId: provider.id,
          providerName: provider.name,
          attemptsCount: attempt + 1,
          attemptedProviders,
          durationMs: Date.now() - startTime,
        }
      } catch (error) {
        const durationMs = Date.now() - attemptStart
        const err = error instanceof Error ? error : new Error(String(error))
        lastError = err

        providerState.recordFailure(durationMs)
        this.config.onProviderFail?.(provider.id, err)

        // Check if error is retryable
        if (provider.isRetryableError && !provider.isRetryableError(err)) {
          // Non-retryable error, don't try other providers
          break
        }

        // Trigger failover callback if there's a next provider
        if (attempt < maxAttempts - 1 && availableProviders[attempt + 1]) {
          this.failoversTriggered++
          this.config.onFailover?.(
            provider.id,
            availableProviders[attempt + 1]!.provider.id
          )
        }
      }
    }

    // All providers exhausted
    this.failedSends++

    // Update provider ordering after failures
    this.updateSortedProviders()

    return {
      success: false,
      error: lastError ?? new Error('All providers failed'),
      providerId: attemptedProviders[0] ?? 'none',
      providerName: attemptedProviders[0]
        ? this.providerStates.get(attemptedProviders[0])?.provider.name ?? 'unknown'
        : 'none',
      attemptsCount: attemptedProviders.length,
      attemptedProviders,
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * Send through a specific provider (no failover)
   */
  async sendVia(providerId: string, payload: TPayload): Promise<ProviderSendResult<TResult>> {
    const startTime = Date.now()
    this.totalSends++

    const providerState = this.providerStates.get(providerId)
    if (!providerState) {
      this.failedSends++
      return {
        success: false,
        error: new Error(`Provider not found: ${providerId}`),
        providerId,
        providerName: 'unknown',
        attemptsCount: 0,
        attemptedProviders: [],
        durationMs: Date.now() - startTime,
      }
    }

    if (!providerState.isAvailable()) {
      this.failedSends++
      return {
        success: false,
        error: new Error(`Provider unavailable: ${providerId}`),
        providerId,
        providerName: providerState.provider.name,
        attemptsCount: 0,
        attemptedProviders: [],
        durationMs: Date.now() - startTime,
      }
    }

    const attemptStart = Date.now()

    try {
      const result = await Promise.race([
        providerState.provider.send(payload),
        new Promise<TResult>((_, reject) =>
          setTimeout(() => reject(new Error('Send timeout')), this.config.sendTimeout)
        ),
      ])

      const durationMs = Date.now() - attemptStart
      providerState.recordSuccess(durationMs)
      this.successfulSends++

      return {
        success: true,
        result,
        providerId,
        providerName: providerState.provider.name,
        attemptsCount: 1,
        attemptedProviders: [providerId],
        durationMs: Date.now() - startTime,
      }
    } catch (error) {
      const durationMs = Date.now() - attemptStart
      const err = error instanceof Error ? error : new Error(String(error))

      providerState.recordFailure(durationMs)
      this.failedSends++
      this.config.onProviderFail?.(providerId, err)

      return {
        success: false,
        error: err,
        providerId,
        providerName: providerState.provider.name,
        attemptsCount: 1,
        attemptedProviders: [providerId],
        durationMs: Date.now() - startTime,
      }
    }
  }

  /**
   * Get health metrics for a specific provider
   */
  getProviderHealth(providerId: string): ProviderHealthMetrics | null {
    const state = this.providerStates.get(providerId)
    return state?.getMetrics() ?? null
  }

  /**
   * Get health metrics for all providers
   */
  getHealthStats(): ProviderFailoverStats {
    return {
      totalSends: this.totalSends,
      successfulSends: this.successfulSends,
      failedSends: this.failedSends,
      failoversTriggered: this.failoversTriggered,
      providers: this.sortedProviderIds.map((id) =>
        this.providerStates.get(id)!.getMetrics()
      ),
    }
  }

  /**
   * List available provider IDs in priority order
   */
  listProviders(): string[] {
    return [...this.sortedProviderIds]
  }

  /**
   * Get the currently preferred provider
   */
  getPreferredProvider(): ProviderAdapter<TPayload, TResult> | null {
    const available = this.getAvailableProviders()
    return available[0]?.provider ?? null
  }

  /**
   * Reset all provider states
   */
  reset(): void {
    for (const state of this.providerStates.values()) {
      state.reset()
    }
    this.totalSends = 0
    this.successfulSends = 0
    this.failedSends = 0
    this.failoversTriggered = 0
    this.updateSortedProviders()
  }

  /**
   * Add a new provider dynamically
   */
  addProvider(provider: ProviderAdapter<TPayload, TResult>): void {
    if (this.providerStates.has(provider.id)) {
      throw new Error(`Provider already exists: ${provider.id}`)
    }
    this.providerStates.set(
      provider.id,
      new ProviderState(provider, this.config.circuitBreaker)
    )
    this.updateSortedProviders()
  }

  /**
   * Remove a provider dynamically
   */
  removeProvider(providerId: string): boolean {
    const removed = this.providerStates.delete(providerId)
    if (removed) {
      this.updateSortedProviders()
    }
    return removed
  }

  /**
   * Update provider priority
   */
  setProviderPriority(providerId: string, priority: number): void {
    const state = this.providerStates.get(providerId)
    if (!state) {
      throw new Error(`Provider not found: ${providerId}`)
    }
    ;(state.provider as { priority: number }).priority = priority
    this.updateSortedProviders()
  }

  /**
   * Manually mark a provider as healthy/unhealthy
   */
  setProviderStatus(providerId: string, available: boolean): void {
    const state = this.providerStates.get(providerId)
    if (!state) {
      throw new Error(`Provider not found: ${providerId}`)
    }

    if (available) {
      state.recordHealthCheck(true)
      // Reset circuit breaker if present
      if (state.circuitBreaker) {
        state.circuitBreaker.reset()
      }
    } else {
      // Record multiple failures to trigger unhealthy status
      for (let i = 0; i < 5; i++) {
        state.recordFailure(0)
      }
    }

    this.updateSortedProviders()
  }

  /**
   * Destroy the failover manager
   */
  destroy(): void {
    this.stopHealthChecks()
    this.providerStates.clear()
    this.sortedProviderIds = []
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a provider failover manager
 */
export function createProviderFailover<TPayload, TResult>(
  config: ProviderFailoverConfig<TPayload, TResult>
): ProviderFailover<TPayload, TResult> {
  return new ProviderFailover(config)
}

// =============================================================================
// Utility Types & Helpers
// =============================================================================

/**
 * Type for creating a simple provider from send function
 */
export interface SimpleProviderOptions<TPayload, TResult> {
  id: string
  name: string
  priority: number
  send: (payload: TPayload) => Promise<TResult>
  healthCheck?: () => Promise<boolean>
  isRetryableError?: (error: Error) => boolean
}

/**
 * Create a provider adapter from simple options
 */
export function createProvider<TPayload, TResult>(
  options: SimpleProviderOptions<TPayload, TResult>
): ProviderAdapter<TPayload, TResult> {
  return {
    id: options.id,
    name: options.name,
    priority: options.priority,
    send: options.send,
    healthCheck: options.healthCheck,
    isRetryableError: options.isRetryableError,
    weight: 1,
  }
}

/**
 * Default retryable error check (5xx, timeout, network errors)
 */
export function isDefaultRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase()

  // Timeouts
  if (message.includes('timeout')) return true

  // Network errors
  if (message.includes('network') || message.includes('econnrefused')) return true

  // Server errors
  if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
    return true
  }

  // Rate limiting
  if (message.includes('429') || message.includes('rate limit')) return true

  return false
}

// =============================================================================
// Exports
// =============================================================================

export default ProviderFailover
