/**
 * TanStack DB Sync Engine
 *
 * Server-side sync engine for handling database synchronization.
 * Manages WebSocket connections and broadcasts changes to subscribed clients.
 */

import type { ChangeMessage, InitialMessage, QueryOptions, SyncThing } from '../protocol'
import { serializeThing, getCollectionFromType } from '../protocol'

/**
 * Interface for the things store that the SyncEngine depends on.
 * This is intentionally minimal - it allows the engine to be used with
 * different storage backends.
 */
export interface ThingsStoreLike {
  list(options: {
    type?: string
    branch?: string | null
    limit?: number
    offset?: number
  }): Promise<SyncThing[]>
  getMaxRowid(options: { type?: string; branch?: string | null }): Promise<number | null>
}

/**
 * SyncEngine handles WebSocket connections and database change broadcasts.
 *
 * Usage:
 * ```typescript
 * const engine = new SyncEngine(thingsStore)
 *
 * // In WebSocket handler
 * engine.accept(socket)
 * engine.subscribe(socket, 'tasks', 'main')
 *
 * // When database changes occur
 * engine.onThingCreated(thing, rowid)
 * engine.onThingUpdated(thing, rowid)
 * engine.onThingDeleted('tasks', 'task-123', null, rowid)
 * ```
 */
export class SyncEngine {
  /** Active WebSocket connections */
  private sockets = new Set<WebSocket>()

  /** Subscription registry: socket -> Map<collection, branch | null> */
  private subscriptions = new Map<WebSocket, Map<string, string | null>>()

  /** Reverse index: collection -> Set<socket> for efficient broadcasts */
  private collectionSubscribers = new Map<string, Set<WebSocket>>()

  /** The things store for fetching initial state */
  private thingsStore: ThingsStoreLike

  constructor(thingsStore: ThingsStoreLike) {
    this.thingsStore = thingsStore
  }

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  /**
   * Accept a new WebSocket connection.
   * Registers the socket and sets up close handling.
   */
  accept(socket: WebSocket): void {
    // Avoid duplicates
    if (this.sockets.has(socket)) {
      return
    }

    this.sockets.add(socket)
    this.subscriptions.set(socket, new Map())

    // Handle socket close
    socket.addEventListener('close', () => {
      this.handleClose(socket)
    })
  }

  /**
   * Handle socket close - clean up all state
   */
  private handleClose(socket: WebSocket): void {
    // Remove from all collection subscriber sets
    const socketSubscriptions = this.subscriptions.get(socket)
    if (socketSubscriptions) {
      for (const collection of socketSubscriptions.keys()) {
        const subscribers = this.collectionSubscribers.get(collection)
        if (subscribers) {
          subscribers.delete(socket)
          if (subscribers.size === 0) {
            this.collectionSubscribers.delete(collection)
          }
        }
      }
    }

    // Clean up socket state
    this.subscriptions.delete(socket)
    this.sockets.delete(socket)
  }

  /**
   * Subscribe a socket to a collection with optional branch filter.
   */
  subscribe(socket: WebSocket, collection: string, branch?: string | null): void {
    const socketSubs = this.subscriptions.get(socket)
    if (!socketSubs) {
      return // Socket not accepted
    }

    // Record the subscription with branch (null if not specified)
    socketSubs.set(collection, branch ?? null)

    // Add to reverse index
    if (!this.collectionSubscribers.has(collection)) {
      this.collectionSubscribers.set(collection, new Set())
    }
    this.collectionSubscribers.get(collection)!.add(socket)
  }

  /**
   * Unsubscribe a socket from a collection.
   */
  unsubscribe(socket: WebSocket, collection: string): void {
    const socketSubs = this.subscriptions.get(socket)
    if (!socketSubs) {
      return
    }

    socketSubs.delete(collection)

    // Update reverse index
    const subscribers = this.collectionSubscribers.get(collection)
    if (subscribers) {
      subscribers.delete(socket)
      if (subscribers.size === 0) {
        this.collectionSubscribers.delete(collection)
      }
    }
  }

  /**
   * Get the number of active connections.
   */
  getActiveConnections(): number {
    return this.sockets.size
  }

