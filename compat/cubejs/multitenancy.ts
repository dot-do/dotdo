/**
 * @dotdo/cubejs - Multi-Tenancy Support
 *
 * Provides comprehensive multi-tenant support for Cube.js including:
 * - Tenant context injection in queries
 * - Per-tenant schema customization
 * - Tenant-aware caching (cache keys include tenant ID)
 * - Row-level security via SQL filters
 *
 * @example
 * ```typescript
 * import {
 *   TenantContext,
 *   MultiTenantCubeAPI,
 *   createMultiTenantCubeAPI,
 *   queryRewrite,
 *   TenantSchemaRepository,
 * } from '@dotdo/cubejs/multitenancy'
 *
 * // Define tenant context
 * const tenantContext: TenantContext = {
 *   tenantId: 'acme',
 *   organizationId: 'org-123',
 *   userId: 'user-456',
 *   roles: ['admin', 'analyst'],
 *   permissions: ['read:orders', 'write:reports'],
 * }
 *
 * // Create multi-tenant API
 * const api = createMultiTenantCubeAPI({
 *   cubes: [ordersSchema],
 *   apiToken: 'your_token',
 *   contextToAppId: (ctx) => ctx.tenantId,
 *   queryRewrite: (query, ctx) => {
 *     // Add row-level security filter
 *     return {
 *       ...query,
 *       filters: [
 *         ...(query.filters || []),
 *         { member: 'Orders.tenantId', operator: 'equals', values: [ctx.tenantId] },
 *       ],
 *     }
 *   },
 * })
 * ```
 */

import type { CubeSchema, Measure, Dimension } from './schema'
import type { CubeQuery, Filter, LogicalFilter } from './query'
import type { CubeAPIOptions, SecurityContext } from './api'
import { CubeAPI, createCubeAPI } from './api'
import { QueryResultCache, PreAggregationCache } from './cache'
import type { CachedQueryResult } from './cache'

// =============================================================================
// Tenant Context Types
// =============================================================================

/**
 * Tenant context containing all tenant-specific information
 */
export interface TenantContext {
  /**
   * Primary tenant identifier
   */
  tenantId: string

  /**
   * Organization ID (for multi-org tenants)
   */
  organizationId?: string

  /**
   * User ID for the request
   */
  userId?: string

  /**
   * User roles for authorization
   */
  roles?: string[]

  /**
   * User permissions for fine-grained access control
   */
  permissions?: string[]

  /**
   * Data source name for this tenant (for multi-database setups)
   */
  dataSource?: string

  /**
   * Custom attributes for tenant-specific logic
   */
  attributes?: Record<string, unknown>
}

/**
 * Scheduled refresh context for background jobs
 */
export interface ScheduledRefreshContext extends TenantContext {
  /**
   * Pre-aggregation to refresh
   */
  preAggregation?: string

  /**
   * Time partition to refresh
   */
  partition?: string

  /**
   * Priority of the refresh job
   */
  priority?: 'high' | 'normal' | 'low'
}

// =============================================================================
// Schema Customization Types
// =============================================================================

/**
 * Schema customization function
 */
export type SchemaCustomizer = (
  schema: CubeSchema,
  context: TenantContext
) => CubeSchema

/**
 * Dimension filter for row-level security
 */
export interface RowLevelSecurityFilter {
  /**
   * Dimension to filter on
   */
  dimension: string

  /**
   * Filter operator
   */
  operator: Filter['operator']

  /**
   * Value getter from tenant context
   */
  getValue: (context: TenantContext) => (string | number | boolean)[]
}

/**
 * Row-level security configuration
 */
export interface RowLevelSecurityConfig {
  /**
   * Cube name
   */
  cubeName: string

  /**
   * Filters to apply based on tenant context
   */
  filters: RowLevelSecurityFilter[]

  /**
   * Whether to apply filters only when user lacks certain permissions
   */
  bypassPermissions?: string[]
}

