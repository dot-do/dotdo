/**
 * WSBroadcaster - WebSocket Fan-out for Real-time Updates
 *
 * Handles efficient fan-out of updates to subscribed WebSocket clients:
 * - Topic-based subscriptions ($type, $id, wildcard)
 * - Efficient fan-out to many clients with batching
 * - Backpressure handling for slow clients
 * - Message coalescing for rapid updates
 * - Backfill on subscribe for late joiners
 *
 * @example
 * ```typescript
 * const broadcaster = new WSBroadcaster({
 *   eventStore: myEventStore,
 *   coalesceWindowMs: 100,
 * })
 *
 * // Subscribe client to type
 * broadcaster.subscribe(ws, { $type: 'Customer' })
 *
 * // Broadcast event
 * await broadcaster.broadcast(event)
 *
 * // Clean up
 * await broadcaster.close()
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Thing type matching the unified storage pattern
 */
interface Thing {
  $id: string
  $type: string
  $version?: number
  $createdAt?: number
  $updatedAt?: number
  [key: string]: unknown
}

/**
 * Domain event emitted on mutations
 */
interface DomainEvent {
  type: 'thing.created' | 'thing.updated' | 'thing.deleted'
  entityId: string
  entityType: string
  payload: Thing | Partial<Thing>
  ts: number
  version: number
}

/**
 * Subscription filter options
 */
export interface SubscriptionFilter {
  /** Filter by entity type */
  $type?: string
  /** Filter by specific entity ID */
  $id?: string
  /** Receive all updates (wildcard) */
  wildcard?: boolean
  /** Include full payload in messages */
  includePayload?: boolean
  /** Enable backfill of historical events */
  backfill?: boolean
  /** Maximum events to backfill */
  backfillLimit?: number
  /** Disable coalescing for this subscription */
  coalesce?: boolean
}

/**
 * Subscription registration
 */
export interface Subscription {
  /** Unique subscription ID */
  id: string
  /** The subscription filter */
  filter: SubscriptionFilter
  /** Timestamp when subscription was created */
  createdAt: number
}

/**
 * Broadcast message sent to clients
 */
export interface BroadcastMessage {
  /** Event type */
  type: 'thing.created' | 'thing.updated' | 'thing.deleted'
  /** Entity ID */
  entityId: string
  /** Entity type */
  entityType: string
  /** Event payload */
  payload?: Thing | Partial<Thing>
  /** Timestamp */
  ts: number
  /** Version number */
  version: number
  /** Subscription ID that matched */
  subscriptionId?: string
  /** Whether this is a backfill message */
  backfill?: boolean
  /** Whether this is a historical message */
  historical?: boolean
  /** Whether this message was coalesced */
  coalesced?: boolean
  /** Number of updates coalesced */
  coalescedCount?: number
}

/**
 * Broadcast statistics
 */
export interface BroadcastStats {
  /** Total number of subscriptions */
  totalSubscriptions: number
  /** Total number of connected clients */
  totalClients: number
  /** Total broadcasts sent */
  totalBroadcasts: number
  /** Total messages sent to all clients */
  totalMessagesSent: number
  /** Last broadcast latency in ms */
  lastBroadcastLatencyMs?: number
  /** Average broadcast latency in ms */
  avgBroadcastLatencyMs?: number
}

/**
 * Per-client statistics
 */
export interface ClientStats {
  /** Messages received by this client */
  messagesReceived: number
  /** Number of subscriptions */
  subscriptionCount: number
  /** Number of messages dropped */
  droppedCount: number
  /** Number of send errors */
  errorCount: number
  /** Number of messages queued */
  queuedCount: number
}

/**
 * Event store interface for backfill
 */
interface EventStore {
  getRecentEvents(filter: { $type?: string; $id?: string; limit?: number }): DomainEvent[]
}

/**
 * Configuration for WSBroadcaster
 */
