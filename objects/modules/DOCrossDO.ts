/**
 * DOCrossDO Module - Cross-DO RPC with circuit breakers
 *
 * This module extracts cross-DO call functionality from DOBase:
 * - invokeCrossDOMethod() - RPC to other DOs
 * - Circuit breaker state management
 * - Retry logic with exponential backoff
 * - Timeout handling
 *
 * @module DOCrossDO
 */

/**
 * Custom error class for cross-DO call failures with rich context
 */
export class CrossDOError extends Error {
  code: string
  context: {
    targetDO?: string
    method?: string
    source?: string
    attempts?: number
    originalError?: string
  }

  constructor(
    code: string,
    message: string,
    context: {
      targetDO?: string
      method?: string
      source?: string
      attempts?: number
      originalError?: string
    } = {}
  ) {
    super(message)
    this.name = 'CrossDOError'
    this.code = code
    this.context = context

    // Preserve stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CrossDOError)
    }
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        context: this.context,
      },
    }
  }
}

/**
 * Circuit breaker state
 */
interface CircuitBreakerState {
  failures: number
  lastFailure: number
  state: 'closed' | 'open' | 'half-open'
}

/**
 * Circuit breaker configuration
 */
interface CircuitBreakerConfig {
  failureThreshold: number
  resetTimeoutMs: number
  halfOpenRequests: number
}

/**
 * Retry configuration for cross-DO calls
 */
interface RetryConfig {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
  retryableStatuses: number[]
  retryableErrors: string[]
}

/**
 * DO Namespace interface
 */
interface DONamespace {
  idFromName(name: string): unknown
  idFromString(id: string): unknown
  get(id: unknown): DOStub
}

/**
 * DO Stub interface
 */
interface DOStub {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>
}

/**
 * Context required for cross-DO operations
 */
export interface CrossDOContext {
  /** Source namespace for error reporting */
  ns: string
  /** Get DO namespace binding */
  getDONamespace(): DONamespace | undefined
  /** Sleep utility */
  sleep(ms: number): Promise<void>
}

/**
 * DOCrossDO - Manages cross-DO RPC with resilience patterns
 */
export class DOCrossDO {
  // Static circuit breaker state (per target DO)
  private static _circuitBreakers: Map<string, CircuitBreakerState> = new Map()

