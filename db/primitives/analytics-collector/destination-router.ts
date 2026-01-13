/**
 * DestinationRouter - Fan-out router for analytics events
 *
 * Routes events to multiple analytics destinations with:
 * - Destination configuration (filters, transforms, retry policies)
 * - Fan-out to multiple destinations in parallel
 * - Per-destination retry with exponential backoff
 * - Circuit breaker pattern for failing destinations
 * - Event filtering and transformation per destination
 *
 * @module db/primitives/analytics-collector/destination-router
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Event type discriminator for analytics events
 */
export type EventType = 'track' | 'page' | 'screen' | 'identify' | 'group' | 'alias'

/**
 * Base analytics event structure
 */
export interface AnalyticsEvent {
  type: EventType
  messageId: string
  timestamp: string
  userId?: string
  anonymousId?: string
  event?: string // For track events
  name?: string // For page/screen events
  properties?: Record<string, unknown>
  traits?: Record<string, unknown>
  groupId?: string
  previousId?: string
  context?: Record<string, unknown>
  integrations?: Record<string, boolean | Record<string, unknown>>
}

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  /** Maximum number of retry attempts (0 = no retries) */
  maxAttempts: number
  /** Initial delay in milliseconds before first retry */
  initialDelayMs: number
  /** Maximum delay in milliseconds between retries */
  maxDelayMs: number
  /** Backoff multiplier (e.g., 2 for exponential doubling) */
  backoffMultiplier: number
  /** Whether to add jitter to retry delays */
  jitter: boolean
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number
  /** Time in ms to wait before attempting to close circuit (half-open state) */
  resetTimeoutMs: number
  /** Minimum number of requests before evaluating failure rate */
  minimumRequests: number
}

/**
 * Circuit breaker state
 */
export type CircuitState = 'closed' | 'open' | 'half-open'

/**
 * Predicate function to filter events for a destination
 */
export type EventFilter = (event: AnalyticsEvent) => boolean

/**
 * Transform function to modify events for a destination
 */
export type EventTransform = (event: AnalyticsEvent) => AnalyticsEvent | null

/**
 * Destination send function
 */
export type DestinationSender = (events: AnalyticsEvent[]) => Promise<void>

/**
 * Configuration for a single destination
 */
export interface DestinationConfig {
  /** Unique destination name */
  name: string
  /** Send function for the destination */
  send: DestinationSender
  /** Whether the destination is enabled (default: true) */
  enabled?: boolean
  /** Event types to send to this destination (default: all) */
  eventTypes?: EventType[]
  /** Filter predicate for events (return true to include) */
  filter?: EventFilter
  /** Transform function to modify events before sending */
  transform?: EventTransform
  /** Retry policy override for this destination */
  retry?: Partial<RetryPolicy>
  /** Circuit breaker config override for this destination */
  circuitBreaker?: Partial<CircuitBreakerConfig>
  /** Timeout in ms for send operations */
  timeoutMs?: number
  /** Batch size limit for this destination */
  batchSize?: number
  /** Priority (higher = sent first, default: 0) */
  priority?: number
  /** Custom metadata for the destination */
  metadata?: Record<string, unknown>
  /** Callback when delivery succeeds */
  onSuccess?: (events: AnalyticsEvent[]) => void
  /** Callback when delivery fails after all retries */
  onError?: (error: Error, events: AnalyticsEvent[]) => void
}

/**
 * Destination router options
 */
export interface DestinationRouterOptions {
  /** Default retry policy for all destinations */
  defaultRetry?: Partial<RetryPolicy>
  /** Default circuit breaker config */
  defaultCircuitBreaker?: Partial<CircuitBreakerConfig>
  /** Whether to run destinations in parallel (default: true) */
  parallel?: boolean
  /** Continue sending to other destinations if one fails (default: true) */
  continueOnError?: boolean
  /** Global error handler */
  onError?: (error: Error, destination: string, events: AnalyticsEvent[]) => void
  /** Called before routing to any destination */
  onBeforeRoute?: (events: AnalyticsEvent[]) => void
  /** Called after routing to all destinations */
  onAfterRoute?: (results: RouteResult[]) => void
}

/**
 * Result of routing to a single destination
 */
export interface DestinationResult {
  destination: string
  success: boolean
  eventCount: number
  error?: Error
  attempts: number
  durationMs: number
  filtered: number
  circuitState: CircuitState
}

/**
 * Result of a complete route operation
 */