// =============================================================================
// Tenant-Aware Caching
// =============================================================================

/**
 * Options for tenant-aware cache
 */
export interface TenantCacheOptions {
  /**
   * Base TTL in milliseconds
   * @default 60000
   */
  ttl?: number

  /**
   * Maximum entries per tenant
   * @default 500
   */
  maxEntriesPerTenant?: number

  /**
   * Whether to share cache across tenants for read-only cubes
   * @default false
   */
  sharedCacheCubes?: string[]
}

/**
 * Tenant-aware query result cache
 *
 * Provides cache isolation between tenants by incorporating
 * tenant ID into cache keys.
 */
export class TenantQueryCache {
  private caches = new Map<string, QueryResultCache>()
  private sharedCache: QueryResultCache
  private sharedCubes: Set<string>
  private ttl: number
  private maxEntriesPerTenant: number

  constructor(options: TenantCacheOptions = {}) {
    this.ttl = options.ttl ?? 60000
    this.maxEntriesPerTenant = options.maxEntriesPerTenant ?? 500
    this.sharedCubes = new Set(options.sharedCacheCubes || [])
    this.sharedCache = new QueryResultCache({
      ttl: this.ttl,
      maxEntries: this.maxEntriesPerTenant * 10, // Shared cache can be larger
    })
  }

  /**
   * Get cache for a specific tenant
   */
  private getTenantCache(tenantId: string): QueryResultCache {
    let cache = this.caches.get(tenantId)
    if (!cache) {
      cache = new QueryResultCache({
        ttl: this.ttl,
        maxEntries: this.maxEntriesPerTenant,
      })
      this.caches.set(tenantId, cache)
    }
    return cache
  }

  /**
   * Determine if a query can use shared cache
   */
  private canUseSharedCache(query: CubeQuery): boolean {
    const cubes = this.getQueryCubes(query)
    return cubes.every((cube) => this.sharedCubes.has(cube))
  }

  /**
   * Get cubes referenced in a query
   */
  private getQueryCubes(query: CubeQuery): string[] {
    const cubes = new Set<string>()

    const addCube = (member: string) => {
      const [cubeName] = member.split('.')
      if (cubeName) cubes.add(cubeName)
    }

    query.measures?.forEach(addCube)
    query.dimensions?.forEach(addCube)
    query.segments?.forEach(addCube)
    query.timeDimensions?.forEach((td) => addCube(td.dimension))

    return Array.from(cubes)
  }

  /**
   * Generate a tenant-aware cache key
   */
  generateKey(query: CubeQuery, context: TenantContext): string {
    const baseCache = this.canUseSharedCache(query)
      ? this.sharedCache
      : this.getTenantCache(context.tenantId)

    // Include tenant context attributes that affect results
    const contextParts = [
      context.tenantId,
      context.organizationId || '',
      context.dataSource || '',
      ...(context.roles || []).sort(),
    ].join(':')

    const baseKey = baseCache.generateKey(query)
    return `${contextParts}|${baseKey}`
  }

  /**
   * Get a cached result for a tenant
   */
  async get(
    query: CubeQuery,
    context: TenantContext
  ): Promise<CachedQueryResult | undefined> {
    const cache = this.canUseSharedCache(query)
      ? this.sharedCache
      : this.getTenantCache(context.tenantId)

    const key = this.generateKey(query, context)
    return cache.get(key)
  }

  /**
   * Set a cached result for a tenant
   */
  async set(
    query: CubeQuery,
    context: TenantContext,
    result: CachedQueryResult,
    ttl?: number
  ): Promise<void> {
    const cache = this.canUseSharedCache(query)
      ? this.sharedCache
      : this.getTenantCache(context.tenantId)

    const key = this.generateKey(query, context)
    await cache.set(key, result, ttl)
  }

  /**
   * Invalidate cache for a specific tenant
   */
  async invalidateTenant(tenantId: string): Promise<void> {
    const cache = this.caches.get(tenantId)
    if (cache) {
      await cache.clear()
    }
  }

