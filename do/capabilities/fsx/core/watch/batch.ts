/**
 * BatchEmitter - Batch event emission with reduced callback overhead
 *
 * This module provides a BatchEmitter class that collects multiple events
 * and emits them in batches, reducing the overhead of individual callbacks
 * for WebSocket-based watch notifications.
 *
 * Key features:
 * - Configurable batch window (default: 10ms)
 * - Event priority ordering (delete > create > modify)
 * - Event deduplication within batch window
 * - Throughput metrics tracking
 * - Memory-efficient batch assembly
 *
 * @module core/watch/batch
 */

import type { WatchEvent, WatchEventType } from './events.js'
import { createWatchEvent } from './events.js'

/**
 * Priority values for event types.
 * Higher priority events are emitted first in batched notifications.
 * Delete events have highest priority because they represent final state.
 */
export const EVENT_PRIORITY: Record<WatchEventType, number> = {
  delete: 3,
  rename: 2, // rename can be create or delete, treat as high priority
  create: 1,
  modify: 0,
}

/**
 * Configuration options for BatchEmitter.
 */
export interface BatchEmitterOptions {
  /**
   * Time window in milliseconds for collecting events before emission.
   * Events occurring within this window are batched together.
   * @default 10
   */
  batchWindowMs?: number

  /**
   * Maximum number of events in a single batch.
   * When reached, batch is emitted immediately.
   * @default 100
   */
  maxBatchSize?: number

  /**
   * Whether to enable event compression for large batches.
   * When enabled, sequential events to the same path are coalesced.
   * @default true
   */
  compressEvents?: boolean

  /**
   * Whether to sort events by priority before emission.
   * @default true
   */
  prioritizeEvents?: boolean

  /**
   * Whether to track throughput metrics.
   * @default false
   */
  enableMetrics?: boolean
}

/**
 * Throughput metrics for batch emission.
 */
export interface BatchMetrics {
  /** Total number of events received */
  eventsReceived: number
  /** Total number of events emitted (after coalescing) */
  eventsEmitted: number
  /** Total number of batches emitted */
  batchesEmitted: number
  /** Average batch size */
  averageBatchSize: number
  /** Average latency from event receipt to emission (ms) */
  averageLatencyMs: number
  /** Compression ratio (eventsReceived / eventsEmitted) */
  compressionRatio: number
  /** Events per second throughput */
  eventsPerSecond: number
}

/**
 * Callback type for batch event emission.
 */
export type BatchCallback = (events: WatchEvent[]) => void

/**
 * Internal structure for pending events.
 */
interface PendingBatchEvent {
  /** The event to emit */
  event: WatchEvent
  /** Timestamp when event was received */
  receivedAt: number
}

/**
 * BatchEmitter - Collects and emits events in batches.
 *
 * This class reduces callback overhead by collecting multiple events
 * and emitting them together. It's optimized for WebSocket-based
 * watch notifications where batching can significantly reduce
 * message overhead and improve throughput.
 *
 * @example
 * ```typescript
 * const emitter = new BatchEmitter({
 *   batchWindowMs: 10,
 *   maxBatchSize: 50,
 * })
 *
 * // Register batch callback
 * emitter.onBatch((events) => {
 *   ws.send(JSON.stringify({ type: 'batch', events }))
 * })
 *
 * // Queue events (will be batched)
 * emitter.queue('create', '/path/file1.txt')
 * emitter.queue('modify', '/path/file2.txt')
 * emitter.queue('delete', '/path/file3.txt')
 *
 * // Events emitted in single batch after 10ms
 * ```
 */
export class BatchEmitter {
  // Configuration
  private readonly batchWindowMs: number
  private readonly maxBatchSize: number
  private readonly compressEvents: boolean
  private readonly prioritizeEvents: boolean
  private readonly enableMetrics: boolean

  // State
  private pendingEvents: Map<string, PendingBatchEvent> = new Map()
  private batchTimer: ReturnType<typeof setTimeout> | null = null
  private callbacks: Set<BatchCallback> = new Set()

  // Metrics
  private _eventsReceived: number = 0
  private _eventsEmitted: number = 0
  private _batchesEmitted: number = 0
  private _totalLatencyMs: number = 0
  private _metricsStartTime: number = Date.now()

  /**
   * Create a new BatchEmitter.
   *
   * @param options - Configuration options
   */
  constructor(options: BatchEmitterOptions = {}) {
    this.batchWindowMs = options.batchWindowMs ?? 10
    this.maxBatchSize = options.maxBatchSize ?? 100
    this.compressEvents = options.compressEvents ?? true
    this.prioritizeEvents = options.prioritizeEvents ?? true
    this.enableMetrics = options.enableMetrics ?? false
  }

  /**
   * Register a callback to receive batched events.
   *
   * @param callback - Function to call with batched events
   * @returns Unsubscribe function
   */
  onBatch(callback: BatchCallback): () => void {
    this.callbacks.add(callback)
    return () => this.callbacks.delete(callback)
  }

