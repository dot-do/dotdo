/**
 * Rate Limit Context API for $.rateLimit() and $.rateLimits
 *
 * Provides a workflow context API for rate limiting with support for:
 * - $.rateLimit(key).check(opts?) - Check if request is allowed, consumes quota
 * - $.rateLimit(key).isAllowed(opts?) - Boolean check WITHOUT consuming quota
 * - $.rateLimit(key).remaining(opts?) - Get remaining WITHOUT consuming quota
 * - $.rateLimit(key).consume(cost, opts?) - Consume tokens after the fact
 * - $.rateLimit(key).reset(opts?) - Reset rate limit for key
 * - $.rateLimit(key).status(opts?) - Get status without modifying
 * - $.rateLimits.configure(name, config) - Configure named limits
 * - $.rateLimits.getConfig() - Get all limit configs
 * - $.rateLimits.get(name) - Get specific limit config
 *
 * Supports cost-based limiting (AI tokens, uploads, etc.) and named limits.
 *
 * @module workflows/context/rate-limit
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Result from rate limit check/consume operations
 */
export interface RateLimitResult {
  /** Whether the action is allowed */
  success: boolean
  /** Remaining quota in the current window */
  remaining: number
  /** When the limit resets (epoch ms) */
  resetAt?: number
  /** Limit that was checked */
  limit?: number
  /** Cost that was consumed */
  cost?: number
}

/**
 * Configuration for a named rate limit
 */
export interface RateLimitConfig {
  /** Maximum requests/units allowed in the window */
  limit: number
  /** Window duration (e.g., '1m', '1h', '1d') */
  window: string
  /** Optional: description of this limit */
  description?: string
}

/**
 * Options for rate limit operations
 */
export interface RateLimitOptions {
  /** Cost of this operation (default 1) */
  cost?: number
  /** Named limit to use (e.g., 'api', 'ai', 'upload') */
  name?: string
}

/**
 * Rate limit instance returned by $.rateLimit(key)
 */
export interface RateLimitContextInstance {
  /**
   * Check if request is allowed and consume quota
   * Returns result with success status and remaining quota
   */
  check(options?: RateLimitOptions): Promise<RateLimitResult>

  /**
   * Boolean check if request would be allowed (does not consume quota)
   */
  isAllowed(options?: RateLimitOptions): Promise<boolean>

  /**
   * Get remaining quota without consuming
   */
  remaining(options?: RateLimitOptions): Promise<number>

  /**
   * Consume specific cost from quota (for post-facto consumption)
   */
  consume(cost: number, options?: Omit<RateLimitOptions, 'cost'>): Promise<RateLimitResult>

  /**
   * Reset the rate limit for this key
   */
  reset(options?: Omit<RateLimitOptions, 'cost'>): Promise<void>

  /**
   * Get status without modifying quota
   */
  status(options?: Omit<RateLimitOptions, 'cost'>): Promise<RateLimitResult>
}

/**
 * Named rate limits collection at $.rateLimits
 */
export interface RateLimitsCollection {
  /**
   * Get all configured named limits
   */
  getConfig(): Record<string, RateLimitConfig>

  /**
   * Configure a named limit
   */
  configure(name: string, config: RateLimitConfig): void

  /**
   * Get configuration for a specific named limit
   */
  get(name: string): RateLimitConfig | undefined
}

/**
 * Internal storage for rate limit state
 */
export interface RateLimitStorage {
  /** Request entries: compositeKey -> array of { timestamp, cost } */
  entries: Map<string, Array<{ timestamp: number; cost: number }>>
  /** Named limit configurations */
  configs: Map<string, RateLimitConfig>
}

/**
 * Full context interface returned by createMockContext
 */
