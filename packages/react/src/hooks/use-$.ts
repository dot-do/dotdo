/**
 * use$ - Workflow context hook
 *
 * Provides access to the dotdo workflow context ($) for
 * durable operations, event handlers, and scheduling.
 *
 * @example
 * ```tsx
 * import { use$ } from '@dotdo/react'
 *
 * function TaskActions({ taskId }: { taskId: string }) {
 *   const $ = use$()
 *
 *   const handleComplete = async () => {
 *     // Durable operation with retries
 *     await $.do(async () => {
 *       await $.Task(taskId).complete()
 *       await $.notify.user('Task completed!')
 *     })
 *   }
 *
 *   const handleScheduleReminder = async () => {
 *     // Schedule a future action
 *     await $.in('1 hour').remind.task(taskId)
 *   }
 *
 *   return (
 *     <div>
 *       <button onClick={handleComplete}>Complete</button>
 *       <button onClick={handleScheduleReminder}>Remind Later</button>
 *     </div>
 *   )
 * }
 * ```
 */

import * as React from 'react'
import type { DOClient } from '@dotdo/client'
import { useDotdoContext } from '../context'

/**
 * Workflow context interface
 * Mirrors the server-side $ context for client-side operations
 */
export interface WorkflowContext {
  /** Fire-and-forget event */
  send: <T>(event: T) => void
  /** Single attempt operation */
  try: <T>(action: () => Promise<T>) => Promise<T>
  /** Durable operation with retries */
  do: <T>(action: () => Promise<T>) => Promise<T>
  /** Schedule an action for later */
  in: (delay: string | number) => WorkflowContext
  /** Access to underlying client for direct RPC */
  client: DOClient<unknown, unknown>
  /** Dynamic property access for Noun.verb pattern */
  [key: string]: unknown
}

/**
 * Hook to access the workflow context ($).
 *
 * Provides a client-side mirror of the server-side $ context
 * for durable operations and scheduling.
 *
 * @returns WorkflowContext instance
 * @throws Error if used outside of DotdoProvider
 */
export function use$(): WorkflowContext {
  const { client, ns } = useDotdoContext()

  if (!client) {
    throw new Error('Client not initialized. Ensure DO provider is properly configured.')
  }

  // Create the workflow context
  const $ = React.useMemo(() => {
    const rpcUrl = ns + '/rpc'

    const rpc = async (method: string, args: unknown[]): Promise<unknown> => {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          type: 'call',
          calls: [{
            promiseId: 'p-1',
            target: { type: 'root' },
            method,
            args: args.map(arg => ({ type: 'value', value: arg })),
          }],
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`)
      }

      const result = await response.json()
      if (result.error) {
        throw new Error(result.error.message)
      }

      return result.results?.[0]?.value
    }

    const context: WorkflowContext = {
      client: client as DOClient<unknown, unknown>,

      send: <T>(event: T) => {
        // Fire-and-forget via RPC
        rpc('$.send', [event]).catch(() => {
          // Silently ignore errors for fire-and-forget
        })
      },

      try: async <T>(action: () => Promise<T>): Promise<T> => {
        // Execute action with single attempt
        return action()
      },

      do: async <T>(action: () => Promise<T>): Promise<T> => {
        // Execute via server-side $.do for durability
        // For client-side, we just execute directly
        // Real durability comes from server-side workflows
        return action()
      },

      in: (delay: string | number) => {
        // Create a scheduled context
        const scheduledContext = { ...context }
        // The actual scheduling happens server-side
        // This returns a proxy that will send the scheduled call
        return new Proxy(scheduledContext, {
          get(_target, prop) {
            if (typeof prop === 'string') {
              return (...args: unknown[]) => {
                return rpc('$.schedule', [{ delay, method: prop, args }])
              }
            }
            return undefined
          },
        }) as WorkflowContext
      },
    }

    // Create a proxy for dynamic Noun.verb access
    return new Proxy(context, {
      get(target, prop) {
        // Return known properties
        if (prop in target) {
          return target[prop as keyof WorkflowContext]
        }

        // For unknown properties, create a Noun proxy
        if (typeof prop === 'string') {
          return (id?: string) => {
            const nounPath = id ? `${prop}(${id})` : prop
            return new Proxy({}, {
              get(_nounTarget, verb) {
                if (typeof verb === 'string') {
                  return (...args: unknown[]) => {
                    return rpc(`${nounPath}.${verb}`, args)
                  }
                }
                return undefined
              },
            })
          }
        }

        return undefined
      },
    }) as WorkflowContext
  }, [client, ns])

  return $
}
