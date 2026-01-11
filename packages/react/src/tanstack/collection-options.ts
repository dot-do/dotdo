/**
 * TanStack DB Collection Options for dotdo
 *
 * Provides CollectionOptions factory for creating TanStack DB collections
 * that sync with dotdo backends via WebSocket.
 *
 * @example
 * ```tsx
 * import { CollectionOptions } from '@dotdo/react/tanstack'
 * import { useCollection } from '@tanstack/db'
 *
 * const taskOptions = CollectionOptions({
 *   doUrl: 'wss://my-do.workers.dev/do/123',
 *   collection: 'Task',
 *   schema: TaskSchema,
 * })
 *
 * function TaskList() {
 *   const collection = useCollection(taskOptions)
 *   // ...
 * }
 * ```
 *
 * @module @dotdo/react/tanstack
 */

import type { z } from 'zod'
import { SyncClient } from '../sync/sync-client'

// =============================================================================
// Types
// =============================================================================

/**
 * Callbacks used by TanStack DB collection for sync operations
 */
export interface CollectionCallbacks<T = unknown> {
  /** Called at the start of a transaction */
  begin: () => void
  /** Called with initial or batch data */
  onData: (items: T[]) => void
  /** Called when a new item is inserted */
  onInsert: (item: T) => void
  /** Called when an item is updated */
  onUpdate: (item: T) => void
  /** Called when an item is deleted */
  onDelete: (item: { id: string }) => void
  /** Called to commit a transaction */
  commit: (info: { txid: number }) => void
  /** Called when a sync error occurs (optional) */
  onError?: (error: Error) => void
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
 * Mutation from TanStack DB transaction
 */
export interface Mutation<T> {
  /** Unique key for the item */
  key: string
  /** Modified item data (for insert) */
  modified?: T
  /** Original item data (for update/delete) */
  original?: T
  /** Changed fields (for update) */
  changes?: Partial<T>
}

/**
 * Mutation context from TanStack DB
 */
export interface MutationContext<T> {
  /** Transaction containing mutations */
  transaction: {
    /** Array of mutations in this transaction */
    mutations: Array<Mutation<T>>
  }
  /** Collection reference */
  collection: unknown
}

/**
 * Options returned by CollectionOptions for TanStack DB
 */
export interface DotdoCollectionOptionsResult<T> {
  /** Unique identifier for this collection */
  id: string
  /** Zod schema for validation */
  schema: z.ZodSchema<T>
  /** Function to extract key from item */
  getKey: (item: T) => string
  /** Subscribe to collection changes */
  subscribe: (callbacks: CollectionCallbacks<T>) => () => void
  /** Handle insert mutations */
  onInsert: (ctx: MutationContext<T>) => Promise<{ txid: number }>
  /** Handle update mutations */
  onUpdate: (ctx: MutationContext<T>) => Promise<{ txid: number }>
  /** Handle delete mutations */
  onDelete: (ctx: MutationContext<T>) => Promise<{ txid: number }>
}

// =============================================================================
// Cap'n Web Protocol Types
// =============================================================================

interface CapnWebRequest {
  id: string
  type: 'call' | 'batch'
  calls: Array<{
    promiseId: string
    target: { type: 'root' }
    method: string
    args: Array<{ type: 'value'; value: unknown }>
  }>
}

interface CapnWebResponse {
  id: string
  type: 'result' | 'error' | 'batch'
  results?: Array<{
    promiseId: string
    type: 'value' | 'promise' | 'error'
    value?: unknown
    error?: { code: string; message: string }
  }>
  error?: { code: string; message: string }
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate that the doUrl is a valid URL
 * @throws Error if URL is invalid
 */
function validateDoUrl(doUrl: string): void {
  try {
    new URL(doUrl)
  } catch {
    throw new Error(`Invalid doUrl: ${doUrl}`)
  }
}

/**
 * Validate that the collection name is not empty
 * @throws Error if collection name is empty
 */
function validateCollection(collection: string): void {
  if (!collection || collection.trim() === '') {
    throw new Error('Collection name cannot be empty')
  }
}

/**
 * Convert WebSocket URL to HTTP URL for RPC
 */
function deriveRpcUrl(doUrl: string): string {
  let rpcUrl = doUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')
  rpcUrl = rpcUrl.replace(/\/sync$/, '')
  return `${rpcUrl}/rpc`
}

// =============================================================================
// RPC Execution
// =============================================================================

/**
 * Execute mutations via Cap'n Web RPC
 */
async function executeMutations(
  rpcUrl: string,
  collection: string,
  mutations: Array<{
    type: 'create' | 'insert' | 'update' | 'delete'
    key: string
    data?: unknown
  }>,
  fetchOptions?: RequestInit
): Promise<Array<{ success: boolean; rowid: number }>> {
  const requestId = crypto.randomUUID()
  const calls = mutations.map((mutation, index) => {
    const method = `${collection}.${mutation.type}`
    return {
      promiseId: `p-${index + 1}`,
      target: { type: 'root' as const },
      method,
      args: [{ type: 'value' as const, value: mutation.data || { key: mutation.key } }],
    }
  })

  const request: CapnWebRequest = {
    id: requestId,
    type: mutations.length > 1 ? 'batch' : 'call',
    calls,
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions?.headers as Record<string, string> ?? {}),
  }

