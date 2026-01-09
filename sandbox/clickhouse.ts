/**
 * ClickHouse Query Sandbox
 *
 * This module provides query sandboxing using ClickHouse with:
 * - Resource limits (memory, execution time, result size)
 * - Row-level security for multi-tenant data isolation
 * - Parameterized queries for SQL injection prevention
 * - Tiered access control based on subscription level
 *
 * Uses @clickhouse/client-web for Cloudflare Workers compatibility.
 *
 * @see https://clickhouse.com/docs/operations/settings/query-complexity
 * @see https://clickhouse.com/docs/cloud/bestpractices/multi-tenancy
 */

import { createClient, type ClickHouseClient } from '@clickhouse/client-web'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Supported output formats for query results
 */
export type OutputFormat =
  | 'JSON'
  | 'JSONEachRow'
  | 'JSONCompact'
  | 'CSV'
  | 'CSVWithNames'
  | 'TabSeparated'
  | 'Pretty'
  | 'PrettyCompact'

/**
 * Resource limits for query execution
 */
export interface ResourceLimits {
  /** Maximum memory usage in bytes */
  maxMemoryUsage?: number
  /** Maximum execution time in seconds */
  maxExecutionTime?: number
  /** Maximum rows to return in result */
  maxResultRows?: number
  /** Maximum bytes to return in result */
  maxResultBytes?: number
  /** Maximum rows to read from tables */
  maxRowsToRead?: number
  /** Maximum bytes to read from tables */
  maxBytesToRead?: number
  /** Read-only mode (0=off, 1=read-only, 2=read-only with temp tables) */
  readonly?: 0 | 1 | 2
}

/**
 * Query parameter types supported by ClickHouse
 */
export type QueryParamType =
  | 'String'
  | 'UInt8'
  | 'UInt16'
  | 'UInt32'
  | 'UInt64'
  | 'Int8'
  | 'Int16'
  | 'Int32'
  | 'Int64'
  | 'Float32'
  | 'Float64'
  | 'Date'
  | 'DateTime'
  | 'UUID'
  | 'Array(String)'
  | 'Array(UInt32)'
  | 'Array(UInt64)'
  | 'Identifier'

/**
 * Connection configuration for ClickHouse
 */
export interface ClickHouseConfig {
  /** ClickHouse HTTP URL (use port 8123 for HTTP, 8443 for HTTPS) */
  url: string
  /** Username for authentication */
  username: string
  /** Password for authentication */
  password: string
  /** Default database to use */
  database?: string
  /** Application name for logging */
  application?: string
  /** Request timeout in milliseconds */
  requestTimeout?: number
}

/**
 * Tenant configuration for multi-tenant isolation
 */
export interface TenantConfig {
  /** Unique tenant identifier */
  tenantId: string
  /** Subscription tier */
  tier: 'free' | 'starter' | 'pro' | 'enterprise'
  /** Custom resource limits (overrides tier defaults) */
  customLimits?: Partial<ResourceLimits>
}

/**
 * Query execution options
 */
export interface QueryOptions {
  /** Output format (default: JSONEachRow) */
  format?: OutputFormat
  /** Query parameters for safe parameterization */
  params?: Record<string, unknown>
  /** Additional ClickHouse settings */
  settings?: Record<string, string | number>
}

/**
 * Query execution result
 */
export interface QueryResult<T = unknown> {
  /** Query success status */
  success: boolean
  /** Result data (format depends on output format) */
  data?: T[]
  /** Error message if failed */
  error?: string
  /** Query statistics */
  stats?: {
    rowsRead: number
    bytesRead: number
    elapsedMs: number
  }
}

/**
 * Allowed query definition for query allowlisting
 */
export interface AllowedQuery {
  /** Query name/identifier */
  name: string
  /** SQL query template with parameters */
  sql: string
  /** Required parameters */
  params: Record<string, QueryParamType>
  /** Description of what this query does */
  description?: string
}

// ============================================================================
// Tier-Based Resource Limits
// ============================================================================

/**
 * Default resource limits by subscription tier
 */
