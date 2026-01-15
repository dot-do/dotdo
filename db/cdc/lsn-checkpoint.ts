/**
 * LSN Checkpoint Store - Provides exactly-once delivery semantics
 *
 * Log Sequence Number (LSN) checkpointing enables:
 * - Exactly-once event delivery via watermark tracking
 * - Consumer position recovery after crashes
 * - Multi-consumer support with isolated checkpoints
 * - Atomic checkpoint updates within transactions
 *
 * @module db/cdc/lsn-checkpoint
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Consumer checkpoint containing position and metadata
 */
export interface LSNCheckpoint {
  /** Consumer identifier */
  consumerId: string
  /** Last successfully processed LSN */
  lsn: number
  /** Timestamp of the checkpoint */
  timestamp: string
  /** Optional cursor for paginated replay */
  cursor?: string
  /** Metadata for debugging/monitoring */
  meta?: {
    /** Number of events processed since start */
    eventsProcessed?: number
    /** Timestamp of first checkpoint */
    firstCheckpoint?: string
    /** Last error if any */
    lastError?: string
  }
}

/**
 * Options for creating the checkpoint store
 */
export interface LSNCheckpointStoreOptions {
  /** Table name for checkpoint storage (default: 'cdc_checkpoints') */
  tableName?: string
  /** Enable WAL mode for better concurrency (default: true) */
  walMode?: boolean
}

/**
 * SQL interface compatible with DO storage.sql
 */
export interface SqlInterface {
  exec(query: string, ...params: unknown[]): { toArray(): unknown[] }
}

// ============================================================================
// LSN CHECKPOINT STORE
// ============================================================================

/**
 * LSNCheckpointStore - Manages consumer checkpoints for exactly-once delivery
 *
 * Uses SQLite storage for durability and atomicity. Checkpoints are updated
 * within the same transaction as event processing to guarantee exactly-once.
 *
 * @example
 * ```typescript
 * const store = new LSNCheckpointStore(sql)
 * await store.initialize()
 *
 * // Get consumer's last position
 * const checkpoint = await store.get('consumer-1')
 *
 * // Process events from checkpoint
 * for (const event of events.filter(e => e.lsn > checkpoint.lsn)) {
 *   await processEvent(event)
 *   await store.save('consumer-1', event.lsn)
 * }
 * ```
 */
export class LSNCheckpointStore {
  private readonly sql: SqlInterface
  private readonly tableName: string
  private initialized = false

  constructor(sql: SqlInterface, options: LSNCheckpointStoreOptions = {}) {
    this.sql = sql
    this.tableName = options.tableName ?? 'cdc_checkpoints'
  }

  /**
   * Initialize the checkpoint table if it doesn't exist.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        consumer_id TEXT PRIMARY KEY,
        lsn INTEGER NOT NULL DEFAULT 0,
        timestamp TEXT NOT NULL,
        cursor TEXT,
        events_processed INTEGER DEFAULT 0,
        first_checkpoint TEXT,
        last_error TEXT
      )
    `)

    // Create index for efficient queries
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_lsn
      ON ${this.tableName}(lsn)
    `)

    this.initialized = true
  }

  /**
   * Get checkpoint for a consumer.
   *
   * @param consumerId - Consumer identifier
   * @returns Checkpoint or default (lsn: 0) if not found
   */
  async get(consumerId: string): Promise<LSNCheckpoint> {
    await this.initialize()

    const rows = this.sql
      .exec(
        `SELECT consumer_id, lsn, timestamp, cursor, events_processed, first_checkpoint, last_error
         FROM ${this.tableName}
         WHERE consumer_id = ?`,
        consumerId
      )
      .toArray() as Array<{
      consumer_id: string
      lsn: number
      timestamp: string
      cursor: string | null
      events_processed: number | null
      first_checkpoint: string | null
      last_error: string | null
    }>

    if (rows.length === 0) {
      return {
        consumerId,
        lsn: 0,
        timestamp: new Date(0).toISOString(),
      }
    }

    const row = rows[0]!
    return {
      consumerId: row.consumer_id,
      lsn: row.lsn,
      timestamp: row.timestamp,
      cursor: row.cursor ?? undefined,
      meta: {
        eventsProcessed: row.events_processed ?? undefined,
        firstCheckpoint: row.first_checkpoint ?? undefined,
        lastError: row.last_error ?? undefined,
      },
    }
  }

