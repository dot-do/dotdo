/**
 * DocumentStore
 *
 * Schema-free JSON document storage with JSONPath queries.
 *
 * Features:
 * - CRUD operations with automatic versioning
 * - JSONPath queries with MongoDB-like operators
 * - Secondary indexes for optimized queries
 * - Storage tiering (hot/warm/cold)
 * - Change Data Capture (CDC) for event streaming
 * - Bloom filters for existence checks
 */

// Main store
export { DocumentStore } from './store'
export type {
  ExtendedDocumentStoreOptions,
  CDCChangeEvent,
  CDCSubscription,
} from './store'

// Types
export * from './types'

// Query builders
export { buildWhereClause, buildOrderByClause, toJsonPath } from './queries'

// Indexing
export {
  IndexManager,
  type IndexDefinition,
  type IndexField,
  type IndexStats,
  type IndexManagerOptions,
  INDEX_TEMPLATES,
} from './indexes'

// Tiering
export {
  DocumentTieringManager,
  type DocumentTieringOptions,
  type DocumentTierMetadata,
  type TieredDocument,
  type TierStats,
  ageBasedPolicy,
} from './tiering'
