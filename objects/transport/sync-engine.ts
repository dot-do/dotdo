/**
 * SyncEngine - WebSocket sync server for TanStack DB integration
 *
 * Handles WebSocket connections for real-time data synchronization:
 * - Accept WebSocket connections
 * - Subscribe/unsubscribe to collections
 * - Send initial data on subscribe
 * - Broadcast changes to subscribed clients
 * - Support multiple collections per connection
 * - Clean up on connection close
 *
 * Protocol:
 * - Client -> Server: { type: 'subscribe', collection: string, branch?: string, query?: object }
 * - Client -> Server: { type: 'unsubscribe', collection: string }
 * - Server -> Client: { type: 'initial', collection: string, branch: string | null, items: Thing[], txid: number }
 * - Server -> Client: { type: 'change', collection: string, branch: string | null, txid: number, operation: 'insert' | 'update' | 'delete', thing?: Thing, id?: string }
 */

import type { ThingsStore, ThingEntity } from '../../db/stores'

// ============================================================================
// TYPES
// ============================================================================

export interface SyncThing {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
  branch?: string | null
  createdAt: string
  updatedAt: string
}

export interface SubscribeMessage {
  type: 'subscribe'
  collection: string
  branch?: string | null
  query?: {
    limit?: number
    offset?: number
  }
}

export interface UnsubscribeMessage {
  type: 'unsubscribe'
  collection: string
}

export interface InitialMessage {
  type: 'initial'
  collection: string
  branch: string | null
  items: SyncThing[]
  txid: number
}

export interface InsertMessage {
  type: 'insert'
  collection: string
  branch: string | null
  txid: number
  key: string
  data: SyncThing
}

export interface UpdateMessage {
  type: 'update'
  collection: string
  branch: string | null
  txid: number
  key: string
  data: SyncThing
}

export interface DeleteMessage {
  type: 'delete'
  collection: string
  branch: string | null
  txid: number
  key: string
}

export type ChangeMessage = InsertMessage | UpdateMessage | DeleteMessage

type ClientMessage = SubscribeMessage | UnsubscribeMessage
type ServerMessage = InitialMessage | ChangeMessage

interface Subscription {
  collection: string
  branch: string | null
  query?: {
    limit?: number
    offset?: number
  }
}

interface ConnectionState {
  socket: WebSocket
  subscriptions: Map<string, Subscription>
}

// ============================================================================
// SYNC ENGINE
// ============================================================================

export class SyncEngine {
  private connections: Map<WebSocket, ConnectionState> = new Map()
  private collectionSubscribers: Map<string, Set<WebSocket>> = new Map()
  private thingsStore: ThingsStore

  constructor(thingsStore: ThingsStore) {
    this.thingsStore = thingsStore
  }

  /**
   * Accept a new WebSocket connection
   */
  accept(socket: WebSocket): void {
    const state: ConnectionState = {
      socket,
      subscriptions: new Map(),
    }
    this.connections.set(socket, state)

    // Set up message handler
    socket.addEventListener('message', (event: MessageEvent) => {
      this.handleMessage(socket, event)
    })

    // Set up close handler
    socket.addEventListener('close', () => {
      this.handleClose(socket)
    })

    // Handle error
    socket.addEventListener('error', () => {
      this.handleClose(socket)
    })
  }

  /**
   * Subscribe a socket to a collection
   */
  subscribe(socket: WebSocket, collection: string, branch?: string | null, query?: { limit?: number; offset?: number }): void {
    const state = this.connections.get(socket)
    if (!state) return

    const subscription: Subscription = {
      collection,
      branch: branch ?? null,
      query,
    }

    // Store subscription on connection
    const subscriptionKey = this.getSubscriptionKey(collection, branch ?? null)
    state.subscriptions.set(subscriptionKey, subscription)

    // Add to collection subscribers
    if (!this.collectionSubscribers.has(subscriptionKey)) {
      this.collectionSubscribers.set(subscriptionKey, new Set())
    }
    this.collectionSubscribers.get(subscriptionKey)!.add(socket)
  }

  /**
   * Unsubscribe a socket from a collection
   */
  unsubscribe(socket: WebSocket, collection: string, branch?: string | null): void {
    const state = this.connections.get(socket)
    if (!state) return

    const subscriptionKey = this.getSubscriptionKey(collection, branch ?? null)
    state.subscriptions.delete(subscriptionKey)

    // Remove from collection subscribers
    const subscribers = this.collectionSubscribers.get(subscriptionKey)
    if (subscribers) {
      subscribers.delete(socket)
      if (subscribers.size === 0) {
        this.collectionSubscribers.delete(subscriptionKey)
      }
    }
  }

  /**
   * Send initial state to a socket for a collection
   */
  async sendInitialState(socket: WebSocket, collection: string, branch?: string | null, query?: { limit?: number; offset?: number }): Promise<void> {
    try {
      // Query the things store for items of this collection type
      const items = await this.thingsStore.list({
        type: collection,
        branch: branch ?? undefined,
        limit: query?.limit ?? 100,
        offset: query?.offset ?? 0,
      })

      // Get current txid (max rowid)
      let txid = 0
      if (items.length > 0) {
        // Use the version of the last item as txid approximation
        txid = items.reduce((max, item) => Math.max(max, item.version ?? 0), 0)
      }

      const message: InitialMessage = {
        type: 'initial',
        collection,
        branch: branch ?? null,
        items: items.map((item) => this.thingEntityToSyncThing(item)),
        txid,
      }

      this.sendToSocket(socket, message)
    } catch (error) {
      // Log error but don't fail - send empty initial state
      console.error('[SyncEngine] Error fetching initial state:', error)
      const message: InitialMessage = {
        type: 'initial',
        collection,
        branch: branch ?? null,
        items: [],
        txid: 0,
      }
      this.sendToSocket(socket, message)
    }
  }

