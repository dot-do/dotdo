/**
 * Provider Fallback Chain Implementation
 *
 * Provides automatic failover across multiple AI providers with:
 * - Configurable fallback chains
 * - Health tracking and circuit breaker pattern
 * - Detailed error aggregation
 * - Clear error messages when all providers fail
 *
 * @module @dotdo/ai/fallback
 */

import type {
  Provider,
  ProviderFailureDetail,
  FallbackChainSummary,
  BackoffConfig,
  CircuitBreakerConfig,
} from './types'

// ============================================================================
// FallbackError - Detailed Error Aggregation
// ============================================================================

/**
 * Error thrown when all providers in the fallback chain fail.
 *
 * Provides detailed information about each provider failure to aid debugging
 * and monitoring. Includes the full chain summary with timing, error codes,
 * and provider health information.
 *
 * @example
 * ```typescript
 * try {
 *   await fallback.execute(() => model('gpt-4'))
 * } catch (error) {
 *   if (error instanceof FallbackError) {
 *     console.log('Providers tried:', error.summary.providersAttempted)
 *     console.log('Providers skipped:', error.summary.providersSkipped)
 *     for (const failure of error.failures) {
 *       console.log(`${failure.provider}: ${failure.error}`)
 *     }
 *   }
 * }
 * ```
 */
export class FallbackError extends Error {
  /** Name of the error class for instanceof checks */
  readonly name = 'FallbackError'

  /** Detailed information about each provider failure */
  readonly failures: ProviderFailureDetail[]

  /** Summary of the entire fallback chain execution */
  readonly summary: FallbackChainSummary

  /** The original prompt or operation that failed (if available) */
  readonly operation?: string

  constructor(
    message: string,
    failures: ProviderFailureDetail[],
    summary: FallbackChainSummary,
    operation?: string
  ) {
    super(message)
    this.failures = failures
    this.summary = summary
    if (operation !== undefined) {
      this.operation = operation
    }

    // Maintain proper stack trace for where our error was thrown (only in V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FallbackError)
    }
  }

  /**
   * Create a FallbackError with a well-formatted message.
   */
  static create(
    failures: ProviderFailureDetail[],
    summary: FallbackChainSummary,
    operation?: string
  ): FallbackError {
    const attemptedStr = summary.providersAttempted.join(', ')
    const skippedStr = summary.providersSkipped.length > 0
      ? ` (skipped: ${summary.providersSkipped.join(', ')})`
      : ''

    // Format the last error message for the main error
    const lastFailure = failures[failures.length - 1]
    const lastErrorMsg = lastFailure
      ? `: ${lastFailure.error}`
      : ''

    const message = `All providers failed [tried: ${attemptedStr}]${skippedStr}${lastErrorMsg}`

    return new FallbackError(message, failures, summary, operation)
  }

  /**
   * Get a formatted string of all failures for logging.
   */
  getDetailedReport(): string {
    const lines = [
      `Fallback Chain Failed`,
      `=====================`,
      `Duration: ${this.summary.totalDuration}ms`,
      `Providers Attempted: ${this.summary.providersAttempted.join(', ')}`,
    ]

    if (this.summary.providersSkipped.length > 0) {
      lines.push(`Providers Skipped: ${this.summary.providersSkipped.join(', ')}`)
    }

    if (this.operation) {
      lines.push(`Operation: ${this.operation}`)
    }

    lines.push('', 'Failure Details:')

    for (const failure of this.failures) {
      const parts = [`  - ${failure.provider}`]
      if (failure.model) {
        parts.push(`(${failure.model})`)
      }
      parts.push(`: ${failure.error}`)
      if (failure.status) {
        parts.push(`[HTTP ${failure.status}]`)
      }
      if (failure.code) {
        parts.push(`[code: ${failure.code}]`)
      }
      if (failure.retries && failure.retries > 0) {
        parts.push(`[${failure.retries} retries]`)
      }
      lines.push(parts.join(' '))
    }

    return lines.join('\n')
  }

  /**
   * Convert to JSON for logging/monitoring.
   */
  toJSON(): object {
    return {
      name: this.name,
      message: this.message,
      operation: this.operation,
      summary: this.summary,
      failures: this.failures,
    }
  }
}

// ============================================================================
// Provider Health Tracking
// ============================================================================

/**
 * Health state for a single provider.
 */
interface ProviderHealthState {
  /** Whether the provider is currently healthy */
  healthy: boolean
  /** Timestamp of last health check */
  lastCheck: number
  /** Number of consecutive failures */
  consecutiveFailures: number
  /** Number of consecutive successes (for recovery) */
  consecutiveSuccesses: number
  /** Circuit breaker state */
  circuitState: 'closed' | 'open' | 'half-open'
  /** When the circuit was opened */
  openedAt?: number
}

/**
 * Global health tracker for providers.
 * Shared across all ProviderFallback instances for consistent health state.
 */
const globalHealthState = new Map<string, ProviderHealthState>()

/**
 * Get or initialize health state for a provider.
 */
