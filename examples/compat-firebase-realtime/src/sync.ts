/**
 * Real-time Synchronization Module
 *
 * Handles WebSocket-based real-time sync between clients and the database.
 * Implements Firebase's real-time wire protocol with:
 * - Connection management
 * - Subscription handling
 * - Conflict resolution
 * - Offline persistence preparation
 *
 * @example
 * ```typescript
 * const sync = new RealtimeSync('wss://your-worker.workers.dev')
 * sync.connect()
 *
 * sync.subscribe('/users/alice', (snapshot) => {
 *   console.log('User data:', snapshot.val())
 * })
 * ```
 */

import { createSnapshot, type DataSnapshot, type QueryOptions } from './PathDO'

// ============================================================================
// TYPES
// ============================================================================

export type EventType = 'value' | 'child_added' | 'child_changed' | 'child_removed' | 'child_moved'

export interface SubscriptionCallback {
  (snapshot: DataSnapshot, previousChildKey?: string | null): void
}

export interface ErrorCallback {
  (error: Error): void
}

export interface Subscription {
  id: string
  path: string
  eventType: EventType
  query?: QueryOptions
  callback: SubscriptionCallback
  errorCallback?: ErrorCallback
  cancelled: boolean
}

export interface PendingWrite {
  id: string
  path: string
  action: 'set' | 'update' | 'push' | 'remove' | 'transaction'
  data?: unknown
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timestamp: number
}

export interface OnDisconnectOperation {
  path: string
  action: 'set' | 'update' | 'remove'
  data?: unknown
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export interface ConnectionInfo {
  state: ConnectionState
  lastConnected: number | null
  reconnectAttempts: number
}

// ============================================================================
// REALTIME SYNC
// ============================================================================

export class RealtimeSync {
  private ws: WebSocket | null = null
  private url: string
  private sessionId: string | null = null
  private authToken: string | null = null

  private subscriptions: Map<string, Subscription> = new Map()
  private pendingWrites: Map<number, PendingWrite> = new Map()
  private onDisconnectOps: OnDisconnectOperation[] = []

  private requestId = 0
  private connectionState: ConnectionState = 'disconnected'
  private lastConnected: number | null = null
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  private stateCallbacks: Set<(state: ConnectionState) => void> = new Set()
  private dataCache: Map<string, unknown> = new Map()

  // Configuration
  private readonly maxReconnectAttempts = 10
  private readonly baseReconnectDelay = 1000
  private readonly maxReconnectDelay = 60000

  constructor(url: string) {
    // Convert HTTP(S) to WS(S)
    this.url = url.replace(/^http/, 'ws')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONNECTION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Connect to the realtime database
   */
  connect(): void {
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
      return
    }

    this.setConnectionState('connecting')

    try {
      this.ws = new WebSocket(this.url)
      this.setupWebSocketHandlers()
    } catch (error) {
      this.handleConnectionError(error as Error)
    }
  }

  /**
   * Disconnect from the realtime database
   */
  disconnect(): void {
    this.clearReconnectTimer()
    this.reconnectAttempts = 0

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect')
      this.ws = null
    }

    this.setConnectionState('disconnected')
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionInfo {
    return {
      state: this.connectionState,
      lastConnected: this.lastConnected,
      reconnectAttempts: this.reconnectAttempts,
    }
  }

  /**
   * Subscribe to connection state changes
   */
  onConnectionStateChange(callback: (state: ConnectionState) => void): () => void {
    this.stateCallbacks.add(callback)
    return () => this.stateCallbacks.delete(callback)
  }

  private setupWebSocketHandlers(): void {
    if (!this.ws) return

    this.ws.onopen = () => {
      // Connection established, wait for handshake
    }

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data as string)
    }

    this.ws.onerror = () => {
      // Error will be followed by close
    }

