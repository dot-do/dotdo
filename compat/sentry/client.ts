/**
 * @dotdo/sentry - Client Module
 *
 * Enhanced Sentry client with TemporalStore for event persistence
 * and WindowManager for batched sending.
 *
 * @module @dotdo/sentry/client
 */

import type {
  SentryOptions,
  SentryEvent,
  Breadcrumb,
  User,
  Tags,
  Extras,
  Context,
  SeverityLevel,
  EventHint,
  Transport,
  Envelope,
  TransportResult,
  ParsedDsn,
  Scope as IScope,
} from './types.js'

import { Scope } from './sentry.js'
import {
  createEventId,
  createExceptionEvent,
  createMessageEvent,
  createCheckInItem,
  filterPII,
  parseRateLimitHeaders,
  type CheckInOptions,
} from './capture.js'
import {
  configureTransactionHub,
  clearTransactionHub,
} from './transactions.js'
import { createTemporalStore, type TemporalStore } from '../../db/primitives/temporal-store.js'
import {
  WindowManager,
  CountTrigger,
  ProcessingTimeTrigger,
  Trigger,
  TriggerResult,
  milliseconds,
  type Duration,
} from '../../db/primitives/window-manager.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Extended options for SentryClientWithStorage.
 */
export interface StorageClientOptions extends SentryOptions {
  /** Custom event store (defaults to in-memory TemporalStore) */
  eventStore?: TemporalStore<SentryEvent>
  /** Enable offline queueing */
  offlineQueueing?: boolean
  /** Function to check online status */
  isOnline?: () => boolean
  /** Callback for event replay */
  onReplay?: (event: SentryEvent) => void
}

/**
 * Options for BatchingTransport.
 */
export interface BatchingOptions {
  /** Trigger batch send after this many events */
  batchSize: number
  /** Maximum batch size (hard limit) */
  maxBatchSize?: number
  /** Flush interval */
  flushInterval: Duration
  /** Callback when batch is sent */
  onBatch?: (events: SentryEvent[]) => void
  /** Callback when flush occurs */
  onFlush?: () => void
}

/**
 * Factory options for createStorageClient.
 */
export interface StorageClientFactoryOptions extends StorageClientOptions {
  /** Batching configuration */
  batching?: {
    enabled: boolean
  } & Partial<BatchingOptions>
}

// =============================================================================
// Utilities
// =============================================================================

const SDK_NAME = '@dotdo/sentry'
const SDK_VERSION = '0.1.0'

/**
 * Parse a Sentry DSN string.
 */
export function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn)
    const pathParts = url.pathname.split('/')
    const projectId = pathParts.pop() || ''

    return {
      protocol: url.protocol.replace(':', ''),
      publicKey: url.username,
      secretKey: url.password || undefined,
      host: url.hostname,
      port: url.port || undefined,
      path: pathParts.join('/') || undefined,
      projectId,
    }
  } catch {
    return null
  }
}

/**
 * Build the Sentry API URL from parsed DSN.
 */
function buildApiUrl(dsn: ParsedDsn): string {
  const { protocol, host, port, path, projectId } = dsn
  const portStr = port ? `:${port}` : ''
  const pathStr = path ? path : ''
  return `${protocol}://${host}${portStr}${pathStr}/api/${projectId}/envelope/`
}

// =============================================================================
// Batching Transport
// =============================================================================

/**
 * Transport that batches events using WindowManager.
 */
export class BatchingTransport implements Transport {
  private readonly inner: Transport
  private readonly options: BatchingOptions
  private readonly windowManager: WindowManager<SentryEvent>
  private pendingEvents: SentryEvent[] = []
  private disposed = false

  constructor(inner: Transport, options: BatchingOptions) {
    this.inner = inner
    this.options = {
      maxBatchSize: options.maxBatchSize ?? options.batchSize * 2,
      ...options,
    }

    // Create window manager with tumbling windows
    const assigner = WindowManager.tumbling<SentryEvent>(options.flushInterval)
    this.windowManager = new WindowManager(assigner)

    // Set up count-based trigger
    this.windowManager.withTrigger(new CountTrigger(options.batchSize))

    // Handle window triggers
    this.windowManager.onTrigger((window, events) => {
      this.sendBatch(events)
    })

    // Set up periodic flush using interval
    this.setupPeriodicFlush()
  }

