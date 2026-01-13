/**
 * TanStack DB Collection Options Factory
 *
 * Creates TanStack DB compatible collection options with dotdo sync.
 * Handles WebSocket sync for real-time updates and Cap'n Web RPC for mutations.
 *
 * @module db/tanstack/collection
 */

import type { SyncItem, ChangeMessage } from './protocol'
import { createSyncClient, type SyncClientInterface } from './sync-client'
import { createRpcClient, deriveRpcUrl, validateUrl, type RpcClient, type MutationOperation } from './rpc'

// =============================================================================
// Types
// =============================================================================

/**
 * Sync context passed to the sync function by TanStack DB
 */
export interface TanStackSyncContext {
  begin(): void
  write(mutation: { type: 'insert' | 'update' | 'delete'; value?: unknown; key?: string }): void
  commit(): void
  markReady(): void
}

/**
 * TanStack DB compatible collection options
 */
export interface CollectionOptions<T> {
  id: string
  getKey: (item: T) => string
  sync: (context: TanStackSyncContext) => () => void
}

/**
 * Configuration for dotdoCollectionOptions
 */
export interface DotdoCollectionOptionsConfig {
  /** Collection name (Noun type) */
  name: string
  /** Durable Object URL (WebSocket or HTTP) */
  doUrl: string
  /** Optional branch for branched data */
  branch?: string | null
  /** Optional fetch options for RPC calls */
  fetchOptions?: RequestInit
}

/**
 * Callbacks used by TanStack DB collection for sync operations (advanced usage)
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
 * Extended collection options with mutation handlers
 */
