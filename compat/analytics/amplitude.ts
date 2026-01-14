/**
 * @dotdo/analytics - Amplitude SDK Compat Layer
 *
 * Drop-in replacement for @amplitude/analytics-browser backed by Durable Objects.
 *
 * @module @dotdo/analytics/amplitude
 * @see https://amplitude.github.io/Amplitude-TypeScript/
 */

import type {
  AmplitudeOptions,
  AmplitudeEvent,
  AmplitudeEventOptions,
  Properties,
  Transport,
  TransportResult,
  BatchPayload,
  Callback,
  Plugin,
  PluginType,
} from './types.js'
import {
  generateMessageId,
  generateAnonymousId,
  getTimestamp,
  InMemoryTransport,
} from './client.js'

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_SERVER_URL = 'https://api2.amplitude.com/2/httpapi'
const DEFAULT_FLUSH_INTERVAL = 1000
const DEFAULT_FLUSH_QUEUE_SIZE = 30

// =============================================================================
// Identify Class
// =============================================================================

/**
 * Identify operations builder.
 */
export class Identify {
  private operations: {
    $set?: Properties
    $setOnce?: Properties
    $add?: Properties
    $append?: Properties
    $prepend?: Properties
    $unset?: Properties
    $preInsert?: Properties
    $postInsert?: Properties
    $remove?: Properties
    $clearAll?: string
  } = {}

  /**
   * Set user property.
   */
  set(key: string, value: unknown): this {
    if (!this.operations.$set) this.operations.$set = {}
    this.operations.$set[key] = value
    return this
  }

  /**
   * Set user property once (only if not already set).
   */
  setOnce(key: string, value: unknown): this {
    if (!this.operations.$setOnce) this.operations.$setOnce = {}
    this.operations.$setOnce[key] = value
    return this
  }

  /**
   * Add to numeric property.
   */
  add(key: string, value: number): this {
    if (!this.operations.$add) this.operations.$add = {}
    this.operations.$add[key] = value
    return this
  }

  /**
   * Append to list property.
   */
  append(key: string, value: unknown): this {
    if (!this.operations.$append) this.operations.$append = {}
    this.operations.$append[key] = value
    return this
  }

  /**
   * Prepend to list property.
   */
  prepend(key: string, value: unknown): this {
    if (!this.operations.$prepend) this.operations.$prepend = {}
    this.operations.$prepend[key] = value
    return this
  }

  /**
   * Unset property.
   */
  unset(key: string): this {
    if (!this.operations.$unset) this.operations.$unset = {}
    this.operations.$unset[key] = '-'
    return this
  }

  /**
   * Pre-insert to list (insert at beginning if not exists).
   */
  preInsert(key: string, value: unknown): this {
    if (!this.operations.$preInsert) this.operations.$preInsert = {}
    this.operations.$preInsert[key] = value
    return this
  }

  /**
   * Post-insert to list (insert at end if not exists).
   */
  postInsert(key: string, value: unknown): this {
    if (!this.operations.$postInsert) this.operations.$postInsert = {}
    this.operations.$postInsert[key] = value
    return this
  }

  /**
   * Remove from list property.
   */
  remove(key: string, value: unknown): this {
    if (!this.operations.$remove) this.operations.$remove = {}
    this.operations.$remove[key] = value
    return this
  }

  /**
   * Clear all user properties.
   */
  clearAll(): this {
    this.operations.$clearAll = '-'
    return this
  }

  /**
   * Get the operations object.
   */
  getOperations(): typeof this.operations {
    return { ...this.operations }
  }
}

// =============================================================================
// Revenue Class
// =============================================================================

/**
 * Revenue event builder.
 */
export class Revenue {
  private data: {
    $productId?: string
    $price?: number
    $quantity?: number
    $revenueType?: string
    $receipt?: string
    $receiptSig?: string
    [key: string]: unknown
  } = {}

  /**
   * Set product ID.
   */
  setProductId(productId: string): this {
    this.data.$productId = productId
    return this
  }

  /**
   * Set price.
   */
  setPrice(price: number): this {
    this.data.$price = price
    return this
  }

  /**
   * Set quantity.
   */
  setQuantity(quantity: number): this {
    this.data.$quantity = quantity
    return this
  }

  /**
   * Set revenue type.
   */
  setRevenueType(revenueType: string): this {
    this.data.$revenueType = revenueType
    return this
  }

  /**
   * Set receipt.
   */
  setReceipt(receipt: string, signature?: string): this {
    this.data.$receipt = receipt
    if (signature) {
      this.data.$receiptSig = signature
    }
    return this
  }

  /**
   * Set event property.
   */
  setEventProperty(key: string, value: unknown): this {
    this.data[key] = value
    return this
  }

  /**
   * Get revenue data.
   */
  getData(): typeof this.data {
    return { ...this.data }
  }
}

// =============================================================================
// Amplitude Client
// =============================================================================

