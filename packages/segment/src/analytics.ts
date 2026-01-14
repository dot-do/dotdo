/**
 * @dotdo/segment - Analytics Implementation
 *
 * Edge-compatible Segment SDK implementation.
 * Provides customer data platform APIs: identify, track, page, screen, group, alias.
 *
 * @module @dotdo/segment/analytics
 */

import type {
  AnalyticsOptions,
  IdentifyMessage,
  TrackMessage,
  PageMessage,
  ScreenMessage,
  GroupMessage,
  AliasMessage,
  BatchMessage,
  BatchPayload,
  SegmentEvent,
  EventType,
  Context,
  Transport,
  TransportResult,
  Destination,
  Plugin,
  SourceMiddleware,
  Callback,
  Integrations,
} from './types.js'
import { RecordingTransport } from './backend.js'

// =============================================================================
// Constants
// =============================================================================

const SDK_NAME = '@dotdo/segment'
const SDK_VERSION = '0.1.0'
const DEFAULT_HOST = 'https://api.segment.io'
const DEFAULT_PATH = '/v1/batch'
const DEFAULT_FLUSH_AT = 20
const DEFAULT_FLUSH_INTERVAL = 10000

// =============================================================================
// Utilities
// =============================================================================

/**
 * Generate a UUID v4 message ID.
 */
function generateMessageId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // Set version 4
  const byte6 = bytes[6]
  const byte8 = bytes[8]
  if (byte6 !== undefined) {
    bytes[6] = (byte6 & 0x0f) | 0x40
  }
  // Set variant
  if (byte8 !== undefined) {
    bytes[8] = (byte8 & 0x3f) | 0x80
  }

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Get ISO timestamp.
 */
function getTimestamp(): string {
  return new Date().toISOString()
}

/**
 * Build default library context.
 */
function buildLibraryContext(): Context {
  return {
    library: {
      name: SDK_NAME,
      version: SDK_VERSION,
    },
  }
}

/**
 * Deep merge two objects.
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target }

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key]
    const targetValue = target[key]

    if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T]
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T]
    }
  }

  return result
}

// =============================================================================
// FetchTransport
// =============================================================================

/**
 * HTTP transport using fetch.
 */
export class FetchTransport implements Transport {
  private readonly url: string
  private readonly writeKey: string
  private readonly fetchImpl: typeof fetch
  private events: SegmentEvent[] = []
  private batches: BatchPayload[] = []

  constructor(options: { writeKey: string; host?: string; path?: string }) {
    this.writeKey = options.writeKey
    this.url = `${options.host || DEFAULT_HOST}${options.path || DEFAULT_PATH}`
    this.fetchImpl = globalThis.fetch
  }

  async send(payload: BatchPayload): Promise<TransportResult> {
    this.batches.push(payload)
    this.events.push(...payload.batch)

    const auth = btoa(`${this.writeKey}:`)

    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify(payload),
      })

      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key] = value
      })

      return {
        statusCode: response.status,
        headers,
      }
    } catch {
      return { statusCode: 0 }
    }
  }

  async flush(_timeout?: number): Promise<boolean> {
    return true
  }

  getEvents(): SegmentEvent[] {
    return [...this.events]
  }

  getBatches(): BatchPayload[] {
    return [...this.batches]
  }
}

// =============================================================================
// Analytics Implementation
// =============================================================================

/**
 * Segment Analytics client.
 */
export class Analytics {
  readonly writeKey: string
  readonly host: string
  readonly flushAt: number
  readonly flushInterval: number

  private readonly transport: Transport
  private readonly defaultIntegrations: Integrations
  private readonly plugins: Plugin[]
  private readonly errorHandler?: (error: Error) => void

  private queue: SegmentEvent[] = []
  private destinations: Destination[] = []
  private sourceMiddlewares: SourceMiddleware[] = []
  private flushTimer?: ReturnType<typeof setTimeout>
  private pendingCallbacks: Array<{ callback: Callback; eventCount: number }> = []
  private disabled: boolean
  private ready_: boolean = false
  private readyPromise: Promise<void>
  private readyResolve!: () => void

  /** Global context to merge with all events */
  context: Partial<Context> = {}

