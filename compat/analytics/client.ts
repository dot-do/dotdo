/**
 * @dotdo/analytics - Unified Analytics Client
 *
 * Edge-compatible analytics client supporting Mixpanel, Amplitude, and PostHog APIs.
 * Uses primitives for event storage and real-time aggregation.
 *
 * @module @dotdo/analytics/client
 */

import { createTemporalStore, type TemporalStore } from '../../db/primitives/temporal-store.js'
import {
  WindowManager,
  CountTrigger,
  milliseconds,
} from '../../db/primitives/window-manager.js'
import type {
  AnalyticsOptions,
  AnalyticsEvent,
  Properties,
  UserTraits,
  GroupTraits,
  Revenue,
  Context,
  Transport,
  TransportResult,
  BatchPayload,
  Callback,
  EventStats,
} from './types.js'

// =============================================================================
// Constants
// =============================================================================

const SDK_NAME = '@dotdo/analytics'
const SDK_VERSION = '0.1.0'
const DEFAULT_HOST = 'https://api.dotdo.dev'
const DEFAULT_FLUSH_AT = 20
const DEFAULT_FLUSH_INTERVAL = 10000

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
 * Generate anonymous ID.
 */
export function generateAnonymousId(): string {
  return `anon-${generateMessageId()}`
}

/**
 * Get ISO timestamp.
 */
export function getTimestamp(): string {
  return new Date().toISOString()
}

/**
 * Get epoch time in milliseconds.
 */
