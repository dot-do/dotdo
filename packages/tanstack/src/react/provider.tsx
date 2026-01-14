/**
 * SyncProvider - React context provider for TanStack DB integration
 *
 * Provides connection state management and shared WebSocket for hooks.
 *
 * @example
 * ```tsx
 * import { SyncProvider } from '@dotdo/tanstack/react'
 *
 * function App() {
 *   return (
 *     <SyncProvider doUrl="https://api.example.com/do/workspace">
 *       <MyApp />
 *     </SyncProvider>
 *   )
 * }
 * ```
 *
 * @module @dotdo/tanstack/react
 */

import * as React from 'react'
import type { SyncContextValue, SyncProviderProps, ConnectionState } from './types'

/**
 * React context for sync state
 */
export const SyncContext = React.createContext<SyncContextValue | null>(null)

/**
 * Hook to access the sync context
 *
 * @returns The context value with connection state and doUrl
 * @throws Error if used outside of SyncProvider
 */
export function useSyncContext(): SyncContextValue {
  const context = React.useContext(SyncContext)
  if (!context) {
    throw new Error('useSyncContext must be used within a SyncProvider')
  }
  return context
}

/**
 * Convert HTTP(S) URL to WebSocket URL
 */
function toWebSocketUrl(httpUrl: string): string {
  return httpUrl
    .replace(/^https:/, 'wss:')
    .replace(/^http:/, 'ws:')
    + '/sync'
}

/**
 * Provider component for dotdo TanStack integration.
 *
 * Creates and manages WebSocket connection for real-time sync.
 * All hooks in the tree will use this provider's connection state.
 *
 * @param props - Provider props
 * @returns React element wrapping children with context
 */
export function SyncProvider({
  doUrl,
  getAuthToken,
  children,
}: SyncProviderProps): React.ReactElement {
  const [connectionState, setConnectionState] = React.useState<ConnectionState>('connecting')
  const [reconnectAttempts, setReconnectAttempts] = React.useState(0)
  const [lastSyncAt, setLastSyncAt] = React.useState<Date | null>(null)
  const wsRef = React.useRef<WebSocket | null>(null)

  // Setup WebSocket connection
  React.useEffect(() => {
    const wsUrl = toWebSocketUrl(doUrl)
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    const handleOpen = () => {
      setConnectionState('connected')
      setReconnectAttempts(0)
    }

    const handleClose = () => {
      setConnectionState('reconnecting')
    }

    const handleError = () => {
      setConnectionState('error')
    }

    ws.addEventListener('open', handleOpen)
    ws.addEventListener('close', handleClose)
    ws.addEventListener('error', handleError)

    // Cleanup on unmount
    return () => {
      ws.removeEventListener('open', handleOpen)
      ws.removeEventListener('close', handleClose)
      ws.removeEventListener('error', handleError)
      ws.close()
      wsRef.current = null
    }
  }, [doUrl])

  // Memoize context value to prevent unnecessary re-renders
  const value = React.useMemo<SyncContextValue>(
    () => ({
      doUrl,
      getAuthToken,
      connectionState,
      reconnectAttempts,
      lastSyncAt,
      _ws: wsRef.current,
      _setConnectionState: setConnectionState,
      _setReconnectAttempts: setReconnectAttempts,
      _setLastSyncAt: setLastSyncAt,
    }),
    [doUrl, getAuthToken, connectionState, reconnectAttempts, lastSyncAt]
  )

  return (
    <SyncContext.Provider value={value}>
      {children}
    </SyncContext.Provider>
  )
}
