/**
 * @dotdo/db - Events Store
 *
 * EventsStore provides an immutable event log with support for event emission,
 * querying, subscriptions, retention policies, dead letter queues, and durability configuration.
 *
 * @module @dotdo/db/events
 */

import type { StorableData, JsonValue } from './types'
import type { StorageAdapter } from './storage'
import type { EventId, ThingId, CorrelationId } from './branded-types'
import { generateEventId } from './id'
import { createLogger } from '../utils/logger'
import type { CursorPaginationOptions, CursorPaginatedResult } from './pagination'
import { applyCursorPagination } from './pagination'

const logger = createLogger('[Events]')

/**
 * Base Event interface with system fields
 * P extends JsonValue for user-defined payload type
 * Uses branded EventId and CorrelationId for type safety - see do-e3my
 */
export interface BaseEvent {
  $id: EventId
  type: string
  $timestamp: number
  source?: ThingId | string  // Who emitted (thing $id, system, etc.)
  correlationId?: CorrelationId | string // For tracing related events
}

/**
 * Event type combining system fields with typed payload
 * Use Event<P> for typed event storage
 */
export interface Event<P extends JsonValue = JsonValue> extends BaseEvent {
  payload: P
}

/**
 * Input type for emitting an Event (excludes auto-generated fields)
 */
export type EventInput<P extends JsonValue = JsonValue> =
  Omit<Event<P>, '$id' | '$timestamp'>

/**
 * Retention policy for event storage
 * Used to prevent the 10GB Durable Object storage limit breach
 */
export interface RetentionPolicy {
  /** Maximum number of events to keep */
  maxEvents?: number
  /** Maximum age of events in days */
  maxAgeDays?: number
}

/**
 * Storage usage information
 */
export interface StorageUsage {
  /** Total number of events */
  eventCount: number
  /** Estimated bytes used */
  bytesUsed: number
}

/**
 * Result of a cleanup operation
 */
export interface CleanupResult {
  /** Number of events deleted */
  deleted: number
}

/**
 * Dead letter queue entry for failed events
 * P extends JsonValue for typed payload
 */
export interface DLQEntry<P extends JsonValue = JsonValue> {
  event: Event<P>
  attempts: number
  lastError: string
  timestamp: number
  handlerIndex?: number | undefined
}

/**
 * Validation failure entry
 * P extends JsonValue for typed payload
 */
export interface ValidationFailure<P extends JsonValue = JsonValue> {
  type: string
  payload: P
  error: string
  timestamp: number
  details?: Record<string, JsonValue>
}

/**
 * Event retry status
 */
export interface EventRetryStatus {
  attempts: number
  succeeded: boolean
  lastAttempt: number
  errors?: string[]
}

/**
 * Retry metrics per event type
 */
export interface RetryMetrics {
  totalEvents: number
  totalRetries: number
  successRate: number
}

/**
 * DLQ query options
 */
export interface DLQQueryOptions {
  type?: string
  since?: number
  limit?: number
}

/**
 * Dead Letter Queue statistics for monitoring
 */
export interface DLQStats {
  /** Total number of entries in the DLQ */
  total: number
  /** Entries grouped by event type */
  byEventType: Record<string, number>
  /** Entries grouped by error category */
  byErrorType: Record<string, number>
  /** Oldest entry timestamp (or undefined if DLQ is empty) */
  oldestEntry?: number
  /** Newest entry timestamp (or undefined if DLQ is empty) */
  newestEntry?: number
  /** Average number of attempts before DLQ */
  averageAttempts: number
  /** Total unique events that failed */
  uniqueEvents: number
}

/**
 * Durability configuration per event type
 */
export interface DurabilityConfig {
  retries?: number
  backoff?: 'linear' | 'exponential'
  timeout?: number
}

export interface EventQueryOptions {
  type?: string | undefined
  source?: string | undefined
  correlationId?: string | undefined
  since?: number | undefined
  until?: number | undefined
  limit?: number
  offset?: number
}

/**
 * Query options for cursor-based pagination
 */
