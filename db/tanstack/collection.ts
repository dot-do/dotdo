/**
 * TanStack DB Collection Options for dotdo
 *
 * Provides dotdoCollectionOptions factory for creating TanStack DB collections
 * that sync with dotdo backends via WebSocket or Cap'n Web RPC.
 *
 * @module db/tanstack/collection
 */

import { z } from 'zod'

// =============================================================================
// Types
// =============================================================================

/**
 * Callbacks used by TanStack DB collection for sync operations
 */
export interface CollectionCallbacks<T = unknown> {
  begin: () => void
  onData: (items: T[]) => void
  onInsert: (item: T) => void
  onUpdate: (item: T) => void
  onDelete: (item: { id: string }) => void
  commit: (info: { txid: number }) => void
}

/**
 * Configuration for dotdo collection
 */
export interface DotdoCollectionConfig<T> {
  /** WebSocket URL for the Durable Object (will append /sync) */
  doUrl: string
  /** Collection name (Noun type) */
  collection: string
  /** Optional branch for branched data */
  branch?: string
  /** Zod schema for validating items */
  schema: z.ZodSchema<T>
  /** Optional fetch options for RPC calls */
  fetchOptions?: RequestInit
  /** Optional transaction timeout in ms (default: 30000) */
  transactionTimeout?: number
}

/**
 * Options returned by dotdoCollectionOptions for TanStack DB
 */
export interface DotdoCollectionOptionsResult<T> {
  id: string
  schema: z.ZodSchema<T>
  getKey: (item: T) => string
  subscribe: (callbacks: CollectionCallbacks<T>) => () => void
  onInsert?: (params: { transaction: { changes: T } }) => Promise<{ txid: number }>
  onUpdate?: (params: { id: string; data: Partial<T> }) => Promise<{ txid: number }>
  onDelete?: (params: { id: string }) => Promise<{ txid: number }>
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create collection options for TanStack DB with dotdo sync.
 *
 * STUB: Full implementation will be added in GREEN issue.
 * This stub provides the correct type signature for app compilation.
 *
 * @example
 * ```typescript
 * const taskOptions = dotdoCollectionOptions({
 *   doUrl: 'wss://my-do.workers.dev/do/123',
 *   collection: 'Task',
 *   schema: TaskSchema,
 * })
 *
 * // Use with TanStack DB
 * const collection = useCollection(taskOptions)
 * ```
 */
export function dotdoCollectionOptions<T extends { $id: string }>(
  config: DotdoCollectionConfig<T>
): DotdoCollectionOptionsResult<T> {
  // STUB: Implementation will be added in GREEN issue
  // This stub returns a minimal object that satisfies the type signature
  return {
    id: `dotdo:${config.collection}`,
    schema: config.schema,
    getKey: (item: T) => item.$id,
    subscribe: (_callbacks: CollectionCallbacks<T>) => {
      // STUB: WebSocket subscription not yet implemented
      console.warn(`[dotdo/tanstack] subscribe not yet implemented for collection: ${config.collection}`)
      return () => {
        // cleanup stub
      }
    },
    onInsert: async () => {
      throw new Error('dotdoCollectionOptions.onInsert not yet implemented - see GREEN issue')
    },
    onUpdate: async () => {
      throw new Error('dotdoCollectionOptions.onUpdate not yet implemented - see GREEN issue')
    },
    onDelete: async () => {
      throw new Error('dotdoCollectionOptions.onDelete not yet implemented - see GREEN issue')
    },
  }
}
