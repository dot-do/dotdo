/**
 * SyncEngine Primitive - Real-time WebSocket sync for TanStack DB integration
 *
 * This module provides a complete sync infrastructure for bridging
 * Durable Object state with TanStack DB clients:
 *
 * - SyncEngine: Server-side WebSocket sync orchestration
 * - SyncClient: Client-side WebSocket sync state management
 * - ThingsCollection: Collection with CRUD methods and sync integration
 * - dotdoCollectionOptions: TanStack DB collection options factory
 *
 * Architecture:
 * ```
 * Client (React)                      Server (DO)
 * ─────────────────                   ──────────────
 * @tanstack/db                        DOBase
 *   └── useLiveQuery()                ├── /sync WebSocket → SyncEngine
 *        └── collection               │    └── subscribe/unsubscribe
 *             ├── sync: WebSocket     ├── /rpc Cap'n Web → Collection RPC
 *             └── mutations: RPC      └── ThingsStore → SyncEngine.broadcast()
 * ```
 *
 * @module db/tanstack
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Base item interface with required sync fields
 */
export interface SyncItem {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
  branch?: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Change types for sync messages
 */
export type ChangeType = 'insert' | 'update' | 'delete'

/**
 * Change message for broadcasting mutations
 */
export interface Change {
  type: ChangeType
  collection: string
  key: string
  branch?: string | null
  data?: SyncItem
  txid: number
}

/**
 * Initial state message sent on subscription
 */
export interface InitialMessage {
  type: 'initial'
  collection: string
  branch: string | null
  data: SyncItem[]
  txid: number
}

/**
 * Subscribe message from client
 */
export interface SubscribeMessage {
  type: 'subscribe'
  collection: string
  branch?: string | null
}

/**
 * Unsubscribe message from client
 */
export interface UnsubscribeMessage {
  type: 'unsubscribe'
  collection: string
}

/**
 * All possible client messages
 */
export type ClientMessage = SubscribeMessage | UnsubscribeMessage

/**
 * All possible server messages
 */
export type ServerMessage = InitialMessage | Change

/**
 * Filter type for querying collections
 */
export type Filter<T> = Partial<T> | Record<string, unknown>

/**
 * Subscription callback type
 */
export type SubscriptionCallback<T> = (items: T[]) => void

/**
 * Subscription handle with unsubscribe function
 */
export interface Subscription {
  unsubscribe: () => void
}

// ============================================================================
// SYNC ENGINE INTERFACE
// ============================================================================

/**
 * SyncEngine - Core sync orchestration for server-side
 */
export interface SyncEngine {
  /**
   * Accept a new WebSocket connection
   */
  accept(socket: WebSocket): void

  /**
   * Subscribe a socket to a collection
   */
  subscribe(socket: WebSocket, collection: string, branch?: string | null): void

  /**
   * Unsubscribe a socket from a collection
   */
  unsubscribe(socket: WebSocket, collection: string, branch?: string | null): void

  /**
   * Broadcast a change to all subscribers of a collection
   */
  broadcast(collection: string, change: Change, branch?: string | null): void

  /**
   * Send initial state to a socket for a collection
   */
  sendInitialState(socket: WebSocket, collection: string, branch?: string | null): Promise<void>

  /**
   * Get the number of active connections
   */
  getActiveConnections(): number

  /**
   * Get subscribers for a collection (optionally filtered by branch)
   */
  getSubscribers(collection: string, branch?: string | null): Set<WebSocket>
}

/**
 * Configuration for creating a SyncEngine
 */
export interface SyncEngineConfig {
  store: ThingsStoreLike
}

/**
 * Minimal store interface that SyncEngine requires
 */
export interface ThingsStoreLike {
  list(options: { type?: string; branch?: string; limit?: number; offset?: number }): Promise<SyncItem[]>
  get?(id: string): Promise<SyncItem | null>
  create?(data: Partial<SyncItem>): Promise<{ item: SyncItem; rowid: number }>
  update?(id: string, data: Partial<SyncItem>): Promise<{ item: SyncItem; rowid: number }>
  delete?(id: string): Promise<{ rowid: number }>
}

// ============================================================================
// SYNC CLIENT INTERFACE
// ============================================================================

/**
 * Connection status for SyncClient
 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

/**
 * SyncClient - Client-side sync state management
 */
export interface SyncClient {
  /**
   * Connect to the sync endpoint
   */
  connect(): Promise<void>

  /**
   * Disconnect from the sync endpoint
   */
  disconnect(): void

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus

  /**
   * Subscribe to a collection
   */
  subscribe(collection: string, branch?: string | null): void

  /**
   * Unsubscribe from a collection
   */
  unsubscribe(collection: string): void

  /**
   * Register callback for initial state
   */
  onInitial(collection: string, callback: (items: SyncItem[], txid: number) => void): () => void