  constructor(options: AnalyticsOptions) {
    this.writeKey = options.writeKey
    this.host = options.host || DEFAULT_HOST
    this.flushAt = options.flushAt ?? DEFAULT_FLUSH_AT
    this.flushInterval = options.flushInterval ?? DEFAULT_FLUSH_INTERVAL
    this.defaultIntegrations = options.integrations || {}
    this.plugins = options.plugins || []
    this.errorHandler = options.errorHandler
    this.disabled = options.disable || false

    // Create transport
    this.transport = options.transport
      ? options.transport({ writeKey: this.writeKey })
      : new FetchTransport({
          writeKey: this.writeKey,
          host: options.host,
          path: options.path,
        })

    // Initialize ready promise
    this.readyPromise = new Promise<void>((resolve) => {
      this.readyResolve = resolve
    })

    // Load plugins
    this.loadPlugins()
  }

  /**
   * Load all registered plugins.
   */
  private async loadPlugins(): Promise<void> {
    for (const plugin of this.plugins) {
      try {
        await plugin.load(this)
      } catch (error) {
        this.handleError(error as Error)
      }
    }
    this.ready_ = true
    this.readyResolve()
  }

  /**
   * Wait for analytics to be ready.
   */
  async ready(): Promise<void> {
    return this.readyPromise
  }

  /**
   * Identify a user.
   */
  identify(message: IdentifyMessage, callback?: Callback): void {
    this.validateIdentity(message)

    const event = this.buildEvent('identify', message, {
      traits: message.traits,
    })

    this.enqueue(event, callback)
  }

  /**
   * Track an event.
   */
  track(message: TrackMessage, callback?: Callback): void {
    this.validateIdentity(message)

    if (!message.event || message.event.trim() === '') {
      throw new Error('Event name is required for track calls')
    }

    const event = this.buildEvent('track', message, {
      event: message.event,
      properties: message.properties,
    })

    this.enqueue(event, callback)
  }

  /**
   * Track a page view.
   */
  page(message: PageMessage, callback?: Callback): void {
    this.validateIdentity(message)

    const event = this.buildEvent('page', message, {
      name: message.name,
      category: message.category,
      properties: message.properties,
    })

    this.enqueue(event, callback)
  }

  /**
   * Track a screen view (mobile).
   */
  screen(message: ScreenMessage, callback?: Callback): void {
    this.validateIdentity(message)

    const event = this.buildEvent('screen', message, {
      name: message.name,
      category: message.category,
      properties: message.properties,
    })

    this.enqueue(event, callback)
  }

  /**
   * Associate user with a group.
   */
  group(message: GroupMessage, callback?: Callback): void {
    this.validateIdentity(message)

    if (!message.groupId || message.groupId.trim() === '') {
      throw new Error('groupId is required for group calls')
    }

    const event = this.buildEvent('group', message, {
      groupId: message.groupId,
      traits: message.traits,
    })

    this.enqueue(event, callback)
  }

  /**
   * Alias user IDs.
   */
  alias(message: AliasMessage, callback?: Callback): void {
    if (!message.previousId || message.previousId.trim() === '') {
      throw new Error('previousId is required for alias calls')
    }

    const event = this.buildEvent('alias', message, {
      userId: message.userId,
      previousId: message.previousId,
    })

    this.enqueue(event, callback)
  }

  /**
   * Batch multiple events.
   */
  batch(message: BatchMessage, callback?: Callback): void {
    for (const item of message.batch) {
      const type = item.type || 'track'
      const enriched = this.buildEvent(type, item, item)
      this.queue.push(enriched)
    }

    if (callback) {
      this.pendingCallbacks.push({
        callback,
        eventCount: message.batch.length,
      })
    }
  }

  /**
   * Register a destination.
   */
  register(destination: Destination): void {
    this.destinations.push(destination)
    if (destination.load) {
      destination.load()
    }
  }

  /**
   * Get registered destinations.
   */
  getDestinations(): Destination[] {
    return [...this.destinations]
  }

  /**
   * Add source middleware.
   */
  addSourceMiddleware(middleware: SourceMiddleware): void {
    this.sourceMiddlewares.push(middleware)
  }

  /**
   * Flush all queued events.
   */
  async flush(): Promise<boolean> {
    if (this.disabled || this.queue.length === 0) {
      // Call pending callbacks even if no events
      this.invokePendingCallbacks()
      return true
    }

    // Clear any pending flush timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }

    // Get queued events
    const events = [...this.queue]
    this.queue = []

    // Forward to destinations
    await this.forwardToDestinations(events)

    // Build and send batch payload
    const payload: BatchPayload = {
      batch: events,
      sentAt: getTimestamp(),
      writeKey: this.writeKey,
    }

    try {
      await this.transport.send(payload)
      this.invokePendingCallbacks()
      return true
    } catch (error) {
      this.handleError(error as Error)
      this.invokePendingCallbacks(error as Error)
      return false
    }
  }

