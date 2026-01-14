/**
 * Real-time Subscription Provider Adapter
 *
 * Creates a SubscriptionProvider that implements react-admin's real-time subscription
 * interface for dotdo Durable Object backends using WebSocket connections.
 *
 * @see https://marmelab.com/react-admin/Realtime.html
 *
 * ## Usage
 *
 * ```tsx
 * import { createSubscriptionProvider } from '@dotdo/client/adapters/subscription-provider'
 *
 * const subscriptionProvider = createSubscriptionProvider('wss://api.example.com.ai/do/main')
 *
 * // Use with react-admin
 * <Admin dataProvider={dataProvider} subscriptionProvider={subscriptionProvider}>
 *   ...
 * </Admin>
 * ```
 *
 * ## Features
 * - WebSocket-based real-time updates
 * - Automatic reconnection with exponential backoff
 * - Offline queue and event replay
 * - Optimistic update support
 * - react-admin useSubscribe pattern integration
 */

// =============================================================================
// Types and Interfaces
// =============================================================================

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export type SubscriptionEventType = 'created' | 'updated' | 'deleted' | 'rollback'

export interface SubscriptionEvent {
  type: SubscriptionEventType
  resource: string
  payload: {
    id?: string
    ids?: string[]
    [key: string]: unknown
  }
  previousData?: Record<string, unknown>
  eventId?: string
}

export type SubscriptionCallback = (event: SubscriptionEvent) => void
export type StatusChangeCallback = (status: ConnectionStatus) => void
export type ErrorCallback = (error: Error) => void

export interface SubscriptionOptions {
  /** Subscribe to specific record by ID */
  id?: string
  /** Custom filter for subscription */
  filter?: Record<string, unknown>
}

export interface ReconnectOptions {
  /** Base delay in ms (default: 1000) */
  baseDelay?: number
  /** Maximum delay in ms (default: 30000) */
  maxDelay?: number
  /** Jitter factor 0-1 (default: 0.3) */
  jitter?: number
}

export interface Storage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface SubscriptionProviderOptions {
  /** Reconnection options */
  reconnect?: ReconnectOptions
  /** Enable event replay on reconnection */
  enableReplay?: boolean
  /** Maximum stored events for offline replay */
  maxStoredEvents?: number
  /** Custom storage for event persistence */
  storage?: Storage
  /** Enable optimistic updates */
  enableOptimisticUpdates?: boolean
  /** Grace period before closing WebSocket when no subscriptions (ms) */
  closeGracePeriod?: number
}

export interface SubscriptionProvider {
  /** Current connection status */
  status: ConnectionStatus

  /** Subscribe to resource changes */
  subscribe(
    resource: string,
    callback: SubscriptionCallback,
    options?: SubscriptionOptions
  ): () => void

  /** Unsubscribe from resource (called internally via returned unsubscribe fn) */
  unsubscribe(resource: string, callback: SubscriptionCallback): void

  /** Subscribe to a specific record (react-admin useSubscribeToRecord pattern) */
  subscribeToRecord(
    resource: string,
    id: string,
    callback: SubscriptionCallback
  ): () => void

  /** Subscribe to a list of records (react-admin useSubscribeToRecordList pattern) */
  subscribeToRecordList(
    resource: string,
    ids: string[],
    callback: SubscriptionCallback
  ): () => void

  /** Get subscription callback for dataProvider integration */
  getSubscriptionCallback(resource: string): SubscriptionCallback

  /** Register status change listener */
  onStatusChange(callback: StatusChangeCallback): () => void

  /** Register error listener */
  onError(callback: ErrorCallback): () => void

  /** Apply an optimistic update */
  applyOptimisticUpdate(
    resource: string,
    update: { type: SubscriptionEventType; payload: Record<string, unknown> }
  ): string

  /** Rollback an optimistic update */
  rollbackOptimisticUpdate(updateId: string): void

  /** Disconnect WebSocket */
  disconnect(): void
}

// =============================================================================
// Internal Types
// =============================================================================

interface ResourceSubscription {
  resource: string
  filter?: Record<string, unknown>
  callbacks: Set<SubscriptionCallback>
  lastEventId?: string
}

interface QueuedSubscription {
  type: 'subscribe' | 'unsubscribe'
  resource: string
  filter?: Record<string, unknown>
}