  /**
   * Queue an event for batch emission.
   *
   * Events are collected and emitted together after the batch window
   * expires or when the max batch size is reached.
   *
   * @param type - Event type
   * @param path - File path
   * @param oldPath - For rename events, the original path
   * @param metadata - Optional event metadata
   */
  queue(
    type: WatchEventType,
    path: string,
    oldPath?: string,
    metadata?: { size?: number; mtime?: number; isDirectory?: boolean }
  ): void {
    const now = Date.now()
    this._eventsReceived++

    // Create the event
    const event = type === 'rename'
      ? createWatchEvent(type, oldPath || path, path, metadata)
      : createWatchEvent(type, path, metadata)

    // Key for deduplication (path-based)
    const key = path

    if (this.compressEvents) {
      // Check for existing event at this path
      const existing = this.pendingEvents.get(key)
      if (existing) {
        // Apply smart coalescing
        const coalescedType = this.coalesceTypes(existing.event.type, type)
        // Update existing event with coalesced type, keep original timestamp
        const coalescedEvent = createWatchEvent(
          coalescedType,
          type === 'rename' ? (oldPath || path) : path,
          type === 'rename' ? path : metadata,
          type === 'rename' ? metadata : undefined
        )
        this.pendingEvents.set(key, {
          event: coalescedEvent,
          receivedAt: existing.receivedAt, // Keep original receive time
        })
      } else {
        this.pendingEvents.set(key, { event, receivedAt: now })
      }
    } else {
      // No compression - use unique key
      const uniqueKey = `${key}:${now}:${Math.random()}`
      this.pendingEvents.set(uniqueKey, { event, receivedAt: now })
    }

    // Check if we've hit max batch size
    if (this.pendingEvents.size >= this.maxBatchSize) {
      this.flush()
      return
    }

    // Start batch timer if not already running
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null
        this.flush()
      }, this.batchWindowMs)
    }
  }

  /**
   * Immediately flush all pending events.
   *
   * Useful for cleanup or when immediate emission is required.
   */
  flush(): void {
    // Clear timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    // Nothing to emit
    if (this.pendingEvents.size === 0) {
      return
    }

    // Collect events
    const now = Date.now()
    let events: WatchEvent[] = []

    for (const { event, receivedAt } of this.pendingEvents.values()) {
      events.push(event)
      if (this.enableMetrics) {
        this._totalLatencyMs += now - receivedAt
      }
    }

    // Clear pending
    this.pendingEvents.clear()

    // Sort by priority if enabled
    if (this.prioritizeEvents) {
      events = this.sortByPriority(events)
    }

    // Update metrics
    this._eventsEmitted += events.length
    this._batchesEmitted++

    // Emit to all callbacks
    for (const callback of this.callbacks) {
      try {
        callback(events)
      } catch {
        // Swallow callback errors
      }
    }
  }

  /**
   * Get current metrics.
   *
   * @returns Throughput metrics object
   */
  getMetrics(): BatchMetrics {
    const elapsedSeconds = (Date.now() - this._metricsStartTime) / 1000 || 1

    return {
      eventsReceived: this._eventsReceived,
      eventsEmitted: this._eventsEmitted,
      batchesEmitted: this._batchesEmitted,
      averageBatchSize: this._batchesEmitted > 0
        ? this._eventsEmitted / this._batchesEmitted
        : 0,
      averageLatencyMs: this._eventsEmitted > 0
        ? this._totalLatencyMs / this._eventsEmitted
        : 0,
      compressionRatio: this._eventsEmitted > 0
        ? this._eventsReceived / this._eventsEmitted
        : 1,
      eventsPerSecond: this._eventsEmitted / elapsedSeconds,
    }
  }

  /**
   * Reset metrics to initial state.
   */
  resetMetrics(): void {
    this._eventsReceived = 0
    this._eventsEmitted = 0
    this._batchesEmitted = 0
    this._totalLatencyMs = 0
    this._metricsStartTime = Date.now()
  }

  /**
   * Get the number of pending events.
   *
   * @returns Number of events waiting to be emitted
   */
  getPendingCount(): number {
    return this.pendingEvents.size
  }

  /**
   * Get the batch window in milliseconds.
   *
   * @returns Batch window duration
   */
  getBatchWindow(): number {
    return this.batchWindowMs
  }

  /**
   * Get the max batch size.
   *
   * @returns Maximum events per batch
   */
  getMaxBatchSize(): number {
    return this.maxBatchSize
  }

  /**
   * Clean up resources.
   *
   * Clears pending events and timers without emitting.
   */
  dispose(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
    this.pendingEvents.clear()
    this.callbacks.clear()
  }

  /**
   * Sort events by priority (delete > rename > create > modify).
   */
  private sortByPriority(events: WatchEvent[]): WatchEvent[] {
    return events.sort((a, b) => {
      const priorityA = EVENT_PRIORITY[a.type] ?? 0
      const priorityB = EVENT_PRIORITY[b.type] ?? 0
      return priorityB - priorityA
    })
  }

  /**
   * Apply smart coalescing to determine final event type.
   *
   * Rules:
   * - create + modify = create (file was created, modifications don't matter)
   * - modify + delete = delete (file was deleted, prior state doesn't matter)
   * - delete always wins (represents final state)
   */
  private coalesceTypes(existingType: WatchEventType, newType: WatchEventType): WatchEventType {
    // Delete always wins
    if (newType === 'delete') return 'delete'

    // If existing was create/rename, keep it (create + modify = create)
    if (existingType === 'create' || existingType === 'rename') {
      return existingType
    }

    // Otherwise use new type
    return newType
  }
}

/**
 * Create a batch emitter with default configuration.
 *
 * @param options - Optional configuration overrides
 * @returns Configured BatchEmitter instance
 */
export function createBatchEmitter(options?: BatchEmitterOptions): BatchEmitter {
  return new BatchEmitter(options)
}
