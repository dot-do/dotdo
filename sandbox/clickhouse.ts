/**
 * ClickHouse Query Sandbox
 *
 * Provides sandboxed query execution using both:
 * - **chDB** (embedded ClickHouse) - For querying R2/Iceberg data catalogs
 * - **ClickHouse Server** - For remote queries with full resource controls
 *
 * Multi-tenancy is handled at the DO/auth layer, not within chDB itself.
 * This allows chDB to safely query tenant-scoped data from R2 Data Catalog.
 *
 * @see https://clickhouse.com/chdb
 * @see https://clickhouse.com/docs/operations/settings/query-complexity
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Visibility levels for Things
 */
export type Visibility = 'public' | 'unlisted' | 'org' | 'user'

/**
 * Valid visibility values for validation
 */
const VALID_VISIBILITY_VALUES: Visibility[] = ['public', 'unlisted', 'org', 'user']

/**
 * Query context for visibility-aware queries
 */
export interface QueryContext {
  /** Current user ID (undefined for anonymous) */
  userId?: string
  /** Current organization ID */
  orgId?: string
  /** Whether to allow public access without auth */
  allowPublic?: boolean
}

/**
 * Options for visibility-filtered queries
 */
export interface VisibilityQueryOptions {
  /** Visibility filter */
  visibility?: Visibility | Visibility[]
  /** Query context for access control */
  context?: QueryContext
}

/**
 * Supported output formats for query results
 */
export type OutputFormat =
  | 'JSON'
  | 'JSONEachRow'
  | 'JSONCompact'
  | 'JSONCompactEachRow'
  | 'CSV'
  | 'CSVWithNames'
  | 'TabSeparated'
  | 'Pretty'
  | 'PrettyCompact'
  | 'Parquet'
  | 'Arrow'

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
 * Query execution result
 */
export interface QueryResult<T = unknown> {
  /** Query success status */
  success: boolean
  /** Result data */
  data?: T[]
  /** Raw result string (for non-JSON formats) */
  raw?: string
  /** Error message if failed */
  error?: string
  /** Execution statistics */
  stats?: {
    rowsRead?: number
    bytesRead?: number
    elapsedMs: number
  }
}

/**
 * chDB session configuration
 */
export interface ChDBSessionConfig {
  /** Path for persistent session data (optional) */
  dataPath?: string
  /** Default output format */
  format?: OutputFormat
}

/**
 * R2/Iceberg data source configuration
 */
export interface IcebergDataSource {
  /** R2 bucket name */
  bucket: string
  /** Path to Iceberg table metadata */
  tablePath: string
  /** Table name alias for queries */
  alias: string
}

// ============================================================================
// Tier-Based Resource Limits
// ============================================================================

export type Tier = 'free' | 'starter' | 'pro' | 'enterprise'

export const TIER_LIMITS: Record<Tier, ResourceLimits> = {
  free: {
    maxMemoryUsage: 100_000_000, // 100MB
    maxExecutionTime: 5,
    maxResultRows: 1_000,
    maxRowsToRead: 1_000_000,
    readonly: 1,
  },
  starter: {
    maxMemoryUsage: 500_000_000, // 500MB
    maxExecutionTime: 15,
    maxResultRows: 10_000,
    maxRowsToRead: 10_000_000,
    readonly: 1,
  },
  pro: {
    maxMemoryUsage: 2_000_000_000, // 2GB
    maxExecutionTime: 60,
    maxResultRows: 100_000,
    maxRowsToRead: 100_000_000,
    readonly: 1,
  },
  enterprise: {
    maxMemoryUsage: 10_000_000_000, // 10GB
    maxExecutionTime: 300,
    maxResultRows: 1_000_000,
    maxRowsToRead: 1_000_000_000,
    readonly: 1,
  },
}

// ============================================================================
// chDB Embedded Sandbox
// ============================================================================

