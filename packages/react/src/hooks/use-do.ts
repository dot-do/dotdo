/**
 * useDO - Direct Durable Object access hook
 *
 * Provides type-safe access to a specific Durable Object instance
 * with RPC methods and real-time subscriptions.
 *
 * @example
 * ```tsx
 * import { useDO } from '@dotdo/react'
 *
 * interface WorkspaceAPI {
 *   Task: {
 *     create(data: TaskInput): Promise<Task>
 *     list(): Promise<Task[]>
 *     update(id: string, data: Partial<Task>): Promise<Task>
 *     delete(id: string): Promise<void>
 *   }
 *   User: {
 *     me(): Promise<User>
 *   }
 * }
 *
 * function TaskManager() {
 *   const workspace = useDO<WorkspaceAPI>()
 *
 *   const handleCreate = async () => {
 *     // Type-safe RPC with promise pipelining
 *     const task = await workspace.Task.create({ title: 'New Task' })
 *   }
 *
 *   return <button onClick={handleCreate}>Create Task</button>
 * }
 * ```
 */

import type { DOClient } from '@dotdo/client'
import { useDotdoContext } from '../context'

/**
 * Hook to access the Durable Object with type-safe RPC.
 *
 * Use this for direct RPC calls with full type safety and promise pipelining.
 *
 * @typeParam TMethods - The API interface for the Durable Object
 * @typeParam TEvents - Event types for subscriptions
 * @returns Typed DOClient instance
 * @throws Error if used outside of DotdoProvider
 */
export function useDO<TMethods = unknown, TEvents = unknown>(): DOClient<TMethods, TEvents> {
  const { client } = useDotdoContext()

  if (!client) {
    throw new Error('Client not initialized. Ensure DotdoProvider is properly configured.')
  }

  return client as DOClient<TMethods, TEvents>
}