export interface EventCursorQueryOptions extends CursorPaginationOptions {
  type?: string
  source?: string
  correlationId?: string
  since?: number
  until?: number
}

/**
 * EventsStore interface for immutable event logging and querying.
 *
 * Provides operations for emitting, querying, and managing events with support for:
 * - Event emission with automatic ID and timestamp generation
 * - Querying with filtering and cursor-based pagination
 * - Real-time subscriptions to new events
 * - Retention policies to manage storage growth
 * - Dead letter queue (DLQ) for failed event processing
 * - Durability configuration for event reliability
 *
 * @template P - The event payload type, defaults to JsonValue
 *
 * @example
 * ```typescript
 * // Emit an event
 * const event = await events.emit({
 *   type: 'Customer.signup',
 *   payload: { customerId: '123', email: 'alice@example.com' }
 * })
 *
 * // Query events
 * const signups = await events.query({
 *   type: 'Customer.signup',
 *   since: Date.now() - 86400000 // Last 24 hours
 * })
 *
 * // Subscribe to new events
 * const unsubscribe = events.subscribe((event) => {
 *   console.log('New event:', event.type)
 * })
 *
 * // Set retention policy
 * await events.setRetentionPolicy({
 *   maxEvents: 10000,
 *   maxAgeDays: 30
 * })
 * ```
 */
export interface EventsStore<P extends JsonValue = JsonValue> {
  /**
   * Emit a new event to the log.
   * @param event - Event data with type and payload
   * @returns The created event with $id and $timestamp
   */
  emit(event: EventInput<P>): Promise<Event<P>>

  /**
   * Get an event by ID.
   * @param id - The event ID (accepts EventId or string for backward compatibility)
   * @returns The event or null if not found
   */
  get(id: EventId | string): Promise<Event<P> | null>

  /**
   * Query events with filtering and pagination.
   * @param options - Query options for filtering and pagination
   * @returns Array of events sorted by timestamp descending
   */
  query(options?: EventQueryOptions): Promise<Event<P>[]>

  /**
   * Query events with cursor-based pagination.
   * @param options - Query options with cursor support
   * @returns Paginated result with items and cursor info
   */
  queryWithCursor(options?: EventCursorQueryOptions): Promise<CursorPaginatedResult<Event<P>>>

  /**
   * Subscribe to new events in real-time.
   * @param handler - Callback invoked for each new event
   * @returns Unsubscribe function
   */
  subscribe(handler: (event: Event<P>) => void): () => void

  /**
   * Set retention policy for automatic cleanup.
   * @param policy - Retention limits (max events and/or max age)
   */
  setRetentionPolicy(policy: RetentionPolicy): Promise<void>

  /** Get the current retention policy. */
  getRetentionPolicy(): Promise<RetentionPolicy | undefined>

  /**
   * Count events with optional filtering.
   * @param filter - Optional type filter
   * @returns Total count of matching events
   */
  count(filter?: { type?: string }): Promise<number>

  /**
   * Run cleanup based on retention policy.
   * @param options - Cleanup options
   * @returns Number of events deleted
   */
  cleanup(options?: { batchSize?: number }): Promise<CleanupResult>

  /** Get storage usage statistics. */
  getStorageUsage(): Promise<StorageUsage>

  // Dead letter queue methods
  /** Add a failed event to the dead letter queue. */
  addToDeadLetterQueue(entry: Omit<DLQEntry<P>, 'timestamp'>): void | Promise<void>
  /** Get all events in the dead letter queue. */
  getDeadLetterQueue(): DLQEntry<P>[] | Promise<DLQEntry<P>[]>
  /** Query the dead letter queue with filtering. */
  queryDeadLetterQueue(options?: DLQQueryOptions): DLQEntry<P>[] | Promise<DLQEntry<P>[]>
  /** Remove an event from the dead letter queue. */
  removeFromDeadLetterQueue(eventId: EventId | string): boolean | Promise<boolean>
  /** Replay events from the dead letter queue. */
  replayDeadLetterQueue(options?: DLQQueryOptions): Promise<Event<P>[]>
  /** Get DLQ statistics for monitoring. */
  getDLQStats(): DLQStats | Promise<DLQStats>

