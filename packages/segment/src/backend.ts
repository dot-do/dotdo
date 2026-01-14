/**
 * @dotdo/segment - In-Memory Backend
 *
 * In-memory storage backend for testing and development.
 * Stores events and batches without sending to external services.
 *
 * @module @dotdo/segment/backend
 */

import type {
  SegmentEvent,
  BatchPayload,
  Transport,
  TransportResult,
  EventType,
} from './types.js'

// =============================================================================
// In-Memory Backend
// =============================================================================

/**
 * In-memory backend for storing analytics events.
 * Useful for testing, development, and scenarios where
 * events should be collected but not sent externally.
 */
export class InMemoryBackend {
  private events: SegmentEvent[] = []
  private batches: BatchPayload[] = []

  /**
   * Add a single event to the backend.
   */
  addEvent(event: SegmentEvent): void {
    this.events.push(event)
  }

  /**
   * Add multiple events to the backend.
   */
  addEvents(events: SegmentEvent[]): void {
    this.events.push(...events)
  }

  /**
   * Add a batch payload to the backend.
   */
  addBatch(batch: BatchPayload): void {
    this.batches.push(batch)
    this.events.push(...batch.batch)
  }

  /**
   * Get all stored events.
   */
  getEvents(): SegmentEvent[] {
    return [...this.events]
  }

  /**
   * Get all stored batches.
   */
  getBatches(): BatchPayload[] {
    return [...this.batches]
  }

  /**
   * Get events filtered by type.
   */
  getEventsByType(type: EventType): SegmentEvent[] {
    return this.events.filter((e) => e.type === type)
  }

  /**
   * Get events for a specific user (by userId or anonymousId).
   */
  getEventsForUser(userId: string): SegmentEvent[] {
    return this.events.filter(
      (e) => e.userId === userId || e.anonymousId === userId
    )
  }

  /**
   * Get the total number of events.
   */
  get size(): number {
    return this.events.length
  }

  /**
   * Get the number of batches.
   */
  get batchCount(): number {
    return this.batches.length
  }

  /**
   * Clear all stored data.
   */
  clear(): void {
    this.events = []
    this.batches = []
  }
}

// =============================================================================
// In-Memory Transport
// =============================================================================

/**
 * Create an in-memory transport that stores events in an InMemoryBackend.
 */
export function createInMemoryTransport(backend: InMemoryBackend): Transport {
  const localBatches: BatchPayload[] = []

  return {
    async send(payload: BatchPayload): Promise<TransportResult> {
      backend.addBatch(payload)
      localBatches.push(payload)
      return { statusCode: 200 }
    },

    async flush(_timeout?: number): Promise<boolean> {
      return true
    },

    getEvents(): SegmentEvent[] {
      return backend.getEvents()
    },

    getBatches(): BatchPayload[] {
      return [...localBatches]
    },
  }
}

// =============================================================================
// Recording Transport (for testing)
// =============================================================================

/**
 * Extended transport interface with event recording for testing.
 */
export interface RecordingTransport extends Transport {
  recordEvent(event: SegmentEvent): void
}

/**
 * In-memory transport for testing with immediate event recording.
 * Events are recorded immediately when enqueued (via recordEvent)
 * and also stored in batches when send() is called.
 */
export class InMemoryTransport implements RecordingTransport {
  private events: SegmentEvent[] = []
  private batches: BatchPayload[] = []

  /**
   * Record an event immediately (called on enqueue).
   */
  recordEvent(event: SegmentEvent): void {
    this.events.push(event)
  }

  async send(payload: BatchPayload): Promise<TransportResult> {
    this.batches.push(payload)
    // Don't duplicate events - they're already recorded via recordEvent
    return { statusCode: 200 }
  }

  async flush(_timeout?: number): Promise<boolean> {
    return true
  }

  getEvents(): SegmentEvent[] {
    return [...this.events]
  }

  getBatches(): BatchPayload[] {
    return [...this.batches]
  }

  clear(): void {
    this.events = []
    this.batches = []
  }
}
