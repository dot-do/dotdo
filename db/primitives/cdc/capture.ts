/**
 * Capture - Change capture adapters for different data sources
 *
 * Provides adapters for capturing changes from various sources:
 * - Database table polling (change tracking via timestamps)
 * - Transaction log parsing (simulated for edge/Worker environments)
 * - Event stream consumption (Kafka-style)
 * - Custom source adapters
 *
 * @see https://debezium.io/documentation/reference/stable/connectors/
 */

import { ChangeType } from './stream'
import { type MetricsCollector, noopMetrics } from '../observability'

// ============================================================================
// TYPES
// ============================================================================

/** Captured change from a source */
export interface CapturedChange<T> {
  type: ChangeType
  key: string
  before: T | null
  after: T | null
  timestamp: number
  lsn?: string
  transactionId?: string
  partition?: string
  offset?: number
  eventId?: string
}

/** Generic capture adapter interface */
export interface CaptureAdapter<T> {
  /** Start capturing changes */
  start(): Promise<void>
  /** Stop capturing changes */
  stop(): Promise<void>
  /** Get current checkpoint for resumption */
  getCheckpoint(): Promise<CaptureCheckpoint>
  /** Check if capture is running */
  isRunning(): boolean
}

/** Checkpoint for resumption */
export interface CaptureCheckpoint {
  /** Watermark timestamp */
  watermark?: number
  /** Log sequence number */
  lsn?: string
  /** Partition offsets */
  partitionOffsets?: Record<string, number>
  /** Custom position data */
  position?: unknown
}

/** Handler for captured changes */
export type CaptureChangeHandler<T> = (change: CapturedChange<T>) => Promise<void>

/** Handler for errors */
export type CaptureErrorHandler = (error: Error) => Promise<void>

// ============================================================================
// POLLING CAPTURE
// ============================================================================

/** Data source interface for polling */
export interface PollingDataSource<T> {
  /** List records, optionally since a timestamp */
  list(options?: { since?: number }): Promise<T[]>
  /** Get the unique key for a record */
  getKey(record: T): string
  /** Get the timestamp for a record */
  getTimestamp(record: T): number
}

/** Options for polling capture */
export interface PollingCaptureOptions<T> {
  /** Data source to poll */
  source: PollingDataSource<T>
  /** Poll interval in milliseconds */
  pollIntervalMs: number
  /** Handler for captured changes */
  onChange: CaptureChangeHandler<T>
  /** Handler for errors */
  onError?: CaptureErrorHandler
  /** Enable incremental polling (only fetch since watermark) */
  incremental?: boolean
  /** Starting watermark */
  startWatermark?: number
  /** Number of retry attempts */
  retryAttempts?: number
  /** Metrics collector */
  metrics?: MetricsCollector
}

/**
 * Polling-based change capture
 * Detects changes by comparing snapshots over time
 */
export class PollingCapture<T> implements CaptureAdapter<T> {
  private options: PollingCaptureOptions<T>
  private running: boolean = false
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private watermark: number = 0
  private lastSnapshot: Map<string, T> = new Map()
  private metrics: MetricsCollector

  constructor(options: PollingCaptureOptions<T>) {
    this.options = options
    this.watermark = options.startWatermark ?? 0
    this.metrics = options.metrics ?? noopMetrics
  }

