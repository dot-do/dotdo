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
import type { ConnectionState } from '@dotdo/client'
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

    // Set initial state
    setState(client.connectionState)

    // Listen for changes
    const handleStateChange = (newState: ConnectionState) => {
      setState(newState)
    }

    client.on('connectionStateChange', handleStateChange)

    return () => {
      client.off('connectionStateChange', handleStateChange)
    }
  }, [client])

  return state
}
