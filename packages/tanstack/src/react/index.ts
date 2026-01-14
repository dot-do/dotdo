/**
 * @dotdo/tanstack/react - React integration for TanStack DB with dotdo
 *
 * Provides SyncProvider and hooks for real-time data synchronization.
 *
 * @example
 * ```tsx
 * import { SyncProvider, useSyncContext, useDotdoCollection } from '@dotdo/tanstack/react'
 * import { z } from 'zod'
 *
 * const CustomerSchema = z.object({
 *   $id: z.string(),
 *   name: z.string(),
 *   email: z.string().email(),
 * })
 *
 * function App() {
 *   return (
 *     <SyncProvider doUrl="https://api.example.com/do/workspace">
 *       <CustomerList />
 *     </SyncProvider>
 *   )
 * }
 *
 * function CustomerList() {
 *   const { data, isLoading, insert } = useDotdoCollection({
 *     collection: 'Customer',
 *     schema: CustomerSchema,
 *   })
 *
 *   if (isLoading) return <div>Loading...</div>
 *
 *   return (
 *     <ul>
 *       {data.map(customer => <li key={customer.$id}>{customer.name}</li>)}
 *     </ul>
 *   )
 * }
 * ```
 *
 * @module @dotdo/tanstack/react
 */

// Provider and context
export { SyncProvider, SyncContext, useSyncContext } from './provider'

// Hooks
export {
  useConnectionState,
  useDotdoCollection,
  useDotdoQuery,
  useDotdoMutation,
  dotdoQueryKeys,
} from './hooks'

// Types
export type {
  ConnectionState,
  SyncContextValue,
  SyncProviderProps,
  BaseItem,
  DotdoCollectionConfig,
  UseDotdoCollectionResult,
  UseConnectionStateResult,
  SyncMessage,
  UseDotdoQueryOptions,
  UseDotdoQueryResult,
  UseDotdoMutationOptions,
  UseDotdoMutationResult,
} from './types'
