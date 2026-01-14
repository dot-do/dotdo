/**
 * Watermark - Event-time progress tracking
 */

import { parseDuration } from './utils'
import type { DurationString } from './types'

/**
 * Watermark represents the event-time progress through a stream
 */
export class Watermark {
  readonly timestamp: number

  constructor(timestamp: number | string) {
    if (typeof timestamp === 'string') {
      this.timestamp = new Date(timestamp).getTime()
    } else {
      this.timestamp = timestamp
    }
  }

  /**
   * Check if this watermark is before another
   */
  isBefore(other: Watermark): boolean {
    return this.timestamp < other.timestamp
  }

  /**
   * Check if this watermark is after another
   */
  isAfter(other: Watermark): boolean {
    return this.timestamp > other.timestamp
  }

  /**
   * Check if this watermark equals another
   */
  equals(other: Watermark): boolean {
    return this.timestamp === other.timestamp
  }

  /**
   * Create a new watermark advanced by duration
   */
  advance(duration: DurationString | number): Watermark {
    const ms = parseDuration(duration)
    return new Watermark(this.timestamp + ms)
  }
}
