/**
 * @module workflows/event-dispatcher
 *
 * Event Dispatcher with Ordering Guarantees and Dead Letter Queue
 *
 * This module provides a robust event dispatch system for the dotdo framework with:
 * - Handler priority ordering (higher priority executes first)
 * - Error isolation (one handler failure doesn't prevent others)
 * - Dead letter queue for failed handlers with configurable retries
 * - Exponential backoff with jitter for retries
 * - Event acknowledgment tracking
 * - Execution traces for observability
 *
 * ## Event Ordering
 *
 * Handlers are executed in order based on:
 * 1. Priority (descending - higher priority runs first)
 * 2. Registration time (ascending - earlier registered runs first)
 * 3. Specificity (exact matches before wildcards)
 *
 * @example Handler registration with priority
 * ```typescript
 * dispatcher.registerHandler('Customer.created', handler1, { priority: 10 })
 * dispatcher.registerHandler('Customer.created', handler2, { priority: 5 })
 * // handler1 executes before handler2
 * ```
 *
 * ## Dead Letter Queue
 *
 * Failed handlers are automatically added to the DLQ for retry:
 * - Configurable max retries per handler
 * - Exponential backoff with jitter
 * - Replay capability for DLQ items
 *
 * @example DLQ configuration
 * ```typescript
 * dispatcher.registerHandler('Order.placed', handler, {
 *   maxRetries: 5,
 *   retryDelayMs: 1000,
 * })
 * ```
 *
 * ## Acknowledgment
 *
 * Events can be acknowledged to track successful processing:
 * - Automatic acknowledgment after all handlers complete
 * - Manual acknowledgment for long-running handlers
 *
 * @see {@link EventDispatcherOptions} - Configuration options
 * @see {@link DispatchResult} - Dispatch execution results
 * @see {@link DLQEntry} - Dead letter queue entry structure
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Handler priority for execution ordering
 */
export interface HandlerPriority {
  /** Priority value (higher = runs first, default: 0) */
  priority: number
  /** Registration timestamp for stable ordering */
  registeredAt: number
}

/**
 * Handler registration options
 */
export interface HandlerRegistrationOptions {
  /** Priority for execution ordering (higher = runs first, default: 0) */
  priority?: number
  /** Handler name for debugging and DLQ tracking */
  name?: string
  /** Maximum retry attempts for failed executions (default: 3) */
  maxRetries?: number
  /** Base retry delay in milliseconds (default: 1000) */
  retryDelayMs?: number
  /** Filter predicate for conditional execution */
  filter?: (event: DispatchableEvent) => boolean | Promise<boolean>
  /** Timeout for handler execution in milliseconds (default: 30000) */
  timeoutMs?: number
}

/**
 * Registered handler with metadata
 */
export interface RegisteredHandler<T = unknown> {
  /** Unique handler ID */
  id: string
  /** Event key this handler is registered for */
  eventKey: string
  /** Handler function */
  handler: EventHandlerFn<T>
  /** Handler name */
  name: string
  /** Priority for ordering */
  priority: number
  /** Registration timestamp */
  registeredAt: number
  /** Maximum retry attempts */
  maxRetries: number
  /** Base retry delay in ms */
  retryDelayMs: number
  /** Optional filter predicate */
  filter?: (event: DispatchableEvent) => boolean | Promise<boolean>
  /** Execution timeout in ms */
  timeoutMs: number
  /** Execution statistics */
  stats: HandlerStats
}

/**
 * Handler execution statistics
 */
export interface HandlerStats {
  /** Total execution count */
  executionCount: number
  /** Successful execution count */
  successCount: number
  /** Failed execution count */
  failureCount: number
  /** Last execution timestamp */
  lastExecutedAt?: number
  /** Last error message */
  lastError?: string
}

/**
 * Event handler function type
 */
export type EventHandlerFn<T = unknown> = (event: DispatchableEvent<T>) => Promise<void> | void

/**
 * Event that can be dispatched
 */