/**
 * chDB-based sandbox for querying R2/Iceberg data
 *
 * Multi-tenancy is handled at the DO/auth layer - chDB receives
 * already-scoped queries for tenant data.
 *
 * @example
 * ```typescript
 * const sandbox = new ChDBSandbox()
 *
 * // Stateless query
 * const result = await sandbox.query("SELECT 1 + 1", "JSON")
 *
 * // Query Iceberg table from R2
 * const result = await sandbox.queryIceberg({
 *   bucket: 'my-data',
 *   tablePath: 'warehouse/events',
 *   query: "SELECT * FROM events WHERE date = '2025-01-09'",
 * })
 * ```
 */
export class ChDBSandbox {
  private sessionPath?: string
  private defaultFormat: OutputFormat
  private limits: ResourceLimits

  constructor(config?: ChDBSessionConfig & { tier?: Tier }) {
    this.sessionPath = config?.dataPath
    this.defaultFormat = config?.format ?? 'JSONEachRow'
    this.limits = TIER_LIMITS[config?.tier ?? 'starter']
  }

  // --------------------------------------------------------------------------
  // Stateless Queries
  // --------------------------------------------------------------------------

  /**
   * Execute a stateless query (no session persistence)
   */
  async query<T = unknown>(
    sql: string,
    format?: OutputFormat
  ): Promise<QueryResult<T>> {
    const startTime = Date.now()

    try {
      // Dynamic import for chdb (only available in Node.js environments)
      const { query } = await import('chdb')

      const result = query(sql, format ?? this.defaultFormat)
      const elapsedMs = Date.now() - startTime

      // Parse result based on format
      if (format === 'JSON' || format === 'JSONEachRow' || !format) {
        try {
          const parsed = this.parseJsonResult<T>(result, format)
          return { success: true, data: parsed, stats: { elapsedMs } }
        } catch {
          return { success: true, raw: result, stats: { elapsedMs } }
        }
      }

      return { success: true, raw: result, stats: { elapsedMs } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stats: { elapsedMs: Date.now() - startTime },
      }
    }
  }

  // --------------------------------------------------------------------------
  // Session-Based Queries
  // --------------------------------------------------------------------------

  /**
   * Execute a query with session state (tables persist between queries)
   */
  async queryWithSession<T = unknown>(
    sql: string,
    format?: OutputFormat
  ): Promise<QueryResult<T>> {
    if (!this.sessionPath) {
      return {
        success: false,
        error: 'Session not configured. Provide dataPath in constructor.',
      }
    }

    const startTime = Date.now()

    try {
      const { Session } = await import('chdb')
      const session = new Session(this.sessionPath)

      try {
        const result = session.query(sql, format ?? this.defaultFormat)
        const elapsedMs = Date.now() - startTime

        if (format === 'JSON' || format === 'JSONEachRow' || !format) {
          try {
            const parsed = this.parseJsonResult<T>(result, format)
            return { success: true, data: parsed, stats: { elapsedMs } }
          } catch {
            return { success: true, raw: result, stats: { elapsedMs } }
          }
        }

        return { success: true, raw: result, stats: { elapsedMs } }
      } finally {
        session.cleanup()
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stats: { elapsedMs: Date.now() - startTime },
      }
    }
  }

  // --------------------------------------------------------------------------
  // R2/Iceberg Integration
  // --------------------------------------------------------------------------

  /**
   * Query an Iceberg table stored in R2
   *
   * Creates a temporary table pointing to the Iceberg data and executes the query.
   * This allows SQL queries against R2 Data Catalog tables.
   */
  async queryIceberg<T = unknown>(options: {
    /** R2 bucket URL or path */
    bucket: string
    /** Path to Iceberg table in bucket */
    tablePath: string
    /** SQL query (use table name from tablePath) */
    query: string
    /** Output format */
    format?: OutputFormat
  }): Promise<QueryResult<T>> {
    const tableName = options.tablePath.split('/').pop() ?? 'iceberg_table'

    // Build query that registers Iceberg table and queries it
    // chDB supports reading Parquet files directly
    const sql = `
      SELECT * FROM (
        ${options.query.replace(
          new RegExp(`\\b${tableName}\\b`, 'gi'),
          `s3('https://${options.bucket}.r2.cloudflarestorage.com/${options.tablePath}/data/*.parquet')`
        )}
      )
    `

    return this.query<T>(sql, options.format)
  }