function getHealthState(provider: string): ProviderHealthState {
  let state = globalHealthState.get(provider)
  if (!state) {
    state = {
      healthy: true,
      lastCheck: Date.now(),
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      circuitState: 'closed',
    }
    globalHealthState.set(provider, state)
  }
  return state
}

// ============================================================================
// ProviderFallback - Main Fallback Chain Implementation
// ============================================================================

/**
 * Configuration for ProviderFallback.
 */
export interface ProviderFallbackConfig {
  /** Ordered list of providers to try */
  providers: (Provider | string)[]
  /** Maximum retries per provider before moving to next */
  maxRetriesPerProvider?: number
  /** Circuit breaker configuration */
  circuitBreaker?: CircuitBreakerConfig
  /** Backoff configuration for retries */
  backoff?: BackoffConfig
  /** Whether to track provider health globally */
  trackHealth?: boolean
}

/**
 * Result of a fallback chain execution.
 */
export interface FallbackResult<T> {
  /** The successful result */
  result: T
  /** The provider that succeeded */
  provider: string
  /** Number of providers tried before success */
  attemptCount: number
  /** Total retries across all providers */
  totalRetries: number
  /** Duration of the entire chain execution (ms) */
  duration: number
}

/**
 * Fallback chain executor for AI provider operations.
 *
 * Provides automatic failover across multiple providers with health tracking,
 * circuit breaker pattern, and detailed error reporting.
 *
 * @example
 * ```typescript
 * import { ProviderFallback } from '@dotdo/ai'
 *
 * const fallback = new ProviderFallback({
 *   providers: ['anthropic', 'openai', 'google'],
 *   maxRetriesPerProvider: 2,
 *   circuitBreaker: {
 *     failureThreshold: 3,
 *     recoveryTimeout: 60000,
 *   }
 * })
 *
 * // Execute with automatic fallback
 * const { result, provider } = await fallback.execute(
 *   async (provider) => {
 *     const model = await getModelForProvider(provider)
 *     return generateText({ model, prompt: 'Hello' })
 *   }
 * )
 * ```
 */
export class ProviderFallback {
  private config: Required<ProviderFallbackConfig>

  constructor(config: ProviderFallbackConfig) {
    this.config = {
      providers: config.providers,
      maxRetriesPerProvider: config.maxRetriesPerProvider ?? 2,
      trackHealth: config.trackHealth ?? true,
      circuitBreaker: {
        failureThreshold: 3,
        recoveryTimeout: 60000,
        successThreshold: 1,
        ...config.circuitBreaker,
      },
      backoff: {
        initialDelay: 1000,
        multiplier: 2,
        maxDelay: 30000,
        jitter: true,
        ...config.backoff,
      },
    }
  }

  /**
   * Execute an operation with automatic fallback across providers.
   *
   * @param operation - Async function that receives the provider and returns a result
   * @param operationName - Optional name for error reporting
   */
  async execute<T>(
    operation: (provider: string) => Promise<T>,
    operationName?: string
  ): Promise<FallbackResult<T>> {
    const startTime = Date.now()
    const failures: ProviderFailureDetail[] = []
    const providersAttempted: string[] = []
    const providersSkipped: string[] = []
    let totalRetries = 0

    for (const provider of this.config.providers) {
      const providerStr = String(provider)

      // Check if provider is available (circuit breaker)
      if (!this.isProviderAvailable(providerStr)) {
        providersSkipped.push(providerStr)
        continue
      }

      providersAttempted.push(providerStr)

      // Try this provider with retries
      for (let attempt = 0; attempt < this.config.maxRetriesPerProvider; attempt++) {
        try {
          const result = await operation(providerStr)

          // Success - update health and return
          this.markHealthy(providerStr)

          return {
            result,
            provider: providerStr,
            attemptCount: providersAttempted.length,
            totalRetries,
            duration: Date.now() - startTime,
          }
        } catch (error) {
          const err = error as Error & { status?: number; code?: string | number }
          totalRetries++

          // Check if this is a rate limit error (should retry)
          if (this.isRateLimitError(err) && attempt < this.config.maxRetriesPerProvider - 1) {
            const delay = this.calculateBackoffDelay(attempt)
            await this.sleep(delay)
            continue
          }

          // Record the failure
          failures.push({
            provider: providerStr,
            error: err.message || 'Unknown error',
            ...(err.code !== undefined && { code: err.code }),
            ...(err.status !== undefined && { status: err.status }),
            timestamp: Date.now(),
            retries: attempt,
          })

          // Mark unhealthy and break to try next provider
          this.markUnhealthy(providerStr)
          break
        }
      }
    }

    // All providers failed
    const summary: FallbackChainSummary = {
      providersAttempted,
      providersSkipped,
      totalDuration: Date.now() - startTime,
      failures,
    }

    throw FallbackError.create(failures, summary, operationName)
  }

