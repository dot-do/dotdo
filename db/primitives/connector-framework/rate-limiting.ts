/**
 * Rate Limiting and Quotas for ConnectorFramework
 *
 * Implements:
 * - Token bucket rate limiter
 * - Retry with exponential backoff
 * - API quota tracking
 * - Concurrent request limits
 * - Rate limit header parsing (X-RateLimit-*)
 *
 * @module db/primitives/connector-framework/rate-limiting
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Result of a rate limit check
 */
export interface RateLimitResult {
  allowed: boolean
  retryAfter?: number // milliseconds until retry is allowed
  remainingTokens?: number
}

/**
 * Rate limiter status
 */
export interface RateLimiterStatus {
  availableTokens: number
  maxTokens: number
  nextRefillAt: Date
}

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  maxTokens: number
  refillRate: number // tokens per refill interval
  refillInterval: number // milliseconds
  burstCapacity?: number // additional tokens for burst
}

/**
 * Rate limiter interface
 */
export interface RateLimiter {
  acquire(cost?: number): Promise<RateLimitResult>
  getStatus(): Promise<RateLimiterStatus>
  waitForToken(options?: { timeout?: number }): Promise<void>
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries: number
  initialDelayMs: number
  maxDelayMs?: number
  backoffMultiplier?: number
  jitter?: boolean
  shouldRetry?: (error: Error) => boolean
  onRetry?: (attempt: number, delay: number, error: Error) => void
  circuitBreaker?: {
    failureThreshold: number
    resetTimeoutMs: number
  }
}

/**
 * Retry result
 */
export interface RetryResult<T> {
  success: boolean
  value?: T
  error?: Error
  attempts: number
}

/**
 * Retry executor interface
 */
export interface RetryExecutor {
  execute<T>(operation: () => Promise<T>): Promise<RetryResult<T>>
}

/**
 * Quota configuration
 */
export interface QuotaConfig {
  quotas?: Array<{
    name: string
    limit: number
    windowMs: number
  }>
  maxConcurrent?: number
}

/**
 * Quota status
 */
export interface QuotaStatus {
  used: number
  remaining: number
  limit: number
  resetsAt: Date
}

/**
 * Quota manager interface
 */
export interface QuotaManager {
  consume(quotaName: string, amount?: number): Promise<void>
  getStatus(quotaName: string): Promise<QuotaStatus>
  withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T>
  getConcurrentCount(): number
}

/**
 * Parsed rate limit information from headers
 */
export interface RateLimitInfo {
  limit?: number
  remaining?: number
  resetAt?: Date
  resetInSeconds?: number
  retryAfterSeconds?: number
  used?: number
  resource?: string
}

// =============================================================================
// Token Bucket Rate Limiter
// =============================================================================

/**
 * Create a token bucket rate limiter
 */
export function createTokenBucketRateLimiter(config: RateLimiterConfig): RateLimiter {
  const { maxTokens, refillRate, refillInterval, burstCapacity = 0 } = config
  const totalCapacity = maxTokens + burstCapacity

  let tokens = maxTokens
  let lastRefillTime = Date.now()

  /**
   * Refill tokens based on elapsed time
   */
  function refill(): void {
    const now = Date.now()
    const elapsed = now - lastRefillTime

    if (elapsed >= refillInterval) {
      const intervals = Math.floor(elapsed / refillInterval)
      const tokensToAdd = intervals * refillRate
      tokens = Math.min(totalCapacity, tokens + tokensToAdd)
      lastRefillTime = now - (elapsed % refillInterval)
    }
  }

  /**
   * Calculate time until next token is available
   */
  function timeUntilNextToken(): number {
    const elapsed = Date.now() - lastRefillTime
    return Math.max(0, refillInterval - elapsed)
  }

  return {
    async acquire(cost = 1): Promise<RateLimitResult> {
      refill()

      if (tokens >= cost) {
        tokens -= cost
        return { allowed: true, remainingTokens: tokens }
      }

      // Calculate retry after
      const tokensNeeded = cost - tokens
      const intervalsNeeded = Math.ceil(tokensNeeded / refillRate)
      const retryAfter = timeUntilNextToken() + (intervalsNeeded - 1) * refillInterval

      return { allowed: false, retryAfter, remainingTokens: tokens }
    },

    async getStatus(): Promise<RateLimiterStatus> {
      refill()

      const timeToNextRefill = timeUntilNextToken()

      return {
        availableTokens: tokens,
        maxTokens: totalCapacity,
        nextRefillAt: new Date(Date.now() + timeToNextRefill),
      }
    },

    async waitForToken(options?: { timeout?: number }): Promise<void> {
      const timeout = options?.timeout ?? Infinity
      const startTime = Date.now()

      return new Promise((resolve, reject) => {
        function check() {
          refill()

          if (tokens >= 1) {
            resolve()
            return
          }

          const elapsed = Date.now() - startTime
          if (elapsed >= timeout) {
            reject(new Error('Timeout waiting for rate limit token'))
            return
          }

          const waitTime = Math.min(timeUntilNextToken(), timeout - elapsed)
          setTimeout(check, waitTime)
        }

        check()
      })
    },
  }
}