export interface WSBroadcasterConfig {
  /** Event store for backfill (optional) */
  eventStore?: EventStore
  /** Batch size for fan-out (default: 100) */
  batchSize?: number
  /** Yield after this many clients (default: 10) */
  yieldEvery?: number
  /** Maximum queue size per client (default: 100) */
  maxQueueSize?: number
  /** Drop policy when queue full: 'oldest' or 'newest' (default: 'oldest') */
  dropPolicy?: 'oldest' | 'newest'
  /** Max drops before disconnecting client (default: Infinity) */
  maxDropsBeforeDisconnect?: number
  /** Coalesce window in ms (default: 0 = disabled) */
  coalesceWindowMs?: number
  /** Max coalesce delay in ms (default: 1000) */
  maxCoalesceDelayMs?: number
  /** Default backfill limit (default: 100) */
  defaultBackfillLimit?: number
  /** Max errors before removing client (default: 5) */
  maxErrorsBeforeRemoval?: number
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface ClientState {
  ws: WebSocket
  subscriptions: Map<string, Subscription>
  messageQueue: string[]
  messagesReceived: number
  droppedCount: number
  errorCount: number
  sending: boolean
}

interface CoalesceEntry {
  event: DomainEvent
  count: number
  firstTs: number
  timer?: ReturnType<typeof setTimeout>
}

// ============================================================================
// WS BROADCASTER CLASS
// ============================================================================

/**
 * WSBroadcaster - Efficient WebSocket fan-out with backpressure handling
 */
export class WSBroadcaster {
  private readonly config: Required<Omit<WSBroadcasterConfig, 'eventStore'>> & {
    eventStore?: EventStore
  }
  private readonly clients: Map<WebSocket, ClientState> = new Map()
  private readonly typeSubscribers: Map<string, Set<WebSocket>> = new Map()
  private readonly idSubscribers: Map<string, Set<WebSocket>> = new Map()
  private readonly wildcardSubscribers: Set<WebSocket> = new Set()
  private readonly coalesceBuffer: Map<string, CoalesceEntry> = new Map()

  private _closed = false
  private _totalBroadcasts = 0
  private _totalMessagesSent = 0
  private _lastBroadcastLatencyMs?: number
  private _broadcastLatencySum = 0
  private _broadcastLatencyCount = 0

  private errorHandlers: Array<(client: WebSocket, error: Error) => void> = []

  constructor(config: WSBroadcasterConfig) {
    this.config = {
      eventStore: config.eventStore,
      batchSize: config.batchSize ?? 100,
      yieldEvery: config.yieldEvery ?? 10,
      maxQueueSize: config.maxQueueSize ?? 100,
      dropPolicy: config.dropPolicy ?? 'oldest',
      maxDropsBeforeDisconnect: config.maxDropsBeforeDisconnect ?? Infinity,
      coalesceWindowMs: config.coalesceWindowMs ?? 0,
      maxCoalesceDelayMs: config.maxCoalesceDelayMs ?? 1000,
      defaultBackfillLimit: config.defaultBackfillLimit ?? 100,
      maxErrorsBeforeRemoval: config.maxErrorsBeforeRemoval ?? 5,
    }
  }

  // ==========================================================================
  // SUBSCRIPTION MANAGEMENT
  // ==========================================================================

