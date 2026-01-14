/**
 * @fileoverview WebSocket Integration Example for Unified Storage
 *
 * This example demonstrates how UnifiedStoreDO handles WebSocket messages
 * for real-time CRUD operations with Pipeline-as-WAL durability.
 *
 * Key concepts:
 * - Pipeline receives events BEFORE SQLite (immediate durability)
 * - Client receives ACK BEFORE checkpoint (low latency)
 * - SQLite is checkpointed lazily (cost optimization)
 *
 * @example
 * ```bash
 * # This is a conceptual example - run in Cloudflare Workers environment
 * npx wrangler dev
 * ```
 */

// ============================================================================
// TYPES (WebSocket Protocol)
// ============================================================================

/**
 * WebSocket message types for Unified Storage
 */
type WSMessage =
  | CreateMessage
  | ReadMessage
  | UpdateMessage
  | DeleteMessage
  | BatchMessage

interface CreateMessage {
  type: 'create'
  id: string // Request correlation ID
  $type: string // Entity type (e.g., 'Customer')
  data: Record<string, unknown>
}

interface ReadMessage {
  type: 'read'
  id: string
  $ids: string[] // IDs to read
}

interface UpdateMessage {
  type: 'update'
  id: string
  $id: string // Entity ID to update
  data: Record<string, unknown>
}

interface DeleteMessage {
  type: 'delete'
  id: string
  $id: string
}

interface BatchMessage {
  type: 'batch'
  id: string
  operations: Array<{
    type: 'create'
    id: string
    $type: string
    data: Record<string, unknown>
  }>
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

interface AckResponse {
  status: 'ack'
  id: string // Correlation ID
  $id: string
  $version: number
}

interface ReadResponse {
  id: string
  things: Record<string, unknown>
}

interface ErrorResponse {
  status: 'error'
  id: string
  error: string
}

// ============================================================================
// EXAMPLE: CLIENT-SIDE WEBSOCKET USAGE
// ============================================================================

/**
 * Example client-side WebSocket wrapper for Unified Storage.
 *
 * This shows how a client would interact with UnifiedStoreDO via WebSocket.
 */
class UnifiedStorageClient {
  private ws: WebSocket
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private messageId = 0

  constructor(ws: WebSocket) {
    this.ws = ws

    // Handle responses
    ws.addEventListener('message', (event) => {
      const response = JSON.parse(event.data as string)
      const pending = this.pending.get(response.id)
      if (pending) {
        this.pending.delete(response.id)
        if (response.status === 'error') {
          pending.reject(new Error(response.error))
        } else {
          pending.resolve(response)
        }
      }
    })
  }

  /**
   * Create an entity
   *
   * Flow:
   * 1. Client sends create message
   * 2. DO updates memory + emits to Pipeline (WAL)
   * 3. Client receives ACK (before SQLite checkpoint!)
   */
  async create<T extends Record<string, unknown>>(
    $type: string,
    data: T
  ): Promise<{ $id: string; $version: number }> {
    const id = String(++this.messageId)

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })

      const message: CreateMessage = {
        type: 'create',
        id,
        $type,
        data,
      }

      this.ws.send(JSON.stringify(message))
    })
  }

  /**
   * Read entities by ID (batch)
   *
   * Flow:
   * 1. Client sends read message
   * 2. DO reads from memory (O(1), never touches SQLite)
   * 3. Client receives data
   */
  async read($ids: string[]): Promise<Record<string, unknown>> {
    const id = String(++this.messageId)

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })

      const message: ReadMessage = {
        type: 'read',
        id,
        $ids,
      }

      this.ws.send(JSON.stringify(message))
    })
  }

  /**
   * Update an entity
   */
  async update(
    $id: string,
    data: Record<string, unknown>
  ): Promise<{ $id: string; $version: number }> {
    const id = String(++this.messageId)

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })

      const message: UpdateMessage = {
        type: 'update',
        id,
        $id,
        data,
      }

      this.ws.send(JSON.stringify(message))
    })
  }

  /**
   * Delete an entity
   */
  async delete($id: string): Promise<void> {
    const id = String(++this.messageId)

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })

      const message: DeleteMessage = {
        type: 'delete',
        id,
        $id,
      }

      this.ws.send(JSON.stringify(message))
    })
  }

  /**
   * Batch create multiple entities
   *
   * All operations in a batch share a single Pipeline emit,
   * maximizing throughput for bulk operations.
   */
  async batchCreate(
    items: Array<{ $type: string; data: Record<string, unknown> }>
  ): Promise<Array<{ $id: string; $version: number }>> {
    const id = String(++this.messageId)

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })

      const message: BatchMessage = {
        type: 'batch',
        id,
        operations: items.map((item, i) => ({
          type: 'create' as const,
          id: `${id}_${i}`,
          $type: item.$type,
          data: item.data,
        })),
      }

      this.ws.send(JSON.stringify(message))
    })
  }
}

