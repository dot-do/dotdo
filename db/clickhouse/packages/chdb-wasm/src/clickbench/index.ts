/**
 * ClickBench Module
 *
 * This module provides ClickBench benchmark functionality for the MergeTree WASM module.
 * It includes:
 * - Schema definitions for the hits table
 * - All 43 official ClickBench queries
 * - Query executor for MergeTree WASM
 * - HTTP handler for benchmark endpoints
 *
 * @module clickbench
 */

// Schema exports
export {
  HITS_COLUMNS,
  HITS_COLUMNS_BY_NAME,
  HITS_TABLE_METADATA,
  getColumn,
  hasColumn,
  getColumnNames,
  generateCreateTableStatement,
  getJSType,
  isNumericType,
  isStringType,
  isDateTimeType,
  type ClickHouseType,
  type ColumnDefinition,
} from './schema';

// Query exports
export {
  CLICKBENCH_QUERIES,
  QUERY_COUNT,
  getQueryById,
  getQueriesByCategory,
  getQueriesByComplexity,
  getQueriesUsingColumn,
  getSimpleQueries,
  getNonAggregateQueries,
  getQueryStatistics,
  type ClickBenchQuery,
  type QueryCategory,
  type QueryComplexity,
} from './queries';

// Executor exports
export {
  ClickBenchExecutor,
  createClickBenchExecutor,
  parseQuery,
  type QueryResult,
  type ResultRow,
  type ParsedQuery,
  type ParsedAggregate,
  type ParsedCondition,
  type PartInfo,
  type AggregateFunction,
  type ClickBenchExecutorOptions,
} from './executor';

// Handler exports
export {
  handleClickBenchRequest,
  setClickBenchSqlExecutor,
  type ClickBenchRequestEnv,
} from './handler';

// Parquet data source exports
export {
  ParquetDataSource,
  createClickBenchParquetSource,
  executeParquetQuery,
  type ParquetDataSourceOptions,
  type ClickBenchDataSource,
  type ReadColumnsOptions,
} from './parquet-data-source';