  /**
   * Register callback for changes
   */
  onChange(collection: string, callback: (change: Change) => void): () => void

  /**
   * Register callback for all sync events
   */
  onSync(callback: (change: Change) => void): () => void

  /**
   * Register callback for disconnection
   */
  onDisconnect(callback: () => void): () => void
}

/**
 * Configuration for creating a SyncClient
 */
export interface SyncClientConfig {
  url: string
  branch?: string | null
}

// ============================================================================
// THINGS COLLECTION INTERFACE
// ============================================================================

/**
 * ThingsCollection - Collection with sync methods
 */
export interface ThingsCollection<T extends SyncItem> {
  /**
   * Insert a new item
   */
  insert(item: T): Promise<T>

  /**
   * Update an existing item
   */
  update(id: string, changes: Partial<T>): Promise<T>

  /**
   * Delete an item
   */
  delete(id: string): Promise<void>

  /**
   * Query items with optional filter
   */
  query(filter?: Filter<T>): Promise<T[]>

  /**
   * Subscribe to collection changes
   */
  subscribe(callback: SubscriptionCallback<T>): () => void
}

/**
 * Configuration for creating a ThingsCollection
 */
export interface ThingsCollectionConfig<T extends SyncItem> {
  name: string
  store: ThingsStoreLike
  syncEngine: SyncEngine
  branch?: string | null
}

// ============================================================================
// TANSTACK DB COLLECTION OPTIONS
// ============================================================================

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
  name: string
  doUrl: string
  branch?: string | null
}

// ============================================================================
// SYNC ENGINE IMPLEMENTATION
// ============================================================================

interface ConnectionState {
  socket: WebSocket
  subscriptions: Map<string, { collection: string; branch: string | null }>
}

/**
 * Create a new SyncEngine instance
 */
export function createSyncEngine(config: SyncEngineConfig): SyncEngine {
  const connections = new Map<WebSocket, ConnectionState>()
  const collectionSubscribers = new Map<string, Set<WebSocket>>()
  const { store } = config

  function getSubscriptionKey(collection: string, branch: string | null): string {
    return branch ? `${collection}:${branch}` : collection
  }

  function handleMessage(socket: WebSocket, event: MessageEvent): void {
    try {
      const data = typeof event.data === 'string' ? event.data : ''
      const message = JSON.parse(data) as ClientMessage

      if (message.type === 'subscribe') {
        engine.subscribe(socket, message.collection, message.branch)
        // Send initial state asynchronously
        engine.sendInitialState(socket, message.collection, message.branch).catch(() => {
          // Silently ignore errors
        })
      } else if (message.type === 'unsubscribe') {
        engine.unsubscribe(socket, message.collection)
      }
    } catch {
      // Invalid JSON - silently ignore
    }
  }

  function handleClose(socket: WebSocket): void {
    const state = connections.get(socket)
    if (!state) return

    // Remove all subscriptions
    for (const [key] of state.subscriptions) {
      const subscribers = collectionSubscribers.get(key)
      if (subscribers) {
        subscribers.delete(socket)
        if (subscribers.size === 0) {
          collectionSubscribers.delete(key)
        }
      }
    }

    // Remove connection
    connections.delete(socket)
  }

  const engine: SyncEngine = {
    accept(socket: WebSocket): void {
      const state: ConnectionState = {
        socket,
        subscriptions: new Map(),
      }
      connections.set(socket, state)

      // Set up message handler
      socket.addEventListener('message', (event: MessageEvent) => {
        handleMessage(socket, event)
      })

      // Set up close handler
      socket.addEventListener('close', () => {
        handleClose(socket)
      })

      // Handle error
      socket.addEventListener('error', () => {
        handleClose(socket)
      })
    },

    subscribe(socket: WebSocket, collection: string, branch?: string | null): void {
      const state = connections.get(socket)
      if (!state) return

      const subscriptionKey = getSubscriptionKey(collection, branch ?? null)

      // Store subscription on connection
      state.subscriptions.set(subscriptionKey, {
        collection,
        branch: branch ?? null,
      })

      // Add to collection subscribers
      if (!collectionSubscribers.has(subscriptionKey)) {
        collectionSubscribers.set(subscriptionKey, new Set())
      }
      collectionSubscribers.get(subscriptionKey)!.add(socket)
    },

    unsubscribe(socket: WebSocket, collection: string, branch?: string | null): void {
      const state = connections.get(socket)
      if (!state) return

      const subscriptionKey = getSubscriptionKey(collection, branch ?? null)
      state.subscriptions.delete(subscriptionKey)

      // Remove from collection subscribers
      const subscribers = collectionSubscribers.get(subscriptionKey)
      if (subscribers) {
        subscribers.delete(socket)
        if (subscribers.size === 0) {
          collectionSubscribers.delete(subscriptionKey)
        }
      }
    },

    broadcast(collection: string, change: Change, branch?: string | null): void {
      const subscriptionKey = getSubscriptionKey(collection, branch ?? null)
      const subscribers = collectionSubscribers.get(subscriptionKey)

      if (!subscribers) return

      const message = JSON.stringify(change)

      for (const socket of subscribers) {
        try {
          // Check if socket is open (readyState 1 = OPEN)
          if (socket.readyState !== 1) continue
          socket.send(message)
        } catch {
          // Socket send failed - silently ignore
        }
      }
    },

    async sendInitialState(socket: WebSocket, collection: string, branch?: string | null): Promise<void> {
      try {
        const items = await store.list({
          type: collection,
          branch: branch ?? undefined,
          limit: 1000,
        })

        // Calculate txid from items
        let txid = 0
        if (items.length > 0) {
          // Use current timestamp as approximate txid
          txid = Date.now()
        }

        const message: InitialMessage = {
          type: 'initial',
          collection,
          branch: branch ?? null,
          data: items,
          txid,
        }

        if (socket.readyState === 1) {
          socket.send(JSON.stringify(message))
        }
      } catch {
        // Error fetching initial state - send empty
        const message: InitialMessage = {
          type: 'initial',
          collection,
          branch: branch ?? null,
          data: [],
          txid: 0,
        }
        if (socket.readyState === 1) {
          socket.send(JSON.stringify(message))
        }
      }
    },

    getActiveConnections(): number {
      return connections.size
    },

    getSubscribers(collection: string, branch?: string | null): Set<WebSocket> {
      const subscriptionKey = getSubscriptionKey(collection, branch ?? null)
      return collectionSubscribers.get(subscriptionKey) ?? new Set()
    },
  }

  return engine
}

