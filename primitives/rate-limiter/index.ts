/**
 * @module rate-limiter
 *
 * Rate Limiter Primitive - Comprehensive rate limiting for the dotdo platform.
 *
 * Provides multiple rate limiting algorithms to protect APIs from abuse,
 * enforce fair usage policies, and maintain service stability. All limiters
 * support pluggable storage backends for edge and Durable Object deployment.
 *
 * ## Algorithms
 *
 * - **FixedWindow** - Simple counter reset at window boundaries
 * - **SlidingWindow** - Accurate sliding log with timestamp tracking
 * - **TokenBucket** - Burst-tolerant with configurable refill rates
 * - **LeakyBucket** - Smooth, constant-rate output enforcement
 * - **DistributedRateLimiter** - Multi-region coordination via Durable Objects
 * - **QuotaManager** - Period-based limits (minute/hour/day/week/month)
 *
 * @example Basic Rate Limiting
 * ```typescript
 * import { createRateLimiter, MemoryStorage } from 'dotdo/primitives/rate-limiter'
 *
 * // 100 requests per minute per user
 * const limiter = createRateLimiter({
 *   requests: 100,
 *   window: 60000,
 *   strategy: 'sliding-window',
 * })
 *
 * const result = await limiter.consume(`user:${userId}`)
 * if (!result.allowed) {
 *   return new Response('Too Many Requests', {
 *     status: 429,
 *     headers: {
 *       'Retry-After': String(result.retryAfter),
 *       'X-RateLimit-Limit': String(result.limit),
 *       'X-RateLimit-Remaining': String(result.remaining),
 *     },
 *   })
 * }
 * ```
 *
 * @example Token Bucket for Burst Traffic
 * ```typescript
 * import { createTokenBucket } from 'dotdo/primitives/rate-limiter'
 *
 * // Allow bursts of 10, refill 1 token/second
 * const bucket = createTokenBucket({
 *   capacity: 10,
 *   refillRate: 1,
 * })
 *
 * const allowed = await bucket.tryConsume('api-key:abc123')
 * ```
 *
 * @example Multi-Period Quotas
 * ```typescript
 * import { createQuotaManager } from 'dotdo/primitives/rate-limiter'
 *
 * const quota = createQuotaManager({
 *   minute: 10,
 *   hourly: 100,
 *   daily: 1000,
 * })
 *
 * const status = await quota.consume('tenant:acme')
 * if (status.exceeded) {
 *   console.log('Exceeded periods:', status.exceededPeriods)
 * }
 * ```
 *
 * @example Distributed Rate Limiting
 * ```typescript
 * import { DistributedRateLimiter } from 'dotdo/primitives/rate-limiter'
 *
 * const limiter = new DistributedRateLimiter(
 *   { requests: 1000, window: 60000 },
 *   { syncInterval: 1000, localBurst: 10 },
 *   doStorage,
 *   'worker-us-east',
 *   'us-east-1'
 * )
 * ```
 *
 * @packageDocumentation
 */

export * from './types'

import type {
  RateLimitConfig,
  RateLimitResult,
  RateLimitKey,
  TokenBucketConfig,
  TokenBucketState,
  LeakyBucketConfig,
  LeakyBucketState,
  QuotaConfig,
  QuotaStatus,
  QuotaPeriod,
  DistributedConfig,
  RateLimitStorage,
  FixedWindowState,
  SlidingWindowState,
  SlidingWindowEntry,
  IRateLimiter,
  ITokenBucket,
  ILeakyBucket,
  IQuotaManager,
  MemoryStorageEntry,
} from './types'

// =============================================================================
// Memory Storage Implementation
// =============================================================================

/**
 * In-memory storage implementation for rate limiting
 */
export class MemoryStorage implements RateLimitStorage {
  private store = new Map<string, MemoryStorageEntry<unknown>>()

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key)
    if (!entry) return null

    // Check TTL expiration
    if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
      this.store.delete(key)
      return null
    }

    return entry.value as T
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const entry: MemoryStorageEntry<T> = {
      value,
      expiresAt: ttl ? Date.now() + ttl : undefined,
    }
    this.store.set(key, entry)
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = []
    this.store.forEach((entry, key) => {
      if (key.startsWith(prefix)) {
        // Check expiration before including
        if (entry.expiresAt === undefined || Date.now() < entry.expiresAt) {
          keys.push(key)
        }
      }
    })
    return keys
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Normalize a RateLimitKey to a string
 */
