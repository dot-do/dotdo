/**
 * Feature Flags Client
 *
 * Client for evaluating feature flags with caching, bootstrap data,
 * change notifications, hot reload, and metrics tracking.
 *
 * @module @dotdo/compat/flags/client
 */

import { evaluate } from './evaluation'
import type {
  EvaluationContext,
  EvaluationDetails,
  FlagDefinition,
} from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for the FlagsClient
 */
export interface FlagsConfig {
  /** API endpoint for fetching flags */
  endpoint?: string
  /** API key for authentication */
  apiKey?: string
  /** Cache configuration */
  cache?: {
    enabled?: boolean
    ttl?: number
  }
  /** Offline mode - use only bootstrap data */
  offline?: boolean
  /** Bootstrap data - initial flag values */
  bootstrap?: Record<string, unknown>
  /** Debug mode for detailed logging */
  debug?: boolean
  /** Polling interval in ms for hot reload (0 = disabled) */
  pollingInterval?: number
}

/**
 * Handler for flag change events
 */
export interface FlagChangeHandler<T = unknown> {
  (key: string, oldValue: T | null, newValue: T | null): void
}

/**
 * Internal cache entry
 */
interface CacheEntry<T> {
  value: T
  timestamp: number
  contextHash: string
}

/**
 * Metrics for tracking flag evaluations
 */
export interface FlagsMetrics {
  /** Total number of evaluations */
  evaluations: number
  /** Cache hits */
  cacheHits: number
  /** Cache misses */
  cacheMisses: number
  /** Per-flag evaluation counts */
  flagEvaluations: Record<string, number>
  /** Last evaluation timestamp */
  lastEvaluationAt: number | null
  /** Last reload timestamp */
  lastReloadAt: number | null
}

/**
 * Event types emitted by the client
 */
export type FlagEventType =
  | 'change'
  | 'reload'
  | 'error'
  | 'ready'

/**
 * Event handler for flag events
 */
export interface FlagEventHandler {
  (event: FlagEvent): void
}

/**
 * Flag event payload
 */
export interface FlagEvent {
  type: FlagEventType
  key?: string
  oldValue?: unknown
  newValue?: unknown
  error?: Error
  timestamp: number
}

/**
 * Debug log entry
 */
export interface DebugLogEntry {
  timestamp: number
  operation: string
  key?: string
  context?: EvaluationContext
  value?: unknown
  cached?: boolean
  duration?: number
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Validate URL format
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * Hash a context for cache keying
 */
function hashContext(context?: EvaluationContext): string {
  if (!context) return 'anonymous'
  return JSON.stringify(context)
}

// ============================================================================
// FLAGS CLIENT
// ============================================================================

/**
 * Feature flags client with caching, change notifications, hot reload, and metrics
 */
export class FlagsClient {
  public readonly config: Required<FlagsConfig>
  private flags: Map<string, unknown> = new Map()
  private cache: Map<string, CacheEntry<unknown>> = new Map()
  private changeHandlers: Map<string, Set<FlagChangeHandler>> = new Map()
  private eventHandlers: Set<FlagEventHandler> = new Set()
  private pollingTimer: ReturnType<typeof setInterval> | null = null
  private isReady: boolean = false
  private debugLog: DebugLogEntry[] = []
  private readonly maxDebugLogSize = 100

  /** Metrics tracking */
  private _metrics: FlagsMetrics = {
    evaluations: 0,
    cacheHits: 0,
    cacheMisses: 0,
    flagEvaluations: {},
    lastEvaluationAt: null,
    lastReloadAt: null,
  }