export interface RouteResult {
  success: boolean
  totalEvents: number
  destinations: DestinationResult[]
  durationMs: number
  error?: Error
}

/**
 * Statistics for a destination
 */
export interface DestinationStats {
  name: string
  enabled: boolean
  circuitState: CircuitState
  successCount: number
  failureCount: number
  filteredCount: number
  totalEventsRouted: number
  lastSuccessAt?: Date
  lastFailureAt?: Date
  lastError?: Error
  averageLatencyMs: number
}

// ============================================================================
// DEFAULT CONFIGURATIONS
// ============================================================================

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  jitter: true,
}

const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  minimumRequests: 3,
}

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================

class CircuitBreaker {
  private state: CircuitState = 'closed'
  private failureCount = 0
  private successCount = 0
  private lastFailureTime?: number
  private readonly config: CircuitBreakerConfig

  constructor(config: CircuitBreakerConfig) {
    this.config = config
  }

  getState(): CircuitState {
    if (this.state === 'open') {
      // Check if we should transition to half-open
      const timeSinceFailure = Date.now() - (this.lastFailureTime ?? 0)
      if (timeSinceFailure >= this.config.resetTimeoutMs) {
        this.state = 'half-open'
      }
    }
    return this.state
  }

  canExecute(): boolean {
    const state = this.getState()
    return state === 'closed' || state === 'half-open'
  }

  recordSuccess(): void {
    this.successCount++
    if (this.state === 'half-open') {
      // Successfully recovered, close the circuit
      this.state = 'closed'
      this.failureCount = 0
    }
  }

  recordFailure(): void {
    this.failureCount++
    this.lastFailureTime = Date.now()

    const totalRequests = this.successCount + this.failureCount
    if (
      totalRequests >= this.config.minimumRequests &&
      this.failureCount >= this.config.failureThreshold
    ) {
      this.state = 'open'
    }

    // In half-open state, any failure reopens the circuit
    if (this.state === 'half-open') {
      this.state = 'open'
    }
  }

  reset(): void {
    this.state = 'closed'
    this.failureCount = 0
    this.successCount = 0
    this.lastFailureTime = undefined
  }

  getStats(): { state: CircuitState; failures: number; successes: number } {
    return {
      state: this.getState(),
      failures: this.failureCount,
      successes: this.successCount,
    }
  }
}

// ============================================================================
// INTERNAL DESTINATION STATE
// ============================================================================

interface DestinationState {
  config: Required<
    Pick<DestinationConfig, 'name' | 'send' | 'enabled' | 'priority'>
  > &
    Omit<DestinationConfig, 'name' | 'send' | 'enabled' | 'priority'>
  circuitBreaker: CircuitBreaker
  retryPolicy: RetryPolicy
  stats: {
    successCount: number
    failureCount: number
    filteredCount: number
    totalEventsRouted: number
    lastSuccessAt?: Date
    lastFailureAt?: Date
    lastError?: Error
    latencies: number[]
  }
}

// ============================================================================
// DESTINATION ROUTER CLASS
// ============================================================================

export class DestinationRouter {
  private destinations: Map<string, DestinationState> = new Map()
  private readonly options: Required<
    Pick<DestinationRouterOptions, 'parallel' | 'continueOnError'>
  > &
    Omit<DestinationRouterOptions, 'parallel' | 'continueOnError'>
  private readonly defaultRetry: RetryPolicy
  private readonly defaultCircuitBreaker: CircuitBreakerConfig

  constructor(options?: DestinationRouterOptions) {
    this.options = {
      parallel: options?.parallel ?? true,
      continueOnError: options?.continueOnError ?? true,
      defaultRetry: options?.defaultRetry,
      defaultCircuitBreaker: options?.defaultCircuitBreaker,
      onError: options?.onError,
      onBeforeRoute: options?.onBeforeRoute,
      onAfterRoute: options?.onAfterRoute,
    }

    this.defaultRetry = {
      ...DEFAULT_RETRY_POLICY,
      ...options?.defaultRetry,
    }

    this.defaultCircuitBreaker = {
      ...DEFAULT_CIRCUIT_BREAKER,
      ...options?.defaultCircuitBreaker,
    }
  }

