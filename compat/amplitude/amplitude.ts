/**
 * @dotdo/amplitude - Core Implementation
 *
 * Edge-compatible Amplitude SDK implementation.
 * Provides product analytics APIs: track, identify, revenue, groups.
 *
 * @module @dotdo/amplitude/amplitude
 */

import type {
  AmplitudeOptions,
  BaseEvent,
  TrackEventOptions,
  UserPropertyOperations,
  Plugin,
  Transport,
  AmplitudeResponse,
  BatchResponse,
} from './types.js'

// =============================================================================
// Constants
// =============================================================================

const SDK_NAME = '@dotdo/amplitude'
const SDK_VERSION = '0.1.0'
const DEFAULT_SERVER_URL = 'https://api2.amplitude.com/2/httpapi'
const DEFAULT_FLUSH_QUEUE_SIZE = 30
const DEFAULT_FLUSH_INTERVAL = 10000
const DEFAULT_MAX_RETRIES = 3

// =============================================================================
// Utilities
// =============================================================================

/**
 * Generate a UUID v4 for insert_id.
 */
function generateInsertId(): string {
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

// =============================================================================
// Identify Builder
// =============================================================================

/**
 * Builder class for user property operations.
 */
export class Identify {
  private operations: UserPropertyOperations = {}

  /**
   * Set a user property (overwrites existing value).
   */
  set(key: string, value: unknown): this {
    if (!this.operations.$set) {
      this.operations.$set = {}
    }
    this.operations.$set[key] = value
    return this
  }

  /**
   * Set a user property only if it hasn't been set before.
   */
  setOnce(key: string, value: unknown): this {
    if (!this.operations.$setOnce) {
      this.operations.$setOnce = {}
    }
    this.operations.$setOnce[key] = value
    return this
  }

  /**
   * Add a numeric value to a user property.
   */
  add(key: string, value: number): this {
    if (!this.operations.$add) {
      this.operations.$add = {}
    }
    this.operations.$add[key] = value
    return this
  }

  /**
   * Append a value to an array user property.
   */
  append(key: string, value: unknown): this {
    if (!this.operations.$append) {
      this.operations.$append = {}
    }
    this.operations.$append[key] = value
    return this
  }

  /**
   * Prepend a value to an array user property.
   */
  prepend(key: string, value: unknown): this {
    if (!this.operations.$prepend) {
      this.operations.$prepend = {}
    }
    this.operations.$prepend[key] = value
    return this
  }

  /**
   * Remove a value from an array user property.
   */
  remove(key: string, value: unknown): this {
    if (!this.operations.$remove) {
      this.operations.$remove = {}
    }
    this.operations.$remove[key] = value
    return this
  }

  /**
   * Pre-insert a unique value to the beginning of an array.
   */
  preInsert(key: string, value: unknown): this {
    if (!this.operations.$preInsert) {
      this.operations.$preInsert = {}
    }
    this.operations.$preInsert[key] = value
    return this
  }

  /**
   * Post-insert a unique value to the end of an array.
   */
  postInsert(key: string, value: unknown): this {
    if (!this.operations.$postInsert) {
      this.operations.$postInsert = {}
    }
    this.operations.$postInsert[key] = value
    return this
  }

  /**
   * Unset (remove) a user property.
   */
  unset(key: string): this {
    if (!this.operations.$unset) {
      this.operations.$unset = {}
    }
    this.operations.$unset[key] = '-'
    return this
  }

  /**
   * Clear all user properties.
   */
  clearAll(): this {
    this.operations.$clearAll = true
    return this
  }

  /**
   * Get the user property operations.
   */
  getUserProperties(): UserPropertyOperations {
    return this.operations
  }

  /**
   * Alias for getUserProperties (for GroupIdentify compatibility).
   */
  getGroupProperties(): UserPropertyOperations {
    return this.operations
  }
}

/**
 * Create a new Identify instance.
 */
export function createIdentify(): Identify {
  return new Identify()
}

// =============================================================================
// Revenue Builder
// =============================================================================

/**
 * Builder class for revenue events.
 */
export class Revenue {
  private _price?: number
  private _quantity: number = 1
  private _productId?: string
  private _revenueType?: string
  private _eventProperties?: Record<string, unknown>

  /**
   * Set the price per unit.
   */
  setPrice(price: number): this {
    this._price = price
    return this
  }

  /**
   * Set the quantity.
   */
  setQuantity(quantity: number): this {
    this._quantity = quantity
    return this
  }

  /**
   * Set the product ID.
   */
  setProductId(productId: string): this {
    this._productId = productId
    return this
  }

  /**
   * Set the revenue type.
   */
  setRevenueType(revenueType: string): this {
    this._revenueType = revenueType
    return this
  }

  /**
   * Set additional event properties.
   */
  setEventProperties(properties: Record<string, unknown>): this {
    this._eventProperties = properties
    return this
  }

  /**
   * Check if revenue is valid (price is set).
   */
  isValid(): boolean {
    return this._price !== undefined
  }

  /**
   * Get revenue data for the event.
   */
  getRevenueData(): {
    price: number
    quantity: number
    revenue: number
    productId?: string
    revenueType?: string
    eventProperties?: Record<string, unknown>
  } {
    if (this._price === undefined) {
      throw new Error('Price is required for revenue events')
    }

    return {
      price: this._price,
      quantity: this._quantity,
      revenue: this._price * this._quantity,
      productId: this._productId,
      revenueType: this._revenueType,
      eventProperties: this._eventProperties,
    }
  }
}

/**
 * Create a new Revenue instance.
 */
export function createRevenue(): Revenue {
  return new Revenue()
}

// =============================================================================
// InMemory Transport (for testing)
// =============================================================================

/**
 * Extended transport interface with event recording for testing.
 */
export interface RecordingTransport extends Transport {
  recordEvent(event: BaseEvent): void
}

/**
 * In-memory transport for testing.
 * Events are recorded immediately when enqueued (via recordEvent)
 * and also stored in batches when send() is called.
 */
export class InMemoryTransport implements RecordingTransport {
  private events: BaseEvent[] = []
  private batches: BaseEvent[][] = []

  /**
   * Record an event immediately (called on enqueue).
   */
  recordEvent(event: BaseEvent): void {
    this.events.push(event)
  }

  async send(events: BaseEvent[]): Promise<AmplitudeResponse<BatchResponse>> {
    this.batches.push([...events])
    // Don't duplicate events - they're already recorded via recordEvent
    return {
      code: 200,
      message: 'Success',
      events_ingested: events.length,
      payload_size_bytes: JSON.stringify(events).length,
      server_upload_time: Date.now(),
    }
  }

  getEvents(): BaseEvent[] {
    return [...this.events]
  }

  getBatches(): BaseEvent[][] {
    return [...this.batches]
  }

  clear(): void {
    this.events = []
    this.batches = []
  }
}

// =============================================================================
// FetchTransport
// =============================================================================

/**
 * HTTP transport using fetch.
 */
export class FetchTransport implements Transport {
  private readonly apiKey: string
  private readonly serverUrl: string

  constructor(options: { apiKey: string; serverUrl?: string }) {
    this.apiKey = options.apiKey
    this.serverUrl = options.serverUrl || DEFAULT_SERVER_URL
  }

  async send(events: BaseEvent[]): Promise<AmplitudeResponse<BatchResponse>> {
    const payload = {
      api_key: this.apiKey,
      events,
    }

    try {
      const response = await fetch(this.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const data = await response.json() as Record<string, unknown>

      return {
        code: response.status,
        message: (data.error as string) || 'Success',
        events_ingested: (data.events_ingested as number) || events.length,
        payload_size_bytes: (data.payload_size_bytes as number) || 0,
        server_upload_time: (data.server_upload_time as number) || Date.now(),
      }
    } catch (error) {
      throw error
    }
  }
}

// =============================================================================
// Amplitude Client
// =============================================================================

/**
 * Amplitude SDK configuration with defaults applied.
 */
export interface ResolvedConfig extends AmplitudeOptions {
  serverUrl: string
  flushQueueSize: number
  flushIntervalMillis: number
  flushMaxRetries: number
}

/**
 * Amplitude analytics client.
 */
export class Amplitude {
  readonly apiKey: string
  readonly config: ResolvedConfig

  private transport: Transport
  private queue: BaseEvent[] = []
  private plugins: Plugin[] = []
  private flushTimer?: ReturnType<typeof setTimeout>

  private _userId?: string
  private _deviceId?: string
  private _sessionId?: number

  constructor(options: AmplitudeOptions & { transport?: Transport }) {
    if (!options.apiKey || options.apiKey.trim() === '') {
      throw new Error('API key is required')
    }

    this.apiKey = options.apiKey
    this.config = {
      ...options,
      serverUrl: options.serverUrl || DEFAULT_SERVER_URL,
      flushQueueSize: options.flushQueueSize ?? DEFAULT_FLUSH_QUEUE_SIZE,
      flushIntervalMillis: options.flushIntervalMillis ?? DEFAULT_FLUSH_INTERVAL,
      flushMaxRetries: options.flushMaxRetries ?? DEFAULT_MAX_RETRIES,
    }

    this.transport =
      options.transport ||
      new FetchTransport({
        apiKey: this.apiKey,
        serverUrl: this.config.serverUrl,
      })
  }

  /**
   * Get current queue size.
   */
  get queueSize(): number {
    return this.queue.length
  }

  // ===========================================================================
  // Track Methods
  // ===========================================================================

  /**
   * Track an event.
   */
  async track(
    eventTypeOrEvent: string | BaseEvent,
    eventProperties?: Record<string, unknown>,
    options?: TrackEventOptions
  ): Promise<void> {
    let event: BaseEvent

    if (typeof eventTypeOrEvent === 'string') {
      // Build event from parameters
      const userId = options?.user_id || this._userId
      const deviceId = options?.device_id || this._deviceId

      if (!userId && !deviceId) {
        throw new Error('user_id or device_id is required')
      }

      event = {
        event_type: eventTypeOrEvent,
        event_properties: eventProperties,
        user_id: userId,
        device_id: deviceId,
        session_id: options?.session_id || this._sessionId,
        time: options?.time || Date.now(),
        insert_id: options?.insert_id || generateInsertId(),
        groups: options?.groups,
        app_version: options?.app_version,
        platform: options?.platform,
        library: `${SDK_NAME}/${SDK_VERSION}`,
      }
    } else {
      // Use provided event object
      const userId = eventTypeOrEvent.user_id || this._userId
      const deviceId = eventTypeOrEvent.device_id || this._deviceId

      if (!userId && !deviceId) {
        throw new Error('user_id or device_id is required')
      }

      event = {
        ...eventTypeOrEvent,
        user_id: userId,
        device_id: deviceId,
        time: eventTypeOrEvent.time || Date.now(),
        insert_id: eventTypeOrEvent.insert_id || generateInsertId(),
        library: `${SDK_NAME}/${SDK_VERSION}`,
      }
    }

    // Run through plugins
    let processedEvent: BaseEvent | null = event
    for (const plugin of this.plugins) {
      if (plugin.type === 'enrichment' || plugin.type === 'before') {
        processedEvent = await plugin.execute(processedEvent)
        if (processedEvent === null) {
          return // Event dropped by plugin
        }
      }
    }

    this.enqueue(processedEvent)
  }

  // ===========================================================================
  // Identify Methods
  // ===========================================================================

  /**
   * Identify a user with user properties.
   */
  async identify(identify: Identify, options?: TrackEventOptions): Promise<void> {
    const userId = options?.user_id || this._userId
    const deviceId = options?.device_id || this._deviceId

    if (!userId && !deviceId) {
      throw new Error('user_id or device_id is required')
    }

    const event: BaseEvent = {
      event_type: '$identify',
      user_id: userId,
      device_id: deviceId,
      session_id: options?.session_id || this._sessionId,
      time: options?.time || Date.now(),
      insert_id: options?.insert_id || generateInsertId(),
      user_properties: identify.getUserProperties(),
      library: `${SDK_NAME}/${SDK_VERSION}`,
    }

    this.enqueue(event)
  }

  // ===========================================================================
  // Revenue Methods
  // ===========================================================================

  /**
   * Track a revenue event.
   */
  async revenue(revenue: Revenue, options?: TrackEventOptions): Promise<void> {
    if (!revenue.isValid()) {
      throw new Error('Price is required for revenue events')
    }

    const userId = options?.user_id || this._userId
    const deviceId = options?.device_id || this._deviceId

    if (!userId && !deviceId) {
      throw new Error('user_id or device_id is required')
    }

    const revenueData = revenue.getRevenueData()

    const event: BaseEvent = {
      event_type: 'revenue_amount',
      user_id: userId,
      device_id: deviceId,
      session_id: options?.session_id || this._sessionId,
      time: options?.time || Date.now(),
      insert_id: options?.insert_id || generateInsertId(),
      price: revenueData.price,
      quantity: revenueData.quantity,
      revenue: revenueData.revenue,
      productId: revenueData.productId,
      revenueType: revenueData.revenueType,
      event_properties: revenueData.eventProperties,
      library: `${SDK_NAME}/${SDK_VERSION}`,
    }

    this.enqueue(event)
  }

  // ===========================================================================
  // Group Methods
  // ===========================================================================

  /**
   * Set group membership for a user.
   */
  async setGroup(
    groupType: string,
    groupName: string | string[],
    options?: TrackEventOptions
  ): Promise<void> {
    const userId = options?.user_id || this._userId
    const deviceId = options?.device_id || this._deviceId

    if (!userId && !deviceId) {
      throw new Error('user_id or device_id is required')
    }

    const event: BaseEvent = {
      event_type: '$identify',
      user_id: userId,
      device_id: deviceId,
      session_id: options?.session_id || this._sessionId,
      time: options?.time || Date.now(),
      insert_id: options?.insert_id || generateInsertId(),
      groups: { [groupType]: groupName },
      user_properties: {
        $set: { [groupType]: groupName },
      },
      library: `${SDK_NAME}/${SDK_VERSION}`,
    }

    this.enqueue(event)
  }

  /**
   * Set properties for a group.
   */
  async groupIdentify(
    groupType: string,
    groupName: string,
    identify: Identify
  ): Promise<void> {
    const event: BaseEvent = {
      event_type: '$groupidentify',
      time: Date.now(),
      insert_id: generateInsertId(),
      groups: { [groupType]: groupName },
      group_properties: identify.getGroupProperties(),
      library: `${SDK_NAME}/${SDK_VERSION}`,
    }

    this.enqueue(event)
  }

  // ===========================================================================
  // User/Device/Session Management
  // ===========================================================================

  /**
   * Set the user ID.
   */
  setUserId(userId: string | undefined): void {
    this._userId = userId
  }

  /**
   * Get the current user ID.
   */
  getUserId(): string | undefined {
    return this._userId
  }

  /**
   * Set the device ID.
   */
  setDeviceId(deviceId: string | undefined): void {
    this._deviceId = deviceId
  }

  /**
   * Get the current device ID.
   */
  getDeviceId(): string | undefined {
    return this._deviceId
  }

  /**
   * Set the session ID.
   */
  setSessionId(sessionId: number): void {
    this._sessionId = sessionId
  }

  /**
   * Get the current session ID.
   */
  getSessionId(): number | undefined {
    return this._sessionId
  }

  /**
   * Reset user state (user ID, device ID, session ID).
   */
  reset(): void {
    this._userId = undefined
    this._deviceId = undefined
    this._sessionId = undefined
  }

  // ===========================================================================
  // Plugin Management
  // ===========================================================================

  /**
   * Add a plugin.
   */
  async add(plugin: Plugin): Promise<void> {
    await plugin.setup(this.config)
    this.plugins.push(plugin)
  }

  /**
   * Remove a plugin by name.
   */
  async remove(pluginName: string): Promise<void> {
    const index = this.plugins.findIndex((p) => p.name === pluginName)
    if (index >= 0) {
      const plugin = this.plugins[index]
      if (plugin?.teardown) {
        await plugin.teardown()
      }
      this.plugins.splice(index, 1)
    }
  }

  // ===========================================================================
  // Queue Management
  // ===========================================================================

  /**
   * Enqueue an event for sending.
   */
  private enqueue(event: BaseEvent): void {
    this.queue.push(event)

    // Record event immediately in transport (for testing)
    if (
      'recordEvent' in this.transport &&
      typeof (this.transport as RecordingTransport).recordEvent === 'function'
    ) {
      (this.transport as RecordingTransport).recordEvent(event)
    }

    // Check if we should auto-flush
    if (this.queue.length >= this.config.flushQueueSize) {
      this.flush().catch(() => {
        // Errors handled internally
      })
    } else {
      this.scheduleFlush()
    }
  }

  /**
   * Schedule a flush based on interval.
   */
  private scheduleFlush(): void {
    if (this.flushTimer) return

    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.flush().catch(() => {
        // Errors handled internally
      })
    }, this.config.flushIntervalMillis)
  }

  /**
   * Flush all queued events.
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }

    if (this.queue.length === 0) {
      return
    }

    const events = [...this.queue]
    this.queue = []

    // Run destination plugins
    const destinationPlugins = this.plugins.filter((p) => p.type === 'destination')

    for (const plugin of destinationPlugins) {
      for (const event of events) {
        await plugin.execute(event).catch(() => {
          // Ignore plugin errors
        })
      }
    }

    // Send to transport with retry
    let attempts = 0
    let lastError: Error | undefined

    while (attempts <= this.config.flushMaxRetries) {
      try {
        await this.transport.send(events)
        return
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        attempts++

        if (attempts <= this.config.flushMaxRetries) {
          // Exponential backoff
          await new Promise((r) => setTimeout(r, Math.pow(2, attempts) * 100))
        }
      }
    }

    // Re-queue events if all retries failed
    this.queue.unshift(...events)
  }

  /**
   * Shutdown the client, flushing pending events.
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }

    await this.flush()

    // Teardown plugins
    for (const plugin of this.plugins) {
      if (plugin.teardown) {
        await plugin.teardown()
      }
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new Amplitude client.
 */
export function createAmplitudeClient(
  options: AmplitudeOptions & { transport?: Transport }
): Amplitude {
  return new Amplitude(options)
}