export const TIER_LIMITS: Record<TenantConfig['tier'], ResourceLimits> = {
  free: {
    maxMemoryUsage: 100_000_000, // 100MB
    maxExecutionTime: 5,
    maxResultRows: 1_000,
    maxResultBytes: 10_000_000, // 10MB
    maxRowsToRead: 1_000_000,
    readonly: 1,
  },
  starter: {
    maxMemoryUsage: 500_000_000, // 500MB
    maxExecutionTime: 15,
    maxResultRows: 10_000,
    maxResultBytes: 50_000_000, // 50MB
    maxRowsToRead: 10_000_000,
    readonly: 1,
  },
  pro: {
    maxMemoryUsage: 2_000_000_000, // 2GB
    maxExecutionTime: 60,
    maxResultRows: 100_000,
    maxResultBytes: 200_000_000, // 200MB
    maxRowsToRead: 100_000_000,
    readonly: 1,
  },
  enterprise: {
    maxMemoryUsage: 10_000_000_000, // 10GB
    maxExecutionTime: 300,
    maxResultRows: 1_000_000,
    maxResultBytes: 1_000_000_000, // 1GB
    maxRowsToRead: 1_000_000_000,
    readonly: 1,
  },
}

// ============================================================================
// ClickHouse Sandbox Class
// ============================================================================

/**
 * Sandboxed ClickHouse query executor with resource limits and tenant isolation
 */
export class ClickHouseSandbox {
  private client: ClickHouseClient
  private tenant: TenantConfig
  private limits: ResourceLimits
  private allowedQueries: Map<string, AllowedQuery>

  constructor(
    config: ClickHouseConfig,
    tenant: TenantConfig,
    allowedQueries?: AllowedQuery[]
  ) {
    this.tenant = tenant
    this.limits = this.computeLimits(tenant)
    this.allowedQueries = new Map(
      allowedQueries?.map((q) => [q.name, q]) ?? []
    )

    this.client = createClient({
      url: config.url,
      username: config.username,
      password: config.password,
      database: config.database,
      application: config.application ?? 'dotdo-sandbox',
      request_timeout: config.requestTimeout ?? 30_000,
      clickhouse_settings: this.limitsToSettings(this.limits),
    })
  }

  // --------------------------------------------------------------------------
  // Query Execution
  // --------------------------------------------------------------------------

