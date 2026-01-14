/**
 * Sync Modes - Connector sync strategies implementation
 *
 * Implements:
 * - Full refresh sync mode (dotdo-alj17)
 * - Incremental sync with cursors (dotdo-w99yl)
 * - CDC sync mode (dotdo-c8tm4)
 *
 * @module db/primitives/connector-framework/sync-modes
 */

import type {
  AirbyteMessage,
  RecordMessage,
  StateMessage,
  LogMessage,
  ConfiguredCatalog,
  SyncState,
  DestinationSyncMode,
} from './index'

// =============================================================================
// Common Types
// =============================================================================

/**
 * Base sync mode configuration
 */
export interface SyncModeConfig {
  streamName: string
  destinationSyncMode?: DestinationSyncMode
}

/**
 * Sync progress tracking
 */
export interface SyncProgress {
  recordsEmitted: number
  bytesEmitted: number
  status: 'running' | 'completed' | 'failed'
  error?: string
  startedAt: number
  completedAt?: number
}

/**
 * Sync checkpoint state
 */
export interface SyncCheckpoint {
  cursor?: string
  lsn?: string
  offset?: number
  snapshotComplete?: boolean
}

// =============================================================================
// Full Refresh Sync Mode (dotdo-alj17)
// =============================================================================

/**
 * Configuration for full refresh sync
 */
export interface FullRefreshConfig extends SyncModeConfig {
  /**
   * Function to fetch all records from the source
   */
  fetchRecords: (cursor?: string) => Promise<Record<string, unknown>[]>

  /**
   * Enable progress logging
   */
  logProgress?: boolean

  /**
   * Log interval (number of records between log messages)
   */
  logInterval?: number

  /**
   * Batch size for batched emission
   */
  batchSize?: number

  /**
   * Callback when a batch is emitted
   */
  onBatchEmit?: (count: number) => void

  /**
   * Enable pagination (fetch will be called multiple times until empty)
   */
  paginate?: boolean
}

/**
 * Full refresh sync mode implementation
 */
export class FullRefreshSync {
  private config: FullRefreshConfig
  private progress: SyncProgress

  constructor(config: FullRefreshConfig) {
    this.config = {
      destinationSyncMode: 'overwrite',
      logProgress: false,
      logInterval: 1000,
      ...config,
    }
    this.progress = {
      recordsEmitted: 0,
      bytesEmitted: 0,
      status: 'running',
      startedAt: Date.now(),
    }
  }

  /**
   * Get the sync configuration
   */
  getConfig(): FullRefreshConfig {
    return this.config
  }

  /**
   * Get current sync progress
   */
  getProgress(): SyncProgress {
    return { ...this.progress }
  }

  /**
   * Read all records from source
   */
  async *read(
    config: Record<string, unknown>,
    catalog: ConfiguredCatalog,
    _state?: SyncState,
  ): AsyncGenerator<AirbyteMessage, void, unknown> {
    try {
      this.progress.status = 'running'
      this.progress.startedAt = Date.now()

      if (this.config.paginate) {
        // Paginated fetch
        yield* this.readPaginated()
      } else {
        // Single fetch
        yield* this.readAll()
      }

      this.progress.status = 'completed'
      this.progress.completedAt = Date.now()
    } catch (error) {
      this.progress.status = 'failed'
      this.progress.error = error instanceof Error ? error.message : String(error)
      this.progress.completedAt = Date.now()
      throw error
    }
  }

  private async *readAll(): AsyncGenerator<AirbyteMessage, void, unknown> {
    const records = await this.config.fetchRecords()
    yield* this.emitRecords(records)
  }

  private async *readPaginated(): AsyncGenerator<AirbyteMessage, void, unknown> {
    let cursor: string | undefined
    let hasMore = true

    while (hasMore) {
      const records = await this.config.fetchRecords(cursor)
      if (records.length === 0) {
        hasMore = false
        break
      }

      yield* this.emitRecords(records)
    }
  }

