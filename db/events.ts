// Events/Actions storage - immutable event log

export interface Event {
  $id: string
  type: string
  payload: unknown
  $timestamp: number
  source?: string      // Who emitted (thing $id, system, etc.)
  correlationId?: string // For tracing related events
}

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
 */
export interface DLQEntry {
  event: Event
  attempts: number
  lastError: string
  timestamp: number
  handlerIndex?: number
}

/**
 * Validation failure entry
 */
export interface ValidationFailure {
  type: string
  payload: unknown
  error: string
  timestamp: number
  details?: Record<string, unknown>
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
 * Durability configuration per event type
 */
export interface DurabilityConfig {
  retries?: number
  backoff?: 'linear' | 'exponential'
  timeout?: number
}

export interface EventsStore {
  emit(event: Omit<Event, '$id' | '$timestamp'>): Promise<Event>
  get(id: string): Promise<Event | null>
  query(options?: EventQueryOptions): Promise<Event[]>
  subscribe(handler: (event: Event) => void): () => void

  // Retention policy methods
  setRetentionPolicy(policy: RetentionPolicy): Promise<void>
  getRetentionPolicy(): Promise<RetentionPolicy | undefined>
  count(filter?: { type?: string }): Promise<number>
  cleanup(options?: { batchSize?: number }): Promise<CleanupResult>
  getStorageUsage(): Promise<StorageUsage>

  // Dead letter queue methods
  addToDeadLetterQueue(entry: Omit<DLQEntry, 'timestamp'>): void
  getDeadLetterQueue(): DLQEntry[]
  queryDeadLetterQueue(options?: DLQQueryOptions): DLQEntry[]
  removeFromDeadLetterQueue(eventId: string): boolean
  replayDeadLetterQueue(options?: DLQQueryOptions): Promise<Event[]>

  // Validation failure tracking
  addValidationFailure(failure: Omit<ValidationFailure, 'timestamp'>): void
  queryValidationFailures(options?: { type?: string }): ValidationFailure[]

  // Retry status tracking
  setEventRetryStatus(eventId: string, status: EventRetryStatus): void
  getEventRetryStatus(eventId: string): EventRetryStatus | undefined

  // Retry metrics
  recordRetryAttempt(eventType: string, succeeded: boolean, retryCount: number): void
  getRetryMetrics(): Record<string, RetryMetrics>

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

function generateEventId(): string {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Estimate the size of an event in bytes (for storage monitoring)
 */
function estimateEventSize(event: Event): number {
  // JSON serialization + some overhead for storage
  return JSON.stringify(event).length * 2 // UTF-16 encoding estimate
}

export function createEventsStore(): EventsStore {
  const events: Event[] = []
  const subscribers = new Set<(event: Event) => void>()
  let retentionPolicy: RetentionPolicy | undefined

  // Dead letter queue storage
  const deadLetterQueue: DLQEntry[] = []

  // Validation failure storage
  const validationFailures: ValidationFailure[] = []

  // Event retry status tracking
  const eventRetryStatus = new Map<string, EventRetryStatus>()

  // Retry metrics per event type
  const retryMetricsData = new Map<string, { totalEvents: number; totalRetries: number; successes: number }>()

  // Durability configuration
  let durabilityConfig: Record<string, DurabilityConfig> = {}
  const defaultDurabilityConfig: DurabilityConfig = { retries: 5, backoff: 'exponential' }

  return {
    async emit(data) {
      // Allow timestamp override for testing purposes
      const providedTimestamp = (data as any).$timestamp
      const event: Event = {
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
          console.error('Event subscriber error:', e)
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

    async cleanup(options?: { batchSize?: number }): Promise<CleanupResult> {
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
    addToDeadLetterQueue(entry: Omit<DLQEntry, 'timestamp'>): void {
      deadLetterQueue.push({
        ...entry,
        timestamp: Date.now()
      })
    },

    getDeadLetterQueue(): DLQEntry[] {
      return [...deadLetterQueue]
    },

    queryDeadLetterQueue(options?: DLQQueryOptions): DLQEntry[] {
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

    async replayDeadLetterQueue(options?: DLQQueryOptions): Promise<Event[]> {
      const toReplay = this.queryDeadLetterQueue(options)
      const replayedEvents: Event[] = []

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
    addValidationFailure(failure: Omit<ValidationFailure, 'timestamp'>): void {
      validationFailures.push({
        ...failure,
        timestamp: Date.now()
      })
    },

    queryValidationFailures(options?: { type?: string }): ValidationFailure[] {
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
