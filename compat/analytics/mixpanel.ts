/**
 * @dotdo/analytics - Mixpanel SDK Compat Layer
 *
 * Drop-in replacement for mixpanel-browser backed by Durable Objects.
 *
 * @module @dotdo/analytics/mixpanel
 * @see https://developer.mixpanel.com/docs/javascript
 */

import type {
  MixpanelOptions,
  MixpanelEvent,
  Properties,
  Transport,
  TransportResult,
  BatchPayload,
  Callback,
} from './types.js'
import {
  generateMessageId,
  generateAnonymousId,
  getTimestamp,
  buildLibraryContext,
  InMemoryTransport,
} from './client.js'

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_API_HOST = 'https://api.mixpanel.com'
const DEFAULT_BATCH_SIZE = 50
const DEFAULT_BATCH_FLUSH_INTERVAL = 10000

// =============================================================================
// Group Proxy
// =============================================================================

/**
 * Group operations proxy.
 */
class GroupProxy {
  constructor(
    private readonly mixpanel: Mixpanel,
    private readonly groupType: string,
    private readonly groupId: string
  ) {}

  /**
   * Set group properties.
   */
  set(properties: Properties): void {
    this.mixpanel.enqueueGroupEvent({
      $set: properties,
      $group_key: this.groupId,
      $group_type: this.groupType,
    })
  }

  /**
   * Set group properties once.
   */
  set_once(properties: Properties): void {
    this.mixpanel.enqueueGroupEvent({
      $set_once: properties,
      $group_key: this.groupId,
      $group_type: this.groupType,
    })
  }

  /**
   * Unset group properties.
   */
  unset(property: string | string[]): void {
    const props = Array.isArray(property) ? property : [property]
    this.mixpanel.enqueueGroupEvent({
      $unset: props,
      $group_key: this.groupId,
      $group_type: this.groupType,
    })
  }

  /**
   * Union to group list properties.
   */
  union(listProperty: string, values: unknown[]): void {
    this.mixpanel.enqueueGroupEvent({
      $union: { [listProperty]: values },
      $group_key: this.groupId,
      $group_type: this.groupType,
    })
  }

  /**
   * Remove from group list properties.
   */
  remove(listProperty: string, value: unknown): void {
    this.mixpanel.enqueueGroupEvent({
      $remove: { [listProperty]: value },
      $group_key: this.groupId,
      $group_type: this.groupType,
    })
  }

  /**
   * Delete the group.
   */
  delete_group(): void {
    this.mixpanel.enqueueGroupEvent({
      $delete: true,
      $group_key: this.groupId,
      $group_type: this.groupType,
    })
  }
}

// =============================================================================
// People API
// =============================================================================

/**
 * People (user profile) operations.
 */
class People {
  constructor(private readonly mixpanel: Mixpanel) {}

  /**
   * Set user properties.
   */
  set(properties: Properties, callback?: Callback): void {
    this.mixpanel.enqueuePeopleEvent({
      $set: properties,
    }, callback)
  }

  /**
   * Set user properties once (only if not already set).
   */
  set_once(properties: Properties, callback?: Callback): void {
    this.mixpanel.enqueuePeopleEvent({
      $set_once: properties,
    }, callback)
  }

  /**
   * Increment numeric properties.
   */
  increment(property: string | Properties, value?: number, callback?: Callback): void {
    if (typeof property === 'string') {
      this.mixpanel.enqueuePeopleEvent({
        $add: { [property]: value ?? 1 },
      }, callback)
    } else {
      this.mixpanel.enqueuePeopleEvent({
        $add: property,
      }, callback)
    }
  }

  /**
   * Append to list properties.
   */
  append(property: string | Properties, value?: unknown, callback?: Callback): void {
    if (typeof property === 'string') {
      this.mixpanel.enqueuePeopleEvent({
        $append: { [property]: value },
      }, callback)
    } else {
      this.mixpanel.enqueuePeopleEvent({
        $append: property,
      }, callback)
    }
  }

  /**
   * Union to list properties (unique values).
   */
  union(property: string | Properties, values?: unknown[], callback?: Callback): void {
    if (typeof property === 'string') {
      this.mixpanel.enqueuePeopleEvent({
        $union: { [property]: values },
      }, callback)
    } else {
      this.mixpanel.enqueuePeopleEvent({
        $union: property,
      }, callback)
    }
  }

  /**
   * Remove from list properties.
   */
  remove(property: string | Properties, value?: unknown, callback?: Callback): void {
    if (typeof property === 'string') {
      this.mixpanel.enqueuePeopleEvent({
        $remove: { [property]: value },
      }, callback)
    } else {
      this.mixpanel.enqueuePeopleEvent({
        $remove: property,
      }, callback)
    }
  }

  /**
   * Unset properties.
   */
  unset(property: string | string[], callback?: Callback): void {
    const props = Array.isArray(property) ? property : [property]
    this.mixpanel.enqueuePeopleEvent({
      $unset: props,
    }, callback)
  }

