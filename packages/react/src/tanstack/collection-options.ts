/**
 * TanStack DB Collection Options for dotdo
 *
 * Provides dotdoCollectionOptions factory for creating TanStack DB collections
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
 */

import type { z } from 'zod'

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
// SyncClient (internal)
// =============================================================================

const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 30000

interface SyncClientConfig {
  doUrl: string
  collection: string
  branch?: string
}

class SyncClient<T> {
  private config: SyncClientConfig
  private ws: WebSocket | null = null
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private intentionalDisconnect = false

  onInitial: (items: T[], txid: number) => void = () => {}
  onChange: (op: 'insert' | 'update' | 'delete', item: T, txid: number) => void = () => {}
  onDisconnect: () => void = () => {}

  constructor(config: SyncClientConfig) {
    this.config = config
  }

  connect(): void {
    this.intentionalDisconnect = false
    const wsUrl = `${this.config.doUrl}/sync`
    this.ws = new WebSocket(wsUrl)

    this.ws.addEventListener('open', () => {
      this.reconnectAttempts = 0
      const subscribeMsg: Record<string, string> = {
        type: 'subscribe',
        collection: this.config.collection,
      }
      if (this.config.branch) {
        subscribeMsg.branch = this.config.branch
      }
      this.ws!.send(JSON.stringify(subscribeMsg))
    })

    this.ws.addEventListener('message', (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'initial') {
          this.onInitial(msg.data, msg.txid)
        } else if (msg.type === 'insert' || msg.type === 'update') {
          this.onChange(msg.type, msg.data, msg.txid)
        } else if (msg.type === 'delete') {
          const item = msg.data || { key: msg.key }
          this.onChange('delete', item as T, msg.txid)
        }
      } catch {
        // Malformed JSON - silently ignore
      }
    })

    this.ws.addEventListener('close', () => {
      this.onDisconnect()
      if (!this.intentionalDisconnect) {
        this.scheduleReconnect()
      }
    })

    this.ws.addEventListener('error', () => {
      // Error handling - onclose will fire after
    })
  }

  disconnect(): void {
    this.intentionalDisconnect = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'unsubscribe',
          collection: this.config.collection,
        }))
      }
      this.ws.close()
      this.ws = null
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_DELAY_MS
    )
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }
}

// =============================================================================
// Implementation
// =============================================================================

function validateDoUrl(doUrl: string): void {
  try {
    new URL(doUrl)
  } catch {
    throw new Error(`Invalid doUrl: ${doUrl}`)
  }
}

function validateCollection(collection: string): void {
  if (!collection || collection.trim() === '') {
    throw new Error('Collection name cannot be empty')
  }
}

function deriveRpcUrl(doUrl: string): string {
  let rpcUrl = doUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')
  rpcUrl = rpcUrl.replace(/\/sync$/, '')
  return `${rpcUrl}/rpc`
}

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
      args: [{ type: 'value' as const, value: { key: mutation.key, data: mutation.data } }],
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

/**
 * Create collection options for TanStack DB with dotdo sync.
 *
 * Provides full integration with dotdo backends:
 * - WebSocket sync for real-time updates via SyncClient
 * - Cap'n Web RPC for mutations with optimistic updates
 * - Automatic reconnection and error handling
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
