/**
 * RateLimitDO - Upstash Ratelimit-compatible Durable Object
 *
 * Drop-in replacement for @upstash/ratelimit that runs on Cloudflare Workers.
 * Implements multiple rate limiting algorithms for flexible rate control.
 *
 * Algorithms:
 * - Fixed Window: Simple time-based windows
 * - Sliding Window: Smooth rate limiting across windows
 * - Token Bucket: Burst-friendly with steady refill
 *
 * @see https://docs.upstash.com/ratelimit
 */

import { DO } from 'dotdo'

// ============================================================================
// TYPES
// ============================================================================

export type Algorithm = 'fixedWindow' | 'slidingWindow' | 'tokenBucket'

export interface RateLimitConfig {
  /** Maximum number of requests */
  limit: number
  /** Time window in seconds or milliseconds */
  window: number
  /** Window unit ('s' for seconds, 'ms' for milliseconds, 'm' for minutes, 'h' for hours, 'd' for days) */
  windowUnit?: 's' | 'ms' | 'm' | 'h' | 'd'
}

export interface TokenBucketConfig {
  /** Maximum tokens in bucket */
  maxTokens: number
  /** Tokens added per interval */
  refillRate: number
  /** Refill interval in milliseconds */
  refillInterval: number
}

export interface LimitResponse {
  /** Whether the request is allowed */
  success: boolean
  /** Maximum requests allowed */
  limit: number
  /** Remaining requests in current window */
  remaining: number
  /** Unix timestamp (ms) when the rate limit resets */
  reset: number
  /** Number of requests made in current window */
  current?: number
  /** Retry after (milliseconds) if rate limited */
  retryAfter?: number
}

export interface MultiLimitResponse {
  /** Whether all limits passed */
  success: boolean
  /** Individual limit responses */
  results: LimitResponse[]
}

export interface AnalyticsData {
  identifier: string
  requests: number
  blocked: number
  allowed: number
  windowStart: string
  windowEnd: string
}

// ============================================================================
// RATELIMIT DO
// ============================================================================

/**
 * RateLimitDO - Rate Limiting Durable Object
 */
export class RateLimitDO extends DO {
  static readonly $type = 'RateLimitDO'