function normalizeKey(key: RateLimitKey | string): string {
  if (typeof key === 'string') return key
  return key.scope ? `${key.identifier}:${key.scope}` : key.identifier
}

// =============================================================================
// Fixed Window Rate Limiter
// =============================================================================

/**
 * Fixed window rate limiter
 * Counts requests within fixed time windows
 */
export class FixedWindow implements IRateLimiter {
  constructor(
    private config: RateLimitConfig,
    private storage: RateLimitStorage
  ) {}

  private getStorageKey(key: string): string {
    return `fw:${key}`
  }

  async check(key: RateLimitKey | string): Promise<RateLimitResult> {
    const normalizedKey = normalizeKey(key)
    const storageKey = this.getStorageKey(normalizedKey)
    const now = Date.now()

    const state = await this.storage.get<FixedWindowState>(storageKey)

    let count = 0
    let windowStart = now

    if (state) {
      // Check if still in same window
      if (now < state.windowStart + this.config.window) {
        count = state.count
        windowStart = state.windowStart
      }
    }

    const resetAt = windowStart + this.config.window
    const remaining = Math.max(0, this.config.requests - count)
    const allowed = count < this.config.requests

    return {
      allowed,
      remaining,
      resetAt,
      retryAfter: allowed ? 0 : Math.ceil((resetAt - now) / 1000),
      limit: this.config.requests,
      used: count,
    }
  }

  async consume(key: RateLimitKey | string, tokens: number = 1): Promise<RateLimitResult> {
    const normalizedKey = normalizeKey(key)
    const storageKey = this.getStorageKey(normalizedKey)
    const now = Date.now()

    // Handle zero token consumption
    if (tokens === 0) {
      return this.check(key)
    }

    const state = await this.storage.get<FixedWindowState>(storageKey)

    let count = 0
    let windowStart = now

    if (state) {
      // Check if still in same window
      if (now < state.windowStart + this.config.window) {
        count = state.count
        windowStart = state.windowStart
      }
    }

    const resetAt = windowStart + this.config.window
    const allowed = count + tokens <= this.config.requests

    if (allowed) {
      count += tokens
      await this.storage.set<FixedWindowState>(
        storageKey,
        { count, windowStart },
        this.config.window
      )
    }

    const remaining = Math.max(0, this.config.requests - count)

    return {
      allowed,
      remaining,
      resetAt,
      retryAfter: allowed ? 0 : Math.ceil((resetAt - now) / 1000),
      limit: this.config.requests,
      used: count,
    }
  }

  async reset(key: RateLimitKey | string): Promise<void> {
    const normalizedKey = normalizeKey(key)
    const storageKey = this.getStorageKey(normalizedKey)
    await this.storage.delete(storageKey)
  }

  async getStatus(key: RateLimitKey | string): Promise<RateLimitResult> {
    return this.check(key)
  }
}

// =============================================================================
// Sliding Window Rate Limiter
// =============================================================================

/**
 * Sliding window rate limiter
 * Uses a log of timestamps for precise rate limiting
 */
export class SlidingWindow implements IRateLimiter {
  constructor(
    private config: RateLimitConfig,
    private storage: RateLimitStorage
  ) {}

  private getStorageKey(key: string): string {
    return `sw:${key}`
  }

  private cleanLog(log: SlidingWindowEntry[], now: number): SlidingWindowEntry[] {
    const cutoff = now - this.config.window
    return log.filter(entry => entry.timestamp > cutoff)
  }

  private countTokens(log: SlidingWindowEntry[]): number {
    return log.reduce((sum, entry) => sum + entry.tokens, 0)
  }

  async check(key: RateLimitKey | string): Promise<RateLimitResult> {
    const normalizedKey = normalizeKey(key)
    const storageKey = this.getStorageKey(normalizedKey)
    const now = Date.now()

    const state = await this.storage.get<SlidingWindowState>(storageKey)
    const cleanedLog = state ? this.cleanLog(state.log, now) : []
    const used = this.countTokens(cleanedLog)
    const remaining = Math.max(0, this.config.requests - used)
    const allowed = used < this.config.requests

    // Reset time is when the oldest entry in the log expires (or now + window if empty)
    const oldestEntry = cleanedLog[0]
    const resetAt = oldestEntry ? oldestEntry.timestamp + this.config.window : now + this.config.window

    return {
      allowed,
      remaining,
      resetAt,
      retryAfter: allowed ? 0 : Math.ceil((resetAt - now) / 1000),
      limit: this.config.requests,
      used,
    }
  }