    this.ws.onclose = (event) => {
      this.handleDisconnect(event.code, event.reason)
    }
  }

  private handleMessage(data: string): void {
    // Handle keepalive
    if (data === '1') {
      return // Pong response
    }

    try {
      const msg = JSON.parse(data)

      if (msg.t === 'c') {
        // Control message
        this.handleControlMessage(msg.d)
      } else if (msg.t === 'd') {
        // Data message
        this.handleDataMessage(msg.d)
      }
    } catch (error) {
      console.error('Failed to parse message:', error)
    }
  }

  private handleControlMessage(data: { t: string; d: unknown }): void {
    if (data.t === 'h') {
      // Handshake
      const handshake = data.d as { s: string; ts: number }
      this.sessionId = handshake.s

      this.setConnectionState('connected')
      this.lastConnected = Date.now()
      this.reconnectAttempts = 0

      // Re-authenticate if we have a token
      if (this.authToken) {
        this.authenticate(this.authToken)
      }

      // Resubscribe to all paths
      this.resubscribeAll()
    } else if (data.t === 'r') {
      // Reset (server wants us to reset subscriptions)
      this.resubscribeAll()
    }
  }

  private handleDataMessage(data: { r?: number; a?: string; b: unknown }): void {
    if (data.r !== undefined) {
      // Response to a request
      const pending = this.pendingWrites.get(data.r)
      if (pending) {
        const response = data.b as { s: string; d: unknown }
        if (response.s === 'ok') {
          pending.resolve(response.d)
        } else {
          pending.reject(new Error(String(response.d)))
        }
        this.pendingWrites.delete(data.r)
      }
    } else if (data.a === 'd') {
      // Data update
      const update = data.b as { p: string; d: unknown }
      this.handleDataUpdate(update.p, update.d)
    } else if (data.a === 'm') {
      // Merge update
      const update = data.b as { p: string; d: Record<string, unknown> }
      this.handleMergeUpdate(update.p, update.d)
    }
  }

  private handleDataUpdate(path: string, data: unknown): void {
    // Update cache
    this.dataCache.set(path, data)

    // Notify subscribers
    for (const subscription of this.subscriptions.values()) {
      if (subscription.cancelled) continue

      if (this.pathMatches(subscription.path, path)) {
        const snapshot = this.createSnapshotForPath(subscription.path, data, path)
        try {
          subscription.callback(snapshot)
        } catch (error) {
          console.error('Subscription callback error:', error)
        }
      }
    }
  }

  private handleMergeUpdate(path: string, data: Record<string, unknown>): void {
    // Merge into cache
    const existing = (this.dataCache.get(path) as Record<string, unknown>) || {}
    const merged = { ...existing, ...data }
    this.dataCache.set(path, merged)

    // Notify subscribers
    this.handleDataUpdate(path, merged)
  }

  private pathMatches(subscriptionPath: string, updatePath: string): boolean {
    const subNorm = subscriptionPath.replace(/^\/+|\/+$/g, '')
    const updNorm = updatePath.replace(/^\/+|\/+$/g, '')

    // Exact match
    if (subNorm === updNorm) return true

    // Subscription is ancestor of update
    if (updNorm.startsWith(subNorm + '/')) return true

    // Update is ancestor of subscription
    if (subNorm.startsWith(updNorm + '/')) return true

    return false
  }

  private createSnapshotForPath(subscriptionPath: string, data: unknown, updatePath: string): DataSnapshot {
    const subNorm = subscriptionPath.replace(/^\/+|\/+$/g, '')
    const updNorm = updatePath.replace(/^\/+|\/+$/g, '')

    let snapshotData = data

    // If update is at an ancestor, get the relevant child data
    if (subNorm.startsWith(updNorm + '/') && data !== null && typeof data === 'object') {
      const relativePath = subNorm.slice(updNorm.length + 1)
      const segments = relativePath.split('/')
      let current: unknown = data
      for (const segment of segments) {
        if (current === null || typeof current !== 'object') {
          snapshotData = null
          break
        }
        current = (current as Record<string, unknown>)[segment]
        snapshotData = current
      }
    }

    const key = subNorm.split('/').pop() || null
    return createSnapshot(key, snapshotData)
  }

  private handleDisconnect(_code: number, _reason: string): void {
    this.ws = null
    this.sessionId = null

    if (this.connectionState !== 'disconnected') {
      this.setConnectionState('reconnecting')
      this.scheduleReconnect()
    }
  }

  private handleConnectionError(_error: Error): void {
    if (this.connectionState === 'connecting') {
      this.setConnectionState('reconnecting')
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setConnectionState('disconnected')
      return
    }

    this.clearReconnectTimer()

    // Exponential backoff with jitter
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts) + Math.random() * 1000,
      this.maxReconnectDelay
    )

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++
      this.connect()
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) return
    this.connectionState = state

    for (const callback of this.stateCallbacks) {
      try {
        callback(state)
      } catch (error) {
        console.error('Connection state callback error:', error)
      }
    }
  }

  private resubscribeAll(): void {
    for (const subscription of this.subscriptions.values()) {
      if (!subscription.cancelled) {
        this.sendSubscribe(subscription)
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTHENTICATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Authenticate with a custom token or ID token
   */
  async authenticate(token: string): Promise<{ uid: string }> {
    this.authToken = token

    if (this.connectionState !== 'connected') {
      // Will auth after connection
      return { uid: '' }
    }

    const requestId = this.getNextRequestId()

    return new Promise((resolve, reject) => {
      this.pendingWrites.set(requestId, {
        id: String(requestId),
        path: '',
        action: 'set',
        resolve: (data) => resolve(data as { uid: string }),
        reject,
        timestamp: Date.now(),
      })

      this.send({
        t: 'd',
        d: {
          r: requestId,
          a: 'auth',
          b: { cred: { token } },
        },
      })
    })
  }

  /**
   * Sign out (unauthenticate)
   */
  async unauthenticate(): Promise<void> {
    this.authToken = null

    if (this.connectionState !== 'connected') {
      return
    }

    const requestId = this.getNextRequestId()

    return new Promise((resolve, reject) => {
      this.pendingWrites.set(requestId, {
        id: String(requestId),
        path: '',
        action: 'set',
        resolve: () => resolve(),
        reject,
        timestamp: Date.now(),
      })

      this.send({
        t: 'd',
        d: {
          r: requestId,
          a: 'unauth',
          b: {},
        },
      })
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUBSCRIPTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Subscribe to data changes at a path
   */
  subscribe(
    path: string,
    eventType: EventType,
    callback: SubscriptionCallback,
    errorCallback?: ErrorCallback,
    query?: QueryOptions
  ): () => void {
    const id = `${path}:${eventType}:${Date.now()}`
    const subscription: Subscription = {
      id,
      path: path.replace(/^\/+|\/+$/g, ''),
      eventType,
      query,
      callback,
      errorCallback,
      cancelled: false,
    }

    this.subscriptions.set(id, subscription)

    // Send subscribe if connected
    if (this.connectionState === 'connected') {
      this.sendSubscribe(subscription)
    }

    // Return unsubscribe function
    return () => this.unsubscribe(id)
  }

  /**
   * Unsubscribe from data changes
   */
  unsubscribe(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) return

    subscription.cancelled = true
    this.subscriptions.delete(subscriptionId)

    // Send unsubscribe if connected
    if (this.connectionState === 'connected') {
      this.sendUnsubscribe(subscription.path)
    }
  }

  private sendSubscribe(subscription: Subscription): void {
    const requestId = this.getNextRequestId()

    this.send({
      t: 'd',
      d: {
        r: requestId,
        a: 'q',
        b: {
          p: '/' + subscription.path,
          q: subscription.query,
          h: '',
        },
      },
    })
  }

  private sendUnsubscribe(path: string): void {
    const requestId = this.getNextRequestId()

    this.send({
      t: 'd',
      d: {
        r: requestId,
        a: 'n',
        b: { p: '/' + path },
      },
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WRITE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set data at a path
   */
  async set(path: string, data: unknown): Promise<void> {
    return this.sendWrite('p', path, data)
  }

  /**
   * Update (merge) data at a path
   */
  async update(path: string, data: Record<string, unknown>): Promise<void> {
    return this.sendWrite('m', path, data)
  }

  private async sendWrite(action: string, path: string, data: unknown): Promise<void> {
    if (this.connectionState !== 'connected') {
      throw new Error('Not connected')
    }

    const requestId = this.getNextRequestId()

    return new Promise((resolve, reject) => {
      this.pendingWrites.set(requestId, {
        id: String(requestId),
        path,
        action: action === 'p' ? 'set' : 'update',
        data,
        resolve: () => resolve(),
        reject,
        timestamp: Date.now(),
      })

      this.send({
        t: 'd',
        d: {
          r: requestId,
          a: action,
          b: {
            p: '/' + path.replace(/^\/+|\/+$/g, ''),
            d: data,
          },
        },
      })
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ON DISCONNECT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set data to write when disconnecting
   */
  async onDisconnectSet(path: string, data: unknown): Promise<void> {
    if (this.connectionState !== 'connected') {
      throw new Error('Not connected')
    }

    const requestId = this.getNextRequestId()

    return new Promise((resolve, reject) => {
      this.pendingWrites.set(requestId, {
        id: String(requestId),
        path,
        action: 'set',
        data,
        resolve: () => {
          this.onDisconnectOps.push({ path, action: 'set', data })
          resolve()
        },
        reject,
        timestamp: Date.now(),
      })

      this.send({
        t: 'd',
        d: {
          r: requestId,
          a: 'o',
          b: {
            p: '/' + path.replace(/^\/+|\/+$/g, ''),
            d: data,
          },
        },
      })
    })
  }

  /**
   * Update data when disconnecting
   */
  async onDisconnectUpdate(path: string, data: Record<string, unknown>): Promise<void> {
    if (this.connectionState !== 'connected') {
      throw new Error('Not connected')
    }

    const requestId = this.getNextRequestId()

    return new Promise((resolve, reject) => {
      this.pendingWrites.set(requestId, {
        id: String(requestId),
        path,
        action: 'update',
        data,
        resolve: () => {
          this.onDisconnectOps.push({ path, action: 'update', data })
          resolve()
        },
        reject,
        timestamp: Date.now(),
      })

      this.send({
        t: 'd',
        d: {
          r: requestId,
          a: 'om',
          b: {
            p: '/' + path.replace(/^\/+|\/+$/g, ''),
            d: data,
          },
        },
      })
    })
  }

  /**
   * Cancel onDisconnect operations for a path
   */
  async onDisconnectCancel(path: string): Promise<void> {
    if (this.connectionState !== 'connected') {
      throw new Error('Not connected')
    }

    const requestId = this.getNextRequestId()

    return new Promise((resolve, reject) => {
      this.pendingWrites.set(requestId, {
        id: String(requestId),
        path,
        action: 'remove',
        resolve: () => {
          this.onDisconnectOps = this.onDisconnectOps.filter((op) => op.path !== path)
          resolve()
        },
        reject,
        timestamp: Date.now(),
      })

      this.send({
        t: 'd',
        d: {
          r: requestId,
          a: 'oc',
          b: {
            p: '/' + path.replace(/^\/+|\/+$/g, ''),
          },
        },
      })
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  private send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  private getNextRequestId(): number {
    return ++this.requestId
  }

  /**
   * Send keepalive ping
   */
  ping(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send('0')
    }
  }

  /**
   * Get cached data for a path
   */
  getCached(path: string): unknown {
    return this.dataCache.get(path.replace(/^\/+|\/+$/g, ''))
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.dataCache.clear()
  }
}

// ============================================================================
// CONNECTION UTILITIES
// ============================================================================

/**
 * Create a connection presence handler
 */
export function createPresenceHandler(
  sync: RealtimeSync,
  userPath: string,
  onlineData: unknown,
  offlineData: unknown
): { goOnline: () => Promise<void>; goOffline: () => Promise<void> } {
  return {
    async goOnline(): Promise<void> {
      await sync.set(userPath, onlineData)
      await sync.onDisconnectSet(userPath, offlineData)
    },

    async goOffline(): Promise<void> {
      await sync.onDisconnectCancel(userPath)
      await sync.set(userPath, offlineData)
    },
  }
}

/**
 * Create a server timestamp placeholder
 */
export function serverTimestamp(): { '.sv': 'timestamp' } {
  return { '.sv': 'timestamp' }
}

/**
 * Create an increment operation placeholder
 */
export function increment(delta: number): { '.sv': { increment: number } } {
  return { '.sv': { increment: delta } }
}

export default RealtimeSync