  private setupPeriodicFlush(): void {
    const intervalMs = this.options.flushInterval.toMillis()

    const flushInterval = setInterval(() => {
      if (this.disposed) {
        clearInterval(flushInterval)
        return
      }

      if (this.pendingEvents.length > 0) {
        this.sendBatch([...this.pendingEvents])
        this.pendingEvents = []
        this.options.onFlush?.()
      }
    }, intervalMs)

    // Allow cleanup
    ;(this as any)._flushInterval = flushInterval
  }

  async send(envelope: Envelope): Promise<TransportResult> {
    if (this.disposed) {
      return { statusCode: 0 }
    }

    const [header, items] = envelope

    // Extract events from envelope
    for (const [itemHeader, payload] of items) {
      if (itemHeader.type === 'event' && payload) {
        const event = payload as SentryEvent
        this.pendingEvents.push(event)

        // Check if we've hit the batch size
        if (this.pendingEvents.length >= this.options.batchSize) {
          const batch = this.pendingEvents.splice(0, this.options.batchSize)
          this.sendBatch(batch)
        }
      } else {
        // Non-event items are sent immediately
        await this.inner.send([header, [[itemHeader, payload]]])
      }
    }

    return { statusCode: 200 }
  }

  private async sendBatch(events: SentryEvent[]): Promise<void> {
    if (events.length === 0) return

    this.options.onBatch?.(events)

    // Split into max batch sizes
    const batches: SentryEvent[][] = []
    const maxSize = this.options.maxBatchSize ?? events.length

    for (let i = 0; i < events.length; i += maxSize) {
      batches.push(events.slice(i, i + maxSize))
    }

    for (const batch of batches) {
      const items: Array<[{ type: 'event' }, SentryEvent]> = batch.map((event) => [
        { type: 'event' },
        event,
      ])

      const envelope: Envelope = [
        {
          event_id: batch[0]?.event_id,
          sent_at: new Date().toISOString(),
          sdk: { name: SDK_NAME, version: SDK_VERSION },
        },
        items,
      ]

      await this.inner.send(envelope)
    }
  }

  async flush(timeout?: number): Promise<boolean> {
    if (this.pendingEvents.length > 0) {
      await this.sendBatch([...this.pendingEvents])
      this.pendingEvents = []
    }

    return this.inner.flush(timeout)
  }

  dispose(): void {
    this.disposed = true
    this.windowManager.dispose()

    const interval = (this as any)._flushInterval
    if (interval) {
      clearInterval(interval)
    }

    // Flush remaining events
    if (this.pendingEvents.length > 0) {
      this.sendBatch([...this.pendingEvents])
      this.pendingEvents = []
    }
  }
}

// =============================================================================
// Storage Client
// =============================================================================

/**
 * Enhanced Sentry client with TemporalStore for event persistence.
 */
export class SentryClientWithStorage {
  private readonly options: StorageClientOptions
  private readonly dsn: ParsedDsn | undefined
  private readonly transport: Transport | undefined
  private readonly eventStore: TemporalStore<SentryEvent>
  private readonly scope: Scope
  private enabled = true
  private offlineQueue: SentryEvent[] = []

  constructor(options: StorageClientOptions) {
    this.options = {
      sampleRate: 1.0,
      maxBreadcrumbs: 100,
      attachStacktrace: false,
      sendDefaultPii: false,
      offlineQueueing: false,
      ...options,
    }

    // Parse DSN
    if (options.dsn) {
      this.dsn = parseDsn(options.dsn) ?? undefined
    }

    // Set up event store
    this.eventStore = options.eventStore ?? createTemporalStore<SentryEvent>({
      enableTTL: true,
      retention: {
        maxVersions: 1000,
        maxAge: { hours: 24 },
      },
    })

    // Set up transport
    if (this.dsn) {
      this.transport = options.transport
        ? options.transport({ dsn: this.dsn, fetch: globalThis.fetch })
        : this.createDefaultTransport(this.dsn)
    }

    // Create scope
    this.scope = new Scope(options.maxBreadcrumbs)

    // Configure transaction hub
    configureTransactionHub({
      dsn: options.dsn,
      release: options.release,
      environment: options.environment,
      tracesSampleRate: options.tracesSampleRate,
      sendTransaction: (event) => this.sendEvent(event),
    })
  }

