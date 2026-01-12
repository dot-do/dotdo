/**
 * Type definitions for Distributed DuckDB Analytics Engine
 *
 * @module @dotdo/duckdb-distributed/types
 */

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for a single shard in the distributed cluster
 */
export interface ShardConfig {
  /** Unique shard identifier */
  id: string

  /** Geographic region for the shard (e.g., 'us-east', 'eu-west') */
  region: string

  /** Tables stored on this shard */
  tables: string[]

  /** Whether the shard is offline (for testing failure scenarios) */
  offline?: boolean

  /** Optional connection URL for the shard */
  url?: string

  /** Optional Durable Object binding name */
  doBinding?: string
}

/**
 * Configuration for the distributed DuckDB cluster
 */
export interface DistributedDuckDBConfig {
  /** List of shards in the cluster */
  shards: ShardConfig[]

  /** Default query timeout in milliseconds */
  defaultTimeout?: number

  /** Maximum parallel shard queries */
  maxParallelism?: number

  /** Enable query result caching */
  enableCache?: boolean

  /** Cache TTL in milliseconds */
  cacheTtlMs?: number
}

// ============================================================================
// Query Plan Types
// ============================================================================

/**
 * Types of nodes in a query execution plan
 */
export type QueryPlanNodeType =
  | 'scan'
  | 'filter'
  | 'project'
  | 'join'
  | 'aggregate'
  | 'partial_aggregate'
  | 'merge_aggregate'
  | 'sort'
  | 'limit'
  | 'merge'
  | 'broadcast'
  | 'shuffle'

/**
 * A single node in the query execution plan
 */
export interface QueryPlanNode {
  /** Type of operation */
  type: QueryPlanNodeType

  /** Shard this node executes on (if applicable) */
  shard?: string

  /** Child nodes */
  children?: QueryPlanNode[]

  /** Whether this operation is pushed down to shards */
  pushdown?: boolean

  /** Columns involved in this operation */
  columns?: string[]

  /** Join strategy (for join nodes) */
  strategy?: 'broadcast' | 'hash' | 'nested_loop'

  /** Filter predicate (for filter nodes) */
  predicate?: string

  /** Estimated rows output */
  estimatedRows?: number

  /** Table name (for scan nodes) */
  table?: string
}

/**
 * Complete query execution plan
 */
export interface QueryPlan {
  /** Root nodes of the plan */
  nodes: QueryPlanNode[]

  /** Shards involved in execution */
  shards: string[]

  /** Estimated total cost */
  estimatedCost: number

  /** Join strategy if applicable */
  strategy?: string

  /** Original SQL */
  sql?: string
}

/**
 * Result of explain operation
 */
export interface ExplainResult {
  /** Whether explain succeeded */
  success: boolean

  /** The query plan */
  plan: QueryPlan

  /** Error if explain failed */
  error?: QueryError
}

// ============================================================================
// Query Result Types
// ============================================================================

/**
 * Error information for failed queries
 */
export interface QueryError {
  /** Error code */
  code: string

  /** Human-readable error message */
  message: string

  /** Shard that caused the error (if applicable) */
  shard?: string

  /** Original SQL that caused the error */
  sql?: string
}

/**
 * Metrics from query execution
 */
export interface QueryMetrics {
  /** Total execution time in milliseconds */
  executionTimeMs: number

  /** Number of rows scanned across all shards */
  rowsScanned: number

  /** Bytes transferred from shards */
  bytesTransferred: number

  /** Per-shard metrics */
  shardMetrics: Record<string, ShardQueryMetrics>
}

/**
 * Metrics from a single shard's query execution
 */
export interface ShardQueryMetrics {
  /** Execution time on this shard */
  executionTimeMs: number

  /** Rows scanned on this shard */
  rowsScanned: number

  /** Rows returned by this shard */
  rowsReturned: number

  /** Bytes transferred from this shard */
  bytesTransferred: number
}

/**
 * Column metadata in query result
 */
export interface ColumnInfo {
  /** Column name */
  name: string

  /** Column data type */
  type?: string
}

/**
 * Metadata about query execution
 */
export interface QueryMetadata {
  /** Shards that were queried */
  shards: string[]

  /** Whether result came from cache */
  cached?: boolean

  /** Query plan that was executed */
  plan?: QueryPlan
}

/**
 * Result from a query execution
 */
export interface QueryResult<T = Record<string, unknown>> {
  /** Whether query succeeded */
  success: boolean

  /** Result rows */
  rows: T[]

  /** Column information */
  columns?: ColumnInfo[]

  /** Error if query failed */
  error?: QueryError

  /** Query execution metadata */
  metadata?: QueryMetadata

  /** Query execution metrics */
  metrics?: QueryMetrics
}

// ============================================================================
// Streaming Types
// ============================================================================

/**
 * Options for streaming query results
 */
export interface StreamOptions {
  /** Number of rows per batch */
  batchSize?: number

  /** Timeout for the entire stream in milliseconds */
  timeout?: number
}

/**
 * A batch of rows from a streaming query
 */
export interface StreamBatch<T = Record<string, unknown>> {
  /** Batch index (0-based) */
  batchIndex: number