  /**
   * Invalidate cache entries matching a pattern for a tenant
   */
  async invalidatePattern(tenantId: string, pattern: string): Promise<number> {
    const cache = this.caches.get(tenantId)
    if (cache) {
      return cache.invalidatePattern(pattern)
    }
    return 0
  }

  /**
   * Clear all tenant caches
   */
  async clearAll(): Promise<void> {
    for (const cache of Array.from(this.caches.values())) {
      await cache.clear()
    }
    await this.sharedCache.clear()
    this.caches.clear()
  }

  /**
   * Get statistics for a tenant
   */
  getTenantStats(tenantId: string) {
    const cache = this.caches.get(tenantId)
    if (cache) {
      return cache.getStats()
    }
    return {
      hits: 0,
      misses: 0,
      entries: 0,
      evictions: 0,
      expirations: 0,
      hitRate: 0,
    }
  }

  /**
   * Get aggregate statistics
   */
  getStats() {
    let totalHits = 0
    let totalMisses = 0
    let totalEntries = 0
    let totalEvictions = 0
    let totalExpirations = 0

    for (const cache of Array.from(this.caches.values())) {
      const stats = cache.getStats()
      totalHits += stats.hits
      totalMisses += stats.misses
      totalEntries += stats.entries
      totalEvictions += stats.evictions
      totalExpirations += stats.expirations
    }

    const sharedStats = this.sharedCache.getStats()
    totalHits += sharedStats.hits
    totalMisses += sharedStats.misses
    totalEntries += sharedStats.entries
    totalEvictions += sharedStats.evictions
    totalExpirations += sharedStats.expirations

    const total = totalHits + totalMisses
    return {
      tenantCount: this.caches.size,
      totalHits,
      totalMisses,
      totalEntries,
      totalEvictions,
      totalExpirations,
      hitRate: total > 0 ? totalHits / total : 0,
      sharedCacheStats: sharedStats,
    }
  }
}

/**
 * Tenant-aware pre-aggregation cache
 */
export class TenantPreAggregationCache {
  private caches = new Map<string, PreAggregationCache>()
  private ttl: number
  private maxEntries: number

  constructor(options: { ttl?: number; maxEntries?: number } = {}) {
    this.ttl = options.ttl ?? 3600000
    this.maxEntries = options.maxEntries ?? 1000
  }

  /**
   * Get cache for a specific tenant
   */
  private getTenantCache(tenantId: string): PreAggregationCache {
    let cache = this.caches.get(tenantId)
    if (!cache) {
      cache = new PreAggregationCache({
        ttl: this.ttl,
        maxEntries: this.maxEntries,
      })
      this.caches.set(tenantId, cache)
    }
    return cache
  }

  /**
   * Get a cached pre-aggregation for a tenant
   */
  async get<T = unknown[]>(tenantId: string, key: string): Promise<T | undefined> {
    const cache = this.getTenantCache(tenantId)
    return cache.get<T>(key)
  }

  /**
   * Set a cached pre-aggregation for a tenant
   */
  async set<T = unknown[]>(
    tenantId: string,
    key: string,
    data: T,
    ttl?: number
  ): Promise<void> {
    const cache = this.getTenantCache(tenantId)
    await cache.set(key, data, ttl)
  }

  /**
   * Register pre-aggregation for a tenant
   */
  registerPreAggregation(
    tenantId: string,
    cubeName: string,
    name: string,
    config: Parameters<PreAggregationCache['registerPreAggregation']>[2]
  ): void {
    const cache = this.getTenantCache(tenantId)
    cache.registerPreAggregation(cubeName, name, config)
  }

  /**
   * Invalidate all caches for a tenant
   */
  async invalidateTenant(tenantId: string): Promise<void> {
    const cache = this.caches.get(tenantId)
    if (cache) {
      await cache.clear()
    }
  }