  const response = await fetch(rpcUrl, {
    ...fetchOptions,
    method: 'POST',
    headers,
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`)
  }

  const result = await response.json() as CapnWebResponse

  if (result.type === 'error' && result.error) {
    throw new Error(result.error.message)
  }

  if (!result.results || result.results.length === 0) {
    throw new Error('No results in response')
  }

  return result.results.map((r) => {
    if (r.type === 'error' && r.error) {
      throw new Error(r.error.message)
    }
    return r.value as { success: boolean; rowid: number }
  })
}

// =============================================================================
// CollectionOptions Factory
// =============================================================================

/**
 * Create collection options for TanStack DB with dotdo sync.
 *
 * Provides full integration with dotdo backends:
 * - WebSocket sync for real-time updates via SyncClient
 * - Cap'n Web RPC for mutations with optimistic updates
 * - Automatic reconnection and error handling
 *
 * @param config - Configuration for the collection
 * @returns Collection options compatible with TanStack DB
 *
 * @example
 * ```tsx
 * import { CollectionOptions } from '@dotdo/react/tanstack'
 * import { z } from 'zod'
 *
 * const TaskSchema = z.object({
 *   $id: z.string(),
 *   title: z.string(),
 *   status: z.enum(['todo', 'done']),
 * })
 *
 * const taskOptions = CollectionOptions({
 *   doUrl: 'wss://api.example.com.ai/do/workspace',
 *   collection: 'Task',
 *   schema: TaskSchema,
 * })
 * ```
 */
export function CollectionOptions<T extends { $id: string }>(
  config: DotdoCollectionConfig<T>
): DotdoCollectionOptionsResult<T> {
  validateCollection(config.collection)
  validateDoUrl(config.doUrl)

  const rpcUrl = deriveRpcUrl(config.doUrl)

  const id = config.branch
    ? `dotdo:${config.collection}:${config.branch}`
    : `dotdo:${config.collection}`

  return {
    id,
    schema: config.schema,
    getKey: (item: T) => item.$id,

    subscribe: (callbacks: CollectionCallbacks<T>) => {
      const client = new SyncClient<T>({
        doUrl: config.doUrl,
        collection: config.collection,
        branch: config.branch,
      })

      callbacks.begin()

      client.onInitial = (items, txid) => {
        callbacks.begin()
        callbacks.onData(items)
        callbacks.commit({ txid })
      }

      client.onChange = (op, item, txid) => {
        callbacks.begin()
        if (op === 'insert') {
          callbacks.onInsert(item)
        } else if (op === 'update') {
          callbacks.onUpdate(item)
        } else if (op === 'delete') {
          const itemId = (item as T).$id || ((item as unknown as { key: string }).key)
          callbacks.onDelete({ id: itemId })
        }
        callbacks.commit({ txid })
      }

      // Forward errors to callback if provided
      client.onError = (error) => {
        callbacks.onError?.(error)
      }

      client.connect()

      return () => {
        client.disconnect()
      }
    },

    onInsert: async (ctx: MutationContext<T> | { transaction: { changes: T } }): Promise<{ txid: number }> => {
      const transaction = ctx.transaction as { mutations?: Array<Mutation<T>>; changes?: T }
      const mutations = transaction.mutations ?? (transaction.changes ? [{ key: (transaction.changes as T).$id, modified: transaction.changes }] : [])

      const ops = mutations.map((mutation) => ({
        type: 'create' as const,
        key: mutation.key,
        data: mutation.modified,
      }))

      const results = await executeMutations(rpcUrl, config.collection, ops, config.fetchOptions)
      const lastResult = results[results.length - 1]
      return { txid: lastResult.rowid }
    },

    onUpdate: async (ctx: MutationContext<T>): Promise<{ txid: number }> => {
      const { mutations } = ctx.transaction

      const ops = mutations.map((mutation) => ({
        type: 'update' as const,
        key: mutation.key,
        data: { key: mutation.key, ...mutation.changes },
      }))

      const results = await executeMutations(rpcUrl, config.collection, ops, config.fetchOptions)
      const lastResult = results[results.length - 1]
      return { txid: lastResult.rowid }
    },

    onDelete: async (ctx: MutationContext<T>): Promise<{ txid: number }> => {
      const { mutations } = ctx.transaction

      const ops = mutations.map((mutation) => ({
        type: 'delete' as const,
        key: mutation.key,
      }))

      const results = await executeMutations(rpcUrl, config.collection, ops, config.fetchOptions)
      const lastResult = results[results.length - 1]
      return { txid: lastResult.rowid }
    },
  }
}
