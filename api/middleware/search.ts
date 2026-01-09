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
 * - EPCIS 2.0 query parameter support (eventType, bizStep, MATCH_epc, etc.)
 * - Standardized response format
 * - Authentication required
 *
 * EPCIS 2.0 Query Parameters (5W+H model):
 * | 5W+H  | EPCIS Field               | Query Parameter           |
 * |-------|---------------------------|---------------------------|
 * | WHO   | source, destination       | EQ_source, EQ_destination |
 * | WHAT  | epcList, parentID         | MATCH_epc, EQ_parentID    |
 * | WHEN  | eventTime, recordTime     | GE_eventTime, LT_eventTime|
 * | WHERE | readPoint, bizLocation    | EQ_readPoint, EQ_bizLocation |
 * | WHY   | bizStep, disposition      | EQ_bizStep, EQ_disposition|
 * | HOW   | bizTransaction            | EQ_bizTransaction         |
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
// EPCIS Constants and Types
// ============================================================================

/**
 * Valid EPCIS 2.0 event types
 */
const VALID_EVENT_TYPES = [
  'ObjectEvent',
  'AggregationEvent',
  'TransactionEvent',
  'TransformationEvent',
  'AssociationEvent',
] as const

type EPCISEventType = typeof VALID_EVENT_TYPES[number]

/**
 * EPCIS query parameter mappings to internal field names
 * Maps EPCIS 2.0 query params to our database schema fields
 */
const EPCIS_PARAM_MAPPINGS: Record<string, string> = {
  // WHY parameters
  'EQ_bizStep': 'bizStep',
  'bizStep': 'bizStep', // alias
  'EQ_disposition': 'disposition',

  // WHERE parameters
  'EQ_bizLocation': 'bizLocation',
  'EQ_readPoint': 'readPoint',

  // WHO parameters
  'EQ_source': 'source',
  'EQ_destination': 'destination',

  // HOW parameters
  'EQ_bizTransaction': 'bizTransaction',

  // WHAT parameters
  'EQ_parentID': 'parentID',
}

/**
 * EPCIS time range parameters (these need special handling)
 */
const EPCIS_TIME_PARAMS = [
  'GE_eventTime',
  'LT_eventTime',
  'GE_recordTime',
  'LT_recordTime',
] as const

/**
 * EPCIS pattern matching parameters (these need special handling)
 */
const EPCIS_PATTERN_PARAMS = ['MATCH_epc'] as const

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

/**
 * Validates an EPCIS event type
 */
function isValidEventType(eventType: string): eventType is EPCISEventType {
  return VALID_EVENT_TYPES.includes(eventType as EPCISEventType)
}

/**
 * Validates an ISO 8601 date string
 */
function isValidISODate(dateStr: string): boolean {
  const date = new Date(dateStr)
  return !isNaN(date.getTime())
}

/**
 * Checks if an EPC pattern matches a value (supports wildcards)
 */
function matchesEPCPattern(pattern: string, value: string): boolean {
  if (pattern.includes('*')) {
    // Convert wildcard pattern to regex
    const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(value)
  }
  return pattern === value
}

/**
 * Filters events based on EPCIS MATCH_epc pattern
 * Matches against epcList and parentID
 */
function matchesEPC(event: Record<string, unknown>, pattern: string): boolean {
  // Check epcList
  const epcList = event.epcList as string[] | undefined
  if (epcList && Array.isArray(epcList)) {
    if (epcList.some(epc => matchesEPCPattern(pattern, epc))) {
      return true
    }
  }

  // Check parentID
  const parentID = event.parentID as string | undefined
  if (parentID && matchesEPCPattern(pattern, parentID)) {
    return true
  }

  return false
}

/**
 * Filters events by time range parameters
 */
function matchesTimeFilter(
  event: Record<string, unknown>,
  filters: Record<string, string>
): boolean {
  // Check GE_eventTime (greater than or equal)
  if (filters.GE_eventTime) {
    const eventTime = new Date(event.eventTime as string)
    const filterTime = new Date(filters.GE_eventTime)
    if (eventTime < filterTime) return false
  }

  // Check LT_eventTime (less than)
  if (filters.LT_eventTime) {
    const eventTime = new Date(event.eventTime as string)
    const filterTime = new Date(filters.LT_eventTime)
    if (eventTime >= filterTime) return false
  }

  // Check GE_recordTime
  if (filters.GE_recordTime) {
    const recordTime = new Date(event.recordTime as string)
    const filterTime = new Date(filters.GE_recordTime)
    if (recordTime < filterTime) return false
  }

  // Check LT_recordTime
  if (filters.LT_recordTime) {
    const recordTime = new Date(event.recordTime as string)
    const filterTime = new Date(filters.LT_recordTime)
    if (recordTime >= filterTime) return false
  }

  return true
}

/**
 * Set of all EPCIS-specific parameter names (for passthrough filtering)
 */
const ALL_EPCIS_PARAMS = new Set([
  'eventType',
  ...EPCIS_TIME_PARAMS,
  ...EPCIS_PATTERN_PARAMS,
  ...Object.keys(EPCIS_PARAM_MAPPINGS),
])

/**
 * Parse and validate EPCIS query parameters
 * Returns { error, dbWhere, clientFilters } where:
 * - error: error message if validation failed
 * - dbWhere: mapped parameters to pass to database
 * - clientFilters: original filter values for response
 * - epcisFilters: filters that need client-side application
 */
