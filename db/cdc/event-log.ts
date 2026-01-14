/**
 * EventLog - Replay and checkpoint management for CDC events
 *
 * Provides event replay from:
 * - LSN (Log Sequence Number)
 * - Timestamp
 * - Saved checkpoint
 *
 * Supports checkpoint management for consumers to track their position.
 */

import { EventFilter, type EventFilterOptions } from './filter'

/**
 * Checkpoint data for a consumer
 */
export interface Checkpoint {
  lsn?: number
  timestamp?: string
  cursor?: string
}

/**
 * Replay options
 */
export interface ReplayOptions {
  /** Start from this LSN */
  fromLsn?: number
  /** Start from this timestamp */
  fromTimestamp?: string
  /** Filter events */
  filter?: EventFilterOptions
  /** Maximum events to return */
  limit?: number
  /** Cursor for pagination */
  cursor?: string
}

/**
 * Replay result with pagination
 */
export interface ReplayResult<T> {
  events: T[]
  cursor?: string
  hasMore?: boolean
}

/**
 * Event storage interface
 */
export interface EventStorage {
  getEvents(options: {
    fromLsn?: number
    fromTimestamp?: string
    limit?: number
    cursor?: string
  }): Promise<unknown[] | ReplayResult<unknown>>

  saveCheckpoint?(consumerId: string, checkpoint: Checkpoint): Promise<void>
  getCheckpoint?(consumerId: string): Promise<Checkpoint | null>
}

/**
 * EventLog - Manages event replay and checkpoints
 */
export class EventLog {
  private storage: EventStorage

  constructor(storage: EventStorage) {
    this.storage = storage
  }

  /**
   * Replay events from a position
   */
  async replay<T = unknown>(options: ReplayOptions = {}): Promise<ReplayResult<T> & T[]> {
    const result = await this.storage.getEvents({
      fromLsn: options.fromLsn,
      fromTimestamp: options.fromTimestamp,
      limit: options.limit,
      cursor: options.cursor,
    })

    // Handle both array and paginated result formats, and undefined
    let events: unknown[] = []
    let cursor: string | undefined
    let hasMore: boolean | undefined

    if (result == null) {
      // No result - return empty
      events = []
    } else if (Array.isArray(result)) {
      events = result
    } else if (result && typeof result === 'object') {
      events = result.events ?? []
      cursor = result.cursor
      hasMore = result.hasMore
    }

    // Apply type filter if provided
    if (options.filter) {
      const filter = new EventFilter(options.filter)
      events = filter.apply(events as { type?: string; ns?: string }[])
    }

    // Apply LSN filter (only if storage didn't already filter)
    if (options.fromLsn !== undefined) {
      events = events.filter((e: any) => e.lsn >= options.fromLsn!)
    }

    // Apply timestamp filter (only if storage didn't already filter)
    if (options.fromTimestamp !== undefined) {
      events = events.filter(
        (e: any) => e.timestamp >= options.fromTimestamp!
      )
    }

    // Create result that is both an array and has metadata
    const typedEvents = events as T[]
    const output = Object.assign(typedEvents, {
      events: typedEvents,
      cursor,
      hasMore,
    })

    return output
  }

  /**
   * Save a checkpoint for a consumer
   */
  async saveCheckpoint(consumerId: string, checkpoint: Checkpoint): Promise<void> {
    if (!this.storage.saveCheckpoint) {
      throw new Error('Storage does not support checkpoints')
    }
    await this.storage.saveCheckpoint(consumerId, checkpoint)
  }

  /**
   * Get checkpoint for a consumer
   */
  async getCheckpoint(consumerId: string): Promise<Checkpoint> {
    if (!this.storage.getCheckpoint) {
      throw new Error('Storage does not support checkpoints')
    }
    const checkpoint = await this.storage.getCheckpoint(consumerId)
    return checkpoint ?? { lsn: 0 }
  }

  /**
   * Resume replay from a saved checkpoint
   */
  async resumeFrom<T = unknown>(consumerId: string, options: Omit<ReplayOptions, 'fromLsn'> = {}): Promise<ReplayResult<T> & T[]> {
    const checkpoint = await this.getCheckpoint(consumerId)
    return this.replay<T>({
      ...options,
      fromLsn: checkpoint.lsn,
      fromTimestamp: checkpoint.timestamp,
    })
  }
}
