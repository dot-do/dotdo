/**
 * RPC Rate Limiter
 *
 * Prevents DoS attacks via excessive RPC requests.
 * Implements a sliding window rate limiter with configurable
 * limits and behaviors.
 *
 * @packageDocumentation
 */

import type {
  ShellApi,
  ShellStream,
  ShellResult,
  ShellExecOptions,
  ShellSpawnOptions,
} from '../../core/rpc/types.js'

// ============================================================================
// Rate Limit Configuration
// ============================================================================

/**
 * Configuration options for the rate limiter.
 */
export interface RateLimitConfig {
  /** Maximum requests per window */
  maxRequests: number

  /** Window size in milliseconds (default: 1000ms = 1 second) */
  windowMs?: number

  /** What to do when limit exceeded */
  onLimitExceeded?: 'throw' | 'queue' | 'drop'

  /** Custom error message */
  errorMessage?: string
}

/**
 * Statistics tracked by the rate limiter.
 */
export interface RateLimitStats {
  /** Requests in current window */
  currentRequests: number

  /** Timestamp when current window started */
  windowStart: number

  /** Total requests processed (all time) */
  totalRequests: number

  /** Total requests rejected due to rate limiting */
  totalRejected: number
}

// ============================================================================
// Rate Limit Error
// ============================================================================

import { BashxRateLimitError as UnifiedRateLimitError } from '../errors/bashx-error.js'

/**
 * Error thrown when rate limit is exceeded.
 *
 * This class extends BashxRateLimitError for unified error handling
 * while maintaining backward compatibility with the original API.
 *
 * @deprecated Use BashxRateLimitError from '../errors/bashx-error.js' for new code.
 */
export class RateLimitError extends UnifiedRateLimitError {
  readonly stats: RateLimitStats

  constructor(message: string, stats: RateLimitStats) {
    super(message, {
      limit: stats.currentRequests, // Use current as limit for backward compat
      remaining: 0,
      windowStart: stats.windowStart,
      totalRequests: stats.totalRequests,
      totalRejected: stats.totalRejected,
      provider: 'rpc',
    })
    this.name = 'RateLimitError'
    this.stats = stats
  }
}

// ============================================================================
// RateLimiter Class
// ============================================================================

/**
 * Sliding window rate limiter.
 *
 * Tracks requests within a time window and enforces limits.
 * Window resets after the configured windowMs period.
 *
 * @example
 * ```typescript
 * const limiter = new RateLimiter({
 *   maxRequests: 100,
 *   windowMs: 1000,
 *   onLimitExceeded: 'throw'
 * })
 *
 * if (limiter.allow()) {
 *   // Process request
 * }
 *
 * // Or throw on limit
 * limiter.acquire() // Throws if rate limited
 * ```
 */
export class RateLimiter {
  private currentRequests = 0
  private windowStart = Date.now()
  private totalRequests = 0
  private totalRejected = 0

  private readonly maxRequests: number
  private readonly windowMs: number
  private readonly onLimitExceeded: 'throw' | 'queue' | 'drop'
  private readonly errorMessage: string

  constructor(config: RateLimitConfig) {
    this.maxRequests = config.maxRequests
    this.windowMs = config.windowMs ?? 1000
    this.onLimitExceeded = config.onLimitExceeded ?? 'throw'
    this.errorMessage = config.errorMessage ?? 'Rate limit exceeded'
  }

  /**
   * Check if request is allowed within rate limit.
   *
   * @returns true if request is allowed, false if rate limited
   */
  allow(): boolean {
    this.resetWindowIfExpired()

    if (this.currentRequests >= this.maxRequests) {
      this.totalRejected++
      return false
    }

    this.currentRequests++
    this.totalRequests++
    return true
  }

  /**
   * Acquire a request slot.
   *
   * Behavior depends on onLimitExceeded config:
   * - 'throw': Throws RateLimitError when limit exceeded
   * - 'drop': Silently returns without acquiring
   * - 'queue': Reserved for future queuing implementation
   *
   * @throws {RateLimitError} When onLimitExceeded is 'throw' and limit exceeded
   */
  acquire(): void {
    if (!this.allow()) {
      if (this.onLimitExceeded === 'throw') {
        throw new RateLimitError(this.errorMessage, this.getStats())
      }
      // For 'drop', silently return without error
      // For 'queue', future implementation would queue the request
    }
  }