  /**
   * Register a subscription for a WebSocket client
   */
  subscribe(ws: WebSocket, filter: SubscriptionFilter): Subscription {
    if (this._closed) {
      throw new Error('WSBroadcaster is closed')
    }

    const subscription: Subscription = {
      id: `sub_${crypto.randomUUID()}`,
      filter: { ...filter },
      createdAt: Date.now(),
    }

    // Get or create client state
    let clientState = this.clients.get(ws)
    if (!clientState) {
      clientState = {
        ws,
        subscriptions: new Map(),
        messageQueue: [],
        messagesReceived: 0,
        droppedCount: 0,
        errorCount: 0,
        sending: false,
      }
      this.clients.set(ws, clientState)
    }

    // Register subscription
    clientState.subscriptions.set(subscription.id, subscription)

    // Add to appropriate index
    if (filter.wildcard) {
      this.wildcardSubscribers.add(ws)
    } else if (filter.$id) {
      let idSubs = this.idSubscribers.get(filter.$id)
      if (!idSubs) {
        idSubs = new Set()
        this.idSubscribers.set(filter.$id, idSubs)
      }
      idSubs.add(ws)
    } else if (filter.$type) {
      let typeSubs = this.typeSubscribers.get(filter.$type)
      if (!typeSubs) {
        typeSubs = new Set()
        this.typeSubscribers.set(filter.$type, typeSubs)
      }
      typeSubs.add(ws)
    }

    // Handle backfill if requested
    if (filter.backfill && this.config.eventStore) {
      this.performBackfill(ws, subscription)
    }

    return subscription
  }

  /**
   * Unsubscribe a specific subscription
   */
  unsubscribe(ws: WebSocket, subscriptionId: string): void {
    const clientState = this.clients.get(ws)
    if (!clientState) return

    const subscription = clientState.subscriptions.get(subscriptionId)
    if (!subscription) return

    // Remove from client
    clientState.subscriptions.delete(subscriptionId)

    // Remove from indexes
    const filter = subscription.filter
    if (filter.wildcard) {
      // Only remove from wildcard if no other wildcard subscriptions
      const hasOtherWildcard = Array.from(clientState.subscriptions.values()).some(
        (s) => s.filter.wildcard
      )
      if (!hasOtherWildcard) {
        this.wildcardSubscribers.delete(ws)
      }
    } else if (filter.$id) {
      const idSubs = this.idSubscribers.get(filter.$id)
      if (idSubs) {
        // Only remove if no other subscriptions for this $id
        const hasOtherId = Array.from(clientState.subscriptions.values()).some(
          (s) => s.filter.$id === filter.$id
        )
        if (!hasOtherId) {
          idSubs.delete(ws)
          if (idSubs.size === 0) {
            this.idSubscribers.delete(filter.$id)
          }
        }
      }
    } else if (filter.$type) {
      const typeSubs = this.typeSubscribers.get(filter.$type)
      if (typeSubs) {
        // Only remove if no other subscriptions for this $type
        const hasOtherType = Array.from(clientState.subscriptions.values()).some(
          (s) => s.filter.$type === filter.$type
        )
        if (!hasOtherType) {
          typeSubs.delete(ws)
          if (typeSubs.size === 0) {
            this.typeSubscribers.delete(filter.$type)
          }
        }
      }
    }

    // Clean up client if no subscriptions left
    if (clientState.subscriptions.size === 0) {
      this.clients.delete(ws)
    }
  }

  /**
   * Handle client disconnect - clean up all subscriptions
   */
  handleDisconnect(ws: WebSocket): void {
    const clientState = this.clients.get(ws)
    if (!clientState) return

    // Remove from all indexes
    this.wildcardSubscribers.delete(ws)

    for (const sub of clientState.subscriptions.values()) {
      if (sub.filter.$type) {
        const typeSubs = this.typeSubscribers.get(sub.filter.$type)
        if (typeSubs) {
          typeSubs.delete(ws)
          if (typeSubs.size === 0) {
            this.typeSubscribers.delete(sub.filter.$type)
          }
        }
      }
      if (sub.filter.$id) {
        const idSubs = this.idSubscribers.get(sub.filter.$id)
        if (idSubs) {
          idSubs.delete(ws)
          if (idSubs.size === 0) {
            this.idSubscribers.delete(sub.filter.$id)
          }
        }
      }
    }

    // Remove client
    this.clients.delete(ws)
  }

  /**
   * Get subscriptions for a client
   */
  getSubscriptions(ws: WebSocket): Subscription[] {
    const clientState = this.clients.get(ws)
    if (!clientState) return []
    return Array.from(clientState.subscriptions.values())
  }

