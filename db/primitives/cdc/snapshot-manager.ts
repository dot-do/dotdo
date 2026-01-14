/**
 * SnapshotManager - Initial snapshot capture with consistent cutover
 *
 * Provides:
 * - Chunk-based table scanning for large tables
 * - WAL position capture before snapshot for consistent cutover
 * - Synthetic INSERT events for snapshot records
 * - Resumable snapshots for crash recovery
 * - Memory-bounded streaming with backpressure
 *
 * @see https://debezium.io/documentation/reference/stable/connectors/postgresql.html#postgresql-snapshots
 */

import { ChangeType } from './stream'

// ============================================================================
// TYPES
// ============================================================================

/** Snapshot phase states */
export enum SnapshotPhase {
  PENDING = 'PENDING',
  INITIALIZING = 'INITIALIZING',
  SCANNING = 'SCANNING',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/** Snapshot event emitted for each record */
export interface SnapshotEvent<T> {
  /** Change type - always INSERT for snapshots */
  type: ChangeType.INSERT
  /** The record being snapshotted */
  record: T
  /** Null for INSERT */
  before: null
  /** Same as record */
  after: T
  /** Table name */
  table: string
  /** Monotonically increasing sequence number */
  sequence: number
  /** Timestamp when event was created */
  timestamp: number
  /** Flag indicating this is a snapshot record */
  isSnapshot: true
}

/** Interface for scanning table chunks */
export interface TableScanner<T> {
  /** Get the table name */
  getTableName(): string
  /** Get total row count (estimate is acceptable) */
  getRowCount(): Promise<number>
  /** Get primary key for a record */
  getPrimaryKey(record: T): string
  /** Scan a chunk of records starting from cursor */
  scanChunk(
    cursor: string | null,
    chunkSize: number
  ): Promise<{
    records: T[]
    nextCursor: string | null
    hasMore: boolean
  }>
}

/** Snapshot state for persistence and recovery */
export interface SnapshotState {
  /** Current phase */
  phase: SnapshotPhase
  /** Table being snapshotted */
  tableName: string
  /** Current cursor position */
  cursor: string | null
  /** Number of rows processed */
  rowsProcessed: number
  /** Total rows (estimate) */
  totalRows: number
  /** Chunks completed */
  chunksCompleted: number
  /** WAL position at snapshot start */
  walPositionAtStart: string | null
  /** Timestamp when snapshot started */
  startedAt: number
  /** Timestamp when snapshot completed */
  completedAt?: number
  /** Record IDs for deduplication */
  processedRecordIds?: string[]
  /** Error message if failed */
  error?: string
}

/** Progress information */
export interface SnapshotProgress {
  /** Current phase */
  phase: SnapshotPhase
  /** Rows processed */
  rowsProcessed: number
  /** Total rows */
  totalRows: number
  /** Percent complete */
  percentComplete: number
  /** Chunks completed */
  chunksCompleted: number
  /** Current chunk number */
  currentChunk: number
  /** Rows per second */
  rowsPerSecond: number
  /** Estimated time remaining (ms) */
  estimatedRemainingMs: number
}

/** Chunk completion info */
export interface ChunkInfo {
  chunkNumber: number
  recordsInChunk: number
  totalProcessed: number
  cursor: string | null
  hasMore: boolean
}

/** Cutover information */
export interface CutoverInfo {
  /** WAL position at snapshot start */
  walPositionAtStart: string | null
  /** When snapshot completed */
  snapshotCompleteAt: number
  /** Total rows in snapshot */
  totalRowsSnapshot: number
  /** Last sequence number */
  lastSequence: number
}

/** Snapshot statistics */
export interface SnapshotStats {
  /** Total rows processed */
  totalRows: number
  /** Total chunks processed */
  totalChunks: number
  /** Duration in ms */
  durationMs: number
  /** Average rows per second */
  avgRowsPerSecond: number
  /** Peak in-flight records */
  peakInFlightRecords: number
}

/** Handler for snapshot events */
export type SnapshotEventHandler<T> = (event: SnapshotEvent<T>) => Promise<void>

/** Handler for chunk completion */
export type ChunkCompleteHandler = (info: ChunkInfo) => Promise<void>

/** Handler for state changes */
export type StateChangeHandler = (state: SnapshotState) => Promise<void>

/** Handler for progress */
export type ProgressHandler = (progress: SnapshotProgress) => Promise<void>

/** Handler for errors */
export type ErrorHandler = (error: Error) => Promise<void>

/** Options for creating a SnapshotManager */
export interface SnapshotOptions<T> {
  /** Table scanner */
  scanner: TableScanner<T>
  /** Chunk size (records per batch) */
  chunkSize: number
  /** Maximum in-flight records for backpressure */
  maxInFlightRecords?: number
  /** WAL position at snapshot start */
  initialWalPosition?: string
  /** Track record IDs for deduplication */
  trackRecordIds?: boolean
  /** Resume from saved state */
  resumeFrom?: SnapshotState
  /** Retry attempts for transient errors */
  retryAttempts?: number
  /** Delay between retries (ms) */
  retryDelayMs?: number
  /** Handler for snapshot events */
  onSnapshot: SnapshotEventHandler<T>
  /** Handler for chunk completion */
  onChunkComplete?: ChunkCompleteHandler
  /** Handler for state changes */
  onStateChange?: StateChangeHandler
  /** Handler for progress updates */
  onProgress?: ProgressHandler
  /** Handler for errors */
  onError?: ErrorHandler
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * SnapshotManager - Captures initial table state with consistent cutover
 */
export class SnapshotManager<T> {
  private options: SnapshotOptions<T>
  private state: SnapshotState
  private snapshotRecordIds: Set<string> = new Set()
  private currentSequence: number = 0
  private inFlightCount: number = 0
  private peakInFlightCount: number = 0
  private startTime: number = 0
  private completionPromise: Promise<void> | null = null
  private completionResolve: (() => void) | null = null
  private completionReject: ((err: Error) => void) | null = null
  private isProcessing: boolean = false
  private isPaused: boolean = false
  private isCancelled: boolean = false