export interface DispatchableEvent<T = unknown> {
  /** Unique event ID */
  id: string
  /** Event type (Noun.verb format) */
  type: string
  /** Event source (URL or identifier) */
  source: string
  /** Event data payload */
  data: T
  /** Event timestamp */
  timestamp: Date
  /** Correlation ID for tracing */
  correlationId?: string
  /** Causation ID (parent event) */
  causationId?: string
}

/**
 * Dead letter queue entry
 */
export interface DLQEntry {
  /** Unique DLQ entry ID */
  id: string
  /** Original event ID */
  eventId: string
  /** Event type */
  eventType: string
  /** Event source */
  source: string
  /** Event data */
  data: unknown
  /** Handler ID that failed */
  handlerId: string
  /** Handler name */
  handlerName: string
  /** Error message */
  error: string
  /** Error stack trace */
  errorStack?: string
  /** Current retry count */
  retryCount: number
  /** Maximum retries allowed */
  maxRetries: number
  /** Next retry timestamp */
  nextRetryAt: Date
  /** Entry creation time */
  createdAt: Date
  /** Last update time */
  updatedAt: Date
  /** Entry status */
  status: DLQEntryStatus
}

/**
 * DLQ entry status
 */
export type DLQEntryStatus = 'pending' | 'retrying' | 'exhausted' | 'succeeded'

/**
 * Dispatch execution result
 */
export interface DispatchResult {
  /** Event ID that was dispatched */
  eventId: string
  /** Number of handlers that executed successfully */
  handled: number
  /** Number of handlers that were filtered out */
  filtered: number
  /** Number of handlers that failed */
  failed: number
  /** Number of wildcard handler matches */
  wildcardMatches: number
  /** Errors from failed handlers */
  errors: Array<{ handlerId: string; handlerName: string; error: string }>
  /** DLQ entry IDs for failed handlers */
  dlqEntries: string[]
  /** Total dispatch duration in ms */
  durationMs: number
  /** Whether event was acknowledged */
  acknowledged: boolean
  /** Execution traces for observability */
  traces: ExecutionTrace[]
}

/**
 * Execution trace for a single handler
 */
export interface ExecutionTrace {
  /** Handler ID */
  handlerId: string
  /** Handler name */
  handlerName: string
  /** Execution start time */
  startedAt: number
  /** Execution end time */
  endedAt: number
  /** Execution duration in ms */
  durationMs: number
  /** Execution status */
  status: 'success' | 'filtered' | 'error' | 'timeout'
  /** Error message if failed */
  error?: string
}

/**
 * Event acknowledgment record
 */
export interface Acknowledgment {
  /** Event ID */
  eventId: string
  /** Acknowledgment timestamp */
  acknowledgedAt: Date
  /** Handler IDs that acknowledged */
  handlerIds: string[]
  /** Whether all handlers acknowledged */
  complete: boolean
}

/**
 * Event dispatcher options
 */
