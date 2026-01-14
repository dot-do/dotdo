/**
 * RateLimiter Types - Comprehensive Rate Limiting Primitives
 *
 * Provides types for multiple rate limiting strategies:
 * - Fixed Window: Simple time-based windows
 * - Sliding Window: Accurate sliding log algorithm
 * - Token Bucket: Classic burst-tolerant algorithm
 * - Leaky Bucket: Smooth rate enforcement
 * - Distributed: DO-coordinated multi-region limiting
 * - Quota: Period-based usage tracking
 */

/**
 * Rate limiting strategy types
 */
export type RateLimitStrategy = 'fixed-window' | 'sliding-window' | 'token-bucket' | 'leaky-bucket'

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  requests: number
  /** Time window in milliseconds */
  window: number
  /** Rate limiting strategy (default: 'fixed-window') */
  strategy?: RateLimitStrategy
}

/**
 * Result of a rate limit check or consume operation
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** Remaining requests in current window */
  remaining: number
  /** Timestamp when the limit resets (milliseconds since epoch) */
  resetAt: number
  /** Seconds to wait before retrying (0 if allowed) */
  retryAfter: number
  /** Total limit for the window */
  limit: number
  /** Current usage count */
  used: number
}

/**
 * Identifier for rate limit tracking
 */
export interface RateLimitKey {
  /** Unique identifier (e.g., user ID, IP address, API key) */
  identifier: string
  /** Optional scope for the limit (e.g., 'api', 'auth', 'upload') */
  scope?: string
  /** Optional metadata for logging/analytics */
  metadata?: Record<string, unknown>
}

/**
 * Token bucket specific configuration
 */
export interface TokenBucketConfig {
  /** Maximum tokens in the bucket (burst capacity) */
  capacity: number
  /** Tokens added per second (refill rate) */
  refillRate: number
  /** Initial tokens (defaults to capacity) */
  initialTokens?: number
}

/**
 * Token bucket state
 */
export interface TokenBucketState {
  /** Current number of tokens */
  tokens: number
  /** Last refill timestamp */
  lastRefill: number
}

/**
 * Leaky bucket specific configuration
 */
export interface LeakyBucketConfig {
  /** Maximum bucket capacity (queue size) */
  capacity: number
  /** Leak rate in requests per second */
  leakRate: number
}

/**
 * Leaky bucket state
 */
export interface LeakyBucketState {
  /** Current water level (pending requests) */
  level: number
  /** Last leak timestamp */
  lastLeak: number
}

/**
 * Sliding window log entry
 */
export interface SlidingWindowEntry {
  /** Request timestamp */
  timestamp: number
  /** Number of tokens consumed */
  tokens: number
}

/**
 * Sliding window state
 */
export interface SlidingWindowState {
  /** Log of requests in the window */
  log: SlidingWindowEntry[]
}

/**
 * Fixed window state
 */
export interface FixedWindowState {
  /** Current window count */
  count: number
  /** Window start timestamp */
  windowStart: number
}

/**
 * Quota period types
 */
export type QuotaPeriod = 'minute' | 'hour' | 'day' | 'week' | 'month'

/**
 * Quota configuration for usage limits
 */
export interface QuotaConfig {
  /** Minutely quota limit */
  minute?: number
  /** Hourly quota limit */
  hourly?: number
  /** Daily quota limit */
  daily?: number
  /** Weekly quota limit */
  weekly?: number
  /** Monthly quota limit */
  monthly?: number
}

/**
 * Quota usage status
 */
export interface QuotaStatus {
  /** Usage by period */
  usage: {
    minute?: { used: number; limit: number; remaining: number; resetAt: number }
    hourly?: { used: number; limit: number; remaining: number; resetAt: number }
    daily?: { used: number; limit: number; remaining: number; resetAt: number }
    weekly?: { used: number; limit: number; remaining: number; resetAt: number }
    monthly?: { used: number; limit: number; remaining: number; resetAt: number }
  }
  /** Whether any quota is exceeded */
  exceeded: boolean
  /** Which periods are exceeded */
  exceededPeriods: QuotaPeriod[]
}

