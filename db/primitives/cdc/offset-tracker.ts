/**
 * OffsetTracker - Persistent tracking of stream position
 *
 * Provides durable offset tracking for CDC streams with support for:
 * - Database-specific offset formats (LSN, GTID, rowid, timestamp)
 * - Periodic and event-driven checkpointing
 * - Multi-partition offset coordination
 * - Exactly-once semantics via event deduplication
 * - Recovery from various failure points
 *
 * @see https://debezium.io/documentation/reference/stable/connectors/
 */

import { createTemporalStore, type TemporalStore } from '../temporal-store'
import { type MetricsCollector, noopMetrics } from '../observability'

// ============================================================================
// TYPES
// ============================================================================

/** Supported offset formats */
export type OffsetFormat = 'numeric' | 'lsn' | 'gtid' | 'rowid' | 'timestamp'

/** Offset value - can be number, bigint, or string depending on format */
export type OffsetValue = number | bigint | string

/** Offset representation */
export interface Offset {
  value: OffsetValue
  format: OffsetFormat
}

/** Partition offset tracking */
export interface PartitionOffset {
  partition: string
  offset: Offset
  committedAt?: number
}

/** Event for tracking */
export interface TrackedEvent {
  id: string
  timestamp?: number
}

/** Checkpoint configuration types */
export type CheckpointType = 'count' | 'time' | 'manual' | 'combined' | 'event-driven'

/** Checkpoint configuration */
export interface CheckpointConfig {
  type: CheckpointType
  /** Event count interval for count/combined checkpointing */
  interval?: number
  /** Time interval in ms for time/combined checkpointing */
  intervalMs?: number
  /** Events that trigger checkpoint for event-driven mode */
  triggerEvents?: string[]
}

/** Commit options */
export interface CommitOptions {
  /** Require specific partitions to be set before commit */
  requireAllPartitions?: string[]
}

/** Deduplication retention configuration */
export interface DeduplicationRetention {
  /** Maximum number of event IDs to retain */
  maxCount?: number
  /** Maximum age in milliseconds */
  maxAgeMs?: number
}

/** OffsetTracker statistics */
export interface OffsetTrackerStats {
  checkpointCount: number
  eventsSinceLastCheckpoint: number
  lastCheckpointLatencyMs: number
  timeSinceLastCheckpointMs: number
  processedEventCount: number
}

/** Checkpoint state for persistence and recovery */
export interface OffsetCheckpointState {
  offset: Offset | null
  partitionOffsets: PartitionOffset[]
  committedAt: number
  processedEventIds: string[]
  pendingEvents: TrackedEvent[]
  version: number
  metadata?: Record<string, unknown>
}

/** Checkpoint ID type */
export type CheckpointId = string

/** Options for creating an OffsetTracker */
export interface OffsetTrackerOptions {
  /** Default offset format */
  format?: OffsetFormat
  /** Enable multi-partition tracking */
  multiPartition?: boolean
  /** Keep offset history in temporal store */
  keepHistory?: boolean
  /** Enable event deduplication */
  enableDeduplication?: boolean
  /** Checkpoint configuration */
  checkpoint?: CheckpointConfig
  /** Callback on checkpoint */
  onCheckpoint?: () => void
  /** Deduplication retention settings */
  deduplicationRetention?: DeduplicationRetention
  /** Commit strategy for multi-partition */
  commitStrategy?: 'any-partition' | 'all-partitions'
  /** Metrics collector */
  metrics?: MetricsCollector
}

// ============================================================================
// LSN/GTID UTILITIES
// ============================================================================

/**
 * Parse PostgreSQL LSN format (e.g., "0/16B3740")
 */
function parseLSN(lsn: string): bigint {
  const [segment, offset] = lsn.split('/')
  if (!segment || !offset) throw new Error(`Invalid LSN format: ${lsn}`)
  const segmentNum = BigInt(parseInt(segment, 10))
  const offsetNum = BigInt(parseInt(offset, 16))
  return (segmentNum << 32n) | offsetNum
}

/**
 * Format number to LSN string
 */