  /**
   * Check if a provider is available (circuit breaker logic).
   */
  isProviderAvailable(provider: string): boolean {
    if (!this.config.trackHealth) return true

    const health = getHealthState(provider)
    const cbConfig = this.config.circuitBreaker

    // Closed circuit - available
    if (health.circuitState === 'closed') return true

    // Half-open - allow one request through
    if (health.circuitState === 'half-open') return true

    // Open circuit - check if recovery timeout has elapsed
    const recoveryTimeout = cbConfig.recoveryTimeout ?? 60000
    const timeSinceOpen = Date.now() - (health.openedAt ?? 0)
    if (timeSinceOpen >= recoveryTimeout) {
      // Transition to half-open
      health.circuitState = 'half-open'
      health.consecutiveSuccesses = 0
      return true
    }

    return false
  }

  /**
   * Mark a provider as healthy after a successful request.
   */
  markHealthy(provider: string): void {
    if (!this.config.trackHealth) return

    const health = getHealthState(provider)
    const cbConfig = this.config.circuitBreaker
    const consecutiveSuccesses = health.consecutiveSuccesses + 1
    const successThreshold = cbConfig.successThreshold ?? 1

    if (health.circuitState === 'half-open' && consecutiveSuccesses >= successThreshold) {
      // Recovery complete - close the circuit
      health.healthy = true
      health.lastCheck = Date.now()
      health.consecutiveFailures = 0
      health.consecutiveSuccesses = 0
      health.circuitState = 'closed'
      delete health.openedAt
    } else if (health.circuitState === 'half-open') {
      // Still recovering
      health.lastCheck = Date.now()
      health.consecutiveSuccesses = consecutiveSuccesses
    } else {
      // Normal healthy state
      health.healthy = true
      health.lastCheck = Date.now()
      health.consecutiveFailures = 0
      health.consecutiveSuccesses = 0
      health.circuitState = 'closed'
    }
  }

  /**
   * Mark a provider as unhealthy after a failed request.
   */
  markUnhealthy(provider: string): void {
    if (!this.config.trackHealth) return

    const health = getHealthState(provider)
    const cbConfig = this.config.circuitBreaker
    const consecutiveFailures = health.consecutiveFailures + 1
    const failureThreshold = cbConfig.failureThreshold ?? 3

    // Check if threshold met (open the circuit)
    const shouldOpen = consecutiveFailures >= failureThreshold

    health.healthy = !shouldOpen
    health.lastCheck = Date.now()
    health.consecutiveFailures = consecutiveFailures
    health.consecutiveSuccesses = 0

    if (shouldOpen && health.circuitState !== 'open') {
      health.circuitState = 'open'
      health.openedAt = Date.now()
    }
  }

  /**
   * Get the current health status of all providers.
   */
  getHealthStatus(): Record<string, ProviderHealthState> {
    const status: Record<string, ProviderHealthState> = {}
    for (const provider of this.config.providers) {
      const providerStr = String(provider)
      status[providerStr] = { ...getHealthState(providerStr) }
    }
    return status
  }

  /**
   * Reset health status for all providers (useful for testing).
   */
  resetHealthStatus(): void {
    for (const provider of this.config.providers) {
      globalHealthState.delete(String(provider))
    }
  }

  /**
   * Check if an error is a rate limit error.
   */
  private isRateLimitError(error: Error & { status?: number; code?: string | number }): boolean {
    // Check HTTP status code
    if (error.status === 429) return true

    // Check error code
    const code = error.code
    if (typeof code === 'string') {
      const codeLower = code.toLowerCase()
      if (
        codeLower === 'rate_limit_exceeded' ||
        codeLower === 'rate_limit_error' ||
        codeLower === 'too_many_requests' ||
        codeLower === 'quota_exceeded'
      ) {
        return true
      }
    }
    if (code === 429) return true

    // Check error message
    const message = error.message?.toLowerCase() || ''
    const patterns = [
      'rate limit',
      'too many requests',
      'quota exceeded',
      'throttle',
      '429',
    ]

    return patterns.some(p => message.includes(p))
  }

  /**
   * Calculate backoff delay with optional jitter.
   */
  private calculateBackoffDelay(attempt: number): number {
    const backoffConfig = this.config.backoff
    const initialDelay = backoffConfig.initialDelay ?? 1000
    const multiplier = backoffConfig.multiplier ?? 2
    const maxDelay = backoffConfig.maxDelay ?? 30000
    const jitter = backoffConfig.jitter ?? true

    let delay = initialDelay * Math.pow(multiplier, attempt)
    delay = Math.min(delay, maxDelay)

    if (jitter) {
      const jitterAmount = delay * 0.1
      delay = delay + (Math.random() * jitterAmount * 2 - jitterAmount)
    }

    return Math.round(delay)
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Reset all global health state (useful for testing).
 */
export function resetGlobalHealthState(): void {
  globalHealthState.clear()
}

/**
 * Get the current global health state (for debugging/monitoring).
 */
export function getGlobalHealthState(): Map<string, ProviderHealthState> {
  return new Map(globalHealthState)
}

/**
 * Create a fallback chain with default configuration.
 */
export function createFallback(
  providers: (Provider | string)[],
  options?: Partial<Omit<ProviderFallbackConfig, 'providers'>>
): ProviderFallback {
  return new ProviderFallback({
    providers,
    ...options,
  })
}
