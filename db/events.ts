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

/**
 * Create an EventsStore backed by a StorageAdapter
 * This allows using any storage backend (SQLite, memory, etc.)
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
        .filter(([_, e]): e is [string, Event<P>] => e !== undefined)

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
      if (options?.until) results = results.filter(e => e.timestamp <= options.until!)
      const order = options?.order ?? 'desc'
      results.sort((a, b) => order === 'asc' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp)
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
      const toReplay = this.queryDeadLetterQueue(options)
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

    getDLQEntry(eventId: string): DLQEntry<P> | null {
      const entry = deadLetterQueue.find(e => e.event.$id === eventId)
      return entry ?? null
    },

    getDLQStats(): DLQStats {
      if (deadLetterQueue.length === 0) {
        return { total: 0, byEventType: {}, byErrorType: {}, averageAttempts: 0, uniqueEvents: 0 }
      }
      const byEventType: Record<string, number> = {}
      const byErrorType: Record<string, number> = {}
      const uniqueEventIds = new Set<string>()
      let totalAttempts = 0
      let oldestEntry: number | undefined
      let newestEntry: number | undefined
      for (const entry of deadLetterQueue) {
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
        total: deadLetterQueue.length, byEventType, byErrorType,
        averageAttempts: totalAttempts / deadLetterQueue.length, uniqueEvents: uniqueEventIds.size
      }
      if (oldestEntry !== undefined) stats.oldestEntry = oldestEntry
      if (newestEntry !== undefined) stats.newestEntry = newestEntry
      return stats
    },

    cleanupDeadLetterQueue(options: DLQCleanupOptions): DLQCleanupResult {
      const result: DLQCleanupResult = { removed: 0, removedByType: {} }
      let cutoffTimestamp: number | undefined
      if (options.olderThan !== undefined) cutoffTimestamp = options.olderThan
      else if (options.olderThanDays !== undefined) cutoffTimestamp = Date.now() - (options.olderThanDays * 24 * 60 * 60 * 1000)
      const entriesToRemove: number[] = []
      for (let i = 0; i < deadLetterQueue.length; i++) {
        const entry = deadLetterQueue[i]
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
        if (idx !== undefined) deadLetterQueue.splice(idx, 1)
      }
      return result
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
 * Create an in-memory EventsStore with generic type parameter
 * P defaults to JsonValue for backward compatibility
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

      if (options?.until) {
        results = results.filter(entry => entry.timestamp <= options.until!)
      }

      const order = options?.order ?? 'desc'
      results.sort((a, b) => order === 'asc' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp)

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
      const toReplay = this.queryDeadLetterQueue(options)
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

    getDLQEntry(eventId: string): DLQEntry<P> | null {
      const entry = deadLetterQueue.find(e => e.event.$id === eventId)
      return entry ?? null
    },

    getDLQStats(): DLQStats {
      if (deadLetterQueue.length === 0) {
        return { total: 0, byEventType: {}, byErrorType: {}, averageAttempts: 0, uniqueEvents: 0 }
      }
      const byEventType: Record<string, number> = {}
      const byErrorType: Record<string, number> = {}
      const uniqueEventIds = new Set<string>()
      let totalAttempts = 0
      let oldestEntry: number | undefined
      let newestEntry: number | undefined
      for (const entry of deadLetterQueue) {
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
        total: deadLetterQueue.length, byEventType, byErrorType,
        averageAttempts: totalAttempts / deadLetterQueue.length, uniqueEvents: uniqueEventIds.size
      }
      if (oldestEntry !== undefined) stats.oldestEntry = oldestEntry
      if (newestEntry !== undefined) stats.newestEntry = newestEntry
      return stats
    },

    cleanupDeadLetterQueue(options: DLQCleanupOptions): DLQCleanupResult {
      const result: DLQCleanupResult = { removed: 0, removedByType: {} }
      let cutoffTimestamp: number | undefined
      if (options.olderThan !== undefined) cutoffTimestamp = options.olderThan
      else if (options.olderThanDays !== undefined) cutoffTimestamp = Date.now() - (options.olderThanDays * 24 * 60 * 60 * 1000)
      const entriesToRemove: number[] = []
      for (let i = 0; i < deadLetterQueue.length; i++) {
        const entry = deadLetterQueue[i]
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
        if (idx !== undefined) deadLetterQueue.splice(idx, 1)
      }
      return result
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
