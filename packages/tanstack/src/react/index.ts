/**
 * @dotdo/tanstack/react - React bindings for TanStack DB integration
 *
 * Provides SyncProvider for WebSocket-based sync with Durable Objects
 * and hooks for accessing sync state in React components.
 */

// Types
export type { SyncContextValue, SyncProviderProps, ConnectionState } from './types'

// Context and hooks
export { SyncContext, useSyncContext } from './context'

// Components
export { SyncProvider } from './provider'