  constructor(options: SnapshotOptions<T>) {
    this.options = options

    // Initialize state from resume point or fresh
    if (options.resumeFrom) {
      this.state = { ...options.resumeFrom }
      // Restore processed record IDs
      if (options.resumeFrom.processedRecordIds) {
        this.snapshotRecordIds = new Set(options.resumeFrom.processedRecordIds)
      }
      this.currentSequence = options.resumeFrom.rowsProcessed
    } else {
      this.state = {
        phase: SnapshotPhase.PENDING,
        tableName: options.scanner.getTableName(),
        cursor: null,
        rowsProcessed: 0,
        totalRows: 0,
        chunksCompleted: 0,
        walPositionAtStart: options.initialWalPosition ?? null,
        startedAt: 0,
      }
    }
  }

  // ============================================================================
  // PUBLIC API - Lifecycle
  // ============================================================================

  /**
   * Start the snapshot process
   */
  async start(): Promise<void> {
    if (this.isProcessing) {
      throw new Error('Snapshot already started')
    }

    this.isProcessing = true
    this.startTime = Date.now()
    this.state.startedAt = this.state.startedAt || this.startTime

    // Create completion promise
    this.completionPromise = new Promise((resolve, reject) => {
      this.completionResolve = resolve
      this.completionReject = reject
    })

    // Start processing in background
    this.processSnapshot().catch((err) => {
      this.completionReject?.(err)
    })
  }

  /**
   * Wait for snapshot to complete
   */
  async waitForCompletion(): Promise<void> {
    if (!this.completionPromise) {
      throw new Error('Snapshot not started')
    }
    return this.completionPromise
  }

  /**
   * Pause the snapshot
   */
  async pause(): Promise<void> {
    this.isPaused = true
    this.state.phase = SnapshotPhase.PAUSED
    await this.notifyStateChange()
  }

  /**
   * Resume a paused snapshot
   */
  async resume(): Promise<void> {
    if (this.state.phase !== SnapshotPhase.PAUSED) {
      return
    }
    this.isPaused = false
    this.state.phase = SnapshotPhase.SCANNING
    await this.notifyStateChange()
  }