function parseEPCISParams(filters: Record<string, string>): {
  error?: string
  dbWhere: Record<string, unknown>
  clientFilters: Record<string, string>
  epcisFilters: {
    eventType?: string
    timeFilters: Record<string, string>
    matchEpc?: string
  }
} {
  const dbWhere: Record<string, unknown> = {}
  const clientFilters: Record<string, string> = { ...filters }
  const epcisFilters: {
    eventType?: string
    timeFilters: Record<string, string>
    matchEpc?: string
  } = { timeFilters: {} }

  // First, pass through any non-EPCIS filters directly to the database
  for (const [key, value] of Object.entries(filters)) {
    if (!ALL_EPCIS_PARAMS.has(key)) {
      dbWhere[key] = value
    }
  }

  // Handle eventType
  if (filters.eventType) {
    if (!isValidEventType(filters.eventType)) {
      return {
        error: 'Invalid event type',
        dbWhere: {},
        clientFilters: {},
        epcisFilters: { timeFilters: {} },
      }
    }
    dbWhere.eventType = filters.eventType
    epcisFilters.eventType = filters.eventType
  }

  // Handle time range parameters
  for (const timeParam of EPCIS_TIME_PARAMS) {
    if (filters[timeParam]) {
      if (!isValidISODate(filters[timeParam])) {
        return {
          error: 'Invalid date format',
          dbWhere: {},
          clientFilters: {},
          epcisFilters: { timeFilters: {} },
        }
      }
      dbWhere[timeParam] = filters[timeParam]
      epcisFilters.timeFilters[timeParam] = filters[timeParam]
    }
  }

  // Validate time range (GE should be before LT)
  if (filters.GE_eventTime && filters.LT_eventTime) {
    const geTime = new Date(filters.GE_eventTime)
    const ltTime = new Date(filters.LT_eventTime)
    if (geTime >= ltTime) {
      return {
        error: 'Invalid time range: start must be before end',
        dbWhere: {},
        clientFilters: {},
        epcisFilters: { timeFilters: {} },
      }
    }
  }

  // Handle MATCH_epc pattern
  if (filters.MATCH_epc) {
    dbWhere.MATCH_epc = filters.MATCH_epc
    epcisFilters.matchEpc = filters.MATCH_epc
  }

  // Handle mapped EPCIS parameters
  for (const [param, field] of Object.entries(EPCIS_PARAM_MAPPINGS)) {
    if (filters[param]) {
      dbWhere[field] = filters[param]
    }
  }

  return { dbWhere, clientFilters, epcisFilters }
}

/**
 * Apply EPCIS filters to results (client-side filtering)
 * This handles filtering that can't be done at the database level
 */
function applyEPCISFilters(
  results: unknown[],
  epcisFilters: {
    eventType?: string
    timeFilters: Record<string, string>
    matchEpc?: string
  },
  allFilters: Record<string, string>
): unknown[] {
  let filtered = results as Record<string, unknown>[]

  // Filter by eventType
  if (epcisFilters.eventType) {
    filtered = filtered.filter(event => event.eventType === epcisFilters.eventType)
  }

  // Filter by time range
  if (Object.keys(epcisFilters.timeFilters).length > 0) {
    filtered = filtered.filter(event => matchesTimeFilter(event, epcisFilters.timeFilters))
  }

  // Filter by MATCH_epc pattern
  if (epcisFilters.matchEpc) {
    filtered = filtered.filter(event => matchesEPC(event, epcisFilters.matchEpc!))
  }

  // Apply mapped field filters (EQ_bizStep -> bizStep, etc.)
  for (const [param, field] of Object.entries(EPCIS_PARAM_MAPPINGS)) {
    if (allFilters[param]) {
      filtered = filtered.filter(event => event[field] === allFilters[param])
    }
  }

  return filtered
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

      // Parse and validate EPCIS query parameters
      const epcisResult = parseEPCISParams(filters)
      if (epcisResult.error) {
        return c.json({ error: epcisResult.error }, 400)
      }

      // Get database and perform search
      const db = c.get('db') as { query: Record<string, DbQuery> } | undefined
      if (!db) {
        return c.json({ error: 'Database not available' }, 500)
      }

      const queryHandler = db.query[type]

      try {
        // Build where clause with query and EPCIS-mapped filters
        const where: Record<string, unknown> = { ...epcisResult.dbWhere }
        if (q) {
          where.q = q
        }

        if (queryHandler) {
          const rawResults = await queryHandler.findMany({
            where,
            limit,
            offset,
          })
          // Apply EPCIS filters client-side (for mock data compatibility)
          results = applyEPCISFilters(rawResults, epcisResult.epcisFilters, filters)
          total = results.length
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

          // Parse and validate EPCIS query parameters
          const epcisResult = parseEPCISParams(filters)
          if (epcisResult.error) {
            return ctx.json({ error: epcisResult.error }, 400)
          }

          // Get database and perform search
          const db = c.get('db') as { query: Record<string, DbQuery> } | undefined
          if (!db) {
            return ctx.json({ error: 'Database not available' }, 500)
          }

          const queryHandler = db.query[type]

          try {
            // Build where clause with query and EPCIS-mapped filters
            const where: Record<string, unknown> = { ...epcisResult.dbWhere }
            if (q) {
              where.q = q
            }

            if (queryHandler) {
              const rawResults = await queryHandler.findMany({
                where,
                limit,
                offset,
              })
              // Apply EPCIS filters client-side (for mock data compatibility)
              results = applyEPCISFilters(rawResults, epcisResult.epcisFilters, filters)
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
