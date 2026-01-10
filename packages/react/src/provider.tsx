/**
 * DO - React provider for dotdo client
 *
 * Wraps your application to provide client instance and WebSocket
 * connection management for all hooks within the tree.
 *
 * @example
 * ```tsx
 * import { DO } from '@dotdo/react'
 *
 * function App() {
 *   return (
 *     <DO ns="https://api.example.com/do/workspace">
 *       <MyApp />
 *     </DO>
 *   )
 * }
 * ```
 *
 * @example
 * With custom client configuration:
 * ```tsx
 * import { DO } from '@dotdo/react'
 *
 * function App() {
 *   return (
 *     <DO
 *       ns="https://api.example.com/do/workspace"
 *       config={{
 *         timeout: 30000,
 *         auth: { token: 'my-auth-token' },
 *       }}
 *     >
 *       <MyApp />
 *     </DO>
 *   )
 * }
 * ```
 *
 * @module @dotdo/react
 */

import * as React from 'react'
import { createClient, type DOClient, type ClientConfig } from '@dotdo/client'
import { DotdoContext } from './context'
import type { DotdoContextValue } from './types'

/**
 * Props for the DO provider component.
 */
export interface DOProps {
  /** Namespace URL for the Durable Object (http/https, will convert to ws/wss for sync) */
  ns: string
  /** Optional client configuration for timeout, auth, batching, etc. */
  config?: ClientConfig
  /** Child components */
  children: React.ReactNode
}

/**
 * Provider component for dotdo React bindings.
 *
 * Creates and manages the client instance and WebSocket connections
 * for real-time sync with Durable Objects. All hooks in the tree
 * will use this provider's client and connection state.
 *
 * @param props - Provider props
 * @returns React element wrapping children with context
 */
export function DO({ ns, config, children }: DOProps): React.ReactElement {
  // Create client instance
  const clientRef = React.useRef<DOClient<unknown, unknown> | null>(null)

  // Lazily initialize client
  if (!clientRef.current) {
    clientRef.current = createClient(ns, config)
  }

  // Track WebSocket connections by collection
  const connectionsRef = React.useRef<Map<string, WebSocket>>(new Map())

  // Get or create connection for a collection
  const getConnection = React.useCallback((collection: string, branch?: string): WebSocket | null => {
    const key = branch ? `${collection}:${branch}` : collection
    return connectionsRef.current.get(key) ?? null
  }, [])

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      // Close all WebSocket connections
      for (const ws of connectionsRef.current.values()) {
        ws.close()
      }
      connectionsRef.current.clear()

      // Disconnect the client
      clientRef.current?.disconnect()
    }
  }, [])

  // Memoize context value
  const value = React.useMemo<DotdoContextValue>(() => ({
    ns,
    client: clientRef.current,
    connections: connectionsRef.current,
    getConnection,
  }), [ns, getConnection])

  return (
    <DotdoContext.Provider value={value}>
      {children}
    </DotdoContext.Provider>
  )
}
