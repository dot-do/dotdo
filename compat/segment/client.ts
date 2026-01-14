/**
 * @dotdo/segment - Analytics Client
 *
 * Edge-compatible analytics client with primitives integration.
 * Provides batching via WindowManager and user routing via KeyedRouter.
 *
 * @module @dotdo/segment/client
 */

import { createKeyedRouter, type KeyedRouter } from '../../db/primitives/keyed-router.js'
import { createTemporalStore, type TemporalStore } from '../../db/primitives/temporal-store.js'
import {
  WindowManager,
  CountTrigger,
  EventTimeTrigger,
  milliseconds,
  type Window,
} from '../../db/primitives/window-manager.js'
import type {
  AnalyticsOptions,
  SegmentEvent,
  Context,
  Transport,
  TransportResult,
  BatchPayload,
  Destination,
  Plugin,
  SourceMiddleware,
  Callback,
  Integrations,
} from './types.js'

// =============================================================================
// Constants
// =============================================================================

const SDK_NAME = '@dotdo/segment'
const SDK_VERSION = '0.1.0'
const DEFAULT_HOST = 'https://api.segment.io'
const DEFAULT_PATH = '/v1/batch'
const DEFAULT_FLUSH_AT = 20
const DEFAULT_FLUSH_INTERVAL = 10000
const DEFAULT_PARTITION_COUNT = 16

// =============================================================================
// Utilities
// =============================================================================

/**
 * Generate a UUID v4 message ID.
 */
export function generateMessageId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const byte6 = bytes[6]
  const byte8 = bytes[8]
  if (byte6 !== undefined) {
    bytes[6] = (byte6 & 0x0f) | 0x40
  }
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
export function getTimestamp(): string {
  return new Date().toISOString()
}

/**
 * Build default library context.
 */
