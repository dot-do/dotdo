/**
 * ClickHouse-Grade Analytics Engine for Cloudflare Workers
 *
 * Features:
 * - Columnar Storage: Column-oriented data storage for efficient analytics
 * - Aggregations: SUM, AVG, COUNT, MIN, MAX, percentiles (quantile)
 * - Time Series: Time-based bucketing (hour, minute, day, month) and windowing
 * - Materialized Views: Pre-computed aggregations with automatic updates
 * - SQL Interface: ClickHouse-compatible SQL subset
 *
 * @example
 * ```typescript
 * import { AnalyticsEngine } from 'db/analytics'
 *
 * const engine = new AnalyticsEngine()
 *
 * // Create table
 * await engine.createTable('events', {
 *   columns: {
 *     timestamp: 'DateTime',
 *     user_id: 'String',
 *     event_type: 'String',
 *     value: 'Float64',
 *   },
 *   orderBy: ['timestamp'],
 * })
 *
 * // Insert data
 * await engine.insert('events', [
 *   { timestamp: new Date(), user_id: 'u1', event_type: 'click', value: 1 },
 * ])
 *
 * // Query with SQL
 * const result = await engine.query(`
 *   SELECT
 *     toStartOfHour(timestamp) as hour,
 *     event_type,
 *     count() as events,
 *     sum(value) as total
 *   FROM events
 *   GROUP BY hour, event_type
 *   ORDER BY hour DESC
 * `)
 * ```
 *
 * @module db/analytics
 */

// Main engine
export { AnalyticsEngine } from './engine'

// Types
export {
  // Column types
  type ColumnType,
  type AggregationType,

  // Schema
  type ColumnDefinition,
  type TableSchema,
  type ResolvedTableSchema,

  // Query results
  type QueryResult,

  // Materialized views
  type MaterializedView,
  type MaterializedViewConfig,

  // SQL AST
  type SQLOperator,
  type LogicalOperator,
  type SQLCondition,
  type SQLExpression,
  type SQLFunction,
  type SQLAggregation,
  type SQLOrderBy,
  type SQLWithFill,
  type SQLSelectStatement,

  // Window functions
  type WindowSpec,
  type WindowFrame,
  type WindowFunction,

  // Storage
  type ColumnStore,
  type ColumnStats,
  type Partition,

  // Time series
  type TimeGranularity,
  type TimeInterval,

  // Errors
  AnalyticsError,
  type AnalyticsErrorCode,
} from './types'

// SQL Parser
export { parseSQL } from './sql-parser'