  /**
   * Add a destination to the router
   */
  addDestination(config: DestinationConfig): void {
    if (this.destinations.has(config.name)) {
      throw new Error(`Destination "${config.name}" is already registered`)
    }

    const retryPolicy: RetryPolicy = {
      ...this.defaultRetry,
      ...config.retry,
    }

    const circuitBreakerConfig: CircuitBreakerConfig = {
      ...this.defaultCircuitBreaker,
      ...config.circuitBreaker,
    }

    const state: DestinationState = {
      config: {
        ...config,
        enabled: config.enabled ?? true,
        priority: config.priority ?? 0,
      },
      circuitBreaker: new CircuitBreaker(circuitBreakerConfig),
      retryPolicy,
      stats: {
        successCount: 0,
        failureCount: 0,
        filteredCount: 0,
        totalEventsRouted: 0,
        latencies: [],
      },
    }

    this.destinations.set(config.name, state)
  }

  /**
   * Remove a destination from the router
   */
  removeDestination(name: string): boolean {
    return this.destinations.delete(name)
  }

  /**
   * Get a destination by name
   */
  getDestination(name: string): DestinationConfig | undefined {
    const state = this.destinations.get(name)
    return state?.config
  }

  /**
   * Get all destination names
   */
  getDestinationNames(): string[] {
    return Array.from(this.destinations.keys())
  }

  /**
   * Check if a destination exists
   */
  hasDestination(name: string): boolean {
    return this.destinations.has(name)
  }

  /**
   * Enable a destination
   */
  enableDestination(name: string): boolean {
    const state = this.destinations.get(name)
    if (state) {
      state.config.enabled = true
      return true
    }
    return false
  }

  /**
   * Disable a destination
   */
  disableDestination(name: string): boolean {
    const state = this.destinations.get(name)
    if (state) {
      state.config.enabled = false
      return true
    }
    return false
  }

  /**
   * Reset circuit breaker for a destination
   */
  resetCircuitBreaker(name: string): boolean {
    const state = this.destinations.get(name)
    if (state) {
      state.circuitBreaker.reset()
      return true
    }
    return false
  }

  /**
   * Get statistics for a destination
   */
  getStats(name: string): DestinationStats | undefined {
    const state = this.destinations.get(name)
    if (!state) return undefined

    const latencies = state.stats.latencies
    const averageLatencyMs =
      latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0

    return {
      name: state.config.name,
      enabled: state.config.enabled,
      circuitState: state.circuitBreaker.getState(),
      successCount: state.stats.successCount,
      failureCount: state.stats.failureCount,
      filteredCount: state.stats.filteredCount,
      totalEventsRouted: state.stats.totalEventsRouted,
      lastSuccessAt: state.stats.lastSuccessAt,
      lastFailureAt: state.stats.lastFailureAt,
      lastError: state.stats.lastError,
      averageLatencyMs,
    }
  }

  /**
   * Get statistics for all destinations
   */
  getAllStats(): DestinationStats[] {
    return this.getDestinationNames()
      .map((name) => this.getStats(name))
      .filter((s): s is DestinationStats => s !== undefined)
  }

  /**
   * Route events to all configured destinations
   */
  async route(events: AnalyticsEvent[]): Promise<RouteResult> {
    if (events.length === 0) {
      return {
        success: true,
        totalEvents: 0,
        destinations: [],
        durationMs: 0,
      }
    }

    const startTime = Date.now()
    this.options.onBeforeRoute?.(events)

    // Get enabled destinations sorted by priority (higher first)
    const enabledDestinations = Array.from(this.destinations.values())
      .filter((d) => d.config.enabled)
      .sort((a, b) => (b.config.priority ?? 0) - (a.config.priority ?? 0))

    let results: DestinationResult[]

    if (this.options.parallel) {
      // Run all destinations in parallel
      results = await Promise.all(
        enabledDestinations.map((dest) =>
          this.routeToDestination(dest, events)
        )
      )
    } else {
      // Run destinations sequentially
      results = []
      for (const dest of enabledDestinations) {
        const result = await this.routeToDestination(dest, events)
        results.push(result)

        // If continueOnError is false and there's an error, stop
        if (!result.success && !this.options.continueOnError) {
          break
        }
      }
    }

    const durationMs = Date.now() - startTime
    const success = results.every((r) => r.success)

    const routeResult: RouteResult = {
      success,
      totalEvents: events.length,
      destinations: results,
      durationMs,
      error: success ? undefined : results.find((r) => r.error)?.error,
    }

    this.options.onAfterRoute?.(results)

    return routeResult
  }

