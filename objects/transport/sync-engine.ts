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
import type { UserContext } from '../../types/WorkflowContext'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Heartbeat ping interval in milliseconds (30 seconds) */
const HEARTBEAT_INTERVAL_MS = 30000

/** Connection timeout - max time to wait for pong response (45 seconds) */
const CONNECTION_TIMEOUT_MS = 45000

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

export interface PongMessage {
  type: 'pong'
  timestamp: number
}

export interface PingMessage {
  type: 'ping'
  timestamp: number
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

type ClientMessage = SubscribeMessage | UnsubscribeMessage | PongMessage
type ServerMessage = InitialMessage | ChangeMessage | PingMessage

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
  user?: UserContext
  /** Last time a pong was received or connection was established */
  lastPongAt: number
  /** Pending ping timestamp waiting for pong */
  pendingPingTimestamp: number | null
  /** Connection established time */
  connectedAt: number
}

/**
 * Connection metrics for monitoring
 */
export interface ConnectionMetrics {
  /** Number of active connections */
  activeConnections: number
  /** Map of collection -> subscriber count */
  subscriptionsByCollection: Map<string, number>
  /** Total subscriptions across all connections */
  totalSubscriptions: number
}

/**
 * Connection state events
 */
export type ConnectionStateEvent =
  | { type: 'connected'; socketId: string }
  | { type: 'disconnected'; socketId: string; reason: 'close' | 'timeout' | 'error' }
  | { type: 'timeout'; socketId: string; lastPongAge: number }

// ============================================================================
// SYNC ENGINE
// ============================================================================

export class SyncEngine {
  private connections: Map<WebSocket, ConnectionState> = new Map()
  private collectionSubscribers: Map<string, Set<WebSocket>> = new Map()
  private thingsStore: ThingsStore
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private connectionStateListeners: Set<(event: ConnectionStateEvent) => void> = new Set()
  private socketIdCounter = 0

  constructor(thingsStore: ThingsStore) {
    this.thingsStore = thingsStore
  }

  /**
   * Start the heartbeat interval for checking connection health
   * Call this when the SyncEngine is ready to manage connections
   */
  startHeartbeat(): void {
    if (this.heartbeatInterval) return

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeats()
      this.checkTimeouts()
    }, HEARTBEAT_INTERVAL_MS)
  }

  /**
   * Stop the heartbeat interval
   * Call this during cleanup/shutdown
   */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  /**
   * Register a listener for connection state events
   */
  onConnectionState(listener: (event: ConnectionStateEvent) => void): () => void {
    this.connectionStateListeners.add(listener)
    return () => {
      this.connectionStateListeners.delete(listener)
    }
  }

  /**
   * Get connection metrics for monitoring
   */
  getMetrics(): ConnectionMetrics {
    const subscriptionsByCollection = new Map<string, number>()
    let totalSubscriptions = 0

    for (const [key, subscribers] of this.collectionSubscribers) {
      subscriptionsByCollection.set(key, subscribers.size)
      totalSubscriptions += subscribers.size
    }

    return {
      activeConnections: this.connections.size,
      subscriptionsByCollection,
      totalSubscriptions,
    }
  }

  private emitConnectionState(event: ConnectionStateEvent): void {
    for (const listener of this.connectionStateListeners) {
      try {
        listener(event)
      } catch {
        // Ignore callback errors
      }
    }
  }

  private sendHeartbeats(): void {
    const now = Date.now()
    const pingMessage: PingMessage = {
      type: 'ping',
      timestamp: now,
    }

    for (const [socket, state] of this.connections) {
      // Only send ping if no pending ping is waiting for a response
      if (state.pendingPingTimestamp === null) {
        state.pendingPingTimestamp = now
        this.sendToSocket(socket, pingMessage)
      }
    }
  }

  private checkTimeouts(): void {
    const now = Date.now()
    const socketsToClose: WebSocket[] = []

    for (const [socket, state] of this.connections) {
      const lastPongAge = now - state.lastPongAt
      if (lastPongAge > CONNECTION_TIMEOUT_MS) {
        socketsToClose.push(socket)
        const socketId = this.getSocketId(socket)
        this.emitConnectionState({
          type: 'timeout',
          socketId,
          lastPongAge,
        })
      }
    }

    // Close timed-out connections
    for (const socket of socketsToClose) {
      const socketId = this.getSocketId(socket)
      this.handleClose(socket, 'timeout')
      try {
        socket.close(4000, 'Connection timeout')
      } catch {
        // Socket may already be closed
      }
      this.emitConnectionState({
        type: 'disconnected',
        socketId,
        reason: 'timeout',
      })
    }
  }

  private getSocketId(socket: WebSocket): string {
    // Use the socket object's identity for tracking
    const state = this.connections.get(socket)
    if (state) {
      return `conn-${state.connectedAt}`
    }
    return `unknown-${this.socketIdCounter++}`
  }

  private handlePong(socket: WebSocket, message: PongMessage): void {
    const state = this.connections.get(socket)
    if (!state) return

    state.lastPongAt = Date.now()
    state.pendingPingTimestamp = null
  }

  /**
   * Accept a new WebSocket connection
   * @param socket - The WebSocket connection to accept
   * @param user - Optional user context from authentication
   */
  accept(socket: WebSocket, user?: UserContext): void {
    const now = Date.now()
    const state: ConnectionState = {
      socket,
      subscriptions: new Map(),
      user,
      lastPongAt: now,
      pendingPingTimestamp: null,
      connectedAt: now,
    }
    this.connections.set(socket, state)

    const socketId = this.getSocketId(socket)
    this.emitConnectionState({ type: 'connected', socketId })

    // Set up message handler
    socket.addEventListener('message', (event: MessageEvent) => {
      this.handleMessage(socket, event)
    })

    // Set up close handler
    socket.addEventListener('close', () => {
      this.handleClose(socket, 'close')
    })

    // Handle error
    socket.addEventListener('error', () => {
      this.handleClose(socket, 'error')
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

  /**
   * Get the user context associated with a WebSocket connection
   * @param socket - The WebSocket connection
   * @returns The user context or null if not found
   */
  getConnectionUser(socket: WebSocket): UserContext | null {
    const state = this.connections.get(socket)
    return state?.user ?? null
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
      } else if (message.type === 'pong') {
        this.handlePong(socket, message)
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

  private handleClose(socket: WebSocket, reason: 'close' | 'timeout' | 'error' = 'close'): void {
    const state = this.connections.get(socket)
    if (!state) return

    const socketId = this.getSocketId(socket)

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

    // Emit disconnected event (but not if it's a timeout since checkTimeouts() already emitted it)
    if (reason !== 'timeout') {
      this.emitConnectionState({
        type: 'disconnected',
        socketId,
        reason,
      })
    }
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