// ============================================================================
// SYNC CLIENT IMPLEMENTATION
// ============================================================================

/**
 * Create a new SyncClient instance
 */
export function createSyncClient(config: SyncClientConfig): SyncClient {
  let socket: WebSocket | null = null
  let status: ConnectionStatus = 'disconnected'
  const initialCallbacks = new Map<string, Set<(items: SyncItem[], txid: number) => void>>()
  const changeCallbacks = new Map<string, Set<(change: Change) => void>>()
  const syncCallbacks = new Set<(change: Change) => void>()
  const disconnectCallbacks = new Set<() => void>()

  let connectResolve: (() => void) | null = null
  let connectReject: ((error: Error) => void) | null = null

  function handleMessage(event: MessageEvent): void {
    try {
      const data = typeof event.data === 'string' ? event.data : ''
      const message = JSON.parse(data) as ServerMessage

      if (message.type === 'initial') {
        const callbacks = initialCallbacks.get(message.collection)
        if (callbacks) {
          for (const cb of callbacks) {
            cb(message.data, message.txid)
          }
        }
      } else {
        // Change message
        const change = message as Change
        const callbacks = changeCallbacks.get(change.collection)
        if (callbacks) {
          for (const cb of callbacks) {
            cb(change)
          }
        }
        // Also notify sync callbacks
        for (const cb of syncCallbacks) {
          cb(change)
        }
      }
    } catch {
      // Invalid JSON - silently ignore
    }
  }

  const client: SyncClient = {
    connect(): Promise<void> {
      return new Promise((resolve, reject) => {
        connectResolve = resolve
        connectReject = reject
        status = 'connecting'

        socket = new WebSocket(config.url)

        socket.addEventListener('open', () => {
          status = 'connected'
          connectResolve?.()
          connectResolve = null
          connectReject = null
        })

        socket.addEventListener('error', (event) => {
          status = 'disconnected'
          connectReject?.(new Error('WebSocket connection failed'))
          connectResolve = null
          connectReject = null
        })

        socket.addEventListener('close', () => {
          status = 'disconnected'
          for (const cb of disconnectCallbacks) {
            cb()
          }
        })

        socket.addEventListener('message', handleMessage)
      })
    },

    disconnect(): void {
      if (socket) {
        socket.close()
        socket = null
      }
      status = 'disconnected'
    },

    getStatus(): ConnectionStatus {
      return status
    },

    subscribe(collection: string, branch?: string | null): void {
      if (!socket || socket.readyState !== 1) return

      const message: SubscribeMessage = {
        type: 'subscribe',
        collection,
        branch: branch ?? null,
      }
      socket.send(JSON.stringify(message))
    },

    unsubscribe(collection: string): void {
      if (!socket || socket.readyState !== 1) return

      const message: UnsubscribeMessage = {
        type: 'unsubscribe',
        collection,
      }
      socket.send(JSON.stringify(message))
    },

    onInitial(collection: string, callback: (items: SyncItem[], txid: number) => void): () => void {
      if (!initialCallbacks.has(collection)) {
        initialCallbacks.set(collection, new Set())
      }
      initialCallbacks.get(collection)!.add(callback)

      return () => {
        const callbacks = initialCallbacks.get(collection)
        if (callbacks) {
          callbacks.delete(callback)
        }
      }
    },

    onChange(collection: string, callback: (change: Change) => void): () => void {
      if (!changeCallbacks.has(collection)) {
        changeCallbacks.set(collection, new Set())
      }
      changeCallbacks.get(collection)!.add(callback)

      return () => {
        const callbacks = changeCallbacks.get(collection)
        if (callbacks) {
          callbacks.delete(callback)
        }
      }
    },

    onSync(callback: (change: Change) => void): () => void {
      syncCallbacks.add(callback)
      return () => {
        syncCallbacks.delete(callback)
      }
    },

    onDisconnect(callback: () => void): () => void {
      disconnectCallbacks.add(callback)
      return () => {
        disconnectCallbacks.delete(callback)
      }
    },
  }

  return client
}

