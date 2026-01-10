/**
 * Dotdo Data Provider
 *
 * DataProvider implementation for dotdo Durable Objects.
 * Provides CRUD operations over Cap'n Web RPC with real-time subscriptions.
 *
 * @module @dotdo/react/admin
 */

import type {
  DataProvider,
  GetListParams,
  GetListResult,
  GetOneParams,
  GetOneResult,
  GetManyParams,
  GetManyResult,
  CreateParams,
  CreateResult,
  UpdateParams,
  UpdateResult,
  DeleteParams,
  DeleteResult,
  DeleteManyParams,
  DeleteManyResult,
  BaseRecord,
  SubscriptionEvent,
  QueryFilter,
} from './types'
import { getRecordId } from './types'
import { AdminError, formatAdminError } from './errors'

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration for DotdoDataProvider
 */
export interface DotdoDataProviderConfig {
  /** Namespace URL for the Durable Object (e.g., 'https://api.example.com/do/workspace') */
  ns: string
  /** Custom headers for requests */
  headers?: Record<string, string>
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Enable real-time subscriptions (default: true) */
  realtime?: boolean
  /** Custom fetch function for testing */
  fetch?: typeof fetch
}

// =============================================================================
// RPC Types
// =============================================================================

interface RPCCall {
  promiseId: string
  target: { type: 'root' }
  method: string
  args: Array<{ type: 'value'; value: unknown }>
}

interface RPCRequest {
  id: string
  type: 'call'
  calls: RPCCall[]
}

interface RPCResponse {
  results?: Array<{ value: unknown; error?: { message: string } }>
  error?: { message: string }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a DotdoDataProvider.
 *
 * Connects to a dotdo Durable Object namespace and provides CRUD operations
 * via Cap'n Web RPC protocol.
 *
 * @example
 * ```ts
 * const dataProvider = DotdoDataProvider({
 *   ns: 'https://api.example.com/do/workspace',
 *   headers: { Authorization: 'Bearer token' },
 * })
 * ```
 */
export function DotdoDataProvider(
  config: DotdoDataProviderConfig
): DataProvider {
  const {
    ns,
    headers = {},
    timeout = 30000,
    realtime = true,
    fetch: customFetch = fetch,
  } = config

  // Derive URLs
  const rpcUrl = `${ns}/rpc`
  const wsUrl = ns.replace(/^https?:/, (m) => (m === 'https:' ? 'wss:' : 'ws:')) + '/sync'

  // Track active subscriptions
  const subscriptions = new Map<
    string,
    {
      ws: WebSocket | null
      callbacks: Set<(event: SubscriptionEvent) => void>
    }
  >()

  // ==========================================================================
  // RPC Helper
  // ==========================================================================

  async function rpc<T>(
    method: string,
    args: unknown[]
  ): Promise<T> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const request: RPCRequest = {
        id: crypto.randomUUID(),
        type: 'call',
        calls: [
          {
            promiseId: 'p-1',
            target: { type: 'root' },
            method,
            args: args.map((arg) => ({ type: 'value', value: arg })),
          },
        ],
      }

      const response = await customFetch(rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      })

      if (!response.ok) {
        let body: unknown
        try {
          body = await response.json()
        } catch {
          // Ignore JSON parse errors
        }
        throw AdminError.fromResponse(response, method.split('.')[0], body)
      }

      const result = (await response.json()) as RPCResponse

      if (result.error) {
        throw new AdminError({
          code: 'SERVER_ERROR',
          message: result.error.message,
          resource: method.split('.')[0],
        })
      }

      const callResult = result.results?.[0]
      if (callResult?.error) {
        throw new AdminError({
          code: 'SERVER_ERROR',
          message: callResult.error.message,
          resource: method.split('.')[0],
        })
      }