  /**
   * Cancel the snapshot
   */
  async cancel(): Promise<void> {
    this.isCancelled = true
    this.state.phase = SnapshotPhase.CANCELLED
    await this.notifyStateChange()
    this.completionResolve?.()
  }

  // ============================================================================
  // PUBLIC API - State & Progress
  // ============================================================================

  /**
   * Get current snapshot state
   */
  getState(): SnapshotState {
    return {
      ...this.state,
      processedRecordIds: this.options.trackRecordIds
        ? Array.from(this.snapshotRecordIds)
        : undefined,
    }
  }

  /**
   * Get current progress
   */
  getProgress(): SnapshotProgress {
    const elapsed = Date.now() - this.startTime
    const rowsPerSecond = elapsed > 0 ? (this.state.rowsProcessed / elapsed) * 1000 : 0
    const remaining = this.state.totalRows - this.state.rowsProcessed
    const estimatedRemainingMs = rowsPerSecond > 0 ? (remaining / rowsPerSecond) * 1000 : 0

    return {
      phase: this.state.phase,
      rowsProcessed: this.state.rowsProcessed,
      totalRows: this.state.totalRows,
      percentComplete:
        this.state.totalRows > 0
          ? Math.round((this.state.rowsProcessed / this.state.totalRows) * 100)
          : this.state.phase === SnapshotPhase.COMPLETED
            ? 100
            : 0,
      chunksCompleted: this.state.chunksCompleted,
      currentChunk: this.state.chunksCompleted + 1,
      rowsPerSecond: Math.round(rowsPerSecond),
      estimatedRemainingMs: Math.round(estimatedRemainingMs),
    }
  }

  /**
   * Get cutover information after completion
   */
  getCutoverInfo(): CutoverInfo | null {
    if (this.state.phase !== SnapshotPhase.COMPLETED) {
      return null
    }
    return {
      walPositionAtStart: this.state.walPositionAtStart,
      snapshotCompleteAt: this.state.completedAt!,
      totalRowsSnapshot: this.state.rowsProcessed,
      lastSequence: this.currentSequence,
    }
  }

  /**
   * Get snapshot statistics
   */
  getStats(): SnapshotStats {
    const durationMs = (this.state.completedAt ?? Date.now()) - this.state.startedAt
    return {
      totalRows: this.state.rowsProcessed,
      totalChunks: this.state.chunksCompleted,
      durationMs,
      avgRowsPerSecond: durationMs > 0 ? (this.state.rowsProcessed / durationMs) * 1000 : 0,
      peakInFlightRecords: this.peakInFlightCount,
    }
  }

  // ============================================================================
  // PUBLIC API - Deduplication
  // ============================================================================

  /**
   * Get set of snapshotted record IDs
   */
  getSnapshotRecordIds(): Set<string> {
    return new Set(this.snapshotRecordIds)
  }

  /**
   * Check if a record was included in the snapshot
   */
  wasRecordSnapshotted(recordId: string): boolean {
    return this.snapshotRecordIds.has(recordId)
  }

  /**
   * Determine if a live event should be filtered based on snapshot state
   * Returns true if the event should be filtered (i.e., not processed)
   */
  shouldFilterLiveEvent(recordId: string, lsn: string): boolean {
    // If record was in snapshot, filter events with LSN <= snapshot start
    // (those changes are already captured in the snapshot)
    if (this.snapshotRecordIds.has(recordId)) {
      // Simple string comparison for LSN - assumes lexicographic ordering
      if (this.state.walPositionAtStart && lsn <= this.state.walPositionAtStart) {
        return true
      }
      // For events after snapshot started but record was snapshotted,
      // we filter to let the snapshot version take precedence
      return true
    }
    return false
  }

  // ============================================================================
  // PRIVATE - Processing
  // ============================================================================

