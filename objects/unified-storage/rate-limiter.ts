/**
 * @fileoverview Per-Tenant Rate Limiting for Unified Storage
 *
 * This module provides rate limiting capabilities with:
 * - Per-namespace/tenant request limits
 * - Different limits for reads vs writes
 * - Token bucket algorithm with burst allowance
 * - Rate limit headers in responses
 * - Admin overrides for specific tenants
 * - Rate limit metrics for monitoring
 * - Configurable window strategies (fixed, sliding, sliding-log)
 *
 * @module objects/unified-storage/rate-limiter
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Window strategy for rate limiting
 */
export type WindowStrategy = 'fixed' | 'sliding' | 'sliding-log'

/**
 * Algorithm type for rate limiting
 */
export type RateLimitAlgorithm = 'window' | 'token-bucket'

/**
 * Configuration for rate limits
 */
export interface TenantRateLimitConfig {
  /** Total requests allowed per window */
  requestsPerWindow: number
  /** Window duration in milliseconds */
  windowMs: number
  /** Optional separate read limit */
  readLimit?: number
  /** Optional separate write limit */
  writeLimit?: number
  /** Window strategy: fixed (default), sliding, or sliding-log */
  windowStrategy?: WindowStrategy
  /** Algorithm: window (default) or token-bucket */
  algorithm?: RateLimitAlgorithm
  /** Bucket capacity for token-bucket algorithm */
  bucketCapacity?: number
  /** Token refill rate per second for token-bucket algorithm */
  refillRate?: number
}

/**
 * State of a token bucket
 */
export interface TokenBucketState {
  tokens: number
  capacity: number
  refillRate: number
  lastRefill: number
}

/**
 * Rate limit error details
 */
export interface RateLimitError {
  code: 'RATE_LIMIT_EXCEEDED'
  message: string
}

/**
 * Rate limit headers
 */
export interface RateLimitHeaders {
  'X-RateLimit-Limit': string
  'X-RateLimit-Remaining': string
  'X-RateLimit-Reset': string
  'X-RateLimit-Policy'?: string
  'Retry-After'?: string
}

/**
 * Result of a rate limit check
 */
export interface RateLimitResult {
  allowed: boolean
  statusCode?: number
  remaining: number
  limit: number
  headers: RateLimitHeaders
  limitType?: 'read' | 'write' | 'combined'
  windowStrategy?: WindowStrategy
  windowResetsAt?: number
  oldestRequestExpiresAt?: number
  error?: RateLimitError
  retryAfterMs?: number
  bypass?: boolean
  storageError?: boolean
  tokensNeeded?: number
  tokensAvailable?: number
}

/**
 * Admin override configuration
 */
export interface TenantOverride {
  type: 'bypass' | 'increase'
  multiplier?: number
  expiresAt?: number
  reason: string
}

/**
 * Active override with tenant info
 */
export interface ActiveOverride extends TenantOverride {
  tenant: string
}

/**
 * Metrics for a rate limit check
 */
export interface RateLimitMetrics {
  tenant: string
  type: 'request'
  rejected?: boolean
  remainingPercent?: number
  checkLatencyMs?: number
  bypassed?: boolean
  bypassReason?: string
  warning?: boolean
  warningType?: 'threshold_approaching'
}

/**
 * Aggregated metrics per tenant
 */
export interface AggregatedTenantMetrics {
  totalRequests: number
  rejections: number
  avgLatency?: number
}

/**
 * Usage status for a tenant
 */
export interface UsageStatus {
  used: number
  limit: number
  remaining: number
  percentUsed: number
  windowResetsAt: number
}

/**
 * Window info for a tenant
 */
export interface WindowInfo {
  strategy: WindowStrategy
  requestTimestamps?: number[]
  windowStart?: number
  windowEnd?: number
}

/**
 * Storage adapter interface for rate limit state
 */
export interface RateLimitStorage {
  get(key: string): TokenBucketState | WindowState | undefined
  set(key: string, value: TokenBucketState | WindowState): void
  delete(key: string): boolean
  keys(): string[]
  clear(): void
}

/**
 * Window state for fixed/sliding window
 */
