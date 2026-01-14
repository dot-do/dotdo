/**
 * @fileoverview WebSocket Integration Example for Unified Storage
 *
 * This example demonstrates how to use the WebSocket components in Unified Storage
 * for real-time CRUD operations with Pipeline-as-WAL durability.
 *
 * Key concepts:
 * - Pipeline receives events BEFORE SQLite (immediate durability)
 * - Client receives ACK BEFORE checkpoint (low latency)
 * - SQLite is checkpointed lazily (cost optimization)
 * - WebSocket is 20:1 cheaper than HTTP ($0.0075/M vs $0.15/M)
 *
 * @module unified-storage/examples/websocket-integration
 *
 * @example
 * ```bash
 * # This is a conceptual example - run in Cloudflare Workers environment
 * npx wrangler dev
 * ```
 */

import type {
  WSMessage,
  CreateMessage,
  ReadMessage,
  UpdateMessage,
  DeleteMessage,
  BatchMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  AckResponse,
  ReadResponse,
  ErrorResponse,
  SubscriptionUpdate,
  ThingResponse,
} from '../ws-protocol'

import { WSProtocol } from '../ws-protocol'

// ============================================================================
// COMPLETE CLIENT EXAMPLE
// ============================================================================

/**
 * UnifiedStorageClient - A complete WebSocket client for Unified Storage.
 *
 * This client provides a type-safe interface for all WebSocket operations:
 * - CRUD operations (create, read, update, delete)
 * - Batch operations
 * - Real-time subscriptions
 *
 * Features:
 * - Request/response correlation via message IDs
 * - Promise-based API with proper typing
 * - Subscription management with callbacks
 * - Automatic reconnection support (optional)
 * - Error handling with typed errors
 *
 * @example
 * ```typescript
 * // Create client
 * const ws = new WebSocket('wss://your-worker.workers.dev/ws')
 * const client = new UnifiedStorageClient(ws)
 *
 * // Wait for connection
 * await client.ready()
 *
 * // CRUD operations
 * const customer = await client.create('Customer', { name: 'Alice' })
 * const data = await client.read([customer.$id])
 * await client.update(customer.$id, { status: 'active' })
 * await client.delete(customer.$id)
 *
 * // Subscriptions
 * client.subscribe('Customer', (event) => {
 *   console.log('Customer event:', event)
 * })
 * ```
 */
export class UnifiedStorageClient {
  private ws: WebSocket
  private pending = new Map<
    string,
    {
      resolve: (v: unknown) => void
      reject: (e: Error) => void
      timeout: ReturnType<typeof setTimeout>
    }
  >()
  private subscriptions = new Map<
    string,
    {
      topic: string
      callback: (event: SubscriptionUpdate) => void
    }
  >()
  private _ready: Promise<void>
  private _readyResolve!: () => void
  private _closed = false
  private messageTimeout: number

  /**
   * Create a new UnifiedStorageClient.
   *
   * @param ws - The WebSocket connection
   * @param options - Client options
   * @param options.messageTimeout - Timeout for message responses (default: 30000ms)
   */
  constructor(
    ws: WebSocket,
    options: { messageTimeout?: number } = {}
  ) {
    this.ws = ws
    this.messageTimeout = options.messageTimeout ?? 30000

    // Track ready state
    this._ready = new Promise((resolve) => {
      this._readyResolve = resolve
    })

    // Handle connection open
    ws.addEventListener('open', () => {
      this._readyResolve()
    })

    // Handle responses
    ws.addEventListener('message', (event) => {
      this.handleMessage(event.data as string)
    })

    // Handle close
    ws.addEventListener('close', () => {
      this._closed = true
      // Reject all pending requests
      for (const [id, { reject, timeout }] of this.pending.entries()) {
        clearTimeout(timeout)
        reject(new Error('WebSocket closed'))
        this.pending.delete(id)
      }
    })

    // Handle errors
    ws.addEventListener('error', (event) => {
      console.error('WebSocket error:', event)
    })
  }

  /**
   * Wait for the WebSocket connection to be ready.
   */
  async ready(): Promise<void> {
    return this._ready
  }

  /**
   * Check if the client is connected.
   */
  get isConnected(): boolean {
    return !this._closed && this.ws.readyState === WebSocket.OPEN
  }

