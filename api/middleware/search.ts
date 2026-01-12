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
 * - Index hints for query optimization
 * - Query plan caching for repeated queries
 * - Cursor-based pagination support
 * - Search analytics hooks
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

/**
 * Index hints for query optimization.
 * Maps field names to recommended indexes for common query patterns.
 */
export interface IndexHint {
  /** Primary index field for this query pattern */
  indexField: string
  /** Optional secondary fields for composite indexes */
  compositeFields?: string[]
  /** Whether full-text search index should be used */
  useFTS?: boolean
  /** Suggested index type (btree, hash, gin, etc.) */
  indexType?: 'btree' | 'hash' | 'gin' | 'gist'
}

/**
 * Analytics event for search operations
 */
export interface SearchAnalyticsEvent {
  /** Type being searched */
  type: string
  /** Search query string */
  query: string
  /** Filters applied */
  filters: Record<string, string>
  /** Number of results returned */
  resultCount: number
  /** Total matching records */
  totalCount: number
  /** Time taken in milliseconds */
  durationMs: number
  /** User ID performing search */
  userId: string
  /** Timestamp of search */
  timestamp: number
  /** Whether query plan cache was hit */
  cacheHit: boolean
  /** Index hints that were suggested */
  indexHints?: IndexHint[]
}

/**
 * Search analytics hook function type
 */
export type SearchAnalyticsHook = (event: SearchAnalyticsEvent) => void | Promise<void>

/**
 * Cached query plan entry
 */
interface QueryPlanCacheEntry {
  /** Hash of the query parameters */
  hash: string
  /** Computed where clause */
  where: Record<string, unknown>
  /** Index hints for this query */
  indexHints: IndexHint[]
  /** Timestamp when cached */
  cachedAt: number
  /** Number of times this cache entry was hit */
  hitCount: number
}

export interface SearchConfig {
  localTypes?: string[]
  providerTypes?: Record<string, ProviderTypeConfig>
  requirePermission?: boolean
  /** Custom index hints per type */
  indexHints?: Record<string, IndexHint[]>
  /** Enable query plan caching (default: true) */
  enableQueryPlanCache?: boolean
  /** Query plan cache TTL in milliseconds (default: 5 minutes) */
  queryPlanCacheTTL?: number
  /** Maximum cache entries (default: 1000) */
  maxCacheEntries?: number
  /** Analytics hook for search events */
  analyticsHook?: SearchAnalyticsHook
  /** Enable cursor-based pagination (default: false for backward compat) */
  enableCursorPagination?: boolean
}

export interface SearchResponse {
  type: string
  query: string
  filters: Record<string, string>
  results: unknown[]
  total: number
  limit: number
  offset: number
  /** Next cursor for cursor-based pagination (when enabled) */
  nextCursor?: string
  /** Previous cursor for cursor-based pagination (when enabled) */
  prevCursor?: string
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
// Query Plan Cache
// ============================================================================

/**
 * Default index hints for common query patterns.
 * These suggest optimal indexes based on the fields being queried.
 */
const DEFAULT_INDEX_HINTS: Record<string, IndexHint[]> = {
  // Time-based queries should use btree index on eventTime
  eventTime: [
    { indexField: 'eventTime', indexType: 'btree' },
  ],
  // Text search queries should use FTS
  q: [
    { indexField: 'title', useFTS: true },
    { indexField: 'description', useFTS: true },
  ],
  // Status queries benefit from hash index
  status: [
    { indexField: 'status', indexType: 'hash' },
  ],
  // Combined time + status queries
  'eventTime+status': [
    { indexField: 'eventTime', compositeFields: ['status'], indexType: 'btree' },
  ],
  // EPCIS bizStep queries
  bizStep: [
    { indexField: 'bizStep', indexType: 'hash' },
  ],
  // EPCIS bizLocation queries
  bizLocation: [
    { indexField: 'bizLocation', indexType: 'btree' },
  ],
}

/**
 * LRU-style query plan cache with TTL support.
 * Caches computed where clauses and index hints to avoid recomputation.
 */
class QueryPlanCache {
  private cache: Map<string, QueryPlanCacheEntry> = new Map()
  private readonly maxEntries: number
  private readonly ttlMs: number

  constructor(maxEntries = 1000, ttlMs = 5 * 60 * 1000) {
    this.maxEntries = maxEntries
    this.ttlMs = ttlMs
  }

