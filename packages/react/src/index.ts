/**
 * @dotdo/react - React bindings for dotdo Durable Objects
 *
 * Provides hooks and components for real-time data synchronization
 * with dotdo backends. Features include:
 *
 * - Real-time WebSocket sync with automatic reconnection
 * - Optimistic mutations with automatic rollback on failure
 * - Live queries for reactive filtering and joining
 * - Type-safe RPC with promise pipelining
 * - TanStack DB integration via separate entry point
 *
 * @example
 * Basic usage with collection sync:
 * ```tsx
 * import { DO, useCollection, useLiveQuery } from '@dotdo/react'
 *
 * function App() {
 *   return (
 *     <DO ns="https://api.example.com/do/workspace">
 *       <TaskBoard />
 *     </DO>
 *   )
 * }
 *
 * function TaskBoard() {
 *   const { data: tasks, insert, update, delete: remove } = useCollection<Task>({
 *     collection: 'Task',
 *   })
 *
 *   // Filter tasks client-side reactively
 *   const todoTasks = useLiveQuery(tasks, React.useMemo(() => ({
 *     from: 'Task',
 *     where: { status: 'todo' },
 *   }), []))
 *
 *   return <div>{todoTasks.map(t => <TaskCard key={t.$id} task={t} />)}</div>
 * }
 * ```
 *
 * @example
 * Direct RPC with type safety:
 * ```tsx
 * import { useDO } from '@dotdo/react'
 *
 * interface API {
 *   Task: { create(data: TaskInput): Promise<Task> }
 * }
 *
 * function TaskActions() {
 *   const client = useDO<API>()
 *
 *   const handleCreate = async () => {
 *     const task = await client.Task.create({ title: 'New Task' })
 *   }
 * }
 * ```
 *
 * @packageDocumentation
 * @module @dotdo/react
 */

// Provider
export { DO, type DOProps } from './provider'

// Context
export { DotdoContext, useDotdoContext } from './context'

// Hooks
export { useDO } from './hooks/use-do'
export { use$, type WorkflowContext } from './hooks/use-$'
export { useCollection } from './hooks/use-collection'
export { useLiveQuery } from './hooks/use-live-query'
export { useRecord, type UseRecordConfig } from './hooks/use-record'
export { useConnectionState } from './hooks/use-connection-state'

// Types
export type {
  BaseItem,
  CollectionConfig,
  UseDotdoCollectionResult as UseCollectionResult,
  LiveQueryConfig,
  UseRecordResult,
  SyncMessage,
  DotdoContextValue,
} from './types'

// Re-export from @dotdo/client for convenience
export type { DOClient, ClientConfig, ConnectionState } from '@dotdo/client'