  /** Rows in this batch */
  rows: T[]

  /** Column information */
  columns: ColumnInfo[]

  /** Whether this is the last batch */
  isLast: boolean

  /** Source shard(s) for this batch */
  shards?: string[]
}

/**
 * Async iterable stream of query results
 */
export type QueryStream<T = Record<string, unknown>> = AsyncIterable<StreamBatch<T>>

// ============================================================================
// Insert Types
// ============================================================================

/**
 * Options for parallel insert operations
 */
export interface InsertOptions {
  /** Rows per batch */
  batchSize?: number

  /** Maximum concurrent inserts */
  parallelism?: number

  /** Continue inserting remaining batches on error */
  continueOnError?: boolean

  /** Progress callback */
  onProgress?: (progress: InsertProgress) => void
}

/**
 * Progress information for insert operations
 */
export interface InsertProgress {
  /** Total rows to insert */
  total: number

  /** Rows inserted so far */
  inserted: number

  /** Rows failed so far */
  failed: number

  /** Current batch being processed */
  currentBatch: number

  /** Total number of batches */
  totalBatches: number
}

/**
 * Result from an insert operation
 */
export interface InsertResult {
  /** Whether insert succeeded (or partially succeeded) */
  success: boolean

  /** Number of rows inserted */
  inserted: number

  /** Number of rows that failed */
  failed?: number

  /** Number of batches processed */
  batches?: number

  /** Maximum concurrent inserts used */
  maxConcurrent?: number

  /** Error if insert completely failed */
  error?: QueryError
}

// ============================================================================
// Shard Management Types
// ============================================================================

/**
 * Status of a shard
 */
export type ShardStatus = 'healthy' | 'degraded' | 'offline'

/**
 * Information about a shard
 */
export interface ShardInfo {
  /** Shard ID */
  id: string

  /** Region */
  region: string

  /** Tables on this shard */
  tables: string[]

  /** Current status */
  status: ShardStatus

  /** Number of rows (estimated) */
  rowCount?: number

  /** Storage size in bytes */
  sizeBytes?: number
}

/**
 * Options for adding a shard
 */
export interface AddShardOptions {
  /** Migrate data from existing shards */
  migrateData?: boolean
}

/**
 * Options for removing a shard
 */
export interface RemoveShardOptions {
  /** Force removal even if shard has data */
  force?: boolean

  /** Migrate data to other shards before removal */
  migrateData?: boolean
}

/**
 * Result from shard management operations
 */
export interface ShardOperationResult {
  /** Whether operation succeeded */
  success: boolean

  /** Error if operation failed */
  error?: QueryError
}

/**
 * Options for rebalancing data
 */
export interface RebalanceOptions {
  /** Progress callback */
  onProgress?: (progress: number) => void

  /** Dry run - don't actually move data */
  dryRun?: boolean
}

/**
 * Result from rebalance operation
 */
export interface RebalanceResult {
  /** Whether rebalance succeeded */
  success: boolean

  /** Number of rows moved */
  movedRows: number

  /** Error if rebalance failed */
  error?: QueryError
}

// ============================================================================
// Merger Types
// ============================================================================

/**
 * Options for merging results
 */
export interface MergeOptions {
  /** ORDER BY specification */
  orderBy?: Array<{
    column: string
    direction: 'asc' | 'desc'
  }>

  /** LIMIT */
  limit?: number

  /** OFFSET */
  offset?: number
}

/**
 * Options for merging aggregate results
 */
export interface AggregateSpec {
  /** GROUP BY columns */
  groupBy: string[]

  /** Aggregate functions to merge */
  aggregates: Array<{
    column: string
    func: 'SUM' | 'COUNT' | 'AVG' | 'MIN' | 'MAX' | 'COUNT_DISTINCT'
  }>
}

/**
 * Partial result from a shard (before merge)
 */
export interface PartialResult<T = Record<string, unknown>> {
  /** Result rows */
  rows: T[]

  /** Column information */
  columns: ColumnInfo[]

  /** Whether this is a partial aggregate result */
  isPartial?: boolean

  /** Source shard */
  shard?: string
}

// ============================================================================
// AST Types (for query parsing)
// ============================================================================

/**
 * Type of SQL statement
 */
export type StatementType = 'select' | 'insert' | 'update' | 'delete' | 'create' | 'drop' | 'unknown'

/**
 * Parsed SQL AST
 */
export interface ParsedAST {
  /** Statement type */
  type: StatementType

  /** Tables referenced */
  tables: string[]

  /** Columns selected/modified */
  columns?: string[]

  /** WHERE clause predicates */
  predicates?: string[]

  /** JOIN clauses */
  joins?: Array<{
    table: string
    condition: string
    type: 'inner' | 'left' | 'right' | 'full'
  }>

  /** GROUP BY columns */
  groupBy?: string[]

  /** ORDER BY specification */
  orderBy?: Array<{
    column: string
    direction: 'asc' | 'desc'
  }>

  /** LIMIT */
  limit?: number

  /** OFFSET */
  offset?: number

  /** Aggregate functions used */
  aggregates?: Array<{
    func: string
    column: string
    alias?: string
  }>
}