export interface EventDispatcherOptions {
  /** Default max retries for handlers without explicit config (default: 3) */
  defaultMaxRetries?: number
  /** Default retry delay in ms (default: 1000) */
  defaultRetryDelayMs?: number
  /** Default handler timeout in ms (default: 30000) */
  defaultTimeoutMs?: number
  /** Maximum concurrent handler executions (default: 10) */
  maxConcurrency?: number
  /** Callback when DLQ entry is created */
  onDLQEntry?: (entry: DLQEntry) => void
  /** Callback when event is acknowledged */
  onAcknowledge?: (ack: Acknowledgment) => void
  /** Callback for execution traces */
  onTrace?: (trace: ExecutionTrace) => void
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default maximum retry attempts */
const DEFAULT_MAX_RETRIES = 3

/** Default base delay for retries in milliseconds */
const DEFAULT_RETRY_DELAY_MS = 1000

/** Maximum delay cap for exponential backoff (1 hour) */
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000

/** Default handler timeout in milliseconds */
const DEFAULT_TIMEOUT_MS = 30000

/** Default maximum concurrent handlers */
const DEFAULT_MAX_CONCURRENCY = 10

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate next retry time using exponential backoff with jitter
 */
export function calculateBackoff(retryCount: number, baseDelayMs: number = DEFAULT_RETRY_DELAY_MS): Date {
  // Exponential backoff: baseDelay * 2^retryCount
  const exponentialDelay = baseDelayMs * Math.pow(2, retryCount)
  // Cap at maximum delay
  const cappedDelay = Math.min(exponentialDelay, MAX_RETRY_DELAY_MS)
  // Add jitter (0-25% of delay) to prevent thundering herd
  const jitter = cappedDelay * Math.random() * 0.25
  const totalDelay = cappedDelay + jitter

  return new Date(Date.now() + totalDelay)
}

/**
 * Parse event type into noun and verb components
 */
export function parseEventType(type: string): { noun: string; verb: string } {
  const parts = type.split('.')
  return {
    noun: parts[0] ?? '*',
    verb: parts[1] ?? '*',
  }
}

/**
 * Check if event type matches a pattern (supports wildcards)
 */
export function matchesPattern(eventType: string, pattern: string): boolean {
  const { noun: eventNoun, verb: eventVerb } = parseEventType(eventType)
  const { noun: patternNoun, verb: patternVerb } = parseEventType(pattern)

  const nounMatch = patternNoun === '*' || patternNoun === eventNoun
  const verbMatch = patternVerb === '*' || patternVerb === eventVerb

  return nounMatch && verbMatch
}

/**
 * Generate a unique handler ID
 */
function generateHandlerId(): string {
  return `handler_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Generate a unique DLQ entry ID
 */
function generateDLQId(): string {
  return `dlq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Create a timeout promise
 */
function createTimeout(ms: number, handlerName: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Handler '${handlerName}' timed out after ${ms}ms`))
    }, ms)
  })
}

// ============================================================================
// EVENT DISPATCHER CLASS
// ============================================================================

/**
 * Event Dispatcher with ordering guarantees and dead letter queue support.
 *
 * Provides reliable event dispatch with:
 * - Priority-based handler ordering
 * - Error isolation between handlers
 * - Automatic DLQ for failed handlers
 * - Exponential backoff retries
 * - Event acknowledgment tracking
 *
 * @example Basic usage
 * ```typescript
 * const dispatcher = new EventDispatcher()
 *
 * // Register handlers with priority
 * dispatcher.registerHandler('Customer.created', async (event) => {
 *   await sendWelcomeEmail(event.data)
 * }, { priority: 10, name: 'welcomeEmail' })
 *
 * // Dispatch event
 * const result = await dispatcher.dispatch({
 *   id: 'evt-123',
 *   type: 'Customer.created',
 *   source: 'api/customers',
 *   data: { email: 'user@example.com' },
 *   timestamp: new Date(),
 * })
 *
 * console.log(`Handled: ${result.handled}, Failed: ${result.failed}`)
 * ```
 */
export class EventDispatcher {
  /** Registered handlers by event key */
  private handlers: Map<string, RegisteredHandler[]> = new Map()
  /** Dead letter queue entries */
  private dlqEntries: Map<string, DLQEntry> = new Map()
  /** Event acknowledgments */
  private acknowledgments: Map<string, Acknowledgment> = new Map()
  /** Handler counter for naming */
  private handlerCounter = 0
  /** Configuration options */
  private options: Required<EventDispatcherOptions>

  constructor(options: EventDispatcherOptions = {}) {
    this.options = {
      defaultMaxRetries: options.defaultMaxRetries ?? DEFAULT_MAX_RETRIES,
      defaultRetryDelayMs: options.defaultRetryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
      defaultTimeoutMs: options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxConcurrency: options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
      onDLQEntry: options.onDLQEntry ?? (() => {}),
      onAcknowledge: options.onAcknowledge ?? (() => {}),
      onTrace: options.onTrace ?? (() => {}),
    }
  }

  // ==========================================================================
  // HANDLER REGISTRATION
  // ==========================================================================

  /**
   * Register an event handler for a specific event type.
   *
   * @param eventKey - Event type pattern (supports wildcards: *.created, Customer.*)
   * @param handler - Handler function to execute
   * @param options - Registration options (priority, name, retries, etc.)
   * @returns Handler ID for later unregistration
   *
   * @example
   * ```typescript
   * // High priority handler
   * const id = dispatcher.registerHandler('Order.placed', handler, {
   *   priority: 100,
   *   name: 'inventoryReservation',
   *   maxRetries: 5,
   * })
   *
   * // Wildcard handler for all created events
   * dispatcher.registerHandler('*.created', auditHandler, {
   *   priority: -10, // Runs last
   *   name: 'auditLog',
   * })
   * ```
   */
  registerHandler<T = unknown>(
    eventKey: string,
    handler: EventHandlerFn<T>,
    options: HandlerRegistrationOptions = {}
  ): string {
    const id = generateHandlerId()
    const name = options.name ?? `handler_${++this.handlerCounter}`

    const registration: RegisteredHandler<T> = {
      id,
      eventKey,
      handler: handler as EventHandlerFn<unknown>,
      name,
      priority: options.priority ?? 0,
      registeredAt: Date.now(),
      maxRetries: options.maxRetries ?? this.options.defaultMaxRetries,
      retryDelayMs: options.retryDelayMs ?? this.options.defaultRetryDelayMs,
      filter: options.filter,
      timeoutMs: options.timeoutMs ?? this.options.defaultTimeoutMs,
      stats: {
        executionCount: 0,
        successCount: 0,
        failureCount: 0,
      },
    }

    const handlers = this.handlers.get(eventKey) ?? []
    handlers.push(registration as RegisteredHandler)
    this.handlers.set(eventKey, handlers)

    return id
  }

  /**
   * Unregister a handler by ID.
   *
   * @param handlerId - Handler ID returned from registerHandler
   * @returns true if handler was found and removed
   */
  unregisterHandler(handlerId: string): boolean {
    for (const [eventKey, handlers] of this.handlers) {
      const index = handlers.findIndex(h => h.id === handlerId)
      if (index !== -1) {
        handlers.splice(index, 1)
        if (handlers.length === 0) {
          this.handlers.delete(eventKey)
        }
        return true
      }
    }
    return false
  }

  /**
   * Get all registered handlers for an event type.
   * Includes exact matches and wildcard patterns.
   *
   * @param eventType - Event type to get handlers for
   * @returns Array of matching handlers sorted by priority
   */
  getHandlers(eventType: string): RegisteredHandler[] {
    return this.collectMatchingHandlers(eventType)
  }

  /**
   * Get handler by ID.
   */
  getHandler(handlerId: string): RegisteredHandler | undefined {
    for (const handlers of this.handlers.values()) {
      const handler = handlers.find(h => h.id === handlerId)
      if (handler) return handler
    }
    return undefined
  }

  // ==========================================================================
  // EVENT DISPATCH
  // ==========================================================================

  /**
   * Dispatch an event to all matching handlers.
   *
   * Handlers are executed in priority order. Failures are isolated -
   * one handler failing doesn't prevent others from executing.
   * Failed handlers are added to the DLQ for retry.
   *
   * @param event - Event to dispatch
   * @returns Dispatch result with execution details
   *
   * @example
   * ```typescript
   * const result = await dispatcher.dispatch({
   *   id: 'evt-123',
   *   type: 'Payment.failed',
   *   source: 'stripe/webhooks',
   *   data: { customerId: 'cust-456', amount: 100 },
   *   timestamp: new Date(),
   * })
   *
   * if (result.failed > 0) {
   *   console.log('Some handlers failed:', result.errors)
   *   console.log('DLQ entries:', result.dlqEntries)
   * }
   * ```
   */
  async dispatch<T = unknown>(event: DispatchableEvent<T>): Promise<DispatchResult> {
    const startTime = Date.now()
    const handlers = this.collectMatchingHandlers(event.type)

    let handled = 0
    let filtered = 0
    let failed = 0
    let wildcardMatches = 0
    const errors: Array<{ handlerId: string; handlerName: string; error: string }> = []
    const dlqEntries: string[] = []
    const traces: ExecutionTrace[] = []

    // Track exact matches for wildcard counting
    const exactKey = event.type
    const exactHandlerIds = new Set(
      (this.handlers.get(exactKey) ?? []).map(h => h.id)
    )

    // Execute handlers in priority order
    for (const handler of handlers) {
      const traceStart = Date.now()
      let traceStatus: ExecutionTrace['status'] = 'success'
      let traceError: string | undefined

      // Track wildcard matches
      if (!exactHandlerIds.has(handler.id)) {
        wildcardMatches++
      }

      // Check filter predicate
      if (handler.filter) {
        try {
          const shouldExecute = await handler.filter(event as DispatchableEvent)
          if (!shouldExecute) {
            filtered++
            traceStatus = 'filtered'
            this.recordTrace(traces, handler, traceStart, traceStatus)
            continue
          }
        } catch (filterError) {
          // Filter errors are treated as filtered (don't execute)
          filtered++
          traceStatus = 'filtered'
          traceError = filterError instanceof Error ? filterError.message : String(filterError)
          this.recordTrace(traces, handler, traceStart, traceStatus, traceError)
          continue
        }
      }

      // Update execution stats
      handler.stats.executionCount++
      handler.stats.lastExecutedAt = Date.now()

      try {
        // Execute with timeout
        await Promise.race([
          Promise.resolve(handler.handler(event as DispatchableEvent)),
          createTimeout(handler.timeoutMs, handler.name),
        ])

        handler.stats.successCount++
        handled++
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const errorStack = error instanceof Error ? error.stack : undefined

        handler.stats.failureCount++
        handler.stats.lastError = errorMessage
        failed++

        // Determine status
        traceStatus = errorMessage.includes('timed out') ? 'timeout' : 'error'
        traceError = errorMessage

        errors.push({
          handlerId: handler.id,
          handlerName: handler.name,
          error: errorMessage,
        })

        // Add to DLQ
        const dlqEntry = this.addToDLQ(event, handler, errorMessage, errorStack)
        dlqEntries.push(dlqEntry.id)
      }

      this.recordTrace(traces, handler, traceStart, traceStatus, traceError)
    }

    // Create acknowledgment
    const acknowledgment: Acknowledgment = {
      eventId: event.id,
      acknowledgedAt: new Date(),
      handlerIds: handlers.map(h => h.id),
      complete: failed === 0,
    }
    this.acknowledgments.set(event.id, acknowledgment)
    this.options.onAcknowledge(acknowledgment)

    return {
      eventId: event.id,
      handled,
      filtered,
      failed,
      wildcardMatches,
      errors,
      dlqEntries,
      durationMs: Date.now() - startTime,
      acknowledged: failed === 0,
      traces,
    }
  }

  // ==========================================================================
  // DEAD LETTER QUEUE
  // ==========================================================================

  /**
   * Add a failed event to the DLQ.
   */
  private addToDLQ(
    event: DispatchableEvent,
    handler: RegisteredHandler,
    error: string,
    errorStack?: string
  ): DLQEntry {
    const entry: DLQEntry = {
      id: generateDLQId(),
      eventId: event.id,
      eventType: event.type,
      source: event.source,
      data: event.data,
      handlerId: handler.id,
      handlerName: handler.name,
      error,
      errorStack,
      retryCount: 0,
      maxRetries: handler.maxRetries,
      nextRetryAt: calculateBackoff(0, handler.retryDelayMs),
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'pending',
    }

    this.dlqEntries.set(entry.id, entry)
    this.options.onDLQEntry(entry)

    return entry
  }

  /**
   * Get all DLQ entries.
   *
   * @param options - Filter options
   * @returns Array of DLQ entries
   */
  getDLQEntries(options?: {
    status?: DLQEntryStatus
    eventType?: string
    handlerId?: string
    limit?: number
  }): DLQEntry[] {
    let entries = Array.from(this.dlqEntries.values())

    if (options?.status) {
      entries = entries.filter(e => e.status === options.status)
    }
    if (options?.eventType) {
      entries = entries.filter(e => e.eventType === options.eventType)
    }
    if (options?.handlerId) {
      entries = entries.filter(e => e.handlerId === options.handlerId)
    }

    // Sort by next retry time
    entries.sort((a, b) => a.nextRetryAt.getTime() - b.nextRetryAt.getTime())

    if (options?.limit) {
      entries = entries.slice(0, options.limit)
    }

    return entries
  }

  /**
   * Get DLQ entry by ID.
   */
  getDLQEntry(entryId: string): DLQEntry | undefined {
    return this.dlqEntries.get(entryId)
  }

  /**
   * Replay a DLQ entry.
   *
   * Attempts to re-execute the failed handler. If it succeeds,
   * the entry is marked as succeeded. If it fails again and
   * retries are exhausted, it's marked as exhausted.
   *
   * @param entryId - DLQ entry ID to replay
   * @returns Updated DLQ entry or null if not found
   */
  async replayDLQEntry(entryId: string): Promise<DLQEntry | null> {
    const entry = this.dlqEntries.get(entryId)
    if (!entry) return null

    // Find the handler
    const handler = this.getHandler(entry.handlerId)
    if (!handler) {
      // Handler was unregistered - mark as exhausted
      entry.status = 'exhausted'
      entry.updatedAt = new Date()
      return entry
    }

    entry.status = 'retrying'
    entry.updatedAt = new Date()

    // Reconstruct the event
    const event: DispatchableEvent = {
      id: entry.eventId,
      type: entry.eventType,
      source: entry.source,
      data: entry.data,
      timestamp: new Date(),
    }

    try {
      // Execute with timeout
      await Promise.race([
        Promise.resolve(handler.handler(event)),
        createTimeout(handler.timeoutMs, handler.name),
      ])

      // Success - mark as succeeded and update handler stats
      entry.status = 'succeeded'
      entry.updatedAt = new Date()
      handler.stats.successCount++

      return entry
    } catch (error) {
      entry.retryCount++
      entry.error = error instanceof Error ? error.message : String(error)
      entry.errorStack = error instanceof Error ? error.stack : undefined
      entry.updatedAt = new Date()
      handler.stats.failureCount++

      if (entry.retryCount >= entry.maxRetries) {
        entry.status = 'exhausted'
      } else {
        entry.status = 'pending'
        entry.nextRetryAt = calculateBackoff(entry.retryCount, handler.retryDelayMs)
      }

      return entry
    }
  }

  /**
   * Replay all pending DLQ entries that are due for retry.
   *
   * @returns Array of replay results
   */
  async replayDueDLQEntries(): Promise<Array<{ entryId: string; success: boolean; error?: string }>> {
    const now = new Date()
    const dueEntries = this.getDLQEntries({ status: 'pending' })
      .filter(e => e.nextRetryAt <= now)

    const results: Array<{ entryId: string; success: boolean; error?: string }> = []

    for (const entry of dueEntries) {
      const replayed = await this.replayDLQEntry(entry.id)
      if (replayed) {
        results.push({
          entryId: entry.id,
          success: replayed.status === 'succeeded',
          error: replayed.status === 'succeeded' ? undefined : replayed.error,
        })
      }
    }

    return results
  }

  /**
   * Purge exhausted or succeeded DLQ entries.
   *
   * @param status - Status to purge (default: 'succeeded')
   * @returns Number of entries purged
   */
  purgeDLQEntries(status: 'exhausted' | 'succeeded' = 'succeeded'): number {
    let purged = 0
    for (const [id, entry] of this.dlqEntries) {
      if (entry.status === status) {
        this.dlqEntries.delete(id)
        purged++
      }
    }
    return purged
  }

  /**
   * Remove a specific DLQ entry.
   */
  removeDLQEntry(entryId: string): boolean {
    return this.dlqEntries.delete(entryId)
  }

  // ==========================================================================
  // ACKNOWLEDGMENT
  // ==========================================================================

  /**
   * Get acknowledgment for an event.
   */
  getAcknowledgment(eventId: string): Acknowledgment | undefined {
    return this.acknowledgments.get(eventId)
  }

  /**
   * Check if an event was acknowledged by all handlers.
   */
  isAcknowledged(eventId: string): boolean {
    const ack = this.acknowledgments.get(eventId)
    return ack?.complete ?? false
  }

  /**
   * Manually acknowledge an event for a specific handler.
   * Used for long-running handlers that process asynchronously.
   *
   * @param eventId - Event ID to acknowledge
   * @param handlerId - Handler ID acknowledging
   */
  acknowledge(eventId: string, handlerId: string): void {
    let ack = this.acknowledgments.get(eventId)
    if (!ack) {
      ack = {
        eventId,
        acknowledgedAt: new Date(),
        handlerIds: [handlerId],
        complete: false,
      }
      this.acknowledgments.set(eventId, ack)
    } else if (!ack.handlerIds.includes(handlerId)) {
      ack.handlerIds.push(handlerId)
      ack.acknowledgedAt = new Date()
    }
    this.options.onAcknowledge(ack)
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  /**
   * Get dispatcher statistics.
   */
  getStats(): {
    totalHandlers: number
    handlersByEventKey: Record<string, number>
    dlqPending: number
    dlqExhausted: number
    dlqSucceeded: number
    totalAcknowledgments: number
  } {
    const handlersByEventKey: Record<string, number> = {}
    let totalHandlers = 0
    for (const [key, handlers] of this.handlers) {
      handlersByEventKey[key] = handlers.length
      totalHandlers += handlers.length
    }

    let dlqPending = 0
    let dlqExhausted = 0
    let dlqSucceeded = 0
    for (const entry of this.dlqEntries.values()) {
      switch (entry.status) {
        case 'pending':
        case 'retrying':
          dlqPending++
          break
        case 'exhausted':
          dlqExhausted++
          break
        case 'succeeded':
          dlqSucceeded++
          break
      }
    }

    return {
      totalHandlers,
      handlersByEventKey,
      dlqPending,
      dlqExhausted,
      dlqSucceeded,
      totalAcknowledgments: this.acknowledgments.size,
    }
  }

  /**
   * Clear all state (for testing).
   */
  clear(): void {
    this.handlers.clear()
    this.dlqEntries.clear()
    this.acknowledgments.clear()
    this.handlerCounter = 0
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Collect all handlers that match an event type.
   * Includes exact matches and wildcard patterns, sorted by priority.
   */
  private collectMatchingHandlers(eventType: string): RegisteredHandler[] {
    const { noun, verb } = parseEventType(eventType)
    const matchingHandlers: Array<{ handler: RegisteredHandler; isWildcard: boolean }> = []

    // Collect from all registered patterns
    for (const [pattern, handlers] of this.handlers) {
      if (matchesPattern(eventType, pattern)) {
        const isWildcard = pattern.includes('*')
        for (const handler of handlers) {
          matchingHandlers.push({ handler, isWildcard })
        }
      }
    }

    // Sort by:
    // 1. Priority (descending - higher priority first)
    // 2. Specificity (exact matches before wildcards)
    // 3. Registration time (ascending - earlier registered first)
    matchingHandlers.sort((a, b) => {
      // Priority first (descending)
      if (b.handler.priority !== a.handler.priority) {
        return b.handler.priority - a.handler.priority
      }
      // Exact matches before wildcards
      if (a.isWildcard !== b.isWildcard) {
        return a.isWildcard ? 1 : -1
      }
      // Registration time (ascending)
      return a.handler.registeredAt - b.handler.registeredAt
    })

    return matchingHandlers.map(h => h.handler)
  }

  /**
   * Record an execution trace.
   */
  private recordTrace(
    traces: ExecutionTrace[],
    handler: RegisteredHandler,
    startedAt: number,
    status: ExecutionTrace['status'],
    error?: string
  ): void {
    const endedAt = Date.now()
    const trace: ExecutionTrace = {
      handlerId: handler.id,
      handlerName: handler.name,
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      status,
      error,
    }
    traces.push(trace)
    this.options.onTrace(trace)
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new event dispatcher with the given options.
 *
 * @param options - Dispatcher configuration
 * @returns EventDispatcher instance
 *
 * @example
 * ```typescript
 * const dispatcher = createEventDispatcher({
 *   defaultMaxRetries: 5,
 *   defaultRetryDelayMs: 2000,
 *   onDLQEntry: (entry) => console.log('DLQ entry:', entry.id),
 *   onTrace: (trace) => metrics.record(trace),
 * })
 * ```
 */
export function createEventDispatcher(options?: EventDispatcherOptions): EventDispatcher {
  return new EventDispatcher(options)
}
