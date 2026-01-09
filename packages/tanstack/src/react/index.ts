/**
 * @dotdo/tanstack/react - React bindings for TanStack DB integration
 *
 * Provides SyncProvider for WebSocket-based sync with Durable Objects
 * and hooks for accessing sync state in React components.
 */

// Types
export type {
  SyncContextValue,
  SyncProviderProps,
  ConnectionState,
  UseDotdoCollectionOptions,
  UseDotdoCollectionResult,
} from './types'

// Context and hooks
export { SyncContext, useSyncContext } from './context'
export { useDotdoCollection } from './use-dotdo-collection'

// Components
export { SyncProvider } from './provider'
