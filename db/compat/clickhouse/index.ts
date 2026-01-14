/**
 * ClickHouse Compatibility Layer
 *
 * A ClickHouse-compatible analytics engine built on unified primitives.
 * Provides SQL interface, MergeTree tables, and OLAP aggregations.
 *
 * ## Usage
 *
 * ```typescript
 * import { ClickHouseClient, MergeTreeTable } from 'dotdo/db/compat/clickhouse'
 *
 * // SQL Interface
 * const client = new ClickHouseClient({ mode: 'memory' })
 *
 * await client.query(`
 *   CREATE TABLE hits (
 *     event_date Date,
 *     user_id UInt64,
 *     views UInt32
 *   ) ENGINE = MergeTree()
 *   ORDER BY (event_date, user_id)
 * `)
 *
 * await client.query(`
 *   INSERT INTO hits VALUES
 *   ('2024-01-01', 1, 100),
 *   ('2024-01-01', 2, 200)
 * `)
 *
 * const result = await client.query<{ user_id: number; total: number }>(`
 *   SELECT user_id, sum(views) as total
 *   FROM hits
 *   GROUP BY user_id
 *   ORDER BY total DESC
 * `)
 *
 * // Direct Table API
 * const table = new MergeTreeTable({
 *   name: 'events',
 *   engine: 'MergeTree',
 *   columns: [
 *     { name: 'timestamp', type: 'DateTime' },
 *     { name: 'event', type: 'String' },
 *     { name: 'value', type: 'Float64' },
 *   ],
 *   orderBy: ['timestamp'],
 * })
 *
 * table.insertBatch([
 *   { timestamp: new Date(), event: 'click', value: 1.5 },
 *   { timestamp: new Date(), event: 'view', value: 0.5 },
 * ])
 *
 * // Aggregations
 * const totals = table.aggregate({ sum: 'value', count: '*' })
 *
 * // Window Functions
 * const ranked = table.selectWithWindow({
 *   columns: ['event', 'value'],
 *   window: {
 *     rowNumber: 'rn',
 *     orderBy: [{ column: 'value', direction: 'DESC' }],
 *   }
 * })
 *
 * // CUBE/ROLLUP
 * const cube = table.cube({
 *   dimensions: ['event'],
 *   measures: { total: { $sum: 'value' } }
 * })
 * ```
 *
 * @see dotdo-b80fl - Unified Analytics Compat Layer Epic
 * @module db/compat/clickhouse
 */

// =============================================================================
// Table Exports
// =============================================================================

export {
  MergeTreeTable,
  type TableSchema,
  type ColumnDef,
  type ClickHouseType,
  type MergeTreeEngine,
  type SelectOptions,
  type WhereClause,
  type WhereOperator,
  type OrderByClause,
  type AggregateSpec,
  type AggregateResult,
  type GroupByOptions,
  type GroupByResult,
  type WindowSpec,
  type WindowSelectOptions,
  type CubeRollupSpec,
} from './tables'

// =============================================================================
// Aggregation Exports
// =============================================================================

export {
  // Types
  type Aggregator,
  type AggregatorState,
  type AggregatorType,

  // Factory
  createAggregator,

  // Basic Aggregators
  CountAggregator,
  SumAggregator,
  AvgAggregator,
  MinAggregator,
  MaxAggregator,

  // Distinct Aggregators
  UniqExactAggregator,
  UniqHLLAggregator,

  // Statistical Aggregators
  QuantileAggregator,
  QuantilesAggregator,
  StddevPopAggregator,
  VarPopAggregator,

  // Ordering Aggregators
  ArgMinAggregator,
  ArgMaxAggregator,
  FirstValueAggregator,
  LastValueAggregator,

  // Array Aggregators
  GroupArrayAggregator,
  GroupUniqArrayAggregator,
  TopKAggregator,

  // Conditional Aggregators
  SumIfAggregator,
  CountIfAggregator,
  AvgIfAggregator,

  // Approximate Aggregators
  AnyHeavyAggregator,
} from './aggregations'

// =============================================================================
// Engine Exports
// =============================================================================

export {
  ClickHouseEngine,
  QueryPlanner,
  MaterializedView,
  type PlanNode,
  type PlanNodeType,
  type ExplainResult,
  type AggregateQueryOptions,
  type AggregateQueryResult,
  type ExplainQueryOptions,
} from './engine'

// =============================================================================
// Client Exports
// =============================================================================

export {
  ClickHouseClient,
  type ClickHouseConfig,
  type QueryResult,
  type QueryStatistics,
} from './client'
