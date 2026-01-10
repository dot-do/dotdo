/**
 * Data Provider Types
 *
 * Core types for the data provider abstraction layer.
 * Based on React Admin's DataProvider pattern for familiarity.
 *
 * @module @dotdo/react/admin
 */

import type { ZodSchema } from 'zod'

// =============================================================================
// Base Types
// =============================================================================

/**
 * Base interface for items with an ID.
 * All resource items must have a unique identifier.
 */
export interface BaseRecord {
  /** Unique identifier - can be $id (dotdo) or id (standard) */
  $id?: string
  id?: string
  [key: string]: unknown
}

/**
 * Get the ID from a record, supporting both $id and id formats
 */
export function getRecordId(record: BaseRecord): string {
  return record.$id ?? record.id ?? ''
}

/**
 * Sort order for list queries
 */
export type SortOrder = 'asc' | 'desc'

/**
 * Filter operators for queries
 */
export type FilterOperator =
  | 'eq'      // equals
  | 'neq'     // not equals
  | 'gt'      // greater than
  | 'gte'     // greater than or equal
  | 'lt'      // less than
  | 'lte'     // less than or equal
  | 'contains' // string contains
  | 'startsWith'
  | 'endsWith'
  | 'in'      // value in array
  | 'nin'     // value not in array

/**
 * Query filter definition
 */
export interface QueryFilter {
  field: string
  operator: FilterOperator
  value: unknown
}

// =============================================================================
// Method Parameters
// =============================================================================

/**
 * Parameters for getList operation
 */
export interface GetListParams {
  /** Resource name (e.g., 'User', 'Task') */
  resource: string
  /** Pagination settings */
  pagination?: {
    page: number
    perPage: number
  }
  /** Sort settings */
  sort?: {
    field: string
    order: SortOrder
  }
  /** Filters to apply */
  filter?: Record<string, unknown> | QueryFilter[]
  /** Fields to select (projection) */
  select?: string[]
}

/**
 * Result from getList operation
 */
export interface GetListResult<T extends BaseRecord = BaseRecord> {
  /** Array of records */
  data: T[]
  /** Total count for pagination */
  total: number
  /** Cursor for cursor-based pagination */
  cursor?: string | null
  /** Whether more pages exist */
  hasMore?: boolean
}

/**
 * Parameters for getOne operation
 */
export interface GetOneParams {
  /** Resource name */
  resource: string
  /** Record ID */
  id: string
  /** Fields to select (projection) */
  select?: string[]
}

/**
 * Result from getOne operation
 */
export interface GetOneResult<T extends BaseRecord = BaseRecord> {
  data: T
}

/**
 * Parameters for getMany operation (batch get by IDs)
 */
export interface GetManyParams {
  /** Resource name */
  resource: string
  /** Array of record IDs */
  ids: string[]
  /** Fields to select (projection) */
  select?: string[]
}

/**
 * Result from getMany operation
 */
export interface GetManyResult<T extends BaseRecord = BaseRecord> {
  data: T[]
}

/**
 * Parameters for create operation
 */
export interface CreateParams<T extends BaseRecord = BaseRecord> {
  /** Resource name */
  resource: string
  /** Data to create (without ID) */
  data: Omit<T, '$id' | 'id'>
}

/**
 * Result from create operation
 */
export interface CreateResult<T extends BaseRecord = BaseRecord> {
  data: T
}

/**
 * Parameters for update operation
 */
export interface UpdateParams<T extends BaseRecord = BaseRecord> {
  /** Resource name */
  resource: string
  /** Record ID to update */
  id: string
  /** Partial data to update */
  data: Partial<Omit<T, '$id' | 'id'>>
  /** Previous data for optimistic updates */
  previousData?: T
}

/**
 * Result from update operation
 */
export interface UpdateResult<T extends BaseRecord = BaseRecord> {
  data: T
}

/**
 * Parameters for delete operation
 */
