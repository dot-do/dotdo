/**
 * Rate limit middleware
 *
 * TDD RED PHASE: Stub implementation that will fail tests.
 */

import type { Context, MiddlewareHandler } from 'hono'

export interface RateLimitBinding {
  limit: (options: { key: string }) => Promise<{
    success: boolean
    remaining: number
  }>
}

export interface RateLimitConfig {
  binding: RateLimitBinding
  keyGenerator?: (c: Context) => string
  limit?: number
  onRateLimited?: (c: Context, remaining: number) => Response | Promise<Response>
}

// TDD RED: Stub - will fail tests
export function rateLimit(_config: RateLimitConfig): MiddlewareHandler {
  throw new Error('rateLimit middleware not implemented')
}

export default rateLimit
