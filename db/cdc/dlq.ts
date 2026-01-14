/**
 * DeadLetterQueue - Manage failed CDC events
 *
 * Provides:
 * - Retrieval of failed events
 * - Retry mechanism for DLQ events
 * - Purge old events
 * - Statistics on failures
 */

import type { Pipeline } from './emitter'
import type { DLQEvent } from './emitter-dlq'

/**
 * DLQ statistics
 */
export interface DLQStats {
  total: number
  byReason: Record<string, number>
  oldest?: string
  newest?: string
}

/**
 * Purge options
 */
export interface PurgeOptions {
  /** Duration string like '7d', '24h' */
  olderThan: string
}

/**
 * DLQ storage interface
 */
export interface DLQStorage {
  getEvents?(): Promise<DLQEvent[]>
  getEvent?(id: string): Promise<DLQEvent | null>
  deleteEvent?(id: string): Promise<void>
  deleteEventsBefore?(timestamp: string): Promise<number>
  getStats?(): Promise<DLQStats>
}

/**
 * Parse duration string to milliseconds
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([dhms])$/)
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`)
  }

  const value = parseInt(match[1], 10)
  const unit = match[2]

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  }

  return value * multipliers[unit]
}

/**
 * DeadLetterQueue - Manage failed events
 */
export class DeadLetterQueue {
  private storage: DLQStorage

  constructor(storage: DLQStorage) {
    this.storage = storage
  }

  /**
   * Get all failed events
   */
  async getFailedEvents(): Promise<DLQEvent[]> {
    if (!this.storage.getEvents) {
      throw new Error('Storage does not support getEvents')
    }
    return this.storage.getEvents()
  }

  /**
   * Retry a specific DLQ event
   *
   * Re-emits the event to the original pipeline and removes from DLQ on success
   */
  async retry(dlqId: string, pipeline: Pipeline): Promise<void> {
    if (!this.storage.getEvent || !this.storage.deleteEvent) {
      throw new Error('Storage does not support retry operations')
    }

    const event = await this.storage.getEvent(dlqId)
    if (!event) {
      throw new Error(`DLQ event not found: ${dlqId}`)
    }

    // Remove DLQ metadata for retry
    const { _dlq, ...originalEvent } = event

    // Re-emit to pipeline
    await pipeline.send([originalEvent])

    // Remove from DLQ on success
    await this.storage.deleteEvent(dlqId)
  }

  /**
   * Purge old DLQ events
   *
   * @returns Number of events deleted
   */
  async purge(options: PurgeOptions): Promise<number> {
    if (!this.storage.deleteEventsBefore) {
      throw new Error('Storage does not support purge')
    }

    const maxAge = parseDuration(options.olderThan)
    const cutoffDate = new Date(Date.now() - maxAge)

    return this.storage.deleteEventsBefore(cutoffDate.toISOString())
  }

  /**
   * Get DLQ statistics
   */
  async getStats(): Promise<DLQStats> {
    if (!this.storage.getStats) {
      throw new Error('Storage does not support stats')
    }
    return this.storage.getStats()
  }
}
