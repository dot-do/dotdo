/**
 * Sink - Destinations for CDC changes
 *
 * Provides sink implementations for delivering changes:
 * - MemorySink for testing
 * - WebhookSink for HTTP delivery
 * - QueueSink for async processing
 * - MultiSink for fan-out
 * - FileSink for file-based output
 *
 * @see https://debezium.io/documentation/reference/stable/operations/debezium-server.html
 */

import { ChangeType, type ChangeEvent } from './stream'

// ============================================================================
// TYPES
// ============================================================================

/** Generic sink interface */
export interface Sink<T> {
  /** Write a change event */
  write(event: ChangeEvent<T>): Promise<void>
  /** Flush any buffered events */
  flush(): Promise<void>
}

/** Result of a sink write operation */
export interface SinkResult {
  success: boolean
  error?: Error
}

/** Base sink options */
export interface SinkOptions<T> {
  /** Handler for errors */
  onError?: (error: Error) => Promise<void>
}

// ============================================================================
// MEMORY SINK
// ============================================================================

/** Options for memory sink */
export interface MemorySinkOptions<T> {
  /** Maximum number of changes to store */
  maxSize?: number
  /** Key extractor for filtering by key */
  keyExtractor?: (event: ChangeEvent<T>) => string
}

/** Filter options for querying memory sink */
export interface MemorySinkFilter {
  type?: ChangeType
  since?: number
  until?: number
}

/**
 * In-memory sink for testing and debugging
 */
export class MemorySink<T> implements Sink<T> {
  private changes: ChangeEvent<T>[] = []
  private options: MemorySinkOptions<T>
  private keyIndex: Map<string, ChangeEvent<T>[]> = new Map()

  constructor(options: MemorySinkOptions<T> = {}) {
    this.options = options
  }

  async write(event: ChangeEvent<T>): Promise<void> {
    this.changes.push(event)

    // Enforce max size
    if (this.options.maxSize && this.changes.length > this.options.maxSize) {
      const removed = this.changes.shift()
      // Remove from key index
      if (removed && this.options.keyExtractor) {
        const key = this.options.keyExtractor(removed)
        const keyChanges = this.keyIndex.get(key)
        if (keyChanges) {
          const idx = keyChanges.indexOf(removed)
          if (idx >= 0) keyChanges.splice(idx, 1)
        }
      }
    }

    // Index by key
    if (this.options.keyExtractor) {
      const key = this.options.keyExtractor(event)
      if (!this.keyIndex.has(key)) {
        this.keyIndex.set(key, [])
      }
      this.keyIndex.get(key)!.push(event)
    }
  }

  async flush(): Promise<void> {
    // No-op for memory sink
  }

  /**
   * Get all stored changes
   */
  getChanges(filter?: MemorySinkFilter): ChangeEvent<T>[] {
    let result = [...this.changes]

    if (filter?.type !== undefined) {
      result = result.filter((c) => c.type === filter.type)
    }

    if (filter?.since !== undefined) {
      result = result.filter((c) => c.timestamp >= filter.since!)
    }

    if (filter?.until !== undefined) {
      result = result.filter((c) => c.timestamp <= filter.until!)
    }

    return result
  }

  /**
   * Get changes by key
   */
  getChangesByKey(key: string): ChangeEvent<T>[] {
    return this.keyIndex.get(key) ?? []
  }

  /**
   * Clear all stored changes
   */
  clear(): void {
    this.changes = []
    this.keyIndex.clear()
  }
}

/**
 * Create a memory sink
 */
export function createMemorySink<T>(options?: MemorySinkOptions<T>): MemorySink<T> {
  return new MemorySink(options)
}

// ============================================================================
// WEBHOOK SINK
// ============================================================================

/** Options for webhook sink */
export interface WebhookSinkOptions<T> {
  /** Webhook URL */
  url: string
  /** Custom headers */
  headers?: Record<string, string>
  /** Batch size (1 = immediate, >1 = batch) */
  batchSize?: number
  /** Batch timeout in milliseconds */
  batchTimeoutMs?: number
  /** Number of retry attempts */
  retryAttempts?: number
  /** Retry delay in milliseconds */
  retryDelayMs?: number
  /** Use exponential backoff */
  exponentialBackoff?: boolean
  /** Circuit breaker threshold */
  circuitBreakerThreshold?: number
  /** Circuit breaker cooldown in milliseconds */
  circuitBreakerCooldownMs?: number
  /** Handler for errors */
  onError?: (error: Error) => Promise<void>
}

