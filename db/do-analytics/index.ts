/**
 * DO Analytics - Cross-DO Query Layer for Iceberg-Backed State
 *
 * This module provides analytics capabilities across all Durable Objects
 * using their Iceberg-formatted state stored in R2. It enables:
 *
 * - **Catalog Discovery**: List all DOs and their tables
 * - **Cross-DO Queries**: Query data across multiple DOs simultaneously
 * - **Time Travel**: Query historical snapshots
 * - **Aggregations**: Run aggregate queries across the entire DO fleet
 *
 * ## Architecture
 *
 * ```
 * DuckDB Query
 *      │
 *      ▼
 * ┌─────────────────┐
 * │ IcebergCatalog  │  ◄── This module
 * └────────┬────────┘
 *          │
 *          ▼
 * ┌─────────────────┐
 * │  R2 (Iceberg)   │  ◄── Parquet files + metadata
 * └─────────────────┘
 * ```
 *
 * ## Example Usage
 *
 * ```typescript
 * import { IcebergCatalog } from '@dotdo/do-analytics'
 *
 * const catalog = new IcebergCatalog(env.R2)
 *
 * // List all DOs with state
 * const dos = await catalog.listDOs()
 * // => [{ id: 'payments-do', currentSnapshotId: 'snap-001', lastUpdatedMs: ... }]
 *
 * // List tables in a DO
 * const tables = await catalog.listTables('payments-do')
 * // => [{ name: 'transactions', rowCount: 1000, columns: [...] }]
 *
 * // Build cross-DO query for DuckDB
 * const sql = await catalog.buildCrossDoQuery('transactions')
 * // => "SELECT *, 'payments-do' AS do_id FROM read_parquet(...) UNION ALL ..."
 *
 * // Build aggregation query
 * const aggSql = await catalog.buildAggregationQuery('transactions', {
 *   select: ['do_id', 'SUM(amount) as total'],
 *   groupBy: ['do_id'],
 * })
 * ```
 *
 * @module db/do-analytics
 */

export {
  IcebergCatalog,
  type DOInfo,
  type TableInfo,
  type ColumnInfo,
  type SnapshotInfo,
  type CrossDoQueryInfo,
  type TimeTravel,
  type AggregationOptions,
} from './iceberg-catalog'