  private async *emitRecords(
    records: Record<string, unknown>[],
  ): AsyncGenerator<AirbyteMessage, void, unknown> {
    const batchSize = this.config.batchSize
    let batchCount = 0

    for (const record of records) {
      const message: RecordMessage = {
        type: 'RECORD',
        record: {
          stream: this.config.streamName,
          data: record,
          emittedAt: Date.now(),
        },
      }

      yield message
      this.progress.recordsEmitted++
      this.progress.bytesEmitted += JSON.stringify(record).length
      batchCount++

      // Log progress
      if (
        this.config.logProgress &&
        this.progress.recordsEmitted % (this.config.logInterval || 1000) === 0
      ) {
        yield this.createLogMessage('INFO', `Emitted ${this.progress.recordsEmitted} records`)
      }

      // Batch callback
      if (batchSize && batchCount === batchSize) {
        this.config.onBatchEmit?.(batchCount)
        batchCount = 0
      }
    }

    // Final batch callback
    if (batchSize && batchCount > 0) {
      this.config.onBatchEmit?.(batchCount)
    }
  }

  private createLogMessage(level: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL', message: string): LogMessage {
    return {
      type: 'LOG',
      log: { level, message },
    }
  }
}

/**
 * Create a full refresh sync instance
 */
export function createFullRefreshSync(config: FullRefreshConfig): FullRefreshSync {
  return new FullRefreshSync(config)
}

// =============================================================================
// Incremental Sync Mode (dotdo-w99yl)
// =============================================================================

/**
 * Configuration for incremental sync
 */
export interface IncrementalConfig extends SyncModeConfig {
  /**
   * Function to fetch records, optionally filtered by cursor
   */
  fetchRecords: (cursor?: string) => Promise<Record<string, unknown>[]>

  /**
   * Cursor field path (single field or nested path)
   */
  cursorField: string | string[]

  /**
   * Primary key for deduplication
   */
  primaryKey?: string[][]

  /**
   * Checkpoint interval (emit state every N records)
   */
  checkpointInterval?: number

  /**
   * Deduplicate records in source by primary key
   */
  deduplicateInSource?: boolean
}

/**
 * Incremental sync mode implementation
 */
export class IncrementalSync {
  private config: IncrementalConfig
  private progress: SyncProgress

  constructor(config: IncrementalConfig) {
    this.config = {
      destinationSyncMode: 'append',
      checkpointInterval: 1000,
      ...config,
    }
    this.progress = {
      recordsEmitted: 0,
      bytesEmitted: 0,
      status: 'running',
      startedAt: Date.now(),
    }
  }

  /**
   * Get the sync configuration
   */
  getConfig(): IncrementalConfig {
    return this.config
  }

  /**
   * Get current sync progress
   */
  getProgress(): SyncProgress {
    return { ...this.progress }
  }

  /**
   * Read records incrementally from source
   */
  async *read(
    config: Record<string, unknown>,
    catalog: ConfiguredCatalog,
    state?: SyncState,
  ): AsyncGenerator<AirbyteMessage, void, unknown> {
    try {
      this.progress.status = 'running'
      this.progress.startedAt = Date.now()

      // Get cursor from state
      const streamState = state?.streams?.[this.config.streamName]
      const cursor = streamState?.cursor as string | undefined

      // Fetch records since cursor
      let records = await this.config.fetchRecords(cursor)

      // Deduplicate by primary key if enabled
      if (this.config.deduplicateInSource && this.config.primaryKey) {
        records = this.deduplicateRecords(records)
      }

      // Emit records with checkpoints
      let recordCount = 0
      let latestCursor: string | undefined

      for (const record of records) {
        // Extract cursor value
        const cursorValue = this.extractCursorValue(record)
        if (cursorValue) {
          latestCursor = cursorValue
        }

        const message: RecordMessage = {
          type: 'RECORD',
          record: {
            stream: this.config.streamName,
            data: record,
            emittedAt: Date.now(),
          },
        }

        yield message
        this.progress.recordsEmitted++
        this.progress.bytesEmitted += JSON.stringify(record).length
        recordCount++

        // Emit checkpoint
        if (
          this.config.checkpointInterval &&
          recordCount % this.config.checkpointInterval === 0 &&
          latestCursor
        ) {
          yield this.createStateMessage(latestCursor)
        }
      }

      // Final state checkpoint
      if (latestCursor) {
        yield this.createStateMessage(latestCursor)
      }

      this.progress.status = 'completed'
      this.progress.completedAt = Date.now()
    } catch (error) {
      this.progress.status = 'failed'
      this.progress.error = error instanceof Error ? error.message : String(error)
      this.progress.completedAt = Date.now()
      throw error
    }
  }

