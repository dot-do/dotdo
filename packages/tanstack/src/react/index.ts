/**
 * @dotdo/tanstack React integration
 *
 * Provides React hooks and components for TanStack DB integration
 * with dotdo backends. Features include:
 *
 * - Real-time WebSocket sync with automatic reconnection
 * - Optimistic mutations with automatic rollback on failure
 * - Connection state management for UI feedback
 * - Workflow context ($) for event handling and AI operations
 * - Type-safe with Zod schema validation
 *
 * @example
 * ```tsx
 * import { SyncProvider, useCollection, use$, useConnectionState } from '@dotdo/tanstack/react'
 * import { z } from 'zod'
 *
 * const TaskSchema = z.object({
 *   $id: z.string(),
 *   title: z.string(),
 *   status: z.enum(['todo', 'done']),
 * })
 *
 * function App() {
 *   return (
 *     <SyncProvider doUrl="https://api.example.com/do/workspace">
 *       <TaskBoard />
 *     </SyncProvider>
 *   )
 * }
 *
 * function TaskBoard() {
 *   const { data: tasks, insert, update, delete: remove } = useCollection({
 *     collection: 'Task',
 *     schema: TaskSchema,
 *   })
 *   const $ = use$()
 *   const { status } = useConnectionState()
 *
 *   const handleComplete = async (taskId: string) => {
 *     await $.send({ type: 'Task.completed', data: { taskId } })
 *   }
 *
 *   return (
 *     <div>
 *       <ConnectionStatus status={status} />
 *       {tasks.map(task => <TaskCard key={task.$id} task={task} onComplete={handleComplete} />)}
 *     </div>
 *   )
 * }
 * ```
 *
 * @packageDocumentation
 * @module @dotdo/tanstack/react
 */

// Provider
export { SyncProvider, useSyncContext } from './provider'

// Hooks
export { useCollection, useDotdoCollection } from './use-collection'
export { useDO } from './use-do'
export { use$ } from './use-$'
export { useConnectionState } from './use-connection-state'

// Types
export type {
  ConnectionState,
  SyncContextValue,
  SyncProviderProps,
  BaseItem,
  CollectionConfig,
  UseCollectionResult,
  // Backwards compatibility aliases
  DotdoCollectionConfig,
  UseDotdoCollectionResult,
  UseConnectionStateResult,
  SyncMessage,
} from './types'

// Hook types
export type { UseDOConfig, UseDOResult } from './use-do'
export type { WorkflowContextProxy, NounProxy, Use$Result } from './use-$'
