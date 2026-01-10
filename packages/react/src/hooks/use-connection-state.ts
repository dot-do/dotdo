/**
 * useConnectionState - Monitor client connection state
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
 *       {state === 'connected' && '🟢 Connected'}
 *       {state === 'connecting' && '🟡 Connecting...'}
 *       {state === 'reconnecting' && '🟠 Reconnecting...'}
 *       {state === 'disconnected' && '🔴 Disconnected'}
 *     </div>
 *   )
 * }
 * ```
 */

import * as React from 'react'
import type { ConnectionState } from '@dotdo/client'
import { useDotdoContext } from '../context'

/**
 * Hook to monitor the client connection state.
 *
 * Returns the current connection state and updates reactively.
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