  async start(): Promise<void> {
    this.running = true

    // Initial snapshot
    await this.poll()

    // Start polling
    this.pollTimer = setInterval(async () => {
      if (this.running) {
        await this.poll()
      }
    }, this.options.pollIntervalMs)
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  async getCheckpoint(): Promise<CaptureCheckpoint> {
    return { watermark: this.watermark }
  }

  isRunning(): boolean {
    return this.running
  }

  private async poll(): Promise<void> {
    try {
      const records = this.options.incremental
        ? await this.options.source.list({ since: this.watermark })
        : await this.options.source.list()

      const currentSnapshot = new Map<string, T>()
      let maxTimestamp = this.watermark

      // Build current snapshot and detect inserts/updates
      for (const record of records) {
        const key = this.options.source.getKey(record)
        const timestamp = this.options.source.getTimestamp(record)
        currentSnapshot.set(key, record)

        if (timestamp > maxTimestamp) {
          maxTimestamp = timestamp
        }

        const existing = this.lastSnapshot.get(key)
        if (!existing) {
          // New record - INSERT
          await this.options.onChange({
            type: ChangeType.INSERT,
            key,
            before: null,
            after: record,
            timestamp,
          })
        } else if (timestamp > this.watermark) {
          // Updated record
          await this.options.onChange({
            type: ChangeType.UPDATE,
            key,
            before: existing,
            after: record,
            timestamp,
          })
        }
      }

      // Detect deletes (only in full snapshot mode)
      if (!this.options.incremental) {
        for (const [key, record] of this.lastSnapshot) {
          if (!currentSnapshot.has(key)) {
            await this.options.onChange({
              type: ChangeType.DELETE,
              key,
              before: record,
              after: null,
              timestamp: Date.now(),
            })
          }
        }
      }

      // Update state
      this.lastSnapshot = currentSnapshot
      this.watermark = maxTimestamp

    } catch (error) {
      if (this.options.onError) {
        await this.options.onError(error as Error)
      }
      await this.retryPoll()
    }
  }

  private async retryPoll(): Promise<void> {
    const maxAttempts = this.options.retryAttempts ?? 3
    let attempt = 0

    while (attempt < maxAttempts && this.running) {
      attempt++
      try {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
        await this.poll()
        return
      } catch (error) {
        if (this.options.onError) {
          await this.options.onError(error as Error)
        }
      }
    }
  }
}

/**
 * Create a polling-based capture adapter
 */
export function createPollingCapture<T>(
  options: PollingCaptureOptions<T>
): PollingCapture<T> {
  return new PollingCapture(options)
}

// ============================================================================
// LOG CAPTURE (Transaction Log Parsing)
// ============================================================================

/** Parser for transaction log entries */
export interface LogParser<T, E = unknown> {
  parse(entry: E): {
    type: ChangeType
    key: string
    before?: T | null
    after?: T | null
    timestamp: number
    lsn?: string
    transactionId?: string
  }
}

/** Options for log capture */
export interface LogCaptureOptions<T, E = unknown> {
  /** Log entry parser */
  parser: LogParser<T, E>
  /** Handler for captured changes */
  onChange: CaptureChangeHandler<T>
  /** Callback for raw log entries (for debugging) */
  onLogEntry?: (entry: E) => void
  /** Handler for errors */
  onError?: CaptureErrorHandler
  /** Starting LSN */
  startLsn?: string
  /** Group changes by transaction */
  groupByTransaction?: boolean
  /** Handler for committed transactions */
  onTransaction?: (changes: CapturedChange<T>[]) => Promise<void>
  /** Metrics collector */
  metrics?: MetricsCollector
}

/**
 * Transaction log-based change capture
 * Parses simulated transaction log entries
 */
export class LogCapture<T, E = unknown> implements CaptureAdapter<T> {
  private options: LogCaptureOptions<T, E>
  private running: boolean = false
  private currentLsn: string = ''
  private pendingTransactions: Map<string, CapturedChange<T>[]> = new Map()
  private metrics: MetricsCollector

  constructor(options: LogCaptureOptions<T, E>) {
    this.options = options
    this.currentLsn = options.startLsn ?? ''
    this.metrics = options.metrics ?? noopMetrics
  }

  async start(): Promise<void> {
    this.running = true
  }

  async stop(): Promise<void> {
    this.running = false
  }

  async getCheckpoint(): Promise<CaptureCheckpoint> {
    return { lsn: this.currentLsn }
  }

  isRunning(): boolean {
    return this.running
  }

  /**
   * Ingest a log entry
   */
  async ingestLogEntry(entry: E): Promise<void> {
    if (!this.running) return

    // Debug callback
    if (this.options.onLogEntry) {
      this.options.onLogEntry(entry)
    }

    const parsed = this.options.parser.parse(entry)

    // Skip entries before start LSN
    if (this.options.startLsn && parsed.lsn && parsed.lsn < this.options.startLsn) {
      return
    }

    const change: CapturedChange<T> = {
      type: parsed.type,
      key: parsed.key,
      before: parsed.before ?? null,
      after: parsed.after ?? null,
      timestamp: parsed.timestamp,
      lsn: parsed.lsn,
      transactionId: parsed.transactionId,
    }

    // Update LSN
    if (parsed.lsn) {
      this.currentLsn = parsed.lsn
    }

    // Group by transaction if enabled
    if (this.options.groupByTransaction && parsed.transactionId) {
      if (!this.pendingTransactions.has(parsed.transactionId)) {
        this.pendingTransactions.set(parsed.transactionId, [])
      }
      this.pendingTransactions.get(parsed.transactionId)!.push(change)
    } else {
      // Direct emission
      await this.options.onChange(change)
    }
  }

  /**
   * Commit a transaction (emit all changes)
   */
  async commitTransaction(transactionId: string): Promise<void> {
    const changes = this.pendingTransactions.get(transactionId)
    if (!changes) return

    if (this.options.onTransaction) {
      await this.options.onTransaction(changes)
    }

    for (const change of changes) {
      await this.options.onChange(change)
    }

    this.pendingTransactions.delete(transactionId)
  }