  /**
   * Get total subscription count
   */
  getTotalSubscriptions(): number {
    let count = 0
    for (const clientState of this.clients.values()) {
      count += clientState.subscriptions.size
    }
    return count
  }

  /**
   * Get subscriber count for a specific $type
   */
  getSubscriberCount($type: string): number {
    const typeSubs = this.typeSubscribers.get($type)
    return typeSubs?.size ?? 0
  }

  // ==========================================================================
  // BROADCAST
  // ==========================================================================

  /**
   * Broadcast an event to all matching subscribers
   */
  async broadcast(event: DomainEvent): Promise<void> {
    if (this._closed) {
      throw new Error('WSBroadcaster is closed')
    }

    const startTime = performance.now()

    // Check if coalescing is enabled
    if (this.config.coalesceWindowMs > 0) {
      this.handleCoalescedBroadcast(event)
      return
    }

    // Direct broadcast without coalescing
    await this.doBroadcast(event)

    // Update latency stats
    const latency = performance.now() - startTime
    this._lastBroadcastLatencyMs = latency
    this._broadcastLatencySum += latency
    this._broadcastLatencyCount++
  }

  /**
   * Handle coalesced broadcast
   */
  private handleCoalescedBroadcast(event: DomainEvent): void {
    const key = `${event.entityId}:${event.type}`
    const existing = this.coalesceBuffer.get(key)

    if (existing) {
      // Update existing entry
      existing.event = event
      existing.count++

      // Check if we've exceeded max coalesce delay
      const elapsed = Date.now() - existing.firstTs
      if (elapsed >= this.config.maxCoalesceDelayMs) {
        // Flush immediately
        if (existing.timer) {
          clearTimeout(existing.timer)
        }
        this.flushCoalesced(key, existing)
      }
    } else {
      // Create new entry
      const entry: CoalesceEntry = {
        event,
        count: 1,
        firstTs: Date.now(),
      }

      // Set timer to flush after coalesce window
      entry.timer = setTimeout(() => {
        this.flushCoalesced(key, entry)
      }, this.config.coalesceWindowMs)

      this.coalesceBuffer.set(key, entry)
    }
  }

  /**
   * Flush a coalesced entry
   */
  private async flushCoalesced(key: string, entry: CoalesceEntry): Promise<void> {
    this.coalesceBuffer.delete(key)

    const startTime = performance.now()

    await this.doBroadcast(entry.event, {
      coalesced: entry.count > 1,
      coalescedCount: entry.count,
    })

    // Update latency stats
    const latency = performance.now() - startTime
    this._lastBroadcastLatencyMs = latency
    this._broadcastLatencySum += latency
    this._broadcastLatencyCount++
  }