export function getTime(): number {
  return Date.now()
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
// In-Memory Transport
// =============================================================================

/**
 * Extended transport interface with event recording for testing.
 */
export interface RecordingTransport extends Transport {
  recordEvent(event: AnalyticsEvent): void
}

/**
 * In-memory transport for testing.
 * Events are recorded immediately when enqueued (via recordEvent)
 * and also stored in batches when send() is called.
 */
export class InMemoryTransport implements RecordingTransport {
  private events: AnalyticsEvent[] = []
  private batches: BatchPayload[] = []

  /**
   * Record an event immediately (called on enqueue).
   */
  recordEvent(event: AnalyticsEvent): void {
    this.events.push(event)
  }

  async send(payload: BatchPayload): Promise<TransportResult> {
    this.batches.push(payload)
    // Don't duplicate events - they're already recorded via recordEvent
    return { statusCode: 200 }
  }

  async flush(): Promise<boolean> {
    return true
  }

  getEvents(): AnalyticsEvent[] {
    return [...this.events]
  }

  getBatches(): BatchPayload[] {
    return [...this.batches]
  }

  clear(): void {
    this.events = []
    this.batches = []
  }
}

// =============================================================================
// Global State
// =============================================================================

let globalAnalytics: Analytics | null = null

export function setAnalytics(analytics: Analytics): void {
  globalAnalytics = analytics
}

export function getAnalytics(): Analytics | null {
  return globalAnalytics
}

export function _clear(): void {
  globalAnalytics = null
}

// =============================================================================
// Analytics Client
// =============================================================================

/**
 * Unified Analytics client compatible with Mixpanel, Amplitude, and PostHog.
 *
 * Features:
 * - track(event, properties) - Track events
 * - identify(userId, traits) - Identify users
 * - alias(newId, previousId) - Link identities
 * - group(groupId, traits) - Group analytics
 * - revenue(revenue) - Revenue tracking
 * - User profile operations ($set, $set_once, $add, etc.)
 * - Super properties (global event properties)
 * - Feature flags
 * - Primitives integration (TemporalStore, WindowManager)
 */
export class Analytics {
  readonly projectToken: string
  readonly host: string
  readonly flushAt: number
  readonly flushInterval: number

  private readonly transport: Transport
  private readonly errorHandler?: (error: Error) => void

  // User state
  private distinctId: string
  private anonymousId: string
  private superProperties: Properties = {}
  private userProperties: Properties = {}
  private groups: Map<string, string> = new Map()

  // Feature flags
  private featureFlags: Record<string, boolean | string> = {}
  private featureFlagCallbacks: Array<(flags: Record<string, boolean | string>) => void> = []

  // Opt-out state
  private optedOut = false

  // Timed events
  private timedEvents: Map<string, number> = new Map()

  // Queue and batching
  private queue: AnalyticsEvent[] = []
  private pendingCallbacks: Array<{ callback: Callback; eventCount: number }> = []
  private flushTimer?: ReturnType<typeof setTimeout>

  // Primitives
  private eventStore?: TemporalStore<AnalyticsEvent>
  private aggregationWindow?: WindowManager<AnalyticsEvent>
  private eventStats: Map<string, EventStats> = new Map()

  constructor(options: AnalyticsOptions) {
    this.projectToken = options.projectToken
    this.host = options.host || DEFAULT_HOST
    this.flushAt = options.flushAt ?? DEFAULT_FLUSH_AT
    this.flushInterval = options.flushInterval ?? DEFAULT_FLUSH_INTERVAL
    this.errorHandler = options.errorHandler

    // Initialize IDs
    this.anonymousId = generateAnonymousId()
    this.distinctId = this.anonymousId

    // Initialize feature flags
    if (options.featureFlags) {
      this.featureFlags = { ...options.featureFlags }
    }

    // Create transport
    this.transport = options.transport
      ? options.transport({ apiKey: this.projectToken })
      : this.createDefaultTransport(options)

    // Initialize primitives
    if (options.enableEventStore) {
      this.eventStore = createTemporalStore<AnalyticsEvent>({
        enableTTL: true,
        retention: {
          maxAge: 24 * 60 * 60 * 1000, // 24 hours
        },
      })
    }

    if (options.enableRealTimeAggregation) {
      const windowMs = options.aggregationWindowMs || 60000
      this.aggregationWindow = new WindowManager(
        WindowManager.tumbling<AnalyticsEvent>(milliseconds(windowMs))
      ).withTrigger(new CountTrigger(100))

      this.aggregationWindow.onTrigger((window, elements) => {
        this.aggregateEvents(elements, window.start, window.end)
      })
    }

    // Set global instance
    setAnalytics(this)
  }

  /**
   * Create default fetch transport.
   */
  private createDefaultTransport(options: AnalyticsOptions): Transport {
    const url = `${options.host || DEFAULT_HOST}/v1/batch`
    const apiKey = this.projectToken
    const events: AnalyticsEvent[] = []
    const batches: BatchPayload[] = []

    return {
      async send(payload: BatchPayload): Promise<TransportResult> {
        batches.push(payload)
        events.push(...payload.events)

        const auth = btoa(`${apiKey}:`)

        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Basic ${auth}`,
            },
            body: JSON.stringify(payload),
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
  track(event: string, properties?: Properties, callback?: Callback): void {
    if (!event) {
      throw new Error('Event name is required')
    }

    if (this.optedOut) {
      callback?.()
      return
    }

    // Check for timed event
    let duration: number | undefined
    const startTime = this.timedEvents.get(event)
    if (startTime !== undefined) {
      duration = Date.now() - startTime
      this.timedEvents.delete(event)
    }

    const eventProperties: Properties = {
      ...this.superProperties,
      ...properties,
    }

    if (duration !== undefined) {
      eventProperties.$duration = duration
    }

    const analyticsEvent: AnalyticsEvent = {
      type: 'track',
      event,
      message_id: generateMessageId(),
      timestamp: getTimestamp(),
      distinct_id: this.distinctId,
      properties: eventProperties,
      context: buildLibraryContext(),
      token: this.projectToken,
    }

    this.enqueue(analyticsEvent, callback)
  }

  /**
   * Time an event (call track later to complete).
   */
  timeEvent(event: string): void {
    this.timedEvents.set(event, Date.now())
  }

  // ===========================================================================
  // Identify API
  // ===========================================================================

  /**
   * Identify a user.
   */
  identify(userId: string, traits?: UserTraits, callback?: Callback): void {
    this.distinctId = userId

    if (this.optedOut) {
      callback?.()
      return
    }

    const event: AnalyticsEvent = {
      type: 'identify',
      message_id: generateMessageId(),
      timestamp: getTimestamp(),
      distinct_id: userId,
      anonymous_id: this.anonymousId,
      $set: traits,
      context: buildLibraryContext(),
      token: this.projectToken,
    }

    this.enqueue(event, callback)
  }

  // ===========================================================================
  // Alias API
  // ===========================================================================

  /**
   * Alias user IDs.
   */
  alias(newId: string, previousId?: string, callback?: Callback): void {
    if (!newId || (!previousId && !this.distinctId)) {
      throw new Error('Both newId and previousId are required')
    }

    if (this.optedOut) {
      callback?.()
      return
    }

    const event: AnalyticsEvent = {
      type: 'alias',
      event: '$create_alias',
      message_id: generateMessageId(),
      timestamp: getTimestamp(),
      distinct_id: previousId || this.distinctId,
      alias: newId,
      context: buildLibraryContext(),
      token: this.projectToken,
    }

    this.enqueue(event, callback)
  }

  // ===========================================================================
  // Group API
  // ===========================================================================

  /**
   * Associate user with a group.
   */
  group(groupId: string, traits?: GroupTraits, groupType?: string, callback?: Callback): void {
    if (!groupId) {
      throw new Error('Group ID is required')
    }

    if (this.optedOut) {
      callback?.()
      return
    }

    const type = groupType || 'group'
    this.groups.set(type, groupId)

    const event: AnalyticsEvent = {
      type: 'group',
      message_id: generateMessageId(),
      timestamp: getTimestamp(),
      distinct_id: this.distinctId,
      group_id: groupId,
      group_type: type,
      $group_set: traits,
      context: buildLibraryContext(),
      token: this.projectToken,
    }

    this.enqueue(event, callback)
  }

  // ===========================================================================
  // Revenue API
  // ===========================================================================

  /**
   * Track revenue.
   */
  revenue(revenue: Revenue, callback?: Callback): void {
    if (!revenue.amount || revenue.amount <= 0) {
      throw new Error('Revenue amount must be greater than 0')
    }

    if (this.optedOut) {
      callback?.()
      return
    }

    const event: AnalyticsEvent = {
      type: 'track',
      event: 'Revenue',
      message_id: generateMessageId(),
      timestamp: getTimestamp(),
      distinct_id: this.distinctId,
      properties: {
        amount: revenue.amount,
        $amount: revenue.amount,
        currency: revenue.currency || 'USD',
        product_id: revenue.productId,
        quantity: revenue.quantity || 1,
        revenue_type: revenue.revenueType,
        receipt: revenue.receipt,
        receipt_signature: revenue.receiptSignature,
        ...revenue.properties,
      },
      context: buildLibraryContext(),
      token: this.projectToken,
    }

    this.enqueue(event, callback)
  }

  // ===========================================================================
  // User Profile Operations
  // ===========================================================================

  /**
   * Set user properties.
   */
  setUserProperties(properties: Properties, callback?: Callback): void {
    if (this.optedOut) {
      callback?.()
      return
    }

    const event: AnalyticsEvent = {
      type: 'profile',
      message_id: generateMessageId(),
      timestamp: getTimestamp(),
      distinct_id: this.distinctId,
      $set: properties,
      context: buildLibraryContext(),
      token: this.projectToken,
    }

    this.enqueue(event, callback)
  }

  /**
   * Set user properties once (only if not already set).
   */
  setUserPropertiesOnce(properties: Properties, callback?: Callback): void {
    if (this.optedOut) {
      callback?.()
      return
    }

    const event: AnalyticsEvent = {
      type: 'profile',
      message_id: generateMessageId(),
      timestamp: getTimestamp(),
      distinct_id: this.distinctId,
      $set_once: properties,
      context: buildLibraryContext(),
      token: this.projectToken,
    }

    this.enqueue(event, callback)
  }

  /**
   * Increment a numeric user property.
   */
  incrementUserProperty(property: string, value: number, callback?: Callback): void {
    if (this.optedOut) {
      callback?.()
      return
    }

    const event: AnalyticsEvent = {
      type: 'profile',
      message_id: generateMessageId(),
      timestamp: getTimestamp(),
      distinct_id: this.distinctId,
      $add: { [property]: value },
      context: buildLibraryContext(),
      token: this.projectToken,
    }

    this.enqueue(event, callback)
  }

  /**
   * Append to a list user property.
   */
  appendToUserProperty(property: string, value: unknown, callback?: Callback): void {
    if (this.optedOut) {
      callback?.()
      return
    }

    const event: AnalyticsEvent = {
      type: 'profile',
      message_id: generateMessageId(),
      timestamp: getTimestamp(),
      distinct_id: this.distinctId,
      $append: { [property]: value },
      context: buildLibraryContext(),
      token: this.projectToken,
    }

    this.enqueue(event, callback)
  }

  /**
   * Union to a list user property (unique values only).
   */
  unionToUserProperty(property: string, values: unknown[], callback?: Callback): void {
    if (this.optedOut) {
      callback?.()
      return
    }

    const event: AnalyticsEvent = {
      type: 'profile',
      message_id: generateMessageId(),
      timestamp: getTimestamp(),
      distinct_id: this.distinctId,
      $union: { [property]: values },
      context: buildLibraryContext(),
      token: this.projectToken,
    }

    this.enqueue(event, callback)
  }

  /**
   * Unset a user property.
   */
  unsetUserProperty(property: string, callback?: Callback): void {
    if (this.optedOut) {
      callback?.()
      return
    }

    const event: AnalyticsEvent = {
      type: 'profile',
      message_id: generateMessageId(),
      timestamp: getTimestamp(),
      distinct_id: this.distinctId,
      $unset: [property],
      context: buildLibraryContext(),
      token: this.projectToken,
    }

    this.enqueue(event, callback)
  }

  /**
   * Delete the user.
   */
  deleteUser(callback?: Callback): void {
    if (this.optedOut) {
      callback?.()
      return
    }

    const event: AnalyticsEvent = {
      type: 'delete',
      message_id: generateMessageId(),
      timestamp: getTimestamp(),
      distinct_id: this.distinctId,
      $delete: true,
      context: buildLibraryContext(),
      token: this.projectToken,
    }

    this.enqueue(event, callback)
  }

  // ===========================================================================
  // Page/Screen API
  // ===========================================================================

  /**
   * Track page view.
   */
  page(name?: string, properties?: Properties, callback?: Callback): void {
    if (this.optedOut) {
      callback?.()
      return
    }

    const event: AnalyticsEvent = {
      type: 'track',
      event: '$pageview',
      message_id: generateMessageId(),
      timestamp: getTimestamp(),
      distinct_id: this.distinctId,
      properties: {
        ...this.superProperties,
        $current_url: properties?.url,
        $referrer: properties?.referrer,
        name,
        ...properties,
      },
      context: buildLibraryContext(),
      token: this.projectToken,
    }

    this.enqueue(event, callback)
  }

  /**
   * Track screen view (mobile).
   */
  screen(name: string, properties?: Properties, callback?: Callback): void {
    if (this.optedOut) {
      callback?.()
      return
    }

    const event: AnalyticsEvent = {
      type: 'track',
      event: '$screen',
      message_id: generateMessageId(),
      timestamp: getTimestamp(),
      distinct_id: this.distinctId,
      properties: {
        ...this.superProperties,
        $screen_name: name,
        name,
        ...properties,
      },
      context: buildLibraryContext(),
      token: this.projectToken,
    }

    this.enqueue(event, callback)
  }

  // ===========================================================================
  // Super Properties
  // ===========================================================================

  /**
   * Register super properties (added to all events).
   */
  register(properties: Properties): void {
    this.superProperties = {
      ...this.superProperties,
      ...properties,
    }
  }

  /**
   * Register super properties once (only if not already set).
   */
  registerOnce(properties: Properties): void {
    for (const [key, value] of Object.entries(properties)) {
      if (!(key in this.superProperties)) {
        this.superProperties[key] = value
      }
    }
  }

  /**
   * Unregister a super property.
   */
  unregister(property: string): void {
    delete this.superProperties[property]
  }

  /**
   * Clear all super properties.
   */
  clearSuperProperties(): void {
    this.superProperties = {}
  }

  // ===========================================================================
  // Feature Flags
  // ===========================================================================

  /**
   * Check if a feature is enabled.
   */
  isFeatureEnabled(flag: string): boolean {
    const value = this.featureFlags[flag]
    return value === true || (typeof value === 'string' && value !== '')
  }

  /**
   * Get feature flag value.
   */
  getFeatureFlag(flag: string): boolean | string | undefined {
    return this.featureFlags[flag]
  }

  /**
   * Get all feature flags.
   */
  getFeatureFlags(): Record<string, boolean | string> {
    return { ...this.featureFlags }
  }

  /**
   * Reload feature flags from server.
   */
  async reloadFeatureFlags(): Promise<void> {
    // In a real implementation, this would fetch from the server
    // For now, just trigger callbacks with existing flags
    for (const callback of this.featureFlagCallbacks) {
      callback(this.featureFlags)
    }
  }

  /**
   * Register callback for feature flag updates.
   */
  onFeatureFlags(callback: (flags: Record<string, boolean | string>) => void): void {
    this.featureFlagCallbacks.push(callback)
  }

  // ===========================================================================
  // Opt-out/Privacy
  // ===========================================================================

  /**
   * Opt out of tracking.
   */
  optOut(options?: { clearData?: boolean }): void {
    this.optedOut = true

    if (options?.clearData) {
      this.reset()
    }
  }

  /**
   * Opt in to tracking.
   */
  optIn(): void {
    this.optedOut = false
  }

  /**
   * Check if opted out.
   */
  hasOptedOut(): boolean {
    return this.optedOut
  }

  // ===========================================================================
  // Reset
  // ===========================================================================

  /**
   * Reset all state.
   */
  reset(): void {
    this.anonymousId = generateAnonymousId()
    this.distinctId = this.anonymousId
    this.superProperties = {}
    this.userProperties = {}
    this.groups.clear()
    this.timedEvents.clear()
  }

  // ===========================================================================
  // Queue and Flush
  // ===========================================================================

  /**
   * Enqueue an event for sending.
   */
  private enqueue(event: AnalyticsEvent, callback?: Callback): void {
    if (this.optedOut) {
      callback?.()
      return
    }

    this.queue.push(event)

    // Record event immediately for testing (if transport supports it)
    if ('recordEvent' in this.transport && typeof (this.transport as RecordingTransport).recordEvent === 'function') {
      (this.transport as RecordingTransport).recordEvent(event)
    }

    // Store event if enabled
    if (this.eventStore) {
      const key = event.distinct_id || 'unknown'
      const timestamp = Date.now()
      this.eventStore.put(`${key}:${event.message_id}`, event, timestamp)
    }

    // Process through aggregation window
    if (this.aggregationWindow) {
      this.aggregationWindow.process(event, Date.now())
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
   * Schedule a flush.
   */
  private scheduleFlush(): void {
    if (this.flushTimer) return

    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.flush()
    }, this.flushInterval)
  }

  /**
   * Flush all queued events.
   */
  async flush(): Promise<boolean> {
    if (this.queue.length === 0) {
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

    // Build and send batch payload
    const payload: BatchPayload = {
      events,
      sentAt: getTimestamp(),
      apiKey: this.projectToken,
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
   * Close and flush.
   */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }

    if (this.aggregationWindow) {
      this.aggregationWindow.dispose()
    }

    await this.flush()
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

  // ===========================================================================
  // Primitives Integration
  // ===========================================================================

  /**
   * Get events for a user (from TemporalStore).
   */
  async getEventsForUser(userId: string): Promise<AnalyticsEvent[]> {
    if (!this.eventStore) return []

    // This is a simplified implementation
    // A full implementation would iterate over all keys with userId prefix
    const event = await this.eventStore.get(userId)
    return event ? [event] : []
  }

  /**
   * Get event statistics (from WindowManager).
   */
  async getEventStats(eventName: string, windowMs: number): Promise<EventStats | undefined> {
    return this.eventStats.get(eventName)
  }

  /**
   * Aggregate events (called by WindowManager).
   */
  private aggregateEvents(events: AnalyticsEvent[], windowStart: number, windowEnd: number): void {
    const stats = new Map<string, EventStats>()

    for (const event of events) {
      if (!event.event) continue

      let eventStats = stats.get(event.event)
      if (!eventStats) {
        eventStats = {
          event: event.event,
          count: 0,
          uniqueUsers: 0,
          properties: {},
          windowStart,
          windowEnd,
        }
        stats.set(event.event, eventStats)
      }

      eventStats.count++
    }

    // Merge with existing stats
    for (const [name, stat] of stats) {
      this.eventStats.set(name, stat)
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an Analytics instance.
 */
export function createAnalytics(options: AnalyticsOptions): Analytics {
  return new Analytics(options)
}