  /**
   * Release a request slot.
   *
   * Note: Currently a no-op. Reserved for future concurrent
   * request tracking if needed.
   */
  release(): void {
    // No-op for now
    // Could be used for tracking concurrent vs sequential requests
  }

  /**
   * Get current rate limit statistics.
   *
   * @returns Current stats including request counts and window info
   */
  getStats(): RateLimitStats {
    this.resetWindowIfExpired()
    return {
      currentRequests: this.currentRequests,
      windowStart: this.windowStart,
      totalRequests: this.totalRequests,
      totalRejected: this.totalRejected,
    }
  }

  /**
   * Reset the rate limiter to initial state.
   * Useful for testing or explicit reset scenarios.
   */
  reset(): void {
    this.currentRequests = 0
    this.windowStart = Date.now()
    this.totalRequests = 0
    this.totalRejected = 0
  }

  /**
   * Check remaining requests in current window.
   *
   * @returns Number of requests remaining before rate limit
   */
  remaining(): number {
    this.resetWindowIfExpired()
    return Math.max(0, this.maxRequests - this.currentRequests)
  }

  /**
   * Reset the window if it has expired.
   */
  private resetWindowIfExpired(): void {
    const now = Date.now()
    if (now - this.windowStart >= this.windowMs) {
      this.currentRequests = 0
      this.windowStart = now
    }
  }
}

// ============================================================================
// RateLimitedShellApi Wrapper
// ============================================================================

/**
 * ShellApi wrapper that applies rate limiting to all operations.
 *
 * Wraps an existing ShellApi implementation and enforces rate limits
 * on exec() and spawn() calls.
 *
 * @example
 * ```typescript
 * const api = new ShellApiImpl()
 * const rateLimited = new RateLimitedShellApi(api, {
 *   maxRequests: 100,
 *   windowMs: 1000,
 *   onLimitExceeded: 'throw'
 * })
 *
 * // Use like normal ShellApi
 * const result = await rateLimited.exec('ls -la')
 * ```
 */
export class RateLimitedShellApi implements ShellApi {
  private readonly limiter: RateLimiter
  private readonly api: ShellApi

  constructor(api: ShellApi, config: RateLimitConfig) {
    this.api = api
    this.limiter = new RateLimiter(config)
  }

  /**
   * Execute a command with rate limiting.
   *
   * @param command - The shell command to execute
   * @param options - Execution options
   * @returns Promise resolving to the command result
   * @throws {RateLimitError} If rate limit exceeded and onLimitExceeded is 'throw'
   */
  async exec(command: string, options?: ShellExecOptions): Promise<ShellResult> {
    this.limiter.acquire()
    return this.api.exec(command, options)
  }

  /**
   * Spawn a process with rate limiting.
   *
   * @param command - The shell command to spawn
   * @param options - Spawn options
   * @returns ShellStream handle for process interaction
   * @throws {RateLimitError} If rate limit exceeded and onLimitExceeded is 'throw'
   */
  spawn(command: string, options?: ShellSpawnOptions): ShellStream {
    this.limiter.acquire()
    return this.api.spawn(command, options)
  }

  /**
   * Get the rate limiter's current statistics.
   *
   * @returns Rate limit statistics
   */
  getStats(): RateLimitStats {
    return this.limiter.getStats()
  }

  /**
   * Get remaining requests in current window.
   *
   * @returns Number of requests remaining before rate limit
   */
  remaining(): number {
    return this.limiter.remaining()
  }

  /**
   * Reset the rate limiter.
   */
  reset(): void {
    this.limiter.reset()
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a rate-limited wrapper for any ShellApi.
 *
 * @param api - The ShellApi to wrap
 * @param config - Rate limit configuration
 * @returns Rate-limited ShellApi wrapper
 *
 * @example
 * ```typescript
 * import { createShellApi } from './shell-api-impl.js'
 * import { withRateLimit } from './rate-limiter.js'
 *
 * const api = createShellApi()
 * const rateLimited = withRateLimit(api, {
 *   maxRequests: 100,
 *   windowMs: 1000
 * })
 * ```
 */
export function withRateLimit(api: ShellApi, config: RateLimitConfig): RateLimitedShellApi {
  return new RateLimitedShellApi(api, config)
}

/**
 * Create a standalone rate limiter.
 *
 * @param config - Rate limit configuration
 * @returns New RateLimiter instance
 */
export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  return new RateLimiter(config)
}
