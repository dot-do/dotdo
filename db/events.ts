// Events/Actions storage - immutable event log
// Generic types added per do-jqrj
// Storage abstraction added per do-68rr
// Branded types added per do-e3my

import type { StorableData, JsonValue } from './types'
import type { StorageAdapter } from './storage'
import type { EventId, ThingId, CorrelationId } from './branded-types'
import { generateEventId } from './id'
import { createLogger } from '../utils/logger'

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
  until?: number
  limit?: number
  order?: 'asc' | 'desc'
}

/**
 * DLQ cleanup options
 */
export interface DLQCleanupOptions {
  /** Remove entries older than this timestamp */
  olderThan?: number
  /** Remove entries older than N days */
  olderThanDays?: number
  /** Only remove entries of these event types */
  types?: string[]
  /** Only remove entries with these error types (e.g., 'NetworkError', 'TimeoutError') */
  errorTypes?: string[]
  /** Maximum number of entries to remove */
  limit?: number
}

/**
 * Result of a DLQ cleanup operation
 */
export interface DLQCleanupResult {
  /** Total number of entries removed */
  removed: number
  /** Number of entries removed by event type */
  removedByType: Record<string, number>
}

/**
 * DLQ statistics
 */
export interface DLQStats {
  /** Total number of entries in the DLQ */
  total: number
  /** Count by event type */
  byEventType: Record<string, number>
  /** Count by error type */
  byErrorType: Record<string, number>
  /** Average number of attempts per entry */
  averageAttempts: number
  /** Number of unique events */
  uniqueEvents: number
  /** Timestamp of oldest entry */
  oldestEntry?: number
  /** Timestamp of newest entry */
  newestEntry?: number
}

/**
 * Durability configuration per event type
 */
export interface DurabilityConfig {
  retries?: number
  backoff?: 'linear' | 'exponential'
  timeout?: number
}

/**
 * EventsStore interface with generic type parameter
 * P defaults to JsonValue for backward compatibility
 */
export interface EventsStore<P extends JsonValue = JsonValue> {
  emit(event: EventInput<P>): Promise<Event<P>>
  get(id: string): Promise<Event<P> | null>
  query(options?: EventQueryOptions): Promise<Event<P>[]>
  subscribe(handler: (event: Event<P>) => void): () => void

  // Retention policy methods
  setRetentionPolicy(policy: RetentionPolicy): Promise<void>
  getRetentionPolicy(): Promise<RetentionPolicy | undefined>
  count(filter?: { type?: string }): Promise<number>
  cleanup(options?: { batchSize?: number }): Promise<CleanupResult>
  getStorageUsage(): Promise<StorageUsage>

  // Dead letter queue methods
  // Note: Methods support both sync (in-memory) and async (SQLite) implementations
  addToDeadLetterQueue(entry: Omit<DLQEntry<P>, 'timestamp'>): void | Promise<void>
  getDeadLetterQueue(): DLQEntry<P>[] | Promise<DLQEntry<P>[]>
  queryDeadLetterQueue(options?: DLQQueryOptions): DLQEntry<P>[] | Promise<DLQEntry<P>[]>
  removeFromDeadLetterQueue(eventId: string): boolean | Promise<boolean>
  replayDeadLetterQueue(options?: DLQQueryOptions): Promise<Event<P>[]>
  getDLQEntry(eventId: string): DLQEntry<P> | null | Promise<DLQEntry<P> | null>
  getDLQStats(): DLQStats | Promise<DLQStats>
  cleanupDeadLetterQueue(options: DLQCleanupOptions): DLQCleanupResult | Promise<DLQCleanupResult>

  // Validation failure tracking
  addValidationFailure(failure: Omit<ValidationFailure<P>, 'timestamp'>): void | Promise<void>
  queryValidationFailures(options?: { type?: string }): ValidationFailure<P>[] | Promise<ValidationFailure<P>[]>

  // Retry status tracking
  setEventRetryStatus(eventId: string, status: EventRetryStatus): void | Promise<void>
  getEventRetryStatus(eventId: string): EventRetryStatus | undefined | Promise<EventRetryStatus | undefined>

  // Retry metrics
  recordRetryAttempt(eventType: string, succeeded: boolean, retryCount: number): void | Promise<void>
  getRetryMetrics(): Record<string, RetryMetrics> | Promise<Record<string, RetryMetrics>>

