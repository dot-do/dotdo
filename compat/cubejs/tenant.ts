/**
 * @dotdo/cubejs - Multi-Tenant Support
 *
 * Provides multi-tenancy capabilities for Cube.js including:
 * - Tenant context injection for queries
 * - Per-tenant schema configurations
 * - Automatic tenant isolation filters
 * - Tenant-aware SQL generation
 * - Per-tenant data source routing
 *
 * @example
 * ```typescript
 * import {
 *   TenantSchemaRegistry,
 *   createMultiTenantCubeAPI,
 *   TenantContext,
 * } from '@dotdo/cubejs'
 *
 * // Create tenant registry
 * const registry = new TenantSchemaRegistry()
 *
 * // Register base schemas
 * registry.registerBaseSchemas([ordersSchema, customersSchema])
 *
 * // Configure per-tenant customizations
 * registry.configureTenant('acme', {
 *   schemaPrefix: 'acme_',
 *   dataSource: 'acme_db',
 *   sqlFilter: 'tenant_id = ${TENANT_ID}',
 * })
 *
 * // Create multi-tenant API
 * const api = createMultiTenantCubeAPI({
 *   registry,
 *   apiToken: 'your_token',
 *   getTenantContext: (request) => {
 *     const tenantId = request.headers.get('x-tenant-id')
 *     return { tenantId }
 *   },
 * })
 * ```
 */

import type { CubeSchema, Dimension, Measure, PreAggregation, Segment } from './schema'
import type { CubeQuery, Filter } from './query'
import { ValidationError } from './errors'

// =============================================================================
// Tenant Types
// =============================================================================

/**
 * Tenant context containing tenant identification and metadata
 */
export interface TenantContext {
  /**
   * Unique tenant identifier
   */
  tenantId: string

  /**
   * Optional organization ID for hierarchical tenancy
   */
  organizationId?: string

  /**
   * User ID within the tenant
   */
  userId?: string

  /**
   * User roles/permissions within tenant
   */
  roles?: string[]

  /**
   * Additional tenant metadata
   */
  metadata?: Record<string, unknown>
}

/**
 * Per-tenant schema configuration
 */
export interface TenantConfig {
  /**
   * Prefix for schema/table names (e.g., 'acme_' -> 'acme_orders')
   */
  schemaPrefix?: string

  /**
   * SQL filter to apply for tenant isolation
   * Supports ${TENANT_ID}, ${ORG_ID}, ${USER_ID} placeholders
   */
  sqlFilter?: string

  /**
   * Column name used for tenant isolation (default: 'tenant_id')
   */
  tenantColumn?: string

  /**
   * Data source identifier for tenant-specific database
   */
  dataSource?: string

  /**
   * Cubes available to this tenant (whitelist)
   */
  allowedCubes?: string[]

  /**
   * Cubes hidden from this tenant (blacklist)
   */
  hiddenCubes?: string[]

  /**
   * Custom measures available only to this tenant
   */
  customMeasures?: Record<string, Record<string, Measure>>

  /**
   * Custom dimensions available only to this tenant
   */
  customDimensions?: Record<string, Record<string, Dimension>>

  /**
   * Tenant-specific pre-aggregations
   */
  preAggregations?: Record<string, Record<string, PreAggregation>>

  /**
   * Maximum row limit for queries
   */
  maxRowLimit?: number

  /**
   * Query timeout in milliseconds
   */
  queryTimeout?: number

  /**
   * Timezone override for this tenant
   */
  timezone?: string

  /**
   * Feature flags for this tenant
   */
  features?: Record<string, boolean>
}

/**
 * Options for tenant schema resolution
 */
export interface TenantSchemaOptions {
  /**
   * Whether to merge base schemas with tenant customizations
   * @default true
   */
  mergeBaseSchemas?: boolean

  /**
   * Whether to apply tenant SQL filters automatically
   * @default true
   */
  autoFilter?: boolean