export interface DeleteParams<T extends BaseRecord = BaseRecord> {
  /** Resource name */
  resource: string
  /** Record ID to delete */
  id: string
  /** Previous data for rollback */
  previousData?: T
}

/**
 * Result from delete operation
 */
export interface DeleteResult<T extends BaseRecord = BaseRecord> {
  data: T
}

/**
 * Parameters for deleteMany operation
 */
export interface DeleteManyParams {
  /** Resource name */
  resource: string
  /** Array of record IDs to delete */
  ids: string[]
}

/**
 * Result from deleteMany operation
 */
export interface DeleteManyResult {
  /** Array of deleted record IDs */
  data: string[]
}

// =============================================================================
// Data Provider Interface
// =============================================================================

/**
 * Data Provider interface.
 *
 * Abstraction layer that allows swapping backends.
 * Implementations include DotdoDataProvider, MockDataProvider, etc.
 *
 * @example
 * ```ts
 * const provider: DataProvider = {
 *   getList: async (params) => { ... },
 *   getOne: async (params) => { ... },
 *   create: async (params) => { ... },
 *   // ...
 * }
 * ```
 */
export interface DataProvider {
  /**
   * Get a list of records with pagination, sorting, and filtering
   */
  getList<T extends BaseRecord = BaseRecord>(
    params: GetListParams
  ): Promise<GetListResult<T>>

  /**
   * Get a single record by ID
   */
  getOne<T extends BaseRecord = BaseRecord>(
    params: GetOneParams
  ): Promise<GetOneResult<T>>

  /**
   * Get multiple records by their IDs
   */
  getMany<T extends BaseRecord = BaseRecord>(
    params: GetManyParams
  ): Promise<GetManyResult<T>>

  /**
   * Create a new record
   */
  create<T extends BaseRecord = BaseRecord>(
    params: CreateParams<T>
  ): Promise<CreateResult<T>>

  /**
   * Update an existing record
   */
  update<T extends BaseRecord = BaseRecord>(
    params: UpdateParams<T>
  ): Promise<UpdateResult<T>>

  /**
   * Delete a record by ID
   */
  delete<T extends BaseRecord = BaseRecord>(
    params: DeleteParams<T>
  ): Promise<DeleteResult<T>>

  /**
   * Delete multiple records by their IDs
   */
  deleteMany(params: DeleteManyParams): Promise<DeleteManyResult>

  /**
   * Subscribe to real-time updates for a resource.
   * Returns an unsubscribe function.
   */
  subscribe?<T extends BaseRecord = BaseRecord>(
    resource: string,
    callback: (event: SubscriptionEvent<T>) => void
  ): () => void
}

/**
 * Real-time subscription event types
 */
export type SubscriptionEventType = 'created' | 'updated' | 'deleted'

/**
 * Real-time subscription event
 */
export interface SubscriptionEvent<T extends BaseRecord = BaseRecord> {
  type: SubscriptionEventType
  resource: string
  data?: T
  id?: string
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for creating a DataProvider
 */
export interface DataProviderConfig {
  /** Base URL for API calls */
  baseUrl?: string
  /** Custom headers for requests */
  headers?: Record<string, string>
  /** Timeout in milliseconds */
  timeout?: number
  /** Enable real-time subscriptions */
  realtime?: boolean
}

/**
 * Resource-specific configuration
 */
export interface ResourceConfig<T extends BaseRecord = BaseRecord> {
  /** Resource name (e.g., 'User') */
  name: string
  /** Zod schema for validation */
  schema?: ZodSchema<T>
  /** Default sort settings */
  defaultSort?: {
    field: keyof T & string
    order: SortOrder
  }
  /** Default filters */
  defaultFilter?: Record<string, unknown>
  /** Fields to always include */
  defaultSelect?: (keyof T & string)[]
  /** Enable optimistic updates */
  optimistic?: boolean
  /** Cache TTL in milliseconds */
  cacheTTL?: number
}