  private createDefaultTransport(dsn: ParsedDsn): Transport {
    const url = buildApiUrl(dsn)
    const publicKey = dsn.publicKey

    return {
      async send(envelope: Envelope): Promise<TransportResult> {
        const [header, items] = envelope

        const lines: string[] = []
        lines.push(JSON.stringify(header))

        for (const [itemHeader, payload] of items) {
          lines.push(JSON.stringify(itemHeader))
          lines.push(typeof payload === 'string' ? payload : JSON.stringify(payload))
        }

        const body = lines.join('\n')

        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-sentry-envelope',
              'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=${SDK_NAME}/${SDK_VERSION}, sentry_key=${publicKey}`,
            },
            body,
          })

          const responseHeaders: Record<string, string> = {}
          response.headers.forEach((value, key) => {
            responseHeaders[key] = value
          })

          return {
            statusCode: response.status,
            headers: responseHeaders,
          }
        } catch {
          return { statusCode: 0 }
        }
      },

      async flush(): Promise<boolean> {
        return true
      },
    }
  }

  // ===========================================================================
  // Capture Methods
  // ===========================================================================

  captureException(exception: unknown, hint?: EventHint): string {
    const eventId = createEventId()

    if (!this.shouldSend()) {
      return eventId
    }

    const event = createExceptionEvent(exception, {
      eventId,
      release: this.options.release,
      environment: this.options.environment,
    })

    this.processAndSend(event, hint)

    return eventId
  }

  captureMessage(message: string, level: SeverityLevel = 'info', hint?: EventHint): string {
    const eventId = createEventId()

    if (!this.shouldSend()) {
      return eventId
    }

    const event = createMessageEvent(message, {
      eventId,
      level,
      release: this.options.release,
      environment: this.options.environment,
      attachStacktrace: this.options.attachStacktrace,
    })

    this.processAndSend(event, hint)

    return eventId
  }

  captureEvent(event: SentryEvent, hint?: EventHint): string {
    const eventId = event.event_id ?? createEventId()

    if (!this.shouldSend()) {
      return eventId
    }

    const enriched: SentryEvent = {
      ...event,
      event_id: eventId,
      timestamp: event.timestamp ?? Date.now() / 1000,
      platform: event.platform ?? 'javascript',
      release: event.release ?? this.options.release,
      environment: event.environment ?? this.options.environment,
      sdk: event.sdk ?? { name: SDK_NAME, version: SDK_VERSION },
    }

    this.processAndSend(enriched, hint)

    return eventId
  }

  // ===========================================================================
  // Event Processing
  // ===========================================================================

  private shouldSend(): boolean {
    if (!this.enabled || !this.transport) {
      return false
    }

    const sampleRate = this.options.sampleRate ?? 1.0
    return Math.random() < sampleRate
  }

  private processAndSend(event: SentryEvent, hint?: EventHint): void {
    // Apply scope
    let processed = this.scope.applyToEvent(event)

    // Filter PII
    processed = filterPII(processed, { sendDefaultPii: this.options.sendDefaultPii })

    // Run beforeSend hook
    if (this.options.beforeSend) {
      const result = this.options.beforeSend(processed, hint ?? {})
      if (result === null) {
        return
      }
      if (result instanceof Promise) {
        result.then((asyncResult) => {
          if (asyncResult) {
            this.sendEvent(asyncResult)
          }
        })
        return
      }
      processed = result
    }

    this.sendEvent(processed)
  }

  private async sendEvent(event: SentryEvent): Promise<void> {
    // Store event in TemporalStore
    const timestamp = Date.now()
    const key = `event:${event.event_id}`
    await this.eventStore.put(key, event, timestamp)

    // Check online status for offline queueing
    if (this.options.offlineQueueing && this.options.isOnline && !this.options.isOnline()) {
      this.offlineQueue.push(event)
      return
    }

    // Send to transport
    if (!this.transport || !this.dsn) {
      return
    }

    const envelope: Envelope = [
      {
        event_id: event.event_id,
        sent_at: new Date().toISOString(),
        dsn: this.options.dsn,
        sdk: { name: SDK_NAME, version: SDK_VERSION },
      },
      [[{ type: 'event' }, event]],
    ]

    this.transport.send(envelope).catch(() => {
      // Silently ignore transport errors
    })
  }

  // ===========================================================================
  // Storage Methods
  // ===========================================================================

  getEventStore(): TemporalStore<SentryEvent> {
    return this.eventStore
  }

  getEventsSince(timestamp: number): SentryEvent[] {
    const events: SentryEvent[] = []
    const iterator = this.eventStore.range('event:', { start: timestamp })

    // Collect events synchronously (for simplicity in tests)
    // In production, you'd use async iteration
    const collectEvents = async () => {
      let result = await iterator.next()
      while (!result.done) {
        events.push(result.value)
        result = await iterator.next()
      }
    }

    // Start collection (fire and forget for sync API)
    collectEvents()

    return events
  }

  async createSnapshot(): Promise<string> {
    return this.eventStore.snapshot()
  }

  async restoreSnapshot(snapshotId: string): Promise<void> {
    await this.eventStore.restoreSnapshot(snapshotId)
  }

  async replayEvents(since: number): Promise<void> {
    const iterator = this.eventStore.range('event:', { start: since })

    let result = await iterator.next()
    while (!result.done) {
      this.options.onReplay?.(result.value)
      result = await iterator.next()
    }
  }

  // ===========================================================================
  // Offline Queue
  // ===========================================================================

  getQueueSize(): number {
    return this.offlineQueue.length
  }

  async flushQueue(): Promise<void> {
    while (this.offlineQueue.length > 0) {
      const event = this.offlineQueue.shift()
      if (event) {
        await this.sendEvent(event)
      }
    }
  }

  // ===========================================================================
  // Scope Methods
  // ===========================================================================

  getScope(): Scope {
    return this.scope
  }

  setUser(user: User | null): void {
    this.scope.setUser(user)
  }

  setTags(tags: Tags): void {
    this.scope.setTags(tags)
  }

  setTag(key: string, value: string): void {
    this.scope.setTag(key, value)
  }

  setExtra(key: string, value: unknown): void {
    this.scope.setExtra(key, value)
  }

  setExtras(extras: Extras): void {
    this.scope.setExtras(extras)
  }

  setContext(name: string, context: Context | null): void {
    this.scope.setContext(name, context)
  }

  addBreadcrumb(breadcrumb: Breadcrumb): void {
    this.scope.addBreadcrumb(breadcrumb, this.options.maxBreadcrumbs)
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  getOptions(): StorageClientOptions {
    return { ...this.options }
  }

  getDsn(): ParsedDsn | undefined {
    return this.dsn
  }

  async flush(timeout?: number): Promise<boolean> {
    if (this.transport) {
      return this.transport.flush(timeout)
    }
    return true
  }

  async close(timeout?: number): Promise<boolean> {
    this.enabled = false
    clearTransactionHub()
    return this.flush(timeout)
  }

  dispose(): void {
    this.enabled = false
    clearTransactionHub()
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a Sentry client with optional storage and batching.
 */
export function createStorageClient(options: StorageClientFactoryOptions): SentryClientWithStorage {
  let transport = options.transport

  // Wrap with batching transport if enabled
  if (options.batching?.enabled && options.dsn) {
    const innerTransport = transport
      ? transport({ dsn: parseDsn(options.dsn)!, fetch: globalThis.fetch })
      : undefined

    if (innerTransport) {
      const batchingTransport = new BatchingTransport(innerTransport, {
        batchSize: options.batching.batchSize ?? 10,
        maxBatchSize: options.batching.maxBatchSize,
        flushInterval: options.batching.flushInterval ?? milliseconds(5000),
        onBatch: options.batching.onBatch,
        onFlush: options.batching.onFlush,
      })

      transport = () => batchingTransport
    }
  }

  return new SentryClientWithStorage({
    ...options,
    transport,
  })
}