  /**
   * Default tenant column if not specified in config
   * @default 'tenant_id'
   */
  defaultTenantColumn?: string
}

// =============================================================================
// Tenant Schema Registry
// =============================================================================

/**
 * Registry for managing per-tenant cube schemas
 *
 * Provides:
 * - Base schema registration
 * - Per-tenant customization
 * - Schema resolution at query time
 * - Tenant isolation filters
 *
 * @example
 * ```typescript
 * const registry = new TenantSchemaRegistry()
 *
 * // Register base schemas
 * registry.registerBaseSchemas([ordersSchema, customersSchema])
 *
 * // Configure tenant
 * registry.configureTenant('acme', {
 *   schemaPrefix: 'acme_',
 *   customMeasures: {
 *     Orders: {
 *       acmeSpecificMetric: { type: 'sum', sql: 'custom_field' },
 *     },
 *   },
 * })
 *
 * // Get schemas for tenant
 * const schemas = registry.getSchemasForTenant('acme')
 * ```
 */
export class TenantSchemaRegistry {
  private baseSchemas = new Map<string, CubeSchema>()
  private tenantConfigs = new Map<string, TenantConfig>()
  private tenantSchemaCache = new Map<string, Map<string, CubeSchema>>()
  private options: Required<TenantSchemaOptions>

  constructor(options: TenantSchemaOptions = {}) {
    this.options = {
      mergeBaseSchemas: options.mergeBaseSchemas ?? true,
      autoFilter: options.autoFilter ?? true,
      defaultTenantColumn: options.defaultTenantColumn ?? 'tenant_id',
    }
  }

  // ===========================================================================
  // Base Schema Management
  // ===========================================================================

  /**
   * Register base cube schemas
   */
  registerBaseSchemas(schemas: CubeSchema[]): void {
    for (const schema of schemas) {
      this.baseSchemas.set(schema.name, schema)
    }
    // Clear tenant cache when base schemas change
    this.tenantSchemaCache.clear()
  }

  /**
   * Register a single base schema
   */
  registerBaseSchema(schema: CubeSchema): void {
    this.baseSchemas.set(schema.name, schema)
    this.tenantSchemaCache.clear()
  }

  /**
   * Get a base schema by name
   */
  getBaseSchema(name: string): CubeSchema | undefined {
    return this.baseSchemas.get(name)
  }

  /**
   * Get all base schemas
   */
  getBaseSchemas(): Map<string, CubeSchema> {
    return new Map(this.baseSchemas)
  }

  // ===========================================================================
  // Tenant Configuration
  // ===========================================================================

  /**
   * Configure a tenant with custom settings
   */
  configureTenant(tenantId: string, config: TenantConfig): void {
    this.tenantConfigs.set(tenantId, config)
    // Clear cache for this tenant
    this.tenantSchemaCache.delete(tenantId)
  }

  /**
   * Get tenant configuration
   */
  getTenantConfig(tenantId: string): TenantConfig | undefined {
    return this.tenantConfigs.get(tenantId)
  }

  /**
   * Update tenant configuration (merges with existing)
   */
  updateTenantConfig(tenantId: string, config: Partial<TenantConfig>): void {
    const existing = this.tenantConfigs.get(tenantId) || {}
    this.tenantConfigs.set(tenantId, { ...existing, ...config })
    this.tenantSchemaCache.delete(tenantId)
  }

  /**
   * Remove tenant configuration
   */
  removeTenantConfig(tenantId: string): boolean {
    this.tenantSchemaCache.delete(tenantId)
    return this.tenantConfigs.delete(tenantId)
  }

  /**
   * List all configured tenant IDs
   */
  listTenants(): string[] {
    return Array.from(this.tenantConfigs.keys())
  }

  // ===========================================================================
  // Schema Resolution
  // ===========================================================================