  /**
   * Close analytics and flush pending events.
   */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
    }
    await this.flush()

    // Unload destinations
    for (const destination of this.destinations) {
      if (destination.unload) {
        await destination.unload()
      }
    }

    // Unload plugins
    for (const plugin of this.plugins) {
      if (plugin.unload) {
        await plugin.unload()
      }
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Validate that message has userId or anonymousId.
   */
  private validateIdentity(message: { userId?: string; anonymousId?: string }): void {
    if (!message.userId && !message.anonymousId) {
      throw new Error('Either userId or anonymousId is required')
    }
  }

  /**
   * Build a segment event from a message.
   */
  private buildEvent(
    type: EventType,
    message: {
      userId?: string
      anonymousId?: string
      timestamp?: string | Date
      context?: Context
      integrations?: Integrations
    },
    extra: Partial<SegmentEvent>
  ): SegmentEvent {
    // Build base context
    let context = buildLibraryContext()

    // Merge global context
    if (this.context && Object.keys(this.context).length > 0) {
      context = deepMerge(context, this.context)
    }

    // Merge message context
    if (message.context) {
      context = deepMerge(context, message.context)
    }

    // Build integrations
    const integrations = {
      ...this.defaultIntegrations,
      ...message.integrations,
    }

    // Build timestamp
    const timestamp =
      message.timestamp instanceof Date
        ? message.timestamp.toISOString()
        : message.timestamp || getTimestamp()

    // Build the event
    let event: SegmentEvent = {
      type,
      messageId: generateMessageId(),
      timestamp,
      userId: message.userId,
      anonymousId: message.anonymousId,
      context,
      integrations,
      ...extra,
    }

    // Apply source middlewares
    for (const middleware of this.sourceMiddlewares) {
      const result = middleware(event)
      if (result === null) {
        // Event dropped by middleware - mark it for dropping
        return { ...event, _dropped: true } as SegmentEvent
      }
      event = result
    }

    return event
  }

  /**
   * Enqueue an event for sending.
   */
  private enqueue(event: SegmentEvent, callback?: Callback): void {
    if (this.disabled) {
      callback?.()
      return
    }

    // Check if event was dropped by middleware
    if ((event as SegmentEvent & { _dropped?: boolean })._dropped) {
      callback?.()
      return
    }

    this.queue.push(event)

    // Record event immediately in transport (for testing)
    if ('recordEvent' in this.transport && typeof (this.transport as RecordingTransport).recordEvent === 'function') {
      (this.transport as RecordingTransport).recordEvent(event)
    }

    if (callback) {
      this.pendingCallbacks.push({ callback, eventCount: 1 })
    }

    // Check if we should auto-flush
    if (this.queue.length >= this.flushAt) {
      this.flush()
    } else {
      this.scheduleFlush()
    }
  }

  /**
   * Schedule a flush based on flushInterval.
   */
  private scheduleFlush(): void {
    if (this.flushTimer) return

    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.flush()
    }, this.flushInterval)
  }

  /**
   * Forward events to registered destinations.
   */
  private async forwardToDestinations(events: SegmentEvent[]): Promise<void> {
    for (const event of events) {
      for (const destination of this.destinations) {
        // Check if destination is enabled for this event
        if (!this.isDestinationEnabled(event, destination)) {
          continue
        }

        try {
          switch (event.type) {
            case 'track':
              await destination.track(event)
              break
            case 'identify':
              await destination.identify(event)
              break
            case 'page':
              await destination.page(event)
              break
            case 'screen':
              await destination.screen(event)
              break
            case 'group':
              await destination.group(event)
              break
            case 'alias':
              await destination.alias(event)
              break
          }
        } catch (error) {
          this.handleError(error as Error)
        }
      }
    }
  }

  /**
   * Check if a destination is enabled for an event.
   */
  private isDestinationEnabled(event: SegmentEvent, destination: Destination): boolean {
    const integrations = event.integrations || {}

    // Check specific destination setting
    const destinationSetting = integrations[destination.name]
    if (destinationSetting === false) {
      return false
    }

    // Check All setting
    if (integrations.All === false && destinationSetting !== true) {
      return false
    }

    return true
  }

  /**
   * Invoke pending callbacks.
   */
  private invokePendingCallbacks(error?: Error): void {
    for (const { callback } of this.pendingCallbacks) {
      try {
        callback(error)
      } catch {
        // Ignore callback errors
      }
    }
    this.pendingCallbacks = []
  }

  /**
   * Handle an error.
   */
  private handleError(error: Error): void {
    if (this.errorHandler) {
      try {
        this.errorHandler(error)
      } catch {
        // Ignore error handler errors
      }
    }
  }
}
