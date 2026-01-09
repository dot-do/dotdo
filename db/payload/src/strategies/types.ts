/**
 * Storage Strategy Types for @dotdo/payload
 *
 * Defines the interface for storage strategies that implement the actual
 * database operations. The adapter delegates to strategies based on config.
 *
 * There are two strategies:
 * - ThingsStrategy: MongoDB-style document storage using Things table
 * - DrizzleStrategy: Standard relational tables with migrations
 *
 * @module @dotdo/payload/strategies/types
 */

import type { PayloadField, PayloadCollection, PayloadDocument } from '../adapter/types'

// ============================================================================
// STORAGE MODE
// ============================================================================

/**
 * Storage mode - determines which strategy handles a collection/global
 */
export type StorageMode = 'things' | 'drizzle'

// ============================================================================
// CRUD ARGUMENT TYPES
// ============================================================================

/**
 * Arguments for create operation
 */
export interface CreateArgs {
  collection: string
  data: Record<string, unknown>
  req?: PayloadRequest
}

/**
 * Arguments for find operation
 */
export interface FindArgs {
  collection: string
  where?: WhereClause
  sort?: string
  limit?: number
  page?: number
  depth?: number
  req?: PayloadRequest
}

/**
 * Arguments for findOne operation
 */
export interface FindOneArgs {
  collection: string
  id?: string
  where?: WhereClause
  depth?: number
  req?: PayloadRequest
}

/**
 * Arguments for updateOne operation
 */
export interface UpdateOneArgs {
  collection: string
  id: string
  data: Record<string, unknown>
  req?: PayloadRequest
}

/**
 * Arguments for updateMany operation
 */
export interface UpdateManyArgs {
  collection: string
  where: WhereClause
  data: Record<string, unknown>
  req?: PayloadRequest
}

/**
 * Arguments for deleteOne operation
 */
export interface DeleteOneArgs {
  collection: string
  id: string
  req?: PayloadRequest
}

/**
 * Arguments for deleteMany operation
 */
export interface DeleteManyArgs {
  collection: string
  where: WhereClause
  req?: PayloadRequest
}

/**
 * Arguments for count operation
 */
export interface CountArgs {
  collection: string
  where?: WhereClause
  req?: PayloadRequest
}

// ============================================================================
// VERSION ARGUMENT TYPES
// ============================================================================

/**
 * Arguments for createVersion operation
 */
export interface CreateVersionArgs {
  collection: string
  id: string
  type?: 'draft' | 'published'
  label?: string
  createdBy?: string
  req?: PayloadRequest
}

/**
 * Arguments for findVersions operation
 */
export interface FindVersionsArgs {
  collection: string
  id: string
  sort?: string
  page?: number
  limit?: number
  where?: WhereClause
  req?: PayloadRequest
}

// ============================================================================
// GLOBAL ARGUMENT TYPES
// ============================================================================

/**
 * Arguments for findGlobal operation
 */
export interface FindGlobalArgs {
  slug: string
  depth?: number
  req?: PayloadRequest
}

/**
 * Arguments for createGlobal operation
 */
export interface CreateGlobalArgs {
  slug: string
  data: Record<string, unknown>
  req?: PayloadRequest
}

/**
 * Arguments for updateGlobal operation
 */
export interface UpdateGlobalArgs {
  slug: string
  data: Record<string, unknown>
  draft?: boolean
  req?: PayloadRequest
}

// ============================================================================
// RESULT TYPES
// ============================================================================

/**
 * Paginated document result
 */
export interface PaginatedDocs<T = PayloadDocument> {
  docs: T[]
  totalDocs: number
  limit: number
  page: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

/**
 * Bulk operation result
 */
export interface BulkResult {
  count: number
}

/**
 * Version record
 */
export interface Version {
  id: string
  parent: string
  versionNumber: number
  type: 'draft' | 'published'
  label?: string
  createdBy?: string
  createdAt: Date
  version: Record<string, unknown>
}

// ============================================================================
// WHERE CLAUSE TYPES
// ============================================================================

/**
 * Payload where clause operator
 */
export interface WhereOperator {
  equals?: unknown
  not_equals?: unknown
  in?: unknown[]
  not_in?: unknown[]
  greater_than?: unknown
  greater_than_equal?: unknown
  less_than?: unknown
  less_than_equal?: unknown
  like?: string
  contains?: string
  exists?: boolean
}

/**
 * Payload where clause structure
 */
export interface WhereClause {
  [field: string]: WhereOperator | WhereClause[] | undefined
  and?: WhereClause[]
  or?: WhereClause[]
}

// ============================================================================
// REQUEST TYPES
// ============================================================================

/**
 * Payload request context
 */
export interface PayloadRequest {
  transactionID?: string
  user?: {
    id: string
    collection: string
    [key: string]: unknown
  }
  locale?: string
  fallbackLocale?: string
  [key: string]: unknown
}

// ============================================================================
// PAYLOAD CONFIGURATION
// ============================================================================

/**
 * Minimal Payload instance interface
 */
export interface Payload {
  collections: Record<string, { config: PayloadCollection }>
  globals?: Record<string, { config: GlobalConfig }>
  config: {
    collections: PayloadCollection[]
    globals?: GlobalConfig[]
  }
}

/**
 * Global configuration
 */
export interface GlobalConfig {
  slug: string
  fields: PayloadField[]
  versions?: {
    drafts?: boolean
    maxPerDoc?: number
  }
}

// ============================================================================
// STORAGE STRATEGY INTERFACE
// ============================================================================

/**
 * Storage strategy interface for Payload CMS.
 *
 * Strategies implement different storage backends:
 * - DrizzleStrategy: Standard relational tables with migrations
 * - ThingsStrategy: MongoDB-style document storage with Things table
 *
 * All strategies must implement this interface to provide
 * consistent behavior for Payload CMS operations.
 */
export interface StorageStrategy {
  /**
   * Initialize the strategy with Payload configuration.
   * Called once when Payload starts up.
   *
   * @param payload - Payload instance
   * @param collections - Collection configurations
   */
  init(payload: Payload, collections: PayloadCollection[]): Promise<void>

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a new document
   */
  create(args: CreateArgs): Promise<PayloadDocument>