  /**
   * Route events to a single destination with filtering, transform, and retry
   */
  private async routeToDestination(
    state: DestinationState,
    events: AnalyticsEvent[]
  ): Promise<DestinationResult> {
    const startTime = Date.now()
    const { config, circuitBreaker, retryPolicy, stats } = state

    // Check circuit breaker
    if (!circuitBreaker.canExecute()) {
      return {
        destination: config.name,
        success: false,
        eventCount: 0,
        error: new Error(`Circuit breaker is open for ${config.name}`),
        attempts: 0,
        durationMs: Date.now() - startTime,
        filtered: events.length,
        circuitState: circuitBreaker.getState(),
      }
    }

    // Filter events by type
    let filteredEvents = events
    if (config.eventTypes && config.eventTypes.length > 0) {
      const eventTypeSet = new Set(config.eventTypes)
      filteredEvents = filteredEvents.filter((e) => eventTypeSet.has(e.type))
    }

    // Apply custom filter
    if (config.filter) {
      filteredEvents = filteredEvents.filter(config.filter)
    }

    const filteredCount = events.length - filteredEvents.length
    stats.filteredCount += filteredCount

    // If all events filtered out, return success
    if (filteredEvents.length === 0) {
      return {
        destination: config.name,
        success: true,
        eventCount: 0,
        attempts: 0,
        durationMs: Date.now() - startTime,
        filtered: filteredCount,
        circuitState: circuitBreaker.getState(),
      }
    }

    // Apply transform
    if (config.transform) {
      filteredEvents = filteredEvents
        .map(config.transform)
        .filter((e): e is AnalyticsEvent => e !== null)
    }

    // If all events transformed to null, return success
    if (filteredEvents.length === 0) {
      return {
        destination: config.name,
        success: true,
        eventCount: 0,
        attempts: 0,
        durationMs: Date.now() - startTime,
        filtered: filteredCount,
        circuitState: circuitBreaker.getState(),
      }
    }

    // Batch if needed
    const batches = this.batchEvents(filteredEvents, config.batchSize)

    // Send with retry
    let attempts = 0
    let lastError: Error | undefined

    for (const batch of batches) {
      const result = await this.sendWithRetry(config, batch, retryPolicy)
      attempts += result.attempts

      if (!result.success) {
        lastError = result.error
        break
      }
    }

    const durationMs = Date.now() - startTime
    const success = !lastError

    // Update circuit breaker and stats
    if (success) {
      circuitBreaker.recordSuccess()
      stats.successCount++
      stats.lastSuccessAt = new Date()
      stats.totalEventsRouted += filteredEvents.length
      stats.latencies.push(durationMs)
      // Keep only last 100 latencies
      if (stats.latencies.length > 100) {
        stats.latencies.shift()
      }
      config.onSuccess?.(filteredEvents)
    } else {
      circuitBreaker.recordFailure()
      stats.failureCount++
      stats.lastFailureAt = new Date()
      stats.lastError = lastError
      config.onError?.(lastError!, filteredEvents)
      this.options.onError?.(lastError!, config.name, filteredEvents)
    }

    return {
      destination: config.name,
      success,
      eventCount: filteredEvents.length,
      error: lastError,
      attempts,
      durationMs,
      filtered: filteredCount,
      circuitState: circuitBreaker.getState(),
    }
  }

  /**
   * Send events to a destination with retry logic
   */
  private async sendWithRetry(
    config: DestinationState['config'],
    events: AnalyticsEvent[],
    retryPolicy: RetryPolicy
  ): Promise<{ success: boolean; attempts: number; error?: Error }> {
    let attempts = 0
    let delay = retryPolicy.initialDelayMs
    let lastError: Error | undefined

    const maxAttempts = 1 + retryPolicy.maxAttempts // Initial + retries

    while (attempts < maxAttempts) {
      attempts++

      try {
        // Apply timeout if configured
        if (config.timeoutMs) {
          await this.withTimeout(config.send(events), config.timeoutMs)
        } else {
          await config.send(events)
        }
        return { success: true, attempts }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // If we've exhausted retries, don't wait
        if (attempts >= maxAttempts) {
          break
        }

        // Wait before retry
        await this.sleep(this.calculateDelay(delay, retryPolicy))

        // Increase delay for next retry
        delay = Math.min(
          delay * retryPolicy.backoffMultiplier,
          retryPolicy.maxDelayMs
        )
      }
    }

    return { success: false, attempts, error: lastError }
  }

  /**
   * Calculate delay with optional jitter
   */
  private calculateDelay(baseDelay: number, policy: RetryPolicy): number {
    if (!policy.jitter) {
      return baseDelay
    }
    // Add random jitter of +/- 25%
    const jitterRange = baseDelay * 0.25
    return baseDelay + (Math.random() * 2 - 1) * jitterRange
  }