  constructor(config: FlagsConfig) {
    // Validate config
    if (config.endpoint !== undefined && !isValidUrl(config.endpoint)) {
      throw new Error(`Invalid endpoint URL: ${config.endpoint}`)
    }

    if (config.apiKey !== undefined && config.apiKey === '') {
      throw new Error('API key cannot be empty')
    }

    if (config.cache?.ttl !== undefined && config.cache.ttl < 0) {
      throw new Error('Cache TTL cannot be negative')
    }

    if (config.bootstrap !== undefined && (typeof config.bootstrap !== 'object' || config.bootstrap === null || Array.isArray(config.bootstrap))) {
      throw new Error('Bootstrap data must be an object')
    }

    // Set defaults
    this.config = {
      endpoint: config.endpoint ?? '',
      apiKey: config.apiKey ?? '',
      cache: {
        enabled: config.cache?.enabled ?? true,
        ttl: config.cache?.ttl ?? 60000,
      },
      offline: config.offline ?? false,
      bootstrap: config.bootstrap ?? {},
      debug: config.debug ?? false,
      pollingInterval: config.pollingInterval ?? 0,
    }

    // Initialize flags from bootstrap
    for (const [key, value] of Object.entries(this.config.bootstrap)) {
      if (value !== undefined) {
        this.flags.set(key, value)
      }
    }

    // Mark as ready after bootstrap initialization
    this.isReady = true
    this.emitEvent({ type: 'ready', timestamp: Date.now() })

    // Start polling if configured
    if (this.config.pollingInterval > 0 && !this.config.offline) {
      this.startPolling(this.config.pollingInterval)
    }
  }

  /**
   * Get a flag value with any type
   */
  async getValue<T>(key: string, defaultValue: T, context?: EvaluationContext): Promise<T> {
    const startTime = Date.now()

    // Track evaluation
    this._metrics.evaluations++
    this._metrics.flagEvaluations[key] = (this._metrics.flagEvaluations[key] ?? 0) + 1
    this._metrics.lastEvaluationAt = startTime

    // Check cache first
    const cacheKey = `${key}:${hashContext(context)}`
    const cached = this.cache.get(cacheKey) as CacheEntry<T> | undefined

    if (this.config.cache.enabled && cached) {
      const age = Date.now() - cached.timestamp
      if (age < this.config.cache.ttl) {
        this._metrics.cacheHits++
        this.logDebug('getValue', key, context, cached.value, true, Date.now() - startTime)
        return cached.value
      }
    }

    this._metrics.cacheMisses++

    // Get value from flags
    let value: T

    if (this.flags.has(key)) {
      const flagValue = this.flags.get(key)
      // Handle undefined values - return default
      if (flagValue === undefined) {
        value = defaultValue
      } else {
        value = flagValue as T
      }
    } else {
      value = defaultValue
    }

    // Cache the result
    if (this.config.cache.enabled) {
      this.cache.set(cacheKey, {
        value,
        timestamp: Date.now(),
        contextHash: hashContext(context),
      })
    }

    this.logDebug('getValue', key, context, value, false, Date.now() - startTime)
    return value
  }

  /**
   * Get a boolean flag value
   */
  async getBooleanValue(key: string, defaultValue: boolean, context?: EvaluationContext): Promise<boolean> {
    const value = await this.getValue(key, defaultValue, context)

    if (typeof value !== 'boolean') {
      return defaultValue
    }

    return value
  }

  /**
   * Get a string flag value
   */
  async getStringValue(key: string, defaultValue: string, context?: EvaluationContext): Promise<string> {
    const value = await this.getValue(key, defaultValue, context)

    if (typeof value !== 'string') {
      return defaultValue
    }

    return value
  }

  /**
   * Get a number flag value
   */
  async getNumberValue(key: string, defaultValue: number, context?: EvaluationContext): Promise<number> {
    const value = await this.getValue(key, defaultValue, context)

    if (typeof value !== 'number') {
      return defaultValue
    }

    return value
  }

  /**
   * Get an object flag value
   */
  async getObjectValue<T = Record<string, unknown>>(key: string, defaultValue: T, context?: EvaluationContext): Promise<T> {
    const value = await this.getValue(key, defaultValue, context)

    if (typeof value !== 'object' || value === null) {
      return defaultValue
    }

    return value as T
  }

