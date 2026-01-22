/**
 * @dotdo/analytics type definitions
 *
 * Database-agnostic interfaces for analytics backends and query abstractions.
 * These interfaces allow plugging in any analytics backend (ClickHouse, BigQuery,
 * Postgres, etc.) without changing application code.
 */

// =============================================================================
// Core Event Types
// =============================================================================

/**
 * Analytics event to be tracked.
 * The base event structure that all analytics backends must support.
 */
export interface AnalyticsEvent {
  /** Event type/name (e.g., 'page_view', 'button_click', 'purchase') */
  type: string
  /** When the event occurred */
  timestamp: Date
  /** Arbitrary event properties */
  properties: Record<string, unknown>
  /** User identifier (if known) */
  userId?: string
  /** Session identifier (if tracking sessions) */
  sessionId?: string
}

/**
 * Input for tracking events (timestamp is auto-generated if not provided)
 */
export type AnalyticsEventInput = Omit<AnalyticsEvent, 'timestamp'> & {
  timestamp?: Date
}

// =============================================================================
// Query Types
// =============================================================================

/**
 * Analytics query definition.
 * A structured way to express analytics queries that can be translated
 * to any backend's query language.
 */
export interface AnalyticsQuery {
  /** Fields/columns to select */
  select: string[]
  /** Table/collection to query from */
  from: string
  /** Filter conditions */
  where?: QueryCondition[]
  /** Group by fields */
  groupBy?: string[]
  /** Order by fields with direction */
  orderBy?: OrderByClause[]
  /** Maximum number of results */
  limit?: number
  /** Number of results to skip */
  offset?: number
}

/**
 * Query filter condition
 */
export interface QueryCondition {
  /** Field name */
  field: string
  /** Comparison operator */
  operator: QueryOperator
  /** Value to compare against */
  value: unknown
}

/**
 * Supported query operators
 */
export type QueryOperator =
  | '='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'in'
  | 'not in'
  | 'like'
  | 'not like'
  | 'is null'
  | 'is not null'
  | 'between'

/**
 * Order by clause
 */
export interface OrderByClause {
  /** Field name */
  field: string
  /** Sort direction */
  direction: 'asc' | 'desc'
}

/**
 * Query result with metadata
 */
export interface QueryResult<T = unknown> {
  /** Result rows */
  rows: T[]
  /** Query metadata */
  metadata: QueryMetadata
}

/**
 * Query execution metadata
 */
export interface QueryMetadata {
  /** Number of rows returned */
  rowCount: number
  /** Query execution time in milliseconds */
  executionTime: number
  /** Total rows before limit (if available) */
  totalRows?: number
  /** Column information (if available) */
  columns?: ColumnInfo[]
}

/**
 * Column metadata
 */
export interface ColumnInfo {
  /** Column name */
  name: string
  /** Column type */
  type: string
}

// =============================================================================
// Metric Types
// =============================================================================

/**
 * A metric value with timestamp and optional dimensions
 */
export interface MetricValue {
  /** The numeric value */
  value: number
  /** When this metric was calculated/sampled */
  timestamp: Date
  /** Dimension breakdown (e.g., { country: 'US', browser: 'Chrome' }) */
  dimensions?: Record<string, string>
}

/**
 * Options for retrieving metrics
 */
export interface MetricOptions {
  /** Start of time range */
  from?: Date
  /** End of time range */
  to?: Date
  /** Filter by dimensions */
  dimensions?: Record<string, string>
  /** Aggregation interval */
  interval?: MetricInterval
  /** Aggregation function */
  aggregation?: MetricAggregation
}

/**
 * Time intervals for metric aggregation
 */
export type MetricInterval =
  | 'minute'
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'

/**
 * Aggregation functions for metrics
 */
export type MetricAggregation =
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'count'
  | 'count_distinct'
  | 'p50'
  | 'p90'
  | 'p95'
  | 'p99'

// =============================================================================
// Client Interface
// =============================================================================

/**
 * Core analytics client interface.
 * This is the main interface that applications use to interact with analytics.
 * It provides a high-level API that works with any backend.
 */
export interface AnalyticsClient {
  /**
   * Track a single analytics event.
   * @param event - The event to track
   */
  track(event: AnalyticsEventInput): Promise<void>

  /**
   * Run an analytics query.
   * @param query - The structured query to execute
   * @returns Query results with metadata
   */
  query<T = unknown>(query: AnalyticsQuery): Promise<QueryResult<T>>

  /**
   * Get a metric value.
   * @param name - Metric name (e.g., 'active_users', 'revenue')
   * @param options - Optional filters and time range
   * @returns The metric value
   */
  getMetric(name: string, options?: MetricOptions): Promise<MetricValue>

  /**
   * Flush any pending events to the backend.
   * Call this to ensure all tracked events are persisted.
   */
  flush(): Promise<void>
}

// =============================================================================
// Adapter Interface
// =============================================================================

/**
 * Pluggable backend adapter interface.
 * Implement this interface to add support for a new analytics backend.
 * The adapter handles the low-level communication with the backend.
 */
export interface AnalyticsAdapter {
  /** Adapter name (e.g., 'clickhouse', 'bigquery', 'postgres') */
  readonly name: string

  /**
   * Connect to the backend.
   * Called once when the client is initialized.
   */
  connect(): Promise<void>

  /**
   * Disconnect from the backend.
   * Called when the client is being closed.
   */
  disconnect(): Promise<void>

  /**
   * Insert events into the backend.
   * @param events - Array of events to insert
   */
  insertEvents(events: AnalyticsEvent[]): Promise<void>

  /**
   * Execute a raw SQL query against the backend.
   * @param sql - SQL query string
   * @param params - Optional query parameters
   * @returns Array of result rows
   */
  executeQuery(sql: string, params?: unknown[]): Promise<unknown[]>
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Analytics client configuration
 */
export interface AnalyticsConfig {
  /** The adapter to use */
  adapter: AnalyticsAdapter

  /** Enable event batching (default: true) */
  batching?: boolean

  /** Batch size before auto-flush (default: 100) */
  batchSize?: number

  /** Batch flush interval in ms (default: 5000) */
  flushInterval?: number

  /** Default event properties to include in all events */
  defaultProperties?: Record<string, unknown>
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Base error class for analytics errors
 */
export class AnalyticsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnalyticsError'
  }
}

/**
 * Error thrown when a query fails
 */
export class AnalyticsQueryError extends AnalyticsError {
  /** The query that failed */
  readonly query?: AnalyticsQuery | string

  constructor(message: string, query?: AnalyticsQuery | string) {
    super(message)
    this.name = 'AnalyticsQueryError'
    this.query = query
  }
}

/**
 * Error thrown when connection to the backend fails
 */
export class AnalyticsConnectionError extends AnalyticsError {
  constructor(message: string) {
    super(message)
    this.name = 'AnalyticsConnectionError'
  }
}

/**
 * Error thrown when an adapter is not properly configured
 */
export class AnalyticsConfigError extends AnalyticsError {
  constructor(message: string) {
    super(message)
    this.name = 'AnalyticsConfigError'
  }
}