  /**
   * Execute a raw SQL query with sandbox limits applied
   *
   * @warning Use executeAllowed() for user-facing queries to prevent SQL injection
   */
  async executeRaw<T = unknown>(
    query: string,
    options?: QueryOptions
  ): Promise<QueryResult<T>> {
    const startTime = Date.now()

    try {
      const resultSet = await this.client.query({
        query,
        format: options?.format ?? 'JSONEachRow',
        query_params: options?.params,
        clickhouse_settings: options?.settings
          ? { ...this.limitsToSettings(this.limits), ...options.settings }
          : undefined,
      })

      const data = (await resultSet.json()) as T[]
      const stats = resultSet.query_id
        ? {
            rowsRead: 0, // Would need to query system.query_log for this
            bytesRead: 0,
            elapsedMs: Date.now() - startTime,
          }
        : undefined

      return { success: true, data, stats }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stats: { rowsRead: 0, bytesRead: 0, elapsedMs: Date.now() - startTime },
      }
    }
  }

  /**
   * Execute an allowed (allowlisted) query by name
   * This is the safe method for user-facing queries
   */
  async executeAllowed<T = unknown>(
    queryName: string,
    params: Record<string, unknown>,
    options?: Omit<QueryOptions, 'params'>
  ): Promise<QueryResult<T>> {
    const allowed = this.allowedQueries.get(queryName)

    if (!allowed) {
      return {
        success: false,
        error: `Query '${queryName}' is not in the allowed list`,
      }
    }

    // Validate required parameters
    const missingParams = Object.keys(allowed.params).filter(
      (p) => !(p in params)
    )
    if (missingParams.length > 0) {
      return {
        success: false,
        error: `Missing required parameters: ${missingParams.join(', ')}`,
      }
    }

    // Inject tenant_id if the query expects it
    const queryParams = { ...params }
    if ('tenant_id' in allowed.params && !queryParams.tenant_id) {
      queryParams.tenant_id = this.tenant.tenantId
    }

    return this.executeRaw<T>(allowed.sql, {
      ...options,
      params: queryParams,
    })
  }

  /**
   * Execute a query and stream results
   */
  async *executeStream<T = unknown>(
    query: string,
    options?: QueryOptions
  ): AsyncGenerator<T, void, unknown> {
    const resultSet = await this.client.query({
      query,
      format: options?.format ?? 'JSONEachRow',
      query_params: options?.params,
    })

    const stream = resultSet.stream()

    for await (const rows of stream) {
      for (const row of rows) {
        yield row.json() as T
      }
    }
  }

  // --------------------------------------------------------------------------
  // Query Builder Helpers
  // --------------------------------------------------------------------------

  /**
   * Add a new allowed query
   */
  addAllowedQuery(query: AllowedQuery): void {
    this.allowedQueries.set(query.name, query)
  }

  /**
   * Remove an allowed query
   */
  removeAllowedQuery(queryName: string): void {
    this.allowedQueries.delete(queryName)
  }

  /**
   * Get all allowed queries
   */
  getAllowedQueries(): AllowedQuery[] {
    return Array.from(this.allowedQueries.values())
  }

  /**
   * Check if a query is allowed
   */
  isQueryAllowed(queryName: string): boolean {
    return this.allowedQueries.has(queryName)
  }

  // --------------------------------------------------------------------------
  // Tenant Management
  // --------------------------------------------------------------------------

  /**
   * Get current tenant configuration
   */
  getTenant(): TenantConfig {
    return { ...this.tenant }
  }

  /**
   * Get current resource limits
   */
  getLimits(): ResourceLimits {
    return { ...this.limits }
  }

  /**
   * Update tenant tier and recalculate limits
   */
  updateTier(tier: TenantConfig['tier']): void {
    this.tenant.tier = tier
    this.limits = this.computeLimits(this.tenant)
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Close the client connection
   */
  async close(): Promise<void> {
    await this.client.close()
  }

  /**
   * Ping the server to check connectivity
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping()
      return result.success
    } catch {
      return false
    }
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  private computeLimits(tenant: TenantConfig): ResourceLimits {
    const tierLimits = TIER_LIMITS[tenant.tier]
    return { ...tierLimits, ...tenant.customLimits }
  }

  private limitsToSettings(
    limits: ResourceLimits
  ): Record<string, string | number> {
    const settings: Record<string, string | number> = {}

    if (limits.maxMemoryUsage !== undefined) {
      settings.max_memory_usage = limits.maxMemoryUsage.toString()
    }
    if (limits.maxExecutionTime !== undefined) {
      settings.max_execution_time = limits.maxExecutionTime.toString()
    }
    if (limits.maxResultRows !== undefined) {
      settings.max_result_rows = limits.maxResultRows.toString()
    }
    if (limits.maxResultBytes !== undefined) {
      settings.max_result_bytes = limits.maxResultBytes.toString()
    }
    if (limits.maxRowsToRead !== undefined) {
      settings.max_rows_to_read = limits.maxRowsToRead.toString()
    }
    if (limits.maxBytesToRead !== undefined) {
      settings.max_bytes_to_read = limits.maxBytesToRead.toString()
    }
    if (limits.readonly !== undefined) {
      settings.readonly = limits.readonly.toString()
    }

    return settings
  }
}

// ============================================================================
// Row Policy SQL Generators
// ============================================================================

/**
 * Generate SQL to create a row policy for tenant isolation
 */
export function createRowPolicySql(
  tableName: string,
  tenantColumn: string,
  policyName: string,
  userName: string
): string {
  return `
    CREATE ROW POLICY IF NOT EXISTS ${policyName}
    ON ${tableName}
    FOR SELECT
    USING ${tenantColumn} = currentUser()
    TO ${userName};
  `.trim()
}

/**
 * Generate SQL to create a tenant-specific user with quotas
 */
export function createTenantUserSql(
  tenantId: string,
  password: string,
  profile: string = 'sandbox_profile',
  quota: string = 'sandbox_quota'
): string {
  return `
    CREATE USER IF NOT EXISTS 'tenant_${tenantId}'
    IDENTIFIED BY '${password}'
    SETTINGS PROFILE '${profile}'
    QUOTA '${quota}';
  `.trim()
}

/**
 * Generate SQL to create a resource profile
 */
export function createResourceProfileSql(
  profileName: string,
  limits: ResourceLimits
): string {
  const settings: string[] = []

  if (limits.maxMemoryUsage !== undefined) {
    settings.push(`max_memory_usage = ${limits.maxMemoryUsage}`)
  }
  if (limits.maxExecutionTime !== undefined) {
    settings.push(`max_execution_time = ${limits.maxExecutionTime}`)
  }
  if (limits.maxResultRows !== undefined) {
    settings.push(`max_result_rows = ${limits.maxResultRows}`)
  }
  if (limits.maxRowsToRead !== undefined) {
    settings.push(`max_rows_to_read = ${limits.maxRowsToRead}`)
  }
  if (limits.readonly !== undefined) {
    settings.push(`readonly = ${limits.readonly}`)
  }

  return `
    CREATE SETTINGS PROFILE IF NOT EXISTS '${profileName}'
    SETTINGS ${settings.join(', ')};
  `.trim()
}

// ============================================================================
// Common Allowed Queries
// ============================================================================

/**
 * Common analytics queries that can be safely exposed to tenants
 */
export const COMMON_ALLOWED_QUERIES: AllowedQuery[] = [
  {
    name: 'events_by_date',
    description: 'Get event counts by date for a tenant',
    sql: `
      SELECT
        toDate(timestamp) as date,
        count() as events,
        uniq(user_id) as unique_users
      FROM events
      WHERE tenant_id = {tenant_id:String}
        AND timestamp BETWEEN {start_date:Date} AND {end_date:Date}
      GROUP BY date
      ORDER BY date
    `,
    params: {
      tenant_id: 'String',
      start_date: 'Date',
      end_date: 'Date',
    },
  },
  {
    name: 'top_users',
    description: 'Get top users by event count',
    sql: `
      SELECT
        user_id,
        count() as event_count,
        max(timestamp) as last_seen
      FROM events
      WHERE tenant_id = {tenant_id:String}
        AND timestamp >= {since:DateTime}
      GROUP BY user_id
      ORDER BY event_count DESC
      LIMIT {limit:UInt32}
    `,
    params: {
      tenant_id: 'String',
      since: 'DateTime',
      limit: 'UInt32',
    },
  },
  {
    name: 'event_types',
    description: 'Get breakdown of event types',
    sql: `
      SELECT
        event_type,
        count() as count,
        round(count() * 100.0 / sum(count()) OVER (), 2) as percentage
      FROM events
      WHERE tenant_id = {tenant_id:String}
        AND timestamp BETWEEN {start_date:Date} AND {end_date:Date}
      GROUP BY event_type
      ORDER BY count DESC
    `,
    params: {
      tenant_id: 'String',
      start_date: 'Date',
      end_date: 'Date',
    },
  },
]

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a sandbox for a tenant with default allowed queries
 */
export function createSandbox(
  config: ClickHouseConfig,
  tenant: TenantConfig,
  additionalQueries?: AllowedQuery[]
): ClickHouseSandbox {
  const allQueries = [...COMMON_ALLOWED_QUERIES, ...(additionalQueries ?? [])]
  return new ClickHouseSandbox(config, tenant, allQueries)
}

/**
 * Create a read-only sandbox with minimal permissions
 */
export function createReadOnlySandbox(
  config: ClickHouseConfig,
  tenantId: string
): ClickHouseSandbox {
  return new ClickHouseSandbox(
    config,
    {
      tenantId,
      tier: 'free',
      customLimits: { readonly: 1 },
    },
    COMMON_ALLOWED_QUERIES
  )
}

/**
 * Create an admin sandbox with higher limits (for internal use)
 */
export function createAdminSandbox(
  config: ClickHouseConfig,
  tenantId: string
): ClickHouseSandbox {
  return new ClickHouseSandbox(
    config,
    {
      tenantId,
      tier: 'enterprise',
      customLimits: { readonly: 0 }, // Allow writes for admin
    },
    [] // No query restrictions for admin
  )
}

// ============================================================================
// Environment Configuration Helper
// ============================================================================

/**
 * Create ClickHouse config from environment variables
 */
export function configFromEnv(env: {
  CLICKHOUSE_URL?: string
  CLICKHOUSE_USER?: string
  CLICKHOUSE_PASSWORD?: string
  CLICKHOUSE_DATABASE?: string
}): ClickHouseConfig {
  if (!env.CLICKHOUSE_URL) {
    throw new Error('CLICKHOUSE_URL environment variable is required')
  }
  if (!env.CLICKHOUSE_USER) {
    throw new Error('CLICKHOUSE_USER environment variable is required')
  }
  if (!env.CLICKHOUSE_PASSWORD) {
    throw new Error('CLICKHOUSE_PASSWORD environment variable is required')
  }

  return {
    url: env.CLICKHOUSE_URL,
    username: env.CLICKHOUSE_USER,
    password: env.CLICKHOUSE_PASSWORD,
    database: env.CLICKHOUSE_DATABASE,
  }
}

// ============================================================================
// chDB Notes (Embedded ClickHouse)
// ============================================================================

/**
 * chDB (@npm chdb) is an embedded ClickHouse engine that runs in-process.
 *
 * IMPORTANT LIMITATIONS for sandboxing:
 * - No query-level isolation (runaway queries crash the process)
 * - No user authentication or authorization
 * - No resource quotas or memory limits per query
 * - Not suitable for multi-tenant production environments
 * - No WebAssembly support (can't run in browsers/edge)
 *
 * chDB IS suitable for:
 * - Single-user desktop applications
 * - Local data analysis scripts
 * - CLI tools with controlled input
 * - Development/testing environments
 *
 * For production multi-tenant sandboxing, use ClickHouse Server
 * with @clickhouse/client-web as implemented in this module.
 *
 * @see https://clickhouse.com/chdb
 * @see https://github.com/chdb-io/chdb-node
 */