export interface WindowState {
  count: number
  readCount?: number
  writeCount?: number
  windowStart: number
  requestTimestamps?: number[]
}

/**
 * Metrics collector interface
 */
export interface RateLimitMetricsCollector {
  record(metric: RateLimitMetrics): void
  getMetrics(): RateLimitMetrics[]
  clear(): void
  getByTenant(tenant: string): RateLimitMetrics[]
}

/**
 * Request-like interface for rate limit checks
 */
export interface RateLimitRequest {
  method: string
  url: string
  tenant: string
  headers: {
    get(name: string): string | undefined
  }
}

/**
 * Options for check method
 */
export interface CheckOptions {
  cost?: number
}

/**
 * Constructor options for TenantRateLimiter
 */
export interface TenantRateLimiterOptions {
  storage: RateLimitStorage
  metricsCollector?: RateLimitMetricsCollector
  defaultConfig: TenantRateLimitConfig
  tenantConfigs?: Record<string, TenantRateLimitConfig>
  adminTenants?: string[]
  warningThreshold?: number
  failOpen?: boolean
}

// ============================================================================
// TENANT RATE LIMITER
// ============================================================================

/**
 * Per-tenant rate limiter with configurable limits, window strategies,
 * and token bucket algorithm support.
 */
export class TenantRateLimiter {
  private storage: RateLimitStorage
  private metricsCollector?: RateLimitMetricsCollector
  private defaultConfig: TenantRateLimitConfig
  private tenantConfigs: Map<string, TenantRateLimitConfig>
  private adminTenants: Set<string>
  private overrides: Map<string, TenantOverride>
  private warningThreshold: number
  private failOpen: boolean
  private closed: boolean = false
  private pendingChecks: Map<string, Promise<void>> = new Map()

  constructor(options: TenantRateLimiterOptions) {
    // Validate default config
    this.validateConfig(options.defaultConfig)

    this.storage = options.storage
    this.metricsCollector = options.metricsCollector
    this.defaultConfig = options.defaultConfig
    this.tenantConfigs = new Map(Object.entries(options.tenantConfigs ?? {}))
    this.adminTenants = new Set(options.adminTenants ?? [])
    this.overrides = new Map()
    this.warningThreshold = options.warningThreshold ?? 0.8
    this.failOpen = options.failOpen ?? false
  }

  /**
   * Validate a rate limit config
   */
  private validateConfig(config: TenantRateLimitConfig): void {
    if (config.requestsPerWindow < 0) {
      throw new Error('Invalid config: requestsPerWindow cannot be negative')
    }
    if (config.windowMs <= 0) {
      throw new Error('Invalid config: windowMs must be greater than zero')
    }
    if (config.readLimit !== undefined && config.readLimit < 0) {
      throw new Error('Invalid config: readLimit cannot be negative')
    }
    if (config.writeLimit !== undefined && config.writeLimit < 0) {
      throw new Error('Invalid config: writeLimit cannot be negative')
    }
    if (config.bucketCapacity !== undefined && config.bucketCapacity < 0) {
      throw new Error('Invalid config: bucketCapacity cannot be negative')
    }
    if (config.refillRate !== undefined && config.refillRate < 0) {
      throw new Error('Invalid config: refillRate cannot be negative')
    }
  }

  /**
   * Check if rate limiter is closed
   */
  isClosed(): boolean {
    return this.closed
  }

  /**
   * Close the rate limiter gracefully
   */
  async close(): Promise<void> {
    if (this.closed) return

    // Wait for pending checks to complete
    await Promise.all(this.pendingChecks.values())

    // Flush state to storage
    this.flushState()

    this.closed = true
  }

  /**
   * Flush in-memory state to storage
   */
  private flushState(): void {
    // State is already persisted on each check, nothing to do
  }

  /**
   * Get config for a tenant
   */
  async getConfigForTenant(tenant: string): Promise<TenantRateLimitConfig> {
    return this.tenantConfigs.get(tenant) ?? { ...this.defaultConfig }
  }

  /**
   * Set config for a tenant
   */
  async setTenantConfig(tenant: string, config: TenantRateLimitConfig): Promise<void> {
    this.validateConfig(config)
    this.tenantConfigs.set(tenant, config)
  }