// ============================================================================
// THINGS COLLECTION IMPLEMENTATION
// ============================================================================

/**
 * Create a new ThingsCollection instance
 */
export function createThingsCollection<T extends SyncItem>(
  config: ThingsCollectionConfig<T>
): ThingsCollection<T> {
  const { name, store, syncEngine, branch } = config
  const subscribers = new Set<SubscriptionCallback<T>>()

  async function notifySubscribers(): Promise<void> {
    const items = (await store.list({ type: name, branch: branch ?? undefined })) as T[]
    for (const callback of subscribers) {
      callback(items)
    }
  }

  const collection: ThingsCollection<T> = {
    async insert(item: T): Promise<T> {
      const result = await store.create!({
        ...item,
        $type: item.$type || name,
      })

      const change: Change = {
        type: 'insert',
        collection: name,
        key: result.item.$id,
        data: result.item,
        txid: result.rowid,
        branch: branch ?? null,
      }
      syncEngine.broadcast(name, change, branch ?? null)

      await notifySubscribers()
      return result.item as T
    },

    async update(id: string, changes: Partial<T>): Promise<T> {
      const result = await store.update!(id, changes)

      const change: Change = {
        type: 'update',
        collection: name,
        key: id,
        data: result.item,
        txid: result.rowid,
        branch: branch ?? null,
      }
      syncEngine.broadcast(name, change, branch ?? null)

      await notifySubscribers()
      return result.item as T
    },

    async delete(id: string): Promise<void> {
      const result = await store.delete!(id)

      const change: Change = {
        type: 'delete',
        collection: name,
        key: id,
        txid: result.rowid,
        branch: branch ?? null,
      }
      syncEngine.broadcast(name, change, branch ?? null)

      await notifySubscribers()
    },

    async query(filter?: Filter<T>): Promise<T[]> {
      const items = (await store.list({ type: name, branch: branch ?? undefined })) as T[]

      if (!filter) return items

      // Simple filter implementation
      return items.filter((item) => {
        for (const [key, value] of Object.entries(filter)) {
          const itemValue = key.includes('.')
            ? key.split('.').reduce((obj: Record<string, unknown>, k) => (obj as Record<string, unknown>)?.[k] as Record<string, unknown>, item as unknown as Record<string, unknown>)
            : (item as Record<string, unknown>)[key]
          if (itemValue !== value) return false
        }
        return true
      })
    },

    subscribe(callback: SubscriptionCallback<T>): () => void {
      subscribers.add(callback)
      // Immediately call with current items
      store.list({ type: name, branch: branch ?? undefined }).then((items) => {
        callback(items as T[])
      })

      return () => {
        subscribers.delete(callback)
      }
    },
  }

  return collection
}

// ============================================================================
// TANSTACK DB COLLECTION OPTIONS FACTORY
// ============================================================================

/**
 * Create TanStack DB compatible collection options for dotdo sync
 *
 * @example
 * ```typescript
 * const taskCollection = dotdoCollectionOptions({
 *   name: 'Task',
 *   doUrl: 'https://my-app.workers.dev/api',
 * })
 *
 * // Use with TanStack DB
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
  const { name, doUrl, branch } = config

  // Build WebSocket URL from DO URL
  const wsUrl = doUrl.replace(/^http/, 'ws') + '/sync'

  return {
    id: `dotdo:${name}`,

    getKey(item: T): string {
      return item.$id
    },

    sync(context: TanStackSyncContext): () => void {
      const { begin, write, commit, markReady } = context

      // Create client and set up handlers
      const client = createSyncClient({ url: wsUrl, branch })

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
      client.onChange(name, (change) => {
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

// ============================================================================
// RE-EXPORTS (for convenience)
// ============================================================================

/**
 * SyncConfig is an alias for SyncEngineConfig
 * @deprecated Use SyncEngineConfig instead
 */
export type SyncConfig = SyncEngineConfig
