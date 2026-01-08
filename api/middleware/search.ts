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

interface User {
  id: string
  role?: 'admin' | 'user'
  permissions?: string[]
}

interface LinkedAccount {
  accessToken: string
  expiresAt?: string
  scopes?: string[]
}

interface Integration {
  search: (resource: string, params: {
    accessToken: string
    q: string
    limit: number
    offset: number
    filters: Record<string, string>
  }) => Promise<{ results: unknown[]; total: number }>
}

interface DbQuery {
  findMany: (params: {
    where?: Record<string, unknown>
    limit?: number
    offset?: number
  }) => Promise<unknown[]>
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validates that a type name is safe (no path traversal, etc.)
 */
function isValidTypeName(type: string): boolean {
  // Must be alphanumeric with optional colon for provider types
  // No path traversal characters, no special HTML/script chars
  return /^[a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)?$/.test(type)
}

/**
 * Checks if a token has expired
 */
function isTokenExpired(expiresAt?: string): boolean {
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() < Date.now()
}

/**
 * Checks if the account has all required scopes
 */
function hasRequiredScopes(accountScopes: string[] | undefined, requiredScopes: string[]): boolean {
  if (!requiredScopes || requiredScopes.length === 0) return true
  if (!accountScopes) return true // If no scopes on account, assume full access (legacy)
  return requiredScopes.every(scope => accountScopes.includes(scope))
}

// ============================================================================
// Middleware Factory
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
export function search(config?: SearchConfig): MiddlewareHandler {
  const localTypes = new Set(config?.localTypes || [])
  const providerTypes = config?.providerTypes || {}
  const requirePermission = config?.requirePermission || false

  const app = new Hono()

  // Handle non-GET methods with 405
  app.all('/:type', async (c) => {
    if (c.req.method !== 'GET') {
      return c.json({ error: 'Method not allowed' }, 405)
    }

    // Check authentication
    const user = c.get('user') as User | undefined
    if (!user) {
      c.header('WWW-Authenticate', 'Bearer')
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const type = c.req.param('type')

    // Validate type name (security check)
    if (!isValidTypeName(type)) {
      return c.json({ error: 'Unknown type' }, 404)
    }

    // Parse query parameters
    const q = c.req.query('q') || ''
    const limitParam = c.req.query('limit')
    const offsetParam = c.req.query('offset')

    // Handle non-numeric limit/offset
    let limit = 20
    if (limitParam !== undefined && limitParam !== '') {
      const parsed = parseInt(limitParam, 10)
      if (isNaN(parsed)) {
        limit = 20 // Use default for invalid
      } else if (parsed < 0) {
        limit = 20 // Use default for negative
      } else {
        limit = Math.min(parsed, 100) // Cap at 100
      }
    }

    let offset = 0
    if (offsetParam !== undefined && offsetParam !== '') {
      const parsed = parseInt(offsetParam, 10)
      if (isNaN(parsed)) {
        offset = 0 // Use default for invalid
      } else if (parsed < 0) {
        offset = 0 // Use default for negative
      } else {
        offset = parsed
      }
    }

    // Extract filters (exclude reserved params)
    const filters: Record<string, string> = {}
    const allQueries = c.req.query()
    for (const [key, value] of Object.entries(allQueries)) {
      if (!['q', 'limit', 'offset'].includes(key) && typeof value === 'string') {
        filters[key] = value
      }
    }

    let results: unknown[] = []
    let total = 0

    // Check if it's a provider type (contains colon)
    if (type.includes(':')) {
      // Provider search (github:issues, github:repos, etc.)
      if (!(type in providerTypes)) {
        return c.json({ error: 'Unknown type' }, 404)
      }

      const [provider, resource] = type.split(':')
      const providerConfig = providerTypes[type]

      // Get linked account
      const linkedAccounts = c.get('linkedAccounts') as { get: (provider: string) => Promise<LinkedAccount | null> } | undefined
      if (!linkedAccounts) {
        return c.json({ error: 'Account not linked. Please connect your account.' }, 403)
      }

      const account = await linkedAccounts.get(provider)
      if (!account) {
        return c.json({ error: 'Account not linked. Please connect your account.' }, 403)
      }

      // Check token expiration
      if (isTokenExpired(account.expiresAt)) {
        return c.json({ error: 'Account token expired. Please reconnect your account.' }, 403)
      }

      // Check required scopes
      if (!hasRequiredScopes(account.scopes, providerConfig.scopes)) {
        return c.json({ error: 'Insufficient scope permissions. Please reconnect with required permissions.' }, 403)
      }

      // Get integration and perform search
      const integrations = c.get('integrations') as { get: (provider: string) => Promise<Integration | null> } | undefined
      if (!integrations) {
        return c.json({ error: 'Integration not available' }, 502)
      }

      const integration = await integrations.get(provider)
      if (!integration) {
        return c.json({ error: 'Integration not available' }, 502)
      }

      try {
        const searchResult = await integration.search(resource, {
          accessToken: account.accessToken,
          q,
          limit,
          offset,
          filters,
        })
        results = searchResult.results
        total = searchResult.total
      } catch (error) {
        // Handle provider errors
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message.includes('rate limit')) {
          return c.json({ error: 'Provider rate limit exceeded' }, 429)
        }
        if (message.includes('Timeout') || message.includes('timeout')) {
          return c.json({ error: 'Provider request timeout' }, 504)
        }
        return c.json({ error: 'Provider request failed' }, 502)
      }

    } else {
      // Local search (SQLite)
      if (!localTypes.has(type)) {
        return c.json({ error: 'Unknown type' }, 404)
      }

      // Check permissions if required
      if (requirePermission) {
        const isAdmin = user.role === 'admin'
        const hasPermission = user.permissions?.includes(`search:${type}`)

        if (!isAdmin && !hasPermission) {
          return c.json({ error: 'Permission denied. Access to this type is not allowed.' }, 403)
        }
      }

      // Get database and perform search
      const db = c.get('db') as { query: Record<string, DbQuery> } | undefined
      if (!db) {
        return c.json({ error: 'Database not available' }, 500)
      }

      const queryHandler = db.query[type]

      try {
        // Build where clause with query and filters
        const where: Record<string, unknown> = { ...filters }
        if (q) {
          where.q = q
        }

        if (queryHandler) {
          results = await queryHandler.findMany({
            where,
            limit,
            offset,
          })
          total = results.length // In a real implementation, we'd have a separate count query
        } else {
          // Type is configured but no query handler - return empty results
          results = []
          total = 0
        }
      } catch (error) {
        // Handle database errors - don't expose internal error messages
        return c.json({ error: 'Search failed' }, 500)
      }
    }

    const response: SearchResponse = {
      type,
      query: q,
      filters,
      results,
      total,
      limit,
      offset,
    }

    return c.json(response)
  })

  // Return middleware that routes to our app
  return async (c, next) => {
    // Get the path after /api/search
    const path = c.req.path
    const searchPrefix = '/api/search'

    if (path.startsWith(searchPrefix)) {
      const subPath = path.slice(searchPrefix.length) || '/'

      // Create a new request with the sub-path for our internal router
      const url = new URL(c.req.url)
      url.pathname = subPath

      // Copy over context variables
      const newApp = new Hono()

      // Handle non-GET methods with 405
      newApp.all('/:type', async (ctx) => {
        if (ctx.req.method !== 'GET') {
          return ctx.json({ error: 'Method not allowed' }, 405)
        }

        // Check authentication
        const user = c.get('user') as User | undefined
        if (!user) {
          ctx.header('WWW-Authenticate', 'Bearer')
          return ctx.json({ error: 'Unauthorized' }, 401)
        }

        const type = ctx.req.param('type')

        // Validate type name (security check)
        if (!isValidTypeName(type)) {
          return ctx.json({ error: 'Unknown type' }, 404)
        }

        // Parse query parameters
        const q = ctx.req.query('q') || ''
        const limitParam = ctx.req.query('limit')
        const offsetParam = ctx.req.query('offset')

        // Handle non-numeric limit/offset
        let limit = 20
        if (limitParam !== undefined && limitParam !== '') {
          const parsed = parseInt(limitParam, 10)
          if (isNaN(parsed)) {
            limit = 20
          } else if (parsed < 0) {
            limit = 20
          } else {
            limit = Math.min(parsed, 100)
          }
        }

        let offset = 0
        if (offsetParam !== undefined && offsetParam !== '') {
          const parsed = parseInt(offsetParam, 10)
          if (isNaN(parsed)) {
            offset = 0
          } else if (parsed < 0) {
            offset = 0
          } else {
            offset = parsed
          }
        }

        // Extract filters (exclude reserved params)
        const filters: Record<string, string> = {}
        const allQueries = ctx.req.query()
        for (const [key, value] of Object.entries(allQueries)) {
          if (!['q', 'limit', 'offset'].includes(key) && typeof value === 'string') {
            filters[key] = value
          }
        }

        let results: unknown[] = []
        let total = 0

        // Check if it's a provider type (contains colon)
        if (type.includes(':')) {
          // Provider search
          if (!(type in providerTypes)) {
            return ctx.json({ error: 'Unknown type' }, 404)
          }

          const [provider, resource] = type.split(':')
          const providerConfig = providerTypes[type]

          // Get linked account
          const linkedAccounts = c.get('linkedAccounts') as { get: (provider: string) => Promise<LinkedAccount | null> } | undefined
          if (!linkedAccounts) {
            return ctx.json({ error: 'Account not linked. Please connect your account.' }, 403)
          }

          const account = await linkedAccounts.get(provider)
          if (!account) {
            return ctx.json({ error: 'Account not linked. Please connect your account.' }, 403)
          }

          // Check token expiration
          if (isTokenExpired(account.expiresAt)) {
            return ctx.json({ error: 'Account token expired. Please reconnect your account.' }, 403)
          }

          // Check required scopes
          if (!hasRequiredScopes(account.scopes, providerConfig.scopes)) {
            return ctx.json({ error: 'Insufficient scope permissions. Please reconnect with required permissions.' }, 403)
          }

          // Get integration and perform search
          const integrations = c.get('integrations') as { get: (provider: string) => Promise<Integration | null> } | undefined
          if (!integrations) {
            return ctx.json({ error: 'Integration not available' }, 502)
          }

          const integration = await integrations.get(provider)
          if (!integration) {
            return ctx.json({ error: 'Integration not available' }, 502)
          }

          try {
            const searchResult = await integration.search(resource, {
              accessToken: account.accessToken,
              q,
              limit,
              offset,
              filters,
            })
            results = searchResult.results
            total = searchResult.total
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error'
            if (message.includes('rate limit')) {
              return ctx.json({ error: 'Provider rate limit exceeded' }, 429)
            }
            if (message.includes('Timeout') || message.includes('timeout')) {
              return ctx.json({ error: 'Provider request timeout' }, 504)
            }
            return ctx.json({ error: 'Provider request failed' }, 502)
          }

        } else {
          // Local search (SQLite)
          if (!localTypes.has(type)) {
            return ctx.json({ error: 'Unknown type' }, 404)
          }

          // Check permissions if required
          if (requirePermission) {
            const isAdmin = user.role === 'admin'
            const hasPermission = user.permissions?.includes(`search:${type}`)

            if (!isAdmin && !hasPermission) {
              return ctx.json({ error: 'Permission denied. Access to this type is not allowed.' }, 403)
            }
          }

          // Get database and perform search
          const db = c.get('db') as { query: Record<string, DbQuery> } | undefined
          if (!db) {
            return ctx.json({ error: 'Database not available' }, 500)
          }

          const queryHandler = db.query[type]

          try {
            // Build where clause with query and filters
            const where: Record<string, unknown> = { ...filters }
            if (q) {
              where.q = q
            }

            if (queryHandler) {
              results = await queryHandler.findMany({
                where,
                limit,
                offset,
              })
              total = results.length
            } else {
              // Type is configured but no query handler - return empty results
              results = []
              total = 0
            }
          } catch {
            return ctx.json({ error: 'Search failed' }, 500)
          }
        }

        const response: SearchResponse = {
          type,
          query: q,
          filters,
          results,
          total,
          limit,
          offset,
        }

        return ctx.json(response)
      })

      // Route to empty path returns 404
      newApp.all('/', () => {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      })

      // Handle the request
      const response = await newApp.fetch(
        new Request(url.toString(), {
          method: c.req.method,
          headers: c.req.raw.headers,
        })
      )

      return response
    }

    await next()
  }
}

export default search
