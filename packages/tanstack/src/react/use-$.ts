/**
 * use$ - React hook for accessing the $ workflow context
 *
 * Provides access to the DO's workflow context for event handling,
 * scheduling, and AI operations.
 *
 * @example
 * ```tsx
 * import { use$ } from '@dotdo/tanstack/react'
 *
 * function TaskManager() {
 *   const $ = use$()
 *
 *   const handleComplete = async (taskId: string) => {
 *     // Emit an event
 *     await $.send({ type: 'Task.completed', data: { taskId } })
 *   }
 *
 *   const handleApproval = async (requestId: string) => {
 *     // Request human approval
 *     const result = await $.approve({ requestId, message: 'Please approve this action' })
 *     return result.approved
 *   }
 *
 *   return <TaskList onComplete={handleComplete} onApprove={handleApproval} />
 * }
 * ```
 *
 * @module @dotdo/tanstack/react
 */

import * as React from 'react'
import { useSyncContext } from './provider'

export interface WorkflowContextProxy {
  /** Send an event (fire-and-forget) */
  send: (event: { type: string; data?: unknown }) => Promise<string>
  /** Try an action (single attempt) */
  try: <T = unknown>(action: { type: string; input?: unknown }) => Promise<T>
  /** Execute a durable action with retries */
  do: <T = unknown>(action: { type: string; input?: unknown; retries?: number }) => Promise<T>
  /** Track an analytics event */
  track: (event: string, properties?: Record<string, unknown>) => Promise<void>
  /** Request human approval */
  approve: (request: { requestId?: string; message: string; timeout?: number }) => Promise<{ approved: boolean; reason?: string }>
  /** Ask a question */
  ask: <T = string>(question: string) => Promise<T>
  /** Make a decision */
  decide: <T = string>(options: { question: string; choices: T[] }) => Promise<T>
  /** Call an AI function */
  ai: <T = unknown>(prompt: string, options?: { model?: string; schema?: unknown }) => Promise<T>
  /** Access a noun by ID */
  noun: (noun: string, id: string) => NounProxy
}

export interface NounProxy {
  /** Get the noun instance */
  get: <T = unknown>() => Promise<T>
  /** Update the noun instance */
  update: <T = unknown>(changes: Partial<T>) => Promise<T>
  /** Delete the noun instance */
  delete: () => Promise<void>
  /** Call a verb on the noun */
  verb: <T = unknown>(verb: string, input?: Record<string, unknown>) => Promise<T>
}

export interface Use$Result extends WorkflowContextProxy {
  /** Whether the context is ready */
  isReady: boolean
  /** Any error */
  error: Error | null
}

/**
 * Hook for accessing the $ workflow context.
 *
 * @returns Workflow context methods
 */
export function use$(): Use$Result {
  const { doUrl, getAuthToken, connectionState } = useSyncContext()
  const [error, setError] = React.useState<Error | null>(null)

  const rpcUrl = React.useMemo(() => doUrl + '/rpc', [doUrl])

  // Generic RPC helper
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
                method: `$.${method}`,
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

  // Workflow context methods
  const send = React.useCallback(
    async (event: { type: string; data?: unknown }): Promise<string> => {
      return rpc<string>('send', event)
    },
    [rpc]
  )

  const tryAction = React.useCallback(
    async <T = unknown>(action: { type: string; input?: unknown }): Promise<T> => {
      return rpc<T>('try', action)
    },
    [rpc]
  )

  const doAction = React.useCallback(
    async <T = unknown>(action: { type: string; input?: unknown; retries?: number }): Promise<T> => {
      return rpc<T>('do', action)
    },
    [rpc]
  )

  const track = React.useCallback(
    async (event: string, properties?: Record<string, unknown>): Promise<void> => {
      return rpc<void>('track', { event, properties })
    },
    [rpc]
  )

  const approve = React.useCallback(
    async (request: { requestId?: string; message: string; timeout?: number }): Promise<{ approved: boolean; reason?: string }> => {
      return rpc<{ approved: boolean; reason?: string }>('approve', request)
    },
    [rpc]
  )

  const ask = React.useCallback(
    async <T = string>(question: string): Promise<T> => {
      return rpc<T>('ask', { question })
    },
    [rpc]
  )

  const decide = React.useCallback(
    async <T = string>(options: { question: string; choices: T[] }): Promise<T> => {
      return rpc<T>('decide', options)
    },
    [rpc]
  )

  const ai = React.useCallback(
    async <T = unknown>(prompt: string, options?: { model?: string; schema?: unknown }): Promise<T> => {
      return rpc<T>('ai', { prompt, ...options })
    },
    [rpc]
  )

  const noun = React.useCallback(
    (nounName: string, id: string): NounProxy => ({
      get: async <T = unknown>() => rpc<T>(`${nounName}.get`, { id }),
      update: async <T = unknown>(changes: Partial<T>) => rpc<T>(`${nounName}.update`, { id, ...changes }),
      delete: async () => rpc<void>(`${nounName}.delete`, { id }),
      verb: async <T = unknown>(verb: string, input?: Record<string, unknown>) => rpc<T>(`${nounName}.${verb}`, { id, ...input }),
    }),
    [rpc]
  )

  const isReady = connectionState === 'connected'

  return React.useMemo(
    () => ({
      send,
      try: tryAction,
      do: doAction,
      track,
      approve,
      ask,
      decide,
      ai,
      noun,
      isReady,
      error,
    }),
    [send, tryAction, doAction, track, approve, ask, decide, ai, noun, isReady, error]
  )
}