  // Validation failure tracking
  /** Record a validation failure for diagnostics. */
  addValidationFailure(failure: Omit<ValidationFailure<P>, 'timestamp'>): void | Promise<void>
  /** Query validation failures. */
  queryValidationFailures(options?: { type?: string }): ValidationFailure<P>[] | Promise<ValidationFailure<P>[]>

  // Retry status tracking
  /** Set the retry status for an event. */
  setEventRetryStatus(eventId: EventId | string, status: EventRetryStatus): void | Promise<void>
  /** Get the retry status for an event. */
  getEventRetryStatus(eventId: EventId | string): EventRetryStatus | undefined | Promise<EventRetryStatus | undefined>

  // Retry metrics
  /** Record a retry attempt for metrics. */
  recordRetryAttempt(eventType: string, succeeded: boolean, retryCount: number): void | Promise<void>
  /** Get retry metrics per event type. */
  getRetryMetrics(): Record<string, RetryMetrics> | Promise<Record<string, RetryMetrics>>

  // Durability configuration
  /** Set durability configuration per event type. */
  setDurabilityConfig(config: Record<string, DurabilityConfig>): void
  /** Get durability configuration for an event type. */
  getDurabilityConfig(eventType: string): DurabilityConfig
}

// ID generation moved to ./id.ts (do-e3my)

/**
 * Estimate the size of an event in bytes (for storage monitoring)
 */
function estimateEventSize(event: Event): number {
  // JSON serialization + some overhead for storage
  return JSON.stringify(event).length * 2 // UTF-16 encoding estimate
}

/**
 * Key prefix for events in storage adapter
 */
const EVENTS_PREFIX = 'event:'

/**
 * Create an EventsStore backed by a StorageAdapter.
 *
 * This factory function creates an EventsStore that can use any storage backend
 * (SQLite, memory, etc.) via the adapter pattern.
 *
 * @template P - The event payload type
 * @param adapter - The storage adapter to use for persistence
 * @returns A fully-functional EventsStore instance
 *
 * @example
 * ```typescript
 * import { createEventsStoreWithAdapter, createSQLiteAdapter } from '@dotdo/db'
 *
 * const adapter = createSQLiteAdapter(sql)
 * const events = createEventsStoreWithAdapter(adapter)
 *
 * const event = await events.emit({
 *   type: 'Customer.signup',
 *   payload: { email: 'alice@example.com' }
 * })
 * ```
 */