/**
 * Amplitude-compatible analytics client.
 */
export class Amplitude {
  readonly apiKey: string
  readonly config: {
    serverUrl: string
    flushIntervalMillis: number
    flushQueueSize: number
    minIdLength?: number
    appVersion?: string
  }

  /** Identify class constructor */
  readonly Identify = Identify
  /** Revenue class constructor */
  readonly Revenue = Revenue

  private readonly transport: Transport
  private readonly errorHandler?: (error: Error) => void

  // User state
  private userId?: string
  private deviceId: string
  private sessionId?: number
  private groups: Record<string, string | string[]> = {}

  // Opt-out
  private optedOut = false

  // Plugins
  private plugins: Plugin<AmplitudeEvent>[] = []

  // Queue
  private queue: AmplitudeEvent[] = []
  private pendingCallbacks: Callback[] = []
  private flushTimer?: ReturnType<typeof setTimeout>

  constructor(options: AmplitudeOptions) {
    this.apiKey = options.apiKey
    this.config = {
      serverUrl: options.serverUrl || DEFAULT_SERVER_URL,
      flushIntervalMillis: options.flushIntervalMillis ?? options.flushInterval ?? DEFAULT_FLUSH_INTERVAL,
      flushQueueSize: options.flushQueueSize ?? options.flushAt ?? DEFAULT_FLUSH_QUEUE_SIZE,
      minIdLength: options.minIdLength,
      appVersion: options.appVersion,
    }
    this.errorHandler = options.errorHandler

    // Initialize device ID
    this.deviceId = generateAnonymousId()

    // Create transport
    this.transport = options.transport
      ? options.transport({ apiKey: this.apiKey })
      : this.createDefaultTransport()
  }

