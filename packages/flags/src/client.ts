/**
 * @dotdo/flags - LaunchDarkly-Compatible Client
 *
 * Drop-in replacement for LaunchDarkly SDK with edge-native performance.
 *
 * Features:
 * - Full LaunchDarkly API compatibility
 * - In-memory flag storage
 * - Event emission for tracking
 */

import {
  type LDFlagValue,
  type LDFlagSet,
  type LDUser,
  type LDContext,
  type LDEvaluationDetail,
  type LDEvaluationReason,
  type LDOptions,
  type LDFlagsState,
  type LDAllFlagsStateOptions,
  type LDClientEvent,
  type LDEventCallback,
  type FeatureFlag,
  type TestClientOptions,
  type FlagMetadata,
  type CustomEvent,
  type IdentifyEvent,
  type FeatureEvent,
} from './types'
import { evaluateFlag, normalizeContext, getContextKey, type EvaluationContext } from './evaluation'

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BASE_URI = 'https://sdk.launchdarkly.com'
const DEFAULT_EVENTS_URI = 'https://events.launchdarkly.com'
const DEFAULT_STREAM_URI = 'https://stream.launchdarkly.com'
const DEFAULT_TIMEOUT = 5000
const DEFAULT_FLUSH_INTERVAL = 30000
const DEFAULT_CAPACITY = 100

// =============================================================================
// LDClient Implementation
// =============================================================================

/**
 * LaunchDarkly-compatible client
 */
export class LDClient {
  private _sdkKey: string
  private _options: Required<LDOptions>
  private _flags: Map<string, FeatureFlag> = new Map()
  private _initialized = false
  private _closed = false

  // Event system
  private _eventListeners: Map<LDClientEvent, Set<LDEventCallback>> = new Map()
  private _eventQueue: Array<FeatureEvent | CustomEvent | IdentifyEvent> = []

  constructor(sdkKey: string, options?: LDOptions) {
    this._sdkKey = sdkKey
    this._options = {
      baseUri: options?.baseUri ?? DEFAULT_BASE_URI,
      streamUri: options?.streamUri ?? DEFAULT_STREAM_URI,
      eventsUri: options?.eventsUri ?? DEFAULT_EVENTS_URI,
      timeout: options?.timeout ?? DEFAULT_TIMEOUT,
      flushInterval: options?.flushInterval ?? DEFAULT_FLUSH_INTERVAL,
      capacity: options?.capacity ?? DEFAULT_CAPACITY,
      stream: options?.stream ?? true,
      offline: options?.offline ?? false,
      allAttributesPrivate: options?.allAttributesPrivate ?? false,
      privateAttributes: options?.privateAttributes ?? [],
      sendEvents: options?.sendEvents ?? true,
      diagnosticOptOut: options?.diagnosticOptOut ?? false,
      wrapperName: options?.wrapperName ?? '@dotdo/flags',
      wrapperVersion: options?.wrapperVersion ?? '1.0.0',
      application: options?.application ?? {},
    }
  }

  // ===========================================================================
  // Getters
  // ===========================================================================

  get sdkKey(): string {
    return this._sdkKey
  }

  get baseUri(): string {
    return this._options.baseUri
  }

  get timeout(): number {
    return this._options.timeout
  }