export function createEventsStoreWithAdapter<P extends JsonValue = JsonValue>(
  adapter: StorageAdapter
): EventsStore<P> {
  const subscribers = new Set<(event: Event<P>) => void>()
  let retentionPolicy: RetentionPolicy | undefined

  // In-memory state for DLQ, validation failures, retry status, metrics
  // These could be moved to storage adapter in the future
  const deadLetterQueue: DLQEntry<P>[] = []
  const validationFailures: ValidationFailure<P>[] = []
  const eventRetryStatus = new Map<string, EventRetryStatus>()
  const retryMetricsData = new Map<string, { totalEvents: number; totalRetries: number; successes: number }>()
  let durabilityConfig: Record<string, DurabilityConfig> = {}
  const defaultDurabilityConfig: DurabilityConfig = { retries: 3, backoff: 'exponential' }

  return {
    async emit(data) {
      const providedTimestamp = (data as { $timestamp?: number }).$timestamp
      const event: Event<P> = {
        ...data,
        $id: generateEventId(),
        $timestamp: typeof providedTimestamp === 'number' ? providedTimestamp : Date.now()
      }

      await adapter.put(`${EVENTS_PREFIX}${event.$id}`, event)

      // Notify subscribers
      subscribers.forEach(handler => {
        try {
          handler(event)
        } catch (e) {
          logger.error('Event subscriber error:', e)
        }
      })

      return event
    },

    async get(id) {
      const event = await adapter.get<Event<P>>(`${EVENTS_PREFIX}${id}`)
      return event ?? null
    },

    async query(options = {}) {
      const { type, source, correlationId, since, until, limit = 100, offset = 0 } = options

      const result = await adapter.list<Event<P>>({ prefix: EVENTS_PREFIX, includeValues: true })
      let events = Array.from(result.entries.values()).filter((e): e is Event<P> => e !== undefined)

      // Apply filters
      events = events.filter(e => {
        if (type && e.type !== type) return false
        if (source && e.source !== source) return false
        if (correlationId && e.correlationId !== correlationId) return false
        if (since && e.$timestamp < since) return false
        if (until && e.$timestamp > until) return false
        return true
      })

      // Sort by timestamp descending (newest first)
      events.sort((a, b) => b.$timestamp - a.$timestamp)

      return events.slice(offset, offset + limit)
    },

    async queryWithCursor(options = {}) {
      const { type, source, correlationId, since, until, cursor, limit = 100, direction = 'forward' } = options

      const result = await adapter.list<Event<P>>({ prefix: EVENTS_PREFIX, includeValues: true })
      let events = Array.from(result.entries.values()).filter((e): e is Event<P> => e !== undefined)

      // Apply filters
      events = events.filter(e => {
        if (type && e.type !== type) return false
        if (source && e.source !== source) return false
        if (correlationId && e.correlationId !== correlationId) return false
        if (since && e.$timestamp < since) return false
        if (until && e.$timestamp > until) return false
        return true
      })

      // Sort by timestamp descending, then by ID descending for stable ordering
      events.sort((a, b) => {
        const timeDiff = b.$timestamp - a.$timestamp
        if (timeDiff !== 0) return timeDiff
        return b.$id.localeCompare(a.$id)
      })

      return applyCursorPagination(
        events,
        { cursor, limit, direction },
        '$timestamp',
        'desc',
        (event) => event.$id,
        (event) => event.$timestamp
      )
    },

    subscribe(handler) {
      subscribers.add(handler)
      return () => subscribers.delete(handler)
    },

    async setRetentionPolicy(policy) {
      if (policy.maxEvents !== undefined && policy.maxEvents <= 0) {
        throw new Error('maxEvents must be positive')
      }
      if (policy.maxAgeDays !== undefined && policy.maxAgeDays <= 0) {
        throw new Error('maxAgeDays must be positive')
      }
      retentionPolicy = policy
    },

    async getRetentionPolicy() {
      return retentionPolicy
    },

    async count(filter) {
      const result = await adapter.list<Event<P>>({ prefix: EVENTS_PREFIX, includeValues: true })
      let events = Array.from(result.entries.values()).filter((e): e is Event<P> => e !== undefined)

      if (filter?.type) {
        events = events.filter(e => e.type === filter.type)
      }

      return events.length
    },

    async cleanup(_options) {
      if (!retentionPolicy) {
        return { deleted: 0 }
      }

      let deleted = 0
      const result = await adapter.list<Event<P>>({ prefix: EVENTS_PREFIX, includeValues: true })
      let events = Array.from(result.entries.entries())
        .filter((entry): entry is [string, Event<P>] => entry[1] !== undefined)

      // Delete by age
      if (retentionPolicy.maxAgeDays) {
        const cutoff = Date.now() - (retentionPolicy.maxAgeDays * 24 * 60 * 60 * 1000)
        const toDelete = events.filter(([_, e]) => e.$timestamp < cutoff).map(([k]) => k)
        if (toDelete.length > 0) {
          await adapter.deleteMany(toDelete)
          deleted += toDelete.length
          events = events.filter(([k]) => !toDelete.includes(k))
        }
      }

      // Delete by count (keep newest)
      if (retentionPolicy.maxEvents && events.length > retentionPolicy.maxEvents) {
        events.sort(([_, a], [__, b]) => a.$timestamp - b.$timestamp) // oldest first
        const toDelete = events.slice(0, events.length - retentionPolicy.maxEvents).map(([k]) => k)
        if (toDelete.length > 0) {
          await adapter.deleteMany(toDelete)
          deleted += toDelete.length
        }
      }

      return { deleted }
    },

    async getStorageUsage() {
      const result = await adapter.list<Event<P>>({ prefix: EVENTS_PREFIX, includeValues: true })
      const events = Array.from(result.entries.values()).filter((e): e is Event<P> => e !== undefined)
      const bytesUsed = events.reduce((total, event) => total + estimateEventSize(event), 0)

      return {
        eventCount: events.length,
        bytesUsed
      }
    },

    // DLQ methods (in-memory for now)
    addToDeadLetterQueue(entry) {
      deadLetterQueue.push({ ...entry, timestamp: Date.now() })
    },

    getDeadLetterQueue() {
      return [...deadLetterQueue]
    },

    queryDeadLetterQueue(options) {
      let results = [...deadLetterQueue]
      if (options?.type) results = results.filter(e => e.event.type === options.type)
      if (options?.since) results = results.filter(e => e.timestamp >= options.since!)
      if (options?.limit) results = results.slice(0, options.limit)
      return results
    },

    removeFromDeadLetterQueue(eventId) {
      const index = deadLetterQueue.findIndex(e => e.event.$id === eventId)
      if (index >= 0) {
        deadLetterQueue.splice(index, 1)
        return true
      }
      return false
    },

    async replayDeadLetterQueue(options) {
      const toReplayResult = this.queryDeadLetterQueue(options)
      // Handle both sync and async returns
      const toReplay = Array.isArray(toReplayResult) ? toReplayResult : await toReplayResult
      const replayedEvents: Event<P>[] = []

      for (const entry of toReplay) {
        const newEvent = await this.emit({
          type: entry.event.type,
          payload: entry.event.payload,
          source: 'dlq-replay',
          correlationId: entry.event.$id
        })
        replayedEvents.push(newEvent)
        this.removeFromDeadLetterQueue(entry.event.$id)
      }

      return replayedEvents
    },

    getDLQStats(): DLQStats {
      if (deadLetterQueue.length === 0) {
        return {
          total: 0,
          byEventType: {},
          byErrorType: {},
          averageAttempts: 0,
          uniqueEvents: 0
        }
      }

      const byEventType: Record<string, number> = {}
      const byErrorType: Record<string, number> = {}
      const uniqueEventIds = new Set<string>()
      let totalAttempts = 0
      let oldestEntry: number | undefined
      let newestEntry: number | undefined

      for (const entry of deadLetterQueue) {
        // Count by event type
        const eventType = entry.event.type
        byEventType[eventType] = (byEventType[eventType] || 0) + 1

        // Extract error type from lastError (e.g., "NetworkError: ..." -> "NetworkError")
        const errorMatch = entry.lastError.match(/^(\w+Error|Error):?/)
        const errorType = errorMatch ? errorMatch[1] : 'UnknownError'
        byErrorType[errorType] = (byErrorType[errorType] || 0) + 1

        // Track unique events
        uniqueEventIds.add(entry.event.$id)

        // Aggregate attempts
        totalAttempts += entry.attempts

        // Track oldest/newest
        if (oldestEntry === undefined || entry.timestamp < oldestEntry) {
          oldestEntry = entry.timestamp
        }
        if (newestEntry === undefined || entry.timestamp > newestEntry) {
          newestEntry = entry.timestamp
        }
      }

      return {
        total: deadLetterQueue.length,
        byEventType,
        byErrorType,
        oldestEntry,
        newestEntry,
        averageAttempts: deadLetterQueue.length > 0 ? totalAttempts / deadLetterQueue.length : 0,
        uniqueEvents: uniqueEventIds.size
      }
    },

    // Validation failure tracking
    addValidationFailure(failure) {
      validationFailures.push({ ...failure, timestamp: Date.now() })
    },

    queryValidationFailures(options) {
      if (!options?.type) return [...validationFailures]
      return validationFailures.filter(f => f.type === options.type)
    },

    // Retry status tracking
    setEventRetryStatus(eventId, status) {
      eventRetryStatus.set(eventId, status)
    },

    getEventRetryStatus(eventId) {
      return eventRetryStatus.get(eventId)
    },

    // Retry metrics
    recordRetryAttempt(eventType, succeeded, retryCount) {
      const existing = retryMetricsData.get(eventType) || { totalEvents: 0, totalRetries: 0, successes: 0 }
      existing.totalEvents++
      existing.totalRetries += retryCount
      if (succeeded) existing.successes++
      retryMetricsData.set(eventType, existing)
    },

    getRetryMetrics() {
      const result: Record<string, RetryMetrics> = {}
      for (const [eventType, data] of retryMetricsData) {
        result[eventType] = {
          totalEvents: data.totalEvents,
          totalRetries: data.totalRetries,
          successRate: data.totalEvents > 0 ? data.successes / data.totalEvents : 0
        }
      }
      return result
    },

    // Durability configuration
    setDurabilityConfig(config) {
      durabilityConfig = config
    },

    getDurabilityConfig(eventType) {
      if (durabilityConfig[eventType]) return durabilityConfig[eventType]
      if (durabilityConfig['*']) return durabilityConfig['*']
      return defaultDurabilityConfig
    }
  }
}