// =============================================================================
// Retry with Exponential Backoff
// =============================================================================

/**
 * Default retriable status codes
 */
const RETRIABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504]

/**
 * Check if an error is retriable by default
 */
function isRetriableError(error: Error): boolean {
  const statusCode = (error as any).statusCode ?? (error as any).status
  if (statusCode && RETRIABLE_STATUS_CODES.includes(statusCode)) {
    return true
  }

  // Network errors
  const message = error.message.toLowerCase()
  if (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('temporary')
  ) {
    return true
  }

  return false
}

/**
 * Calculate delay with optional jitter
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
  const { initialDelayMs, maxDelayMs = Infinity, backoffMultiplier = 2, jitter = false } = config

  let delay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1)
  delay = Math.min(delay, maxDelayMs)

  if (jitter) {
    // Add random jitter between 0-100% of calculated delay
    delay = delay * (0.5 + Math.random())
  }

  return Math.round(delay)
}

/**
 * Create a retry executor with exponential backoff
 */
export function createRetryWithBackoff(config: RetryConfig): RetryExecutor {
  const { maxRetries, shouldRetry = isRetriableError, onRetry, circuitBreaker } = config

  // Circuit breaker state
  let consecutiveFailures = 0
  let circuitOpenUntil = 0

  return {
    async execute<T>(operation: () => Promise<T>): Promise<RetryResult<T>> {
      let lastError: Error | undefined
      let attempts = 0

      // Check circuit breaker
      if (circuitBreaker && Date.now() < circuitOpenUntil) {
        return {
          success: false,
          error: new Error('Circuit breaker is open'),
          attempts: 0,
        }
      }

      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        attempts = attempt

        try {
          const value = await operation()

          // Reset circuit breaker on success
          if (circuitBreaker) {
            consecutiveFailures = 0
          }

          return { success: true, value, attempts }
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))

          // Update circuit breaker
          if (circuitBreaker) {
            consecutiveFailures++
            if (consecutiveFailures >= circuitBreaker.failureThreshold) {
              circuitOpenUntil = Date.now() + circuitBreaker.resetTimeoutMs
            }
          }

          // Check if we should retry
          if (attempt > maxRetries || !shouldRetry(lastError)) {
            break
          }

          // Calculate delay
          const delay = calculateDelay(attempt, config)

          // Notify retry callback
          if (onRetry) {
            onRetry(attempt, delay, lastError)
          }

          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }

      return { success: false, error: lastError, attempts }
    },
  }
}

// =============================================================================
// Quota Manager
// =============================================================================

interface QuotaWindow {
  startTime: number
  used: number
}

/**
 * Create a quota manager
 */