  get offline(): boolean {
    return this._options.offline
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Wait for the client to initialize
   */
  async waitForInitialization(): Promise<void> {
    if (this._initialized) {
      // Already initialized, emit ready event for any new listeners
      queueMicrotask(() => this._emit('ready', undefined))
      return
    }

    // In test/offline mode, initialize immediately
    this._initialized = true
    // Use queueMicrotask to allow listeners to be registered first
    queueMicrotask(() => this._emit('ready', undefined))
  }

  /**
   * Check if client is ready
   */
  async ready(): Promise<void> {
    return this.waitForInitialization()
  }

  // ===========================================================================
  // Flag Evaluation
  // ===========================================================================

  /**
   * Evaluate a flag and return its value
   */
  async variation<T extends LDFlagValue>(
    flagKey: string,
    userOrContext: LDUser | LDContext,
    defaultValue: T
  ): Promise<T> {
    const detail = await this.variationDetail(flagKey, userOrContext, defaultValue)
    return detail.value as T
  }

  /**
   * Evaluate a flag and return detailed result
   */
  async variationDetail<T extends LDFlagValue>(
    flagKey: string,
    userOrContext: LDUser | LDContext,
    defaultValue: T
  ): Promise<LDEvaluationDetail<T>> {
    // Validate user/context
    if (!userOrContext) {
      this._emit('error', { message: 'User or context is required' })
      return {
        value: defaultValue,
        variationIndex: null,
        reason: { kind: 'ERROR', errorKind: 'USER_NOT_SPECIFIED' },
      }
    }

    // Check for valid context structure
    const isMultiContext = 'kind' in userOrContext && userOrContext.kind === 'multi'
    const hasKey = 'key' in userOrContext && userOrContext.key

    if (!isMultiContext && !hasKey) {
      this._emit('error', { message: 'User key is required' })
      return {
        value: defaultValue,
        variationIndex: null,
        reason: { kind: 'ERROR', errorKind: 'USER_NOT_SPECIFIED' },
      }
    }

    const context = normalizeContext(userOrContext)
    const flag = this._flags.get(flagKey)

    if (!flag) {
      return {
        value: defaultValue,
        variationIndex: null,
        reason: { kind: 'ERROR', errorKind: 'FLAG_NOT_FOUND' },
      }
    }

    const ctx: EvaluationContext = {
      flagKey,
      flag,
      context,
      defaultValue,
      getFlag: (key) => this._flags.get(key),
    }

    const result = evaluateFlag(ctx)

    // Track evaluation
    await this._trackEvaluation(flagKey, context, result, defaultValue, flag)

    return result as LDEvaluationDetail<T>
  }

  /**
   * Type-safe boolean variation
   */
  async boolVariation(
    flagKey: string,
    userOrContext: LDUser | LDContext,
    defaultValue: boolean
  ): Promise<boolean> {
    const result = await this.variation(flagKey, userOrContext, defaultValue)
    return Boolean(result)
  }

  /**
   * Type-safe string variation
   */
  async stringVariation(
    flagKey: string,
    userOrContext: LDUser | LDContext,
    defaultValue: string
  ): Promise<string> {
    const result = await this.variation(flagKey, userOrContext, defaultValue)
    return String(result)
  }

  /**
   * Type-safe number variation
   */
  async numberVariation(
    flagKey: string,
    userOrContext: LDUser | LDContext,
    defaultValue: number
  ): Promise<number> {
    const result = await this.variation(flagKey, userOrContext, defaultValue)
    return Number(result)
  }

  /**
   * Type-safe JSON variation
   */
  async jsonVariation<T extends Record<string, LDFlagValue>>(
    flagKey: string,
    userOrContext: LDUser | LDContext,
    defaultValue: T
  ): Promise<T> {
    const result = await this.variation(flagKey, userOrContext, defaultValue)
    if (typeof result === 'object' && result !== null) {
      return result as T
    }
    return defaultValue
  }

  // ===========================================================================
  // All Flags
  // ===========================================================================

  /**
   * Get all flag values for a user
   */
  async allFlagsState(
    userOrContext: LDUser | LDContext,
    options?: LDAllFlagsStateOptions
  ): Promise<LDFlagsState> {
    const context = normalizeContext(userOrContext)
    const values: LDFlagSet = {}
    const metadata: Record<string, FlagMetadata> = {}

    for (const [flagKey, flag] of this._flags) {
      // Filter client-side only flags if requested
      if (options?.clientSideOnly) {
        if (!flag.clientSideAvailability?.usingEnvironmentId) {
          continue
        }
      }

      const ctx: EvaluationContext = {
        flagKey,
        flag,
        context,
        defaultValue: null,
        getFlag: (key) => this._flags.get(key),
      }

      const result = evaluateFlag(ctx)
      values[flagKey] = result.value

      if (options?.withReasons) {
        metadata[flagKey] = {
          version: flag.version,
          variation: result.variationIndex ?? undefined,
          reason: result.reason,
          trackEvents: flag.trackEvents,
        }
      }
    }

    return {
      valid: true,
      toJSON: () => {
        if (options?.withReasons) {
          return { ...values, $flagsState: metadata, $valid: true }
        }
        return values
      },
      getFlagValue: (key: string) => values[key],
      getFlagReason: (key: string) => metadata[key]?.reason,
    }
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  /**
   * Track a custom event
   */
  track(
    eventKey: string,
    userOrContext: LDUser | LDContext,
    data?: Record<string, LDFlagValue>,
    metricValue?: number
  ): void {
    const context = normalizeContext(userOrContext)

    const event: CustomEvent = {
      kind: 'custom',
      key: eventKey,
      creationDate: Date.now(),
      context,
      data,
      metricValue,
    }

    // Also set user for backwards compatibility
    if (!('kind' in userOrContext)) {
      event.user = userOrContext
    }

    this._eventQueue.push(event)
    this._emit('event', event)
  }

  /**
   * Identify a user
   */
  identify(userOrContext: LDUser | LDContext): void {
    const context = normalizeContext(userOrContext)

    const event: IdentifyEvent = {
      kind: 'identify',
      creationDate: Date.now(),
      context,
    }

    if (!('kind' in userOrContext)) {
      event.user = userOrContext
    }

    this._eventQueue.push(event)
    this._emit('event', event)
  }

  // ===========================================================================
  // Event Listeners
  // ===========================================================================

  /**
   * Subscribe to client events
   */
  on(event: LDClientEvent, callback: LDEventCallback): void {
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, new Set())
    }
    this._eventListeners.get(event)!.add(callback)
  }

