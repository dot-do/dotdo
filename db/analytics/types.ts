/**
 * ClickHouse-Grade Analytics Engine - Type Definitions
 *
 * Types for columnar storage, aggregations, time series,
 * materialized views, and SQL interface.
 */

// ============================================================================
// COLUMN TYPES (ClickHouse-compatible)
// ============================================================================

export type ColumnType =
  | 'String'
  | 'Int8'
  | 'Int16'
  | 'Int32'
  | 'Int64'
  | 'UInt8'
  | 'UInt16'
  | 'UInt32'
  | 'UInt64'
  | 'Float32'
  | 'Float64'
  | 'DateTime'
  | 'Date'
  | 'Boolean'
  | 'JSON'
  | `Array(${string})`
  | `Nullable(${string})`

// ============================================================================
// AGGREGATION TYPES
// ============================================================================

export type AggregationType =
  | 'count'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'uniq'
  | 'quantile'
  | 'stddev'
  | 'variance'

// ============================================================================
// TABLE SCHEMA
// ============================================================================

export interface ColumnDefinition {
  type: ColumnType
  nullable?: boolean
  default?: unknown
  codec?: string
}

export interface TableSchema {
  columns: Record<string, ColumnType | ColumnDefinition>
  orderBy?: string[]
  partitionBy?: string
  primaryKey?: string[]
  ttl?: string
  engine?: string
}

export interface ResolvedTableSchema {
  columns: Record<string, ColumnType>
  orderBy: string[]
  partitionBy?: string
  primaryKey: string[]
}

// ============================================================================
// QUERY RESULT
// ============================================================================

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[]
  columns: string[]
  columnTypes: Record<string, ColumnType>
  rowCount: number
  executionTimeMs: number
  bytesScanned: number
  columnsScanned?: string[]
}

// ============================================================================
// MATERIALIZED VIEW
// ============================================================================

export interface MaterializedViewConfig {
  source: string
  query: string
  refreshInterval?: string
  populateOnCreate?: boolean
}

export interface MaterializedView {
  name: string
  source: string
  query: string
  refreshInterval?: string
  lastRefresh?: Date
  schema: ResolvedTableSchema
}

// ============================================================================
// SQL AST TYPES
// ============================================================================

export type SQLOperator =
  | '='
  | '!='
  | '<>'
  | '<'
  | '<='
  | '>'
  | '>='
  | 'LIKE'
  | 'NOT LIKE'
  | 'IN'
  | 'NOT IN'
  | 'BETWEEN'
  | 'IS NULL'
  | 'IS NOT NULL'

export type LogicalOperator = 'AND' | 'OR'

export interface SQLCondition {
  column: string
  operator: SQLOperator
  value: unknown
  values?: unknown[] // For IN and BETWEEN
}

export interface SQLExpression {
  type: 'condition' | 'logical' | 'function'
  condition?: SQLCondition
  operator?: LogicalOperator
  left?: SQLExpression
  right?: SQLExpression
  function?: SQLFunction
}

export interface SQLFunction {
  name: string
  args: (string | number | SQLFunction)[]
  alias?: string
}

export interface SQLAggregation {
  type: AggregationType
  column?: string
  columnFunc?: SQLFunction // For nested functions like avg(JSONExtractFloat(...))
  alias: string
  args?: number[] // For quantile(0.95)
}

export interface SQLOrderBy {
  column: string
  direction: 'ASC' | 'DESC'
}

export interface SQLWithFill {
  from: Date | string
  to: Date | string
  step: string
}

export interface SQLSelectStatement {
  type: 'select'
  columns: (string | SQLAggregation | SQLFunction)[]
  from: string | SQLSelectStatement // For subqueries
  where?: SQLExpression
  groupBy?: string[]
  having?: SQLExpression
  orderBy?: SQLOrderBy[]
  limit?: number
  offset?: number
  withFill?: SQLWithFill
}

// ============================================================================
// WINDOW FUNCTION TYPES
// ============================================================================

export interface WindowSpec {
  partitionBy?: string[]
  orderBy?: SQLOrderBy[]
  frame?: WindowFrame
}

export interface WindowFrame {
  type: 'ROWS' | 'RANGE'
  start: 'UNBOUNDED PRECEDING' | 'CURRENT ROW' | number
  end?: 'UNBOUNDED FOLLOWING' | 'CURRENT ROW' | number
}

export interface WindowFunction {
  function: SQLAggregation
  over: WindowSpec
  alias: string
}

// ============================================================================
// COLUMNAR STORAGE TYPES
// ============================================================================

export interface ColumnStore<T = unknown> {
  values: T[]
  nullBitmap?: boolean[]
  stats: ColumnStats
}

export interface ColumnStats {
  count: number
  nullCount: number
  min?: unknown
  max?: unknown
  distinctCount?: number
}

export interface Partition {
  key: string | number
  columns: Map<string, ColumnStore>
  rowCount: number
}

// ============================================================================
// TIME SERIES TYPES
// ============================================================================

export type TimeGranularity =
  | 'second'
  | 'minute'
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'

export interface TimeInterval {
  value: number
  unit: TimeGranularity
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export class AnalyticsError extends Error {
  constructor(
    message: string,
    public code: AnalyticsErrorCode,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AnalyticsError'
  }
}

export type AnalyticsErrorCode =
  | 'TABLE_NOT_FOUND'
  | 'TABLE_EXISTS'
  | 'COLUMN_NOT_FOUND'
  | 'INVALID_TYPE'
  | 'SYNTAX_ERROR'
  | 'AGGREGATION_ERROR'
  | 'VIEW_NOT_FOUND'
  | 'VIEW_EXISTS'
  | 'INVALID_QUERY'