  /**
   * Save checkpoint for a consumer.
   *
   * @param consumerId - Consumer identifier
   * @param lsn - Last processed LSN
   * @param options - Additional checkpoint options
   */
  async save(
    consumerId: string,
    lsn: number,
    options?: {
      cursor?: string
      incrementEvents?: number
      error?: string
    }
  ): Promise<void> {
    await this.initialize()

    const timestamp = new Date().toISOString()
    const incrementEvents = options?.incrementEvents ?? 1

    // Upsert checkpoint with atomic counter increment
    this.sql.exec(
      `INSERT INTO ${this.tableName}
       (consumer_id, lsn, timestamp, cursor, events_processed, first_checkpoint, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(consumer_id) DO UPDATE SET
         lsn = excluded.lsn,
         timestamp = excluded.timestamp,
         cursor = COALESCE(excluded.cursor, ${this.tableName}.cursor),
         events_processed = ${this.tableName}.events_processed + ?,
         last_error = excluded.last_error`,
      consumerId,
      lsn,
      timestamp,
      options?.cursor ?? null,
      incrementEvents,
      timestamp,
      options?.error ?? null,
      incrementEvents
    )
  }

  /**
   * Save checkpoint atomically with a transaction callback.
   * Use this when checkpoint should only be saved if processing succeeds.
   *
   * @param consumerId - Consumer identifier
   * @param lsn - LSN being processed
   * @param fn - Processing function
   */
  async saveWithTransaction<T>(
    consumerId: string,
    lsn: number,
    fn: () => Promise<T>
  ): Promise<T> {
    await this.initialize()

    // Begin transaction
    this.sql.exec('BEGIN TRANSACTION')

    try {
      // Execute processing
      const result = await fn()

      // Save checkpoint
      await this.save(consumerId, lsn)

      // Commit
      this.sql.exec('COMMIT')

      return result
    } catch (error) {
      // Rollback on failure
      this.sql.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * Get all consumer checkpoints (for monitoring).
   */
  async getAllCheckpoints(): Promise<LSNCheckpoint[]> {
    await this.initialize()

    const rows = this.sql
      .exec(
        `SELECT consumer_id, lsn, timestamp, cursor, events_processed, first_checkpoint, last_error
         FROM ${this.tableName}
         ORDER BY lsn DESC`
      )
      .toArray() as Array<{
      consumer_id: string
      lsn: number
      timestamp: string
      cursor: string | null
      events_processed: number | null
      first_checkpoint: string | null
      last_error: string | null
    }>

    return rows.map((row) => ({
      consumerId: row.consumer_id,
      lsn: row.lsn,
      timestamp: row.timestamp,
      cursor: row.cursor ?? undefined,
      meta: {
        eventsProcessed: row.events_processed ?? undefined,
        firstCheckpoint: row.first_checkpoint ?? undefined,
        lastError: row.last_error ?? undefined,
      },
    }))
  }

  /**
   * Get the minimum LSN across all consumers (safe to garbage collect below this).
   */
  async getMinLSN(): Promise<number> {
    await this.initialize()

    const rows = this.sql.exec(`SELECT MIN(lsn) as min_lsn FROM ${this.tableName}`).toArray() as Array<{
      min_lsn: number | null
    }>

    return rows[0]?.min_lsn ?? 0
  }

  /**
   * Delete checkpoint for a consumer.
   */
  async delete(consumerId: string): Promise<void> {
    await this.initialize()

    this.sql.exec(`DELETE FROM ${this.tableName} WHERE consumer_id = ?`, consumerId)
  }

  /**
   * Clear all checkpoints (for testing).
   */
  async clear(): Promise<void> {
    await this.initialize()

    this.sql.exec(`DELETE FROM ${this.tableName}`)
  }
}