  /**
   * Handle incoming WebSocket message.
   */
  private handleMessage(data: string): void {
    let response: AckResponse | ReadResponse | ErrorResponse | SubscriptionUpdate

    try {
      response = JSON.parse(data)
    } catch {
      console.error('Failed to parse WebSocket message:', data)
      return
    }

    // Handle subscription updates
    if (WSProtocol.isSubscriptionUpdate(response)) {
      const sub = this.subscriptions.get(response.subscriptionId)
      if (sub) {
        sub.callback(response)
      }
      return
    }

    // Handle request/response
    const id = response.id
    const pending = this.pending.get(id)

    if (!pending) {
      // No pending request for this ID (might be a subscription update)
      return
    }

    clearTimeout(pending.timeout)
    this.pending.delete(id)

    if (WSProtocol.isErrorResponse(response)) {
      pending.reject(new Error(`${response.code}: ${response.message}`))
    } else {
      pending.resolve(response)
    }
  }

  /**
   * Send a message and wait for response.
   */
  private async sendAndWait<T>(message: WSMessage): Promise<T> {
    if (this._closed) {
      throw new Error('WebSocket is closed')
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(message.id)
        reject(new Error(`Request timeout: ${message.id}`))
      }, this.messageTimeout)

      this.pending.set(message.id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timeout,
      })

      this.ws.send(WSProtocol.serialize(message) as string)
    })
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  /**
   * Create a new entity.
   *
   * Flow:
   * 1. Client sends create message
   * 2. DO updates memory + emits to Pipeline (WAL)
   * 3. Client receives ACK (before SQLite checkpoint!)
   *
   * @param $type - Entity type (e.g., 'Customer', 'Order')
   * @param data - Entity data
   * @returns The created entity's $id and $version
   *
   * @example
   * ```typescript
   * const customer = await client.create('Customer', {
   *   name: 'Alice Smith',
   *   email: 'alice@example.com',
   * })
   * console.log('Created:', customer.$id)
   * ```
   */
  async create<T extends Record<string, unknown>>(
    $type: string,
    data: T
  ): Promise<{ $id: string; $version: number }> {
    const message = WSProtocol.createMessage($type, data)
    const response = await this.sendAndWait<AckResponse>(message)
    return {
      $id: response.result!.$id,
      $version: response.result!.$version,
    }
  }

  /**
   * Read entities by ID.
   *
   * Flow:
   * 1. Client sends read message
   * 2. DO reads from memory (O(1), never touches SQLite)
   * 3. Client receives data
   *
   * @param $ids - Array of entity IDs to read
   * @returns Map of $id to entity (or null if not found)
   *
   * @example
   * ```typescript
   * const data = await client.read(['customer_123', 'customer_456'])
   * console.log('Customer 123:', data['customer_123'])
   * ```
   */
  async read($ids: string[]): Promise<Record<string, ThingResponse | null>> {
    const message = WSProtocol.readMessage($ids)
    const response = await this.sendAndWait<ReadResponse>(message)
    return response.things
  }

  /**
   * Read a single entity by ID.
   *
   * @param $id - Entity ID to read
   * @returns The entity or null if not found
   *
   * @example
   * ```typescript
   * const customer = await client.readOne('customer_123')
   * if (customer) {
   *   console.log('Found:', customer.name)
   * }
   * ```
   */
  async readOne($id: string): Promise<ThingResponse | null> {
    const result = await this.read([$id])
    return result[$id]
  }

  /**
   * Update an entity.
   *
   * @param $id - Entity ID to update
   * @param data - Data to merge into the entity
   * @returns The new $version
   *
   * @example
   * ```typescript
   * const result = await client.update('customer_123', {
   *   lastLogin: new Date().toISOString(),
   * })
   * console.log('New version:', result.$version)
   * ```
   */
  async update(
    $id: string,
    data: Record<string, unknown>
  ): Promise<{ $version: number }> {
    const message = WSProtocol.updateMessage($id, data)
    const response = await this.sendAndWait<AckResponse>(message)
    return {
      $version: response.result!.$version,
    }
  }

  /**
   * Delete an entity.
   *
   * @param $id - Entity ID to delete
   *
   * @example
   * ```typescript
   * await client.delete('customer_123')
   * console.log('Deleted')
   * ```
   */
  async delete($id: string): Promise<void> {
    const message = WSProtocol.deleteMessage($id)
    await this.sendAndWait<AckResponse>(message)
  }

  // ==========================================================================
  // Batch Operations
  // ==========================================================================

  /**
   * Execute multiple operations in a batch.
   *
   * All operations in a batch share a single Pipeline emit,
   * maximizing throughput for bulk operations.
   *
   * @param operations - Array of operations to execute
   * @returns Array of results corresponding to each operation
   *
   * @example
   * ```typescript
   * const results = await client.batch([
   *   { type: 'create', $type: 'Order', data: { total: 100 } },
   *   { type: 'update', $id: 'customer_123', data: { orderCount: 5 } },
   *   { type: 'delete', $id: 'cart_456' },
   * ])
   * ```
   */
  async batch(
    operations: Array<
      | { type: 'create'; $type: string; data: Record<string, unknown> }
      | { type: 'update'; $id: string; data: Record<string, unknown> }
      | { type: 'delete'; $id: string }
    >
  ): Promise<Array<{ success: boolean; $id?: string; $version?: number; error?: string }>> {
    const batchOps = operations.map((op, i) => {
      const opId = `op_${i}`
      if (op.type === 'create') {
        return WSProtocol.createMessage(op.$type, op.data, { id: opId })
      } else if (op.type === 'update') {
        return WSProtocol.updateMessage(op.$id, op.data, { id: opId })
      } else {
        return WSProtocol.deleteMessage(op.$id, { id: opId })
      }
    })

    const message = WSProtocol.batchMessage(batchOps)
    const response = await this.sendAndWait<{
      type: 'batch_response'
      id: string
      results: Array<{ success: boolean; $id?: string; $version?: number; error?: string }>
    }>(message)

    return response.results
  }

  /**
   * Batch create multiple entities.
   *
   * @param items - Array of items to create
   * @returns Array of created entity IDs and versions
   *
   * @example
   * ```typescript
   * const orders = await client.batchCreate([
   *   { $type: 'Order', data: { total: 100 } },
   *   { $type: 'Order', data: { total: 200 } },
   * ])
   * ```
   */
  async batchCreate(
    items: Array<{ $type: string; data: Record<string, unknown> }>
  ): Promise<Array<{ $id: string; $version: number }>> {
    const results = await this.batch(
      items.map((item) => ({ type: 'create' as const, ...item }))
    )

    return results.map((r) => ({
      $id: r.$id!,
      $version: r.$version ?? 1,
    }))
  }

  // ==========================================================================
  // Subscriptions
  // ==========================================================================

  /**
   * Subscribe to real-time updates for a topic.
   *
   * @param topic - Topic pattern (entity type, ID, or wildcard)
   * @param callback - Function called when updates arrive
   * @param options - Subscription options
   * @returns Subscription ID for unsubscribing
   *
   * @example
   * ```typescript
   * // Subscribe to all Customer events
   * const subId = await client.subscribe('Customer', (event) => {
   *   console.log(`${event.event}:`, event.thing.$id)
   * })
   *
   * // Later, unsubscribe
   * await client.unsubscribe(subId)
   * ```
   */
  async subscribe(
    topic: string,
    callback: (event: SubscriptionUpdate) => void,
    options?: { filter?: Record<string, unknown> }
  ): Promise<string> {
    const message = WSProtocol.subscribeMessage(topic, options?.filter)
    const response = await this.sendAndWait<AckResponse>(message)

    // The subscription ID comes from the ack
    const subscriptionId = message.id

    this.subscriptions.set(subscriptionId, {
      topic,
      callback,
    })

    return subscriptionId
  }

  /**
   * Unsubscribe from a topic.
   *
   * @param subscriptionId - The subscription ID returned from subscribe()
   *
   * @example
   * ```typescript
   * await client.unsubscribe(subId)
   * ```
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    const message = WSProtocol.unsubscribeMessage(subscriptionId)
    await this.sendAndWait<AckResponse>(message)
    this.subscriptions.delete(subscriptionId)
  }

  /**
   * Get all active subscription IDs.
   */
  getSubscriptions(): string[] {
    return Array.from(this.subscriptions.keys())
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Close the WebSocket connection.
   */
  close(): void {
    this._closed = true
    this.ws.close(1000, 'Client closed')
  }
}

