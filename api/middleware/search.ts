import type { Context, MiddlewareHandler } from 'hono'
import { Hono } from 'hono'

/**
 * Search Middleware
 *
 * Handles search requests for both local and provider types.
 * Supports full-text search, pagination, and filtering.
 *
 * Features:
 * - Local search (SQLite FTS) for configured types
 * - Provider search (GitHub, etc.) via linked accounts
 * - Query params: q, limit, offset, and arbitrary filters
 * - Standardized response format
 * - Authentication required
 *
 * NOT YET IMPLEMENTED - This is a stub for TDD.
 */

// ============================================================================
// Types
// ============================================================================

export interface ProviderTypeConfig {
  scopes: string[]
}

export interface SearchConfig {
  localTypes?: string[]
  providerTypes?: Record<string, ProviderTypeConfig>
  requirePermission?: boolean
}

export interface SearchResponse {
  type: string
  query: string
  filters: Record<string, string>
  results: unknown[]
  total: number
  limit: number
  offset: number
}

// ============================================================================
// Middleware Factory (Stub)
// ============================================================================

/**
 * Creates a search middleware for handling search requests.
 *
 * @param config - Search configuration
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * app.use('/api/search/*', search({
 *   localTypes: ['tasks', 'notes', 'projects'],
 *   providerTypes: {
 *     'github:issues': { scopes: ['repo'] },
 *     'github:repos': { scopes: ['repo'] },
 *   },
 * }))
 * ```
 */
export function search(_config?: SearchConfig): MiddlewareHandler {
  // TODO: Implement search middleware
  // This is a stub that will cause all tests to fail

  const app = new Hono()

  // Stub route that returns 501 Not Implemented
  app.get('/:type', (c) => {
    return c.json({ error: 'Search middleware not implemented' }, 501)
  })

  return async (c, next) => {
    // Stub: just pass through to next middleware
    // The actual implementation would handle search routing
    await next()
  }
}

export default search