  /**
   * Delete the user profile.
   */
  delete_user(callback?: Callback): void {
    this.mixpanel.enqueuePeopleEvent({
      $delete: true,
    }, callback)
  }

  /**
   * Track a charge (revenue).
   */
  track_charge(amount: number, properties?: Properties, callback?: Callback): void {
    const transaction: Properties = {
      $amount: amount,
      $time: getTimestamp(),
      ...properties,
    }

    this.mixpanel.enqueuePeopleEvent({
      $append: { $transactions: transaction },
    }, callback)
  }

  /**
   * Clear all charges.
   */
  clear_charges(callback?: Callback): void {
    this.mixpanel.enqueuePeopleEvent({
      $unset: ['$transactions'],
    }, callback)
  }
}

// =============================================================================
// Mixpanel Client
// =============================================================================

/**
 * Mixpanel-compatible analytics client.
 */
export class Mixpanel {
  readonly token: string
  readonly debug: boolean
  readonly config: {
    api_host: string
    batch_size: number
    batch_flush_interval_ms: number
  }

  /** People API */
  readonly people: People

  private readonly transport: Transport
  private readonly errorHandler?: (error: Error) => void

  // User state
  private distinctId: string
  private superProperties: Properties = {}
  private groups: Map<string, string[]> = new Map()

  // Opt-out
  private optedOut = false

  // Timed events
  private timedEvents: Map<string, number> = new Map()

  // Queue
  private queue: MixpanelEvent[] = []
  private pendingCallbacks: Array<{ callback: Callback; eventCount: number }> = []
  private flushTimer?: ReturnType<typeof setTimeout>

  constructor(options: MixpanelOptions) {
    this.token = options.token
    this.debug = options.debug || false
    this.config = {
      api_host: options.api_host || DEFAULT_API_HOST,
      batch_size: options.batch_size ?? options.flushAt ?? DEFAULT_BATCH_SIZE,
      batch_flush_interval_ms: options.batch_flush_interval_ms ?? options.flushInterval ?? DEFAULT_BATCH_FLUSH_INTERVAL,
    }
    this.errorHandler = options.errorHandler

    // Initialize people API
    this.people = new People(this)

    // Initialize distinct ID
    this.distinctId = generateAnonymousId()

    // Create transport
    this.transport = options.transport
      ? options.transport({ apiKey: this.token })
      : this.createDefaultTransport()
  }