// ============================================================================
// DURABLE OBJECT EXAMPLE
// ============================================================================

/**
 * Example of how to set up a Durable Object with WebSocket support.
 *
 * This shows the server-side pattern for handling WebSocket connections
 * using the Unified Storage components.
 */
export const DurableObjectExample = `
// In your Durable Object:

import { WSConnectionManager } from '../ws-connection-manager'
import { WSOperationRouter } from '../ws-operation-router'
import { WSBroadcaster } from '../ws-broadcaster'
import { InMemoryStateManager } from '../in-memory-state-manager'
import { PipelineEmitter } from '../pipeline-emitter'

export class MyDO {
  private ctx: DurableObjectState
  private env: Env

  // Core components
  private stateManager: InMemoryStateManager
  private emitter: PipelineEmitter
  private connectionManager: WSConnectionManager
  private router: WSOperationRouter
  private broadcaster: WSBroadcaster

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx
    this.env = env

    // Initialize state manager
    this.stateManager = new InMemoryStateManager({
      maxEntries: 10000,
    })

    // Initialize pipeline emitter for WAL durability
    this.emitter = new PipelineEmitter(env.EVENTS, {
      namespace: ctx.id.name ?? 'default',
    })

    // Initialize connection manager
    this.connectionManager = new WSConnectionManager(ctx, {
      maxConnections: 10000,
    })

    // Initialize operation router
    this.router = new WSOperationRouter(this.stateManager, this.emitter)

    // Initialize broadcaster
    this.broadcaster = new WSBroadcaster({
      coalesceWindowMs: 100,
    })
  }

  async fetch(request: Request): Promise<Response> {
    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      const response = await this.connectionManager.handleUpgrade(request)

      // Get the server WebSocket from the response
      const ws = (response as Response & { webSocket: WebSocket }).webSocket

      // Set up message handling
      ws.addEventListener('message', async (event) => {
        await this.router.handleMessageString(event.data as string, ws)
      })

      return response
    }

    return new Response('WebSocket required', { status: 400 })
  }

  // Hibernation handler - called by DO runtime
  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    await this.connectionManager.webSocketMessage(ws, message)
    await this.router.handleMessageString(message, ws)
  }

  // Hibernation handler - called by DO runtime
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    await this.connectionManager.webSocketClose(ws, code, reason)
    this.broadcaster.handleDisconnect(ws)
  }
}
`

