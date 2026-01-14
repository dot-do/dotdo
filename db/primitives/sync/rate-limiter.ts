/**
 * RateLimiter - Rate limiting for destination API compliance
 *
 * This module implements a token bucket algorithm for rate limiting
 * requests to external APIs. It supports configurable rates at different
 * time scales (per second, minute, hour) and burst capacity.
 *
 * ## Overview
 *
 * Rate limiting is essential for:
 * - Respecting destination API limits
 * - Preventing request throttling and errors
 * - Fair resource allocation across concurrent operations
 * - Predictable throughput management
 *
 * ## Token Bucket Algorithm
 *
 * The token bucket algorithm works by:
 * 1. Maintaining a bucket of tokens (up to burst size)
 * 2. Refilling tokens at a configured rate over time
 * 3. Consuming one token per request
 * 4. Blocking when tokens are exhausted until refill
 *
 * ## Usage Example
 *
 * ```typescript
 * import { RateLimiter } from './rate-limiter'
 *
 * // Create a limiter for 10 requests/second with burst of 20
 * const limiter = new RateLimiter({
 *   requestsPerSecond: 10,
 *   burstSize: 20,
 * })
 *
 * // Acquire a token before making an API call
 * await limiter.acquire()
 * await callExternalAPI()
 *
 * // Or use tryAcquire for non-blocking check
 * if (limiter.tryAcquire()) {
 *   await callExternalAPI()
 * } else {
 *   console.log('Rate limited, try again later')
 * }
 * ```
 *
 * @module db/primitives/sync/rate-limiter
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for rate limiting
 */
export interface RateLimitConfig {
  /** Maximum requests per second */
  requestsPerSecond?: number
  /** Maximum requests per minute */
  requestsPerMinute?: number
  /** Maximum requests per hour */
  requestsPerHour?: number
  /** Maximum burst size (tokens that can be consumed immediately) */
  burstSize?: number
}

/**
 * Internal representation of a waiting caller
 */
interface WaitingCaller {
  resolve: () => void
  timestamp: number
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * RateLimiter implements token bucket rate limiting for API compliance
 *
 * @example
 * ```typescript
 * const limiter = new RateLimiter({ requestsPerSecond: 10 })
 * await limiter.acquire()
 * // Make API call
 * ```
 */
export class RateLimiter {
  /** Current number of available tokens */
  private tokens: number
  /** Maximum token capacity (burst size) */
  private readonly maxTokens: number
  /** Token refill rate per millisecond (using most restrictive rate) */
  private readonly refillRatePerMs: number
  /** Last time tokens were refilled */
  private lastRefillTime: number
  /** Queue of waiting callers (FIFO) */
  private readonly waitQueue: WaitingCaller[] = []
  /** Timer for processing the wait queue */
  private refillTimer: ReturnType<typeof setTimeout> | null = null

  constructor(config: RateLimitConfig) {
    // Validate configuration
    this.validateConfig(config)

    // Calculate the most restrictive rate (lowest tokens per millisecond)
    const rates: number[] = []

    if (config.requestsPerSecond !== undefined) {
      rates.push(config.requestsPerSecond / 1000) // tokens per ms
    }
    if (config.requestsPerMinute !== undefined) {
      rates.push(config.requestsPerMinute / 60000) // tokens per ms
    }
    if (config.requestsPerHour !== undefined) {
      rates.push(config.requestsPerHour / 3600000) // tokens per ms
    }

    // Use the most restrictive rate (smallest value), default to 1/s if not specified
    this.refillRatePerMs = rates.length > 0 ? Math.min(...rates) : 1 / 1000

    // Set burst size, default to rate per second or 1
    const defaultBurstSize = Math.ceil(this.refillRatePerMs * 1000)
    this.maxTokens = config.burstSize ?? defaultBurstSize

    // Initialize with full bucket
    this.tokens = this.maxTokens
    this.lastRefillTime = Date.now()
  }