/**
 * Webhook sink for HTTP delivery
 */
export class WebhookSink<T> implements Sink<T> {
  private options: WebhookSinkOptions<T>
  private buffer: ChangeEvent<T>[] = []
  private batchTimer: ReturnType<typeof setTimeout> | null = null
  private failureCount: number = 0
  private circuitOpenUntil: number = 0

  constructor(options: WebhookSinkOptions<T>) {
    this.options = options
  }

  async write(event: ChangeEvent<T>): Promise<void> {
    // Check circuit breaker
    if (this.isCircuitOpen()) {
      throw new Error('Circuit breaker is open')
    }

    const batchSize = this.options.batchSize ?? 1

    if (batchSize === 1) {
      await this.send([event])
    } else {
      this.buffer.push(event)

      if (this.buffer.length >= batchSize) {
        await this.flushBuffer()
      } else if (this.options.batchTimeoutMs && !this.batchTimer) {
        this.batchTimer = setTimeout(() => this.flushBuffer(), this.options.batchTimeoutMs)
      }
    }
  }

  async flush(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
    await this.flushBuffer()
  }

  isCircuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntil
  }

  private async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) return

    const batch = [...this.buffer]
    this.buffer = []

    await this.send(batch)
  }

  private async send(changes: ChangeEvent<T>[]): Promise<void> {
    const maxAttempts = this.options.retryAttempts ?? 3
    let attempt = 0
    let lastError: Error | null = null

    while (attempt < maxAttempts) {
      attempt++

      try {
        const response = await fetch(this.options.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.options.headers,
          },
          body: JSON.stringify({ changes }),
        })

        if (!response.ok) {
          const error = new Error(`Webhook failed: ${response.status} ${response.statusText}`)

          // Don't retry client errors
          if (response.status >= 400 && response.status < 500) {
            this.handleError(error)
            return
          }

          throw error
        }

        // Success - reset failure count
        this.failureCount = 0
        return
      } catch (error) {
        lastError = error as Error
        this.failureCount++

        // Check circuit breaker
        if (this.options.circuitBreakerThreshold && this.failureCount >= this.options.circuitBreakerThreshold) {
          this.circuitOpenUntil = Date.now() + (this.options.circuitBreakerCooldownMs ?? 30000)
        }

        if (attempt < maxAttempts) {
          const baseDelay = this.options.retryDelayMs ?? 1000
          const delay = this.options.exponentialBackoff
            ? baseDelay * Math.pow(2, attempt - 1)
            : baseDelay
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }

    if (lastError) {
      this.handleError(lastError)
    }
  }

  private handleError(error: Error): void {
    if (this.options.onError) {
      this.options.onError(error)
    }
  }
}

/**
 * Create a webhook sink
 */
export function createWebhookSink<T>(options: WebhookSinkOptions<T>): WebhookSink<T> {
  return new WebhookSink(options)
}

// ============================================================================
// QUEUE SINK
// ============================================================================

/** Options for queue sink */
export interface QueueSinkOptions<T> {
  /** Enqueue function */
  enqueue: (changes: ChangeEvent<T>[], partition?: string) => Promise<void>
  /** Partition key extractor */
  partitionKey?: (event: ChangeEvent<T>) => string
  /** Preserve order */
  preserveOrder?: boolean
  /** Require acknowledgment */
  requireAck?: boolean
  /** Acknowledgment timeout in milliseconds */
  ackTimeoutMs?: number
  /** Handler for errors */
  onError?: (error: Error) => Promise<void>
}

/**
 * Queue sink for async processing
 */
export class QueueSink<T> implements Sink<T> {
  private options: QueueSinkOptions<T>
  private buffer: Map<string, ChangeEvent<T>[]> = new Map()
  private pendingAcks: Map<string, { event: ChangeEvent<T>; timer?: ReturnType<typeof setTimeout> }> = new Map()

  constructor(options: QueueSinkOptions<T>) {
    this.options = options
  }

