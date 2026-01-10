/**
 * TanStack DB Collection Options for dotdo
 *
 * Provides dotdoCollectionOptions factory for creating TanStack DB collections
 * that sync with dotdo backends via WebSocket or Cap'n Web RPC.
 *
 * @module db/tanstack/collection
 */

import { z } from 'zod'
import { SyncClient } from './sync-client'

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
 * Mutation from TanStack DB transaction
 */
export interface Mutation<T> {
  key: string
  modified?: T
  original?: T
  changes?: Partial<T>
}

/**
 * Mutation context from TanStack DB
 */
export interface MutationContext<T> {
  transaction: {
    mutations: Array<Mutation<T>>
  }
  collection: unknown
}

/**
 * Options returned by dotdoCollectionOptions for TanStack DB
 */
export interface DotdoCollectionOptionsResult<T> {
  id: string
  schema: z.ZodSchema<T>
  getKey: (item: T) => string
  subscribe: (callbacks: CollectionCallbacks<T>) => () => void
  onInsert: (ctx: MutationContext<T>) => Promise<{ txid: number }>
  onUpdate: (ctx: MutationContext<T>) => Promise<{ txid: number }>
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
// Validation
// =============================================================================

/**
 * Validate the doUrl format
 */
function validateDoUrl(doUrl: string): void {
  try {
    new URL(doUrl)
  } catch {
    throw new Error(`Invalid doUrl: ${doUrl}`)
  }
}

/**
 * Validate the collection name
 */
function validateCollection(collection: string): void {
  if (!collection || collection.trim() === '') {
    throw new Error('Collection name cannot be empty')
  }
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Derive RPC URL from WebSocket URL
 * Converts wss:// or ws:// to https:// or http:// and appends /rpc
 */
function deriveRpcUrl(doUrl: string): string {
  // Convert ws(s):// to http(s)://
  let rpcUrl = doUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')
  // Remove trailing /sync if present
  rpcUrl = rpcUrl.replace(/\/sync$/, '')
  // Append /rpc
  return `${rpcUrl}/rpc`
}

/**
 * Execute mutations using Cap'n Web protocol
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
  // Build Cap'n Web request
  const requestId = crypto.randomUUID()
  const calls = mutations.map((mutation, index) => {
    const method = `${collection}.${mutation.type}`
    return {
      promiseId: `p-${index + 1}`,
      target: { type: 'root' as const },
      method,
      args: [{ type: 'value' as const, value: { key: mutation.key, data: mutation.data } }],
    }
  })

  const request: CapnWebRequest = {
    id: requestId,
    type: mutations.length > 1 ? 'batch' : 'call',
    calls,
  }

  // Merge headers
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

  // Handle top-level error
  if (result.type === 'error' && result.error) {
    throw new Error(result.error.message)
  }

  // Validate results
  if (!result.results || result.results.length === 0) {
    throw new Error('No results in response')
  }

  // Extract values, throwing on individual errors
  return result.results.map((r) => {
    if (r.type === 'error' && r.error) {
      throw new Error(r.error.message)
    }
    return r.value as { success: boolean; rowid: number }
  })
}

/**
 * Create collection options for TanStack DB with dotdo sync.
 *
 * Provides full integration with dotdo backends:
 * - WebSocket sync for real-time updates via SyncClient
 * - Cap'n Web RPC for mutations with optimistic updates
 * - Automatic reconnection and error handling
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
  // Validate inputs
  validateCollection(config.collection)
  validateDoUrl(config.doUrl)

  // Derive RPC URL for mutations
  const rpcUrl = deriveRpcUrl(config.doUrl)

  // Generate collection id - include branch if specified
  const id = config.branch
    ? `dotdo:${config.collection}:${config.branch}`
    : `dotdo:${config.collection}`

  return {
    id,
    schema: config.schema,
    getKey: (item: T) => item.$id,

    /**
     * Subscribe to real-time updates via WebSocket
     * Creates a SyncClient internally and wires up callbacks
     */
    subscribe: (callbacks: CollectionCallbacks<T>) => {
      const client = new SyncClient<T>({
        doUrl: config.doUrl,
        collection: config.collection,
        branch: config.branch,
      })

      // Signal that sync is starting
      // This allows tests and consumers to know subscription is active
      callbacks.begin()

      // Wire up SyncClient callbacks to TanStack DB callbacks
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
          // For delete, extract the id from the item
          const itemId = (item as T).$id || ((item as unknown as { key: string }).key)
          callbacks.onDelete({ id: itemId })
        }
        callbacks.commit({ txid })
      }

      // Connect to start receiving updates
      client.connect()

      // Return unsubscribe function
      return () => {
        client.disconnect()
      }
    },

    /**
     * Handle insert mutations via RPC
     * Returns { txid } for TanStack DB optimistic update confirmation
     */
    onInsert: async (ctx: MutationContext<T> | { transaction: { changes: T } }): Promise<{ txid: number }> => {
      // Support both new (mutations array) and legacy (changes object) API
      const transaction = ctx.transaction as { mutations?: Array<Mutation<T>>; changes?: T }
      const mutations = transaction.mutations ?? (transaction.changes ? [{ key: (transaction.changes as T).$id, modified: transaction.changes }] : [])

      // Build mutation operations - use 'create' for insert
      const ops = mutations.map((mutation) => ({
        type: 'create' as const,
        key: mutation.key,
        data: mutation.modified,
      }))

      const results = await executeMutations(rpcUrl, config.collection, ops, config.fetchOptions)

      // Return the last txid (rowid)
      const lastResult = results[results.length - 1]
      return { txid: lastResult.rowid }
    },

    /**
     * Handle update mutations via RPC
     * Returns { txid } for TanStack DB optimistic update confirmation
     */
    onUpdate: async (ctx: MutationContext<T>): Promise<{ txid: number }> => {
      const { mutations } = ctx.transaction

      // Build mutation operations
      const ops = mutations.map((mutation) => ({
        type: 'update' as const,
        key: mutation.key,
        data: { key: mutation.key, ...mutation.changes },
      }))

      const results = await executeMutations(rpcUrl, config.collection, ops, config.fetchOptions)

      // Return the last txid (rowid)
      const lastResult = results[results.length - 1]
      return { txid: lastResult.rowid }
    },

    /**
     * Handle delete mutations via RPC
     * Returns { txid } for TanStack DB optimistic update confirmation
     */
    onDelete: async (ctx: MutationContext<T>): Promise<{ txid: number }> => {
      const { mutations } = ctx.transaction

      // Build mutation operations
      const ops = mutations.map((mutation) => ({
        type: 'delete' as const,
        key: mutation.key,
      }))

      const results = await executeMutations(rpcUrl, config.collection, ops, config.fetchOptions)

      // Return the last txid (rowid)
      const lastResult = results[results.length - 1]
      return { txid: lastResult.rowid }
    },
  }
}