/**
 * Create an in-memory EventsStore for testing or simple use cases.
 *
 * This implementation stores all data in memory and does not persist across restarts.
 * For production use, prefer createEventsStoreWithAdapter with a SQLite adapter.
 *
 * @template P - The event payload type
 * @returns An in-memory EventsStore instance
 *
 * @example
 * ```typescript
 * import { createEventsStore } from '@dotdo/db'
 *
 * // For testing
 * const events = createEventsStore()
 * const event = await events.emit({
 *   type: 'Customer.signup',
 *   payload: { email: 'test@example.com' }
 * })
 * ```
 */
export function createEventsStore<P extends JsonValue = JsonValue>(): EventsStore<P> {
  const events: Event<P>[] = []
  const subscribers = new Set<(event: Event<P>) => void>()
  let retentionPolicy: RetentionPolicy | undefined

  // Dead letter queue storage
  const deadLetterQueue: DLQEntry<P>[] = []

  // Validation failure storage
  const validationFailures: ValidationFailure<P>[] = []

  // Event retry status tracking
  const eventRetryStatus = new Map<string, EventRetryStatus>()

  // Retry metrics per event type
  const retryMetricsData = new Map<string, { totalEvents: number; totalRetries: number; successes: number }>()

  // Durability configuration
  let durabilityConfig: Record<string, DurabilityConfig> = {}
  // Default: 3 retries as per task requirements
  const defaultDurabilityConfig: DurabilityConfig = { retries: 3, backoff: 'exponential' }

  // Helper to add failed event to DLQ (do-6dc7.4)
  const trackHandlerFailure = (event: Event<P>, error: unknown, handlerIndex: number) => {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined

    logger.error(`Event handler ${handlerIndex} failed for ${event.type}:`, error)

    // Check if this event already has a DLQ entry for this handler
    const existingEntry = deadLetterQueue.find(
      entry => entry.event.$id === event.$id && entry.handlerIndex === handlerIndex
    )

    if (existingEntry) {
      // Update existing entry
      existingEntry.attempts++
      existingEntry.lastError = errorMessage
      existingEntry.timestamp = Date.now()
    } else {
      // Create new DLQ entry
      deadLetterQueue.push({
        event,
        attempts: 1,
        lastError: errorMessage + (errorStack ? `\n${errorStack}` : ''),
        timestamp: Date.now(),
        handlerIndex
      })
    }
  }

  return {
    async emit(data) {
      // Allow timestamp override for testing purposes
      const providedTimestamp = (data as { $timestamp?: number }).$timestamp
      const event: Event<P> = {
        ...data,
        $id: generateEventId(),
        $timestamp: typeof providedTimestamp === 'number' ? providedTimestamp : Date.now()
      }

      events.push(event)

      // Notify subscribers with proper error handling (do-6dc7.4)
      // Track handler index for DLQ entries
      let handlerIndex = 0
      for (const handler of subscribers) {
        try {
          const result = handler(event) as unknown
          // Handle async handlers - catch any promise rejections
          if (result !== null && result !== undefined && typeof (result as Promise<unknown>).catch === 'function') {
            // Fire-and-forget but track failures
            const currentIndex = handlerIndex
            ;(result as Promise<unknown>).catch((asyncError: unknown) => {
              trackHandlerFailure(event, asyncError, currentIndex)
            })
          }
        } catch (e) {
          // Synchronous error
          trackHandlerFailure(event, e, handlerIndex)
        }
        handlerIndex++
      }

      return event
    },

    async get(id) {
      return events.find(e => e.$id === id) ?? null
    },

    async query(options = {}) {
      const { type, source, correlationId, since, until, limit = 100, offset = 0 } = options

      let results = events.filter(e => {
        if (type && e.type !== type) return false
        if (source && e.source !== source) return false
        if (correlationId && e.correlationId !== correlationId) return false
        if (since && e.$timestamp < since) return false
        if (until && e.$timestamp > until) return false
        return true
      })

      // Sort by timestamp descending (newest first)
      results.sort((a, b) => b.$timestamp - a.$timestamp)

      return results.slice(offset, offset + limit)
    },

    async queryWithCursor(options = {}) {
      const { type, source, correlationId, since, until, cursor, limit = 100, direction = 'forward' } = options

      let results = events.filter(e => {
        if (type && e.type !== type) return false
        if (source && e.source !== source) return false
        if (correlationId && e.correlationId !== correlationId) return false
        if (since && e.$timestamp < since) return false
        if (until && e.$timestamp > until) return false
        return true
      })

      // Sort by timestamp descending, then by ID descending for stable ordering
      results.sort((a, b) => {
        const timeDiff = b.$timestamp - a.$timestamp
        if (timeDiff !== 0) return timeDiff
        return b.$id.localeCompare(a.$id)
      })

      return applyCursorPagination(
        results,
        { cursor, limit, direction },
        '$timestamp',
        'desc',
        (event) => event.$id,
        (event) => event.$timestamp
      )
    },

    subscribe(handler) {
      subscribers.add(handler)
      return () => subscribers.delete(handler)
    },

    async setRetentionPolicy(policy: RetentionPolicy): Promise<void> {
      // Validate policy parameters
      if (policy.maxEvents !== undefined && policy.maxEvents <= 0) {
        throw new Error('maxEvents must be positive')
      }
      if (policy.maxAgeDays !== undefined && policy.maxAgeDays <= 0) {
        throw new Error('maxAgeDays must be positive')
      }
      retentionPolicy = policy
    },

    async getRetentionPolicy(): Promise<RetentionPolicy | undefined> {
      return retentionPolicy
    },

    async count(filter?: { type?: string }): Promise<number> {
      if (!filter?.type) {
        return events.length
      }
      return events.filter(e => e.type === filter.type).length
    },

    async cleanup(_options?: { batchSize?: number }): Promise<CleanupResult> {
      if (!retentionPolicy) {
        return { deleted: 0 }
      }

      let deleted = 0

      // Delete by age first (age-based deletion)
      if (retentionPolicy.maxAgeDays) {
        const cutoff = Date.now() - (retentionPolicy.maxAgeDays * 24 * 60 * 60 * 1000)
        const initialLength = events.length

        // Find events to keep (newer than cutoff)
        const eventsToKeep = events.filter(e => e.$timestamp >= cutoff)
        deleted += initialLength - eventsToKeep.length

        // Replace events array contents
        events.length = 0
        events.push(...eventsToKeep)
      }

      // Delete by count (keep the newest events)
      if (retentionPolicy.maxEvents && events.length > retentionPolicy.maxEvents) {
        // Sort by timestamp ascending (oldest first) to find which to delete
        events.sort((a, b) => a.$timestamp - b.$timestamp)

        const toDelete = events.length - retentionPolicy.maxEvents
        events.splice(0, toDelete)
        deleted += toDelete

        // Re-sort by timestamp descending for normal access
        events.sort((a, b) => b.$timestamp - a.$timestamp)
      }

      return { deleted }
    },

    async getStorageUsage(): Promise<StorageUsage> {
      const bytesUsed = events.reduce((total, event) => total + estimateEventSize(event), 0)
      return {
        eventCount: events.length,
        bytesUsed
      }
    },

    // Dead letter queue methods
    addToDeadLetterQueue(entry: Omit<DLQEntry<P>, 'timestamp'>): void {
      deadLetterQueue.push({
        ...entry,
        timestamp: Date.now()
      })
    },

    getDeadLetterQueue(): DLQEntry<P>[] {
      return [...deadLetterQueue]
    },

    queryDeadLetterQueue(options?: DLQQueryOptions): DLQEntry<P>[] {
      let results = [...deadLetterQueue]

      if (options?.type) {
        results = results.filter(entry => entry.event.type === options.type)
      }

      if (options?.since) {
        results = results.filter(entry => entry.timestamp >= options.since!)
      }

      if (options?.limit) {
        results = results.slice(0, options.limit)
      }

      return results
    },

    removeFromDeadLetterQueue(eventId: string): boolean {
      const index = deadLetterQueue.findIndex(entry => entry.event.$id === eventId)
      if (index >= 0) {
        deadLetterQueue.splice(index, 1)
        return true
      }
      return false
    },

    async replayDeadLetterQueue(options?: DLQQueryOptions): Promise<Event<P>[]> {
      const toReplayResult = this.queryDeadLetterQueue(options)
      // Handle both sync and async returns
      const toReplay = Array.isArray(toReplayResult) ? toReplayResult : await toReplayResult
      const replayedEvents: Event<P>[] = []

      for (const entry of toReplay) {
        // Re-emit the event (creates a new event with new id/timestamp)
        const newEvent = await this.emit({
          type: entry.event.type,
          payload: entry.event.payload,
          source: 'dlq-replay',
          correlationId: entry.event.$id // Track original event
        })
        replayedEvents.push(newEvent)

        // Remove from DLQ
        this.removeFromDeadLetterQueue(entry.event.$id)
      }

      return replayedEvents
    },

    // Validation failure tracking
    addValidationFailure(failure: Omit<ValidationFailure<P>, 'timestamp'>): void {
      validationFailures.push({
        ...failure,
        timestamp: Date.now()
      })
    },

    queryValidationFailures(options?: { type?: string }): ValidationFailure<P>[] {
      if (!options?.type) {
        return [...validationFailures]
      }
      return validationFailures.filter(f => f.type === options.type)
    },

    // Retry status tracking
    setEventRetryStatus(eventId: string, status: EventRetryStatus): void {
      eventRetryStatus.set(eventId, status)
    },

    getEventRetryStatus(eventId: string): EventRetryStatus | undefined {
      return eventRetryStatus.get(eventId)
    },

    // Retry metrics
    recordRetryAttempt(eventType: string, succeeded: boolean, retryCount: number): void {
      const existing = retryMetricsData.get(eventType) || { totalEvents: 0, totalRetries: 0, successes: 0 }

      existing.totalEvents++
      existing.totalRetries += retryCount
      if (succeeded) {
        existing.successes++
      }

      retryMetricsData.set(eventType, existing)
    },

    getRetryMetrics(): Record<string, RetryMetrics> {
      const result: Record<string, RetryMetrics> = {}

      for (const [eventType, data] of retryMetricsData) {
        result[eventType] = {
          totalEvents: data.totalEvents,
          totalRetries: data.totalRetries,
          successRate: data.totalEvents > 0 ? data.successes / data.totalEvents : 0
        }
      }

      return result
    },

    // Durability configuration
    setDurabilityConfig(config: Record<string, DurabilityConfig>): void {
      durabilityConfig = config
    },

    getDurabilityConfig(eventType: string): DurabilityConfig {
      // Check for exact match
      if (durabilityConfig[eventType]) {
        return durabilityConfig[eventType]
      }

      // Check for wildcard default
      if (durabilityConfig['*']) {
        return durabilityConfig['*']
      }

      // Return default
      return defaultDurabilityConfig
    }
  }
}