  async write(event: ChangeEvent<T>): Promise<void> {
    const partition = this.options.partitionKey
      ? this.options.partitionKey(event)
      : 'default'

    if (!this.buffer.has(partition)) {
      this.buffer.set(partition, [])
    }
    this.buffer.get(partition)!.push(event)

    // Track for acknowledgment
    if (this.options.requireAck) {
      const timer = this.options.ackTimeoutMs
        ? setTimeout(() => this.retryUnacked(event.eventId), this.options.ackTimeoutMs)
        : undefined
      this.pendingAcks.set(event.eventId, { event, timer })
    }
  }

  async flush(): Promise<void> {
    const partitions = [...this.buffer.entries()]

    for (const [partition, changes] of partitions) {
      if (changes.length > 0) {
        await this.options.enqueue(changes, partition)
        this.buffer.set(partition, [])
      }
    }
  }

  /**
   * Acknowledge a successfully processed event
   */
  async acknowledge(eventId: string): Promise<void> {
    const pending = this.pendingAcks.get(eventId)
    if (pending?.timer) {
      clearTimeout(pending.timer)
    }
    this.pendingAcks.delete(eventId)
  }

  /**
   * Get count of pending acknowledgments
   */
  getPendingAckCount(): number {
    return this.pendingAcks.size
  }

  private async retryUnacked(eventId: string): Promise<void> {
    const pending = this.pendingAcks.get(eventId)
    if (pending) {
      const partition = this.options.partitionKey
        ? this.options.partitionKey(pending.event)
        : 'default'
      await this.options.enqueue([pending.event], partition)

      // Reset timer
      if (this.options.ackTimeoutMs) {
        const timer = setTimeout(() => this.retryUnacked(eventId), this.options.ackTimeoutMs)
        this.pendingAcks.set(eventId, { event: pending.event, timer })
      }
    }
  }
}

/**
 * Create a queue sink
 */
export function createQueueSink<T>(options: QueueSinkOptions<T>): QueueSink<T> {
  return new QueueSink(options)
}

// ============================================================================
// MULTI SINK (Fan-out)
// ============================================================================

/** Route configuration */
export interface SinkRoute<T> {
  condition: (event: ChangeEvent<T>) => boolean
  sink: Sink<T>
}

/** Options for multi sink */
export interface MultiSinkOptions<T> {
  /** List of sinks to write to */
  sinks: Sink<T>[]
  /** Write to sinks in parallel */
  parallel?: boolean
  /** Continue on error */
  continueOnError?: boolean
  /** Conditional routes */
  routes?: SinkRoute<T>[]
  /** Handler for errors */
  onError?: (error: Error) => Promise<void>
}

/**
 * Multi sink for fan-out to multiple destinations
 */
export class MultiSink<T> implements Sink<T> {
  private options: MultiSinkOptions<T>

  constructor(options: MultiSinkOptions<T>) {
    this.options = {
      parallel: true,
      continueOnError: false,
      ...options,
    }
  }

  async write(event: ChangeEvent<T>): Promise<void> {
    const errors: Error[] = []

    // Handle routes
    if (this.options.routes) {
      for (const route of this.options.routes) {
        if (route.condition(event)) {
          try {
            await route.sink.write(event)
          } catch (error) {
            errors.push(error as Error)
            if (!this.options.continueOnError) throw error
          }
        }
      }
    }

    // Handle regular sinks
    if (this.options.parallel) {
      const results = await Promise.allSettled(
        this.options.sinks.map((sink) => sink.write(event))
      )

      for (const result of results) {
        if (result.status === 'rejected') {
          errors.push(result.reason as Error)
          if (!this.options.continueOnError) {
            throw result.reason
          }
        }
      }
    } else {
      for (const sink of this.options.sinks) {
        try {
          await sink.write(event)
        } catch (error) {
          errors.push(error as Error)
          if (!this.options.continueOnError) throw error
        }
      }
    }

    // Report errors
    for (const error of errors) {
      if (this.options.onError) {
        await this.options.onError(error)
      }
    }
  }

  async flush(): Promise<void> {
    const allSinks = [
      ...this.options.sinks,
      ...(this.options.routes?.map((r) => r.sink) ?? []),
    ]

    if (this.options.parallel) {
      await Promise.all(allSinks.map((sink) => sink.flush()))
    } else {
      for (const sink of allSinks) {
        await sink.flush()
      }
    }
  }
}

