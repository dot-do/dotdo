/**
 * useDO - React hook for accessing a Durable Object by ID
 *
 * Provides RPC access to a specific DO instance with automatic connection management.
 *
 * @example
 * ```tsx
 * import { useDO } from '@dotdo/tanstack/react'
 *
 * function WorkspaceView({ workspaceId }: { workspaceId: string }) {
 *   const { rpc, isConnected, error } = useDO(workspaceId)
 *
 *   const handleAddTask = async () => {
 *     await rpc('tasks.create', { title: 'New Task' })
 *   }
 *
 *   return (
 *     <div>
 *       <button onClick={handleAddTask} disabled={!isConnected}>
 *         Add Task
 *       </button>
 *     </div>
 *   )
 * }
 * ```
 *
 * @module @dotdo/tanstack/react
 */

import * as React from 'react'
import { useSyncContext } from './provider'

export interface UseDOConfig {
  /** Optional namespace for the DO (defaults to root) */
  namespace?: string
}

export interface UseDOResult {
  /** Make an RPC call to the DO */
  rpc: <T = unknown>(method: string, args?: unknown) => Promise<T>
  /** Whether the DO is connected */
  isConnected: boolean
  /** Any connection error */
  error: Error | null
  /** The DO ID */
  doId: string
}

/**
 * Hook for accessing a specific Durable Object by ID.
 *
 * @param doId - The Durable Object ID
 * @param config - Optional configuration
 * @returns RPC methods and connection state
 */
export function useDO(doId: string, config?: UseDOConfig): UseDOResult {
  const { doUrl, getAuthToken, connectionState } = useSyncContext()
  const [error, setError] = React.useState<Error | null>(null)
  const namespace = config?.namespace

  // Derive RPC URL for this specific DO
  const rpcUrl = React.useMemo(() => {
    const base = doUrl.replace(/\/[^/]*$/, '') // Remove last path segment
    return namespace ? `${base}/${namespace}/${doId}/rpc` : `${base}/${doId}/rpc`
  }, [doUrl, namespace, doId])

  // RPC helper
  const rpc = React.useCallback(
    async <T = unknown>(method: string, args?: unknown): Promise<T> => {
      setError(null)

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (getAuthToken) {
        const token = getAuthToken()
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }
      }

      try {
        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            id: crypto.randomUUID(),
            type: 'call',
            calls: [
              {
                promiseId: 'p-1',
                target: { type: 'root' },
                method,
                args: args !== undefined ? [{ type: 'value', value: args }] : [],
              },
            ],
          }),
        })

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`)
        }

        const result = await response.json()
        if (result.error) {
          throw new Error(result.error.message)
        }

        return result.results?.[0]?.value as T
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        setError(error)
        throw error
      }
    },
    [rpcUrl, getAuthToken]
  )

  const isConnected = connectionState === 'connected'

  return React.useMemo(
    () => ({
      rpc,
      isConnected,
      error,
      doId,
    }),
    [rpc, isConnected, error, doId]
  )
}