  private extractCursorValue(record: Record<string, unknown>): string | undefined {
    const cursorField = this.config.cursorField
    const path = Array.isArray(cursorField) ? cursorField : [cursorField]

    let value: unknown = record
    for (const key of path) {
      if (value === null || value === undefined) return undefined
      value = (value as Record<string, unknown>)[key]
    }

    return value !== undefined && value !== null ? String(value) : undefined
  }

  private deduplicateRecords(records: Record<string, unknown>[]): Record<string, unknown>[] {
    if (!this.config.primaryKey || this.config.primaryKey.length === 0) {
      return records
    }

    const seen = new Map<string, Record<string, unknown>>()

    for (const record of records) {
      const key = this.extractPrimaryKey(record)
      seen.set(key, record) // Later records overwrite earlier ones
    }

    return Array.from(seen.values())
  }

  private extractPrimaryKey(record: Record<string, unknown>): string {
    if (!this.config.primaryKey) return ''

    const keyParts: string[] = []
    for (const keyPath of this.config.primaryKey) {
      let value: unknown = record
      for (const key of keyPath) {
        if (value === null || value === undefined) break
        value = (value as Record<string, unknown>)[key]
      }
      keyParts.push(String(value ?? ''))
    }

    return keyParts.join('|')
  }

  private createStateMessage(cursor: string): StateMessage {
    return {
      type: 'STATE',
      state: {
        type: 'STREAM',
        stream: {
          streamDescriptor: { name: this.config.streamName },
          streamState: { cursor },
        },
      },
    }
  }
}

/**
 * Create an incremental sync instance
 */
export function createIncrementalSync(config: IncrementalConfig): IncrementalSync {
  return new IncrementalSync(config)
}

// =============================================================================
// CDC Sync Mode (dotdo-c8tm4)
// =============================================================================

/**
 * CDC record operation type
 */
export type CDCRecordType = 'insert' | 'update' | 'delete'

/**
 * CDC change record
 */
export interface CDCChange {
  type: CDCRecordType
  record?: Record<string, unknown>
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  lsn?: string
  offset?: number
  timestamp?: number
}

/**
 * Initial snapshot configuration
 */
export interface InitialSnapshotConfig {
  enabled: boolean
  fetchSnapshot: () => Promise<Record<string, unknown>[]>
  startLsn?: string
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries: number
  retryDelayMs: number
}

/**
 * Configuration for CDC sync
 */
export interface CDCConfig extends SyncModeConfig {
  /**
   * Function to fetch CDC changes, optionally filtered by LSN/offset
   */
  fetchChanges: (lsn?: string) => Promise<CDCChange[]>

  /**
   * Field name for offset tracking (alternative to LSN)
   */
  offsetField?: string

  /**
   * Enable soft deletes (mark deleted_at instead of hard delete)
   */
  softDelete?: boolean

  /**
   * Initial snapshot configuration
   */
  initialSnapshot?: InitialSnapshotConfig

  /**
   * Sort changes by LSN before emitting
   */
  sortByLsn?: boolean

  /**
   * Retry configuration for transient errors
   */
  retryConfig?: RetryConfig
}

/**
 * CDC sync mode implementation
 */
export class CDCSyncMode {
  private config: CDCConfig
  private progress: SyncProgress

  constructor(config: CDCConfig) {
    this.config = {
      destinationSyncMode: 'append',
      softDelete: true,
      sortByLsn: false,
      ...config,
    }
    this.progress = {
      recordsEmitted: 0,
      bytesEmitted: 0,
      status: 'running',
      startedAt: Date.now(),
    }
  }

  /**
   * Get the sync configuration
   */
  getConfig(): CDCConfig {
    return this.config
  }

  /**
   * Get current sync progress
   */
  getProgress(): SyncProgress {
    return { ...this.progress }
  }

  /**
   * Read CDC changes from source
   */
  async *read(
    config: Record<string, unknown>,
    catalog: ConfiguredCatalog,
    state?: SyncState,
  ): AsyncGenerator<AirbyteMessage, void, unknown> {
    try {
      this.progress.status = 'running'
      this.progress.startedAt = Date.now()

      const streamState = state?.streams?.[this.config.streamName] as SyncCheckpoint | undefined
      const snapshotComplete = streamState?.snapshotComplete ?? false

      // Initial snapshot if enabled and not completed
      if (this.config.initialSnapshot?.enabled && !snapshotComplete) {
        yield* this.performInitialSnapshot()
      }

      // Get LSN/offset from state
      const lsn = streamState?.lsn
      const offset = streamState?.offset

      // Fetch CDC changes
      yield* this.fetchAndEmitChanges(lsn)

      this.progress.status = 'completed'
      this.progress.completedAt = Date.now()
    } catch (error) {
      this.progress.status = 'failed'
      this.progress.error = error instanceof Error ? error.message : String(error)
      this.progress.completedAt = Date.now()
      throw error
    }
  }