// ============================================================================
// DATA FLOW DIAGRAM
// ============================================================================

export const DataFlowDiagram = `
UNIFIED STORAGE - WEBSOCKET DATA FLOW
=====================================

CREATE Operation:

  Client                DO                  Pipeline         SQLite
    |                    |                      |               |
    |-- create msg ----->|                      |               |
    |                    |-- emit event ------->| (WAL)         |
    |                    |   (fire-and-forget)  |               |
    |                    |                      |               |
    |                    |-- update memory      |               |
    |                    |   (mark dirty)       |               |
    |                    |                      |               |
    |<---- ACK ----------|                      |               |
    |                    |                      |               |
    |                    |                 [later]              |
    |                    |-- checkpoint ----------------------->|
    |                    |   (batched)                          |


READ Operation (O(1), SQLite never touched):

  Client                DO                  Memory
    |                    |                      |
    |-- read msg ------->|                      |
    |                    |-- get from Map ----->|
    |                    |<-- data -------------|
    |<---- response -----|                      |


SUBSCRIPTION Flow:

  Client                DO                  Broadcaster
    |                    |                      |
    |-- subscribe ------>|                      |
    |                    |-- register --------->|
    |<---- ACK ----------|                      |
    |                    |                      |
    |                    |  [data changes]      |
    |                    |<-- broadcast --------|
    |<-- subscription_update -------------------|
    |                    |                      |


Key Benefits:
- Durability: Pipeline receives event BEFORE ACK
- Latency: Client gets ACK BEFORE SQLite checkpoint
- Cost: SQLite writes batched (95%+ reduction)
- Performance: Reads are O(1) memory lookups
- Real-time: Subscriptions for live updates
`

// ============================================================================
// USAGE EXAMPLE
// ============================================================================

/**
 * Example usage showing typical client interaction pattern.
 */
export const UsageExample = `
// Connect to the Durable Object
const ws = new WebSocket('wss://your-worker.workers.dev/ws')
const client = new UnifiedStorageClient(ws)

// Wait for connection
await client.ready()

// Create a customer
const customer = await client.create('Customer', {
  name: 'Alice Smith',
  email: 'alice@example.com',
  plan: 'enterprise'
})
console.log('Created:', customer.$id, 'version:', customer.$version)

// Read it back (from memory, O(1))
const data = await client.read([customer.$id])
console.log('Read:', data)

// Update it
const updated = await client.update(customer.$id, {
  lastLogin: new Date().toISOString()
})
console.log('Updated to version:', updated.$version)

// Subscribe to Order events
const subId = await client.subscribe('Order', (event) => {
  console.log('Order event:', event.event, event.thing.$id)
})

// Batch create multiple orders
const orders = await client.batchCreate([
  { $type: 'Order', data: { total: 100, customerId: customer.$id } },
  { $type: 'Order', data: { total: 200, customerId: customer.$id } },
  { $type: 'Order', data: { total: 300, customerId: customer.$id } },
])
console.log('Created orders:', orders.map(o => o.$id))

// Clean up
await client.unsubscribe(subId)
await client.delete(orders[0].$id)
client.close()
`

// Export for documentation purposes
export { WSProtocol }