/**
 * Distributed rate limiter configuration
 */
export interface DistributedConfig {
  /** Durable Object namespace binding name */
  doNamespace?: string
  /** Sync interval in milliseconds */
  syncInterval?: number
  /** Local burst allowance before sync */
  localBurst?: number
  /** Region-aware partitioning */
  regionAware?: boolean
  /** Replication factor for redundancy */
  replicationFactor?: number
}

/**
 * Distributed rate limiter state for coordination
 */
export interface DistributedState {
  /** Global count across all nodes */
  globalCount: number
  /** Per-region counts */
  regionCounts: Record<string, number>
  /** Last sync timestamp */
  lastSync: number
  /** Node ID */
  nodeId: string
}

/**
 * Rate limiter interface
 */
export interface IRateLimiter {
  /**
   * Check if a request would be allowed without consuming tokens
   * @param key Rate limit key
   * @returns Rate limit result
   */
  check(key: RateLimitKey | string): Promise<RateLimitResult>

  /**
   * Consume tokens and return the result
   * @param key Rate limit key
   * @param tokens Number of tokens to consume (default: 1)
   * @returns Rate limit result
   */
  consume(key: RateLimitKey | string, tokens?: number): Promise<RateLimitResult>

  /**
   * Reset the limit for a key
   * @param key Rate limit key
   */
  reset(key: RateLimitKey | string): Promise<void>

  /**
   * Get current status without modifying state
   * @param key Rate limit key
   * @returns Rate limit result
   */
  getStatus(key: RateLimitKey | string): Promise<RateLimitResult>
}

/**
 * Token bucket interface
 */
export interface ITokenBucket {
  /**
   * Try to consume tokens from the bucket
   * @param key Bucket key
   * @param tokens Number of tokens to consume
   * @returns Whether tokens were consumed
   */
  tryConsume(key: string, tokens?: number): Promise<boolean>

  /**
   * Get current token count
   * @param key Bucket key
   * @returns Current tokens and bucket state
   */
  getTokens(key: string): Promise<TokenBucketState>

  /**
   * Reset the bucket to full capacity
   * @param key Bucket key
   */
  reset(key: string): Promise<void>
}

/**
 * Leaky bucket interface
 */
export interface ILeakyBucket {
  /**
   * Add a request to the bucket
   * @param key Bucket key
   * @returns Whether the request was accepted
   */
  add(key: string): Promise<boolean>

  /**
   * Get current bucket level
   * @param key Bucket key
   * @returns Current level and bucket state
   */
  getLevel(key: string): Promise<LeakyBucketState>

  /**
   * Drain the bucket
   * @param key Bucket key
   */
  drain(key: string): Promise<void>
}

/**
 * Quota manager interface
 */
export interface IQuotaManager {
  /**
   * Check quota without consuming
   * @param key Quota key
   * @returns Quota status
   */
  check(key: string): Promise<QuotaStatus>

  /**
   * Consume quota
   * @param key Quota key
   * @param amount Amount to consume (default: 1)
   * @returns Quota status after consumption
   */
  consume(key: string, amount?: number): Promise<QuotaStatus>

  /**
   * Reset quota for specific periods
   * @param key Quota key
   * @param periods Periods to reset (defaults to all)
   */
  reset(key: string, periods?: QuotaPeriod[]): Promise<void>

  /**
   * Get current quota status
   * @param key Quota key
   * @returns Quota status
   */
  getStatus(key: string): Promise<QuotaStatus>
}

/**
 * Storage adapter interface for persistence
 */
export interface RateLimitStorage {
  /** Get value by key */
  get<T>(key: string): Promise<T | null>
  /** Set value with optional TTL in milliseconds */
  set<T>(key: string, value: T, ttl?: number): Promise<void>
  /** Delete a key */
  delete(key: string): Promise<void>
  /** List keys by prefix */
  list(prefix: string): Promise<string[]>
}

/**
 * In-memory storage implementation
 */
export interface MemoryStorageEntry<T> {
  value: T
  expiresAt?: number
}
