/**
 * @dotdo/react Admin Integration
 *
 * Provides a data provider abstraction layer for admin interfaces.
 * Allows swapping dotdo for other backends while keeping UI agnostic.
 *
 * @example
 * ```tsx
 * import { AdminProvider, DotdoDataProvider, useResource } from '@dotdo/react/admin'
 *
 * function App() {
 *   const dataProvider = DotdoDataProvider({ ns: 'https://api.example.com.ai' })
 *
 *   return (
 *     <AdminProvider dataProvider={dataProvider}>
 *       <UserList />
 *     </AdminProvider>
 *   )
 * }
 *
 * function UserList() {
 *   const { data, isLoading, create, update, remove } = useResource('User')
 *   // ...
 * }
 * ```
 *
 * @module @dotdo/react/admin
 */

// Core types and interfaces
export type {
  DataProvider,
  DataProviderConfig,
  ResourceConfig,
  GetListParams,
  GetListResult,
  GetOneParams,
  GetOneResult,
  GetManyParams,
  GetManyResult,
  CreateParams,
  CreateResult,
  UpdateParams,
  UpdateResult,
  DeleteParams,
  DeleteResult,
  DeleteManyParams,
  DeleteManyResult,
  SortOrder,
  FilterOperator,
  QueryFilter,
} from './types'

// Provider components
export { AdminProvider, useAdminContext } from './AdminProvider'
export type { AdminProviderProps, AdminContextValue } from './AdminProvider'

// Data providers
export { DotdoDataProvider } from './DotdoDataProvider'
export type { DotdoDataProviderConfig } from './DotdoDataProvider'

// Resource hooks
export { useResource } from './useResource'
export type { UseResourceConfig, UseResourceResult } from './useResource'

export { useResourceRecord } from './useResourceRecord'
export type { UseResourceRecordConfig, UseResourceRecordResult } from './useResourceRecord'

// Error handling
export { AdminError, isAdminError, formatAdminError } from './errors'
export type { AdminErrorCode, AdminErrorDetails } from './errors'

// Schema utilities
export { inferFieldsFromSchema, createResourceFromSchema } from './schema'
export type { InferredField, ResourceDefinition } from './schema'

// Cache utilities
export { createCacheKey, invalidateCache, useOptimisticUpdate } from './cache'
export type { CacheConfig, OptimisticConfig } from './cache'
