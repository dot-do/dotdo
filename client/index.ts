/**
 * dotdo/client Entry Point
 *
 * This module exports all client-side utilities for building React applications
 * that interact with dotdo backends.
 *
 * ## Hooks
 *
 * - `use$` / `useDollar` - Access the $ workflow context
 * - `useCollection` - Access a synced collection of items
 * - `useSyncForm` - Synced form state with auto-save
 * - `useSyncTable` - Synced table with pagination
 *
 * ## Provider Factories (for shadmin)
 *
 * - `createDataProvider` - Create a react-admin DataProvider
 * - `createAuthProvider` - Create a react-admin AuthProvider
 *
 * ## Context Factory (for saaskit)
 *
 * - `create$Context` - Create a $ context with Provider and hook
 *
 * @module client
 */

// =============================================================================
// Hooks
// =============================================================================

export {
  use$,
  useDollar,
  useCollection,
  useSyncForm,
  useSyncTable,
  // Runtime type marker (for runtime type checking)
  DollarContext,
} from './hooks'

export type {
  DollarContext as DollarContextType,
  CollectionHookResult,
  SyncFormConfig,
  SyncFormResult,
  SyncTableConfig,
  SyncTableResult,
} from './hooks'

// =============================================================================
// Provider Factories (react-admin adapters)
// =============================================================================

export {
  createDataProvider,
  DataProviderError,
} from './adapters/data-provider'

export type {
  DataProvider,
  DataProviderOptions as DataProviderConfig,
  GetListParams,
  GetOneParams,
  GetManyParams,
  GetManyReferenceParams,
  CreateParams,
  UpdateParams,
  UpdateManyParams,
  DeleteParams,
  DeleteManyParams,
  GetListResult,
  GetOneResult,
  GetManyResult,
  GetManyReferenceResult,
  CreateResult,
  UpdateResult,
  UpdateManyResult,
  DeleteResult,
  DeleteManyResult,
} from './adapters/data-provider'

export {
  createAuthProvider,
} from './adapters/auth-provider'

export type {
  AuthProvider,
  AuthProviderOptions,
  AuthProviderConfig,
} from './adapters/auth-provider'

// =============================================================================
// Context Factory (for saaskit)
// =============================================================================

export {
  create$Context,
} from './context'

export type {
  Create$ContextConfig,
  $ContextResult,
} from './context'

// =============================================================================
// Legacy exports (kept for backward compatibility)
// =============================================================================

export { useTanStackDb } from './hooks/use-tanstack-db'