export interface DotdoCollectionOptionsResult<T extends { $id: string }> extends CollectionOptions<T> {
  /** Handle insert mutations */
  onInsert: (ctx: MutationContext<T>) => Promise<{ txid: number }>
  /** Handle update mutations */
  onUpdate: (ctx: MutationContext<T>) => Promise<{ txid: number }>
  /** Handle delete mutations */
  onDelete: (ctx: MutationContext<T>) => Promise<{ txid: number }>
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

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate collection name
 * @throws Error if collection name is empty
 */
function validateCollection(collection: string): void {
  if (!collection || collection.trim() === '') {
    throw new Error('Collection name cannot be empty')
  }
}

// =============================================================================
// Simple Collection Options (TanStack DB sync function style)
// =============================================================================

/**
 * Create TanStack DB compatible collection options for dotdo sync
 *
 * This is the simplest API that returns options compatible with TanStack DB's
 * collection definition format using the sync function pattern.
 *
 * @example
 * ```typescript
 * import { dotdoCollectionOptions } from 'db/tanstack'
 * import { createDB } from '@tanstack/db'
 *
 * const taskCollection = dotdoCollectionOptions({
 *   name: 'Task',
 *   doUrl: 'https://my-app.workers.dev/api',
 * })
 *
 * const db = createDB({
 *   collections: {
 *     tasks: taskCollection,
 *   },
 * })
 * ```
 */
export function dotdoCollectionOptions<T extends { $id: string }>(
  config: DotdoCollectionOptionsConfig
): CollectionOptions<T> {
  validateCollection(config.name)
  validateUrl(config.doUrl)

  const { name, doUrl, branch } = config

  // Build WebSocket URL from DO URL
  const wsUrl = doUrl.replace(/^http/, 'ws')

  return {
    id: branch ? `dotdo:${name}:${branch}` : `dotdo:${name}`,

    getKey(item: T): string {
      return item.$id
    },

    sync(context: TanStackSyncContext): () => void {
      const { begin, write, commit, markReady } = context

      // Create client and set up handlers
      const client = createSyncClient<T>({ url: wsUrl, branch })

      // Handle initial state
      client.onInitial(name, (items, _txid) => {
        begin()
        for (const item of items) {
          write({ type: 'insert', value: item })
        }
        commit()
        markReady()
      })

      // Handle changes
      client.onChange(name, (change: ChangeMessage<T>) => {
        begin()
        if (change.type === 'delete') {
          write({ type: 'delete', key: change.key })
        } else {
          write({ type: change.type, value: change.data })
        }
        commit()
      })

      // Connect and subscribe
      client.connect().then(() => {
        client.subscribe(name, branch)
      }).catch(() => {
        // Connection failed - will be handled by reconnect logic
      })

      // Return cleanup function
      return () => {
        client.disconnect()
      }
    },
  }
}

// =============================================================================
// Extended Collection Options (with mutation handlers)
// =============================================================================

/**
 * Create extended collection options with mutation handlers
 *
 * This API provides additional onInsert, onUpdate, onDelete handlers for
 * persisting mutations via Cap'n Web RPC.
 *
 * @example
 * ```typescript
 * import { createCollectionOptions } from 'db/tanstack'
 *
 * const taskOptions = createCollectionOptions<Task>({
 *   name: 'Task',
 *   doUrl: 'https://my-app.workers.dev/api',
 * })
 *
 * // Use with TanStack DB useCollection hook
 * const { insert, update, remove } = useCollection(taskOptions)
 *
 * // Mutations are automatically persisted via RPC
 * await insert({ $id: 'task-1', title: 'New Task', status: 'todo' })
 * ```
 */
export function createCollectionOptions<T extends { $id: string }>(
  config: DotdoCollectionOptionsConfig
): DotdoCollectionOptionsResult<T> {
  validateCollection(config.name)
  validateUrl(config.doUrl)

  const { name, doUrl, branch, fetchOptions } = config
  const rpcUrl = deriveRpcUrl(doUrl)
  const rpc = createRpcClient({ rpcUrl, fetchOptions })

  // Get base options from simple factory
  const baseOptions = dotdoCollectionOptions<T>(config)

  return {
    ...baseOptions,

    async onInsert(ctx: MutationContext<T>): Promise<{ txid: number }> {
      const transaction = ctx.transaction as { mutations?: Array<Mutation<T>>; changes?: T }
      const mutations = transaction.mutations ?? (transaction.changes ? [{ key: (transaction.changes as T).$id, modified: transaction.changes }] : [])

      const ops: MutationOperation[] = mutations.map((mutation) => ({
        type: 'create',
        key: mutation.key,
        data: mutation.modified,
      }))

      const results = await rpc.executeBatch(name, ops)
      const lastResult = results[results.length - 1]
      return { txid: lastResult.rowid }
    },

    async onUpdate(ctx: MutationContext<T>): Promise<{ txid: number }> {
      const { mutations } = ctx.transaction

      const ops: MutationOperation[] = mutations.map((mutation) => ({
        type: 'update',
        key: mutation.key,
        data: { key: mutation.key, ...mutation.changes },
      }))

      const results = await rpc.executeBatch(name, ops)
      const lastResult = results[results.length - 1]
      return { txid: lastResult.rowid }
    },

    async onDelete(ctx: MutationContext<T>): Promise<{ txid: number }> {
      const { mutations } = ctx.transaction

      const ops: MutationOperation[] = mutations.map((mutation) => ({
        type: 'delete',
        key: mutation.key,
      }))

      const results = await rpc.executeBatch(name, ops)
      const lastResult = results[results.length - 1]
      return { txid: lastResult.rowid }
    },
  }
}

// =============================================================================
// Callback-style Collection Options (for advanced usage)
// =============================================================================

/**
 * Create collection options with callback-style subscription
 *
 * This is an alternative API that uses callbacks instead of the TanStack DB
 * sync function pattern. Useful for custom integrations.
 *
 * @example
 * ```typescript
 * import { CollectionOptions } from 'db/tanstack/collection'
 *
 * const options = CollectionOptions({
 *   doUrl: 'wss://my-do.workers.dev/do/123',
 *   collection: 'Task',
 *   schema: TaskSchema,
 * })
 *
 * const unsubscribe = options.subscribe({
 *   begin: () => { ... },
 *   onData: (items) => { ... },
 *   onInsert: (item) => { ... },
 *   onUpdate: (item) => { ... },
 *   onDelete: ({ id }) => { ... },
 *   commit: ({ txid }) => { ... },
 * })
 * ```
 */
export function CollectionOptions<T extends { $id: string }>(config: {
  doUrl: string
  collection: string
  branch?: string
  fetchOptions?: RequestInit
}): {
  id: string
  getKey: (item: T) => string
  subscribe: (callbacks: CollectionCallbacks<T>) => () => void
  onInsert: (ctx: MutationContext<T>) => Promise<{ txid: number }>
  onUpdate: (ctx: MutationContext<T>) => Promise<{ txid: number }>
  onDelete: (ctx: MutationContext<T>) => Promise<{ txid: number }>
} {
  validateCollection(config.collection)
  validateUrl(config.doUrl)

  const { doUrl, collection, branch, fetchOptions } = config
  const rpcUrl = deriveRpcUrl(doUrl)
  const rpc = createRpcClient({ rpcUrl, fetchOptions })

  const id = branch
    ? `dotdo:${collection}:${branch}`
    : `dotdo:${collection}`

  return {
    id,

    getKey(item: T): string {
      return item.$id
    },

    subscribe(callbacks: CollectionCallbacks<T>): () => void {
      const client = createSyncClient<T>({ url: doUrl, branch })

      callbacks.begin()

      client.onInitial(collection, (items, txid) => {
        callbacks.begin()
        callbacks.onData(items)
        callbacks.commit({ txid })
      })

      client.onChange(collection, (change: ChangeMessage<T>) => {
        callbacks.begin()
        if (change.type === 'insert') {
          callbacks.onInsert(change.data)
        } else if (change.type === 'update') {
          callbacks.onUpdate(change.data)
        } else if (change.type === 'delete') {
          callbacks.onDelete({ id: change.key })
        }
        callbacks.commit({ txid: change.txid })
      })

      client.onError((error) => {
        callbacks.onError?.(error)
      })

      client.connect().then(() => {
        client.subscribe(collection, branch)
      }).catch(() => {
        // Connection failed - handled by reconnect
      })

      return () => {
        client.disconnect()
      }
    },

    async onInsert(ctx: MutationContext<T>): Promise<{ txid: number }> {
      const transaction = ctx.transaction as { mutations?: Array<Mutation<T>>; changes?: T }
      const mutations = transaction.mutations ?? (transaction.changes ? [{ key: (transaction.changes as T).$id, modified: transaction.changes }] : [])

      const ops: MutationOperation[] = mutations.map((mutation) => ({
        type: 'create',
        key: mutation.key,
        data: mutation.modified,
      }))

      const results = await rpc.executeBatch(collection, ops)
      const lastResult = results[results.length - 1]
      return { txid: lastResult.rowid }
    },

    async onUpdate(ctx: MutationContext<T>): Promise<{ txid: number }> {
      const { mutations } = ctx.transaction

      const ops: MutationOperation[] = mutations.map((mutation) => ({
        type: 'update',
        key: mutation.key,
        data: { key: mutation.key, ...mutation.changes },
      }))

      const results = await rpc.executeBatch(collection, ops)
      const lastResult = results[results.length - 1]
      return { txid: lastResult.rowid }
    },

    async onDelete(ctx: MutationContext<T>): Promise<{ txid: number }> {
      const { mutations } = ctx.transaction

      const ops: MutationOperation[] = mutations.map((mutation) => ({
        type: 'delete',
        key: mutation.key,
      }))

      const results = await rpc.executeBatch(collection, ops)
      const lastResult = results[results.length - 1]
      return { txid: lastResult.rowid }
    },
  }
}