  private sql!: SqlStorage

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env)
    this.sql = ctx.storage.sql
  }

  /**
   * Initialize database schema
   */
  async initialize() {
    // Fixed window counters
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS fixed_window (
        identifier TEXT NOT NULL,
        window_key TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        window_start INTEGER NOT NULL,
        window_end INTEGER NOT NULL,
        PRIMARY KEY (identifier, window_key)
      )
    `)

    // Sliding window log
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS sliding_window (
        id TEXT PRIMARY KEY,
        identifier TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `)

    // Token bucket state
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS token_bucket (
        identifier TEXT PRIMARY KEY,
        tokens REAL NOT NULL,
        last_refill INTEGER NOT NULL
      )
    `)

    // Rate limit configurations
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS configs (
        name TEXT PRIMARY KEY,
        algorithm TEXT NOT NULL,
        config TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `)

    // Analytics
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS analytics (
        identifier TEXT NOT NULL,
        window_key TEXT NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0,
        blocked INTEGER NOT NULL DEFAULT 0,
        allowed INTEGER NOT NULL DEFAULT 0,
        window_start TEXT NOT NULL,
        window_end TEXT NOT NULL,
        PRIMARY KEY (identifier, window_key)
      )
    `)

    // Indexes
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_sliding_window_ts ON sliding_window(identifier, timestamp)
    `)
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_analytics_time ON analytics(window_start)
    `)
  }

  // ===========================================================================
  // HTTP HANDLER - REST API
  // ===========================================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    try {
      // POST /limit - Check rate limit
      if (method === 'POST' && path === '/limit') {
        return await this.handleLimit(request)
      }

      // POST /limit/multi - Check multiple rate limits
      if (method === 'POST' && path === '/limit/multi') {
        return await this.handleMultiLimit(request)
      }

      // POST /limit/block - Block for duration
      if (method === 'POST' && path === '/limit/block') {
        return await this.handleBlock(request)
      }

      // DELETE /limit/:identifier - Reset rate limit
      if (method === 'DELETE' && path.startsWith('/limit/')) {
        const identifier = decodeURIComponent(path.slice('/limit/'.length))
        return await this.handleReset(identifier)
      }

      // GET /limit/:identifier - Get current state
      if (method === 'GET' && path.startsWith('/limit/')) {
        const identifier = decodeURIComponent(path.slice('/limit/'.length))
        return await this.handleGetState(identifier, url)
      }

      // Configs
      // POST /configs - Create config
      if (method === 'POST' && path === '/configs') {
        return await this.handleCreateConfig(request)
      }

      // GET /configs - List configs
      if (method === 'GET' && path === '/configs') {
        return await this.handleListConfigs()
      }

      // GET /configs/:name - Get config
      if (method === 'GET' && path.startsWith('/configs/')) {
        const name = path.slice('/configs/'.length)
        return await this.handleGetConfig(name)
      }

      // DELETE /configs/:name - Delete config
      if (method === 'DELETE' && path.startsWith('/configs/')) {
        const name = path.slice('/configs/'.length)
        return await this.handleDeleteConfig(name)
      }

      // Analytics
      // GET /analytics - Get analytics
      if (method === 'GET' && path === '/analytics') {
        return await this.handleGetAnalytics(url)
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return Response.json({ error: message }, { status: 500 })
    }
  }

  // ===========================================================================
  // RATE LIMIT HANDLERS
  // ===========================================================================

  private async handleLimit(request: Request): Promise<Response> {
    const body = await request.json() as {
      identifier: string
      algorithm?: Algorithm
      limit?: number
      window?: number
      windowUnit?: string
      maxTokens?: number
      refillRate?: number
      refillInterval?: number
      config?: string
      cost?: number
    }

    if (!body.identifier) {
      return Response.json({ error: 'identifier is required' }, { status: 400 })
    }

    let result: LimitResponse

    // Use named config if provided
    if (body.config) {
      const config = await this.getConfig(body.config)
      if (!config) {
        return Response.json({ error: `Config '${body.config}' not found` }, { status: 404 })
      }
      result = await this.checkLimit(body.identifier, config.algorithm, config.config, body.cost ?? 1)
    } else {
      // Use inline config
      const algorithm = body.algorithm ?? 'fixedWindow'
      const cost = body.cost ?? 1

      if (algorithm === 'tokenBucket') {
        result = await this.tokenBucket(
          body.identifier,
          {
            maxTokens: body.maxTokens ?? body.limit ?? 10,
            refillRate: body.refillRate ?? 1,
            refillInterval: body.refillInterval ?? 1000
          },
          cost
        )
      } else {
        const window = this.parseWindow(body.window ?? 60, body.windowUnit as any)
        result = algorithm === 'slidingWindow'
          ? await this.slidingWindow(body.identifier, { limit: body.limit ?? 10, window }, cost)
          : await this.fixedWindow(body.identifier, { limit: body.limit ?? 10, window }, cost)
      }
    }

    // Track analytics
    await this.trackAnalytics(body.identifier, result.success)

    const status = result.success ? 200 : 429
    return Response.json(result, {
      status,
      headers: {
        'X-RateLimit-Limit': result.limit.toString(),
        'X-RateLimit-Remaining': result.remaining.toString(),
        'X-RateLimit-Reset': result.reset.toString(),
        ...(result.retryAfter ? { 'Retry-After': Math.ceil(result.retryAfter / 1000).toString() } : {})
      }
    })
  }

  private async handleMultiLimit(request: Request): Promise<Response> {
    const body = await request.json() as {
      identifier: string
      limits: Array<{
        algorithm?: Algorithm
        limit?: number
        window?: number
        windowUnit?: string
        maxTokens?: number
        refillRate?: number
        refillInterval?: number
        config?: string
        cost?: number
      }>
    }

    if (!body.identifier || !body.limits?.length) {
      return Response.json({ error: 'identifier and limits are required' }, { status: 400 })
    }

    const results: LimitResponse[] = []

    for (const limitConfig of body.limits) {
      let result: LimitResponse

      if (limitConfig.config) {
        const config = await this.getConfig(limitConfig.config)
        if (!config) {
          return Response.json({ error: `Config '${limitConfig.config}' not found` }, { status: 404 })
        }
        result = await this.checkLimit(body.identifier, config.algorithm, config.config, limitConfig.cost ?? 1)
      } else {
        const algorithm = limitConfig.algorithm ?? 'fixedWindow'
        const cost = limitConfig.cost ?? 1

        if (algorithm === 'tokenBucket') {
          result = await this.tokenBucket(
            body.identifier,
            {
              maxTokens: limitConfig.maxTokens ?? limitConfig.limit ?? 10,
              refillRate: limitConfig.refillRate ?? 1,
              refillInterval: limitConfig.refillInterval ?? 1000
            },
            cost
          )
        } else {
          const window = this.parseWindow(limitConfig.window ?? 60, limitConfig.windowUnit as any)
          result = algorithm === 'slidingWindow'
            ? await this.slidingWindow(body.identifier, { limit: limitConfig.limit ?? 10, window }, cost)
            : await this.fixedWindow(body.identifier, { limit: limitConfig.limit ?? 10, window }, cost)
        }
      }

      results.push(result)
    }

    const success = results.every(r => r.success)
    await this.trackAnalytics(body.identifier, success)

    const response: MultiLimitResponse = { success, results }
    return Response.json(response, { status: success ? 200 : 429 })
  }

  private async handleBlock(request: Request): Promise<Response> {
    const body = await request.json() as {
      identifier: string
      duration: number // milliseconds
    }

    if (!body.identifier || !body.duration) {
      return Response.json({ error: 'identifier and duration are required' }, { status: 400 })
    }

    const blockUntil = Date.now() + body.duration
    const windowKey = 'block'

    this.sql.exec(`
      INSERT OR REPLACE INTO fixed_window (identifier, window_key, count, window_start, window_end)
      VALUES (?, ?, 999999999, ?, ?)
    `, body.identifier, windowKey, Date.now(), blockUntil)

    return Response.json({
      success: true,
      blockedUntil: blockUntil,
      duration: body.duration
    })
  }

  private async handleReset(identifier: string): Promise<Response> {
    this.sql.exec('DELETE FROM fixed_window WHERE identifier = ?', identifier)
    this.sql.exec('DELETE FROM sliding_window WHERE identifier = ?', identifier)
    this.sql.exec('DELETE FROM token_bucket WHERE identifier = ?', identifier)

    return Response.json({ success: true })
  }

  private async handleGetState(identifier: string, url: URL): Promise<Response> {
    const algorithm = url.searchParams.get('algorithm') ?? 'fixedWindow'
    const limit = parseInt(url.searchParams.get('limit') ?? '10')
    const windowParam = parseInt(url.searchParams.get('window') ?? '60')
    const windowUnit = url.searchParams.get('windowUnit') as 's' | 'ms' | 'm' | 'h' | 'd' | undefined

    const window = this.parseWindow(windowParam, windowUnit)

    let state: any

    if (algorithm === 'tokenBucket') {
      const maxTokens = parseInt(url.searchParams.get('maxTokens') ?? limit.toString())
      const refillRate = parseInt(url.searchParams.get('refillRate') ?? '1')
      const refillInterval = parseInt(url.searchParams.get('refillInterval') ?? '1000')

      const bucket = this.sql.exec<{ tokens: number; last_refill: number }>(
        'SELECT tokens, last_refill FROM token_bucket WHERE identifier = ?',
        identifier
      ).toArray()[0]

      if (bucket) {
        const elapsed = Date.now() - bucket.last_refill
        const tokensToAdd = Math.floor(elapsed / refillInterval) * refillRate
        const currentTokens = Math.min(maxTokens, bucket.tokens + tokensToAdd)

        state = {
          identifier,
          algorithm: 'tokenBucket',
          tokens: currentTokens,
          maxTokens,
          refillRate,
          refillInterval,
          lastRefill: bucket.last_refill
        }
      } else {
        state = {
          identifier,
          algorithm: 'tokenBucket',
          tokens: maxTokens,
          maxTokens,
          refillRate,
          refillInterval,
          lastRefill: Date.now()
        }
      }
    } else if (algorithm === 'slidingWindow') {
      const windowStart = Date.now() - window
      const count = this.sql.exec<{ count: number }>(
        'SELECT COUNT(*) as count FROM sliding_window WHERE identifier = ? AND timestamp > ?',
        identifier, windowStart
      ).toArray()[0]?.count ?? 0

      state = {
        identifier,
        algorithm: 'slidingWindow',
        count,
        limit,
        window,
        remaining: Math.max(0, limit - count),
        reset: Date.now() + window
      }
    } else {
      const windowKey = this.getWindowKey(window)
      const row = this.sql.exec<{ count: number; window_end: number }>(
        'SELECT count, window_end FROM fixed_window WHERE identifier = ? AND window_key = ?',
        identifier, windowKey
      ).toArray()[0]

      state = {
        identifier,
        algorithm: 'fixedWindow',
        count: row?.count ?? 0,
        limit,
        window,
        remaining: Math.max(0, limit - (row?.count ?? 0)),
        reset: row?.window_end ?? (Date.now() + window)
      }
    }

    return Response.json(state)
  }

  // ===========================================================================
  // CONFIG HANDLERS
  // ===========================================================================

  private async handleCreateConfig(request: Request): Promise<Response> {
    const body = await request.json() as {
      name: string
      algorithm: Algorithm
      limit?: number
      window?: number
      windowUnit?: string
      maxTokens?: number
      refillRate?: number
      refillInterval?: number
    }

    if (!body.name || !body.algorithm) {
      return Response.json({ error: 'name and algorithm are required' }, { status: 400 })
    }

    let config: any

    if (body.algorithm === 'tokenBucket') {
      config = {
        maxTokens: body.maxTokens ?? body.limit ?? 10,
        refillRate: body.refillRate ?? 1,
        refillInterval: body.refillInterval ?? 1000
      }
    } else {
      config = {
        limit: body.limit ?? 10,
        window: this.parseWindow(body.window ?? 60, body.windowUnit as any)
      }
    }

    this.sql.exec(`
      INSERT OR REPLACE INTO configs (name, algorithm, config, created_at)
      VALUES (?, ?, ?, ?)
    `, body.name, body.algorithm, JSON.stringify(config), new Date().toISOString())

    return Response.json({
      name: body.name,
      algorithm: body.algorithm,
      config
    })
  }

  private async handleListConfigs(): Promise<Response> {
    const rows = this.sql.exec<{ name: string; algorithm: string; config: string; created_at: string }>(
      'SELECT * FROM configs ORDER BY created_at DESC'
    ).toArray()

    return Response.json({
      configs: rows.map(row => ({
        name: row.name,
        algorithm: row.algorithm,
        config: JSON.parse(row.config),
        createdAt: row.created_at
      }))
    })
  }

  private async handleGetConfig(name: string): Promise<Response> {
    const row = this.sql.exec<{ name: string; algorithm: string; config: string; created_at: string }>(
      'SELECT * FROM configs WHERE name = ?', name
    ).toArray()[0]

    if (!row) {
      return Response.json({ error: 'Config not found' }, { status: 404 })
    }

    return Response.json({
      name: row.name,
      algorithm: row.algorithm,
      config: JSON.parse(row.config),
      createdAt: row.created_at
    })
  }

  private async handleDeleteConfig(name: string): Promise<Response> {
    const result = this.sql.exec('DELETE FROM configs WHERE name = ?', name)

    if (result.rowsWritten === 0) {
      return Response.json({ error: 'Config not found' }, { status: 404 })
    }

    return Response.json({ success: true })
  }

  // ===========================================================================
  // ANALYTICS HANDLERS
  // ===========================================================================

  private async handleGetAnalytics(url: URL): Promise<Response> {
    const identifier = url.searchParams.get('identifier')
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const limit = parseInt(url.searchParams.get('limit') ?? '100')

    let query = 'SELECT * FROM analytics'
    const params: (string | number)[] = []
    const conditions: string[] = []

    if (identifier) {
      conditions.push('identifier = ?')
      params.push(identifier)
    }

    if (from) {
      conditions.push('window_start >= ?')
      params.push(from)
    }

    if (to) {
      conditions.push('window_end <= ?')
      params.push(to)
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    query += ' ORDER BY window_start DESC LIMIT ?'
    params.push(limit)

    const rows = this.sql.exec<any>(query, ...params).toArray()

    return Response.json({
      analytics: rows.map(row => ({
        identifier: row.identifier,
        requests: row.requests,
        blocked: row.blocked,
        allowed: row.allowed,
        windowStart: row.window_start,
        windowEnd: row.window_end
      }))
    })
  }

  // ===========================================================================
  // RATE LIMIT ALGORITHMS
  // ===========================================================================

  /**
   * Fixed Window Algorithm
   *
   * Simple time-based windows where requests are counted within fixed time periods.
   * Fast and memory efficient, but can allow bursts at window boundaries.
   */
  async fixedWindow(
    identifier: string,
    config: RateLimitConfig,
    cost: number = 1
  ): Promise<LimitResponse> {
    const window = this.parseWindow(config.window, config.windowUnit)
    const windowKey = this.getWindowKey(window)
    const now = Date.now()

    // Get or create window
    let row = this.sql.exec<{ count: number; window_start: number; window_end: number }>(
      'SELECT count, window_start, window_end FROM fixed_window WHERE identifier = ? AND window_key = ?',
      identifier, windowKey
    ).toArray()[0]

    // Check if window expired
    if (row && row.window_end <= now) {
      // Reset window
      const windowStart = now
      const windowEnd = now + window
      this.sql.exec(
        'UPDATE fixed_window SET count = 0, window_start = ?, window_end = ? WHERE identifier = ? AND window_key = ?',
        windowStart, windowEnd, identifier, windowKey
      )
      row = { count: 0, window_start: windowStart, window_end: windowEnd }
    }

    // Create new window if doesn't exist
    if (!row) {
      const windowStart = now
      const windowEnd = now + window
      this.sql.exec(
        'INSERT INTO fixed_window (identifier, window_key, count, window_start, window_end) VALUES (?, ?, 0, ?, ?)',
        identifier, windowKey, windowStart, windowEnd
      )
      row = { count: 0, window_start: windowStart, window_end: windowEnd }
    }

    const currentCount = row.count
    const remaining = Math.max(0, config.limit - currentCount)
    const success = currentCount + cost <= config.limit

    if (success) {
      this.sql.exec(
        'UPDATE fixed_window SET count = count + ? WHERE identifier = ? AND window_key = ?',
        cost, identifier, windowKey
      )
    }

    return {
      success,
      limit: config.limit,
      remaining: success ? remaining - cost : remaining,
      reset: row.window_end,
      current: currentCount + (success ? cost : 0),
      retryAfter: success ? undefined : row.window_end - now
    }
  }

  /**
   * Sliding Window Algorithm
   *
   * Tracks individual request timestamps within a sliding time window.
   * Provides smoother rate limiting without boundary bursts, but uses more memory.
   */
  async slidingWindow(
    identifier: string,
    config: RateLimitConfig,
    cost: number = 1
  ): Promise<LimitResponse> {
    const window = this.parseWindow(config.window, config.windowUnit)
    const now = Date.now()
    const windowStart = now - window

    // Clean old entries
    this.sql.exec(
      'DELETE FROM sliding_window WHERE identifier = ? AND timestamp <= ?',
      identifier, windowStart
    )

    // Count current requests in window
    const countRow = this.sql.exec<{ count: number }>(
      'SELECT COUNT(*) as count FROM sliding_window WHERE identifier = ? AND timestamp > ?',
      identifier, windowStart
    ).toArray()[0]

    const currentCount = countRow?.count ?? 0
    const remaining = Math.max(0, config.limit - currentCount)
    const success = currentCount + cost <= config.limit

    if (success) {
      // Add new request entries
      for (let i = 0; i < cost; i++) {
        this.sql.exec(
          'INSERT INTO sliding_window (id, identifier, timestamp) VALUES (?, ?, ?)',
          crypto.randomUUID(), identifier, now
        )
      }
    }

    // Get oldest timestamp to calculate reset time
    const oldest = this.sql.exec<{ timestamp: number }>(
      'SELECT MIN(timestamp) as timestamp FROM sliding_window WHERE identifier = ?',
      identifier
    ).toArray()[0]

    const reset = oldest?.timestamp ? oldest.timestamp + window : now + window

    return {
      success,
      limit: config.limit,
      remaining: success ? remaining - cost : remaining,
      reset,
      current: currentCount + (success ? cost : 0),
      retryAfter: success ? undefined : reset - now
    }
  }

  /**
   * Token Bucket Algorithm
   *
   * Allows burst traffic while maintaining average rate limit.
   * Tokens are refilled at a steady rate up to the maximum capacity.
   */
  async tokenBucket(
    identifier: string,
    config: TokenBucketConfig,
    cost: number = 1
  ): Promise<LimitResponse> {
    const now = Date.now()

    // Get or create bucket
    let bucket = this.sql.exec<{ tokens: number; last_refill: number }>(
      'SELECT tokens, last_refill FROM token_bucket WHERE identifier = ?',
      identifier
    ).toArray()[0]

    if (!bucket) {
      // Create new bucket with full tokens
      this.sql.exec(
        'INSERT INTO token_bucket (identifier, tokens, last_refill) VALUES (?, ?, ?)',
        identifier, config.maxTokens, now
      )
      bucket = { tokens: config.maxTokens, last_refill: now }
    }

    // Calculate token refill
    const elapsed = now - bucket.last_refill
    const tokensToAdd = Math.floor(elapsed / config.refillInterval) * config.refillRate
    let currentTokens = Math.min(config.maxTokens, bucket.tokens + tokensToAdd)

    // Update last refill if tokens were added
    const lastRefill = tokensToAdd > 0
      ? bucket.last_refill + Math.floor(elapsed / config.refillInterval) * config.refillInterval
      : bucket.last_refill

    const success = currentTokens >= cost
    const remaining = Math.max(0, Math.floor(currentTokens) - (success ? cost : 0))

    if (success) {
      currentTokens -= cost
    }

    // Update bucket
    this.sql.exec(
      'UPDATE token_bucket SET tokens = ?, last_refill = ? WHERE identifier = ?',
      currentTokens, lastRefill, identifier
    )

    // Calculate when there will be enough tokens
    const tokensNeeded = success ? 0 : cost - currentTokens
    const refillsNeeded = Math.ceil(tokensNeeded / config.refillRate)
    const reset = now + refillsNeeded * config.refillInterval

    return {
      success,
      limit: config.maxTokens,
      remaining,
      reset,
      current: config.maxTokens - remaining,
      retryAfter: success ? undefined : refillsNeeded * config.refillInterval
    }
  }

  // ===========================================================================
  // SDK-COMPATIBLE METHODS (for direct DO access)
  // ===========================================================================

  /**
   * Check rate limit for an identifier
   */
  async limit(
    identifier: string,
    options?: {
      algorithm?: Algorithm
      limit?: number
      window?: number
      windowUnit?: 's' | 'ms' | 'm' | 'h' | 'd'
      maxTokens?: number
      refillRate?: number
      refillInterval?: number
      cost?: number
    }
  ): Promise<LimitResponse> {
    const algorithm = options?.algorithm ?? 'fixedWindow'
    const cost = options?.cost ?? 1

    let result: LimitResponse

    if (algorithm === 'tokenBucket') {
      result = await this.tokenBucket(
        identifier,
        {
          maxTokens: options?.maxTokens ?? options?.limit ?? 10,
          refillRate: options?.refillRate ?? 1,
          refillInterval: options?.refillInterval ?? 1000
        },
        cost
      )
    } else {
      const window = this.parseWindow(options?.window ?? 60, options?.windowUnit)
      const config = { limit: options?.limit ?? 10, window }

      result = algorithm === 'slidingWindow'
        ? await this.slidingWindow(identifier, config, cost)
        : await this.fixedWindow(identifier, config, cost)
    }

    await this.trackAnalytics(identifier, result.success)
    return result
  }

  /**
   * Block an identifier for a duration
   */
  async blockUntil(identifier: string, duration: number): Promise<void> {
    const blockUntil = Date.now() + duration
    const windowKey = 'block'

    this.sql.exec(`
      INSERT OR REPLACE INTO fixed_window (identifier, window_key, count, window_start, window_end)
      VALUES (?, ?, 999999999, ?, ?)
    `, identifier, windowKey, Date.now(), blockUntil)
  }

  /**
   * Reset rate limit for an identifier
   */
  async reset(identifier: string): Promise<void> {
    this.sql.exec('DELETE FROM fixed_window WHERE identifier = ?', identifier)
    this.sql.exec('DELETE FROM sliding_window WHERE identifier = ?', identifier)
    this.sql.exec('DELETE FROM token_bucket WHERE identifier = ?', identifier)
  }

  /**
   * Get remaining requests for an identifier
   */
  async getRemaining(
    identifier: string,
    options?: {
      algorithm?: Algorithm
      limit?: number
      window?: number
      windowUnit?: 's' | 'ms' | 'm' | 'h' | 'd'
      maxTokens?: number
      refillRate?: number
      refillInterval?: number
    }
  ): Promise<number> {
    const algorithm = options?.algorithm ?? 'fixedWindow'

    if (algorithm === 'tokenBucket') {
      const bucket = this.sql.exec<{ tokens: number; last_refill: number }>(
        'SELECT tokens, last_refill FROM token_bucket WHERE identifier = ?',
        identifier
      ).toArray()[0]

      if (!bucket) {
        return options?.maxTokens ?? options?.limit ?? 10
      }

      const maxTokens = options?.maxTokens ?? options?.limit ?? 10
      const refillRate = options?.refillRate ?? 1
      const refillInterval = options?.refillInterval ?? 1000

      const elapsed = Date.now() - bucket.last_refill
      const tokensToAdd = Math.floor(elapsed / refillInterval) * refillRate
      return Math.min(maxTokens, Math.floor(bucket.tokens + tokensToAdd))
    }

    const window = this.parseWindow(options?.window ?? 60, options?.windowUnit)
    const limit = options?.limit ?? 10

    if (algorithm === 'slidingWindow') {
      const windowStart = Date.now() - window
      const count = this.sql.exec<{ count: number }>(
        'SELECT COUNT(*) as count FROM sliding_window WHERE identifier = ? AND timestamp > ?',
        identifier, windowStart
      ).toArray()[0]?.count ?? 0
      return Math.max(0, limit - count)
    }

    const windowKey = this.getWindowKey(window)
    const row = this.sql.exec<{ count: number; window_end: number }>(
      'SELECT count, window_end FROM fixed_window WHERE identifier = ? AND window_key = ?',
      identifier, windowKey
    ).toArray()[0]

    if (!row || row.window_end <= Date.now()) {
      return limit
    }

    return Math.max(0, limit - row.count)
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private parseWindow(value: number, unit?: 's' | 'ms' | 'm' | 'h' | 'd'): number {
    switch (unit) {
      case 'ms': return value
      case 's': return value * 1000
      case 'm': return value * 60 * 1000
      case 'h': return value * 60 * 60 * 1000
      case 'd': return value * 24 * 60 * 60 * 1000
      default: return value * 1000 // Default to seconds
    }
  }

  private getWindowKey(window: number): string {
    // Create a window key based on the window duration
    // This allows different window sizes to have separate counters
    const now = Date.now()
    const windowStart = Math.floor(now / window) * window
    return `${window}_${windowStart}`
  }

  private async getConfig(name: string): Promise<{ algorithm: Algorithm; config: any } | null> {
    const row = this.sql.exec<{ algorithm: string; config: string }>(
      'SELECT algorithm, config FROM configs WHERE name = ?', name
    ).toArray()[0]

    if (!row) return null

    return {
      algorithm: row.algorithm as Algorithm,
      config: JSON.parse(row.config)
    }
  }

  private async checkLimit(
    identifier: string,
    algorithm: Algorithm,
    config: any,
    cost: number
  ): Promise<LimitResponse> {
    if (algorithm === 'tokenBucket') {
      return this.tokenBucket(identifier, config, cost)
    } else if (algorithm === 'slidingWindow') {
      return this.slidingWindow(identifier, config, cost)
    } else {
      return this.fixedWindow(identifier, config, cost)
    }
  }

  private async trackAnalytics(identifier: string, success: boolean): Promise<void> {
    const now = new Date()
    const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours())
    const windowEnd = new Date(windowStart.getTime() + 60 * 60 * 1000)
    const windowKey = windowStart.toISOString()

    const existing = this.sql.exec<any>(
      'SELECT * FROM analytics WHERE identifier = ? AND window_key = ?',
      identifier, windowKey
    ).toArray()[0]

    if (existing) {
      this.sql.exec(`
        UPDATE analytics SET
          requests = requests + 1,
          blocked = blocked + ?,
          allowed = allowed + ?
        WHERE identifier = ? AND window_key = ?
      `,
        success ? 0 : 1,
        success ? 1 : 0,
        identifier,
        windowKey
      )
    } else {
      this.sql.exec(`
        INSERT INTO analytics (identifier, window_key, requests, blocked, allowed, window_start, window_end)
        VALUES (?, ?, 1, ?, ?, ?, ?)
      `,
        identifier,
        windowKey,
        success ? 0 : 1,
        success ? 1 : 0,
        windowStart.toISOString(),
        windowEnd.toISOString()
      )
    }
  }
}
