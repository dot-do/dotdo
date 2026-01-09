/**
 * @dotdo/payload - Payload CMS Database Adapter
 *
 * A hybrid database adapter for Payload CMS that supports both:
 * - Things storage (MongoDB-style, schema-less documents)
 * - Drizzle storage (SQL-style, typed tables with migrations)
 *
 * @module @dotdo/payload
 */

// ============================================================================
// MAIN ADAPTER EXPORT
// ============================================================================

export { dotdoAdapter, createStorageRouter } from './adapter'

// Re-export types - note: StorageRouter interface is defined in adapter/index.ts
export type { DotdoAdapterArgs, DotdoAdapter, IDType } from './adapter'

// Export StorageRouter type separately to avoid conflict
import type { StorageRouter as _StorageRouter } from './adapter'
export type { _StorageRouter as StorageRouter }

// ============================================================================
// STRATEGY TYPES
// ============================================================================

export type {
  StorageMode,
  StorageStrategy,
  StorageRouterConfig,
  // CRUD types
  CreateArgs,
  FindArgs,
  FindOneArgs,
  UpdateOneArgs,
  UpdateManyArgs,
  DeleteOneArgs,
  DeleteManyArgs,
  CountArgs,
  FindDistinctArgs,
  UpsertArgs,
  // Version types
  CreateVersionArgs,
  FindVersionsArgs,
  UpdateVersionArgs,
  DeleteVersionsArgs,
  CountVersionsArgs,
  QueryDraftsArgs,
  // Global types
  CreateGlobalArgs,
  FindGlobalArgs,
  UpdateGlobalArgs,
  CreateGlobalVersionArgs,
  FindGlobalVersionsArgs,
  UpdateGlobalVersionArgs,
  CountGlobalVersionsArgs,
  // Common types
  PaginatedDocs,
  BulkResult,
  Version,
  WhereClause,
  WhereOperator,
  PayloadRequest,
  Payload,
  GlobalConfig,
} from './strategies/types'

// ============================================================================
// ADAPTER TYPES (Legacy)
// ============================================================================

export type {
  PayloadDatabaseAdapter,
  PayloadAdapterConfig,
  PayloadField,
  PayloadFieldType,
  PayloadCollection,
  PayloadDocument,
  CollectionToNoun,
  FieldToData,
  PayloadDocumentToThing,
  RelationshipFieldMapping,
} from './adapter/types'

export { slugToNounName, fieldNameToVerb, mapFieldType } from './adapter/types'

// ============================================================================
// TESTING HARNESS
// ============================================================================

export type {
  AdapterOperation,
  SeedData,
  PayloadAdapterHarnessConfig,
  PayloadAdapterHarness,
  ThingsStore,
  RelationshipsStore,
  NounsStore,
  MockPayloadAdapter,
} from './testing/harness'

export { createPayloadAdapterHarness } from './testing/harness'