export function createQuotaManager(config: QuotaConfig): QuotaManager {
  const { quotas = [], maxConcurrent } = config

  // Quota tracking
  const quotaWindows = new Map<string, QuotaWindow>()
  const quotaConfigs = new Map<string, { limit: number; windowMs: number }>()

  for (const quota of quotas) {
    quotaConfigs.set(quota.name, { limit: quota.limit, windowMs: quota.windowMs })
  }

  // Concurrency tracking
  let currentConcurrent = 0
  const concurrencyQueue: Array<() => void> = []

  /**
   * Get or create quota window
   */
  function getQuotaWindow(name: string): QuotaWindow {
    const quotaConfig = quotaConfigs.get(name)
    if (!quotaConfig) {
      throw new Error(`Unknown quota: ${name}`)
    }

    const existing = quotaWindows.get(name)
    const now = Date.now()

    // Check if window has expired
    if (existing && now - existing.startTime >= quotaConfig.windowMs) {
      // Reset window
      const newWindow = { startTime: now, used: 0 }
      quotaWindows.set(name, newWindow)
      return newWindow
    }

    if (!existing) {
      const newWindow = { startTime: now, used: 0 }
      quotaWindows.set(name, newWindow)
      return newWindow
    }

    return existing
  }

  return {
    async consume(quotaName: string, amount = 1): Promise<void> {
      const quotaConfig = quotaConfigs.get(quotaName)
      if (!quotaConfig) {
        throw new Error(`Unknown quota: ${quotaName}`)
      }

      const window = getQuotaWindow(quotaName)

      if (window.used + amount > quotaConfig.limit) {
        const resetsIn = quotaConfig.windowMs - (Date.now() - window.startTime)
        throw new Error(
          `Quota exceeded for ${quotaName}: ${window.used}/${quotaConfig.limit} used. ` +
            `Resets in ${Math.ceil(resetsIn / 1000)} seconds`,
        )
      }

      window.used += amount
    },

    async getStatus(quotaName: string): Promise<QuotaStatus> {
      const quotaConfig = quotaConfigs.get(quotaName)
      if (!quotaConfig) {
        throw new Error(`Unknown quota: ${quotaName}`)
      }

      const window = getQuotaWindow(quotaName)
      const resetsAt = new Date(window.startTime + quotaConfig.windowMs)

      return {
        used: window.used,
        remaining: quotaConfig.limit - window.used,
        limit: quotaConfig.limit,
        resetsAt,
      }
    },

    async withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
      if (maxConcurrent === undefined) {
        return fn()
      }

      // Wait if at capacity
      if (currentConcurrent >= maxConcurrent) {
        await new Promise<void>((resolve) => {
          concurrencyQueue.push(resolve)
        })
      }

      currentConcurrent++

      try {
        return await fn()
      } finally {
        currentConcurrent--

        // Release next waiter
        const next = concurrencyQueue.shift()
        if (next) {
          next()
        }
      }
    },

    getConcurrentCount(): number {
      return currentConcurrent
    },
  }
}

// =============================================================================
// Rate Limit Header Parsing
// =============================================================================

/**
 * Parse rate limit information from HTTP response headers
 */
export function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  const info: RateLimitInfo = {}

  // Standard X-RateLimit headers
  const limit = headers.get('X-RateLimit-Limit')
  if (limit) {
    info.limit = parseInt(limit, 10)
  }

  const remaining = headers.get('X-RateLimit-Remaining')
  if (remaining) {
    info.remaining = parseInt(remaining, 10)
  }

  const reset = headers.get('X-RateLimit-Reset')
  if (reset) {
    // Usually Unix timestamp in seconds
    const resetTime = parseInt(reset, 10)
    info.resetAt = new Date(resetTime * 1000)
  }

  // GitHub-style extensions
  const used = headers.get('X-RateLimit-Used')
  if (used) {
    info.used = parseInt(used, 10)
  }

  const resource = headers.get('X-RateLimit-Resource')
  if (resource) {
    info.resource = resource
  }

  // Draft RateLimit header standard
  const rateLimit = headers.get('RateLimit')
  if (rateLimit) {
    // Parse: "limit=100, remaining=50, reset=30"
    const parts = rateLimit.split(',').map((p) => p.trim())
    for (const part of parts) {
      const [key, value] = part.split('=')
      switch (key) {
        case 'limit':
          info.limit = parseInt(value, 10)
          break
        case 'remaining':
          info.remaining = parseInt(value, 10)
          break
        case 'reset':
          info.resetInSeconds = parseInt(value, 10)
          break
      }
    }
  }

  // Retry-After header
  const retryAfter = headers.get('Retry-After')
  if (retryAfter) {
    // Check if it's a number (seconds) or HTTP date
    const seconds = parseInt(retryAfter, 10)
    if (!isNaN(seconds)) {
      info.retryAfterSeconds = seconds
    } else {
      // HTTP date format
      const date = new Date(retryAfter)
      if (!isNaN(date.getTime())) {
        info.retryAfterSeconds = Math.ceil((date.getTime() - Date.now()) / 1000)
      }
    }
  }

  return info
}