  /**
   * Clear all tenant caches
   */
  async clearAll(): Promise<void> {
    for (const cache of Array.from(this.caches.values())) {
      await cache.clear()
    }
    this.caches.clear()
  }
}

// =============================================================================
// Query Rewriting for Row-Level Security
// =============================================================================

/**
 * Create a query rewrite function from RLS configuration
 */
export function createQueryRewriter(
  configs: RowLevelSecurityConfig[]
): (query: CubeQuery, context: TenantContext) => CubeQuery {
  return (query: CubeQuery, context: TenantContext): CubeQuery => {
    const queryCubes = getQueryCubes(query)
    const additionalFilters: Filter[] = []

    for (const config of configs) {
      // Skip if cube not in query
      if (!queryCubes.has(config.cubeName)) continue

      // Skip if user has bypass permissions
      if (config.bypassPermissions && context.permissions) {
        const hasBypass = config.bypassPermissions.some((perm) =>
          context.permissions!.includes(perm)
        )
        if (hasBypass) continue
      }

      // Add RLS filters
      for (const filter of config.filters) {
        const values = filter.getValue(context)
        if (values.length > 0) {
          additionalFilters.push({
            member: `${config.cubeName}.${filter.dimension}`,
            operator: filter.operator,
            values,
          })
        }
      }
    }

    if (additionalFilters.length === 0) {
      return query
    }

    return {
      ...query,
      filters: [...(query.filters || []), ...additionalFilters],
    }
  }
}

/**
 * Simple query rewrite function that adds tenant filter
 */
export function queryRewrite(
  query: CubeQuery,
  context: TenantContext,
  tenantDimension: string = 'tenantId'
): CubeQuery {
  const queryCubes = Array.from(getQueryCubes(query))

  if (queryCubes.length === 0 || !context.tenantId) {
    return query
  }

  // Add tenant filter to primary cube
  const primaryCube = queryCubes[0]
  const tenantFilter: Filter = {
    member: `${primaryCube}.${tenantDimension}`,
    operator: 'equals',
    values: [context.tenantId],
  }

  return {
    ...query,
    filters: [...(query.filters || []), tenantFilter],
  }
}

/**
 * Get all cubes referenced in a query
 */
function getQueryCubes(query: CubeQuery): Set<string> {
  const cubes = new Set<string>()

  const addCube = (member: string) => {
    const [cubeName] = member.split('.')
    if (cubeName) cubes.add(cubeName)
  }

  query.measures?.forEach(addCube)
  query.dimensions?.forEach(addCube)
  query.segments?.forEach(addCube)
  query.timeDimensions?.forEach((td) => addCube(td.dimension))

  const extractFilterCubes = (filters: (Filter | LogicalFilter)[] | undefined) => {
    filters?.forEach((f) => {
      if ('member' in f) {
        addCube(f.member)
      }
      if ('and' in f && f.and) extractFilterCubes(f.and)
      if ('or' in f && f.or) extractFilterCubes(f.or)
    })
  }

  extractFilterCubes(query.filters)

  return cubes
}

// =============================================================================
// Schema Customization
// =============================================================================

/**
 * Repository for managing tenant-specific schemas
 */
export class TenantSchemaRepository {
  private baseSchemas: Map<string, CubeSchema>
  private customizers: SchemaCustomizer[] = []
  private schemaCache = new Map<string, Map<string, CubeSchema>>()

  constructor(baseSchemas: CubeSchema[]) {
    this.baseSchemas = new Map()
    for (const schema of baseSchemas) {
      this.baseSchemas.set(schema.name, schema)
    }
  }

  /**
   * Add a schema customizer
   */
  addCustomizer(customizer: SchemaCustomizer): void {
    this.customizers.push(customizer)
    // Clear cache when customizers change
    this.schemaCache.clear()
  }

