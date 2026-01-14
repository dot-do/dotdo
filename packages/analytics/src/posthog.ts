/**
 * @dotdo/analytics - PostHog SDK Compat Layer
 *
 * Drop-in replacement for posthog-js.
 *
 * @module @dotdo/analytics/posthog
 * @see https://posthog.com/docs/libraries/js
 */

import type {
  PostHogOptions,
  PostHogEvent,
  Properties,
  Transport,
  TransportResult,
  BatchPayload,
  Callback,
  Survey,
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

const SDK_NAME = '@dotdo/analytics'
const SDK_VERSION = '0.1.0'
const DEFAULT_HOST = 'https://app.posthog.com'
const DEFAULT_FLUSH_AT = 20
const DEFAULT_FLUSH_INTERVAL = 10000

// =============================================================================
// PostHog Client
// =============================================================================

/**
 * PostHog-compatible analytics client.
 */
export class PostHog {
  readonly apiKey: string
  readonly config: {
    host: string
    persistence: 'localStorage' | 'sessionStorage' | 'cookie' | 'memory'
    debug: boolean
    flushAt: number
    flushInterval: number
    autocapture: boolean
    capture_pageview: boolean
    capture_pageleave: boolean
  }

  private readonly transport: Transport
  private readonly errorHandler?: (error: Error) => void

  // User state
  private distinctId: string
  private anonymousId: string
  private personProperties: Properties = {}
  private superProperties: Properties = {}
  private groups: Record<string, string> = {}

  // Feature flags
  private featureFlags: Record<string, boolean | string> = {}
  private featureFlagPayloads: Record<string, unknown> = {}
  private featureFlagCallbacks: Array<(flags: Record<string, boolean | string>) => void> = []

  // Session
  private sessionId: string

  // Opt-out
  private optedOut = false

  // Queue
  private queue: PostHogEvent[] = []
  private pendingCallbacks: Callback[] = []
  private flushTimer?: ReturnType<typeof setTimeout>

  constructor(options: PostHogOptions) {
    this.apiKey = options.apiKey
    this.config = {
      host: options.host || DEFAULT_HOST,
      persistence: options.persistence || 'memory',
      debug: options.debug || false,
      flushAt: options.flushAt ?? DEFAULT_FLUSH_AT,
      flushInterval: options.flushInterval ?? DEFAULT_FLUSH_INTERVAL,
      autocapture: options.autocapture ?? false,
      capture_pageview: options.capture_pageview ?? false,
      capture_pageleave: options.capture_pageleave ?? false,
    }
    this.errorHandler = options.errorHandler

    // Initialize IDs
    this.anonymousId = options.bootstrap?.distinctID || generateAnonymousId()
    this.distinctId = this.anonymousId
    this.sessionId = generateMessageId()

    // Initialize feature flags from bootstrap
    if (options.bootstrap?.featureFlags) {
      this.featureFlags = { ...options.bootstrap.featureFlags }
    }
    if (options.bootstrap?.featureFlagPayloads) {
      this.featureFlagPayloads = { ...options.bootstrap.featureFlagPayloads }
    }

    // Create transport
    this.transport = options.transport
      ? options.transport({ apiKey: this.apiKey })
      : this.createDefaultTransport()
  }

  /**
   * Create default transport.
   */
  private createDefaultTransport(): Transport {
    const events: PostHogEvent[] = []
    const batches: BatchPayload[] = []
    const url = `${this.config.host}/batch/`
    const apiKey = this.apiKey

    return {
      async send(payload: BatchPayload): Promise<TransportResult> {
        batches.push(payload)
        events.push(...payload.events as PostHogEvent[])

        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              api_key: apiKey,
              batch: payload.events,
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
  // Capture API
  // ===========================================================================

  /**
   * Capture an event (PostHog's track equivalent).
   */
  capture(event: string, properties?: Properties, callback?: Callback): void {
    if (this.optedOut) {
      callback?.()
      return
    }

    const eventProperties: Properties = {
      ...this.superProperties,
      ...properties,
      $lib: SDK_NAME,
      $lib_version: SDK_VERSION,
    }

    // Add groups to properties
    if (Object.keys(this.groups).length > 0) {
      eventProperties.$groups = { ...this.groups }
    }

    const posthogEvent: PostHogEvent = {
      event,
      distinct_id: this.distinctId,
      properties: eventProperties,
      timestamp: getTimestamp(),
      message_id: generateMessageId(),
    }

    this.enqueue(posthogEvent, callback)
  }

  // ===========================================================================
  // Identify API
  // ===========================================================================

  /**
   * Identify a user.
   */
  identify(userId: string, userProperties?: Properties, userPropertiesOnce?: Properties): void {
    if (this.optedOut) return

    this.distinctId = userId

    const event: PostHogEvent = {
      event: '$identify',
      distinct_id: userId,
      $set: userProperties,
      $set_once: userPropertiesOnce,
      properties: {
        $anon_distinct_id: this.anonymousId,
        $lib: SDK_NAME,
        $lib_version: SDK_VERSION,
      },
      timestamp: getTimestamp(),
      message_id: generateMessageId(),
    }

    this.enqueue(event)
  }

  /**
   * Get current distinct ID.
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

    const event: PostHogEvent = {
      event: '$create_alias',
      distinct_id: originalId || this.distinctId,
      properties: {
        alias: newId,
        $lib: SDK_NAME,
        $lib_version: SDK_VERSION,
      },
      timestamp: getTimestamp(),
      message_id: generateMessageId(),
    }

    this.enqueue(event)
  }

  // ===========================================================================
  // Group API
  // ===========================================================================

  /**
   * Set group membership and properties.
   */
  group(groupType: string, groupKey: string, groupProperties?: Properties): void {
    if (this.optedOut) return

    this.groups[groupType] = groupKey

    const event: PostHogEvent = {
      event: '$groupidentify',
      distinct_id: this.distinctId,
      $group_type: groupType,
      $group_key: groupKey,
      $group_set: groupProperties,
      properties: {
        $lib: SDK_NAME,
        $lib_version: SDK_VERSION,
      },
      timestamp: getTimestamp(),
      message_id: generateMessageId(),
    }

    this.enqueue(event)
  }

  /**
   * Reset groups.
   */
  resetGroups(): void {
    this.groups = {}
  }

  // ===========================================================================
  // Person Properties
  // ===========================================================================

  /**
   * Set person properties.
   */
  setPersonProperties(properties: Properties): void {
    if (this.optedOut) return

    const event: PostHogEvent = {
      event: '$set',
      distinct_id: this.distinctId,
      $set: properties,
      properties: {
        $lib: SDK_NAME,
        $lib_version: SDK_VERSION,
      },
      timestamp: getTimestamp(),
      message_id: generateMessageId(),
    }

    this.enqueue(event)
  }

  /**
   * Set person properties for feature flag evaluation (local only).
   */
  setPersonPropertiesForFlags(properties: Properties): void {
    this.personProperties = {
      ...this.personProperties,
      ...properties,
    }
  }

  /**
   * Get person properties (local).
   */
  getPersonProperties(): Properties {
    return { ...this.personProperties }
  }

  // ===========================================================================
  // Page/Screen
  // ===========================================================================

  /**
   * Capture screen view (mobile).
   */
  screen(screenName: string, properties?: Properties): void {
    this.capture('$screen', {
      $screen_name: screenName,
      ...properties,
    })
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
   * Get feature flag payload.
   */
  getFeatureFlagPayload(flag: string): unknown {
    return this.featureFlagPayloads[flag]
  }

  /**
   * Get all feature flags.
   */
  getAllFlags(): Record<string, boolean | string> {
    return { ...this.featureFlags }
  }

  /**
   * Get feature flags and payloads.
   */
  getFeatureFlagsAndPayloads(): {
    flags: Record<string, boolean | string>
    payloads: Record<string, unknown>
  } {
    return {
      flags: { ...this.featureFlags },
      payloads: { ...this.featureFlagPayloads },
    }
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
    // Call immediately with current flags
    callback(this.featureFlags)
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

  // ===========================================================================
  // Opt-out
  // ===========================================================================

  /**
   * Opt out of capturing.
   */
  opt_out_capturing(): void {
    this.optedOut = true
  }

  /**
   * Opt in to capturing.
   */
  opt_in_capturing(): void {
    this.optedOut = false
  }

  /**
   * Check if opted out.
   */
  has_opted_out_capturing(): boolean {
    return this.optedOut
  }

  // ===========================================================================
  // Reset
  // ===========================================================================

  /**
   * Reset state.
   */
  reset(): void {
    this.anonymousId = generateAnonymousId()
    this.distinctId = this.anonymousId
    this.superProperties = {}
    this.personProperties = {}
    this.groups = {}
    this.sessionId = generateMessageId()
  }

  // ===========================================================================
  // Session Recording (Stubs for edge environment)
  // ===========================================================================

  /**
   * Start session recording (stub).
   */
  startSessionRecording(): void {
    // Session recording requires browser DOM - stub in edge environment
  }

  /**
   * Stop session recording (stub).
   */
  stopSessionRecording(): void {
    // Session recording requires browser DOM - stub in edge environment
  }

  /**
   * Check if session recording is active (stub).
   */
  isSessionRecordingActive(): boolean {
    return false
  }

  /**
   * Get session ID.
   */
  getSessionId(): string {
    return this.sessionId
  }

  // ===========================================================================
  // Surveys (Stubs for edge environment)
  // ===========================================================================

  /**
   * Get active matching surveys (stub).
   */
  getActiveMatchingSurveys(callback: (surveys: Survey[]) => void): void {
    callback([])
  }

  /**
   * Get surveys (stub).
   */
  getSurveys(callback: (surveys: Survey[]) => void): void {
    callback([])
  }

  // ===========================================================================
  // Debug
  // ===========================================================================

  /**
   * Enable/disable debug mode.
   */
  debug(enable: boolean = true): void {
    (this.config as any).debug = enable
  }

  // ===========================================================================
  // Queue
  // ===========================================================================

  /**
   * Enqueue an event.
   */
  private enqueue(event: PostHogEvent, callback?: Callback): void {
    if (this.optedOut) {
      callback?.()
      return
    }

    this.queue.push(event)

    // Record event immediately for testing (if transport supports it)
    if ('recordEvent' in this.transport && typeof (this.transport as any).recordEvent === 'function') {
      (this.transport as any).recordEvent(event)
    }

    if (callback) {
      this.pendingCallbacks.push(callback)
    }

    if (this.queue.length >= this.config.flushAt) {
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
    }, this.config.flushInterval)
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
   * Shutdown (flush and cleanup).
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    await this.flush()
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
 * Create a PostHog instance.
 */
export function createPostHog(options: PostHogOptions): PostHog {
  return new PostHog(options)
}

// Re-export InMemoryTransport
export { InMemoryTransport } from './client.js'