  /**
   * Unsubscribe from client events
   */
  off(event: LDClientEvent, callback: LDEventCallback): void {
    this._eventListeners.get(event)?.delete(callback)
  }

  private _emit(event: LDClientEvent, data: unknown): void {
    const listeners = this._eventListeners.get(event)
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(data)
        } catch (e) {
          // Ignore callback errors
        }
      }
    }
  }

  // ===========================================================================
  // Flag Management
  // ===========================================================================

  /**
   * Set or update a flag
   */
  setFlag(flagKey: string, flag: Partial<FeatureFlag>): void {
    const existing = this._flags.get(flagKey)
    const updated: FeatureFlag = {
      ...existing,
      ...flag,
      // Preserve version if explicitly set, otherwise increment
      version: flag.version ?? (existing?.version ?? 0) + 1,
    }
    this._flags.set(flagKey, updated)
    this._emit('update', { key: flagKey })
  }

  /**
   * Delete a flag
   */
  deleteFlag(flagKey: string): void {
    this._flags.delete(flagKey)
    this._emit('update', { key: flagKey })
  }

  /**
   * Get all registered destinations (for compatibility)
   */
  getDestinations(): unknown[] {
    return []
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Flush pending events
   */
  async flush(): Promise<void> {
    // In a real implementation, this would send events to the server
    this._eventQueue = []
  }

  /**
   * Close the client
   */
  async close(): Promise<void> {
    await this.flush()
    this._closed = true
    this._options.offline = true
  }

  /**
   * Check if client is offline
   */
  isOffline(): boolean {
    return this._options.offline || this._closed
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Check if a flag is configured as an experiment
   */
  private _isExperimentFlag(flag: FeatureFlag): boolean {
    if (flag.trackEvents && flag.fallthrough?.rollout?.kind === 'experiment') {
      return true
    }

    if (flag.rules) {
      for (const rule of flag.rules) {
        if (rule.rollout?.kind === 'experiment') {
          return true
        }
      }
    }

    return false
  }

  /**
   * Track an evaluation for history and analytics
   */
  private async _trackEvaluation(
    flagKey: string,
    context: LDContext,
    result: LDEvaluationDetail,
    defaultValue: LDFlagValue,
    flag: FeatureFlag
  ): Promise<void> {
    const userKey = getContextKey(context, 'user') ?? 'unknown'
    const timestamp = Date.now()

    // Emit event for tracking
    if (flag.trackEvents || (result.reason.inExperiment && this._isExperimentFlag(flag))) {
      const featureEvent: FeatureEvent = {
        kind: 'feature',
        key: flagKey,
        value: result.value,
        default: defaultValue,
        variation: result.variationIndex ?? undefined,
        version: flag.version,
        reason: result.reason,
        trackEvents: flag.trackEvents,
        creationDate: timestamp,
        context,
      }

      this._eventQueue.push(featureEvent)
      this._emit('event', featureEvent)
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a LaunchDarkly-compatible client
 */
export function createClient(sdkKey: string, options?: LDOptions): LDClient {
  return new LDClient(sdkKey, options)
}

/**
 * Create a test client with pre-configured flags
 */
export function createTestClient(options?: TestClientOptions): LDClient {
  const client = new LDClient('test-sdk-key', { offline: true })

  // Set up flags from options
  if (options?.flags) {
    for (const [key, flag] of Object.entries(options.flags)) {
      client.setFlag(key, flag)
    }
  }

  // Mark as initialized
  client.waitForInitialization()

  return client
}

// =============================================================================
// Global State Management (for testing)
// =============================================================================

let _globalClient: LDClient | null = null

/**
 * Set the global client instance
 */
export function setGlobalClient(client: LDClient): void {
  _globalClient = client
}

/**
 * Get the global client instance
 */
export function getGlobalClient(): LDClient | null {
  return _globalClient
}

/**
 * Clear global state (for testing)
 */
export function _clear(): void {
  _globalClient = null
}
