/**
 * @dotdo/chdb-wasm
 *
 * WASM-compiled chdb (ClickHouse) optimized for Cloudflare Workers.
 *
 * @example
 * ```typescript
 * import { createChdb } from '@dotdo/chdb-wasm';
 *
 * const chdb = await createChdb();
 * const result = await chdb.query('SELECT 1 + 1 as result', { format: 'JSON' });
 * console.log(result);
 * ```
 *
 * @packageDocumentation
 */

export { createChdb, getChdbVersion, ChdbError, DisposedError } from './chdb';

export type {
  ChdbInstance,
  ChdbConfig,
  QueryOptions,
  MemoryStats,
  OutputFormat,
} from './types';

// Re-export worker types
export type { Env } from './worker';

// Re-export logger utilities for consumers
export {
  createLogger,
  configureLogging,
  setDebugEnabled,
  isDebugEnabled,
  setLogLevel,
  getLogLevel,
  LogLevel,
  defaultLogger,
  debug,
  info,
  warn,
  error,
} from './utils/logger';

export type { Logger, LoggerConfig, LogEntry } from './utils/logger';

// Re-export query builder for document-style queries
export { DocumentQueryBuilder } from './query-builder';

export type {
  DocumentQueryBuilderOptions,
  FilterObject,
  FieldCondition,
  OperatorExpression,
  FilterValue,
  OrderDirection,
} from './query-builder';

// Re-export MergeTree VFS for WASM compatibility
export {
  WasmMergeTreeVFS,
  StubMergeScheduler,
  StubMutationScheduler,
  StubMmapManager,
  StubSyncManager,
  StubHardLinkManager,
  getStubDiskSpace,
  createWasmMergeTreeVFS,
  DEFAULT_WASM_MERGETREE_CONFIG,
} from './mergetree-vfs';

export type {
  WasmMergeTreeConfig,
  WasmReadSettings,
  StubDiskSpace,
  SyncGuard,
} from './mergetree-vfs';

// Re-export Parquet reader for reading remote Parquet files
export {
  ParquetReader,
  ParquetReaderFromBuffer,
  createParquetReader,
  readParquetUrl,
  getParquetUrlMetadata,
} from './parquet-reader';

export type {
  ParquetColumnInfo,
  ParquetFileMetadata,
  ParquetReadOptions,
  ParquetReadResult,
  RowGroupStatistics,
} from './parquet-reader';
