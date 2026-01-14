/**
 * bashx Storage Module
 *
 * Cost-optimized storage patterns for Durable Object SQLite.
 *
 * @module bashx/storage
 */

export {
  // Schema Types (from fsx.do/storage)
  type ColumnType,
  type ColumnDefinition,
  type SchemaDefinition,

  // Session Types (bashx-specific)
  type SessionState,
  type CommandHistoryEntry,
  type OpenFileHandle,
  type ProcessInfo,

  // Cache Types (from fsx.do/storage)
  type EvictionReason,
  type WriteBufferCacheOptions,
  type CacheStats,
  type CheckpointTriggers,
  type ColumnarStoreOptions,
  type CheckpointStats,
  type CostComparison,

  // Session Store Types (bashx-specific)
  type ColumnarSessionStoreOptions,

  // Classes (ColumnarStore from fsx.do/storage, ColumnarSessionStore bashx-specific)
  WriteBufferCache,
  ColumnarStore,
  ColumnarSessionStore,

  // Schema Constants (bashx-specific)
  SESSION_SCHEMA,

  // Utilities (from fsx.do/storage)
  analyzeWorkloadCost,
  printCostReport,
} from './columnar-store.js'