  /**
   * Remove config for a tenant (reverts to default)
   */
  async removeTenantConfig(tenant: string): Promise<void> {
    this.tenantConfigs.delete(tenant)
  }

  /**
   * Get all tenant configurations
   */
  async getAllTenantConfigs(): Promise<Record<string, TenantRateLimitConfig>> {
    return Object.fromEntries(this.tenantConfigs)
  }

  /**
   * Set an admin override for a tenant
   */
  async setOverride(tenant: string, override: TenantOverride): Promise<void> {
    this.overrides.set(tenant, override)
  }

  /**
   * Remove an override for a tenant
   */
  async removeOverride(tenant: string): Promise<void> {
    this.overrides.delete(tenant)
  }

  /**
   * Get all active overrides
   */
  async getActiveOverrides(): Promise<ActiveOverride[]> {
    const now = Date.now()
    const result: ActiveOverride[] = []

    // Add permanent admin tenants
    for (const tenant of this.adminTenants) {
      result.push({
        tenant,
        type: 'bypass',
        reason: 'Admin tenant',
      })
    }

    // Add temporary overrides that haven't expired
    for (const [tenant, override] of this.overrides) {
      if (!override.expiresAt || override.expiresAt > now) {
        result.push({ tenant, ...override })
      }
    }

    return result
  }

  /**
   * Check if a request is allowed
   */
  async check(request: RateLimitRequest, options: CheckOptions = {}): Promise<RateLimitResult> {
    if (this.closed) {
      throw new Error('Rate limiter is closed')
    }

    const tenant = request.tenant
    if (!tenant) {
      throw new Error('Tenant identifier is required')
    }

    const startTime = Date.now()
    const cost = options.cost ?? 1

    try {
      // Check for admin bypass
      const bypassResult = this.checkBypass(tenant)
      if (bypassResult) {
        const result = this.createBypassResult(tenant)
        this.recordMetrics(tenant, startTime, result, true)
        return result
      }

      // Get config with override multiplier
      const config = await this.getEffectiveConfig(tenant)

      // Determine operation type
      const operationType = this.getOperationType(request.method)

      // Perform rate limit check based on algorithm
      let result: RateLimitResult
      if (config.algorithm === 'token-bucket') {
        result = await this.checkTokenBucket(tenant, config, cost)
      } else {
        result = await this.checkWindow(tenant, config, operationType, cost)
      }

      result.limitType = operationType
      result.windowStrategy = config.windowStrategy ?? 'fixed'

      // Record metrics
      this.recordMetrics(tenant, startTime, result, false)

      return result
    } catch (error) {
      // Handle storage errors
      if (this.failOpen) {
        const result = this.createFailOpenResult(tenant)
        this.recordMetrics(tenant, startTime, result, false)
        return result
      } else {
        const result = this.createFailClosedResult(tenant)
        this.recordMetrics(tenant, startTime, result, false)
        return result
      }
    }
  }

  /**
   * Check if tenant has a bypass (admin or override)
   */
  private checkBypass(tenant: string): boolean {
    // Check permanent admin tenants
    if (this.adminTenants.has(tenant)) {
      return true
    }

    // Check temporary overrides
    const override = this.overrides.get(tenant)
    if (override) {
      const now = Date.now()
      if (override.type === 'bypass') {
        if (!override.expiresAt || override.expiresAt > now) {
          return true
        } else {
          // Override expired, remove it
          this.overrides.delete(tenant)
        }
      }
    }

    return false
  }

  /**
   * Get effective config including override multiplier
   */
  private async getEffectiveConfig(tenant: string): Promise<TenantRateLimitConfig> {
    const baseConfig = await this.getConfigForTenant(tenant)
    const override = this.overrides.get(tenant)

    if (override?.type === 'increase' && override.multiplier) {
      const now = Date.now()
      if (!override.expiresAt || override.expiresAt > now) {
        return {
          ...baseConfig,
          requestsPerWindow: baseConfig.requestsPerWindow * override.multiplier,
          readLimit: baseConfig.readLimit ? baseConfig.readLimit * override.multiplier : undefined,
          writeLimit: baseConfig.writeLimit ? baseConfig.writeLimit * override.multiplier : undefined,
        }
      } else {
        // Override expired, remove it
        this.overrides.delete(tenant)
      }
    }

    return baseConfig
  }