  async consume(key: RateLimitKey | string, tokens: number = 1): Promise<RateLimitResult> {
    const normalizedKey = normalizeKey(key)
    const storageKey = this.getStorageKey(normalizedKey)
    const now = Date.now()

    // Handle zero token consumption
    if (tokens === 0) {
      return this.check(key)
    }

    const state = await this.storage.get<SlidingWindowState>(storageKey)
    const cleanedLog = state ? this.cleanLog(state.log, now) : []
    const used = this.countTokens(cleanedLog)
    const allowed = used + tokens <= this.config.requests

    if (allowed) {
      cleanedLog.push({ timestamp: now, tokens })
      await this.storage.set<SlidingWindowState>(
        storageKey,
        { log: cleanedLog },
        this.config.window * 2 // Keep for 2x window to handle edge cases
      )
    }

    const finalUsed = allowed ? used + tokens : used
    const remaining = Math.max(0, this.config.requests - finalUsed)

    // Reset time is when the oldest entry in the log expires
    const oldestEntry = cleanedLog[0]
    const resetAt = oldestEntry ? oldestEntry.timestamp + this.config.window : now + this.config.window

    return {
      allowed,
      remaining,
      resetAt,
      retryAfter: allowed ? 0 : Math.ceil((resetAt - now) / 1000),
      limit: this.config.requests,
      used: finalUsed,
    }
  }

  async reset(key: RateLimitKey | string): Promise<void> {
    const normalizedKey = normalizeKey(key)
    const storageKey = this.getStorageKey(normalizedKey)
    await this.storage.delete(storageKey)
  }

  async getStatus(key: RateLimitKey | string): Promise<RateLimitResult> {
    return this.check(key)
  }
}

// =============================================================================
// Token Bucket Rate Limiter
// =============================================================================

/**
 * Token bucket rate limiter
 * Allows burst traffic while maintaining average rate
 */
export class TokenBucket implements ITokenBucket {
  constructor(
    private config: TokenBucketConfig,
    private storage: RateLimitStorage
  ) {}

  private getStorageKey(key: string): string {
    return `tb:${key}`
  }

  private refillTokens(state: TokenBucketState, now: number): TokenBucketState {
    const elapsed = (now - state.lastRefill) / 1000 // seconds
    const tokensToAdd = elapsed * this.config.refillRate
    const newTokens = Math.min(this.config.capacity, state.tokens + tokensToAdd)

    return {
      tokens: newTokens,
      lastRefill: now,
    }
  }

  async getTokens(key: string): Promise<TokenBucketState> {
    const storageKey = this.getStorageKey(key)
    const now = Date.now()

    const state = await this.storage.get<TokenBucketState>(storageKey)

    if (!state) {
      // Initialize with configured initial tokens or full capacity
      const initialTokens = this.config.initialTokens ?? this.config.capacity
      return { tokens: initialTokens, lastRefill: now }
    }

    // Refill tokens based on elapsed time
    return this.refillTokens(state, now)
  }

  async tryConsume(key: string, tokens: number = 1): Promise<boolean> {
    const storageKey = this.getStorageKey(key)
    const now = Date.now()

    let state = await this.storage.get<TokenBucketState>(storageKey)

    if (!state) {
      // Initialize with configured initial tokens or full capacity
      const initialTokens = this.config.initialTokens ?? this.config.capacity
      state = { tokens: initialTokens, lastRefill: now }
    } else {
      state = this.refillTokens(state, now)
    }

    if (state.tokens >= tokens) {
      state.tokens -= tokens
      await this.storage.set(storageKey, state)
      return true
    }

    // Not enough tokens - save the refilled state but don't consume
    await this.storage.set(storageKey, state)
    return false
  }

  async reset(key: string): Promise<void> {
    const storageKey = this.getStorageKey(key)
    const now = Date.now()

    await this.storage.set<TokenBucketState>(storageKey, {
      tokens: this.config.capacity,
      lastRefill: now,
    })
  }
}

