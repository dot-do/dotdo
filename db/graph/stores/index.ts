/**
 * Graph Stores Module
 *
 * Exports concrete GraphStore implementations for different backends.
 *
 * Available stores:
 * - SQLiteGraphStore: Basic SQLite backend with Drizzle ORM
 * - DocumentGraphStore: MongoDB-style document store with query operators
 *
 * @module db/graph/stores
 */

export { SQLiteGraphStore } from './sqlite'
export { DocumentGraphStore } from './document'

// Re-export DocumentGraphStore types for convenience
export type {
  IndexInfo,
  QueryOperators,
  LogicalQuery,
  FindThingsQuery,
  BulkUpdateFilter,
  BulkUpdateOperations,
  BulkUpdateResult,
  BulkDeleteResult,
  MatchStage,
  GroupStage,
  SortStage,
  AggregationStage,
  CollectionStats,
  TransactionSession,
} from './document'