  /**
   * Internal broadcast implementation
   */
  private async doBroadcast(
    event: DomainEvent,
    meta?: { coalesced?: boolean; coalescedCount?: number }
  ): Promise<void> {
    this._totalBroadcasts++

    // Find all matching clients
    const matchingClients = new Map<WebSocket, Subscription>()

    // Check wildcard subscribers
    for (const ws of this.wildcardSubscribers) {
      const clientState = this.clients.get(ws)
      if (clientState) {
        const sub = Array.from(clientState.subscriptions.values()).find((s) => s.filter.wildcard)
        if (sub) {
          matchingClients.set(ws, sub)
        }
      }
    }

    // Check $type subscribers
    const typeSubs = this.typeSubscribers.get(event.entityType)
    if (typeSubs) {
      for (const ws of typeSubs) {
        if (!matchingClients.has(ws)) {
          const clientState = this.clients.get(ws)
          if (clientState) {
            const sub = Array.from(clientState.subscriptions.values()).find(
              (s) => s.filter.$type === event.entityType
            )
            if (sub) {
              matchingClients.set(ws, sub)
            }
          }
        }
      }
    }

    // Check $id subscribers
    const idSubs = this.idSubscribers.get(event.entityId)
    if (idSubs) {
      for (const ws of idSubs) {
        if (!matchingClients.has(ws)) {
          const clientState = this.clients.get(ws)
          if (clientState) {
            const sub = Array.from(clientState.subscriptions.values()).find(
              (s) => s.filter.$id === event.entityId
            )
            if (sub) {
              matchingClients.set(ws, sub)
            }
          }
        }
      }
    }

    // Broadcast to all matching clients in batches
    const clients = Array.from(matchingClients.entries())
    let yieldCounter = 0

    for (const [ws, subscription] of clients) {
      // Skip disconnected clients
      if (ws.readyState !== WebSocket.OPEN) {
        continue
      }

      const clientState = this.clients.get(ws)
      if (!clientState) continue

      // Check if coalescing is disabled for this subscription
      if (
        subscription.filter.coalesce === false &&
        this.config.coalesceWindowMs > 0 &&
        !meta?.coalesced
      ) {
        // Direct send without coalescing
        const message = this.createMessage(event, subscription, meta)
        await this.sendToClient(ws, clientState, message)
      } else {
        const message = this.createMessage(event, subscription, meta)
        await this.sendToClient(ws, clientState, message)
      }

      // Yield periodically to avoid blocking
      yieldCounter++
      if (yieldCounter >= this.config.yieldEvery) {
        yieldCounter = 0
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
  }

  /**
   * Create broadcast message
   */
  private createMessage(
    event: DomainEvent,
    subscription: Subscription,
    meta?: { coalesced?: boolean; coalescedCount?: number; backfill?: boolean; historical?: boolean }
  ): BroadcastMessage {
    const message: BroadcastMessage = {
      type: event.type,
      entityId: event.entityId,
      entityType: event.entityType,
      ts: event.ts,
      version: event.version,
      subscriptionId: subscription.id,
    }

    if (subscription.filter.includePayload !== false) {
      message.payload = event.payload
    }

    if (meta?.coalesced) {
      message.coalesced = true
      message.coalescedCount = meta.coalescedCount
    }

    if (meta?.backfill) {
      message.backfill = true
      message.historical = true
    }

    return message
  }

  /**
   * Send message to a client with backpressure handling
   */
  private async sendToClient(
    ws: WebSocket,
    clientState: ClientState,
    message: BroadcastMessage
  ): Promise<void> {
    const messageStr = JSON.stringify(message)

    // Queue the message
    clientState.messageQueue.push(messageStr)

    // Handle queue overflow
    if (clientState.messageQueue.length > this.config.maxQueueSize) {
      if (this.config.dropPolicy === 'oldest') {
        clientState.messageQueue.shift()
      } else {
        clientState.messageQueue.pop()
      }
      clientState.droppedCount++

      // Check if we should disconnect
      if (clientState.droppedCount >= this.config.maxDropsBeforeDisconnect) {
        try {
          ws.close(1008, 'Too many dropped messages')
        } catch {
          // Ignore close errors
        }
        this.handleDisconnect(ws)
        return
      }
    }

    // Process queue if not already processing
    if (!clientState.sending) {
      await this.processClientQueue(ws, clientState)
    }
  }

  /**
   * Process client message queue
   */
  private async processClientQueue(ws: WebSocket, clientState: ClientState): Promise<void> {
    if (clientState.sending) return
    clientState.sending = true

    try {
      while (clientState.messageQueue.length > 0) {
        if (ws.readyState !== WebSocket.OPEN) {
          break
        }

        const message = clientState.messageQueue.shift()!

        try {
          await (ws as unknown as { send(msg: string): Promise<void> }).send(message)
          clientState.messagesReceived++
          this._totalMessagesSent++
        } catch (error) {
          clientState.errorCount++

          // Emit error event
          const err = error instanceof Error ? error : new Error(String(error))
          for (const handler of this.errorHandlers) {
            handler(ws, err)
          }

          // Check if we should remove the client
          if (clientState.errorCount >= this.config.maxErrorsBeforeRemoval) {
            this.handleDisconnect(ws)
            break
          }
        }
      }
    } finally {
      clientState.sending = false
    }
  }

  /**
   * Batch broadcast to many clients (used for internal batching)
   */
  private async broadcastBatch(clients: WebSocket[], message: string): Promise<void> {
    for (let i = 0; i < clients.length; i += this.config.batchSize) {
      const batch = clients.slice(i, i + this.config.batchSize)

      await Promise.all(
        batch.map(async (ws) => {
          if (ws.readyState !== WebSocket.OPEN) return
          try {
            await (ws as unknown as { send(msg: string): Promise<void> }).send(message)
          } catch {
            // Ignore errors in batch
          }
        })
      )

      // Yield between batches
      if (i + this.config.batchSize < clients.length) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
  }

  // ==========================================================================
  // BACKFILL
  // ==========================================================================

  /**
   * Perform backfill for a new subscription
   */
  private async performBackfill(ws: WebSocket, subscription: Subscription): Promise<void> {
    if (!this.config.eventStore) return

    const clientState = this.clients.get(ws)
    if (!clientState) return

    const limit = subscription.filter.backfillLimit ?? this.config.defaultBackfillLimit

    const events = this.config.eventStore.getRecentEvents({
      $type: subscription.filter.$type,
      $id: subscription.filter.$id,
      limit,
    })

    // Schedule backfill asynchronously
    setTimeout(async () => {
      for (const event of events) {
        if (ws.readyState !== WebSocket.OPEN) break

        const message = this.createMessage(event, subscription, {
          backfill: true,
          historical: true,
        })

        await this.sendToClient(ws, clientState, message)
      }
    }, 0)
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  /**
   * Get overall broadcast statistics
   */
  getStats(): BroadcastStats {
    return {
      totalSubscriptions: this.getTotalSubscriptions(),
      totalClients: this.clients.size,
      totalBroadcasts: this._totalBroadcasts,
      totalMessagesSent: this._totalMessagesSent,
      lastBroadcastLatencyMs: this._lastBroadcastLatencyMs,
      avgBroadcastLatencyMs:
        this._broadcastLatencyCount > 0
          ? this._broadcastLatencySum / this._broadcastLatencyCount
          : undefined,
    }
  }

  /**
   * Get per-client statistics
   */
  getClientStats(ws: WebSocket): ClientStats {
    const clientState = this.clients.get(ws)
    if (!clientState) {
      return {
        messagesReceived: 0,
        subscriptionCount: 0,
        droppedCount: 0,
        errorCount: 0,
        queuedCount: 0,
      }
    }

    return {
      messagesReceived: clientState.messagesReceived,
      subscriptionCount: clientState.subscriptions.size,
      droppedCount: clientState.droppedCount,
      errorCount: clientState.errorCount,
      queuedCount: clientState.messageQueue.length,
    }
  }

  /**
   * Get queued message count for a client
   */
  getQueuedCount(ws: WebSocket): number {
    const clientState = this.clients.get(ws)
    return clientState?.messageQueue.length ?? 0
  }

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  /**
   * Register error handler
   */
  onError(handler: (client: WebSocket, error: Error) => void): void {
    this.errorHandlers.push(handler)
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  /**
   * Check if broadcaster is closed
   */
  isClosed(): boolean {
    return this._closed
  }

  /**
   * Close the broadcaster
   */
  async close(): Promise<void> {
    if (this._closed) return

    this._closed = true

    // Flush all coalesced messages
    for (const [key, entry] of this.coalesceBuffer) {
      if (entry.timer) {
        clearTimeout(entry.timer)
      }
      await this.flushCoalesced(key, entry)
    }

    // Clear all state
    this.clients.clear()
    this.typeSubscribers.clear()
    this.idSubscribers.clear()
    this.wildcardSubscribers.clear()
    this.coalesceBuffer.clear()
  }
}