  /**
   * Validate the rate limit configuration
   */
  private validateConfig(config: RateLimitConfig): void {
    if (config.requestsPerSecond !== undefined) {
      if (config.requestsPerSecond <= 0) {
        throw new Error('requestsPerSecond must be positive')
      }
    }
    if (config.requestsPerMinute !== undefined) {
      if (config.requestsPerMinute <= 0) {
        throw new Error('requestsPerMinute must be positive')
      }
    }
    if (config.requestsPerHour !== undefined) {
      if (config.requestsPerHour <= 0) {
        throw new Error('requestsPerHour must be positive')
      }
    }
    if (config.burstSize !== undefined) {
      if (config.burstSize <= 0) {
        throw new Error('burstSize must be positive')
      }
    }
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refillTokens(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefillTime
    const tokensToAdd = elapsed * this.refillRatePerMs

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd)
    this.lastRefillTime = now
  }

  /**
   * Process the wait queue, granting tokens to waiting callers
   */
  private processWaitQueue(): void {
    this.refillTokens()

    while (this.waitQueue.length > 0 && this.tokens >= 1) {
      const caller = this.waitQueue.shift()!
      this.tokens -= 1
      caller.resolve()
    }

    // If there are still waiting callers, schedule next check
    if (this.waitQueue.length > 0) {
      this.scheduleNextRefill()
    }
  }

  /**
   * Schedule the next token refill check
   */
  private scheduleNextRefill(): void {
    if (this.refillTimer !== null) {
      return // Already scheduled
    }

    // Calculate time until next token is available
    const tokensNeeded = 1 - this.tokens
    const msUntilToken = tokensNeeded / this.refillRatePerMs

    this.refillTimer = setTimeout(() => {
      this.refillTimer = null
      this.processWaitQueue()
    }, Math.max(1, Math.ceil(msUntilToken)))
  }

  /**
   * Acquire a token, blocking if necessary until one is available
   *
   * @returns Promise that resolves when a token is acquired
   */
  async acquire(): Promise<void> {
    this.refillTokens()

    if (this.tokens >= 1) {
      this.tokens -= 1
      return
    }

    // Add to wait queue
    return new Promise<void>((resolve) => {
      this.waitQueue.push({
        resolve,
        timestamp: Date.now(),
      })
      this.scheduleNextRefill()
    })
  }

  /**
   * Try to acquire a token without blocking
   *
   * @returns true if token was acquired, false if unavailable
   */
  tryAcquire(): boolean {
    this.refillTokens()

    if (this.tokens >= 1) {
      this.tokens -= 1
      return true
    }

    return false
  }

  /**
   * Release a token back to the bucket
   *
   * Use this when a request fails and you want to return the token,
   * or for cooperative rate limiting scenarios.
   */
  release(): void {
    this.tokens = Math.min(this.maxTokens, this.tokens + 1)

    // Process any waiting callers with the released token
    if (this.waitQueue.length > 0) {
      this.processWaitQueue()
    }
  }

  /**
   * Get the current number of available tokens
   *
   * @returns Number of immediately available tokens
   */
  getAvailableTokens(): number {
    this.refillTokens()
    return Math.floor(this.tokens)
  }

  /**
   * Get the estimated wait time for the next token
   *
   * @returns Wait time in milliseconds, or 0 if tokens are available
   */
  getWaitTime(): number {
    this.refillTokens()

    if (this.tokens >= 1) {
      return 0
    }

    const tokensNeeded = 1 - this.tokens
    return Math.ceil(tokensNeeded / this.refillRatePerMs)
  }

  /**
   * Reset the rate limiter to initial state
   *
   * Clears the wait queue and restores tokens to burst size.
   */
  reset(): void {
    this.tokens = this.maxTokens
    this.lastRefillTime = Date.now()

    // Clear wait queue by resolving all waiting callers
    while (this.waitQueue.length > 0) {
      const caller = this.waitQueue.shift()!
      caller.resolve()
    }

    // Clear any scheduled refill
    if (this.refillTimer !== null) {
      clearTimeout(this.refillTimer)
      this.refillTimer = null
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new RateLimiter instance
 *
 * @param config - Rate limit configuration
 * @returns A new RateLimiter instance
 */
export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  return new RateLimiter(config)
}
