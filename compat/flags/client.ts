/**
 * @dotdo/flags - LaunchDarkly-Compatible Client
 *
 * Drop-in replacement for LaunchDarkly SDK with edge-native performance.
 *
 * Features:
 * - Full LaunchDarkly API compatibility
 * - TemporalStore integration for flag history
 * - WindowManager integration for analytics aggregation
 * - Event emission for tracking
 */

import { createTemporalStore, type TemporalStore } from '../../db/primitives/temporal-store'
import {
  WindowManager,
  CountTrigger,
  type Window,
  minutes,
} from '../../db/primitives/window-manager'
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
  type EvaluationStats,
  type EvaluationRecord,
  type FlagMetadata,
  type UpdateEvent,
  type ErrorEvent,
  type CustomEvent,
  type IdentifyEvent,
  type FeatureEvent,
} from './types'
import { evaluateFlag, normalizeContext, getContextKey, type EvaluationContext } from './evaluation'
import { isExperimentFlag, createExposureEvent } from './experiments'

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

  // History (TemporalStore integration)
  private _historyEnabled: boolean
  private _historyStore: TemporalStore<EvaluationRecord> | null = null

  // Analytics (WindowManager integration)
  private _analyticsEnabled: boolean
  private _analyticsWindow: WindowManager<EvaluationRecord> | null = null
  private _evaluationStats: Map<string, EvaluationStats> = new Map()

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

    this._historyEnabled = false
    this._analyticsEnabled = false
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

    // Clean up analytics
    if (this._analyticsWindow) {
      this._analyticsWindow.dispose()
      this._analyticsWindow = null
    }
  }

  /**
   * Check if client is offline
   */
  isOffline(): boolean {
    return this._options.offline || this._closed
  }

  // ===========================================================================
  // History (TemporalStore Integration)
  // ===========================================================================

  /**
   * Enable evaluation history
   */
  enableHistory(): void {
    if (!this._historyStore) {
      this._historyStore = createTemporalStore<EvaluationRecord>()
    }
    this._historyEnabled = true
  }

  /**
   * Get evaluation history for a flag and user
   */
  async getEvaluationHistory(
    flagKey: string,
    userKey: string
  ): Promise<EvaluationRecord[]> {
    if (!this._historyStore || !this._historyEnabled) {
      return []
    }

    const key = `${flagKey}:${userKey}`
    const results: EvaluationRecord[] = []
    const iterator = this._historyStore.range(key, {})

    let result = await iterator.next()
    while (!result.done) {
      results.push(result.value)
      result = await iterator.next()
    }

    return results
  }

  /**
   * Get flag value at a specific point in time
   */
  async getValueAsOf(
    flagKey: string,
    userKey: string,
    timestamp: number
  ): Promise<LDFlagValue | null> {
    if (!this._historyStore || !this._historyEnabled) {
      return null
    }

    const key = `${flagKey}:${userKey}`
    const record = await this._historyStore.getAsOf(key, timestamp)
    return record?.value ?? null
  }

  // ===========================================================================
  // Analytics (WindowManager Integration)
  // ===========================================================================

  /**
   * Enable analytics aggregation
   */
  enableAnalytics(): void {
    if (!this._analyticsWindow) {
      const assigner = WindowManager.tumbling<EvaluationRecord>(minutes(5))
      this._analyticsWindow = new WindowManager(assigner)
      this._analyticsWindow.withTrigger(new CountTrigger(100))
      // Note: We track stats directly in _trackEvaluation for immediate access
      // The window manager is used for batched processing (e.g., sending to analytics services)
    }
    this._analyticsEnabled = true
  }

  /**
   * Get evaluation statistics for a flag
   */
  async getEvaluationStats(flagKey: string): Promise<EvaluationStats> {
    return this._evaluationStats.get(flagKey) ?? {
      flagKey,
      totalEvaluations: 0,
      uniqueUsers: 0,
      variationCounts: {},
    }
  }

  /**
   * Aggregate evaluations from a window
   */
  private _aggregateEvaluations(records: EvaluationRecord[]): void {
    const byFlag = new Map<string, EvaluationRecord[]>()

    for (const record of records) {
      const existing = byFlag.get(record.flagKey) ?? []
      existing.push(record)
      byFlag.set(record.flagKey, existing)
    }

    for (const [flagKey, flagRecords] of byFlag) {
      const existing = this._evaluationStats.get(flagKey) ?? {
        flagKey,
        totalEvaluations: 0,
        uniqueUsers: 0,
        variationCounts: {},
      }

      const users = new Set<string>()
      for (const record of flagRecords) {
        existing.totalEvaluations++
        users.add(record.userKey)

        const variation = record.variation ?? 0
        existing.variationCounts[variation] = (existing.variationCounts[variation] ?? 0) + 1
        existing.lastEvaluatedAt = record.timestamp
      }

      existing.uniqueUsers += users.size
      this._evaluationStats.set(flagKey, existing)
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

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

    const record: EvaluationRecord = {
      flagKey,
      userKey,
      value: result.value,
      variation: result.variationIndex ?? undefined,
      reason: result.reason,
      timestamp,
    }

    // Store in history if enabled
    if (this._historyEnabled && this._historyStore) {
      const key = `${flagKey}:${userKey}`
      await this._historyStore.put(key, record, timestamp)
    }

    // Process in analytics window if enabled
    if (this._analyticsEnabled && this._analyticsWindow) {
      this._analyticsWindow.process(record, timestamp)

      // Update stats directly for immediate access (not via window callback to avoid double counting)
      const stats = this._evaluationStats.get(flagKey) ?? {
        flagKey,
        totalEvaluations: 0,
        uniqueUsers: 0,
        variationCounts: {},
        _seenUsers: new Set<string>(),
      }

      stats.totalEvaluations++
      stats.variationCounts[result.variationIndex ?? 0] =
        (stats.variationCounts[result.variationIndex ?? 0] ?? 0) + 1
      stats.lastEvaluatedAt = timestamp

      // Track unique users with a Set
      const seenUsers = (stats as any)._seenUsers as Set<string>
      if (!seenUsers.has(userKey)) {
        seenUsers.add(userKey)
        stats.uniqueUsers = seenUsers.size
      }

      this._evaluationStats.set(flagKey, stats)
    }

    // Emit event for tracking
    if (flag.trackEvents || (result.reason.inExperiment && isExperimentFlag(flag))) {
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

  // Enable history if requested
  if (options?.enableHistory) {
    client.enableHistory()
  }

  // Enable analytics if requested
  if (options?.enableAnalytics) {
    client.enableAnalytics()
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