  private async *performInitialSnapshot(): AsyncGenerator<AirbyteMessage, void, unknown> {
    if (!this.config.initialSnapshot?.fetchSnapshot) {
      return
    }

    const records = await this.config.initialSnapshot.fetchSnapshot()

    for (const record of records) {
      const message: RecordMessage = {
        type: 'RECORD',
        record: {
          stream: this.config.streamName,
          data: {
            ...record,
            _cdc_snapshot: true,
            _cdc_op: 'insert',
          },
          emittedAt: Date.now(),
        },
      }

      yield message
      this.progress.recordsEmitted++
      this.progress.bytesEmitted += JSON.stringify(record).length
    }

    // Emit snapshot completion state
    yield this.createStateMessage({
      snapshotComplete: true,
      lsn: this.config.initialSnapshot.startLsn,
    })
  }

  private async *fetchAndEmitChanges(
    startLsn?: string,
  ): AsyncGenerator<AirbyteMessage, void, unknown> {
    let changes: CDCChange[]
    let attempts = 0
    const maxRetries = this.config.retryConfig?.maxRetries ?? 0
    const retryDelayMs = this.config.retryConfig?.retryDelayMs ?? 1000

    while (true) {
      try {
        changes = await this.config.fetchChanges(startLsn)
        break
      } catch (error) {
        attempts++
        yield this.createLogMessage('ERROR', `Fetch failed (attempt ${attempts}): ${(error as Error).message}`)

        if (attempts > maxRetries) {
          throw error
        }

        await this.delay(retryDelayMs)
      }
    }

    // Sort by LSN if enabled
    if (this.config.sortByLsn) {
      changes.sort((a, b) => {
        const lsnA = a.lsn ?? ''
        const lsnB = b.lsn ?? ''
        return lsnA.localeCompare(lsnB)
      })
    }

    let latestLsn: string | undefined
    let latestOffset: number | undefined

    for (const change of changes) {
      const message = this.createCDCRecordMessage(change)
      yield message

      this.progress.recordsEmitted++
      this.progress.bytesEmitted += JSON.stringify(message.record.data).length

      if (change.lsn) {
        latestLsn = change.lsn
      }
      if (change.offset !== undefined) {
        latestOffset = change.offset
      }
    }

    // Final state
    if (latestLsn || latestOffset !== undefined) {
      yield this.createStateMessage({ lsn: latestLsn, offset: latestOffset })
    }
  }

  private createCDCRecordMessage(change: CDCChange): RecordMessage {
    const timestamp = change.timestamp ?? Date.now()
    let data: Record<string, unknown>

    switch (change.type) {
      case 'insert':
        data = {
          ...change.record,
          _cdc_op: 'insert',
          _cdc_timestamp: timestamp,
        }
        break

      case 'update':
        data = {
          ...change.after,
          _cdc_op: 'update',
          _cdc_before: change.before,
          _cdc_timestamp: timestamp,
        }
        break

      case 'delete':
        if (this.config.softDelete) {
          data = {
            ...change.record,
            _cdc_op: 'delete',
            _cdc_deleted_at: timestamp,
            _cdc_timestamp: timestamp,
          }
        } else {
          data = {
            ...change.record,
            _cdc_op: 'delete',
            _cdc_is_hard_delete: true,
            _cdc_timestamp: timestamp,
          }
        }
        break
    }

    return {
      type: 'RECORD',
      record: {
        stream: this.config.streamName,
        data,
        emittedAt: Date.now(),
      },
    }
  }

  private createStateMessage(checkpoint: SyncCheckpoint): StateMessage {
    return {
      type: 'STATE',
      state: {
        type: 'STREAM',
        stream: {
          streamDescriptor: { name: this.config.streamName },
          streamState: checkpoint as Record<string, unknown>,
        },
      },
    }
  }

  private createLogMessage(
    level: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL',
    message: string,
  ): LogMessage {
    return {
      type: 'LOG',
      log: { level, message },
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/**
 * Create a CDC sync instance
 */
export function createCDCSync(config: CDCConfig): CDCSyncMode {
  return new CDCSyncMode(config)
}