// =============================================================================
// Leaky Bucket Rate Limiter
// =============================================================================

/**
 * Leaky bucket rate limiter
 * Enforces smooth, constant rate output
 */
export class LeakyBucket implements ILeakyBucket {
  constructor(
    private config: LeakyBucketConfig,
    private storage: RateLimitStorage
  ) {}

  private getStorageKey(key: string): string {
    return `lb:${key}`
  }

  private drainBucket(state: LeakyBucketState, now: number): LeakyBucketState {
    const elapsed = (now - state.lastLeak) / 1000 // seconds
    const drained = elapsed * this.config.leakRate
    const newLevel = Math.max(0, state.level - drained)

    return {
      level: newLevel,
      lastLeak: now,
    }
  }

  async getLevel(key: string): Promise<LeakyBucketState> {
    const storageKey = this.getStorageKey(key)
    const now = Date.now()

    const state = await this.storage.get<LeakyBucketState>(storageKey)

    if (!state) {
      return { level: 0, lastLeak: now }
    }

    return this.drainBucket(state, now)
  }

  async add(key: string): Promise<boolean> {
    const storageKey = this.getStorageKey(key)
    const now = Date.now()

    let state = await this.storage.get<LeakyBucketState>(storageKey)

    if (!state) {
      state = { level: 0, lastLeak: now }
    } else {
      state = this.drainBucket(state, now)
    }

    if (state.level < this.config.capacity) {
      state.level += 1
      await this.storage.set(storageKey, state)
      return true
    }

    // Bucket full - save the drained state
    await this.storage.set(storageKey, state)
    return false
  }

  async drain(key: string): Promise<void> {
    const storageKey = this.getStorageKey(key)
    const now = Date.now()

    await this.storage.set<LeakyBucketState>(storageKey, {
      level: 0,
      lastLeak: now,
    })
  }
}

// =============================================================================
// Unified Rate Limiter
// =============================================================================

/**
 * Unified rate limiter with strategy selection
 */
export class RateLimiter implements IRateLimiter {
  private implementation: IRateLimiter

  constructor(
    config: RateLimitConfig,
    storage: RateLimitStorage
  ) {
    const strategy = config.strategy ?? 'fixed-window'

    switch (strategy) {
      case 'sliding-window':
        this.implementation = new SlidingWindow(config, storage)
        break
      case 'fixed-window':
      default:
        this.implementation = new FixedWindow(config, storage)
        break
    }
  }

  check(key: RateLimitKey | string): Promise<RateLimitResult> {
    return this.implementation.check(key)
  }

  consume(key: RateLimitKey | string, tokens?: number): Promise<RateLimitResult> {
    return this.implementation.consume(key, tokens)
  }

  reset(key: RateLimitKey | string): Promise<void> {
    return this.implementation.reset(key)
  }

  getStatus(key: RateLimitKey | string): Promise<RateLimitResult> {
    return this.implementation.getStatus(key)
  }
}

// =============================================================================
// Distributed Rate Limiter
// =============================================================================

/**
 * Distributed rate limiter with DO coordination
 */
export class DistributedRateLimiter implements IRateLimiter {
  private localLimiter: RateLimiter
  private localCount = 0
  private lastSync = 0

  constructor(
    private config: RateLimitConfig,
    private distributedConfig: DistributedConfig,
    private storage: RateLimitStorage,
    private nodeId: string = `node-${Date.now()}`,
    private region?: string
  ) {
    this.localLimiter = new RateLimiter(config, storage)
  }

  private getGlobalKey(key: string): string {
    return `dist:global:${key}`
  }

  private getRegionKey(key: string, region: string): string {
    return `dist:region:${region}:${key}`
  }

  private shouldSync(): boolean {
    const now = Date.now()
    const syncInterval = this.distributedConfig.syncInterval ?? 1000
    return now - this.lastSync >= syncInterval
  }

  async check(key: RateLimitKey | string): Promise<RateLimitResult> {
    return this.getStatus(key)
  }