  /**
   * Get resolved schemas for a tenant
   *
   * Merges base schemas with tenant-specific customizations,
   * applies schema prefix, and filters allowed cubes.
   */
  getSchemasForTenant(tenantId: string): Map<string, CubeSchema> {
    // Check cache first
    const cached = this.tenantSchemaCache.get(tenantId)
    if (cached) {
      return cached
    }

    const config = this.tenantConfigs.get(tenantId)
    const schemas = new Map<string, CubeSchema>()

    // Start with base schemas if merging is enabled
    if (this.options.mergeBaseSchemas) {
      for (const [name, baseSchema] of Array.from(this.baseSchemas)) {
        // Check if cube is allowed for this tenant
        if (config?.allowedCubes && !config.allowedCubes.includes(name)) {
          continue
        }
        if (config?.hiddenCubes?.includes(name)) {
          continue
        }

        // Create tenant-specific schema
        const tenantSchema = this.createTenantSchema(baseSchema, tenantId, config)
        schemas.set(tenantSchema.name, tenantSchema)
      }
    }

    // Cache the result
    this.tenantSchemaCache.set(tenantId, schemas)

    return schemas
  }

  /**
   * Get a single schema for a tenant by name
   */
  getSchemaForTenant(tenantId: string, cubeName: string): CubeSchema | undefined {
    const schemas = this.getSchemasForTenant(tenantId)
    return schemas.get(cubeName)
  }

  /**
   * Create a tenant-specific version of a schema
   */
  private createTenantSchema(
    baseSchema: CubeSchema,
    tenantId: string,
    config?: TenantConfig
  ): CubeSchema {
    const schema: CubeSchema = { ...baseSchema }

    // Apply schema prefix to SQL
    if (config?.schemaPrefix) {
      if (schema.sqlTable) {
        schema.sqlTable = `${config.schemaPrefix}${schema.sqlTable}`
      } else if (schema.sql && !schema.sql.includes('SELECT')) {
        // If sql is just a table name, prefix it
        schema.sql = `${config.schemaPrefix}${schema.sql}`
      }
    }

    // Set data source if configured
    if (config?.dataSource) {
      schema.dataSource = config.dataSource
    }

    // Merge custom measures
    if (config?.customMeasures?.[baseSchema.name]) {
      schema.measures = {
        ...schema.measures,
        ...config.customMeasures[baseSchema.name],
      }
    }

    // Merge custom dimensions
    if (config?.customDimensions?.[baseSchema.name]) {
      schema.dimensions = {
        ...schema.dimensions,
        ...config.customDimensions[baseSchema.name],
      }
    }

    // Merge custom pre-aggregations
    if (config?.preAggregations?.[baseSchema.name]) {
      schema.preAggregations = {
        ...schema.preAggregations,
        ...config.preAggregations[baseSchema.name],
      }
    }

    // Store tenant metadata
    schema.meta = {
      ...schema.meta,
      tenantId,
      tenantConfig: config,
    }

    return schema
  }

  // ===========================================================================
  // Tenant Filter Injection
  // ===========================================================================

  /**
   * Get the tenant isolation filter for a cube
   */
  getTenantFilter(tenantId: string, cubeName: string): Filter | undefined {
    const config = this.tenantConfigs.get(tenantId)

    // Check if auto-filtering is enabled
    if (!this.options.autoFilter) {
      return undefined
    }

    // Get the tenant column
    const tenantColumn = config?.tenantColumn || this.options.defaultTenantColumn
    const schema = this.baseSchemas.get(cubeName)

    // Check if the cube has the tenant column
    if (schema?.dimensions[tenantColumn]) {
      return {
        member: `${cubeName}.${tenantColumn}`,
        operator: 'equals',
        values: [tenantId],
      }
    }

    return undefined
  }

  /**
   * Get all tenant filters for cubes used in a query
   */
  getTenantFilters(tenantId: string, cubeNames: string[]): Filter[] {
    const filters: Filter[] = []

    for (const cubeName of cubeNames) {
      const filter = this.getTenantFilter(tenantId, cubeName)
      if (filter) {
        filters.push(filter)
      }
    }

    return filters
  }