  /**
   * Create default transport.
   */
  private createDefaultTransport(): Transport {
    const events: MixpanelEvent[] = []
    const batches: BatchPayload[] = []
    const url = `${this.config.api_host}/track`
    const token = this.token

    return {
      async send(payload: BatchPayload): Promise<TransportResult> {
        batches.push(payload)
        events.push(...payload.events as MixpanelEvent[])

        try {
          const data = btoa(JSON.stringify(payload.events))
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `data=${encodeURIComponent(data)}`,
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
    if (this.optedOut) {
      callback?.(1)
      return
    }

    // Check for timed event
    let duration: number | undefined
    const startTime = this.timedEvents.get(event)
    if (startTime !== undefined) {
      duration = (Date.now() - startTime) / 1000 // Mixpanel uses seconds
      this.timedEvents.delete(event)
    }

    const eventProperties: Properties = {
      ...this.superProperties,
      ...properties,
      token: this.token,
      distinct_id: this.distinctId,
      time: Math.floor(Date.now() / 1000),
      $insert_id: generateMessageId(),
      mp_lib: '@dotdo/analytics',
    }

    if (duration !== undefined) {
      eventProperties.$duration = duration
    }

    // Add group properties
    for (const [groupType, groupIds] of this.groups) {
      eventProperties[`$${groupType}`] = groupIds.length === 1 ? groupIds[0] : groupIds
    }

    const mixpanelEvent: MixpanelEvent = {
      event,
      properties: eventProperties,
    }

    this.enqueue(mixpanelEvent, callback)
  }

  /**
   * Time an event.
   */
  time_event(event: string): void {
    this.timedEvents.set(event, Date.now())
  }

  // ===========================================================================
  // Identify API
  // ===========================================================================

  /**
   * Identify a user.
   */
  identify(userId: string): void {
    this.distinctId = userId
  }

  /**
   * Get the current distinct ID.
   */
  get_distinct_id(): string {
    return this.distinctId
  }

  // ===========================================================================
  // Alias API
  // ===========================================================================

  /**
   * Create an alias.
   */
  alias(newId: string, originalId?: string): void {
    if (this.optedOut) return

    const event: MixpanelEvent = {
      event: '$create_alias',
      properties: {
        token: this.token,
        distinct_id: originalId || this.distinctId,
        alias: newId,
      },
    }

    this.enqueue(event)
  }

  // ===========================================================================
  // Group API
  // ===========================================================================

  /**
   * Set group membership.
   */
  set_group(groupType: string, groupId: string | string[]): void {
    const groupIds = Array.isArray(groupId) ? groupId : [groupId]
    this.groups.set(groupType, groupIds)

    // Also set on the user profile
    this.enqueuePeopleEvent({
      $set: { [groupType]: groupIds },
    })
  }

  /**
   * Add to group.
   */
  add_group(groupType: string, groupId: string): void {
    const existing = this.groups.get(groupType) || []
    if (!existing.includes(groupId)) {
      existing.push(groupId)
      this.groups.set(groupType, existing)
    }

    this.enqueuePeopleEvent({
      $union: { [groupType]: [groupId] },
    })
  }

  /**
   * Remove from group.
   */
  remove_group(groupType: string, groupId: string): void {
    const existing = this.groups.get(groupType) || []
    const index = existing.indexOf(groupId)
    if (index !== -1) {
      existing.splice(index, 1)
      this.groups.set(groupType, existing)
    }

    this.enqueuePeopleEvent({
      $remove: { [groupType]: groupId },
    })
  }

  /**
   * Get group proxy for group operations.
   */
  get_group(groupType: string, groupId: string): GroupProxy {
    return new GroupProxy(this, groupType, groupId)
  }

  // ===========================================================================
  // Super Properties
  // ===========================================================================

  /**
   * Register super properties.
   */
  register(properties: Properties): void {
    this.superProperties = {
      ...this.superProperties,
      ...properties,
    }
  }

  /**
   * Register super properties once.
   */
  register_once(properties: Properties): void {
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
   * Get a super property.
   */
  get_property(property: string): unknown {
    return this.superProperties[property]
  }

  // ===========================================================================
  // Opt-out
  // ===========================================================================

  /**
   * Opt out of tracking.
   */
  opt_out_tracking(options?: { clear_persistence?: boolean }): void {
    this.optedOut = true

    if (options?.clear_persistence) {
      this.distinctId = generateAnonymousId()
      this.superProperties = {}
      this.groups.clear()
    }
  }

  /**
   * Opt in to tracking.
   */
  opt_in_tracking(): void {
    this.optedOut = false
  }

  /**
   * Check if opted out.
   */
  has_opted_out_tracking(): boolean {
    return this.optedOut
  }

  // ===========================================================================
  // Reset
  // ===========================================================================

  /**
   * Reset state.
   */
  reset(): void {
    this.distinctId = generateAnonymousId()
    this.superProperties = {}
    this.groups.clear()
    this.timedEvents.clear()
  }

  // ===========================================================================
  // Queue
  // ===========================================================================

  /**
   * Enqueue an event.
   */
  private enqueue(event: MixpanelEvent, callback?: Callback): void {
    if (this.optedOut) {
      callback?.(1)
      return
    }

    this.queue.push(event)

    // Record event immediately for testing (if transport supports it)
    if ('recordEvent' in this.transport && typeof (this.transport as any).recordEvent === 'function') {
      (this.transport as any).recordEvent(event)
    }

    if (callback) {
      this.pendingCallbacks.push({ callback, eventCount: 1 })
    }

    if (this.queue.length >= this.config.batch_size) {
      this.flush()
    } else {
      this.scheduleFlush()
    }
  }

  /**
   * Enqueue a people event (internal).
   */
  enqueuePeopleEvent(data: Partial<MixpanelEvent>, callback?: Callback): void {
    if (this.optedOut) {
      callback?.(1)
      return
    }

    const event: MixpanelEvent = {
      ...data,
      distinct_id: this.distinctId,
      token: this.token,
    }

    this.queue.push(event)

    // Record event immediately for testing (if transport supports it)
    if ('recordEvent' in this.transport && typeof (this.transport as any).recordEvent === 'function') {
      (this.transport as any).recordEvent(event)
    }

    if (callback) {
      this.pendingCallbacks.push({ callback, eventCount: 1 })
    }
  }

  /**
   * Enqueue a group event (internal).
   */
  enqueueGroupEvent(data: Partial<MixpanelEvent>): void {
    if (this.optedOut) return

    const event: MixpanelEvent = {
      ...data,
      token: this.token,
    }

    this.queue.push(event)

    // Record event immediately for testing (if transport supports it)
    if ('recordEvent' in this.transport && typeof (this.transport as any).recordEvent === 'function') {
      (this.transport as any).recordEvent(event)
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
    }, this.config.batch_flush_interval_ms)
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
      apiKey: this.token,
    }

    try {
      await this.transport.send(payload)
      this.invokePendingCallbacks(1)
      return true
    } catch (error) {
      this.handleError(error as Error)
      this.invokePendingCallbacks(0)
      return false
    }
  }

  /**
   * Invoke pending callbacks.
   */
  private invokePendingCallbacks(result: number = 1): void {
    for (const { callback } of this.pendingCallbacks) {
      try {
        callback(undefined, result)
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
 * Create a Mixpanel instance.
 */
export function createMixpanel(options: MixpanelOptions): Mixpanel {
  return new Mixpanel(options)
}

// Re-export InMemoryTransport
export { InMemoryTransport } from './client.js'