  /**
   * Query Parquet files directly from R2
   */
  async queryParquet<T = unknown>(options: {
    /** Full URL or path to Parquet file(s) */
    path: string
    /** SQL query (reference as 'data') */
    query: string
    /** Output format */
    format?: OutputFormat
  }): Promise<QueryResult<T>> {
    // chDB can read Parquet directly via s3/url functions
    const sql = options.query.replace(
      /\bdata\b/gi,
      `s3('${options.path}')`
    )

    return this.query<T>(sql, options.format)
  }

  // --------------------------------------------------------------------------
  // Utility Functions
  // --------------------------------------------------------------------------

  /**
   * Get ClickHouse version from chDB
   */
  async version(): Promise<string> {
    const result = await this.query<{ version: string }>(
      'SELECT version() as version',
      'JSONEachRow'
    )
    return result.data?.[0]?.version ?? 'unknown'
  }

  /**
   * List available functions
   */
  async listFunctions(pattern?: string): Promise<string[]> {
    const sql = pattern
      ? `SELECT name FROM system.functions WHERE name LIKE '%${pattern}%' ORDER BY name`
      : 'SELECT name FROM system.functions ORDER BY name LIMIT 100'

    const result = await this.query<{ name: string }>(sql, 'JSONEachRow')
    return result.data?.map((r) => r.name) ?? []
  }

  /**
   * Get resource limits for this sandbox
   */
  getLimits(): ResourceLimits {
    return { ...this.limits }
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  private parseJsonResult<T>(
    result: string,
    format?: OutputFormat
  ): T[] {
    if (!result || result.trim() === '') {
      return []
    }

    if (format === 'JSONEachRow' || !format) {
      // Each line is a JSON object
      return result
        .trim()
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as T)
    }

    if (format === 'JSON') {
      // Full JSON object with data array
      const parsed = JSON.parse(result)
      return (parsed.data ?? parsed) as T[]
    }

    return JSON.parse(result) as T[]
  }
}

// ============================================================================
// Query Builder for Safe Parameterization
// ============================================================================

/**
 * Build parameterized queries for chDB
 *
 * chDB doesn't have native parameterization like ClickHouse server,
 * so we implement safe escaping for user inputs.
 */
export class QueryBuilder {
  private parts: string[] = []
  private params: Map<string, unknown> = new Map()

  /**
   * Add SQL text
   */
  sql(text: string): this {
    this.parts.push(text)
    return this
  }

  /**
   * Add a string parameter (safely escaped)
   */
  string(value: string): this {
    // Escape single quotes and backslashes
    const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    this.parts.push(`'${escaped}'`)
    return this
  }

  /**
   * Add a number parameter
   */
  number(value: number): this {
    if (!Number.isFinite(value)) {
      throw new Error('Invalid number parameter')
    }
    this.parts.push(String(value))
    return this
  }