export interface RateLimitContext {
  rateLimit: (key: string) => RateLimitContextInstance
  rateLimits: RateLimitsCollection
  _storage: RateLimitStorage
  _now: () => number
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default limit when using $.rateLimit without a named config
 */
const DEFAULT_LIMIT = 100

/**
 * Default window when using $.rateLimit without a named config (1 minute)
 */
const DEFAULT_WINDOW = '1m'

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parses a window string into milliseconds.
 * Format: number + unit (m = minutes, h = hours, d = days)
 *
 * @param window - Window string like '1m', '1h', '1d', '15m'
 * @returns Window duration in milliseconds
 * @throws Error if format is invalid
 */
export function parseWindow(window: string): number {
  const match = window.match(/^(\d+)([mhd])$/)
  if (!match) {
    throw new Error(`Invalid window format: ${window}. Expected format: '1m', '1h', '1d'`)
  }

  const value = parseInt(match[1], 10)
  const unit = match[2]

  if (value === 0) {
    throw new Error(`Invalid window value: ${window}. Window must be greater than 0`)
  }

  switch (unit) {
    case 'm':
      return value * 60 * 1000 // minutes to ms
    case 'h':
      return value * 60 * 60 * 1000 // hours to ms
    case 'd':
      return value * 24 * 60 * 60 * 1000 // days to ms
    default:
      throw new Error(`Unknown unit: ${unit}`)
  }
}

/**
 * Create a composite key for rate limit storage.
 * Combines the user key with the named limit to allow separate tracking.
 */
function makeCompositeKey(key: string, name: string): string {
  return `${name}:${key}`
}

/**
 * Prune expired entries from the entry list
 */
function pruneExpiredEntries(
  entries: Array<{ timestamp: number; cost: number }>,
  cutoff: number
): Array<{ timestamp: number; cost: number }> {
  return entries.filter((e) => e.timestamp > cutoff)
}

/**
 * Calculate total cost from entries
 */
function calculateTotalCost(entries: Array<{ timestamp: number; cost: number }>): number {
  return entries.reduce((sum, e) => sum + e.cost, 0)
}

// ============================================================================
// CONTEXT FACTORY
// ============================================================================

/**
 * Creates a mock workflow context ($) with rate limit support for testing
 *
 * This factory creates a context object with:
 * - $.rateLimit(key) - Returns a RateLimitContextInstance for per-key operations
 * - $.rateLimits - Collection-level operations (configure, get, getConfig)
 * - $._storage - Internal storage for test setup
 * - $._now - Time provider for testing (can be overridden for fake timers)
 *
 * @returns A RateLimitContext object with rate limit API methods
 */
export function createMockContext(): RateLimitContext {
  // Internal storage
  const storage: RateLimitStorage = {
    entries: new Map<string, Array<{ timestamp: number; cost: number }>>(),
    configs: new Map<string, RateLimitConfig>(),
  }

  // Time provider - can be patched for testing
  let nowFn = () => Date.now()

  /**
   * Get config for a named limit, or throw if not found
   */
  function getConfigOrThrow(name: string): RateLimitConfig {
    const config = storage.configs.get(name)
    if (!config) {
      throw new Error(`Rate limit '${name}' is not configured. Use $.rateLimits.configure('${name}', { limit, window }) first.`)
    }
    return config
  }

  /**
   * Get config for a named limit, or return defaults
   */
  function getConfigOrDefault(name?: string): RateLimitConfig {
    if (name) {
      return getConfigOrThrow(name)
    }
    return { limit: DEFAULT_LIMIT, window: DEFAULT_WINDOW }
  }

  /**
   * Create a RateLimitContextInstance for a specific key
   */
  function createRateLimitInstance(key: string): RateLimitContextInstance {
    return {
      /**
       * Check if request is allowed and consume quota
       */
      async check(options?: RateLimitOptions): Promise<RateLimitResult> {
        const name = options?.name
        const cost = options?.cost ?? 1

        // Validate cost
        if (cost < 0) {
          throw new Error(`Invalid cost: ${cost}. Cost must be non-negative`)
        }

        // Get config (throws if named limit not found)
        const config = name ? getConfigOrThrow(name) : getConfigOrDefault()
        const { limit, window } = config

        // Parse window
        const windowMs = parseWindow(window)
        const now = nowFn()
        const cutoff = now - windowMs

        // Get composite key for tracking
        const compositeKey = makeCompositeKey(key, name ?? '_default')

        // Get and prune entries
        let entries = storage.entries.get(compositeKey) ?? []
        entries = pruneExpiredEntries(entries, cutoff)

        // Calculate current usage
        const currentCost = calculateTotalCost(entries)

        // Handle zero cost (peek/check without consuming)
        if (cost === 0) {
          const remaining = Math.max(0, limit - currentCost)
          storage.entries.set(compositeKey, entries)
          return {
            success: remaining > 0 || limit === 0 ? limit > 0 : true,
            remaining,
            resetAt: entries.length > 0 ? Math.min(...entries.map((e) => e.timestamp)) + windowMs : now + windowMs,
            limit,
            cost: 0,
          }
        }

        // Check if we can accommodate this request
        if (currentCost + cost > limit) {
          storage.entries.set(compositeKey, entries)
          return {
            success: false,
            remaining: Math.max(0, limit - currentCost),
            resetAt: entries.length > 0 ? Math.min(...entries.map((e) => e.timestamp)) + windowMs : now + windowMs,
            limit,
            cost,
          }
        }

        // Add new entry
        entries.push({ timestamp: now, cost })
        storage.entries.set(compositeKey, entries)

        return {
          success: true,
          remaining: Math.max(0, limit - currentCost - cost),
          resetAt: now + windowMs,
          limit,
          cost,
        }
      },

      /**
       * Boolean check if request would be allowed (does not consume quota)
       */
      async isAllowed(options?: RateLimitOptions): Promise<boolean> {
        const name = options?.name
        const cost = options?.cost ?? 1

        // Get config
        const config = name ? getConfigOrThrow(name) : getConfigOrDefault()
        const { limit, window } = config

        // Parse window
        const windowMs = parseWindow(window)
        const now = nowFn()
        const cutoff = now - windowMs

        // Get composite key
        const compositeKey = makeCompositeKey(key, name ?? '_default')

        // Get and prune entries (don't save - read-only)
        let entries = storage.entries.get(compositeKey) ?? []
        entries = pruneExpiredEntries(entries, cutoff)

        // Calculate current usage
        const currentCost = calculateTotalCost(entries)

        // Check if we could accommodate this request
        return currentCost + cost <= limit
      },

      /**
       * Get remaining quota without consuming
       */
      async remaining(options?: RateLimitOptions): Promise<number> {
        const name = options?.name

        // Get config
        const config = name ? getConfigOrThrow(name) : getConfigOrDefault()
        const { limit, window } = config

        // Parse window
        const windowMs = parseWindow(window)
        const now = nowFn()
        const cutoff = now - windowMs

        // Get composite key
        const compositeKey = makeCompositeKey(key, name ?? '_default')

        // Get and prune entries (don't save - read-only)
        let entries = storage.entries.get(compositeKey) ?? []
        entries = pruneExpiredEntries(entries, cutoff)

        // Calculate remaining
        const currentCost = calculateTotalCost(entries)
        return Math.max(0, limit - currentCost)
      },

      /**
       * Consume specific cost from quota (for post-facto consumption)
       */
      async consume(cost: number, options?: Omit<RateLimitOptions, 'cost'>): Promise<RateLimitResult> {
        const name = options?.name

        // Get config
        const config = name ? getConfigOrThrow(name) : getConfigOrDefault()
        const { limit, window } = config

        // Parse window
        const windowMs = parseWindow(window)
        const now = nowFn()
        const cutoff = now - windowMs

        // Get composite key
        const compositeKey = makeCompositeKey(key, name ?? '_default')

        // Get and prune entries
        let entries = storage.entries.get(compositeKey) ?? []
        entries = pruneExpiredEntries(entries, cutoff)

        // Calculate current usage before consuming
        const currentCost = calculateTotalCost(entries)

        // Add new entry (consume always adds, even if over limit)
        entries.push({ timestamp: now, cost })
        storage.entries.set(compositeKey, entries)

        // Calculate new remaining (can be negative for over-consumption scenario)
        const newTotal = currentCost + cost
        const remaining = limit - newTotal

        return {
          success: remaining >= 0,
          remaining: Math.max(0, remaining),
          resetAt: now + windowMs,
          limit,
          cost,
        }
      },

      /**
       * Reset the rate limit for this key
       */
      async reset(options?: Omit<RateLimitOptions, 'cost'>): Promise<void> {
        const name = options?.name
        const compositeKey = makeCompositeKey(key, name ?? '_default')
        storage.entries.delete(compositeKey)
      },

      /**
       * Get status without modifying quota
       */
      async status(options?: Omit<RateLimitOptions, 'cost'>): Promise<RateLimitResult> {
        const name = options?.name

        // Get config
        const config = name ? getConfigOrThrow(name) : getConfigOrDefault()
        const { limit, window } = config

        // Parse window
        const windowMs = parseWindow(window)
        const now = nowFn()
        const cutoff = now - windowMs

        // Get composite key
        const compositeKey = makeCompositeKey(key, name ?? '_default')

        // Get and prune entries (don't save - read-only)
        let entries = storage.entries.get(compositeKey) ?? []
        entries = pruneExpiredEntries(entries, cutoff)

        // Calculate remaining
        const currentCost = calculateTotalCost(entries)
        const remaining = Math.max(0, limit - currentCost)

        return {
          success: remaining > 0,
          remaining,
          resetAt: entries.length > 0 ? Math.min(...entries.map((e) => e.timestamp)) + windowMs : now + windowMs,
          limit,
        }
      },
    }
  }

  /**
   * Rate limits collection API
   */
  const rateLimitsCollection: RateLimitsCollection = {
    /**
     * Configure a named rate limit
     */
    configure(name: string, config: RateLimitConfig): void {
      // Validate config
      if (config.limit < 0) {
        throw new Error(`Invalid limit: ${config.limit}. Limit must be non-negative`)
      }

      // Validate window format (will throw if invalid)
      parseWindow(config.window)

      // Store config (deep copy to prevent mutations)
      storage.configs.set(name, {
        limit: config.limit,
        window: config.window,
        ...(config.description && { description: config.description }),
      })
    },

    /**
     * Get all configured named limits
     * Returns a deep copy to prevent mutations
     */
    getConfig(): Record<string, RateLimitConfig> {
      const result: Record<string, RateLimitConfig> = {}

      for (const [key, config] of storage.configs.entries()) {
        result[key] = {
          limit: config.limit,
          window: config.window,
          ...(config.description && { description: config.description }),
        }
      }

      return result
    },

    /**
     * Get configuration for a specific named limit
     * Returns a copy to prevent mutations
     */
    get(name: string): RateLimitConfig | undefined {
      const config = storage.configs.get(name)
      if (!config) {
        return undefined
      }
      return {
        limit: config.limit,
        window: config.window,
        ...(config.description && { description: config.description }),
      }
    },
  }

  return {
    rateLimit: createRateLimitInstance,
    rateLimits: rateLimitsCollection,
    _storage: storage,
    _now: () => nowFn(),
  }
}