  private async processSnapshot(): Promise<void> {
    try {
      // Initialize phase
      this.state.phase = SnapshotPhase.INITIALIZING
      await this.notifyStateChange()

      // Get total row count
      this.state.totalRows = await this.options.scanner.getRowCount()
      await this.notifyProgress()

      // Start scanning
      this.state.phase = SnapshotPhase.SCANNING
      await this.notifyStateChange()

      // Process chunks
      let hasMore = true
      while (hasMore && !this.isCancelled) {
        // Wait if paused
        while (this.isPaused && !this.isCancelled) {
          await this.delay(100)
        }

        if (this.isCancelled) break

        // Scan next chunk with retry
        const result = await this.scanChunkWithRetry()

        if (result.records.length > 0) {
          // Process records with backpressure
          await this.processRecords(result.records)

          // Update state
          this.state.cursor = result.nextCursor
          this.state.chunksCompleted++
          await this.notifyStateChange()

          // Notify chunk complete
          if (this.options.onChunkComplete) {
            await this.options.onChunkComplete({
              chunkNumber: this.state.chunksCompleted,
              recordsInChunk: result.records.length,
              totalProcessed: this.state.rowsProcessed,
              cursor: result.nextCursor,
              hasMore: result.hasMore,
            })
          }

          await this.notifyProgress()
        }

        hasMore = result.hasMore
      }

      // Complete
      if (!this.isCancelled) {
        this.state.phase = SnapshotPhase.COMPLETED
        this.state.completedAt = Date.now()
        await this.notifyStateChange()
        await this.notifyProgress()
      }

      this.completionResolve?.()
    } catch (error) {
      this.state.phase = SnapshotPhase.FAILED
      this.state.error = (error as Error).message
      await this.notifyStateChange()
      if (this.options.onError) {
        await this.options.onError(error as Error)
      }
      this.completionReject?.(error as Error)
    }
  }

  private async scanChunkWithRetry(): Promise<{
    records: T[]
    nextCursor: string | null
    hasMore: boolean
  }> {
    const maxAttempts = this.options.retryAttempts ?? 1
    const delayMs = this.options.retryDelayMs ?? 1000
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.options.scanner.scanChunk(this.state.cursor, this.options.chunkSize)
      } catch (error) {
        lastError = error as Error
        if (attempt < maxAttempts - 1) {
          await this.delay(delayMs * (attempt + 1))
        }
      }
    }

    throw lastError
  }

  private async processRecords(records: T[]): Promise<void> {
    const maxInFlight = this.options.maxInFlightRecords ?? Number.MAX_SAFE_INTEGER
    const promises: Promise<void>[] = []

    for (const record of records) {
      // Apply backpressure
      while (this.inFlightCount >= maxInFlight) {
        await this.delay(1)
      }

      this.inFlightCount++
      this.peakInFlightCount = Math.max(this.peakInFlightCount, this.inFlightCount)

      const recordId = this.options.scanner.getPrimaryKey(record)
      this.currentSequence++

      // Track record ID if enabled
      if (this.options.trackRecordIds) {
        this.snapshotRecordIds.add(recordId)
      }

      // Create snapshot event
      const event: SnapshotEvent<T> = {
        type: ChangeType.INSERT,
        record,
        before: null,
        after: record,
        table: this.state.tableName,
        sequence: this.currentSequence,
        timestamp: Date.now(),
        isSnapshot: true,
      }

      // Process event
      const promise = this.options
        .onSnapshot(event)
        .then(() => {
          this.state.rowsProcessed++
        })
        .finally(() => {
          this.inFlightCount--
        })

      promises.push(promise)
    }

    // Wait for all records in chunk to complete
    await Promise.all(promises)
  }

  // ============================================================================
  // PRIVATE - Helpers
  // ============================================================================

  private async notifyStateChange(): Promise<void> {
    if (this.options.onStateChange) {
      await this.options.onStateChange(this.getState())
    }
  }

  private async notifyProgress(): Promise<void> {
    if (this.options.onProgress) {
      await this.options.onProgress(this.getProgress())
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new SnapshotManager
 */
export function createSnapshotManager<T>(options: SnapshotOptions<T>): SnapshotManager<T> {
  return new SnapshotManager<T>(options)
}