/**
 * Create a multi sink
 */
export function createMultiSink<T>(options: MultiSinkOptions<T>): MultiSink<T> {
  return new MultiSink(options)
}

// ============================================================================
// FILE SINK
// ============================================================================

/** File format options */
export type FileFormat = 'jsonl' | 'csv' | 'parquet'

/** Options for file sink */
export interface FileSinkOptions<T> {
  /** Output format */
  format: FileFormat
  /** Columns for CSV format */
  columns?: string[]
  /** Compression type */
  compression?: 'none' | 'gzip'
  /** Maximum file size before rotation */
  maxSizeBytes?: number
  /** Maximum records before rotation */
  maxRecords?: number
  /** Rotation interval in milliseconds */
  rotateIntervalMs?: number
  /** Handler for rotated files */
  onRotate?: (content: string) => Promise<void>
}

/** Parquet metadata */
export interface ParquetMetadata {
  rowCount: number
  columns: string[]
}

/**
 * File sink for file-based output
 */
export class FileSink<T> implements Sink<T> {
  private options: FileSinkOptions<T>
  private buffer: ChangeEvent<T>[] = []
  private currentSize: number = 0
  private rotateTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: FileSinkOptions<T>) {
    this.options = options

    if (options.rotateIntervalMs) {
      this.rotateTimer = setInterval(() => this.rotate(), options.rotateIntervalMs)
    }
  }

  async write(event: ChangeEvent<T>): Promise<void> {
    this.buffer.push(event)

    // Estimate size
    const eventSize = JSON.stringify(event).length
    this.currentSize += eventSize

    // Check rotation conditions
    if (this.options.maxRecords && this.buffer.length >= this.options.maxRecords) {
      await this.rotate()
    } else if (this.options.maxSizeBytes && this.currentSize >= this.options.maxSizeBytes) {
      await this.rotate()
    }
  }

  async flush(): Promise<void> {
    // Only rotate (clear) if there's a handler, otherwise just prepare for reading
    if (this.options.onRotate && this.buffer.length > 0) {
      await this.rotate()
    }
  }

  /**
   * Get buffered content as string
   */
  getBufferedContent(): string {
    switch (this.options.format) {
      case 'jsonl':
        return this.buffer.map((e) => JSON.stringify(e)).join('\n')
      case 'csv':
        return this.toCSV()
      case 'parquet':
        return JSON.stringify(this.buffer) // Simplified for in-memory
    }
  }

  /**
   * Get compressed content (stub for real compression)
   */
  getCompressedContent(): string {
    const content = this.getBufferedContent()
    if (this.options.compression === 'gzip') {
      // In a real implementation, this would use actual gzip compression
      return `gzip:${btoa(content)}`
    }
    return content
  }

  /**
   * Get parquet metadata (simplified)
   */
  getParquetMetadata(): ParquetMetadata {
    const columns = this.options.columns ?? []
    if (columns.length === 0 && this.buffer.length > 0) {
      const sample = this.buffer[0]!.after ?? this.buffer[0]!.before
      if (sample && typeof sample === 'object') {
        columns.push(...Object.keys(sample as object))
      }
    }
    return {
      rowCount: this.buffer.length,
      columns,
    }
  }

  private toCSV(): string {
    const columns = this.options.columns ?? []
    const lines: string[] = []

    // Header
    lines.push(columns.join(','))

    // Data
    for (const event of this.buffer) {
      const record = event.after ?? event.before
      if (record && typeof record === 'object') {
        const values = columns.map((col) => {
          const value = (record as Record<string, unknown>)[col]
          return value !== undefined ? String(value) : ''
        })
        lines.push(values.join(','))
      }
    }

    return lines.join('\n')
  }

  private async rotate(): Promise<void> {
    if (this.buffer.length === 0) return

    const content = this.options.compression === 'gzip'
      ? this.getCompressedContent()
      : this.getBufferedContent()

    if (this.options.onRotate) {
      await this.options.onRotate(content)
    }

    this.buffer = []
    this.currentSize = 0
  }
}

/**
 * Create a file sink
 */
export function createFileSink<T>(options: FileSinkOptions<T>): FileSink<T> {
  return new FileSink(options)
}