  /**
   * Generate a hash key from query parameters
   */
  private generateHash(
    type: string,
    q: string,
    filters: Record<string, string>
  ): string {
    // Simple hash combining type, query, and sorted filter keys/values
    const filterStr = Object.entries(filters)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&')
    return `${type}:${q}:${filterStr}`
  }

  /**
   * Get a cached query plan if available and not expired
   */
  get(
    type: string,
    q: string,
    filters: Record<string, string>
  ): QueryPlanCacheEntry | null {
    const hash = this.generateHash(type, q, filters)
    const entry = this.cache.get(hash)

    if (!entry) {
      return null
    }

    // Check TTL
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(hash)
      return null
    }

    // Update hit count
    entry.hitCount++
    return entry
  }

  /**
   * Cache a query plan
   */
  set(
    type: string,
    q: string,
    filters: Record<string, string>,
    where: Record<string, unknown>,
    indexHints: IndexHint[]
  ): void {
    const hash = this.generateHash(type, q, filters)

    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxEntries) {
      // Remove the oldest entry (first in map)
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }

    this.cache.set(hash, {
      hash,
      where,
      indexHints,
      cachedAt: Date.now(),
      hitCount: 0,
    })
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  stats(): { size: number; maxEntries: number; ttlMs: number } {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
    }
  }
}

// Global query plan cache instance
let globalQueryPlanCache: QueryPlanCache | null = null

/**
 * Get or create the global query plan cache
 */
function getQueryPlanCache(maxEntries?: number, ttlMs?: number): QueryPlanCache {
  if (!globalQueryPlanCache) {
    globalQueryPlanCache = new QueryPlanCache(maxEntries, ttlMs)
  }
  return globalQueryPlanCache
}

// ============================================================================
// Index Hint Generation
// ============================================================================

/**
 * Compute index hints based on query parameters.
 * Analyzes the query and filters to suggest optimal indexes.
 */
function computeIndexHints(
  type: string,
  q: string,
  filters: Record<string, string>,
  customHints?: Record<string, IndexHint[]>
): IndexHint[] {
  const hints: IndexHint[] = []
  const usedFields = new Set<string>()

  // Check for full-text search query
  if (q && q.trim().length > 0) {
    const ftsHints = customHints?.q || DEFAULT_INDEX_HINTS.q
    if (ftsHints) {
      hints.push(...ftsHints)
      usedFields.add('q')
    }
  }

  // Check for time range filters (these benefit most from indexes)
  const hasTimeFilter = Object.keys(filters).some(k =>
    k.startsWith('GE_') || k.startsWith('LT_')
  )
  if (hasTimeFilter) {
    const timeHints = customHints?.eventTime || DEFAULT_INDEX_HINTS.eventTime
    if (timeHints) {
      hints.push(...timeHints)
      usedFields.add('eventTime')
    }
  }

  // Check for status filter
  if (filters.status) {
    const statusHints = customHints?.status || DEFAULT_INDEX_HINTS.status
    if (statusHints) {
      hints.push(...statusHints)
      usedFields.add('status')
    }
  }

  // Check for bizStep filter (EPCIS)
  if (filters.bizStep || filters.EQ_bizStep) {
    const bizStepHints = customHints?.bizStep || DEFAULT_INDEX_HINTS.bizStep
    if (bizStepHints) {
      hints.push(...bizStepHints)
      usedFields.add('bizStep')
    }
  }

  // Check for bizLocation filter (EPCIS)
  if (filters.EQ_bizLocation) {
    const bizLocHints = customHints?.bizLocation || DEFAULT_INDEX_HINTS.bizLocation
    if (bizLocHints) {
      hints.push(...bizLocHints)
      usedFields.add('bizLocation')
    }
  }

  // Composite index hint for time + status queries
  if (usedFields.has('eventTime') && usedFields.has('status')) {
    const compositeHints = customHints?.['eventTime+status'] || DEFAULT_INDEX_HINTS['eventTime+status']
    if (compositeHints) {
      // Replace individual hints with composite
      hints.push(...compositeHints)
    }
  }

  // Add type-specific custom hints
  if (customHints?.[type]) {
    hints.push(...customHints[type])
  }

  return hints
}

// ============================================================================
// Pagination Optimization
// ============================================================================

/**
 * Encode cursor for cursor-based pagination
 */
function encodeCursor(offset: number, sortField?: string, sortValue?: unknown): string {
  const cursorData = { o: offset, sf: sortField, sv: sortValue }
  return Buffer.from(JSON.stringify(cursorData)).toString('base64url')
}

/**
 * Decode cursor for cursor-based pagination
 */