  /**
   * Batch events into smaller chunks
   */
  private batchEvents(
    events: AnalyticsEvent[],
    batchSize?: number
  ): AnalyticsEvent[][] {
    if (!batchSize || batchSize <= 0 || events.length <= batchSize) {
      return [events]
    }

    const batches: AnalyticsEvent[][] = []
    for (let i = 0; i < events.length; i += batchSize) {
      batches.push(events.slice(i, i + batchSize))
    }
    return batches
  }

  /**
   * Wrap a promise with a timeout
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
      ),
    ])
  }

  /**
   * Sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new destination router
 */
export function createDestinationRouter(
  options?: DestinationRouterOptions
): DestinationRouter {
  return new DestinationRouter(options)
}

// ============================================================================
// HELPER FUNCTIONS FOR BUILDING FILTERS
// ============================================================================

/**
 * Create a filter that matches specific event types
 */
export function filterByEventType(...types: EventType[]): EventFilter {
  const typeSet = new Set(types)
  return (event) => typeSet.has(event.type)
}

/**
 * Create a filter that matches events with specific properties
 */
export function filterByProperty(
  key: string,
  predicate: (value: unknown) => boolean
): EventFilter {
  return (event) => {
    const value = event.properties?.[key]
    return predicate(value)
  }
}

/**
 * Create a filter that matches events for specific users
 */
export function filterByUser(...userIds: string[]): EventFilter {
  const userSet = new Set(userIds)
  return (event) =>
    (event.userId !== undefined && userSet.has(event.userId)) ||
    (event.anonymousId !== undefined && userSet.has(event.anonymousId))
}

/**
 * Create a filter that excludes events with specific names
 */
export function excludeEvents(...eventNames: string[]): EventFilter {
  const nameSet = new Set(eventNames)
  return (event) => !nameSet.has(event.event ?? '')
}

/**
 * Create a filter that includes only events with specific names
 */
export function includeEvents(...eventNames: string[]): EventFilter {
  const nameSet = new Set(eventNames)
  return (event) => nameSet.has(event.event ?? '')
}

/**
 * Combine multiple filters with AND logic
 */
export function andFilters(...filters: EventFilter[]): EventFilter {
  return (event) => filters.every((f) => f(event))
}

/**
 * Combine multiple filters with OR logic
 */
export function orFilters(...filters: EventFilter[]): EventFilter {
  return (event) => filters.some((f) => f(event))
}

/**
 * Negate a filter
 */
export function notFilter(filter: EventFilter): EventFilter {
  return (event) => !filter(event)
}

// ============================================================================
// HELPER FUNCTIONS FOR BUILDING TRANSFORMS
// ============================================================================

/**
 * Create a transform that adds properties to events
 */
export function addProperties(
  properties: Record<string, unknown>
): EventTransform {
  return (event) => ({
    ...event,
    properties: {
      ...event.properties,
      ...properties,
    },
  })
}

/**
 * Create a transform that removes properties from events
 */
export function removeProperties(...keys: string[]): EventTransform {
  return (event) => {
    if (!event.properties) return event
    const newProps = { ...event.properties }
    for (const key of keys) {
      delete newProps[key]
    }
    return { ...event, properties: newProps }
  }
}

/**
 * Create a transform that renames properties
 */
export function renameProperties(
  mapping: Record<string, string>
): EventTransform {
  return (event) => {
    if (!event.properties) return event
    const newProps = { ...event.properties }
    for (const [oldKey, newKey] of Object.entries(mapping)) {
      if (oldKey in newProps) {
        newProps[newKey] = newProps[oldKey]
        delete newProps[oldKey]
      }
    }
    return { ...event, properties: newProps }
  }
}

/**
 * Create a transform that masks sensitive properties
 */
export function maskProperties(...keys: string[]): EventTransform {
  return (event) => {
    if (!event.properties) return event
    const newProps = { ...event.properties }
    for (const key of keys) {
      if (key in newProps) {
        newProps[key] = '***MASKED***'
      }
    }
    return { ...event, properties: newProps }
  }
}

/**
 * Chain multiple transforms together
 */
export function chainTransforms(...transforms: EventTransform[]): EventTransform {
  return (event) => {
    let result: AnalyticsEvent | null = event
    for (const transform of transforms) {
      if (result === null) return null
      result = transform(result)
    }
    return result
  }
}
