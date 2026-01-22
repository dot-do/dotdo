/**
 * R2 Buffer Manager for Parent DO
 *
 * Handles event buffering and batching before writing to R2:
 * - Buffers events in memory until threshold is reached
 * - Auto-flushes when maxBufferSize is exceeded
 * - Auto-flushes on configured interval
 * - Batches events for cost efficiency
 *
 * @module examples/example.com.ai/src/r2-buffer
 */

import type { ParentDOEvent, R2BufferConfig, R2FlushResult, R2BufferStats } from './types'

/**
 * Generate a unique batch ID for R2 writes
 */
function generateBatchId(): string {
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * R2 Buffer Manager
 *
 * Manages event buffering with configurable thresholds and automatic flushing.
 */
export class R2BufferManager {
  private eventBuffer: ParentDOEvent[] = []
  private config: R2BufferConfig = {
    maxBufferSize: 1000,
    flushIntervalMs: 60000, // 1 minute default
    batchSize: 100,
  }
  private flushInterval: ReturnType<typeof setInterval> | null = null
  private r2Bucket: R2Bucket | null = null

  constructor(r2Bucket?: R2Bucket) {
    this.r2Bucket = r2Bucket ?? null
    this.startFlushInterval()
  }

  /**
   * Configure buffer settings
   */
  configure(config: R2BufferConfig): void {
    this.config = { ...this.config, ...config }
    // Restart interval with new timing
    this.stopFlushInterval()
    this.startFlushInterval()
  }

  /**
   * Buffer an event for later R2 write
   * Auto-flushes if buffer exceeds maxBufferSize
   */
  async buffer(event: ParentDOEvent): Promise<void> {
    this.eventBuffer.push(event)

    // Auto-flush if buffer exceeds max size
    if (this.eventBuffer.length >= this.config.maxBufferSize) {
      await this.flush()
    }
  }

  /**
   * Flush all buffered events to R2
   */
  async flush(): Promise<R2FlushResult> {
    if (this.eventBuffer.length === 0) {
      return { written: 0, batchId: '' }
    }

    const batchId = generateBatchId()
    const eventsToWrite = [...this.eventBuffer]
    const written = eventsToWrite.length

    // Clear buffer before write (in case of concurrent access)
    this.eventBuffer = []

    // Write to R2 if bucket is available
    if (this.r2Bucket) {
      const key = `events/${batchId}.json`
      const body = JSON.stringify({
        batchId,
        timestamp: Date.now(),
        eventCount: written,
        events: eventsToWrite,
      })

      await this.r2Bucket.put(key, body, {
        httpMetadata: {
          contentType: 'application/json',
        },
      })
    }

    return { written, batchId }
  }

  /**
   * Get current buffer statistics
   */
  getBufferStats(): R2BufferStats {
    const count = this.eventBuffer.length
    const oldestTimestamp = count > 0 ? this.eventBuffer[0].$timestamp : null

    return { count, oldestTimestamp }
  }

  /**
   * Start the automatic flush interval
   */
  private startFlushInterval(): void {
    if (this.flushInterval) {
      return
    }

    this.flushInterval = setInterval(async () => {
      if (this.eventBuffer.length > 0) {
        await this.flush()
      }
    }, this.config.flushIntervalMs)
  }

  /**
   * Stop the automatic flush interval
   */
  private stopFlushInterval(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
      this.flushInterval = null
    }
  }

  /**
   * Cleanup resources (call when DO is destroyed)
   */
  destroy(): void {
    this.stopFlushInterval()
  }
}

/**
 * Create the $.r2 proxy interface
 */
export function createR2Proxy(manager: R2BufferManager): {
  buffer: (event: ParentDOEvent) => Promise<void>
  flush: () => Promise<R2FlushResult>
  getBufferStats: () => R2BufferStats
  configure: (config: R2BufferConfig) => void
} {
  return {
    buffer: (event: ParentDOEvent) => manager.buffer(event),
    flush: () => manager.flush(),
    getBufferStats: () => manager.getBufferStats(),
    configure: (config: R2BufferConfig) => manager.configure(config),
  }
}