  /**
   * Determine if operation is read or write
   */
  private getOperationType(method: string): 'read' | 'write' | 'combined' {
    const readMethods = ['GET', 'HEAD', 'OPTIONS']
    return readMethods.includes(method.toUpperCase()) ? 'read' : 'write'
  }

  /**
   * Check rate limit using token bucket algorithm
   */
  private async checkTokenBucket(
    tenant: string,
    config: TenantRateLimitConfig,
    cost: number
  ): Promise<RateLimitResult> {
    const key = `bucket:${tenant}`
    const now = Date.now()

    // Get or create bucket state
    let bucket = this.storage.get(key) as TokenBucketState | undefined
    if (!bucket) {
      bucket = {
        tokens: config.bucketCapacity ?? config.requestsPerWindow,
        capacity: config.bucketCapacity ?? config.requestsPerWindow,
        refillRate: config.refillRate ?? 1,
        lastRefill: now,
      }
    }

    // Refill tokens based on time elapsed
    const timePassed = (now - bucket.lastRefill) / 1000
    const tokensToAdd = timePassed * bucket.refillRate
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + tokensToAdd)
    bucket.lastRefill = now

    // Check if we have enough tokens
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost
      this.storage.set(key, bucket)

      const windowResetsAt = now + config.windowMs

      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        limit: bucket.capacity,
        headers: this.createHeaders(bucket.capacity, Math.floor(bucket.tokens), windowResetsAt),
        windowResetsAt,
      }
    }

    // Not enough tokens
    const retryAfterMs = Math.ceil(((cost - bucket.tokens) / bucket.refillRate) * 1000)
    const windowResetsAt = now + retryAfterMs

    this.storage.set(key, bucket)

    return {
      allowed: false,
      statusCode: 429,
      remaining: Math.floor(bucket.tokens),
      limit: bucket.capacity,
      headers: this.createHeaders(bucket.capacity, Math.floor(bucket.tokens), windowResetsAt, retryAfterMs),
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit exceeded. Please retry after ${Math.ceil(retryAfterMs / 1000)} seconds.`,
      },
      retryAfterMs,
      tokensNeeded: cost,
      tokensAvailable: Math.floor(bucket.tokens),
      windowResetsAt,
    }
  }

  /**
   * Check rate limit using window algorithm
   */
  private async checkWindow(
    tenant: string,
    config: TenantRateLimitConfig,
    operationType: 'read' | 'write' | 'combined',
    cost: number
  ): Promise<RateLimitResult> {
    const strategy = config.windowStrategy ?? 'fixed'
    const now = Date.now()

    // Determine effective limit
    let limit = config.requestsPerWindow
    if (operationType === 'read' && config.readLimit !== undefined) {
      limit = config.readLimit
    } else if (operationType === 'write' && config.writeLimit !== undefined) {
      limit = config.writeLimit
    }

    // Get storage key based on operation type
    const key = operationType === 'combined' || (!config.readLimit && !config.writeLimit)
      ? `window:${tenant}`
      : `window:${tenant}:${operationType}`

    // Get or create window state
    let state = this.storage.get(key) as WindowState | undefined

    if (strategy === 'fixed') {
      return this.checkFixedWindow(tenant, key, state, config, limit, cost, operationType)
    } else if (strategy === 'sliding') {
      return this.checkSlidingWindow(tenant, key, state, config, limit, cost, operationType)
    } else {
      return this.checkSlidingLog(tenant, key, state, config, limit, cost, operationType)
    }
  }

  /**
   * Fixed window rate limiting
   */
  private checkFixedWindow(
    tenant: string,
    key: string,
    state: WindowState | undefined,
    config: TenantRateLimitConfig,
    limit: number,
    cost: number,
    operationType: 'read' | 'write' | 'combined'
  ): RateLimitResult {
    const now = Date.now()
    const windowMs = config.windowMs

    // Initialize or reset window if expired
    if (!state || now - state.windowStart >= windowMs) {
      state = {
        count: 0,
        windowStart: now,
      }
    }

    const windowResetsAt = state.windowStart + windowMs
    const remaining = Math.max(0, limit - state.count)

    // Check if within limit
    if (state.count + cost <= limit) {
      state.count += cost
      this.storage.set(key, state)

      return {
        allowed: true,
        remaining: Math.max(0, limit - state.count),
        limit,
        headers: this.createHeaders(limit, Math.max(0, limit - state.count), windowResetsAt),
        windowResetsAt,
      }
    }

    // Rate limited
    const retryAfterMs = windowResetsAt - now

    return {
      allowed: false,
      statusCode: 429,
      remaining: 0,
      limit,
      headers: this.createHeaders(limit, 0, windowResetsAt, retryAfterMs),
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit exceeded. Please retry after ${Math.ceil(retryAfterMs / 1000)} seconds.`,
      },
      retryAfterMs,
      windowResetsAt,
    }
  }

  /**
   * Sliding window rate limiting
   */
  private checkSlidingWindow(
    tenant: string,
    key: string,
    state: WindowState | undefined,
    config: TenantRateLimitConfig,
    limit: number,
    cost: number,
    operationType: 'read' | 'write' | 'combined'
  ): RateLimitResult {
    const now = Date.now()
    const windowMs = config.windowMs

    // Initialize state
    if (!state) {
      state = {
        count: 0,
        windowStart: now,
        requestTimestamps: [],
      }
    }

    // Ensure requestTimestamps exists
    if (!state.requestTimestamps) {
      state.requestTimestamps = []
    }

    // Remove expired timestamps
    const cutoff = now - windowMs
    state.requestTimestamps = state.requestTimestamps.filter(ts => ts > cutoff)

    const currentCount = state.requestTimestamps.length
    const remaining = Math.max(0, limit - currentCount)

    // Find oldest request for reset time
    const oldestTimestamp = state.requestTimestamps.length > 0
      ? Math.min(...state.requestTimestamps)
      : now
    const oldestRequestExpiresAt = oldestTimestamp + windowMs
    const windowResetsAt = now + windowMs

    // Check if within limit
    if (currentCount + cost <= limit) {
      // Add timestamps for each unit of cost
      for (let i = 0; i < cost; i++) {
        state.requestTimestamps.push(now)
      }
      state.count = state.requestTimestamps.length
      this.storage.set(key, state)

      return {
        allowed: true,
        remaining: Math.max(0, limit - state.requestTimestamps.length),
        limit,
        headers: this.createHeaders(limit, Math.max(0, limit - state.requestTimestamps.length), windowResetsAt),
        windowResetsAt,
        oldestRequestExpiresAt,
      }
    }

    // Rate limited
    const retryAfterMs = oldestRequestExpiresAt - now

    return {
      allowed: false,
      statusCode: 429,
      remaining: 0,
      limit,
      headers: this.createHeaders(limit, 0, windowResetsAt, retryAfterMs),
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit exceeded. Please retry after ${Math.ceil(retryAfterMs / 1000)} seconds.`,
      },
      retryAfterMs,
      windowResetsAt,
      oldestRequestExpiresAt,
    }
  }

  /**
   * Sliding log rate limiting (most precise)
   */
  private checkSlidingLog(
    tenant: string,
    key: string,
    state: WindowState | undefined,
    config: TenantRateLimitConfig,
    limit: number,
    cost: number,
    operationType: 'read' | 'write' | 'combined'
  ): RateLimitResult {
    // Sliding log is similar to sliding window but stores all timestamps
    return this.checkSlidingWindow(tenant, key, state, config, limit, cost, operationType)
  }

  /**
   * Create rate limit headers
   */
  private createHeaders(
    limit: number,
    remaining: number,
    resetTime: number,
    retryAfterMs?: number
  ): RateLimitHeaders {
    const headers: RateLimitHeaders = {
      'X-RateLimit-Limit': String(limit),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(Math.ceil(resetTime / 1000)),
      'X-RateLimit-Policy': `${limit};w=${Math.ceil((resetTime - Date.now()) / 1000)}`,
    }

    if (retryAfterMs !== undefined) {
      headers['Retry-After'] = String(Math.ceil(retryAfterMs / 1000))
    }

    return headers
  }

  /**
   * Create a bypass result for admin tenants
   */
  private createBypassResult(tenant: string): RateLimitResult {
    const now = Date.now()
    const config = this.tenantConfigs.get(tenant) ?? this.defaultConfig

    return {
      allowed: true,
      remaining: Number.MAX_SAFE_INTEGER,
      limit: Number.MAX_SAFE_INTEGER,
      bypass: true,
      headers: this.createHeaders(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, now + config.windowMs),
    }
  }

  /**
   * Create a fail-open result
   */
  private createFailOpenResult(tenant: string): RateLimitResult {
    const now = Date.now()
    const config = this.tenantConfigs.get(tenant) ?? this.defaultConfig

    return {
      allowed: true,
      remaining: config.requestsPerWindow,
      limit: config.requestsPerWindow,
      storageError: true,
      headers: this.createHeaders(config.requestsPerWindow, config.requestsPerWindow, now + config.windowMs),
    }
  }

  /**
   * Create a fail-closed result
   */
  private createFailClosedResult(tenant: string): RateLimitResult {
    const now = Date.now()
    const config = this.tenantConfigs.get(tenant) ?? this.defaultConfig

    return {
      allowed: false,
      statusCode: 503,
      remaining: 0,
      limit: config.requestsPerWindow,
      storageError: true,
      headers: this.createHeaders(config.requestsPerWindow, 0, now + config.windowMs, 5000),
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit check unavailable. Please retry later.',
      },
      retryAfterMs: 5000,
    }
  }

  /**
   * Record metrics for a rate limit check
   */
  private recordMetrics(
    tenant: string,
    startTime: number,
    result: RateLimitResult,
    bypassed: boolean
  ): void {
    if (!this.metricsCollector) return

    const latencyMs = Date.now() - startTime
    const limit = result.limit
    const remaining = result.remaining
    const remainingPercent = limit > 0 ? Math.round((remaining / limit) * 100) : 0
    const usedPercent = 100 - remainingPercent

    const metric: RateLimitMetrics = {
      tenant,
      type: 'request',
      rejected: !result.allowed,
      remainingPercent,
      checkLatencyMs: latencyMs,
    }

    if (bypassed || result.bypass) {
      metric.bypassed = true
      metric.bypassReason = this.adminTenants.has(tenant) ? 'Admin tenant' : 'Override'
    }

    // Check if approaching threshold
    if (usedPercent >= this.warningThreshold * 100) {
      metric.warning = true
      metric.warningType = 'threshold_approaching'
    }

    this.metricsCollector.record(metric)
  }

  /**
   * Get bucket state for a tenant (token bucket algorithm)
   */
  async getBucketState(tenant: string): Promise<TokenBucketState> {
    const key = `bucket:${tenant}`
    const now = Date.now()
    const config = await this.getConfigForTenant(tenant)

    let bucket = this.storage.get(key) as TokenBucketState | undefined
    if (!bucket) {
      bucket = {
        tokens: config.bucketCapacity ?? config.requestsPerWindow,
        capacity: config.bucketCapacity ?? config.requestsPerWindow,
        refillRate: config.refillRate ?? 1,
        lastRefill: now,
      }
    }

    // Refill tokens based on time elapsed
    const timePassed = (now - bucket.lastRefill) / 1000
    const tokensToAdd = timePassed * bucket.refillRate
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + tokensToAdd)
    bucket.lastRefill = now

    return bucket
  }

  /**
   * Get window info for a tenant
   */
  async getWindowInfo(tenant: string): Promise<WindowInfo> {
    const config = await this.getConfigForTenant(tenant)
    const strategy = config.windowStrategy ?? 'fixed'
    const key = `window:${tenant}`
    const state = this.storage.get(key) as WindowState | undefined

    return {
      strategy,
      requestTimestamps: state?.requestTimestamps,
      windowStart: state?.windowStart,
      windowEnd: state ? state.windowStart + config.windowMs : undefined,
    }
  }

  /**
   * Get usage status for a tenant
   */
  async getUsageStatus(tenant: string): Promise<UsageStatus> {
    const config = await this.getConfigForTenant(tenant)
    const now = Date.now()

    if (config.algorithm === 'token-bucket') {
      const bucket = await this.getBucketState(tenant)
      return {
        used: Math.floor(bucket.capacity - bucket.tokens),
        limit: bucket.capacity,
        remaining: Math.floor(bucket.tokens),
        percentUsed: Math.round(((bucket.capacity - bucket.tokens) / bucket.capacity) * 100),
        windowResetsAt: now + config.windowMs,
      }
    }

    // Window-based
    const key = `window:${tenant}`
    const state = this.storage.get(key) as WindowState | undefined

    if (!state) {
      return {
        used: 0,
        limit: config.requestsPerWindow,
        remaining: config.requestsPerWindow,
        percentUsed: 0,
        windowResetsAt: now + config.windowMs,
      }
    }

    const windowMs = config.windowMs
    const strategy = config.windowStrategy ?? 'fixed'

    if (strategy === 'fixed') {
      // Check if window expired
      if (now - state.windowStart >= windowMs) {
        return {
          used: 0,
          limit: config.requestsPerWindow,
          remaining: config.requestsPerWindow,
          percentUsed: 0,
          windowResetsAt: now + windowMs,
        }
      }

      return {
        used: state.count,
        limit: config.requestsPerWindow,
        remaining: Math.max(0, config.requestsPerWindow - state.count),
        percentUsed: Math.round((state.count / config.requestsPerWindow) * 100),
        windowResetsAt: state.windowStart + windowMs,
      }
    }

    // Sliding window
    const cutoff = now - windowMs
    const validTimestamps = (state.requestTimestamps ?? []).filter(ts => ts > cutoff)
    const used = validTimestamps.length

    return {
      used,
      limit: config.requestsPerWindow,
      remaining: Math.max(0, config.requestsPerWindow - used),
      percentUsed: Math.round((used / config.requestsPerWindow) * 100),
      windowResetsAt: now + windowMs,
    }
  }

  /**
   * Reset rate limit state for a tenant
   */
  async resetTenant(tenant: string): Promise<void> {
    this.storage.delete(`bucket:${tenant}`)
    this.storage.delete(`window:${tenant}`)
    this.storage.delete(`window:${tenant}:read`)
    this.storage.delete(`window:${tenant}:write`)
  }

  /**
   * Get aggregated metrics by tenant
   */
  async getAggregatedMetrics(): Promise<Record<string, AggregatedTenantMetrics>> {
    if (!this.metricsCollector) {
      return {}
    }

    const allMetrics = this.metricsCollector.getMetrics()
    const aggregated: Record<string, AggregatedTenantMetrics> = {}

    for (const metric of allMetrics) {
      if (!aggregated[metric.tenant]) {
        aggregated[metric.tenant] = {
          totalRequests: 0,
          rejections: 0,
        }
      }
      aggregated[metric.tenant].totalRequests++
      if (metric.rejected) {
        aggregated[metric.tenant].rejections++
      }
    }

    return aggregated
  }

  /**
   * Export metrics in Prometheus format
   */
  async exportPrometheusMetrics(): Promise<string> {
    const aggregated = await this.getAggregatedMetrics()
    const lines: string[] = []

    lines.push('# HELP rate_limit_requests_total Total number of rate limit requests')
    lines.push('# TYPE rate_limit_requests_total counter')

    for (const [tenant, metrics] of Object.entries(aggregated)) {
      lines.push(`rate_limit_requests_total{tenant="${tenant}"} ${metrics.totalRequests}`)
    }

    lines.push('')
    lines.push('# HELP rate_limit_rejections_total Total number of rate limit rejections')
    lines.push('# TYPE rate_limit_rejections_total counter')

    for (const [tenant, metrics] of Object.entries(aggregated)) {
      lines.push(`rate_limit_rejections_total{tenant="${tenant}"} ${metrics.rejections}`)
    }

    return lines.join('\n')
  }

  /**
   * Apply rate limit headers to a Response
   */
  applyHeaders(response: Response, result: RateLimitResult): Response {
    const newResponse = new Response(response.body, response)

    for (const [key, value] of Object.entries(result.headers)) {
      if (value !== undefined) {
        newResponse.headers.set(key, value)
      }
    }

    return newResponse
  }
}