function formatLSN(value: bigint | number): string {
  const bigValue = typeof value === 'bigint' ? value : BigInt(value)
  const segment = Number(bigValue >> 32n)
  const offset = Number(bigValue & 0xffffffffn)
  return `${segment}/${offset.toString(16).toUpperCase()}`
}

/**
 * Validate LSN format
 */
function isValidLSN(value: string): boolean {
  return /^\d+\/[A-Fa-f0-9]+$/.test(value)
}

/**
 * Parse MySQL GTID format (e.g., "3E11FA47-71CA-11E1-9E33-C80AA9429562:1-5")
 */
function parseGTID(gtid: string): { uuid: string; range: [number, number] } {
  const match = gtid.match(/^([A-Fa-f0-9-]+):(\d+)-(\d+)$/)
  if (!match) throw new Error(`Invalid GTID format: ${gtid}`)
  return {
    uuid: match[1]!,
    range: [parseInt(match[2]!, 10), parseInt(match[3]!, 10)],
  }
}

/**
 * Validate GTID format
 */
function isValidGTID(value: string): boolean {
  return /^[A-Fa-f0-9-]+:\d+-\d+$/.test(value)
}

/**
 * Compare two GTID values (same UUID)
 */
function compareGTIDs(a: string, b: string): number {
  const gtidA = parseGTID(a)
  const gtidB = parseGTID(b)
  // Compare by the end of the range (transaction count)
  return gtidA.range[1] - gtidB.range[1]
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * OffsetTracker - Persistent stream position tracking
 */
export class OffsetTracker {
  private options: OffsetTrackerOptions
  private currentOffset: Offset | null = null
  private committedOffset: Offset | null = null
  private partitionOffsets: Map<string, { offset: Offset; committed: boolean }> = new Map()
  private highWatermarks: Map<string, number> = new Map()
  private temporalStore: TemporalStore<Offset> | null = null
  private processedEventIds: Set<string> = new Set()
  private pendingEvents: TrackedEvent[] = []
  private checkpoints: Map<CheckpointId, OffsetCheckpointState> = new Map()
  private checkpointCounter: number = 0
  private eventCounter: number = 0
  private eventsSinceCheckpoint: number = 0
  private checkpointTimer: ReturnType<typeof setInterval> | null = null
  private running: boolean = false
  private metrics: MetricsCollector
  private lastCheckpointTime: number = 0
  private lastCheckpointLatency: number = 0

  constructor(options?: OffsetTrackerOptions) {
    this.options = options ?? {}
    this.metrics = options?.metrics ?? noopMetrics

    if (options?.keepHistory) {
      this.temporalStore = createTemporalStore<Offset>()
    }
  }

  // ============================================================================
  // OFFSET MANAGEMENT
  // ============================================================================

  /**
   * Set the current offset
   */
  async setOffset(offset: Offset): Promise<void> {
    this.currentOffset = offset

    if (this.temporalStore) {
      await this.temporalStore.put('offset', offset, Date.now())
    }
  }

  /**
   * Get the current offset (may be uncommitted)
   */
  async getCurrentOffset(): Promise<Offset | null> {
    return this.committedOffset
  }

  /**
   * Get offset as of a specific timestamp (requires keepHistory)
   */
  async getOffsetAsOf(timestamp: number): Promise<Offset | null> {
    if (!this.temporalStore) {
      throw new Error('keepHistory must be enabled to use getOffsetAsOf')
    }
    return this.temporalStore.getAsOf('offset', timestamp)
  }

  // ============================================================================
  // PARTITION OFFSET MANAGEMENT
  // ============================================================================

  /**
   * Set offset for a specific partition
   */
  async setPartitionOffset(partition: string, offset: Offset): Promise<void> {
    this.partitionOffsets.set(partition, { offset, committed: false })
  }

  /**
   * Get offset for a specific partition
   */
  async getPartitionOffset(partition: string): Promise<Offset | null> {
    const entry = this.partitionOffsets.get(partition)
    return entry?.committed ? entry.offset : null
  }

  /**
   * Get all partition offsets
   */
  async getAllPartitionOffsets(): Promise<PartitionOffset[]> {
    const result: PartitionOffset[] = []
    for (const [partition, { offset, committed }] of this.partitionOffsets) {
      if (committed) {
        result.push({ partition, offset })
      }
    }
    return result
  }

  /**
   * Commit a specific partition
   */
  async commitPartition(partition: string): Promise<void> {
    const entry = this.partitionOffsets.get(partition)
    if (entry) {
      entry.committed = true
      this.partitionOffsets.set(partition, entry)
    }
  }

  /**
   * Remove a partition (for rebalancing)
   */
  async removePartition(partition: string): Promise<void> {
    this.partitionOffsets.delete(partition)
    this.highWatermarks.delete(partition)
  }

  /**
   * Get the minimum offset across all partitions
   */
  async getMinPartitionOffset(): Promise<PartitionOffset | null> {
    let minPartition: PartitionOffset | null = null

    for (const [partition, { offset, committed }] of this.partitionOffsets) {
      if (!committed) continue

      if (!minPartition || this.compareOffsets(offset, minPartition.offset) < 0) {
        minPartition = { partition, offset }
      }
    }

    return minPartition
  }

  /**
   * Set high watermark for a partition (latest available offset)
   */
  async setHighWatermark(partition: string, watermark: number): Promise<void> {
    this.highWatermarks.set(partition, watermark)
  }

  /**
   * Get partition lag (difference between current offset and high watermark)
   */
  async getPartitionLag(): Promise<Map<string, number>> {
    const lag = new Map<string, number>()

    for (const [partition, { offset, committed }] of this.partitionOffsets) {
      if (!committed) continue

      const watermark = this.highWatermarks.get(partition)
      if (watermark !== undefined && typeof offset.value === 'number') {
        lag.set(partition, watermark - (offset.value as number))
      }
    }

    return lag
  }

  // ============================================================================
  // CHECKPOINTING
  // ============================================================================

  /**
   * Commit the current offset
   */
  async commit(options?: CommitOptions): Promise<CheckpointId> {
    const startTime = performance.now()

    // Check required partitions if multi-partition
    if (options?.requireAllPartitions) {
      for (const partition of options.requireAllPartitions) {
        const entry = this.partitionOffsets.get(partition)
        if (!entry) {
          throw new Error(`Missing partition: ${partition}`)
        }
      }
    }

    // Commit current offset
    this.committedOffset = this.currentOffset

    // Commit all partition offsets
    for (const [partition, entry] of this.partitionOffsets) {
      entry.committed = true
      this.partitionOffsets.set(partition, entry)
    }

    // Generate checkpoint ID
    const checkpointId: CheckpointId = `ckpt-${++this.checkpointCounter}-${Date.now()}`

    // Store checkpoint
    const checkpoint = await this.getCheckpointState()
    this.checkpoints.set(checkpointId, checkpoint)

    // Reset event counter
    this.eventsSinceCheckpoint = 0

    // Update timing
    this.lastCheckpointLatency = performance.now() - startTime
    this.lastCheckpointTime = Date.now()

    // Clear pending events after checkpoint
    this.pendingEvents = []

    // Call checkpoint callback
    if (this.options.onCheckpoint) {
      this.options.onCheckpoint()
    }

    return checkpointId
  }

  /**
   * Get checkpoint state for persistence
   */
  async getCheckpointState(): Promise<OffsetCheckpointState> {
    const partitionOffsets: PartitionOffset[] = []
    for (const [partition, { offset, committed }] of this.partitionOffsets) {
      if (committed) {
        partitionOffsets.push({ partition, offset, committedAt: Date.now() })
      }
    }

    return {
      offset: this.committedOffset,
      partitionOffsets,
      committedAt: Date.now(),
      processedEventIds: Array.from(this.processedEventIds),
      pendingEvents: [...this.pendingEvents],
      version: 1,
    }
  }

  /**
   * Restore from checkpoint state
   */
  async restoreFromCheckpoint(state: OffsetCheckpointState): Promise<void> {
    // Validate checkpoint
    if (!this.validateCheckpointInternal(state)) {
      throw new Error('Invalid checkpoint: missing required fields')
    }

    // Restore offset
    this.committedOffset = state.offset
    this.currentOffset = state.offset

    // Restore partition offsets
    this.partitionOffsets.clear()
    for (const po of state.partitionOffsets) {
      this.partitionOffsets.set(po.partition, { offset: po.offset, committed: true })
    }

    // Restore processed event IDs
    this.processedEventIds = new Set(state.processedEventIds)

    // Restore pending events
    this.pendingEvents = [...state.pendingEvents]

    // Reset counters
    this.eventsSinceCheckpoint = 0
  }

  /**
   * Validate a checkpoint before restoration
   */
  async validateCheckpoint(checkpoint: OffsetCheckpointState): Promise<boolean> {
    return this.validateCheckpointInternal(checkpoint)
  }

  private validateCheckpointInternal(checkpoint: OffsetCheckpointState): boolean {
    if (!checkpoint || typeof checkpoint !== 'object') return false
    if (typeof checkpoint.committedAt !== 'number') return false
    if (!Array.isArray(checkpoint.partitionOffsets)) return false
    if (!Array.isArray(checkpoint.processedEventIds)) return false
    return true
  }

  /**
   * Rollback to a specific checkpoint
   */
  async rollbackToCheckpoint(checkpointId: CheckpointId): Promise<void> {
    const checkpoint = this.checkpoints.get(checkpointId)
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`)
    }
    await this.restoreFromCheckpoint(checkpoint)
  }

  /**
   * Get pending events since last checkpoint (for replay)
   */
  async getPendingEventsSinceCheckpoint(): Promise<TrackedEvent[]> {
    return [...this.pendingEvents]
  }

  // ============================================================================
  // EVENT TRACKING
  // ============================================================================

  /**
   * Record an event (for checkpoint counting and pending tracking)
   */
  async recordEvent(event?: TrackedEvent): Promise<void> {
    this.eventCounter++
    this.eventsSinceCheckpoint++

    if (event) {
      this.pendingEvents.push(event)
    }

    // Check count-based checkpoint trigger
    const config = this.options.checkpoint
    if (config && (config.type === 'count' || config.type === 'combined')) {
      if (config.interval && this.eventsSinceCheckpoint >= config.interval) {
        await this.commit()
      }
    }
  }

  /**
   * Trigger checkpoint on specific event type
   */
  async triggerCheckpointEvent(eventType: string): Promise<void> {
    const config = this.options.checkpoint
    if (config?.type === 'event-driven' && config.triggerEvents?.includes(eventType)) {
      await this.commit()
    }
  }

  // ============================================================================
  // DEDUPLICATION
  // ============================================================================

  /**
   * Record a processed event ID for deduplication
   */
  async recordProcessedEvent(eventId: string): Promise<void> {
    if (!this.options.enableDeduplication) return

    this.processedEventIds.add(eventId)

    // Apply retention if configured
    const retention = this.options.deduplicationRetention
    if (retention?.maxCount && this.processedEventIds.size > retention.maxCount) {
      // Remove oldest entries (FIFO)
      const ids = Array.from(this.processedEventIds)
      const toRemove = ids.slice(0, ids.length - retention.maxCount)
      for (const id of toRemove) {
        this.processedEventIds.delete(id)
      }
    }
  }

  /**
   * Check if an event has been processed
   */
  async isEventProcessed(eventId: string): Promise<boolean> {
    return this.processedEventIds.has(eventId)
  }

  // ============================================================================
  // OFFSET FORMAT CONVERSION
  // ============================================================================

  /**
   * Convert offset between formats
   */
  convertOffset(offset: Offset, targetFormat: OffsetFormat): Offset {
    if (offset.format === targetFormat) {
      return { ...offset }
    }

    // Convert to numeric as intermediate
    let numericValue: bigint

    switch (offset.format) {
      case 'numeric':
      case 'rowid':
      case 'timestamp':
        numericValue = BigInt(offset.value as number | bigint)
        break
      case 'lsn':
        numericValue = parseLSN(offset.value as string)
        break
      case 'gtid':
        // For GTID, we extract the transaction count from the range
        const gtid = parseGTID(offset.value as string)
        numericValue = BigInt(gtid.range[1])
        break
      default:
        throw new Error(`Unsupported source format: ${offset.format}`)
    }

    // Convert from numeric to target
    switch (targetFormat) {
      case 'numeric':
      case 'rowid':
      case 'timestamp':
        return { value: Number(numericValue), format: targetFormat }
      case 'lsn':
        return { value: formatLSN(numericValue), format: 'lsn' }
      case 'gtid':
        throw new Error('Cannot convert to GTID format')
      default:
        throw new Error(`Unsupported target format: ${targetFormat}`)
    }
  }

  /**
   * Compare two offsets of the same format
   */
  compareOffsets(a: Offset, b: Offset): number {
    if (a.format !== b.format) {
      throw new Error(`Cannot compare offsets of different formats: ${a.format} vs ${b.format}`)
    }

    switch (a.format) {
      case 'numeric':
      case 'rowid':
      case 'timestamp':
        const numA = typeof a.value === 'bigint' ? a.value : BigInt(a.value as number)
        const numB = typeof b.value === 'bigint' ? b.value : BigInt(b.value as number)
        return numA < numB ? -1 : numA > numB ? 1 : 0

      case 'lsn':
        const lsnA = parseLSN(a.value as string)
        const lsnB = parseLSN(b.value as string)
        return lsnA < lsnB ? -1 : lsnA > lsnB ? 1 : 0

      case 'gtid':
        return compareGTIDs(a.value as string, b.value as string)

      default:
        throw new Error(`Unsupported format: ${a.format}`)
    }
  }

  /**
   * Compare offsets after normalizing to a common format
   */
  compareOffsetsNormalized(a: Offset, b: Offset): number {
    const normalizedA = this.convertOffset(a, 'numeric')
    const normalizedB = this.convertOffset(b, 'numeric')
    return this.compareOffsets(normalizedA, normalizedB)
  }

  /**
   * Validate an offset value for its format
   */
  isValidOffset(offset: Offset): boolean {
    switch (offset.format) {
      case 'numeric':
      case 'rowid':
      case 'timestamp':
        return (
          typeof offset.value === 'number' ||
          typeof offset.value === 'bigint'
        )

      case 'lsn':
        return typeof offset.value === 'string' && isValidLSN(offset.value)

      case 'gtid':
        return typeof offset.value === 'string' && isValidGTID(offset.value)

      default:
        return false
    }
  }

  /**
   * Parse offset from string representation
   */
  parseOffset(value: string, format: OffsetFormat): Offset {
    switch (format) {
      case 'numeric':
      case 'rowid':
      case 'timestamp':
        return { value: parseInt(value, 10), format }

      case 'lsn':
      case 'gtid':
        return { value, format }

      default:
        throw new Error(`Unsupported format: ${format}`)
    }
  }

  /**
   * Serialize offset to string representation
   */
  serializeOffset(offset: Offset): string {
    if (typeof offset.value === 'bigint') {
      return offset.value.toString()
    }
    return String(offset.value)
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  /**
   * Start the offset tracker (enables time-based checkpointing)
   */
  async start(): Promise<void> {
    this.running = true

    const config = this.options.checkpoint
    if (config && (config.type === 'time' || config.type === 'combined')) {
      if (config.intervalMs) {
        this.checkpointTimer = setInterval(async () => {
          if (this.running && this.currentOffset) {
            await this.commit()
          }
        }, config.intervalMs)
      }
    }
  }

  /**
   * Stop the offset tracker (flushes pending checkpoint)
   */
  async stop(): Promise<void> {
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer)
      this.checkpointTimer = null
    }

    // Commit any pending offset
    if (this.currentOffset) {
      await this.commit()
    }

    this.running = false
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get tracker statistics
   */
  getStats(): OffsetTrackerStats {
    return {
      checkpointCount: this.checkpointCounter,
      eventsSinceLastCheckpoint: this.eventsSinceCheckpoint,
      lastCheckpointLatencyMs: this.lastCheckpointLatency,
      timeSinceLastCheckpointMs: this.lastCheckpointTime > 0
        ? Date.now() - this.lastCheckpointTime
        : 0,
      processedEventCount: this.processedEventIds.size,
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new OffsetTracker instance
 */
export function createOffsetTracker(options?: OffsetTrackerOptions): OffsetTracker {
  return new OffsetTracker(options)
}
