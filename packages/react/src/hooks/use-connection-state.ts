/**
 * useConnectionState - Monitor client connection state
 *
 * Provides reactive access to the WebSocket connection state.
 * Useful for showing connection indicators or handling offline states.
 *
 * @example
 * ```tsx
 * import { useConnectionState } from '@dotdo/react'
 *
 * function ConnectionIndicator() {
 *   const state = useConnectionState()
 *
 *   return (
 *     <div className={`indicator ${state}`}>
 *       {state === 'connected' && 'Connected'}
 *       {state === 'connecting' && 'Connecting...'}
 *       {state === 'reconnecting' && 'Reconnecting...'}
 *       {state === 'disconnected' && 'Disconnected'}
 *     </div>
 *   )
 * }
 * ```
 *
 * @module @dotdo/react
 */

import * as React from 'react'
import type { ConnectionState } from '../types'
import { useDotdoContext } from '../context'

/**
 * Hook to monitor the client connection state.
 *
 * Returns the current connection state and updates reactively
 * when the connection state changes.
 *
 * @returns Current connection state
 *
 * @remarks
 * States:
 * - 'connecting': Initial connection in progress
 * - 'connected': WebSocket is open and ready
 * - 'reconnecting': Connection lost, attempting to reconnect
 * - 'disconnected': Explicitly disconnected or failed
 */
export function useConnectionState(): ConnectionState {
  const { client } = useDotdoContext()
  const [state, setState] = React.useState<ConnectionState>(
    client?.connectionState ?? 'disconnected'
  )

  React.useEffect(() => {
    if (!client) {
      setState('disconnected')
      return
    }

    // Set initial state - check if connectionState property exists
    if (client.connectionState !== undefined) {
      setState(client.connectionState)
    } else {
      // Default to 'connected' if the client exists but doesn't expose connection state
      setState('connected')
    }

    // Listen for changes if the client supports it
    const handleStateChange = (newState: ConnectionState) => {
      setState(newState)
    }

    if (client.on) {
      client.on('connectionStateChange', handleStateChange)
    }

    return () => {
      if (client.off) {
        client.off('connectionStateChange', handleStateChange)
      }
    }
  }, [client])

  return state
}