  /**
   * Get schemas for a specific tenant
   */
  getSchemasForTenant(context: TenantContext): Map<string, CubeSchema> {
    const cacheKey = this.getCacheKey(context)
    let cached = this.schemaCache.get(cacheKey)

    if (cached) {
      return cached
    }

    const schemas = new Map<string, CubeSchema>()

    for (const [name, baseSchema] of Array.from(this.baseSchemas)) {
      let schema = { ...baseSchema }

      // Apply all customizers
      for (const customizer of this.customizers) {
        schema = customizer(schema, context)
      }

      schemas.set(name, schema)
    }

    this.schemaCache.set(cacheKey, schemas)
    return schemas
  }

  /**
   * Get a single schema for a tenant
   */
  getSchemaForTenant(name: string, context: TenantContext): CubeSchema | undefined {
    const schemas = this.getSchemasForTenant(context)
    return schemas.get(name)
  }

  /**
   * Clear schema cache for a tenant
   */
  clearCacheForTenant(tenantId: string): void {
    // Clear all cache entries containing this tenant
    for (const key of Array.from(this.schemaCache.keys())) {
      if (key.startsWith(`${tenantId}:`)) {
        this.schemaCache.delete(key)
      }
    }
  }

  /**
   * Clear all schema cache
   */
  clearCache(): void {
    this.schemaCache.clear()
  }

  /**
   * Generate cache key from context
   */
  private getCacheKey(context: TenantContext): string {
    return [
      context.tenantId,
      context.organizationId || '',
      context.dataSource || '',
      ...(context.roles || []).sort(),
    ].join(':')
  }
}

/**
 * Create a schema customizer that adds tenant filter to SQL
 */
