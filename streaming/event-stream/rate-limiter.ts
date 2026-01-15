/**
 * RateLimiter - Token bucket rate limiting for EventStreamDO
 *
 * Implements token bucket algorithm for rate limiting connections and operations.
 * Extracted from EventStreamDO as part of Wave 3 decomposition.
 *
 * @issue do-e7ke - Extract RateLimiter from EventStreamDO
 * @wave Wave 3: EventStreamDO Decomposition
 */

/**
 * Rate limit configuration per key
 */
export interface RateLimitConfig {
  /** Maximum tokens in the bucket */
  maxTokens: number
  /** Tokens added per second */
  refillRate: number
  /** Refill interval in milliseconds */
  refillIntervalMs: number
}

/**
 * Rate limit status for a key
 */
export interface RateLimitStatus {
  /** Current tokens remaining */
  remaining: number
  /** Maximum tokens allowed */
  limit: number
  /** When the bucket will be full (Unix ms) */
  resetAt: number
  /** Whether currently rate limited */
  isLimited: boolean
}

/**
 * IRateLimiter - Interface for token bucket rate limiting
 */
export interface IRateLimiter {
  tryAcquire(key: string, cost?: number): boolean
  getRemainingTokens(key: string): number
  reset(key: string): void
  getStatus(key: string): RateLimitStatus
  configure(key: string, config: Partial<RateLimitConfig>): void
  setDefaults(config: RateLimitConfig): void
  cleanup(maxIdleMs?: number): number
}

interface Bucket {
  tokens: number
  lastRefill: number
  config: RateLimitConfig
  lastAccess: number
}

/**
 * RateLimiter - Token bucket implementation
 *
 * Features:
 * - Per-key rate limiting with configurable limits
 * - Token refill over time
 * - Support for different costs per operation
 * - Memory cleanup for inactive keys
 */
export class RateLimiter implements IRateLimiter {
  private buckets: Map<string, Bucket> = new Map()
  private defaultConfig: RateLimitConfig = {
    maxTokens: 100,
    refillRate: 10,
    refillIntervalMs: 1000,
  }

  /**
   * Create a new RateLimiter
   * @param config - Optional default configuration
   */
  constructor(config?: Partial<RateLimitConfig>) {
    if (config) {
      this.defaultConfig = { ...this.defaultConfig, ...config }
    }
  }

  /**
   * Try to acquire tokens for an operation
   * @param key - Rate limit key (e.g., connection ID)
   * @param cost - Number of tokens to consume (default: 1)
   * @returns true if tokens acquired, false if rate limited
   */
  tryAcquire(key: string, cost: number = 1): boolean {
    // Handle zero or negative cost
    if (cost <= 0) {
      // Still touch the bucket for access tracking
      this.getBucket(key)
      return true
    }

    this.refill(key)
    const bucket = this.getBucket(key)
    bucket.lastAccess = Date.now()

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost
      return true
    }
    return false
  }

  /**
   * Get remaining tokens for a key
   */
  getRemainingTokens(key: string): number {
    this.refill(key)
    return this.getBucket(key).tokens
  }

  /**
   * Reset rate limit for a key (e.g., on disconnect)
   */
  reset(key: string): void {
    const bucket = this.getBucket(key)
    bucket.tokens = bucket.config.maxTokens
    bucket.lastRefill = Date.now()
    bucket.lastAccess = Date.now()
  }

  /**
   * Get full rate limit status for a key
   */
  getStatus(key: string): RateLimitStatus {
    this.refill(key)
    const bucket = this.getBucket(key)
    const tokensNeeded = bucket.config.maxTokens - bucket.tokens

    // Calculate time to refill based on discrete intervals
    // Each interval adds refillRate tokens
    const intervalsNeeded = Math.ceil(tokensNeeded / bucket.config.refillRate)
    const timeToRefill = intervalsNeeded * bucket.config.refillIntervalMs

    return {
      remaining: bucket.tokens,
      limit: bucket.config.maxTokens,
      resetAt: bucket.lastRefill + timeToRefill,
      isLimited: bucket.tokens <= 0,
    }
  }

  /**
   * Configure rate limits for a specific key
   * (for per-user or per-tier limits)
   */
  configure(key: string, config: Partial<RateLimitConfig>): void {
    const bucket = this.getBucket(key)
    const oldMax = bucket.config.maxTokens
    bucket.config = { ...bucket.config, ...config }

    // If maxTokens increased, add the difference
    if (config.maxTokens !== undefined && config.maxTokens > oldMax) {
      bucket.tokens = config.maxTokens
    }
    // If maxTokens is being set and bucket is fresh, set tokens to new max
    if (config.maxTokens !== undefined && bucket.tokens === oldMax) {
      bucket.tokens = config.maxTokens
    }
  }

  /**
   * Set default configuration for new keys
   */
  setDefaults(config: RateLimitConfig): void {
    this.defaultConfig = { ...this.defaultConfig, ...config }
  }

  /**
   * Clean up expired/inactive keys (memory management)
   * @param maxIdleMs - Maximum idle time before cleanup (default: 1 hour)
   * @returns Number of keys removed
   */
  cleanup(maxIdleMs: number = 60 * 60 * 1000): number {
    const now = Date.now()
    let cleaned = 0

    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastAccess > maxIdleMs) {
        this.buckets.delete(key)
        cleaned++
      }
    }

    return cleaned
  }

  /**
   * Get or create a bucket for a key
   */
  private getBucket(key: string): Bucket {
    if (!this.buckets.has(key)) {
      const now = Date.now()
      this.buckets.set(key, {
        tokens: this.defaultConfig.maxTokens,
        lastRefill: now,
        lastAccess: now,
        config: { ...this.defaultConfig },
      })
    }
    return this.buckets.get(key)!
  }

  /**
   * Refill tokens based on elapsed time using discrete intervals
   *
   * Tokens are added in discrete chunks: refillRate tokens per refillIntervalMs.
   * This means if refillRate=10 and refillIntervalMs=1000:
   * - At 500ms elapsed: 0 tokens added (no complete interval)
   * - At 1000ms elapsed: 10 tokens added (one complete interval)
   * - At 2500ms elapsed: 20 tokens added (two complete intervals)
   */
  private refill(key: string): void {
    const bucket = this.getBucket(key)
    const now = Date.now()
    const elapsed = now - bucket.lastRefill

    // Calculate complete intervals that have passed
    const completeIntervals = Math.floor(elapsed / bucket.config.refillIntervalMs)

    if (completeIntervals > 0) {
      // Add tokens for each complete interval
      const tokensToAdd = completeIntervals * bucket.config.refillRate
      bucket.tokens = Math.min(bucket.tokens + tokensToAdd, bucket.config.maxTokens)
      // Update lastRefill to account for complete intervals only
      bucket.lastRefill = bucket.lastRefill + (completeIntervals * bucket.config.refillIntervalMs)
    }
  }
}
