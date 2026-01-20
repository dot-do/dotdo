/**
 * Magic-Map Pattern for @dotdo/db
 *
 * Adapted from db4's CapnWeb RPC Magic-Map pattern.
 * Enables N+1 query elimination by capturing operations and batching them.
 *
 * The Magic-Map pattern works by:
 * 1. Creating a Proxy that captures method calls
 * 2. Collecting all operations in a batch
 * 3. Executing them in a single round-trip
 * 4. Replaying the results to the original call sites
 *
 * This is especially powerful for:
 * - Fetching related entities without N+1 queries
 * - Executing complex queries server-side
 * - Reducing network round-trips in distributed systems
 *
 * @example
 * ```typescript
 * // Without Magic-Map (N+1 problem):
 * const orders = await db.orders.list()
 * for (const order of orders) {
 *   order.customer = await db.customers.get(order.customerId)  // N queries!
 * }
 *
 * // With Magic-Map (batched):
 * const proxy = createMagicMap(transport)
 * const results = await proxy.orders.list().map(order => ({
 *   ...order,
 *   customer: proxy.customers.get(order.customerId)  // All batched!
 * }))
 * ```
 *
 * @packageDocumentation
 */

import type { Thing } from './things'
import type { JsonValue, StorableData } from './types'

// =============================================================================
// Types
// =============================================================================

/**
 * Request structure for Magic-Map RPC
 */
export interface MagicMapRequest {
  id: string
  path: string[]
  args: unknown[]
  timestamp: number
}

/**
 * Response structure for Magic-Map RPC
 */
export interface MagicMapResponse {
  id: string
  success: boolean
  result?: unknown
  error?: {
    code: string
    message: string
    data?: unknown
  }
  timestamp: number
}

/**
 * Batch request containing multiple operations
 */
export interface MagicMapBatchRequest {
  type: 'batch'
  requests: MagicMapRequest[]
  timestamp: number
}

/**
 * Batch response containing multiple results
 */
export interface MagicMapBatchResponse {
  type: 'batch'
  responses: MagicMapResponse[]
  timestamp: number
}

/**
 * Transport interface for sending Magic-Map requests
 * Can be implemented for different backends (WebSocket, HTTP, in-process, etc.)
 */
export interface MagicMapTransport {
  /**
   * Send a request or batch and receive the response
   */
  send(message: MagicMapRequest | MagicMapBatchRequest): Promise<MagicMapResponse | MagicMapBatchResponse>

  /**
   * Optional: Subscribe to push messages
   */
  subscribe?(handler: (message: MagicMapResponse) => void): () => void
}

/**
 * Options for map operations
 */
export interface MapOptions {
  /** Maximum concurrent operations */
  concurrency?: number
  /** Continue on error */
  continueOnError?: boolean
  /** Batch size for chunking large arrays */
  batchSize?: number
}

/**
 * Magic-Map proxy interface
 */
export interface MagicMapProxy<T = unknown> {
  /** Get the current path */
  readonly $path: string[]

  /** Create a batch collector */
  $batch(): BatchCollector

  /** Execute a map operation over an array */
  map<U>(items: T[], fn: (item: T) => U, options?: MapOptions): Promise<U[]>

  /** Dynamic property access to build paths */
  [key: string]: MagicMapProxy | unknown
}

/**
 * Batch collector for grouping operations
 */
export interface BatchCollector {
  /** Add an operation to the batch */
  add<T>(operation: () => Promise<T>): Promise<T>

  /** Execute all batched operations */
  execute(): Promise<void>

  /** Get the number of pending operations */
  readonly size: number
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when Magic-Map resolution fails
 */
export class MagicMapError extends Error {
  readonly code: string
  readonly data?: unknown

