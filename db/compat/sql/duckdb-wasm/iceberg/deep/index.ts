/**
 * Deep DuckDB-Iceberg Integration
 *
 * Comprehensive integration for DuckDB WASM + Iceberg tables stored in R2.
 *
 * Features:
 * - REST catalog protocol with OAuth2
 * - S3/R2 storage adapter
 * - Snapshot management and isolation
 * - Time-travel queries (AS OF TIMESTAMP)
 * - Partition pruning for R2-backed tables
 * - Table creation and schema evolution
 * - Compaction triggers and execution
 *
 * @module db/compat/sql/duckdb-wasm/iceberg/deep
 */

export * from './types'
export * from './catalog'
export * from './storage'
export * from './snapshot'
export * from './time-travel'
export * from './partition-pruner'
export * from './compaction'
export * from './table'