  // Durability configuration
  setDurabilityConfig(config: Record<string, DurabilityConfig>): void
  getDurabilityConfig(eventType: string): DurabilityConfig
}

export interface EventQueryOptions {
  type?: string
  source?: string
  correlationId?: string
  since?: number
  until?: number
  limit?: number
  offset?: number
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

// ============================================================================
// Shared Helper Functions - Extracted per do-fo3n to reduce duplication
// ============================================================================

/**
 * Shared state container for DLQ, validation failures, retry status, and metrics
 * Used by both createEventsStore and createEventsStoreWithAdapter
 */
interface SharedEventState<P extends JsonValue> {
  deadLetterQueue: DLQEntry<P>[]
  validationFailures: ValidationFailure<P>[]
  eventRetryStatus: Map<string, EventRetryStatus>
  retryMetricsData: Map<string, { totalEvents: number; totalRetries: number; successes: number }>
  durabilityConfig: Record<string, DurabilityConfig>
  defaultDurabilityConfig: DurabilityConfig
  subscribers: Set<(event: Event<P>) => void>
  retentionPolicy: RetentionPolicy | undefined
}

/**
 * Creates shared state for an events store
 */
function createSharedEventState<P extends JsonValue>(): SharedEventState<P> {
  return {
    deadLetterQueue: [],
    validationFailures: [],
    eventRetryStatus: new Map(),
    retryMetricsData: new Map(),
    durabilityConfig: {},
    defaultDurabilityConfig: { retries: 3, backoff: 'exponential' },
    subscribers: new Set(),
    retentionPolicy: undefined
  }
}

/**
 * Notify subscribers of an event, tracking failures in DLQ
 */
function notifySubscribers<P extends JsonValue>(
  event: Event<P>,
  state: SharedEventState<P>,
  addToDeadLetterQueue: (entry: Omit<DLQEntry<P>, 'timestamp'>) => void | Promise<void>
): void {
  // Convert Set to array to get numeric indices
  const handlers = Array.from(state.subscribers)
  handlers.forEach((handler, index) => {
    try {
      const result = handler(event) as void | Promise<void>
      // Handle async handlers
      if (result && typeof result === 'object' && 'then' in result) {
        (result as Promise<void>).catch((error) => {
          const errorMessage = error instanceof Error ? error.message : String(error)
          logger.error('Event subscriber async error:', error)
          addToDeadLetterQueue({
            event,
            attempts: 1,
            lastError: errorMessage,
            handlerIndex: index
          })
        })
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e)
      logger.error('Event subscriber error:', e)
      addToDeadLetterQueue({
        event,
        attempts: 1,
        lastError: errorMessage,
        handlerIndex: index
      })
    }
  })
}

/**
 * Validate and set retention policy
 */
function validateAndSetRetentionPolicy<P extends JsonValue>(
  policy: RetentionPolicy,
  state: SharedEventState<P>
): void {
  if (policy.maxEvents !== undefined && policy.maxEvents <= 0) {
    throw new Error('maxEvents must be positive')
  }
  if (policy.maxAgeDays !== undefined && policy.maxAgeDays <= 0) {
    throw new Error('maxAgeDays must be positive')
  }
  state.retentionPolicy = policy
}

/**
 * Filter events based on query options
 */
function filterEvents<P extends JsonValue>(
  events: Event<P>[],
  options: EventQueryOptions
): Event<P>[] {
  const { type, source, correlationId, since, until } = options
  return events.filter(e => {
    if (type && e.type !== type) return false
    if (source && e.source !== source) return false
    if (correlationId && e.correlationId !== correlationId) return false
    if (since && e.$timestamp < since) return false
    if (until && e.$timestamp > until) return false
    return true
  })
}

/**
 * Sort and paginate events
 */
function sortAndPaginateEvents<P extends JsonValue>(
  events: Event<P>[],
  options: EventQueryOptions
): Event<P>[] {
  const { limit = 100, offset = 0 } = options
  // Sort by timestamp descending (newest first)
  events.sort((a, b) => b.$timestamp - a.$timestamp)
  return events.slice(offset, offset + limit)
}

/**
 * Create an event object from input data
 */
function createEventFromInput<P extends JsonValue>(data: EventInput<P>): Event<P> {
  const providedTimestamp = (data as { $timestamp?: number }).$timestamp
  return {
    ...data,
    $id: generateEventId(),
    $timestamp: typeof providedTimestamp === 'number' ? providedTimestamp : Date.now()
  }
}

/**
 * Add entry to dead letter queue
 */
function addToDLQ<P extends JsonValue>(
  entry: Omit<DLQEntry<P>, 'timestamp'>,
  state: SharedEventState<P>
): void {
  state.deadLetterQueue.push({ ...entry, timestamp: Date.now() })
}

/**
 * Query dead letter queue with filtering and sorting
 */
function queryDLQ<P extends JsonValue>(
  options: DLQQueryOptions | undefined,
  state: SharedEventState<P>
): DLQEntry<P>[] {
  let results = [...state.deadLetterQueue]
  if (options?.type) results = results.filter(e => e.event.type === options.type)
  if (options?.since) results = results.filter(e => e.timestamp >= options.since!)
  if (options?.until) results = results.filter(e => e.timestamp <= options.until!)
  const order = options?.order ?? 'desc'
  results.sort((a, b) => order === 'asc' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp)
  if (options?.limit) results = results.slice(0, options.limit)
  return results
}

/**
 * Remove entry from dead letter queue by event ID
 */
function removeFromDLQ<P extends JsonValue>(
  eventId: string,
  state: SharedEventState<P>
): boolean {
  const index = state.deadLetterQueue.findIndex(e => e.event.$id === eventId)
  if (index >= 0) {
    state.deadLetterQueue.splice(index, 1)
    return true
  }
  return false
}

/**
 * Get DLQ entry by event ID
 */
function getDLQEntryById<P extends JsonValue>(
  eventId: string,
  state: SharedEventState<P>
): DLQEntry<P> | null {
  const entry = state.deadLetterQueue.find(e => e.event.$id === eventId)
  return entry ?? null
}

/**
 * Calculate DLQ statistics
 */
function calculateDLQStats<P extends JsonValue>(state: SharedEventState<P>): DLQStats {
  const dlq = state.deadLetterQueue
  if (dlq.length === 0) {
    return { total: 0, byEventType: {}, byErrorType: {}, averageAttempts: 0, uniqueEvents: 0 }
  }
  const byEventType: Record<string, number> = {}
  const byErrorType: Record<string, number> = {}
  const uniqueEventIds = new Set<string>()
  let totalAttempts = 0
  let oldestEntry: number | undefined
  let newestEntry: number | undefined
  for (const entry of dlq) {
    byEventType[entry.event.type] = (byEventType[entry.event.type] || 0) + 1
    const errorMatch = entry.lastError.match(/^(\w+Error|Error):?/)
    const errorType = errorMatch?.[1] ?? 'UnknownError'
    byErrorType[errorType] = (byErrorType[errorType] || 0) + 1
    uniqueEventIds.add(entry.event.$id)
    totalAttempts += entry.attempts
    if (oldestEntry === undefined || entry.timestamp < oldestEntry) oldestEntry = entry.timestamp
    if (newestEntry === undefined || entry.timestamp > newestEntry) newestEntry = entry.timestamp
  }
  const stats: DLQStats = {
    total: dlq.length, byEventType, byErrorType,
    averageAttempts: totalAttempts / dlq.length, uniqueEvents: uniqueEventIds.size
  }
  if (oldestEntry !== undefined) stats.oldestEntry = oldestEntry
  if (newestEntry !== undefined) stats.newestEntry = newestEntry
  return stats
}

/**
 * Cleanup dead letter queue based on options
 */
function cleanupDLQ<P extends JsonValue>(
  options: DLQCleanupOptions,
  state: SharedEventState<P>
): DLQCleanupResult {
  const dlq = state.deadLetterQueue
  const result: DLQCleanupResult = { removed: 0, removedByType: {} }
  let cutoffTimestamp: number | undefined
  if (options.olderThan !== undefined) cutoffTimestamp = options.olderThan
  else if (options.olderThanDays !== undefined) cutoffTimestamp = Date.now() - (options.olderThanDays * 24 * 60 * 60 * 1000)
  const entriesToRemove: number[] = []
  for (let i = 0; i < dlq.length; i++) {
    const entry = dlq[i]
    if (!entry) continue
    if (cutoffTimestamp !== undefined && entry.timestamp >= cutoffTimestamp) continue
    if (options.types?.length && !options.types.includes(entry.event.type)) continue
    if (options.errorTypes?.length) {
      const errorMatch = entry.lastError.match(/^(\w+Error|Error):?/)
      const errorType = errorMatch?.[1] ?? 'UnknownError'
      if (!options.errorTypes.includes(errorType)) continue
    }
    if (options.limit !== undefined && entriesToRemove.length >= options.limit) break
    entriesToRemove.push(i)
    result.removed++
    result.removedByType[entry.event.type] = (result.removedByType[entry.event.type] || 0) + 1
  }
  for (let i = entriesToRemove.length - 1; i >= 0; i--) {
    const idx = entriesToRemove[i]
    if (idx !== undefined) dlq.splice(idx, 1)
  }
  return result
}

/**
 * Add validation failure
 */
function addValidationFailureEntry<P extends JsonValue>(
  failure: Omit<ValidationFailure<P>, 'timestamp'>,
  state: SharedEventState<P>
): void {
  state.validationFailures.push({ ...failure, timestamp: Date.now() })
}

/**
 * Query validation failures
 */
function queryValidationFailureEntries<P extends JsonValue>(
  options: { type?: string } | undefined,
  state: SharedEventState<P>
): ValidationFailure<P>[] {
  if (!options?.type) return [...state.validationFailures]
  return state.validationFailures.filter(f => f.type === options.type)
}

/**
 * Record a retry attempt for metrics
 */
function recordRetryAttemptMetric<P extends JsonValue>(
  eventType: string,
  succeeded: boolean,
  retryCount: number,
  state: SharedEventState<P>
): void {
  const existing = state.retryMetricsData.get(eventType) || { totalEvents: 0, totalRetries: 0, successes: 0 }
  existing.totalEvents++
  existing.totalRetries += retryCount
  if (succeeded) existing.successes++
  state.retryMetricsData.set(eventType, existing)
}

/**
 * Get retry metrics
 */
function getRetryMetricsData<P extends JsonValue>(state: SharedEventState<P>): Record<string, RetryMetrics> {
  const result: Record<string, RetryMetrics> = {}
  for (const [eventType, data] of state.retryMetricsData) {
    result[eventType] = {
      totalEvents: data.totalEvents,
      totalRetries: data.totalRetries,
      successRate: data.totalEvents > 0 ? data.successes / data.totalEvents : 0
    }
  }
  return result
}

/**
 * Get durability config for an event type
 */
function getDurabilityConfigForType<P extends JsonValue>(
  eventType: string,
  state: SharedEventState<P>
): DurabilityConfig {
  if (state.durabilityConfig[eventType]) return state.durabilityConfig[eventType]
  if (state.durabilityConfig['*']) return state.durabilityConfig['*']
  return state.defaultDurabilityConfig
}

// ============================================================================
// End of Shared Helper Functions
// ============================================================================

/**
 * Create an EventsStore backed by a StorageAdapter
 * This allows using any storage backend (SQLite, memory, etc.)
 * Refactored per do-fo3n to use shared helper functions
 */
export function createEventsStoreWithAdapter<P extends JsonValue = JsonValue>(
  adapter: StorageAdapter
): EventsStore<P> {
  const state = createSharedEventState<P>()

  const store: EventsStore<P> = {
    async emit(data) {
      const event = createEventFromInput<P>(data)
      await adapter.put(`${EVENTS_PREFIX}${event.$id}`, event)
      notifySubscribers(event, state, (entry) => addToDLQ(entry, state))
      return event
    },

    async get(id) {
      const event = await adapter.get<Event<P>>(`${EVENTS_PREFIX}${id}`)
      return event ?? null
    },

    async query(options = {}) {
      const result = await adapter.list<Event<P>>({ prefix: EVENTS_PREFIX, includeValues: true })
      let events = Array.from(result.entries.values()).filter((e): e is Event<P> => e !== undefined)
      events = filterEvents(events, options)
      return sortAndPaginateEvents(events, options)
    },

    subscribe(handler) {
      state.subscribers.add(handler)
      return () => state.subscribers.delete(handler)
    },

    async setRetentionPolicy(policy) {
      validateAndSetRetentionPolicy(policy, state)
    },

    async getRetentionPolicy() {
      return state.retentionPolicy
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
      if (!state.retentionPolicy) {
        return { deleted: 0 }
      }

      let deleted = 0
      const result = await adapter.list<Event<P>>({ prefix: EVENTS_PREFIX, includeValues: true })
      let events = Array.from(result.entries.entries())
        .filter(([_, e]): e is [string, Event<P>] => e !== undefined)

      // Delete by age
      if (state.retentionPolicy.maxAgeDays) {
        const cutoff = Date.now() - (state.retentionPolicy.maxAgeDays * 24 * 60 * 60 * 1000)
        const toDelete = events.filter(([_, e]) => e.$timestamp < cutoff).map(([k]) => k)
        if (toDelete.length > 0) {
          await adapter.deleteMany(toDelete)
          deleted += toDelete.length
          events = events.filter(([k]) => !toDelete.includes(k))
        }
      }

      // Delete by count (keep newest)
      if (state.retentionPolicy.maxEvents && events.length > state.retentionPolicy.maxEvents) {
        events.sort(([_, a], [__, b]) => a.$timestamp - b.$timestamp) // oldest first
        const toDelete = events.slice(0, events.length - state.retentionPolicy.maxEvents).map(([k]) => k)
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
      return { eventCount: events.length, bytesUsed }
    },

    // DLQ methods - delegate to shared helpers
    addToDeadLetterQueue(entry) {
      addToDLQ(entry, state)
    },

    getDeadLetterQueue() {
      return [...state.deadLetterQueue]
    },

    queryDeadLetterQueue(options) {
      return queryDLQ(options, state)
    },

    removeFromDeadLetterQueue(eventId) {
      return removeFromDLQ(eventId, state)
    },

    async replayDeadLetterQueue(options) {
      const toReplay = queryDLQ(options, state)
      const replayedEvents: Event<P>[] = []

      for (const entry of toReplay) {
        const newEvent = await store.emit({
          type: entry.event.type,
          payload: entry.event.payload,
          source: 'dlq-replay',
          correlationId: entry.event.$id
        })
        replayedEvents.push(newEvent)
        removeFromDLQ(entry.event.$id, state)
      }

      return replayedEvents
    },

    getDLQEntry(eventId: string): DLQEntry<P> | null {
      return getDLQEntryById(eventId, state)
    },

    getDLQStats(): DLQStats {
      return calculateDLQStats(state)
    },

    cleanupDeadLetterQueue(options: DLQCleanupOptions): DLQCleanupResult {
      return cleanupDLQ(options, state)
    },

    // Validation failure tracking - delegate to shared helpers
    addValidationFailure(failure) {
      addValidationFailureEntry(failure, state)
    },

    queryValidationFailures(options) {
      return queryValidationFailureEntries(options, state)
    },

    // Retry status tracking
    setEventRetryStatus(eventId, status) {
      state.eventRetryStatus.set(eventId, status)
    },

    getEventRetryStatus(eventId) {
      return state.eventRetryStatus.get(eventId)
    },

    // Retry metrics - delegate to shared helpers
    recordRetryAttempt(eventType, succeeded, retryCount) {
      recordRetryAttemptMetric(eventType, succeeded, retryCount, state)
    },

    getRetryMetrics() {
      return getRetryMetricsData(state)
    },

    // Durability configuration
    setDurabilityConfig(config) {
      state.durabilityConfig = config
    },

    getDurabilityConfig(eventType) {
      return getDurabilityConfigForType(eventType, state)
    }
  }

  return store
}

/**
 * Create an in-memory EventsStore with generic type parameter
 * P defaults to JsonValue for backward compatibility
 * Refactored per do-fo3n to use shared helper functions
 */
export function createEventsStore<P extends JsonValue = JsonValue>(): EventsStore<P> {
  const events: Event<P>[] = []
  const state = createSharedEventState<P>()

  const store: EventsStore<P> = {
    async emit(data) {
      const event = createEventFromInput<P>(data)
      events.push(event)
      notifySubscribers(event, state, (entry) => addToDLQ(entry, state))
      return event
    },

    async get(id) {
      return events.find(e => e.$id === id) ?? null
    },

    async query(options = {}) {
      const filtered = filterEvents([...events], options)
      return sortAndPaginateEvents(filtered, options)
    },

    subscribe(handler) {
      state.subscribers.add(handler)
      return () => state.subscribers.delete(handler)
    },

    async setRetentionPolicy(policy: RetentionPolicy): Promise<void> {
      validateAndSetRetentionPolicy(policy, state)
    },

    async getRetentionPolicy(): Promise<RetentionPolicy | undefined> {
      return state.retentionPolicy
    },

    async count(filter?: { type?: string }): Promise<number> {
      if (!filter?.type) {
        return events.length
      }
      return events.filter(e => e.type === filter.type).length
    },

    async cleanup(_options?: { batchSize?: number }): Promise<CleanupResult> {
      if (!state.retentionPolicy) {
        return { deleted: 0 }
      }

      let deleted = 0

      // Delete by age first (age-based deletion)
      if (state.retentionPolicy.maxAgeDays) {
        const cutoff = Date.now() - (state.retentionPolicy.maxAgeDays * 24 * 60 * 60 * 1000)
        const initialLength = events.length

        // Find events to keep (newer than cutoff)
        const eventsToKeep = events.filter(e => e.$timestamp >= cutoff)
        deleted += initialLength - eventsToKeep.length

        // Replace events array contents
        events.length = 0
        events.push(...eventsToKeep)
      }

      // Delete by count (keep the newest events)
      if (state.retentionPolicy.maxEvents && events.length > state.retentionPolicy.maxEvents) {
        // Sort by timestamp ascending (oldest first) to find which to delete
        events.sort((a, b) => a.$timestamp - b.$timestamp)

        const toDelete = events.length - state.retentionPolicy.maxEvents
        events.splice(0, toDelete)
        deleted += toDelete

        // Re-sort by timestamp descending for normal access
        events.sort((a, b) => b.$timestamp - a.$timestamp)
      }

      return { deleted }
    },

    async getStorageUsage(): Promise<StorageUsage> {
      const bytesUsed = events.reduce((total, event) => total + estimateEventSize(event), 0)
      return { eventCount: events.length, bytesUsed }
    },

    // DLQ methods - delegate to shared helpers
    addToDeadLetterQueue(entry: Omit<DLQEntry<P>, 'timestamp'>): void {
      addToDLQ(entry, state)
    },

    getDeadLetterQueue(): DLQEntry<P>[] {
      return [...state.deadLetterQueue]
    },

    queryDeadLetterQueue(options?: DLQQueryOptions): DLQEntry<P>[] {
      return queryDLQ(options, state)
    },

    removeFromDeadLetterQueue(eventId: string): boolean {
      return removeFromDLQ(eventId, state)
    },

    async replayDeadLetterQueue(options?: DLQQueryOptions): Promise<Event<P>[]> {
      const toReplay = queryDLQ(options, state)
      const replayedEvents: Event<P>[] = []

      for (const entry of toReplay) {
        // Re-emit the event (creates a new event with new id/timestamp)
        const newEvent = await store.emit({
          type: entry.event.type,
          payload: entry.event.payload,
          source: 'dlq-replay',
          correlationId: entry.event.$id // Track original event
        })
        replayedEvents.push(newEvent)

        // Remove from DLQ
        removeFromDLQ(entry.event.$id, state)
      }

      return replayedEvents
    },

    getDLQEntry(eventId: string): DLQEntry<P> | null {
      return getDLQEntryById(eventId, state)
    },

    getDLQStats(): DLQStats {
      return calculateDLQStats(state)
    },

    cleanupDeadLetterQueue(options: DLQCleanupOptions): DLQCleanupResult {
      return cleanupDLQ(options, state)
    },

    // Validation failure tracking - delegate to shared helpers
    addValidationFailure(failure: Omit<ValidationFailure<P>, 'timestamp'>): void {
      addValidationFailureEntry(failure, state)
    },

    queryValidationFailures(options?: { type?: string }): ValidationFailure<P>[] {
      return queryValidationFailureEntries(options, state)
    },

    // Retry status tracking
    setEventRetryStatus(eventId: string, status: EventRetryStatus): void {
      state.eventRetryStatus.set(eventId, status)
    },

    getEventRetryStatus(eventId: string): EventRetryStatus | undefined {
      return state.eventRetryStatus.get(eventId)
    },

    // Retry metrics - delegate to shared helpers
    recordRetryAttempt(eventType: string, succeeded: boolean, retryCount: number): void {
      recordRetryAttemptMetric(eventType, succeeded, retryCount, state)
    },

    getRetryMetrics(): Record<string, RetryMetrics> {
      return getRetryMetricsData(state)
    },

    // Durability configuration
    setDurabilityConfig(config: Record<string, DurabilityConfig>): void {
      state.durabilityConfig = config
    },

    getDurabilityConfig(eventType: string): DurabilityConfig {
      return getDurabilityConfigForType(eventType, state)
    }
  }

  return store
}