      return callResult?.value as T
    } catch (err) {
      if (err instanceof AdminError) throw err
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AdminError({
          code: 'TIMEOUT',
          message: 'Request timed out',
          resource: method.split('.')[0],
          retryable: true,
        })
      }
      throw formatAdminError(err, method.split('.')[0])
    } finally {
      clearTimeout(timeoutId)
    }
  }

  // ==========================================================================
  // Normalize Record ID
  // ==========================================================================

  function normalizeId(record: BaseRecord): BaseRecord {
    // Ensure both $id and id are set for compatibility
    const id = getRecordId(record)
    return {
      ...record,
      $id: record.$id ?? id,
      id: record.id ?? id,
    }
  }

  // ==========================================================================
  // Data Provider Methods
  // ==========================================================================

  const provider: DataProvider = {
    async getList<T extends BaseRecord>(
      params: GetListParams
    ): Promise<GetListResult<T>> {
      const { resource, pagination, sort, filter } = params

      // Build query params
      const queryParams: Record<string, unknown> = {}

      if (pagination) {
        queryParams.page = pagination.page
        queryParams.perPage = pagination.perPage
      }

      if (sort) {
        queryParams.sortField = sort.field
        queryParams.sortOrder = sort.order
      }

      if (filter) {
        queryParams.filter = filter
      }

      try {
        const result = await rpc<{ items: T[]; total: number; cursor?: string }>(
          `${resource}.findAll`,
          [queryParams]
        )

        // Handle both array response and paginated response
        const items = Array.isArray(result)
          ? (result as T[])
          : result.items || []
        const total = Array.isArray(result) ? items.length : result.total

        return {
          data: items.map((item) => normalizeId(item) as T),
          total,
          cursor: Array.isArray(result) ? null : result.cursor,
          hasMore: Array.isArray(result) ? false : !!result.cursor,
        }
      } catch (err) {
        throw formatAdminError(err, resource)
      }
    },

    async getOne<T extends BaseRecord>(
      params: GetOneParams
    ): Promise<GetOneResult<T>> {
      const { resource, id } = params

      try {
        const result = await rpc<T | null>(`${resource}.findById`, [id])

        if (!result) {
          throw AdminError.notFound(resource, id)
        }

        return {
          data: normalizeId(result) as T,
        }
      } catch (err) {
        throw formatAdminError(err, resource)
      }
    },

    async getMany<T extends BaseRecord>(
      params: GetManyParams
    ): Promise<GetManyResult<T>> {
      const { resource, ids } = params

      try {
        // Batch fetch - try findByIds first, fall back to individual calls
        let results: T[]

        try {
          results = await rpc<T[]>(`${resource}.findByIds`, [ids])
        } catch {
          // Fall back to individual calls
          const fetchedItems = await Promise.all(
            ids.map((id) =>
              rpc<T | null>(`${resource}.findById`, [id]).then((r) => r)
            )
          )
          // Filter out null values and cast the result
          results = fetchedItems.filter(
            (item): item is NonNullable<typeof item> => item !== null && item !== undefined
          ) as T[]
        }

        return {
          data: results.map((item) => normalizeId(item) as T),
        }
      } catch (err) {
        throw formatAdminError(err, resource)
      }
    },

    async create<T extends BaseRecord>(
      params: CreateParams<T>
    ): Promise<CreateResult<T>> {
      const { resource, data } = params

      try {
        const result = await rpc<T>(`${resource}.create`, [data])

        return {
          data: normalizeId(result) as T,
        }
      } catch (err) {
        throw formatAdminError(err, resource)
      }
    },

    async update<T extends BaseRecord>(
      params: UpdateParams<T>
    ): Promise<UpdateResult<T>> {
      const { resource, id, data } = params

      try {
        const result = await rpc<T>(`${resource}.update`, [{ key: id, ...data }])

        return {
          data: normalizeId(result) as T,
        }
      } catch (err) {
        throw formatAdminError(err, resource)
      }
    },

    async delete<T extends BaseRecord>(
      params: DeleteParams<T>
    ): Promise<DeleteResult<T>> {
      const { resource, id, previousData } = params

      try {
        await rpc<void>(`${resource}.delete`, [{ key: id }])

        // Return the previous data or a minimal object
        const deletedRecord = previousData ?? ({ $id: id, id } as T)

        return {
          data: normalizeId(deletedRecord) as T,
        }
      } catch (err) {
        throw formatAdminError(err, resource)
      }
    },

    async deleteMany(params: DeleteManyParams): Promise<DeleteManyResult> {
      const { resource, ids } = params

      try {
        // Try bulk delete first
        try {
          await rpc<void>(`${resource}.deleteMany`, [ids])
        } catch {
          // Fall back to individual deletes
          await Promise.all(
            ids.map((id) => rpc<void>(`${resource}.delete`, [{ key: id }]))
          )
        }

        return {
          data: ids,
        }
      } catch (err) {
        throw formatAdminError(err, resource)
      }
    },

    subscribe<T extends BaseRecord>(
      resource: string,
      callback: (event: SubscriptionEvent<T>) => void
    ): () => void {
      if (!realtime) {
        return () => {}
      }

      // Get or create subscription for this resource
      let subscription = subscriptions.get(resource)

      if (!subscription) {
        subscription = {
          ws: null,
          callbacks: new Set(),
        }
        subscriptions.set(resource, subscription)
      }

      // Add callback
      subscription.callbacks.add(callback as (event: SubscriptionEvent) => void)

      // Connect WebSocket if not already connected
      if (!subscription.ws || subscription.ws.readyState !== WebSocket.OPEN) {
        const ws = new WebSocket(wsUrl)
        subscription.ws = ws

        ws.addEventListener('open', () => {
          // Subscribe to collection
          ws.send(
            JSON.stringify({
              type: 'subscribe',
              collection: resource,
            })
          )
        })

        ws.addEventListener('message', (event) => {
          try {
            const msg = JSON.parse(event.data)
            const sub = subscriptions.get(resource)

            if (!sub) return

            let subscriptionEvent: SubscriptionEvent<T> | null = null

            if (msg.type === 'insert') {
              subscriptionEvent = {
                type: 'created',
                resource,
                data: normalizeId(msg.data) as T,
              }
            } else if (msg.type === 'update') {
              subscriptionEvent = {
                type: 'updated',
                resource,
                data: normalizeId(msg.data) as T,
                id: msg.key,
              }
            } else if (msg.type === 'delete') {
              subscriptionEvent = {
                type: 'deleted',
                resource,
                id: msg.key,
              }
            }

            if (subscriptionEvent) {
              for (const cb of sub.callbacks) {
                try {
                  cb(subscriptionEvent as SubscriptionEvent)
                } catch (err) {
                  console.error('Subscription callback error:', err)
                }
              }
            }
          } catch {
            // Ignore malformed messages
          }
        })

        ws.addEventListener('close', () => {
          // Attempt reconnection after delay
          setTimeout(() => {
            const sub = subscriptions.get(resource)
            if (sub && sub.callbacks.size > 0) {
              // Reconnect if there are still active subscribers
              sub.ws = null
              // Re-subscribe for each callback
              for (const cb of sub.callbacks) {
                provider.subscribe?.(resource, cb as (event: SubscriptionEvent) => void)
              }
            }
          }, 1000)
        })
      }

      // Return unsubscribe function
      return () => {
        const sub = subscriptions.get(resource)
        if (sub) {
          sub.callbacks.delete(callback as (event: SubscriptionEvent) => void)

          // Close WebSocket if no more subscribers
          if (sub.callbacks.size === 0) {
            sub.ws?.close()
            subscriptions.delete(resource)
          }
        }
      }
    },
  }

  return provider
}