  /**
   * Get all flag values
   */
  async getAllFlags(context?: EvaluationContext): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {}

    for (const [key, value] of this.flags) {
      if (value !== undefined) {
        result[key] = value
      }
    }

    return result
  }

  /**
   * Register a handler for flag changes
   */
  onFlagChange<T = unknown>(key: string, callback: FlagChangeHandler<T>): () => void {
    if (!this.changeHandlers.has(key)) {
      this.changeHandlers.set(key, new Set())
    }

    const handlers = this.changeHandlers.get(key)!
    handlers.add(callback as FlagChangeHandler)

    // Return unsubscribe function
    return () => {
      handlers.delete(callback as FlagChangeHandler)
    }
  }

  /**
   * Notify handlers of a flag change
   */
  private notifyChange<T>(key: string, oldValue: T | null, newValue: T | null): void {
    const handlers = this.changeHandlers.get(key)
    if (!handlers) return

    for (const handler of handlers) {
      try {
        handler(key, oldValue, newValue)
      } catch {
        // Ignore handler errors
      }
    }
  }

  /**
   * Update a flag value
   */
  updateFlag<T>(key: string, value: T): void {
    const oldValue = this.flags.get(key) as T | undefined
    const newValue = value

    // Only notify if value actually changed
    if (oldValue !== newValue) {
      this.flags.set(key, value)
      // Invalidate cache for this flag
      this.invalidateCacheForKey(key)
      // Notify handlers
      this.notifyChange(key, oldValue ?? null, newValue)
    }
  }

  /**
   * Invalidate cache
   */
  invalidateCache(key?: string): void {
    if (key) {
      this.invalidateCacheForKey(key)
    } else {
      this.cache.clear()
    }
  }

  /**
   * Invalidate cache entries for a specific key
   */
  private invalidateCacheForKey(key: string): void {
    for (const cacheKey of this.cache.keys()) {
      if (cacheKey.startsWith(`${key}:`)) {
        this.cache.delete(cacheKey)
      }
    }
  }

  // ==========================================================================
  // BATCH LOADING
  // ==========================================================================

  /**
   * Load flags from the configured endpoint
   * Returns true if flags were loaded successfully
   */
  async loadFlags(): Promise<boolean> {
    if (this.config.offline || !this.config.endpoint) {
      this.logDebug('loadFlags', undefined, undefined, undefined, false)
      return false
    }

    try {
      const response = await fetch(this.config.endpoint, {
        headers: this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {},
      })

      if (!response.ok) {
        throw new Error(`Failed to load flags: ${response.status}`)
      }

      const data = await response.json() as Record<string, unknown>
      this.updateFlags(data)
      this._metrics.lastReloadAt = Date.now()
      this.emitEvent({ type: 'reload', timestamp: Date.now() })
      this.logDebug('loadFlags', undefined, undefined, data, false)
      return true
    } catch (error) {
      this.emitEvent({
        type: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
        timestamp: Date.now(),
      })
      return false
    }
  }

  /**
   * Batch get multiple flag values efficiently
   */
  async batchGetValues<T extends Record<string, unknown>>(
    keys: Array<{ key: string; defaultValue: unknown }>,
    context?: EvaluationContext
  ): Promise<T> {
    const result: Record<string, unknown> = {}

    // Use Promise.all for parallel evaluation
    await Promise.all(
      keys.map(async ({ key, defaultValue }) => {
        result[key] = await this.getValue(key, defaultValue, context)
      })
    )

    return result as T
  }