function decodeCursor(cursor: string): { offset: number; sortField?: string; sortValue?: unknown } | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    return {
      offset: decoded.o || 0,
      sortField: decoded.sf,
      sortValue: decoded.sv,
    }
  } catch {
    return null
  }
}

/**
 * Compute pagination cursors for the response
 */
function computePaginationCursors(
  offset: number,
  limit: number,
  total: number,
  results: unknown[]
): { nextCursor?: string; prevCursor?: string } {
  const cursors: { nextCursor?: string; prevCursor?: string } = {}

  // Next cursor if more results exist
  if (offset + results.length < total) {
    cursors.nextCursor = encodeCursor(offset + limit)
  }

  // Previous cursor if not at beginning
  if (offset > 0) {
    cursors.prevCursor = encodeCursor(Math.max(0, offset - limit))
  }

  return cursors
}

// ============================================================================
// Analytics
// ============================================================================

/**
 * Emit a search analytics event
 */
async function emitSearchAnalytics(
  hook: SearchAnalyticsHook | undefined,
  event: SearchAnalyticsEvent
): Promise<void> {
  if (!hook) return

  try {
    await hook(event)
  } catch {
    // Silently ignore analytics errors to not affect search functionality
  }
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
 * Reserved query parameters that are not treated as filters
 */
const RESERVED_PARAMS = new Set(['q', 'limit', 'offset', 'cursor'])

/**
 * Parse limit parameter with defaults and constraints
 */
function parseLimit(limitParam: string | undefined): number {
  if (limitParam === undefined || limitParam === '') {
    return 20 // Default
  }
  const parsed = parseInt(limitParam, 10)
  if (isNaN(parsed) || parsed < 0) {
    return 20 // Use default for invalid/negative
  }
  return Math.min(parsed, 100) // Cap at 100
}

/**
 * Parse offset parameter with defaults and constraints
 */
function parseOffset(offsetParam: string | undefined, cursorParam: string | undefined): number {
  // If cursor is provided, decode and use its offset
  if (cursorParam) {
    const decoded = decodeCursor(cursorParam)
    if (decoded) {
      return decoded.offset
    }
  }

  if (offsetParam === undefined || offsetParam === '') {
    return 0 // Default
  }
  const parsed = parseInt(offsetParam, 10)
  if (isNaN(parsed) || parsed < 0) {
    return 0 // Use default for invalid/negative
  }
  return parsed
}

/**
 * Extract filter parameters from query string
 */
function extractFilters(allQueries: Record<string, string>): Record<string, string> {
  const filters: Record<string, string> = {}
  for (const [key, value] of Object.entries(allQueries)) {
    if (!RESERVED_PARAMS.has(key) && typeof value === 'string') {
      filters[key] = value
    }
  }
  return filters
}

/**
 * Search execution context with all dependencies
 */
interface SearchExecutionContext {
  type: string
  q: string
  limit: number
  offset: number
  filters: Record<string, string>
  user: User
  db?: { query: Record<string, DbQuery> }
  linkedAccounts?: { get: (provider: string) => Promise<LinkedAccount | null> }
  integrations?: { get: (provider: string) => Promise<Integration | null> }
}

/**
 * Search execution result
 */
interface SearchExecutionResult {
  results: unknown[]
  total: number
  indexHints: IndexHint[]
  cacheHit: boolean
  error?: { message: string; status: number }
}

/**
 * Execute a local search with query plan caching and index hints
 */
async function executeLocalSearch(
  ctx: SearchExecutionContext,
  localTypes: Set<string>,
  requirePermission: boolean,
  queryPlanCache: QueryPlanCache | null,
  customIndexHints?: Record<string, IndexHint[]>
): Promise<SearchExecutionResult> {
  const { type, q, limit, offset, filters, user, db } = ctx

  // Check if type is configured
  if (!localTypes.has(type)) {
    return {
      results: [],
      total: 0,
      indexHints: [],
      cacheHit: false,
      error: { message: 'Unknown type', status: 404 },
    }
  }

  // Check permissions if required
  if (requirePermission) {
    const isAdmin = user.role === 'admin'
    const hasPermission = user.permissions?.includes(`search:${type}`)
    if (!isAdmin && !hasPermission) {
      return {
        results: [],
        total: 0,
        indexHints: [],
        cacheHit: false,
        error: { message: 'Permission denied. Access to this type is not allowed.', status: 403 },
      }
    }
  }

  // Parse and validate EPCIS query parameters
  const epcisResult = parseEPCISParams(filters)
  if (epcisResult.error) {
    return {
      results: [],
      total: 0,
      indexHints: [],
      cacheHit: false,
      error: { message: epcisResult.error, status: 400 },
    }
  }

  // Check database availability
  if (!db) {
    return {
      results: [],
      total: 0,
      indexHints: [],
      cacheHit: false,
      error: { message: 'Database not available', status: 500 },
    }
  }

  const queryHandler = db.query[type]

  // Check query plan cache
  let cacheHit = false
  let indexHints: IndexHint[] = []
  let where: Record<string, unknown>

  const cachedPlan = queryPlanCache?.get(type, q, filters)
  if (cachedPlan) {
    // Cache hit - reuse computed where clause and index hints
    cacheHit = true
    where = cachedPlan.where
    indexHints = cachedPlan.indexHints
  } else {
    // Cache miss - compute where clause and index hints
    where = { ...epcisResult.dbWhere }
    if (q) {
      where.q = q
    }

    // Compute index hints for this query pattern
    indexHints = computeIndexHints(type, q, filters, customIndexHints)

    // Add FTS hint if full-text query is present
    if (q && q.trim().length > 0) {
      // Add hint for using FTS index
      const hasFTSHint = indexHints.some(h => h.useFTS)
      if (!hasFTSHint) {
        indexHints.push({ indexField: 'content', useFTS: true })
      }
    }

    // Cache the query plan
    queryPlanCache?.set(type, q, filters, where, indexHints)
  }

  // Execute the search
  try {
    if (queryHandler) {
      const rawResults = await queryHandler.findMany({
        where,
        limit,
        offset,
      })
      // Apply EPCIS filters client-side (for mock data compatibility)
      const results = applyEPCISFilters(rawResults, epcisResult.epcisFilters, filters)
      return {
        results,
        total: results.length,
        indexHints,
        cacheHit,
      }
    } else {
      // Type is configured but no query handler - return empty results
      return {
        results: [],
        total: 0,
        indexHints,
        cacheHit,
      }
    }
  } catch {
    return {
      results: [],
      total: 0,
      indexHints,
      cacheHit,
      error: { message: 'Search failed', status: 500 },
    }
  }
}

/**
 * Execute a provider search
 */
async function executeProviderSearch(
  ctx: SearchExecutionContext,
  providerTypes: Record<string, ProviderTypeConfig>
): Promise<SearchExecutionResult> {
  const { type, q, limit, offset, filters, linkedAccounts, integrations } = ctx

  // Check if type is configured
  if (!(type in providerTypes)) {
    return {
      results: [],
      total: 0,
      indexHints: [],
      cacheHit: false,
      error: { message: 'Unknown type', status: 404 },
    }
  }

  const [provider, resource] = type.split(':')
  const providerConfig = providerTypes[type]

  // Check linked accounts availability
  if (!linkedAccounts) {
    return {
      results: [],
      total: 0,
      indexHints: [],
      cacheHit: false,
      error: { message: 'Account not linked. Please connect your account.', status: 403 },
    }
  }

  const account = await linkedAccounts.get(provider!)
  if (!account) {
    return {
      results: [],
      total: 0,
      indexHints: [],
      cacheHit: false,
      error: { message: 'Account not linked. Please connect your account.', status: 403 },
    }
  }

  // Check token expiration
  if (isTokenExpired(account.expiresAt)) {
    return {
      results: [],
      total: 0,
      indexHints: [],
      cacheHit: false,
      error: { message: 'Account token expired. Please reconnect your account.', status: 403 },
    }
  }

  // Check required scopes
  if (!hasRequiredScopes(account.scopes, providerConfig!.scopes)) {
    return {
      results: [],
      total: 0,
      indexHints: [],
      cacheHit: false,
      error: { message: 'Insufficient scope permissions. Please reconnect with required permissions.', status: 403 },
    }
  }

  // Check integrations availability
  if (!integrations) {
    return {
      results: [],
      total: 0,
      indexHints: [],
      cacheHit: false,
      error: { message: 'Integration not available', status: 502 },
    }
  }

  const integration = await integrations.get(provider!)
  if (!integration) {
    return {
      results: [],
      total: 0,
      indexHints: [],
      cacheHit: false,
      error: { message: 'Integration not available', status: 502 },
    }
  }

  // Execute the provider search
  try {
    const searchResult = await integration.search(resource!, {
      accessToken: account.accessToken,
      q,
      limit,
      offset,
      filters,
    })
    return {
      results: searchResult.results,
      total: searchResult.total,
      indexHints: [],
      cacheHit: false,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    if (message.includes('rate limit')) {
      return {
        results: [],
        total: 0,
        indexHints: [],
        cacheHit: false,
        error: { message: 'Provider rate limit exceeded', status: 429 },
      }
    }
    if (message.includes('Timeout') || message.includes('timeout')) {
      return {
        results: [],
        total: 0,
        indexHints: [],
        cacheHit: false,
        error: { message: 'Provider request timeout', status: 504 },
      }
    }
    return {
      results: [],
      total: 0,
      indexHints: [],
      cacheHit: false,
      error: { message: 'Provider request failed', status: 502 },
    }
  }
}

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
 *   // Optional: Enable query plan caching
 *   enableQueryPlanCache: true,
 *   queryPlanCacheTTL: 300000, // 5 minutes
 *   // Optional: Custom index hints
 *   indexHints: {
 *     tasks: [{ indexField: 'dueDate', indexType: 'btree' }],
 *   },
 *   // Optional: Analytics hook
 *   analyticsHook: (event) => console.log('Search:', event),
 *   // Optional: Enable cursor-based pagination
 *   enableCursorPagination: true,
 * }))
 * ```
 */
export function search(config?: SearchConfig): MiddlewareHandler {
  const localTypes = new Set(config?.localTypes || [])
  const providerTypes = config?.providerTypes || {}
  const requirePermission = config?.requirePermission || false
  const enableQueryPlanCache = config?.enableQueryPlanCache ?? true
  const queryPlanCacheTTL = config?.queryPlanCacheTTL ?? 5 * 60 * 1000
  const maxCacheEntries = config?.maxCacheEntries ?? 1000
  const analyticsHook = config?.analyticsHook
  const customIndexHints = config?.indexHints
  const enableCursorPagination = config?.enableCursorPagination ?? false

  // Initialize query plan cache if enabled
  const queryPlanCache = enableQueryPlanCache
    ? getQueryPlanCache(maxCacheEntries, queryPlanCacheTTL)
    : null

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

        // Parse query parameters with optimized helpers
        const q = ctx.req.query('q') || ''
        const allQueries = ctx.req.query()
        const limit = parseLimit(ctx.req.query('limit'))
        const offset = parseOffset(ctx.req.query('offset'), ctx.req.query('cursor'))
        const filters = extractFilters(allQueries)

        // Track search start time for analytics
        const startTime = Date.now()

        // Build execution context
        const execCtx: SearchExecutionContext = {
          type,
          q,
          limit,
          offset,
          filters,
          user,
          db: c.get('db') as { query: Record<string, DbQuery> } | undefined,
          linkedAccounts: c.get('linkedAccounts') as { get: (provider: string) => Promise<LinkedAccount | null> } | undefined,
          integrations: c.get('integrations') as { get: (provider: string) => Promise<Integration | null> } | undefined,
        }

        // Execute search based on type
        let result: SearchExecutionResult

        if (type.includes(':')) {
          // Provider search
          result = await executeProviderSearch(execCtx, providerTypes)
        } else {
          // Local search with caching and index hints
          result = await executeLocalSearch(
            execCtx,
            localTypes,
            requirePermission,
            queryPlanCache,
            customIndexHints
          )
        }

        // Handle errors
        if (result.error) {
          return ctx.json({ error: result.error.message }, result.error.status as 400 | 403 | 404 | 429 | 500 | 502 | 504)
        }

        // Calculate search duration
        const durationMs = Date.now() - startTime

        // Build response
        const response: SearchResponse = {
          type,
          query: q,
          filters,
          results: result.results,
          total: result.total,
          limit,
          offset,
        }

        // Add pagination cursors if enabled
        if (enableCursorPagination) {
          const cursors = computePaginationCursors(offset, limit, result.total, result.results)
          if (cursors.nextCursor) {
            response.nextCursor = cursors.nextCursor
          }
          if (cursors.prevCursor) {
            response.prevCursor = cursors.prevCursor
          }
        }

        // Emit analytics event (non-blocking)
        if (analyticsHook) {
          emitSearchAnalytics(analyticsHook, {
            type,
            query: q,
            filters,
            resultCount: result.results.length,
            totalCount: result.total,
            durationMs,
            userId: user.id,
            timestamp: Date.now(),
            cacheHit: result.cacheHit,
            indexHints: result.indexHints,
          })
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

/**
 * Export the QueryPlanCache class for testing and advanced usage
 */
export { QueryPlanCache, getQueryPlanCache, computeIndexHints, decodeCursor, encodeCursor }

export default search