  /**
   * Notify when a thing is created
   */
  onThingCreated(thing: SyncThing, rowid: number): void {
    const collection = this.extractCollection(thing.$type)
    const message: InsertMessage = {
      type: 'insert',
      collection,
      branch: thing.branch ?? null,
      txid: rowid,
      key: thing.$id,
      data: thing,
    }
    this.broadcast(collection, thing.branch ?? null, message)
  }

  /**
   * Notify when a thing is updated
   */
  onThingUpdated(thing: SyncThing, rowid: number): void {
    const collection = this.extractCollection(thing.$type)
    const message: UpdateMessage = {
      type: 'update',
      collection,
      branch: thing.branch ?? null,
      txid: rowid,
      key: thing.$id,
      data: thing,
    }
    this.broadcast(collection, thing.branch ?? null, message)
  }

  /**
   * Notify when a thing is deleted
   */
  onThingDeleted(collection: string, id: string, branch: string | null, rowid: number): void {
    const message: DeleteMessage = {
      type: 'delete',
      collection,
      branch,
      txid: rowid,
      key: id,
    }
    this.broadcast(collection, branch, message)
  }

  /**
   * Get the number of active connections
   */
  getActiveConnections(): number {
    return this.connections.size
  }

  /**
   * Get subscribers for a collection
   */
  getSubscribers(collection: string, branch?: string | null): Set<WebSocket> {
    const subscriptionKey = this.getSubscriptionKey(collection, branch ?? null)
    return this.collectionSubscribers.get(subscriptionKey) ?? new Set()
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private handleMessage(socket: WebSocket, event: MessageEvent): void {
    try {
      const data = typeof event.data === 'string' ? event.data : ''
      const message = JSON.parse(data) as ClientMessage

      if (message.type === 'subscribe') {
        this.handleSubscribe(socket, message)
      } else if (message.type === 'unsubscribe') {
        this.handleUnsubscribe(socket, message)
      }
      // Unknown message types are silently ignored
    } catch {
      // Invalid JSON - silently ignore
    }
  }

  private handleSubscribe(socket: WebSocket, message: SubscribeMessage): void {
    this.subscribe(socket, message.collection, message.branch, message.query)
    // Send initial state asynchronously
    this.sendInitialState(socket, message.collection, message.branch, message.query).catch((error) => {
      console.error('[SyncEngine] Error sending initial state:', error)
    })
  }

  private handleUnsubscribe(socket: WebSocket, message: UnsubscribeMessage): void {
    // Find the subscription to get the branch
    const state = this.connections.get(socket)
    if (!state) return

    // Try to unsubscribe from all branches for this collection
    Array.from(state.subscriptions.values()).forEach((sub) => {
      if (sub.collection === message.collection) {
        this.unsubscribe(socket, message.collection, sub.branch)
      }
    })
  }

  private handleClose(socket: WebSocket): void {
    const state = this.connections.get(socket)
    if (!state) return

    // Remove all subscriptions
    Array.from(state.subscriptions.values()).forEach((sub) => {
      const subscriptionKey = this.getSubscriptionKey(sub.collection, sub.branch)
      const subscribers = this.collectionSubscribers.get(subscriptionKey)
      if (subscribers) {
        subscribers.delete(socket)
        if (subscribers.size === 0) {
          this.collectionSubscribers.delete(subscriptionKey)
        }
      }
    })

    // Remove connection
    this.connections.delete(socket)
  }

  private broadcast(collection: string, branch: string | null, message: ChangeMessage): void {
    // Get subscribers for this collection/branch combination
    const subscriptionKey = this.getSubscriptionKey(collection, branch)
    const subscribers = this.collectionSubscribers.get(subscriptionKey)

    if (!subscribers) return

    Array.from(subscribers).forEach((socket) => {
      this.sendToSocket(socket, message)
    })
  }

  private sendToSocket(socket: WebSocket, message: ServerMessage): void {
    try {
      // Check if socket is open (readyState 1 = OPEN)
      if (socket.readyState !== 1) return

      socket.send(JSON.stringify(message))
    } catch {
      // Socket send failed - silently ignore
    }
  }

  private getSubscriptionKey(collection: string, branch: string | null): string {
    return branch ? `${collection}:${branch}` : collection
  }

  private extractCollection(type: string): string {
    // Extract collection name from type URL
    // e.g., 'https://example.com.ai/Task' -> 'Task'
    try {
      const url = new URL(type)
      return url.pathname.slice(1) // Remove leading /
    } catch {
      // Not a URL, use as-is
      return type
    }
  }

  private thingEntityToSyncThing(entity: ThingEntity): SyncThing {
    // ThingEntity doesn't have timestamp fields, so we use current time as default
    const now = new Date().toISOString()
    return {
      $id: entity.$id,
      $type: entity.$type,
      name: entity.name ?? undefined,
      data: entity.data ?? undefined,
      branch: entity.branch ?? null,
      createdAt: now,
      updatedAt: now,
    }
  }
}
