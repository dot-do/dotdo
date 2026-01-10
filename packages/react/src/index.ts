/**
 * @dotdo/react - React bindings for dotdo Durable Objects
 *
 * Provides hooks and components for real-time data synchronization
 * with dotdo backends.
 *
 * @example
 * ```tsx
 * import { DO, useCollection, useLiveQuery, use$ } from '@dotdo/react'
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
 *   const todoTasks = useLiveQuery(tasks, {
 *     from: 'Task',
 *     where: { status: 'todo' },
 *   })
 *
 *   return <div>{todoTasks.map(t => <TaskCard key={t.$id} task={t} />)}</div>
 * }
 *
 * function TaskActions() {
 *   const $ = use$()
 *
 *   const handleCreate = async () => {
 *     await $.do(() => $.Task.create({ title: 'New Task' }))
 *   }
 * }
 * ```
 *
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
export { useRecord } from './hooks/use-record'
export { useConnectionState } from './hooks/use-connection-state'

// Types
export type {
  BaseItem,
  CollectionConfig,
  UseDotdoCollectionResult as UseCollectionResult,
  LiveQueryConfig,
  UseRecordResult,
  SyncMessage,
} from './types'

// Re-export from @dotdo/client for convenience
export type { DOClient, ClientConfig, ConnectionState } from '@dotdo/client'