  // Circuit breaker configuration
  private static readonly CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 5,
    resetTimeoutMs: 30000,
    halfOpenRequests: 1,
  }

  // Cross-DO retry configuration
  private static readonly RETRY_CONFIG: RetryConfig = {
    maxAttempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    retryableStatuses: [500, 502, 503, 504],
    retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'],
  }

  // Default timeout for cross-DO calls
  private static readonly TIMEOUT_MS = 30000

  private readonly _context: CrossDOContext

  constructor(context: CrossDOContext) {
    this._context = context
  }

  /**
   * Invoke a method on another DO via RPC
   */
  async invoke(
    noun: string,
    id: string,
    method: string,
    args: unknown[],
    options?: { timeout?: number }
  ): Promise<unknown> {
    const doNamespace = this._context.getDONamespace()
    if (!doNamespace) {
      throw new CrossDOError(
        'DO_NAMESPACE_NOT_CONFIGURED',
        `Method '${method}' not found and DO namespace not configured for cross-DO calls`,
        { method, source: this._context.ns }
      )
    }

    const targetNs = `${noun}/${id}`
    const timeout = options?.timeout ?? DOCrossDO.TIMEOUT_MS

    // Check circuit breaker
    const circuitState = this.checkCircuitBreaker(targetNs)
    if (circuitState === 'open') {
      throw new CrossDOError(
        'CIRCUIT_BREAKER_OPEN',
        `Circuit breaker open for ${targetNs}`,
        { targetDO: targetNs, source: this._context.ns }
      )
    }

    const doId = doNamespace.idFromName(targetNs)
    const stub = doNamespace.get(doId)

    const { maxAttempts, initialDelayMs, maxDelayMs, backoffMultiplier, retryableStatuses } = DOCrossDO.RETRY_CONFIG

    let lastError: Error | undefined
    let attempts = 0

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts = attempt

      try {
        const response = await this.fetchWithTimeout(
          stub,
          `https://${targetNs}/rpc/${method}`,
          { args },
          timeout
        )

        // Check for rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After')
          const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : initialDelayMs * Math.pow(backoffMultiplier, attempt - 1)
          if (attempt < maxAttempts) {
            await this._context.sleep(Math.min(delay, maxDelayMs))
            continue
          }
        }

        // Non-retryable client errors
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          const errorText = await response.text()
          this.recordSuccess(targetNs)
          throw new CrossDOError(
            'CROSS_DO_CLIENT_ERROR',
            `Cross-DO RPC failed: ${response.status} - ${errorText}`,
            { targetDO: targetNs, method, source: this._context.ns }
          )
        }

        // Retryable server errors
        if (!response.ok && retryableStatuses.includes(response.status)) {
          const errorText = await response.text()
          lastError = new Error(`Cross-DO RPC failed: ${response.status} - ${errorText}`)

          if (attempt < maxAttempts) {
            const delay = Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt - 1), maxDelayMs)
            await this._context.sleep(delay)
            continue
          }
        }

        if (!response.ok) {
          const errorText = await response.text()
          this.recordFailure(targetNs)
          throw new CrossDOError(
            'CROSS_DO_ERROR',
            `Cross-DO RPC failed: ${response.status} - ${errorText}`,
            { targetDO: targetNs, method, attempts, source: this._context.ns }
          )
        }

        const result = await response.json() as { result?: unknown; error?: string }

        if (result.error) {
          this.recordFailure(targetNs)
          throw new CrossDOError(
            'CROSS_DO_ERROR',
            result.error,
            { targetDO: targetNs, method, source: this._context.ns }
          )
        }

        // Success - record and return
        this.recordSuccess(targetNs)
        return result.result

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Check for timeout
        if (lastError.name === 'AbortError' || lastError.message.includes('timeout')) {
          this.recordFailure(targetNs)
          throw new CrossDOError(
            'CROSS_DO_TIMEOUT',
            `Cross-DO call to ${targetNs}.${method}() timed out after ${timeout}ms`,
            { targetDO: targetNs, method, source: this._context.ns }
          )
        }

        // Check if error is retryable
        const isRetryable = DOCrossDO.RETRY_CONFIG.retryableErrors.some(
          errType => lastError!.message.includes(errType)
        )

        if (isRetryable && attempt < maxAttempts) {
          const delay = Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt - 1), maxDelayMs)
          await this._context.sleep(delay)
          continue
        }

        // Not retryable or exhausted retries
        this.recordFailure(targetNs)
        throw lastError
      }
    }

    // Exhausted all retries
    this.recordFailure(targetNs)
    throw new CrossDOError(
      'CROSS_DO_ERROR',
      `Cross-DO call failed after ${attempts} attempts`,
      {
        targetDO: targetNs,
        method,
        attempts,
        source: this._context.ns,
        originalError: lastError?.message,
      }
    )
  }

  /**
   * Fetch with timeout for cross-DO calls
   */
  private async fetchWithTimeout(
    stub: DOStub,
    url: string,
    body: unknown,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      return await stub.fetch(
        new Request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      )
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Check circuit breaker state for a target DO
   */
  private checkCircuitBreaker(targetNs: string): 'closed' | 'open' | 'half-open' {
    const breaker = DOCrossDO._circuitBreakers.get(targetNs)
    if (!breaker) return 'closed'

    const { failureThreshold, resetTimeoutMs } = DOCrossDO.CIRCUIT_BREAKER_CONFIG

    if (breaker.state === 'open') {
      // Check if enough time has passed to try half-open
      if (Date.now() - breaker.lastFailure >= resetTimeoutMs) {
        breaker.state = 'half-open'
        return 'half-open'
      }
      return 'open'
    }

    if (breaker.failures >= failureThreshold) {
      breaker.state = 'open'
      return 'open'
    }

    return breaker.state
  }

  /**
   * Record a successful cross-DO call (reset circuit breaker)
   */
  private recordSuccess(targetNs: string): void {
    DOCrossDO._circuitBreakers.set(targetNs, {
      failures: 0,
      lastFailure: 0,
      state: 'closed',
    })
  }

  /**
   * Record a failed cross-DO call
   */
  private recordFailure(targetNs: string): void {
    const breaker = DOCrossDO._circuitBreakers.get(targetNs) ?? {
      failures: 0,
      lastFailure: 0,
      state: 'closed' as const,
    }

    breaker.failures++
    breaker.lastFailure = Date.now()

    if (breaker.failures >= DOCrossDO.CIRCUIT_BREAKER_CONFIG.failureThreshold) {
      breaker.state = 'open'
    }

    DOCrossDO._circuitBreakers.set(targetNs, breaker)
  }

  /**
   * Reset all static state - ONLY for testing.
   */
  static resetTestState(): void {
    DOCrossDO._circuitBreakers.clear()
  }

  /**
   * Get circuit breaker state for a target - for testing
   */
  static getCircuitBreakerState(targetNs: string): CircuitBreakerState | undefined {
    return DOCrossDO._circuitBreakers.get(targetNs)
  }
}