  // ===========================================================================
  // Validation
  // ===========================================================================

  /**
   * Validate that a tenant can access specific cubes
   */
  validateTenantAccess(tenantId: string, cubeNames: string[]): string[] {
    const errors: string[] = []
    const config = this.tenantConfigs.get(tenantId)

    for (const cubeName of cubeNames) {
      // Check if cube exists
      if (!this.baseSchemas.has(cubeName)) {
        errors.push(`Unknown cube: ${cubeName}`)
        continue
      }

      // Check allowlist
      if (config?.allowedCubes && !config.allowedCubes.includes(cubeName)) {
        errors.push(`Cube not allowed for tenant ${tenantId}: ${cubeName}`)
        continue
      }

      // Check blocklist
      if (config?.hiddenCubes?.includes(cubeName)) {
        errors.push(`Cube not available for tenant ${tenantId}: ${cubeName}`)
      }
    }

    return errors
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.tenantSchemaCache.clear()
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { tenants: number; cachedSchemas: number } {
    let cachedSchemas = 0
    for (const schemas of Array.from(this.tenantSchemaCache.values())) {
      cachedSchemas += schemas.size
    }
    return {
      tenants: this.tenantSchemaCache.size,
      cachedSchemas,
    }
  }
}

// =============================================================================
// Tenant Query Transformer
// =============================================================================

/**
 * Transform queries for multi-tenant execution
 */
export class TenantQueryTransformer {
  constructor(
    private registry: TenantSchemaRegistry,
    private options: TenantSchemaOptions = {}
  ) {}

  /**
   * Transform a query for tenant execution
   *
   * - Injects tenant isolation filters
   * - Applies row limit restrictions
   * - Sets tenant timezone
   */
  transformQuery(query: CubeQuery, context: TenantContext): CubeQuery {
    const config = this.registry.getTenantConfig(context.tenantId)
    const transformed: CubeQuery = { ...query }

    // Get cubes referenced in query
    const cubeNames = this.getQueryCubes(query)

    // Validate tenant access
    const errors = this.registry.validateTenantAccess(context.tenantId, cubeNames)
    if (errors.length > 0) {
      throw new ValidationError(errors.join('; '))
    }

    // Inject tenant filters
    const tenantFilters = this.registry.getTenantFilters(context.tenantId, cubeNames)
    if (tenantFilters.length > 0) {
      transformed.filters = [...(query.filters || []), ...tenantFilters]
    }

    // Apply row limit
    if (config?.maxRowLimit) {
      if (!transformed.limit || transformed.limit > config.maxRowLimit) {
        transformed.limit = config.maxRowLimit
      }
    }

    // Apply tenant timezone
    if (config?.timezone && !transformed.timezone) {
      transformed.timezone = config.timezone
    }

    return transformed
  }

  /**
   * Get SQL filter clause for tenant isolation
   *
   * Resolves placeholders in custom SQL filters:
   * - ${TENANT_ID} -> tenantId
   * - ${ORG_ID} -> organizationId
   * - ${USER_ID} -> userId
   */
  getSqlFilter(context: TenantContext): string | undefined {
    const config = this.registry.getTenantConfig(context.tenantId)
    if (!config?.sqlFilter) {
      return undefined
    }

    let filter = config.sqlFilter
    filter = filter.replace(/\$\{TENANT_ID\}/g, `'${this.escapeSql(context.tenantId)}'`)

    if (context.organizationId) {
      filter = filter.replace(/\$\{ORG_ID\}/g, `'${this.escapeSql(context.organizationId)}'`)
    }

    if (context.userId) {
      filter = filter.replace(/\$\{USER_ID\}/g, `'${this.escapeSql(context.userId)}'`)
    }

    return filter
  }