  /**
   * Add a date parameter (YYYY-MM-DD format)
   */
  date(value: Date | string): this {
    const dateStr = value instanceof Date
      ? value.toISOString().split('T')[0]
      : value
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new Error('Invalid date format, expected YYYY-MM-DD')
    }
    this.parts.push(`'${dateStr}'`)
    return this
  }

  /**
   * Add a datetime parameter
   */
  datetime(value: Date | string): this {
    const dtStr = value instanceof Date
      ? value.toISOString().replace('T', ' ').replace('Z', '')
      : value
    this.parts.push(`'${dtStr}'`)
    return this
  }

  /**
   * Add an identifier (table/column name) - validated
   */
  identifier(value: string): this {
    // Only allow alphanumeric and underscore
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
      throw new Error('Invalid identifier')
    }
    this.parts.push(value)
    return this
  }

  /**
   * Add an array of strings
   */
  stringArray(values: string[]): this {
    const escaped = values.map((v) =>
      `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
    )
    this.parts.push(`[${escaped.join(', ')}]`)
    return this
  }

  /**
   * Add an array of numbers
   */
  numberArray(values: number[]): this {
    if (!values.every(Number.isFinite)) {
      throw new Error('Invalid number in array')
    }
    this.parts.push(`[${values.join(', ')}]`)
    return this
  }

  /**
   * Build the final SQL string
   */
  build(): string {
    return this.parts.join('')
  }

  /**
   * Reset the builder
   */
  reset(): this {
    this.parts = []
    this.params.clear()
    return this
  }
}

// ============================================================================
// Predefined Query Templates
// ============================================================================

/**
 * Common query templates for analytics
 */
export const QueryTemplates = {
  /**
   * Count events by date
   */
  eventsByDate: (table: string) => `
    SELECT
      toDate(timestamp) as date,
      count() as events,
      uniq(user_id) as unique_users
    FROM ${table}
    GROUP BY date
    ORDER BY date DESC
  `,

  /**
   * Top N by count
   */
  topN: (table: string, groupBy: string, n: number = 10) => `
    SELECT
      ${groupBy},
      count() as count
    FROM ${table}
    GROUP BY ${groupBy}
    ORDER BY count DESC
    LIMIT ${n}
  `,

  /**
   * Time series aggregation
   */
  timeSeries: (
    table: string,
    interval: 'hour' | 'day' | 'week' | 'month' = 'day'
  ) => {
    const truncFunc = {
      hour: 'toStartOfHour',
      day: 'toDate',
      week: 'toStartOfWeek',
      month: 'toStartOfMonth',
    }[interval]

    return `
      SELECT
        ${truncFunc}(timestamp) as period,
        count() as count
      FROM ${table}
      GROUP BY period
      ORDER BY period
    `
  },

  /**
   * Percentile statistics
   */
  percentiles: (table: string, column: string) => `
    SELECT
      min(${column}) as min,
      quantile(0.25)(${column}) as p25,
      quantile(0.50)(${column}) as median,
      quantile(0.75)(${column}) as p75,
      quantile(0.95)(${column}) as p95,
      quantile(0.99)(${column}) as p99,
      max(${column}) as max,
      avg(${column}) as avg
    FROM ${table}
  `,
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a chDB sandbox with default settings
 */
export function createChDBSandbox(
  tier: Tier = 'starter'
): ChDBSandbox {
  return new ChDBSandbox({ tier })
}

/**
 * Create a chDB sandbox with session persistence
 */
export function createPersistentSandbox(
  dataPath: string,
  tier: Tier = 'starter'
): ChDBSandbox {
  return new ChDBSandbox({ dataPath, tier })
}

/**
 * Create a query builder
 */
export function createQueryBuilder(): QueryBuilder {
  return new QueryBuilder()
}

// ============================================================================
// Utility: Build chDB query from ClickHouse-style parameters
// ============================================================================

/**
 * Convert ClickHouse-style parameterized query to chDB format
 *
 * @example
 * ```typescript
 * const sql = buildQuery(
 *   "SELECT * FROM users WHERE id = {id:UInt64} AND name = {name:String}",
 *   { id: 123, name: "Alice" }
 * )
 * // Returns: "SELECT * FROM users WHERE id = 123 AND name = 'Alice'"
 * ```
 */
export function buildQuery(
  template: string,
  params: Record<string, unknown>
): string {
  return template.replace(
    /\{(\w+):(\w+)\}/g,
    (_, name, type) => {
      const value = params[name]
      if (value === undefined) {
        throw new Error(`Missing parameter: ${name}`)
      }

      switch (type) {
        case 'String':
          return `'${String(value).replace(/'/g, "''")}'`
        case 'UInt8':
        case 'UInt16':
        case 'UInt32':
        case 'UInt64':
        case 'Int8':
        case 'Int16':
        case 'Int32':
        case 'Int64':
        case 'Float32':
        case 'Float64':
          return String(Number(value))
        case 'Date':
          return `'${value instanceof Date ? value.toISOString().split('T')[0] : value}'`
        case 'DateTime':
          return `'${value instanceof Date ? value.toISOString().replace('T', ' ').slice(0, 19) : value}'`
        case 'UUID':
          return `'${value}'`
        case 'Identifier':
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(value))) {
            throw new Error(`Invalid identifier: ${value}`)
          }
          return String(value)
        default:
          return String(value)
      }
    }
  )
}