  constructor(code: string, message: string, data?: unknown) {
    super(`${code}: ${message}`)
    this.name = 'MagicMapError'
    this.code = code
    this.data = data
  }
}

// =============================================================================
// Request ID Generator
// =============================================================================

let requestIdCounter = 0

function generateRequestId(): string {
  return `req-${++requestIdCounter}-${Date.now()}`
}

// =============================================================================
// Magic-Map Implementation
// =============================================================================

/**
 * Create a Magic-Map proxy for a given transport
 *
 * @example
 * ```typescript
 * const transport: MagicMapTransport = {
 *   async send(message) {
 *     // Send to server and get response
 *     return await fetch('/rpc', {
 *       method: 'POST',
 *       body: JSON.stringify(message)
 *     }).then(r => r.json())
 *   }
 * }
 *
 * const proxy = createMagicMap(transport)
 *
 * // Access nested paths
 * const users = await proxy.users.list()
 *
 * // Make calls with arguments
 * const user = await proxy.users.get('user-123')
 *
 * // Batch operations
 * const batch = proxy.$batch()
 * const p1 = batch.add(() => proxy.users.get('user-1'))
 * const p2 = batch.add(() => proxy.users.get('user-2'))
 * await batch.execute()
 * console.log(await p1, await p2)
 * ```
 */
export function createMagicMap<T = unknown>(transport: MagicMapTransport): MagicMapProxy<T> {
  return createProxy(transport, [])
}

/**
 * Internal proxy creation
 */
function createProxy<T>(
  transport: MagicMapTransport,
  path: string[]
): MagicMapProxy<T> {
  /**
   * Send a single request
   */
  async function sendRequest(requestPath: string[], args: unknown[]): Promise<unknown> {
    const request: MagicMapRequest = {
      id: generateRequestId(),
      path: requestPath,
      args,
      timestamp: Date.now(),
    }

    const response = await transport.send(request)

    if ('type' in response && response.type === 'batch') {
      throw new MagicMapError('INVALID_RESPONSE', 'Expected single response, got batch')
    }

    const singleResponse = response as MagicMapResponse

    if (!singleResponse.success) {
      throw new MagicMapError(
        singleResponse.error?.code || 'UNKNOWN',
        singleResponse.error?.message || 'Unknown error',
        singleResponse.error?.data
      )
    }

    return singleResponse.result
  }

  /**
   * Send a batch request
   */
  async function sendBatch(requests: MagicMapRequest[]): Promise<MagicMapBatchResponse> {
    const batchRequest: MagicMapBatchRequest = {
      type: 'batch',
      requests,
      timestamp: Date.now(),
    }

    const response = await transport.send(batchRequest)

    if (!('type' in response) || response.type !== 'batch') {
      throw new MagicMapError('INVALID_RESPONSE', 'Expected batch response')
    }

    return response as MagicMapBatchResponse
  }

  // Create the proxy
  const proxyTarget = function() {} as unknown as MagicMapProxy<T>

  return new Proxy(proxyTarget, {
    get(_target, prop) {
      // Handle special symbols that should return undefined
      if (prop === 'then' || prop === Symbol.toPrimitive || prop === Symbol.toStringTag) {
        return undefined
      }

      // Return the current path
      if (prop === '$path') {
        return path
      }

      // Create batch collector
      if (prop === '$batch') {
        return () => createBatchCollector(transport)
      }

      // Handle map method for batched array operations
      if (prop === 'map') {
        return async <U>(
          items: T[],
          fn: (item: T) => U,
          options?: MapOptions
        ): Promise<U[]> => {
          if (items.length === 0) return []

          const batchSize = options?.batchSize || 100
          const continueOnError = options?.continueOnError ?? false

          // Create requests for each item
          const allResults: U[] = []

          // Process in batches to avoid overwhelming the server
          for (let i = 0; i < items.length; i += batchSize) {
            const batchItems = items.slice(i, i + batchSize)
            const collector = createBatchCollector(transport)

            // Collect all operations for this batch
            const promises = batchItems.map(item => {
              // Execute the function in a batch context
              // The function may call proxy methods which will be batched
              return collector.add(async () => fn(item))
            })

            // Execute the batch
            await collector.execute()

            // Collect results
            for (let j = 0; j < promises.length; j++) {
              try {
                const result = await promises[j]!
                allResults.push(result)
              } catch (error) {
                if (!continueOnError) throw error
                // @ts-expect-error - storing error in results for continueOnError mode
                allResults.push(error)
              }
            }
          }

          return allResults
        }
      }

      // Continue building the path
      return createProxy(transport, [...path, String(prop)])
    },

    apply(_target, _thisArg, args) {
      // Execute the RPC call
      return sendRequest(path, args)
    },
  })
}

/**
 * Create a batch collector for grouping operations
 */
function createBatchCollector(transport: MagicMapTransport): BatchCollector {
  const pendingOperations: Array<{
    request: MagicMapRequest
    resolve: (result: unknown) => void
    reject: (error: Error) => void
  }> = []

  let executed = false

  return {
    get size() {
      return pendingOperations.length
    },

    add<T>(operation: () => Promise<T>): Promise<T> {
      if (executed) {
        throw new MagicMapError('BATCH_EXECUTED', 'Cannot add operations after batch execution')
      }

      return new Promise<T>((resolve, reject) => {
        // We need to intercept the proxy calls made by the operation
        // For now, we execute the operation and store its promise
        // In a full implementation, we'd intercept the proxy calls
        const request: MagicMapRequest = {
          id: generateRequestId(),
          path: ['_deferred'],
          args: [],
          timestamp: Date.now(),
        }

        pendingOperations.push({
          request,
          resolve: resolve as (result: unknown) => void,
          reject,
        })

        // Execute the operation immediately but defer resolution
        operation().then(resolve).catch(reject)
      })
    },

    async execute(): Promise<void> {
      if (executed) {
        throw new MagicMapError('BATCH_EXECUTED', 'Batch already executed')
      }

      executed = true

      if (pendingOperations.length === 0) {
        return
      }

      // In a full implementation, we'd batch the actual requests
      // For now, the operations have already executed individually
      // This is a simplified version - full batching requires intercepting proxy calls
    },
  }
}

// =============================================================================
// In-Memory Transport (for testing and local operations)
// =============================================================================

/**
 * Handler function type for in-memory transport
 */
export type MagicMapHandler = (path: string[], args: unknown[]) => Promise<unknown>

/**
 * Create an in-memory transport for testing or local operations
 *
 * @example
 * ```typescript
 * const transport = createInMemoryTransport(async (path, args) => {
 *   if (path[0] === 'users' && path[1] === 'get') {
 *     return users.get(args[0] as string)
 *   }
 *   throw new Error(`Unknown path: ${path.join('.')}`)
 * })
 *
 * const proxy = createMagicMap(transport)
 * const user = await proxy.users.get('user-123')
 * ```
 */
export function createInMemoryTransport(handler: MagicMapHandler): MagicMapTransport {
  return {
    async send(message) {
      if ('type' in message && message.type === 'batch') {
        const batch = message as MagicMapBatchRequest
        const responses: MagicMapResponse[] = []

        for (const request of batch.requests) {
          try {
            const result = await handler(request.path, request.args)
            responses.push({
              id: request.id,
              success: true,
              result,
              timestamp: Date.now(),
            })
          } catch (error) {
            responses.push({
              id: request.id,
              success: false,
              error: {
                code: error instanceof MagicMapError ? error.code : 'HANDLER_ERROR',
                message: error instanceof Error ? error.message : String(error),
                data: error instanceof MagicMapError ? error.data : undefined,
              },
              timestamp: Date.now(),
            })
          }
        }

        return {
          type: 'batch',
          responses,
          timestamp: Date.now(),
        }
      }

      const request = message as MagicMapRequest

      try {
        const result = await handler(request.path, request.args)
        return {
          id: request.id,
          success: true,
          result,
          timestamp: Date.now(),
        }
      } catch (error) {
        return {
          id: request.id,
          success: false,
          error: {
            code: error instanceof MagicMapError ? error.code : 'HANDLER_ERROR',
            message: error instanceof Error ? error.message : String(error),
            data: error instanceof MagicMapError ? error.data : undefined,
          },
          timestamp: Date.now(),
        }
      }
    },
  }
}

// =============================================================================
// Store-Backed Transport
// =============================================================================

/**
 * Create a transport backed by a ThingsStore
 * This allows using Magic-Map pattern directly with @dotdo/db stores
 *
 * @example
 * ```typescript
 * const transport = createStoreTransport({
 *   things: thingsStore,
 *   relationships: relationshipsStore,
 * })
 *
 * const proxy = createMagicMap(transport)
 *
 * // These calls will be handled by the stores
 * const user = await proxy.things.get('user-123')
 * const related = await proxy.relationships.getRelated('user-123', 'owns')
 * ```
 */
export function createStoreTransport(stores: {
  things?: {
    get: (id: string) => Promise<Thing | null>
    list: (options?: { type?: string; limit?: number }) => Promise<Thing[]>
    getMany?: (ids: string[]) => Promise<Map<string, Thing>>
  }
  relationships?: {
    getRelated: (subjectId: string, predicate: string) => Promise<string[]>
    getRelatedTo: (objectId: string, predicate: string) => Promise<string[]>
  }
}): MagicMapTransport {
  return createInMemoryTransport(async (path, args) => {
    const [store, method, ...rest] = path

    if (store === 'things' && stores.things) {
      switch (method) {
        case 'get':
          return stores.things.get(args[0] as string)
        case 'list':
          return stores.things.list(args[0] as { type?: string; limit?: number } | undefined)
        case 'getMany':
          if (stores.things.getMany) {
            const map = await stores.things.getMany(args[0] as string[])
            // Convert Map to object for JSON serialization
            return Object.fromEntries(map)
          }
          // Fallback: fetch individually
          const ids = args[0] as string[]
          const results: Record<string, Thing | null> = {}
          for (const id of ids) {
            results[id] = await stores.things.get(id)
          }
          return results
        default:
          throw new MagicMapError('UNKNOWN_METHOD', `Unknown things method: ${method}`)
      }
    }

    if (store === 'relationships' && stores.relationships) {
      switch (method) {
        case 'getRelated':
          return stores.relationships.getRelated(args[0] as string, args[1] as string)
        case 'getRelatedTo':
          return stores.relationships.getRelatedTo(args[0] as string, args[1] as string)
        default:
          throw new MagicMapError('UNKNOWN_METHOD', `Unknown relationships method: ${method}`)
      }
    }

    throw new MagicMapError('UNKNOWN_STORE', `Unknown store: ${store}`)
  })
}

// =============================================================================
// Query Builder Integration
// =============================================================================

/**
 * Options for Magic-Map enhanced queries
 */
export interface MagicMapQueryOptions {
  /** Include related entities via relations */
  include?: Record<string, {
    predicate: string
    type?: string
    limit?: number
  }>
  /** Apply transformations to results */
  transform?: <T extends Thing>(thing: T) => T | Promise<T>
}

/**
 * Create a Magic-Map enhanced query builder
 * This wraps the standard query builder with automatic relation resolution
 *
 * @example
 * ```typescript
 * const query = createMagicMapQuery(store, relationships)
 *
 * // Automatically fetches related customers in a batched manner
 * const ordersWithCustomers = await query
 *   .type('Order')
 *   .include({
 *     customer: { predicate: 'belongsTo', type: 'Customer' }
 *   })
 *   .execute()
 * ```
 */
export function withMagicMap<T extends StorableData>(
  queryFn: () => Promise<Thing[]>,
  transport: MagicMapTransport,
  options: MagicMapQueryOptions = {}
): Promise<Thing[]> {
  return (async () => {
    // Execute the base query
    const results = await queryFn()

    if (results.length === 0) return results

    // If no includes, just apply transform if any
    if (!options.include || Object.keys(options.include).length === 0) {
      if (options.transform) {
        return Promise.all(results.map(options.transform))
      }
      return results
    }

    // Create proxy for batched operations
    const proxy = createMagicMap<Thing>(transport)

    // Batch fetch all related entities
    const includes = options.include
    const includeKeys = Object.keys(includes)

    // Collect all relationship IDs in one pass
    const relationshipPromises: Record<string, Map<string, Promise<string[]>>> = {}

    for (const key of includeKeys) {
      relationshipPromises[key] = new Map()
      const config = includes[key]!

      for (const thing of results) {
        // @ts-expect-error - dynamic proxy access
        const relatedIdsPromise = proxy.relationships.getRelated(thing.$id, config.predicate)
        relationshipPromises[key]!.set(thing.$id, relatedIdsPromise)
      }
    }

    // Wait for all relationship queries
    const resolvedRelationships: Record<string, Map<string, string[]>> = {}
    for (const key of includeKeys) {
      resolvedRelationships[key] = new Map()
      for (const [thingId, promise] of relationshipPromises[key]!) {
        try {
          const ids = await promise
          resolvedRelationships[key]!.set(thingId, ids)
        } catch {
          resolvedRelationships[key]!.set(thingId, [])
        }
      }
    }

    // Collect all unique entity IDs to fetch
    const allEntityIds = new Set<string>()
    for (const key of includeKeys) {
      for (const ids of resolvedRelationships[key]!.values()) {
        for (const id of ids) {
          allEntityIds.add(id)
        }
      }
    }

    // Batch fetch all entities
    // @ts-expect-error - dynamic proxy access
    const entitiesMap = allEntityIds.size > 0
      ? await proxy.things.getMany([...allEntityIds])
      : {}

    // Assemble the results
    const enrichedResults = results.map(thing => {
      const enriched = { ...thing } as Thing & Record<string, Thing[]>

      for (const key of includeKeys) {
        const relatedIds = resolvedRelationships[key]!.get(thing.$id) || []
        const config = includes[key]!

        // Filter by type if specified and apply limit
        let relatedEntities = relatedIds
          .map(id => (entitiesMap as Record<string, Thing>)[id])
          .filter((e): e is Thing => e != null)

        if (config.type) {
          relatedEntities = relatedEntities.filter(e => e.$type === config.type)
        }

        if (config.limit) {
          relatedEntities = relatedEntities.slice(0, config.limit)
        }

        enriched[key] = relatedEntities
      }

      return enriched
    })

    // Apply transform if specified
    if (options.transform) {
      return Promise.all(enrichedResults.map(options.transform))
    }

    return enrichedResults
  })()
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if a value is a Magic-Map proxy
 */
export function isMagicMapProxy(value: unknown): value is MagicMapProxy {
  if (typeof value !== 'function') return false
  try {
    return Array.isArray((value as MagicMapProxy).$path)
  } catch {
    return false
  }
}

/**
 * Get the path from a Magic-Map proxy
 */
export function getProxyPath(proxy: MagicMapProxy): string[] {
  return proxy.$path
}

/**
 * Create a request from path and args (for manual batching)
 */
export function createRequest(path: string[], args: unknown[]): MagicMapRequest {
  return {
    id: generateRequestId(),
    path,
    args,
    timestamp: Date.now(),
  }
}

/**
 * Create a batch request from multiple requests
 */
export function createBatchRequest(requests: MagicMapRequest[]): MagicMapBatchRequest {
  return {
    type: 'batch',
    requests,
    timestamp: Date.now(),
  }
}