  /**
   * Get cube names referenced in a query
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
   * Escape SQL value
   */
  private escapeSql(value: string): string {
    return value.replace(/'/g, "''")
  }
}

// =============================================================================
// Multi-Tenant Data Source Router
// =============================================================================

/**
 * Routes queries to tenant-specific data sources
 */
export class TenantDataSourceRouter {
  private dataSources = new Map<string, DataSourceConfig>()
  private defaultDataSource?: DataSourceConfig

  /**
   * Configure a tenant-specific data source
   */
  configureDataSource(tenantId: string, config: DataSourceConfig): void {
    this.dataSources.set(tenantId, config)
  }

  /**
   * Set the default data source for tenants without specific configuration
   */
  setDefaultDataSource(config: DataSourceConfig): void {
    this.defaultDataSource = config
  }

  /**
   * Get the data source for a tenant
   */
  getDataSource(tenantId: string): DataSourceConfig | undefined {
    return this.dataSources.get(tenantId) || this.defaultDataSource
  }

  /**
   * Remove a tenant's data source configuration
   */
  removeDataSource(tenantId: string): boolean {
    return this.dataSources.delete(tenantId)
  }

  /**
   * Get all configured data sources
   */
  listDataSources(): Map<string, DataSourceConfig> {
    return new Map(this.dataSources)
  }
}

/**
 * Data source configuration for tenant routing
 */
export interface DataSourceConfig {
  /**
   * Data source type
   */
  type: 'postgres' | 'mysql' | 'sqlite' | 'duckdb' | 'clickhouse' | 'bigquery'

  /**
   * Connection string or configuration
   */
  connection: string | Record<string, unknown>

  /**
   * Connection pool size
   */
  poolSize?: number

  /**
   * Query timeout in milliseconds
   */
  timeout?: number

  /**
   * Read-only replica configuration
   */
  readReplica?: {
    connection: string | Record<string, unknown>
    readPreference?: 'primary' | 'replica' | 'nearest'
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a tenant schema registry with base schemas
 */
export function createTenantRegistry(
  schemas: CubeSchema[],
  options?: TenantSchemaOptions
): TenantSchemaRegistry {
  const registry = new TenantSchemaRegistry(options)
  registry.registerBaseSchemas(schemas)
  return registry
}

/**
 * Create a query transformer for multi-tenant queries
 */
export function createTenantQueryTransformer(
  registry: TenantSchemaRegistry,
  options?: TenantSchemaOptions
): TenantQueryTransformer {
  return new TenantQueryTransformer(registry, options)
}

/**
 * Extract tenant context from a request
 *
 * Supports multiple extraction methods:
 * - Header: x-tenant-id, x-org-id
 * - Security context (base64 JSON in x-security-context)
 * - URL subdomain
 */
export function extractTenantContext(request: Request): TenantContext | undefined {
  // Try security context header first (base64 encoded JSON)
  const securityHeader = request.headers.get('x-security-context')
  if (securityHeader) {
    try {
      const decoded = atob(securityHeader)
      const context = JSON.parse(decoded)
      if (context.tenantId) {
        return {
          tenantId: context.tenantId,
          organizationId: context.organizationId || context.orgId,
          userId: context.userId,
          roles: context.roles,
          metadata: context.metadata,
        }
      }
    } catch {
      // Continue to other methods
    }
  }

  // Try direct headers
  const tenantId = request.headers.get('x-tenant-id')
  if (tenantId) {
    return {
      tenantId,
      organizationId: request.headers.get('x-org-id') || undefined,
      userId: request.headers.get('x-user-id') || undefined,
    }
  }

  // Try subdomain extraction
  const url = new URL(request.url)
  const hostParts = url.hostname.split('.')
  if (hostParts.length >= 3) {
    // Format: tenant.cube.example.com
    const subdomain = hostParts[0]
    if (subdomain !== 'www' && subdomain !== 'api' && subdomain !== 'cube') {
      return { tenantId: subdomain }
    }
  }

  return undefined
}
