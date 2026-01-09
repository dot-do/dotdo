/**
 * Cloudflare Rate Limit Binding Wrapper
 *
 * Wraps the CF Rate Limit binding to provide a cleaner API
 * and additional utility methods.
 *
 * Usage:
 * ```typescript
 * const wrapper = new RateLimitWrapper(env.RATE_LIMIT_API)
 * const result = await wrapper.checkLimit('user:123')
 * if (!result.success) {
 *   // Handle rate limit exceeded
 * }
 * ```
 */

/**
 * The interface for Cloudflare's Rate Limit binding
 */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean; remaining: number }>
}

/**
 * Result from a rate limit check
 */
export interface RateLimitResult {
  success: boolean
  remaining: number
}

/**
 * Options for building a composite rate limit key
 */
export interface BuildKeyOptions {
  userId?: string
  endpoint?: string
  action?: string
  [key: string]: string | undefined
}

/**
 * Wrapper class for Cloudflare Rate Limit bindings.
 *
 * Provides a cleaner API with additional utility methods for:
 * - Checking rate limits
 * - Building composite keys
 * - Getting remaining counts
 */
export class RateLimitWrapper {
  private binding: RateLimitBinding
  private lastResults: Map<string, RateLimitResult> = new Map()

  constructor(binding: RateLimitBinding) {
    this.binding = binding
  }

  /**
   * Check the rate limit for a given key.
   * This consumes one request from the limit.
   *
   * @param key - The rate limit key (e.g., 'user:123' or 'api:/users/create')
   * @returns The rate limit result with success and remaining count
   * @throws Error if key is empty
   */
  async checkLimit(key: string): Promise<RateLimitResult> {
    if (!key) {
      throw new Error('Rate limit key cannot be empty')
    }

    const result = await this.binding.limit({ key })
    this.lastResults.set(key, result)
    return result
  }

  /**
   * Check if a request is allowed for the given key.
   * This consumes one request from the limit.
   *
   * @param key - The rate limit key
   * @returns true if the request is allowed, false if rate limited
   */
  async isAllowed(key: string): Promise<boolean> {
    const result = await this.checkLimit(key)
    return result.success
  }

  /**
   * Get the remaining count for a key.
   * Returns the cached remaining count from the last check.
   * If no previous check exists, makes a new request (which consumes one from the limit).
   *
   * @param key - The rate limit key
   * @returns The number of remaining requests allowed
   */
  async getRemainingCount(key: string): Promise<number> {
    // Return cached result if available
    const cached = this.lastResults.get(key)
    if (cached !== undefined) {
      return cached.remaining
    }
    // Otherwise, make a new request
    const result = await this.checkLimit(key)
    return result.remaining
  }

  /**
   * Build a composite rate limit key from options.
   *
   * @param options - Key components (userId, endpoint, action, etc.)
   * @returns A formatted key string
   *
   * @example
   * ```typescript
   * wrapper.buildKey({ userId: '123' }) // 'user:123'
   * wrapper.buildKey({ endpoint: '/api/users' }) // 'endpoint:/api/users'
   * wrapper.buildKey({ userId: '123', endpoint: '/api/users', action: 'create' })
   * // 'user:123:endpoint:/api/users:action:create'
   * ```
   */
  buildKey(options: BuildKeyOptions): string {
    const parts: string[] = []

    if (options.userId) {
      parts.push(`user:${options.userId}`)
    }

    if (options.endpoint) {
      parts.push(`endpoint:${options.endpoint}`)
    }

    if (options.action) {
      parts.push(`action:${options.action}`)
    }

    // Handle any additional custom keys
    for (const [key, value] of Object.entries(options)) {
      if (value && !['userId', 'endpoint', 'action'].includes(key)) {
        parts.push(`${key}:${value}`)
      }
    }

    return parts.join(':')
  }
}

export default RateLimitWrapper