  async consume(key: RateLimitKey | string, tokens: number = 1): Promise<RateLimitResult> {
    const normalizedKey = typeof key === 'string' ? key : key.identifier

    // Check local burst allowance
    const localBurst = this.distributedConfig.localBurst ?? 0
    if (this.localCount < localBurst) {
      this.localCount += tokens
    }

    // Sync if needed
    if (this.shouldSync()) {
      await this.syncGlobalCount(normalizedKey)
    }

    // Use local limiter for actual rate limiting
    return this.localLimiter.consume(key, tokens)
  }

  async reset(key: RateLimitKey | string): Promise<void> {
    const normalizedKey = typeof key === 'string' ? key : key.identifier
    await this.storage.delete(this.getGlobalKey(normalizedKey))
    this.localCount = 0
    return this.localLimiter.reset(key)
  }

  async getStatus(key: RateLimitKey | string): Promise<RateLimitResult> {
    const normalizedKey = typeof key === 'string' ? key : key.identifier

    // Get global count
    const globalCount = await this.storage.get<number>(this.getGlobalKey(normalizedKey)) ?? 0

    // Combine with local limiter status
    const localStatus = await this.localLimiter.getStatus(key)

    return {
      ...localStatus,
      used: globalCount + this.localCount,
      remaining: Math.max(0, this.config.requests - (globalCount + this.localCount)),
      allowed: (globalCount + this.localCount) < this.config.requests,
    }
  }

  private async syncGlobalCount(key: string): Promise<void> {
    const globalKey = this.getGlobalKey(key)

    // Get current global count
    const currentGlobal = await this.storage.get<number>(globalKey) ?? 0

    // Add local count to global
    const newGlobal = currentGlobal + this.localCount
    await this.storage.set(globalKey, newGlobal, this.config.window)

    // Reset local count and update sync time
    this.localCount = 0
    this.lastSync = Date.now()
  }
}

// =============================================================================
// Quota Manager
// =============================================================================

/**
 * Period durations in milliseconds
 */
const PERIOD_DURATIONS: Record<QuotaPeriod, number> = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000, // Approximate
}

/**
 * Quota state for a single period
 */
interface QuotaPeriodState {
  used: number
  periodStart: number
}

/**
 * Quota manager for period-based usage tracking
 */
// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a rate limiter with the specified strategy
 *
 * @example
 * ```ts
 * // Basic fixed window rate limiter
 * const limiter = createRateLimiter({ requests: 100, window: 60000 })
 *
 * // Sliding window for more accuracy
 * const slidingLimiter = createRateLimiter({
 *   requests: 100,
 *   window: 60000,
 *   strategy: 'sliding-window'
 * })
 *
 * // Check and consume
 * const result = await limiter.consume('user:123')
 * if (!result.allowed) {
 *   // Set Retry-After header
 *   res.setHeader('Retry-After', result.retryAfter)
 * }
 * ```
 */
export function createRateLimiter(
  config: RateLimitConfig,
  storage?: RateLimitStorage
): RateLimiter {
  return new RateLimiter(config, storage ?? new MemoryStorage())
}

/**
 * Create a token bucket rate limiter
 *
 * @example
 * ```ts
 * const bucket = createTokenBucket({
 *   capacity: 10,      // Max burst
 *   refillRate: 1,     // 1 token/second
 * })
 *
 * const allowed = await bucket.tryConsume('user:123')
 * ```
 */
export function createTokenBucket(
  config: TokenBucketConfig,
  storage?: RateLimitStorage
): TokenBucket {
  return new TokenBucket(config, storage ?? new MemoryStorage())
}

/**
 * Create a leaky bucket rate limiter
 *
 * @example
 * ```ts
 * const bucket = createLeakyBucket({
 *   capacity: 10,   // Queue size
 *   leakRate: 2,    // 2 requests/second drain
 * })
 *
 * const accepted = await bucket.add('user:123')
 * ```
 */
export function createLeakyBucket(
  config: LeakyBucketConfig,
  storage?: RateLimitStorage
): LeakyBucket {
  return new LeakyBucket(config, storage ?? new MemoryStorage())
}

/**
 * Create a quota manager for period-based limits
 *
 * @example
 * ```ts
 * const quota = createQuotaManager({
 *   minute: 10,
 *   hourly: 100,
 *   daily: 1000,
 * })
 *
 * const status = await quota.consume('user:123')
 * if (status.exceeded) {
 *   console.log('Exceeded periods:', status.exceededPeriods)
 * }
 * ```
 */