  /**
   * Get all sockets subscribed to a collection.
   */
  getSubscribers(collection: string): Set<WebSocket> {
    return this.collectionSubscribers.get(collection) ?? new Set()
  }

  /**
   * Check if a socket is subscribed to a collection.
   */
  isSubscribed(socket: WebSocket, collection: string): boolean {
    const socketSubs = this.subscriptions.get(socket)
    return socketSubs?.has(collection) ?? false
  }

  /**
   * Get the branch filter for a socket's subscription to a collection.
   * Returns:
   * - null: subscribed without branch filter (receives all branches)
   * - string: subscribed with specific branch filter
   * - undefined: not subscribed to this collection
   */
  getSubscriptionBranch(socket: WebSocket, collection: string): string | null | undefined {
    const socketSubs = this.subscriptions.get(socket)
    if (!socketSubs || !socketSubs.has(collection)) {
      return undefined
    }
    return socketSubs.get(collection) ?? null
  }

  // ===========================================================================
  // Broadcast Methods
  // ===========================================================================

  /**
   * Broadcast a thing creation to subscribed clients.
   */
  onThingCreated(thing: SyncThing, rowid: number): void {
    const collection = getCollectionFromType(thing.$type)
    const message: ChangeMessage = {
      type: 'change',
      collection,
      branch: thing.branch ?? null,
      txid: rowid,
      operation: 'insert',
      thing,
    }
    this.broadcastToCollection(collection, thing.branch ?? null, message)
  }

  /**
   * Broadcast a thing update to subscribed clients.
   */
  onThingUpdated(thing: SyncThing, rowid: number): void {
    const collection = getCollectionFromType(thing.$type)
    const message: ChangeMessage = {
      type: 'change',
      collection,
      branch: thing.branch ?? null,
      txid: rowid,
      operation: 'update',
      thing,
    }
    this.broadcastToCollection(collection, thing.branch ?? null, message)
  }

  /**
   * Broadcast a thing deletion to subscribed clients.
   */
  onThingDeleted(collection: string, id: string, branch: string | null, rowid: number): void {
    const message: ChangeMessage = {
      type: 'change',
      collection,
      branch,
      txid: rowid,
      operation: 'delete',
      id,
    }
    this.broadcastToCollection(collection, branch, message)
  }

  /**
   * Broadcast a message to all subscribers of a collection,
   * respecting branch filters.
   */
  private broadcastToCollection(
    collection: string,
    branch: string | null,
    message: ChangeMessage
  ): void {
    const subscribers = this.collectionSubscribers.get(collection)
    if (!subscribers) {
      return
    }

    for (const socket of subscribers) {
      const subscribedBranch = this.getSubscriptionBranch(socket, collection)

      // Skip if socket is filtered to a different branch
      if (subscribedBranch !== null && subscribedBranch !== branch) {
        continue
      }

      this.sendToSocket(socket, message)
    }
  }

  /**
   * Send a message to a socket.
   */
  private sendToSocket(socket: WebSocket, message: ChangeMessage | InitialMessage): void {
    try {
      // Only send if socket is open (readyState === 1)
      if (socket.readyState === 1) {
        socket.send(JSON.stringify(message))
      }
    } catch {
      // Socket may have closed; ignore errors
    }
  }

  // ===========================================================================
  // Initial State
  // ===========================================================================

  /**
   * Send initial state for a collection to a socket.
   */
  async sendInitialState(
    socket: WebSocket,
    collection: string,
    branch?: string | null,
    query?: QueryOptions
  ): Promise<void> {
    // Fetch items from store
    const items = await this.thingsStore.list({
      type: collection,
      branch: branch ?? null,
      limit: query?.limit,
      offset: query?.offset,
    })

    // Get max rowid for this collection/branch
    const maxRowid = await this.thingsStore.getMaxRowid({
      type: collection,
      branch: branch ?? null,
    })

    const message: InitialMessage = {
      type: 'initial',
      collection,
      branch: branch ?? null,
      items,
      txid: maxRowid ?? 0,
    }

    this.sendToSocket(socket, message)
  }
}
