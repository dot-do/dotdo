/**
 * SyncProvider component - manages WebSocket connection to Durable Object
 */

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { SyncContext } from './context'
import type { SyncProviderProps, ConnectionState, SyncContextValue } from './types'

/**
 * SyncProvider manages the WebSocket connection lifecycle and provides
 * sync context to all descendant components.
 */
export function SyncProvider({
  children,
  doUrl,
  getAuthToken,
  reconnectDelay = 1000,
  maxReconnectDelay = 30000,
  _wsFactory,
}: SyncProviderProps): React.ReactElement {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')
  const [reconnectAttempts, setReconnectAttempts] = useState(0)
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null)
  const [lastError, setLastError] = useState<Error | null>(null)

  // Refs for cleanup and reconnection logic
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  /**
   * Calculate exponential backoff delay
   */
  const getReconnectDelay = useCallback(
    (attempt: number): number => {
      const delay = reconnectDelay * Math.pow(2, attempt)
      return Math.min(delay, maxReconnectDelay)
    },
    [reconnectDelay, maxReconnectDelay]
  )

  /**
   * Create and connect WebSocket
   */
  const connect = useCallback(() => {
    if (!mountedRef.current) return

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.onopen = null
      wsRef.current.onmessage = null
      wsRef.current.onclose = null
      wsRef.current.onerror = null
      wsRef.current.close()
    }

    // Use factory if provided (for testing), otherwise use global WebSocket
    const createWebSocket = _wsFactory ?? ((url: string) => new WebSocket(url))
    const ws = createWebSocket(doUrl)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) return
      setConnectionState('connected')
      setReconnectAttempts(0)
      setLastSyncAt(new Date())
      setLastError(null)
    }

    ws.onmessage = (event) => {
      if (!mountedRef.current) return
      // Handle incoming messages - update lastSyncAt
      setLastSyncAt(new Date())
      // Message handling will be implemented in future iterations
    }

    ws.onclose = (event) => {
      if (!mountedRef.current) return

      // Schedule reconnection
      setConnectionState('reconnecting')
      setReconnectAttempts((prev) => {
        const nextAttempt = prev + 1
        const delay = getReconnectDelay(prev)

        // Clear any existing timeout
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
        }

        // Schedule reconnect
        reconnectTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current) {
            connect()
          }
        }, delay)

        return nextAttempt
      })
    }

    ws.onerror = (error) => {
      if (!mountedRef.current) return
      setLastError(error instanceof Error ? error : new Error('WebSocket error'))
      // The close event will follow, which handles reconnection
    }
  }, [doUrl, getReconnectDelay, _wsFactory])

  // Initialize connection on mount and doUrl change
  useEffect(() => {
    mountedRef.current = true
    setConnectionState('connecting')
    connect()

    return () => {
      mountedRef.current = false

      // Clear reconnection timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }

      // Close WebSocket
      if (wsRef.current) {
        wsRef.current.onopen = null
        wsRef.current.onmessage = null
        wsRef.current.onclose = null
        wsRef.current.onerror = null
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [doUrl, connect])

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo<SyncContextValue>(
    () => ({
      connectionState,
      doUrl,
      reconnectAttempts,
      lastSyncAt,
      lastError,
      getAuthToken,
    }),
    [connectionState, doUrl, reconnectAttempts, lastSyncAt, lastError, getAuthToken]
  )

  return <SyncContext.Provider value={contextValue}>{children}</SyncContext.Provider>
}