export function createTenantSqlCustomizer(
  tenantColumn: string = 'tenant_id'
): SchemaCustomizer {
  return (schema: CubeSchema, context: TenantContext): CubeSchema => {
    // Modify SQL to include tenant filter
    const escapedTenantId = context.tenantId.replace(/'/g, "''")
    const tenantCondition = `${tenantColumn} = '${escapedTenantId}'`

    let sql = schema.sql

    // Add tenant filter to SQL if not already present
    if (!sql.toLowerCase().includes(tenantColumn.toLowerCase())) {
      if (sql.toLowerCase().includes(' where ')) {
        sql = sql.replace(
          / where /i,
          ` WHERE ${tenantCondition} AND `
        )
      } else if (sql.toLowerCase().includes(' from ')) {
        // Add WHERE clause before any ORDER BY, GROUP BY, etc.
        const fromIndex = sql.toLowerCase().lastIndexOf(' from ')
        const afterFrom = sql.substring(fromIndex)

        // Find the end of the FROM clause
        const limitMatch = afterFrom.match(/\s+(limit|order\s+by|group\s+by)\s+/i)
        if (limitMatch) {
          const insertPoint = fromIndex + limitMatch.index!
          sql = `${sql.substring(0, insertPoint)} WHERE ${tenantCondition} ${sql.substring(insertPoint)}`
        } else {
          sql = `${sql} WHERE ${tenantCondition}`
        }
      }
    }

    return {
      ...schema,
      sql,
    }
  }
}

/**
 * Create a schema customizer that filters measures/dimensions based on permissions
 */
export function createPermissionBasedCustomizer(
  measurePermissions: Record<string, string[]>,
  dimensionPermissions: Record<string, string[]>
): SchemaCustomizer {
  return (schema: CubeSchema, context: TenantContext): CubeSchema => {
    const userPermissions = new Set(context.permissions || [])

    // Filter measures
    const filteredMeasures: Record<string, Measure> = {}
    for (const [name, measure] of Object.entries(schema.measures)) {
      const key = `${schema.name}.${name}`
      const requiredPermissions = measurePermissions[key]

      if (!requiredPermissions || requiredPermissions.some((p) => userPermissions.has(p))) {
        filteredMeasures[name] = measure
      }
    }

    // Filter dimensions
    const filteredDimensions: Record<string, Dimension> = {}
    for (const [name, dimension] of Object.entries(schema.dimensions)) {
      const key = `${schema.name}.${name}`
      const requiredPermissions = dimensionPermissions[key]

      if (!requiredPermissions || requiredPermissions.some((p) => userPermissions.has(p))) {
        filteredDimensions[name] = dimension
      }
    }

    return {
      ...schema,
      measures: filteredMeasures,
      dimensions: filteredDimensions,
    }
  }
}

/**
 * Create a schema customizer that changes data source based on tenant
 */
export function createDataSourceCustomizer(
  tenantDataSources: Record<string, string>,
  defaultDataSource?: string
): SchemaCustomizer {
  return (schema: CubeSchema, context: TenantContext): CubeSchema => {
    const dataSource =
      context.dataSource ||
      tenantDataSources[context.tenantId] ||
      defaultDataSource

    if (dataSource) {
      return {
        ...schema,
        dataSource,
      }
    }

    return schema
  }
}

// =============================================================================
// Multi-Tenant API Options
// =============================================================================

/**
 * Options for multi-tenant Cube API
 */
export interface MultiTenantCubeAPIOptions extends Omit<CubeAPIOptions, 'queryTransformer'> {
  /**
   * Function to extract tenant context from request
   */
  contextExtractor?: (request: Request) => TenantContext | undefined

  /**
   * Function to convert tenant context to app ID (for cache partitioning)
   */
  contextToAppId?: (context: TenantContext) => string

  /**
   * Query rewrite function for row-level security
   */
  queryRewrite?: (query: CubeQuery, context: TenantContext) => CubeQuery

  /**
   * Authentication middleware
   */
  checkAuth?: (request: Request, context?: TenantContext) => boolean | Promise<boolean>

  /**
   * Schema customizers
   */
  schemaCustomizers?: SchemaCustomizer[]

  /**
   * Row-level security configurations
   */
  rowLevelSecurity?: RowLevelSecurityConfig[]

  /**
   * Function to get scheduled refresh contexts for background jobs
   */
  scheduledRefreshContexts?: () => ScheduledRefreshContext[] | Promise<ScheduledRefreshContext[]>

  /**
   * Tenant-aware cache options
   */
  tenantCacheOptions?: TenantCacheOptions
}

// =============================================================================
// Multi-Tenant Cube API
// =============================================================================

/**
 * Multi-tenant Cube.js API with tenant isolation
 */
export class MultiTenantCubeAPI {
  private baseApi: CubeAPI
  private options: MultiTenantCubeAPIOptions
  private tenantCache: TenantQueryCache
  private schemaRepository: TenantSchemaRepository
  private rlsRewriter?: (query: CubeQuery, context: TenantContext) => CubeQuery

  constructor(options: MultiTenantCubeAPIOptions) {
    this.options = options
    this.tenantCache = new TenantQueryCache(options.tenantCacheOptions)

    // Set up schema repository with customizers
    this.schemaRepository = new TenantSchemaRepository(options.cubes)

    if (options.schemaCustomizers) {
      for (const customizer of options.schemaCustomizers) {
        this.schemaRepository.addCustomizer(customizer)
      }
    }

    // Set up RLS rewriter
    if (options.rowLevelSecurity) {
      this.rlsRewriter = createQueryRewriter(options.rowLevelSecurity)
    }

    // Create base API with query transformer
    this.baseApi = createCubeAPI({
      ...options,
      queryTransformer: (query, securityContext) => {
        // Convert security context to tenant context
        const context = this.securityContextToTenantContext(securityContext)
        if (!context) return query

        let transformedQuery = query

        // Apply RLS rewriter
        if (this.rlsRewriter) {
          transformedQuery = this.rlsRewriter(transformedQuery, context)
        }

        // Apply custom query rewrite
        if (this.options.queryRewrite) {
          transformedQuery = this.options.queryRewrite(transformedQuery, context)
        }

        return transformedQuery
      },
      checkAuth: async (request, securityContext) => {
        const context = this.securityContextToTenantContext(securityContext)

        if (options.checkAuth) {
          return options.checkAuth(request, context)
        }

        // Default: require valid tenant context
        return context !== undefined && context.tenantId !== undefined
      },
    })
  }

  /**
   * Convert security context to tenant context
   */
  private securityContextToTenantContext(
    securityContext?: SecurityContext
  ): TenantContext | undefined {
    if (!securityContext) return undefined

    return {
      tenantId: securityContext.tenantId as string,
      organizationId: securityContext.organizationId as string | undefined,
      userId: securityContext.userId as string | undefined,
      roles: securityContext.roles as string[] | undefined,
      permissions: securityContext.permissions as string[] | undefined,
      dataSource: securityContext.dataSource as string | undefined,
      attributes: securityContext.attributes as Record<string, unknown> | undefined,
    }
  }

  /**
   * Handle an incoming request
   */
  async fetch(request: Request): Promise<Response> {
    return this.baseApi.fetch(request)
  }

  /**
   * Get app ID for a tenant context (for cache partitioning)
   */
  contextToAppId(context: TenantContext): string {
    if (this.options.contextToAppId) {
      return this.options.contextToAppId(context)
    }
    return context.tenantId
  }

  /**
   * Get scheduled refresh contexts for background jobs
   */
  async scheduledRefreshContexts(): Promise<ScheduledRefreshContext[]> {
    if (this.options.scheduledRefreshContexts) {
      return this.options.scheduledRefreshContexts()
    }
    return []
  }

  /**
   * Get tenant cache
   */
  getCache(): TenantQueryCache {
    return this.tenantCache
  }

  /**
   * Get schema repository
   */
  getSchemaRepository(): TenantSchemaRepository {
    return this.schemaRepository
  }

  /**
   * Invalidate cache for a tenant
   */
  async invalidateTenantCache(tenantId: string): Promise<void> {
    await this.tenantCache.invalidateTenant(tenantId)
    this.schemaRepository.clearCacheForTenant(tenantId)
  }
}

/**
 * Create a multi-tenant Cube.js API
 */
export function createMultiTenantCubeAPI(
  options: MultiTenantCubeAPIOptions
): MultiTenantCubeAPI {
  return new MultiTenantCubeAPI(options)
}

// =============================================================================
// Authentication Helpers
// =============================================================================

/**
 * Create a checkAuth function from JWT claims
 */
export function createJwtCheckAuth(
  validateToken: (token: string) => Promise<TenantContext | null>
): (request: Request, context?: TenantContext) => Promise<boolean> {
  return async (request: Request, _context?: TenantContext): Promise<boolean> => {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) return false

    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader

    const tenantContext = await validateToken(token)
    return tenantContext !== null
  }
}

/**
 * Create a checkAuth function that validates API keys per tenant
 */
export function createApiKeyCheckAuth(
  tenantApiKeys: Record<string, string[]>
): (request: Request, context?: TenantContext) => boolean {
  return (request: Request, context?: TenantContext): boolean => {
    const apiKey = request.headers.get('X-Api-Key') || request.headers.get('Authorization')
    if (!apiKey || !context?.tenantId) return false

    const validKeys = tenantApiKeys[context.tenantId]
    return validKeys?.includes(apiKey) ?? false
  }
}

// =============================================================================
// Exports
// =============================================================================

export {
  TenantContext,
  ScheduledRefreshContext,
  SchemaCustomizer,
  RowLevelSecurityFilter,
  RowLevelSecurityConfig,
  TenantCacheOptions,
  TenantQueryCache,
  TenantPreAggregationCache,
  TenantSchemaRepository,
  MultiTenantCubeAPI,
  MultiTenantCubeAPIOptions,
  createQueryRewriter,
  queryRewrite,
  createTenantSqlCustomizer,
  createPermissionBasedCustomizer,
  createDataSourceCustomizer,
  createMultiTenantCubeAPI,
  createJwtCheckAuth,
  createApiKeyCheckAuth,
}