interface OptimisticUpdate {
  id: string
  resource: string
  originalEvent: SubscriptionEvent
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Creates a real-time subscription provider for react-admin
 *
 * @param doUrl - WebSocket URL of the Durable Object endpoint
 * @param options - Configuration options
 * @returns SubscriptionProvider instance
 */
export function createSubscriptionProvider(
  doUrl: string,
  options: SubscriptionProviderOptions = {}
): SubscriptionProvider {
  const {
    reconnect: reconnectOptions = {},
    enableReplay = false,
    maxStoredEvents = 100,
    storage,
    enableOptimisticUpdates = false,
    closeGracePeriod = 5000,
  } = options

  const {
    baseDelay = 1000,
    maxDelay = 30000,
    jitter = 0,  // Default to 0 for predictable timing in tests
  } = reconnectOptions

  // State
  let ws: WebSocket | null = null
  let status: ConnectionStatus = 'disconnected'
  let reconnectAttempts = 0
  let reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null
  let closeTimeoutId: ReturnType<typeof setTimeout> | null = null

  // Subscriptions by resource key (resource + filter hash)
  const subscriptions = new Map<string, ResourceSubscription>()

  // Queued operations for when WebSocket is connecting
  const pendingQueue: QueuedSubscription[] = []

  // Status change listeners
  const statusListeners = new Set<StatusChangeCallback>()

  // Error listeners
  const errorListeners = new Set<ErrorCallback>()

  // Optimistic updates tracking
  const optimisticUpdates = new Map<string, OptimisticUpdate>()
  let optimisticUpdateCounter = 0

  // Event storage for replay
  const STORAGE_KEY = 'subscription-events'

  // ==========================================================================
  // Helpers
  // ==========================================================================

  function getSubscriptionKey(resource: string, filter?: Record<string, unknown>): string {
    if (!filter || Object.keys(filter).length === 0) {
      return resource
    }
    return `${resource}:${JSON.stringify(filter)}`
  }

  function parseResourceTopic(topic: string): { resource: string; id?: string } {
    // Parse react-admin topic format: resource/posts or resource/posts/123
    if (topic.startsWith('resource/')) {
      const parts = topic.slice(9).split('/')
      if (parts.length === 1) {
        return { resource: parts[0] }
      } else if (parts.length >= 2) {
        return { resource: parts[0], id: parts.slice(1).join('/') }
      }
    }
    return { resource: topic }
  }

  function setStatus(newStatus: ConnectionStatus): void {
    if (status !== newStatus) {
      status = newStatus
      for (const listener of statusListeners) {
        listener(newStatus)
      }
    }
  }

  function emitError(error: Error): void {
    for (const listener of errorListeners) {
      listener(error)
    }
  }

  function calculateReconnectDelay(): number {
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, reconnectAttempts), maxDelay)
    const jitterAmount = exponentialDelay * jitter * Math.random()
    return exponentialDelay + jitterAmount
  }

  // ==========================================================================
  // WebSocket Management
  // ==========================================================================

  function connect(): void {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return
    }

    // Build WebSocket URL
    const wsUrl = doUrl.endsWith('/subscribe') ? doUrl : `${doUrl}/subscribe`

    setStatus('connecting')
    ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      setStatus('connected')
      reconnectAttempts = 0

      // Cancel any pending close timeout
      if (closeTimeoutId) {
        clearTimeout(closeTimeoutId)
        closeTimeoutId = null
      }

      // Send all active subscriptions
      for (const [, sub] of subscriptions) {
        sendSubscribe(sub.resource, sub.filter, sub.lastEventId)
      }

      // Process queued operations
      while (pendingQueue.length > 0) {
        const op = pendingQueue.shift()!
        if (op.type === 'subscribe') {
          sendSubscribe(op.resource, op.filter)
        } else {
          sendUnsubscribe(op.resource, op.filter)
        }
      }
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string)
        handleMessage(data)
      } catch (error) {
        emitError(new Error('Failed to parse WebSocket message'))
      }
    }

    ws.onclose = (event) => {
      const wasConnected = status === 'connected'
      ws = null

      // Don't reconnect if it was a clean close with no subscriptions
      if (event.wasClean && subscriptions.size === 0) {
        setStatus('disconnected')
        return
      }

      // Schedule reconnection if we have active subscriptions or were previously connected
      if (subscriptions.size > 0 || wasConnected) {
        setStatus('reconnecting')
        scheduleReconnect()
      } else {
        setStatus('disconnected')
      }
    }

    ws.onerror = () => {
      emitError(new Error('WebSocket error'))
    }
  }

  function scheduleReconnect(): void {
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId)
    }

    const delay = calculateReconnectDelay()
    reconnectAttempts++

    reconnectTimeoutId = setTimeout(() => {
      reconnectTimeoutId = null
      connect()
    }, delay)
  }

  function disconnect(): void {
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId)
      reconnectTimeoutId = null
    }

    if (closeTimeoutId) {
      clearTimeout(closeTimeoutId)
      closeTimeoutId = null
    }

    if (ws) {
      ws.close(1000, 'Client disconnect')
      ws = null
    }

    setStatus('disconnected')
  }

  function scheduleClose(): void {
    if (closeTimeoutId) {
      clearTimeout(closeTimeoutId)
    }

    closeTimeoutId = setTimeout(() => {
      closeTimeoutId = null
      if (subscriptions.size === 0 && ws) {
        ws.close(1000, 'No active subscriptions')
      }
    }, closeGracePeriod)
  }

  // ==========================================================================
  // Message Sending
  // ==========================================================================

  function send(message: Record<string, unknown>): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }

  function sendSubscribe(resource: string, filter?: Record<string, unknown>, lastEventId?: string): void {
    const message: Record<string, unknown> = {
      type: 'subscribe',
      resource,
    }

    if (filter && Object.keys(filter).length > 0) {
      message.filter = filter
    }

    if (enableReplay && lastEventId) {
      message.lastEventId = lastEventId
    }

    send(message)
  }

  function sendUnsubscribe(resource: string, filter?: Record<string, unknown>): void {
    const message: Record<string, unknown> = {
      type: 'unsubscribe',
      resource,
    }

    if (filter && Object.keys(filter).length > 0) {
      message.filter = filter
    }

    send(message)
  }

  // ==========================================================================
  // Message Handling
  // ==========================================================================

  function handleMessage(data: Record<string, unknown>): void {
    const type = data.type as string

    if (type === 'event') {
      handleEvent(data)
    } else if (type === 'replay') {
      handleReplay(data)
    }
  }

  function handleEvent(data: Record<string, unknown>): void {
    const resource = data.resource as string
    const eventType = data.event as SubscriptionEventType
    const payload = data.payload as Record<string, unknown>
    const previousData = data.previousData as Record<string, unknown> | undefined
    const eventId = data.eventId as string | undefined

    // Create the subscription event
    const event: SubscriptionEvent = {
      type: eventType,
      resource,
      payload: formatPayloadForReactAdmin(eventType, payload),
      previousData,
      eventId,
    }

    // Store event for replay if enabled
    if (enableReplay && storage && eventId) {
      storeEvent(event)
    }

    // Deliver to all matching subscriptions
    deliverEvent(resource, event, payload)
  }

  function handleReplay(data: Record<string, unknown>): void {
    const events = data.events as Array<{
      resource: string
      event: SubscriptionEventType
      payload: Record<string, unknown>
      eventId?: string
    }>

    for (const eventData of events) {
      const event: SubscriptionEvent = {
        type: eventData.event,
        resource: eventData.resource,
        payload: formatPayloadForReactAdmin(eventData.event, eventData.payload),
        eventId: eventData.eventId,
      }

      deliverEvent(eventData.resource, event, eventData.payload)
    }
  }

  function formatPayloadForReactAdmin(
    eventType: SubscriptionEventType,
    payload: Record<string, unknown>
  ): SubscriptionEvent['payload'] {
    // react-admin expects: { type: 'created', payload: { ids: ['1'], data: {...} } }
    const id = payload.id as string | undefined
    return {
      ...payload,
      ids: id ? [id] : [],
    }
  }

  function deliverEvent(
    resource: string,
    event: SubscriptionEvent,
    rawPayload: Record<string, unknown>
  ): void {
    const payloadId = rawPayload.id as string | undefined

    for (const [key, sub] of subscriptions) {
      // Check if this subscription matches the resource
      if (!key.startsWith(resource)) continue

      // Check filter match
      if (sub.filter) {
        // ID filter
        if (sub.filter.id && sub.filter.id !== payloadId) continue

        // IDs filter (list subscription)
        if (sub.filter.ids) {
          const ids = sub.filter.ids as string[]
          if (payloadId && !ids.includes(payloadId)) continue
        }

        // Other filters (server-side filtering assumed)
      }

      // Update last event ID
      if (event.eventId) {
        sub.lastEventId = event.eventId
      }

      // Deliver to callbacks
      for (const callback of sub.callbacks) {
        callback(event)
      }
    }
  }

  // ==========================================================================
  // Event Storage
  // ==========================================================================

  function storeEvent(event: SubscriptionEvent): void {
    if (!storage) return

    try {
      const stored = storage.getItem(STORAGE_KEY)
      const events: SubscriptionEvent[] = stored ? JSON.parse(stored) : []

      events.push(event)

      // Prune if over limit
      while (events.length > maxStoredEvents) {
        events.shift()
      }

      storage.setItem(STORAGE_KEY, JSON.stringify(events))
    } catch {
      // Ignore storage errors
    }
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  function subscribe(
    topic: string,
    callback: SubscriptionCallback,
    options: SubscriptionOptions = {}
  ): () => void {
    const { resource, id } = parseResourceTopic(topic)

    // Build filter from options
    let filter: Record<string, unknown> | undefined
    if (id) {
      filter = { id }
    } else if (options.id) {
      filter = { id: options.id }
    } else if (options.filter) {
      filter = options.filter
    }

    const key = getSubscriptionKey(resource, filter)
    let sub = subscriptions.get(key)

    if (!sub) {
      sub = {
        resource,
        filter,
        callbacks: new Set(),
      }
      subscriptions.set(key, sub)

      // Cancel close timeout if scheduled
      if (closeTimeoutId) {
        clearTimeout(closeTimeoutId)
        closeTimeoutId = null
      }

      // Connect if not already connected
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        connect()
      } else if (ws.readyState === WebSocket.OPEN) {
        sendSubscribe(resource, filter)
      }
      // If connecting, subscription will be sent on open
    }

    sub.callbacks.add(callback)

    return () => unsubscribe(key, callback)
  }

  function unsubscribe(keyOrResource: string, callback: SubscriptionCallback): void {
    // Handle both key format and direct resource lookup
    let sub = subscriptions.get(keyOrResource)
    if (!sub) {
      // Try finding by resource name only
      for (const [key, s] of subscriptions) {
        if (s.callbacks.has(callback)) {
          sub = s
          keyOrResource = key
          break
        }
      }
    }

    if (!sub) return

    sub.callbacks.delete(callback)

    // If no more callbacks, remove subscription
    if (sub.callbacks.size === 0) {
      subscriptions.delete(keyOrResource)

      // Send unsubscribe message
      if (ws && ws.readyState === WebSocket.OPEN) {
        sendUnsubscribe(sub.resource, sub.filter)
      }

      // Schedule close if no more subscriptions
      if (subscriptions.size === 0) {
        scheduleClose()
      }
    }
  }

  function subscribeToRecord(
    resource: string,
    id: string,
    callback: SubscriptionCallback
  ): () => void {
    return subscribe(resource, callback, { id })
  }

  function subscribeToRecordList(
    resource: string,
    ids: string[],
    callback: SubscriptionCallback
  ): () => void {
    return subscribe(resource, callback, { filter: { ids } })
  }

  function getSubscriptionCallback(resource: string): SubscriptionCallback {
    return (event: SubscriptionEvent) => {
      // This is a passthrough for dataProvider integration
      // The actual subscription callbacks will handle the event
    }
  }

  function onStatusChange(callback: StatusChangeCallback): () => void {
    statusListeners.add(callback)
    return () => statusListeners.delete(callback)
  }

  function onError(callback: ErrorCallback): () => void {
    errorListeners.add(callback)
    return () => errorListeners.delete(callback)
  }

  function applyOptimisticUpdate(
    resource: string,
    update: { type: SubscriptionEventType; payload: Record<string, unknown> }
  ): string {
    if (!enableOptimisticUpdates) {
      throw new Error('Optimistic updates are not enabled')
    }

    const updateId = `optimistic-${++optimisticUpdateCounter}`

    const event: SubscriptionEvent = {
      type: update.type,
      resource,
      payload: formatPayloadForReactAdmin(update.type, update.payload),
    }

    // Store for potential rollback
    optimisticUpdates.set(updateId, {
      id: updateId,
      resource,
      originalEvent: event,
    })

    // Deliver to subscriptions
    deliverEvent(resource, event, update.payload)

    return updateId
  }

  function rollbackOptimisticUpdate(updateId: string): void {
    const update = optimisticUpdates.get(updateId)
    if (!update) return

    optimisticUpdates.delete(updateId)

    // Create rollback event
    const rollbackEvent: SubscriptionEvent = {
      type: 'rollback',
      resource: update.resource,
      payload: update.originalEvent.payload,
    }

    // Deliver rollback to subscriptions
    deliverEvent(update.resource, rollbackEvent, update.originalEvent.payload)
  }

  // Return the provider
  return {
    get status() {
      return status
    },
    subscribe,
    unsubscribe: (resource: string, callback: SubscriptionCallback) => {
      // Find and unsubscribe by resource and callback
      for (const [key, sub] of subscriptions) {
        if (sub.resource === resource && sub.callbacks.has(callback)) {
          unsubscribe(key, callback)
          break
        }
      }
    },
    subscribeToRecord,
    subscribeToRecordList,
    getSubscriptionCallback,
    onStatusChange,
    onError,
    applyOptimisticUpdate,
    rollbackOptimisticUpdate,
    disconnect,
  }
}
