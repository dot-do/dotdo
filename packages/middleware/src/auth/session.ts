/**
 * Session middleware
 *
 * TDD RED PHASE: Stub implementation that will fail tests.
 */

import type { MiddlewareHandler } from 'hono'

export interface SessionConfig {
  cookieName?: string
  validateSession?: (token: string) => Promise<{
    userId: string
    email?: string
    role?: 'admin' | 'user'
    expiresAt?: Date
  } | null>
  sessionCache?: KVNamespace
  sessionCacheTtl?: number
}

// TDD RED: Stub - will fail tests
export function sessionMiddleware(_config?: SessionConfig): MiddlewareHandler {
  throw new Error('sessionMiddleware not implemented')
}

export default sessionMiddleware
