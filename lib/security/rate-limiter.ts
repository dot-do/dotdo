/**
 * In-Memory Rate Limiter
 *
 * A lightweight, in-memory rate limiter for per-request rate limiting.
 * For persistent rate limiting with SQLite, see lib/rate-limit/sliding-window.ts
 *
 * Features:
 * - Per-identifier request tracking
 * - Fixed window rate limiting
 * - Automatic window reset
 * - Configurable limits and windows
 *
 * @module lib/security/rate-limiter
 */

import { SecurityEventEmitter, SecurityEventType } from './events'

// ============================================================================
// TYPES
// ============================================================================

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  requests: number
  /** Window duration in seconds */
  windowSeconds: number
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** Remaining requests in current window */
  remaining: number
  /** Unix timestamp when the window resets */
  resetAt: number
  /** Total requests allowed per window */
  limit: number
}

export interface RateLimitEntry {
  /** Number of requests in current window */
  count: number
  /** Window start timestamp */
  windowStart: number
}

// ============================================================================
// IN-MEMORY RATE LIMITER
// ============================================================================

/**
 * In-Memory Rate Limiter
 *
 * Tracks requests per identifier with fixed-window rate limiting.
 * Useful for API rate limiting, login attempt limiting, etc.
 *
 * @example
 * ```typescript
 * const limiter = new RateLimiter()
 * limiter.setConfig({ requests: 100, windowSeconds: 60 })
 *
 * const result = limiter.check('user:123')
 * if (!result.allowed) {
 *   throw new Error('Rate limit exceeded')
 * }
 * ```
 */
export class RateLimiter {
  private requests: Map<string, RateLimitEntry> = new Map()
  private config: { requests: number; windowMs: number } = {
    requests: 100,
    windowMs: 60000,
  }
  private eventEmitter?: SecurityEventEmitter

  constructor(eventEmitter?: SecurityEventEmitter) {
    this.eventEmitter = eventEmitter
  }

  /**
   * Set the rate limit configuration
   */
  setConfig(config: RateLimitConfig): void {
    this.config = {
      requests: config.requests,
      windowMs: config.windowSeconds * 1000,
    }
  }

  /**
   * Get the current configuration
   */
  getConfig(): RateLimitConfig {
    return {
      requests: this.config.requests,
      windowSeconds: this.config.windowMs / 1000,
    }
  }

  /**
   * Check if a request is allowed for the given identifier
   *
   * @param identifier - Unique identifier (e.g., IP, user ID, API key)
   * @returns Rate limit result with allowed status and remaining count
   */
  check(identifier: string): RateLimitResult {
    const now = Date.now()
    const entry = this.requests.get(identifier)

    // New window or window expired
    if (!entry || now - entry.windowStart >= this.config.windowMs) {
      this.requests.set(identifier, { count: 1, windowStart: now })
      return {
        allowed: true,
        remaining: this.config.requests - 1,
        resetAt: now + this.config.windowMs,
        limit: this.config.requests,
      }
    }

    // Check if at limit
    if (entry.count >= this.config.requests) {
      // Emit rate limit exceeded event
      this.eventEmitter?.emit({
        type: SecurityEventType.RATE_LIMIT_EXCEEDED,
        timestamp: now,
        details: {
          identifier,
          limit: this.config.requests,
          windowMs: this.config.windowMs,
          requestCount: entry.count,
        },
      })

      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.windowStart + this.config.windowMs,
        limit: this.config.requests,
      }
    }

    // Increment and allow
    entry.count++
    return {
      allowed: true,
      remaining: this.config.requests - entry.count,
      resetAt: entry.windowStart + this.config.windowMs,
      limit: this.config.requests,
    }
  }

  /**
   * Reset the rate limit for an identifier
   */
  reset(identifier: string): void {
    this.requests.delete(identifier)
  }

  /**
   * Reset all rate limits
   */
  resetAll(): void {
    this.requests.clear()
  }

  /**
   * Get the current request count for an identifier
   */
  getCount(identifier: string): number {
    const entry = this.requests.get(identifier)
    if (!entry) return 0

    // Check if window has expired
    if (Date.now() - entry.windowStart >= this.config.windowMs) {
      return 0
    }

    return entry.count
  }

  /**
   * Get all tracked identifiers
   */
  getIdentifiers(): string[] {
    return Array.from(this.requests.keys())
  }

  /**
   * Cleanup expired entries (call periodically to prevent memory leaks)
   */
  cleanup(): number {
    const now = Date.now()
    let removed = 0

    for (const [identifier, entry] of this.requests.entries()) {
      if (now - entry.windowStart >= this.config.windowMs) {
        this.requests.delete(identifier)
        removed++
      }
    }

    return removed
  }
}

// ============================================================================
// RATE LIMITER FACTORY
// ============================================================================

/**
 * Create a rate limiter with common presets
 */
export function createRateLimiter(
  preset: 'strict' | 'standard' | 'relaxed' | RateLimitConfig,
  eventEmitter?: SecurityEventEmitter
): RateLimiter {
  const limiter = new RateLimiter(eventEmitter)

  if (typeof preset === 'object') {
    limiter.setConfig(preset)
  } else {
    const presets: Record<string, RateLimitConfig> = {
      strict: { requests: 10, windowSeconds: 60 },
      standard: { requests: 100, windowSeconds: 60 },
      relaxed: { requests: 1000, windowSeconds: 60 },
    }
    limiter.setConfig(presets[preset])
  }

  return limiter
}