  /**
   * Update multiple flags at once, tracking changes
   */
  updateFlags(flagData: Record<string, unknown>): void {
    const changes: Array<{ key: string; oldValue: unknown; newValue: unknown }> = []

    for (const [key, value] of Object.entries(flagData)) {
      const oldValue = this.flags.get(key)
      if (oldValue !== value) {
        this.flags.set(key, value)
        this.invalidateCacheForKey(key)
        changes.push({ key, oldValue, newValue: value })
      }
    }

    // Notify all change handlers
    for (const { key, oldValue, newValue } of changes) {
      this.notifyChange(key, oldValue ?? null, newValue)
      this.emitEvent({
        type: 'change',
        key,
        oldValue,
        newValue,
        timestamp: Date.now(),
      })
    }
  }

  // ==========================================================================
  // HOT RELOAD
  // ==========================================================================

  /**
   * Refresh flags from the endpoint (hot reload)
   */
  async refresh(): Promise<boolean> {
    return this.loadFlags()
  }

  /**
   * Start polling for flag updates
   */
  startPolling(intervalMs: number): void {
    this.stopPolling()

    if (intervalMs <= 0 || this.config.offline) {
      return
    }

    this.pollingTimer = setInterval(async () => {
      await this.loadFlags()
    }, intervalMs)
  }

  /**
   * Stop polling for flag updates
   */
  stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer)
      this.pollingTimer = null
    }
  }

  // ==========================================================================
  // EVENT EMISSION
  // ==========================================================================

  /**
   * Subscribe to flag events
   */
  on(handler: FlagEventHandler): () => void {
    this.eventHandlers.add(handler)
    return () => {
      this.eventHandlers.delete(handler)
    }
  }

  /**
   * Emit a flag event
   */
  private emitEvent(event: FlagEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event)
      } catch {
        // Ignore handler errors
      }
    }
  }

  // ==========================================================================
  // METRICS
  // ==========================================================================

  /**
   * Get current metrics (read-only copy)
   */
  get metrics(): Readonly<FlagsMetrics> {
    return { ...this._metrics, flagEvaluations: { ...this._metrics.flagEvaluations } }
  }

  /**
   * Reset metrics to zero
   */
  resetMetrics(): void {
    this._metrics = {
      evaluations: 0,
      cacheHits: 0,
      cacheMisses: 0,
      flagEvaluations: {},
      lastEvaluationAt: null,
      lastReloadAt: null,
    }
  }

  /**
   * Get cache hit rate as a percentage (0-100)
   */
  getCacheHitRate(): number {
    const total = this._metrics.cacheHits + this._metrics.cacheMisses
    if (total === 0) return 0
    return Math.round((this._metrics.cacheHits / total) * 100)
  }

  // ==========================================================================
  // DEBUG MODE
  // ==========================================================================

  /**
   * Log a debug entry if debug mode is enabled
   */
  private logDebug(
    operation: string,
    key?: string,
    context?: EvaluationContext,
    value?: unknown,
    cached?: boolean,
    duration?: number
  ): void {
    if (!this.config.debug) return

    const entry: DebugLogEntry = {
      timestamp: Date.now(),
      operation,
      key,
      context,
      value,
      cached,
      duration,
    }

    this.debugLog.push(entry)

    // Keep log size bounded
    if (this.debugLog.length > this.maxDebugLogSize) {
      this.debugLog.shift()
    }
  }

  /**
   * Get debug log entries
   */
  getDebugLog(): ReadonlyArray<DebugLogEntry> {
    return [...this.debugLog]
  }

  /**
   * Clear debug log
   */
  clearDebugLog(): void {
    this.debugLog = []
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  /**
   * Check if client is ready
   */
  get ready(): boolean {
    return this.isReady
  }

  /**
   * Get number of loaded flags
   */
  get flagCount(): number {
    return this.flags.size
  }

  /**
   * Destroy the client, cleaning up resources
   */
  destroy(): void {
    this.stopPolling()
    this.cache.clear()
    this.changeHandlers.clear()
    this.eventHandlers.clear()
    this.debugLog = []
    this.isReady = false
  }
}
