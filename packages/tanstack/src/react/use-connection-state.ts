/**
 * useConnectionState - React hook for accessing connection state
 *
 * Provides status, reconnect attempts, and last sync timestamp.
 *
 * @example
 * ```tsx
 * import { useConnectionState } from '@dotdo/tanstack/react'
 *
 * function ConnectionIndicator() {
 *   const { status, reconnectAttempts } = useConnectionState()
 *
 *   if (status === 'connected') {
 *     return <span className="text-green-500">Connected</span>
 *   }
 *
 *   if (status === 'reconnecting') {
 *     return <span className="text-yellow-500">Reconnecting ({reconnectAttempts})...</span>
 *   }
 *
 *   return <span className="text-red-500">Disconnected</span>
 * }
 * ```
 *
 * @module @dotdo/tanstack/react
 */

import { useSyncContext } from './provider'
import type { UseConnectionStateResult } from './types'

/**
 * Hook for accessing connection state from SyncProvider.
 *
 * @returns Connection state including status, reconnect attempts, and last sync timestamp
 * @throws Error if used outside SyncProvider
 */
export function useConnectionState(): UseConnectionStateResult {
  const { connectionState, reconnectAttempts, lastSyncAt } = useSyncContext()

  return {
    status: connectionState,
    reconnectAttempts,
    lastSyncAt,
  }
}