  /**
   * Rollback a transaction (discard changes)
   */
  async rollbackTransaction(transactionId: string): Promise<void> {
    this.pendingTransactions.delete(transactionId)
  }
}

/**
 * Create a log-based capture adapter
 */
export function createLogCapture<T, E = unknown>(
  options: LogCaptureOptions<T, E>
): LogCapture<T, E> {
  return new LogCapture(options)
}

// ============================================================================
// EVENT CAPTURE (Event Stream Consumption)
// ============================================================================

/** Event to change mapper */
export interface EventMapper<T, E = unknown> {
  (event: E): {
    type: ChangeType
    key: string
    before?: T | null
    after?: T | null
    timestamp: number
    eventId?: string
    partition?: string
    offset?: number
  }
}

/** Options for event capture */
export interface EventCaptureOptions<T, E = unknown> {
  /** Event to change mapper */
  eventMapper: EventMapper<T, E>
  /** Handler for captured changes */
  onChange: CaptureChangeHandler<T>
  /** Handler for errors */
  onError?: CaptureErrorHandler
  /** Allow out-of-order events */
  allowOutOfOrder?: boolean
  /** Deduplicate by event ID */
  deduplicate?: boolean
  /** Maintain order within partitions */
  orderedWithinPartition?: boolean
  /** Maximum buffer size for backpressure */
  maxBufferSize?: number
  /** Metrics collector */
  metrics?: MetricsCollector
}

/**
 * Event stream-based change capture
 * Consumes events from Kafka-style streams
 */
export class EventCapture<T, E = unknown> implements CaptureAdapter<T> {
  private options: EventCaptureOptions<T, E>
  private running: boolean = false
  private partitionOffsets: Map<string, number> = new Map()
  private processedEventIds: Set<string> = new Set()
  private buffer: Array<{ event: E; resolve: () => void }> = []
  private processing: boolean = false
  private metrics: MetricsCollector

  constructor(options: EventCaptureOptions<T, E>) {
    this.options = options
    this.metrics = options.metrics ?? noopMetrics
  }

  async start(): Promise<void> {
    this.running = true
    this.processBuffer()
  }

  async stop(): Promise<void> {
    this.running = false
    // Drain buffer
    while (this.buffer.length > 0) {
      await this.processNextFromBuffer()
    }
  }

  async getCheckpoint(): Promise<CaptureCheckpoint> {
    const offsets: Record<string, number> = {}
    for (const [partition, offset] of this.partitionOffsets) {
      offsets[partition] = offset
    }
    return { partitionOffsets: offsets }
  }

  isRunning(): boolean {
    return this.running
  }

  /**
   * Ingest an event
   */
  async ingestEvent(event: E): Promise<void> {
    const maxBuffer = this.options.maxBufferSize ?? 1000

    // Backpressure: wait if buffer is full
    while (this.buffer.length >= maxBuffer) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    return new Promise((resolve) => {
      this.buffer.push({ event, resolve })
      this.processBuffer()
    })
  }

  private async processBuffer(): Promise<void> {
    if (this.processing || !this.running) return
    this.processing = true

    try {
      while (this.buffer.length > 0 && this.running) {
        await this.processNextFromBuffer()
      }
    } finally {
      this.processing = false
    }
  }

  private async processNextFromBuffer(): Promise<void> {
    const item = this.buffer.shift()
    if (!item) return

    try {
      await this.processEvent(item.event)
    } finally {
      item.resolve()
    }
  }

  private async processEvent(event: E): Promise<void> {
    const mapped = this.options.eventMapper(event)

    // Deduplicate by event ID
    if (this.options.deduplicate && mapped.eventId) {
      if (this.processedEventIds.has(mapped.eventId)) {
        return
      }
      this.processedEventIds.add(mapped.eventId)
    }

    const change: CapturedChange<T> = {
      type: mapped.type,
      key: mapped.key,
      before: mapped.before ?? null,
      after: mapped.after ?? null,
      timestamp: mapped.timestamp,
      eventId: mapped.eventId,
      partition: mapped.partition,
      offset: mapped.offset,
    }

    // Track partition offset
    if (mapped.partition !== undefined && mapped.offset !== undefined) {
      this.partitionOffsets.set(mapped.partition, mapped.offset)
    }

    await this.options.onChange(change)
  }
}

/**
 * Create an event stream-based capture adapter
 */
export function createEventCapture<T, E = unknown>(
  options: EventCaptureOptions<T, E>
): EventCapture<T, E> {
  return new EventCapture(options)
}
