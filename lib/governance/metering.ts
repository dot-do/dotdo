/**
 * Usage Metering - Event ingestion following Orb/Metronome patterns
 *
 * Features:
 * - Event ingestion with idempotency keys
 * - Customer/org association
 * - Numeric value aggregation
 * - Property dimensions (model, region, tier)
 * - Batch queuing for payments.do integration
 *
 * @example
 * ```typescript
 * import { UsageMeter } from 'dotdo/lib/governance/metering'
 *
 * const meter = new UsageMeter(storage)
 *
 * // Ingest a usage event
 * await meter.ingest({
 *   eventName: 'llm_tokens',
 *   customerId: 'cust_123',
 *   value: 1500,
 *   properties: {
 *     model: 'gpt-4',
 *     region: 'us-east-1'
 *   }
 * })
 *
 * // Query aggregated usage
 * const usage = await meter.query({
 *   customerId: 'cust_123',
 *   eventName: 'llm_tokens',
 *   groupBy: 'model'
 * })
 * ```
 *
 * @packageDocumentation
 */

import { randomBytes } from 'crypto'

// =============================================================================
// Types
// =============================================================================

/**
 * Storage interface for meter events
 */
export interface MeterStorage {
  storeEvent(event: MeterEvent): Promise<void>
  getEvent(idempotencyKey: string): Promise<MeterEvent | null>
  query(query: MeterQuery): Promise<AggregatedUsage>
  flush(): Promise<MeterEvent[]>
}

/**
 * Input for ingesting a meter event
 */
export interface MeterEventInput {
  /** Name of the event (e.g., 'api_request', 'llm_tokens') */
  eventName: string
  /** Customer ID for attribution */
  customerId: string
  /** Numeric value to meter */
  value: number
  /** Idempotency key for deduplication (auto-generated if not provided) */
  idempotencyKey?: string
  /** Event timestamp (defaults to now) */
  timestamp?: Date
  /** Arbitrary properties for dimensions */
  properties?: Record<string, unknown>
}

/**
 * Stored meter event
 */
export interface MeterEvent {
  /** Idempotency key */
  idempotencyKey: string
  /** Name of the event */
  eventName: string
  /** Customer ID */
  customerId: string
  /** Numeric value */
  value: number
  /** Event timestamp */
  timestamp: Date
  /** Arbitrary properties */
  properties?: Record<string, unknown>
  /** Whether this was a deduplicated (ignored) event */
  deduplicated?: boolean
}

/**
 * Query parameters for usage aggregation
 */
export interface MeterQuery {
  /** Filter by customer ID */
  customerId?: string
  /** Filter by event name */
  eventName?: string
  /** Start of time range (inclusive) */
  startTime?: Date
  /** End of time range (inclusive) */
  endTime?: Date
  /** Filter by property dimensions */
  dimensions?: Record<string, unknown>
  /** Group results by a property */
  groupBy?: string
}

/**
 * Aggregated usage result
 */
export interface AggregatedUsage {
  /** Total value sum */
  total: number
  /** Number of events */
  count: number
  /** Breakdown by groupBy dimension */
  breakdown?: Record<string, number>
}

/**
 * Meter configuration options
 */
export interface MeterOptions {
  /** Batch size for auto-flushing (0 = no auto-flush) */
  batchSize?: number
  /** Flush interval in milliseconds (0 = no auto-flush) */
  flushIntervalMs?: number
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BATCH_SIZE = 100
const DEFAULT_FLUSH_INTERVAL_MS = 5000

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a unique idempotency key
 */
function generateIdempotencyKey(): string {
  return `evt_${Date.now()}_${randomBytes(8).toString('base64url')}`
}

// =============================================================================
// UsageMeter Implementation
// =============================================================================

/**
 * Usage Meter
 *
 * Ingests usage events and provides aggregation queries.
 * Supports batch queuing for efficient downstream processing.
 */
export class UsageMeter {
  private readonly storage: MeterStorage
  private readonly options: Required<MeterOptions>
  private pendingEvents: MeterEvent[] = []
  private flushTimer?: ReturnType<typeof setTimeout>

  constructor(storage: MeterStorage, options: MeterOptions = {}) {
    this.storage = storage
    this.options = {
      batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
      flushIntervalMs: options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
    }

    // Start auto-flush timer if enabled
    if (this.options.flushIntervalMs > 0) {
      this.startFlushTimer()
    }
  }

  /**
   * Ingest a usage event
   *
   * @param input - Event input data
   * @returns The stored event (with idempotencyKey populated)
   */
  async ingest(input: MeterEventInput): Promise<MeterEvent> {
    const idempotencyKey = input.idempotencyKey ?? generateIdempotencyKey()

    // Check for duplicate
    const existing = await this.storage.getEvent(idempotencyKey)
    if (existing) {
      return {
        ...existing,
        deduplicated: true,
      }
    }

    // Create event
    const event: MeterEvent = {
      idempotencyKey,
      eventName: input.eventName,
      customerId: input.customerId,
      value: input.value,
      timestamp: input.timestamp ?? new Date(),
      properties: input.properties,
    }

    // Store event
    await this.storage.storeEvent(event)

    // Add to pending batch
    this.pendingEvents.push(event)

    // Auto-flush if batch size reached
    if (this.options.batchSize > 0 && this.pendingEvents.length >= this.options.batchSize) {
      await this.flush()
    }

    return event
  }

  /**
   * Query aggregated usage
   *
   * @param query - Query parameters
   * @returns Aggregated usage data
   */
  async query(query: MeterQuery): Promise<AggregatedUsage> {
    return this.storage.query(query)
  }

  /**
   * Flush pending events to storage
   *
   * @returns Array of flushed events
   */
  async flush(): Promise<MeterEvent[]> {
    const events = [...this.pendingEvents]
    this.pendingEvents = []

    // In a real implementation, this would send events to payments.do
    // For now, we just return them for testing
    return events
  }

  /**
   * Get count of pending events
   */
  getPendingCount(): number {
    return this.pendingEvents.length
  }

  /**
   * Stop the meter (cleanup timers)
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = undefined
    }
  }

  /**
   * Start the auto-flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      if (this.pendingEvents.length > 0) {
        this.flush().catch(console.error)
      }
    }, this.options.flushIntervalMs)
  }
}