export function createQuotaManager(
  config: QuotaConfig,
  storage?: RateLimitStorage
): QuotaManager {
  return new QuotaManager(config, storage ?? new MemoryStorage())
}

export class QuotaManager implements IQuotaManager {
  constructor(
    private config: QuotaConfig,
    private storage: RateLimitStorage
  ) {}

  private getStorageKey(key: string, period: QuotaPeriod): string {
    return `quota:${key}:${period}`
  }

  private getPeriodDuration(period: QuotaPeriod): number {
    return PERIOD_DURATIONS[period]
  }

  private getConfiguredPeriods(): QuotaPeriod[] {
    const periods: QuotaPeriod[] = []
    if (this.config.minute !== undefined) periods.push('minute')
    if (this.config.hourly !== undefined) periods.push('hour')
    if (this.config.daily !== undefined) periods.push('day')
    if (this.config.weekly !== undefined) periods.push('week')
    if (this.config.monthly !== undefined) periods.push('month')
    return periods
  }

  private getLimitForPeriod(period: QuotaPeriod): number {
    switch (period) {
      case 'minute': return this.config.minute ?? 0
      case 'hour': return this.config.hourly ?? 0
      case 'day': return this.config.daily ?? 0
      case 'week': return this.config.weekly ?? 0
      case 'month': return this.config.monthly ?? 0
    }
  }

  private async getPeriodState(key: string, period: QuotaPeriod, now: number): Promise<QuotaPeriodState> {
    const storageKey = this.getStorageKey(key, period)
    const duration = this.getPeriodDuration(period)

    const state = await this.storage.get<QuotaPeriodState>(storageKey)

    if (!state) {
      return { used: 0, periodStart: now }
    }

    // Check if period has expired
    if (now >= state.periodStart + duration) {
      return { used: 0, periodStart: now }
    }

    return state
  }

  async check(key: string): Promise<QuotaStatus> {
    return this.buildStatus(key, false)
  }

  async consume(key: string, amount: number = 1): Promise<QuotaStatus> {
    const now = Date.now()
    const periods = this.getConfiguredPeriods()

    // First, check if any quota would be exceeded
    for (const period of periods) {
      const state = await this.getPeriodState(key, period, now)
      const limit = this.getLimitForPeriod(period)

      if (state.used + amount > limit) {
        // Return status without incrementing
        return this.buildStatus(key, false)
      }
    }

    // All quotas have room, increment all periods
    for (const period of periods) {
      const storageKey = this.getStorageKey(key, period)
      const duration = this.getPeriodDuration(period)
      const state = await this.getPeriodState(key, period, now)

      await this.storage.set<QuotaPeriodState>(
        storageKey,
        { used: state.used + amount, periodStart: state.periodStart },
        duration
      )
    }

    return this.buildStatus(key, true)
  }

  async reset(key: string, periods?: QuotaPeriod[]): Promise<void> {
    const periodsToReset = periods ?? this.getConfiguredPeriods()

    for (const period of periodsToReset) {
      const storageKey = this.getStorageKey(key, period)
      await this.storage.delete(storageKey)
    }
  }

  async getStatus(key: string): Promise<QuotaStatus> {
    return this.buildStatus(key, false)
  }

  private async buildStatus(key: string, justConsumed: boolean): Promise<QuotaStatus> {
    const now = Date.now()
    const periods = this.getConfiguredPeriods()
    const exceededPeriods: QuotaPeriod[] = []

    const usage: QuotaStatus['usage'] = {}

    for (const period of periods) {
      const state = await this.getPeriodState(key, period, now)
      const limit = this.getLimitForPeriod(period)
      const duration = this.getPeriodDuration(period)
      const resetAt = state.periodStart + duration

      const periodKey = period === 'hour' ? 'hourly'
        : period === 'day' ? 'daily'
        : period === 'week' ? 'weekly'
        : period === 'month' ? 'monthly'
        : 'minute'

      usage[periodKey] = {
        used: state.used,
        limit,
        remaining: Math.max(0, limit - state.used),
        resetAt,
      }

      if (state.used >= limit) {
        exceededPeriods.push(period)
      }
    }

    return {
      usage,
      exceeded: exceededPeriods.length > 0,
      exceededPeriods,
    }
  }
}