// ============================================================================
// EXAMPLE: DURABLE OBJECT HANDLER
// ============================================================================

/**
 * Example of how UnifiedStoreDO processes WebSocket messages.
 *
 * This is a simplified version showing the key pattern:
 * Pipeline-first, ACK-before-checkpoint.
 */
const exampleDOHandler = `
// In your Durable Object:

import { UnifiedStoreDO } from './unified-store-do'

export class MyDO {
  private store: UnifiedStoreDO

  constructor(state: DurableObjectState, env: Env) {
    this.store = new UnifiedStoreDO(state, env, {
      namespace: state.id.name ?? 'default',
      checkpointInterval: 5000,    // Lazy checkpoint every 5s
      dirtyCountThreshold: 100,    // Or at 100 dirty entries
    })
  }

  async fetch(request: Request): Promise<Response> {
    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)

      server.accept()

      server.addEventListener('message', async (event) => {
        const msg = JSON.parse(event.data as string)

        // Route to appropriate handler
        switch (msg.type) {
          case 'create':
            // 1. Emit to Pipeline (immediate durability)
            // 2. Update memory
            // 3. Send ACK (before SQLite!)
            await this.store.handleCreate(server, msg)
            break

          case 'read':
            // Read from memory only (O(1), SQLite never touched)
            await this.store.handleRead(server, msg)
            break

          case 'update':
            await this.store.handleUpdate(server, msg)
            break

          case 'delete':
            await this.store.handleDelete(server, msg)
            break

          case 'batch':
            await this.store.handleBatch(server, msg)
            break
        }
      })

      return new Response(null, { status: 101, webSocket: client })
    }

    return new Response('WebSocket required', { status: 400 })
  }

  // Called before hibernation - flush all dirty state
  async beforeHibernation() {
    await this.store.beforeHibernation()
  }
}
`

// ============================================================================
// EXAMPLE: CLIENT USAGE PATTERN
// ============================================================================

/**
 * Example usage showing typical client interaction pattern.
 */
const exampleClientUsage = `
// Connect to the Durable Object
const ws = new WebSocket('wss://your-worker.workers.dev/ws')

await new Promise(resolve => {
  ws.onopen = resolve
})

const client = new UnifiedStorageClient(ws)

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

// Batch create multiple items
const orders = await client.batchCreate([
  { $type: 'Order', data: { total: 100, customerId: customer.$id } },
  { $type: 'Order', data: { total: 200, customerId: customer.$id } },
  { $type: 'Order', data: { total: 300, customerId: customer.$id } },
])
console.log('Created orders:', orders.map(o => o.$id))

// Delete
await client.delete(orders[0].$id)
console.log('Deleted first order')
`

// ============================================================================
// DATA FLOW DIAGRAM
// ============================================================================

const dataFlowDiagram = `
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


Key Benefits:
- Durability: Pipeline receives event BEFORE ACK
- Latency: Client gets ACK BEFORE SQLite checkpoint
- Cost: SQLite writes batched (95%+ reduction)
- Performance: Reads are O(1) memory lookups
`

console.log('=== WebSocket Integration Example ===')
console.log('')
console.log('This file demonstrates the WebSocket protocol for UnifiedStoreDO.')
console.log('')
console.log(dataFlowDiagram)
console.log('')
console.log('--- Example DO Handler ---')
console.log(exampleDOHandler)
console.log('')
console.log('--- Example Client Usage ---')
console.log(exampleClientUsage)