  /**
   * Find documents with filtering, sorting, and pagination
   */
  find(args: FindArgs): Promise<PaginatedDocs>

  /**
   * Find a single document by ID or where clause
   */
  findOne(args: FindOneArgs): Promise<PayloadDocument | null>

  /**
   * Update a single document by ID
   */
  updateOne(args: UpdateOneArgs): Promise<PayloadDocument>

  /**
   * Update multiple documents matching where clause
   */
  updateMany(args: UpdateManyArgs): Promise<BulkResult>

  /**
   * Delete a single document by ID
   */
  deleteOne(args: DeleteOneArgs): Promise<PayloadDocument>

  /**
   * Delete multiple documents matching where clause
   */
  deleteMany(args: DeleteManyArgs): Promise<BulkResult>

  /**
   * Count documents matching where clause
   */
  count(args: CountArgs): Promise<number>

  // ─────────────────────────────────────────────────────────────────────────
  // VERSION OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a version snapshot of a document
   */
  createVersion(args: CreateVersionArgs): Promise<Version>

  /**
   * Find versions of a document
   */
  findVersions(args: FindVersionsArgs): Promise<PaginatedDocs<Version>>

  // ─────────────────────────────────────────────────────────────────────────
  // GLOBAL OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Find a global document by slug
   */
  findGlobal(args: FindGlobalArgs): Promise<PayloadDocument>

  /**
   * Create or initialize a global document
   */
  createGlobal(args: CreateGlobalArgs): Promise<PayloadDocument>

  /**
   * Update a global document
   */
  updateGlobal(args: UpdateGlobalArgs): Promise<PayloadDocument>

  // ─────────────────────────────────────────────────────────────────────────
  // TRANSACTION OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Begin a new transaction
   * @returns Transaction ID
   */
  beginTransaction(): Promise<string>

  /**
   * Commit an active transaction
   * @param id - Transaction ID
   */
  commitTransaction(id: string): Promise<void>

  /**
   * Rollback an active transaction
   * @param id - Transaction ID
   */
  rollbackTransaction(id: string): Promise<void>
}

// ============================================================================
// ADDITIONAL CRUD ARGUMENT TYPES
// ============================================================================

/**
 * Arguments for findDistinct operation
 */
export interface FindDistinctArgs {
  collection: string
  field: string
  where?: WhereClause
  req?: PayloadRequest
}

/**
 * Arguments for upsert operation
 */
export interface UpsertArgs {
  collection: string
  id?: string
  where?: WhereClause
  data: Record<string, unknown>
  req?: PayloadRequest
}

// ============================================================================
// ADDITIONAL VERSION ARGUMENT TYPES
// ============================================================================

/**
 * Arguments for updateVersion operation
 */
export interface UpdateVersionArgs {
  collection: string
  versionId: string
  data: Record<string, unknown>
  req?: PayloadRequest
}

/**
 * Arguments for deleteVersions operation
 */
export interface DeleteVersionsArgs {
  collection: string
  where?: WhereClause
  ids?: string[]
  req?: PayloadRequest
}

/**
 * Arguments for countVersions operation
 */
export interface CountVersionsArgs {
  collection: string
  where?: WhereClause
  req?: PayloadRequest
}

/**
 * Arguments for queryDrafts operation
 */
export interface QueryDraftsArgs {
  collection: string
  where?: WhereClause
  sort?: string
  limit?: number
  page?: number
  depth?: number
  req?: PayloadRequest
}

// ============================================================================
// GLOBAL VERSION ARGUMENT TYPES
// ============================================================================

/**
 * Arguments for createGlobalVersion operation
 */
export interface CreateGlobalVersionArgs {
  slug: string
  type?: 'draft' | 'published'
  label?: string
  createdBy?: string
  req?: PayloadRequest
}

/**
 * Arguments for findGlobalVersions operation
 */
export interface FindGlobalVersionsArgs {
  slug: string
  sort?: string
  page?: number
  limit?: number
  where?: WhereClause
  req?: PayloadRequest
}

/**
 * Arguments for updateGlobalVersion operation
 */
export interface UpdateGlobalVersionArgs {
  slug: string
  versionId: string
  data: Record<string, unknown>
  req?: PayloadRequest
}

/**
 * Arguments for countGlobalVersions operation
 */
export interface CountGlobalVersionsArgs {
  slug: string
  where?: WhereClause
  req?: PayloadRequest
}

// ============================================================================
// STORAGE ROUTER CONFIGURATION
// ============================================================================

/**
 * Configuration for the storage router.
 * Determines which strategy handles each collection/global.
 */
export interface StorageRouterConfig {
  /**
   * Default storage mode for all collections
   * @default 'things'
   */
  storage?: StorageMode

  /**
   * Per-collection storage mode overrides
   */
  collections?: Record<string, StorageMode>

  /**
   * Per-global storage mode overrides
   */
  globals?: Record<string, StorageMode>
}
