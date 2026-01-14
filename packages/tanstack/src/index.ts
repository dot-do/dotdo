/**
 * @dotdo/tanstack - TanStack integration for dotdo
 *
 * This package provides React Query-style hooks and utilities for
 * real-time data synchronization with Durable Objects.
 *
 * @example
 * ```tsx
 * import { SyncProvider, useDotdoCollection, useDotdoQuery } from '@dotdo/tanstack'
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
 *   const { data, isLoading, insert, update, delete: remove } = useDotdoCollection({
 *     collection: 'Customer',
 *     schema: CustomerSchema,
 *   })
 *
 *   if (isLoading) return <div>Loading...</div>
 *
 *   return (
 *     <ul>
 *       {data.map(customer => (
 *         <li key={customer.$id}>{customer.name}</li>
 *       ))}
 *     </ul>
 *   )
 * }
 * ```
 *
 * @module @dotdo/tanstack
 */

// Re-export everything from react
export * from './react/index'

// Export cache utilities
export * from './cache'