  /**
   * Create default transport.
   */
  private createDefaultTransport(): Transport {
    const events: AmplitudeEvent[] = []
    const batches: BatchPayload[] = []
    const url = this.config.serverUrl
    const apiKey = this.apiKey

    return {
      async send(payload: BatchPayload): Promise<TransportResult> {
        batches.push(payload)
        events.push(...payload.events as AmplitudeEvent[])

        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': '*/*',
            },
            body: JSON.stringify({
              api_key: apiKey,
              events: payload.events,
            }),
          })

          return { statusCode: response.status }
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

  // ===========================================================================
  // Track API
  // ===========================================================================

  /**
   * Track an event.
   */
  track(
    eventType: string,
    eventProperties?: Properties,
    eventOptions?: AmplitudeEventOptions,
    callback?: Callback
  ): void {
    if (this.optedOut) {
      callback?.()
      return
    }

    const event: AmplitudeEvent = {
      event_type: eventType,
      user_id: eventOptions?.user_id || this.userId,
      device_id: eventOptions?.device_id || this.deviceId,
      time: eventOptions?.time || Date.now(),
      event_properties: eventProperties,
      groups: { ...this.groups },
      session_id: eventOptions?.session_id || this.sessionId,
      insert_id: eventOptions?.insert_id || generateMessageId(),
      price: eventOptions?.price,
      quantity: eventOptions?.quantity,
      revenue: eventOptions?.revenue,
    }

    this.enqueue(event, callback)
  }

  // ===========================================================================
  // Identify API
  // ===========================================================================

  /**
   * Identify a user with an Identify object.
   */
  identify(identify: Identify, eventOptions?: AmplitudeEventOptions, callback?: Callback): void {
    if (this.optedOut) {
      callback?.()
      return
    }

    const event: AmplitudeEvent = {
      event_type: '$identify',
      user_id: eventOptions?.user_id || this.userId,
      device_id: eventOptions?.device_id || this.deviceId,
      time: eventOptions?.time || Date.now(),
      user_properties: identify.getOperations(),
      session_id: eventOptions?.session_id || this.sessionId,
      insert_id: eventOptions?.insert_id || generateMessageId(),
    }

    this.enqueue(event, callback)
  }

  // ===========================================================================
  // Group API
  // ===========================================================================

  /**
   * Set group membership.
   */
  setGroup(groupType: string, groupId: string | string[]): void {
    this.groups[groupType] = groupId
  }

  /**
   * Identify a group with an Identify object.
   */
  groupIdentify(
    groupType: string,
    groupId: string,
    identify: Identify,
    eventOptions?: AmplitudeEventOptions,
    callback?: Callback
  ): void {
    if (this.optedOut) {
      callback?.()
      return
    }

    const event: AmplitudeEvent = {
      event_type: '$groupidentify',
      user_id: eventOptions?.user_id || this.userId,
      device_id: eventOptions?.device_id || this.deviceId,
      time: eventOptions?.time || Date.now(),
      groups: { [groupType]: groupId },
      group_properties: identify.getOperations(),
      session_id: eventOptions?.session_id || this.sessionId,
      insert_id: eventOptions?.insert_id || generateMessageId(),
    }

    this.enqueue(event, callback)
  }

  // ===========================================================================
  // Revenue API
  // ===========================================================================

  /**
   * Track revenue.
   */
  revenue(revenueObj: Revenue, eventOptions?: AmplitudeEventOptions, callback?: Callback): void {
    if (this.optedOut) {
      callback?.()
      return
    }

    const data = revenueObj.getData()

    const event: AmplitudeEvent = {
      event_type: 'revenue_amount',
      user_id: eventOptions?.user_id || this.userId,
      device_id: eventOptions?.device_id || this.deviceId,
      time: eventOptions?.time || Date.now(),
      event_properties: data,
      session_id: eventOptions?.session_id || this.sessionId,
      insert_id: eventOptions?.insert_id || generateMessageId(),
      price: data.$price,
      quantity: data.$quantity,
    }

    this.enqueue(event, callback)
  }

  // ===========================================================================
  // User and Device Management
  // ===========================================================================

  /**
   * Set user ID.
   */
  setUserId(userId: string): void {
    this.userId = userId
  }

  /**
   * Get user ID.
   */
  getUserId(): string | undefined {
    return this.userId
  }

  /**
   * Set device ID.
   */
  setDeviceId(deviceId: string): void {
    this.deviceId = deviceId
  }

  /**
   * Get device ID.
   */
  getDeviceId(): string {
    return this.deviceId
  }

  /**
   * Set session ID.
   */
  setSessionId(sessionId: number): void {
    this.sessionId = sessionId
  }

  /**
   * Get session ID.
   */
  getSessionId(): number | undefined {
    return this.sessionId
  }

  /**
   * Reset user state.
   */
  reset(): void {
    this.userId = undefined
    this.deviceId = generateAnonymousId()
    this.sessionId = undefined
    this.groups = {}
  }

  // ===========================================================================
  // Opt-out
  // ===========================================================================

  /**
   * Set opt-out state.
   */
  setOptOut(optOut: boolean): void {
    this.optedOut = optOut
  }

  // ===========================================================================
  // Plugins
  // ===========================================================================

  /**
   * Add a plugin.
   */
  async add(plugin: Plugin<AmplitudeEvent>): Promise<void> {
    this.plugins.push(plugin)
    if (plugin.setup) {
      await plugin.setup(this)
    }
  }

  /**
   * Remove a plugin.
   */
  async remove(pluginName: string): Promise<void> {
    const index = this.plugins.findIndex((p) => p.name === pluginName)
    if (index !== -1) {
      const plugin = this.plugins[index]
      if (plugin?.teardown) {
        await plugin.teardown()
      }
      this.plugins.splice(index, 1)
    }
  }

  // ===========================================================================
  // Queue
  // ===========================================================================

  /**
   * Enqueue an event.
   */
  private async enqueue(event: AmplitudeEvent, callback?: Callback): Promise<void> {
    if (this.optedOut) {
      callback?.()
      return
    }

    // Run through plugins
    let processedEvent: AmplitudeEvent | null = event
    for (const plugin of this.plugins) {
      if (plugin.execute) {
        const result = await plugin.execute(processedEvent)
        if (result === null) {
          callback?.()
          return
        }
        processedEvent = result
      }
    }

    this.queue.push(processedEvent)

    // Record event immediately for testing (if transport supports it)
    if ('recordEvent' in this.transport && typeof (this.transport as any).recordEvent === 'function') {
      (this.transport as any).recordEvent(processedEvent)
    }

    if (callback) {
      this.pendingCallbacks.push(callback)
    }

    if (this.queue.length >= this.config.flushQueueSize) {
      this.flush()
    } else {
      this.scheduleFlush()
    }
  }

  /**
   * Schedule flush.
   */
  private scheduleFlush(): void {
    if (this.flushTimer) return

    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.flush()
    }, this.config.flushIntervalMillis)
  }

  /**
   * Flush all queued events.
   */
  async flush(): Promise<boolean> {
    if (this.queue.length === 0) {
      this.invokePendingCallbacks()
      return true
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }

    const events = [...this.queue]
    this.queue = []

    const payload: BatchPayload = {
      events,
      sentAt: getTimestamp(),
      apiKey: this.apiKey,
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
   * Invoke pending callbacks.
   */
  private invokePendingCallbacks(error?: Error): void {
    for (const callback of this.pendingCallbacks) {
      try {
        callback(error)
      } catch {
        // Ignore callback errors
      }
    }
    this.pendingCallbacks = []
  }

  /**
   * Handle error.
   */
  private handleError(error: Error): void {
    if (this.errorHandler) {
      try {
        this.errorHandler(error)
      } catch {
        // Ignore
      }
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an Amplitude instance.
 */
export function createAmplitude(options: AmplitudeOptions): Amplitude {
  return new Amplitude(options)
}

// Re-export InMemoryTransport
export { InMemoryTransport } from './client.js'