export function buildLibraryContext(): Context {
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
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
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
// Client Options
// =============================================================================

/**
 * Extended options for analytics client with primitives support.
 */
export interface AnalyticsClientOptions extends AnalyticsOptions {
  /** Number of partitions for user routing (default: 16) */
  partitionCount?: number
  /** Enable temporal event storage for replay/debugging */
  enableEventStore?: boolean
  /** Retention period for stored events in ms (default: 24 hours) */
  eventRetention?: number
}

// =============================================================================
// Analytics Client
// =============================================================================

/**
 * Analytics client with primitives integration.
 *
 * Uses:
 * - KeyedRouter for consistent user-to-partition routing
 * - WindowManager for batching events
 * - TemporalStore for event storage and replay
 */
export class AnalyticsClient {
  readonly writeKey: string
  readonly host: string
  readonly flushAt: number
  readonly flushInterval: number

  private readonly transport: Transport
  private readonly defaultIntegrations: Integrations
  private readonly plugins: Plugin[]
  private readonly errorHandler?: (error: Error) => void

  // Primitives
  private readonly router: KeyedRouter<string>
  private readonly eventStore?: TemporalStore<SegmentEvent>
  private readonly batchWindow: WindowManager<SegmentEvent>

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

  constructor(options: AnalyticsClientOptions) {
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
      : this.createDefaultTransport(options)

    // Initialize primitives
    this.router = createKeyedRouter<string>(options.partitionCount ?? DEFAULT_PARTITION_COUNT)

    // Initialize event store if enabled
    if (options.enableEventStore) {
      this.eventStore = createTemporalStore<SegmentEvent>({
        enableTTL: true,
        retention: {
          maxAge: options.eventRetention ?? 24 * 60 * 60 * 1000, // milliseconds
        },
      })
    }

    // Initialize batch window with count trigger
    this.batchWindow = new WindowManager(WindowManager.global<SegmentEvent>())
      .withTrigger(new CountTrigger(this.flushAt))

    this.batchWindow.onTrigger((_window, elements) => {
      this.flushBatch(elements)
    })

    // Initialize ready promise
    this.readyPromise = new Promise<void>((resolve) => {
      this.readyResolve = resolve
    })

    // Load plugins
    this.loadPlugins()
  }

  /**
   * Create default fetch transport.
   */
  private createDefaultTransport(options: AnalyticsClientOptions): Transport {
    const url = `${options.host || DEFAULT_HOST}${options.path || DEFAULT_PATH}`
    const writeKey = this.writeKey
    const events: SegmentEvent[] = []
    const batches: BatchPayload[] = []

    return {
      async send(payload: BatchPayload): Promise<TransportResult> {
        batches.push(payload)
        events.push(...payload.batch)

        const auth = btoa(`${writeKey}:`)

        try {
          const response = await fetch(url, {
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

          return { statusCode: response.status, headers }
        } catch {
          return { statusCode: 0 }
        }
      },
      async flush(): Promise<boolean> {
        return true
      },
      getEvents: () => [...events],
      getBatches: () => [...batches],
    }
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
   * Wait for client to be ready.
   */
  async ready(): Promise<void> {
    return this.readyPromise
  }

  /**
   * Check if client is ready.
   */
  isReady(): boolean {
    return this.ready_
  }

  /**
   * Get partition for a user ID (useful for distributed processing).
   */
  getPartition(userId: string): number {
    return this.router.route(userId)
  }

  /**
   * Route multiple user IDs to their partitions.
   */
  routeUsers(userIds: string[]): Map<number, string[]> {
    return this.router.routeBatch(userIds)
  }

  /**
   * Store an event in the temporal store (if enabled).
   */
  async storeEvent(event: SegmentEvent): Promise<void> {
    if (this.eventStore) {
      const key = event.userId || event.anonymousId || 'unknown'
      const timestamp = new Date(event.timestamp).getTime()
      await this.eventStore.put(`${key}:${event.messageId}`, event, timestamp, {
        ttl: 24 * 60 * 60 * 1000, // 24 hours
      })
    }
  }

  /**
   * Get historical events for a user (if event store enabled).
   */
  async getEventsForUser(userId: string, asOf?: number): Promise<SegmentEvent | null> {
    if (!this.eventStore) return null
    const key = userId
    return asOf
      ? this.eventStore.getAsOf(key, asOf)
      : this.eventStore.get(key)
  }

  /**
   * Enqueue an event for sending.
   */
  enqueue(event: SegmentEvent, callback?: Callback): void {
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

    // Store event if enabled
    this.storeEvent(event)

    // Process through batch window
    const timestamp = new Date(event.timestamp).getTime()
    this.batchWindow.process(event, timestamp)

    // Record event in transport if it supports it
    if ('recordEvent' in this.transport && typeof (this.transport as any).recordEvent === 'function') {
      (this.transport as any).recordEvent(event)
    }

    if (callback) {
      this.pendingCallbacks.push({ callback, eventCount: 1 })
    }

    // Check if we should auto-flush (backup to window manager)
    if (this.queue.length >= this.flushAt) {
      this.flush()
    } else {
      this.scheduleFlush()
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
   * Get source middlewares.
   */
  getSourceMiddlewares(): SourceMiddleware[] {
    return [...this.sourceMiddlewares]
  }

  /**
   * Get default integrations.
   */
  getDefaultIntegrations(): Integrations {
    return { ...this.defaultIntegrations }
  }

  /**
   * Flush batch of events.
   */
  private async flushBatch(events: SegmentEvent[]): Promise<void> {
    if (events.length === 0) return

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
    } catch (error) {
      this.handleError(error as Error)
    }
  }

  /**
   * Flush all queued events.
   */
  async flush(): Promise<boolean> {
    if (this.disabled || this.queue.length === 0) {
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
   * Close client and flush pending events.
   */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
    }

    // Dispose window manager
    this.batchWindow.dispose()

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

    const destinationSetting = integrations[destination.name]
    if (destinationSetting === false) {
      return false
    }

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

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an analytics client instance.
 */
export function createAnalyticsClient(options: AnalyticsClientOptions): AnalyticsClient {
  return new AnalyticsClient(options)
}
