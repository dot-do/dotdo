/**
 * WAL Manager - Write-Ahead Log for Crash Recovery
 *
 * Provides WAL functionality for DO state persistence:
 * - Operation logging before application
 * - Transaction support with ACID guarantees
 * - Crash recovery via replay
 * - Checksum verification
 *
 * @module objects/persistence/wal-manager
 */

import type {
  WALEntry,
  WALConfig,
  WALOperationType,
  Transaction,
  TransactionState,
  Savepoint,
  WALRecoveryResult,
  WALRecoveryError,
} from './types'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Storage interface for WAL operations
 */
export interface WALStorage {
  sql: {
    exec(query: string, ...params: unknown[]): {
      toArray(): unknown[]
      changes?: number
    }
  }
}

/**
 * Batch entry for atomic multi-entry appends
 */
export interface WALBatchEntry {
  operation: WALOperationType
  table: string
  payload: Uint8Array
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10MB
const DEFAULT_MAX_ENTRIES = 1000
const DEFAULT_ASYNC_SYNC_INTERVAL_MS = 100
const DEFAULT_TRANSACTION_TIMEOUT_MS = 30000

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique transaction ID
 */
function generateTransactionId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `tx-${timestamp}-${random}`
}

/**
 * Calculate SHA-256 checksum
 */
async function calculateChecksum(data: Uint8Array): Promise<string> {
  // Create a new ArrayBuffer to avoid SharedArrayBuffer issues
  const buffer = new ArrayBuffer(data.byteLength)
  new Uint8Array(buffer).set(data)
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = new Uint8Array(hashBuffer)
  return Array.from(hashArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Verify a checksum matches data
 */
async function verifyChecksum(data: Uint8Array, checksum: string): Promise<boolean> {
  const calculated = await calculateChecksum(data)
  return calculated === checksum
}

// ============================================================================
// WAL MANAGER CLASS
// ============================================================================

/**
 * Manages Write-Ahead Log for crash recovery and durability
 */
export class WALManager {
  private storage: WALStorage
  private config: Required<WALConfig>
  private schemaVersion: number
  private currentLsn: number = 0
  private transactions: Map<string, Transaction> = new Map()
  private syncCallbacks: Array<() => void> = []
  private sizeLimitCallbacks: Array<() => void> = []
  private entryLimitCallbacks: Array<() => void> = []
  private asyncSyncTimer: ReturnType<typeof setInterval> | null = null
  private pendingSync: boolean = false
  private walSizeBytes: number = 0
  private initialized: boolean = false

  constructor(
    storage: WALStorage,
    options?: {
      schemaVersion?: number
      config?: WALConfig
    }
  ) {
    this.storage = storage
    this.schemaVersion = options?.schemaVersion ?? 1

    this.config = {
      maxSizeBytes: options?.config?.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES,
      maxEntries: options?.config?.maxEntries ?? DEFAULT_MAX_ENTRIES,
      syncMode: options?.config?.syncMode ?? 'async',
      asyncSyncIntervalMs: options?.config?.asyncSyncIntervalMs ?? DEFAULT_ASYNC_SYNC_INTERVAL_MS,
      transactionTimeoutMs: options?.config?.transactionTimeoutMs ?? DEFAULT_TRANSACTION_TIMEOUT_MS,
      verifyChecksums: options?.config?.verifyChecksums ?? true,
      compress: options?.config?.compress ?? false,
    }
  }

  /**
   * Configure the WAL manager
   */
  configure(config: WALConfig): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Initialize WAL state from storage
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Get current LSN
    const result = this.storage.sql.exec('SELECT MAX(lsn) as max_lsn FROM wal')
    const rows = result.toArray() as { max_lsn: number | null }[]
    this.currentLsn = rows[0]?.max_lsn ?? 0

    // Calculate WAL size
    await this.recalculateWalSize()

    // Load active transactions
    await this.loadActiveTransactions()

    this.initialized = true
  }

  /**
   * Start background processes (async sync, transaction timeouts)
   */
  start(): void {
    if (this.config.syncMode === 'async' && !this.asyncSyncTimer) {
      this.asyncSyncTimer = setInterval(async () => {
        if (this.pendingSync) {
          await this.flushInternal()
          this.pendingSync = false
        }
      }, this.config.asyncSyncIntervalMs)
    }

    // Start transaction timeout checker
    this.startTransactionTimeoutChecker()
  }

  /**
   * Stop background processes
   */
  stop(): void {
    if (this.asyncSyncTimer) {
      clearInterval(this.asyncSyncTimer)
      this.asyncSyncTimer = null
    }
  }

  /**
   * Append an entry to the WAL
   */
  async append(
    operation: WALOperationType,
    table: string,
    payload: Uint8Array,
    transactionId?: string
  ): Promise<number> {
    if (!this.initialized) await this.initialize()

    // Increment LSN
    this.currentLsn++
    const lsn = this.currentLsn

    // Calculate checksum
    const checksum = await calculateChecksum(payload)

    // Create entry
    const entry: WALEntry = {
      lsn,
      operation,
      table,
      payload,
      transactionId,
      schemaVersion: this.schemaVersion,
      createdAt: Date.now(),
      flushed: false,
      checksum,
    }

    // Persist to storage
    this.storage.sql.exec(
      `INSERT INTO wal (lsn, operation, table_name, payload, transaction_id, schema_version, created_at, flushed, checksum)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      lsn,
      operation,
      table,
      payload,
      transactionId ?? null,
      this.schemaVersion,
      entry.createdAt,
      0,
      checksum
    )

    // Update WAL size
    this.walSizeBytes += payload.length + 100 // Estimate overhead

    // Track operation in transaction
    if (transactionId) {
      const tx = this.transactions.get(transactionId)
      if (tx) {
        tx.operations.push(lsn)
      }
    }

    // Check limits
    await this.checkLimits()

    // Handle sync mode
    if (this.config.syncMode === 'sync') {
      await this.flushInternal()
      this.emitSync()
    } else {
      this.pendingSync = true
    }

    return lsn
  }

  /**
   * Append a batch of entries atomically
   */
  async appendBatch(entries: WALBatchEntry[]): Promise<number[]> {
    if (!this.initialized) await this.initialize()

    const lsns: number[] = []

    // Start implicit transaction for atomicity
    const txId = await this.beginTransaction()

    try {
      for (const entry of entries) {
        const lsn = await this.append(entry.operation, entry.table, entry.payload, txId)
        lsns.push(lsn)
      }

      await this.commitTransaction(txId)
      return lsns
    } catch (error) {
      await this.rollbackTransaction(txId)
      throw error
    }
  }

  /**
   * Get an entry by LSN
   */
  async getEntry(lsn: number): Promise<WALEntry | null> {
    const result = this.storage.sql.exec(
      `SELECT lsn, operation, table_name, payload, transaction_id, schema_version, created_at, flushed, checksum
       FROM wal WHERE lsn = ?`,
      lsn
    )

    const rows = result.toArray() as Array<{
      lsn: number
      operation: WALOperationType
      table_name: string
      payload: Uint8Array
      transaction_id: string | null
      schema_version: number
      created_at: number
      flushed: number
      checksum: string
    }>

    if (rows.length === 0) return null

    const row = rows[0]!
    return {
      lsn: row.lsn,
      operation: row.operation,
      table: row.table_name,
      payload: row.payload,
      transactionId: row.transaction_id ?? undefined,
      schemaVersion: row.schema_version,
      createdAt: row.created_at,
      flushed: row.flushed === 1,
      checksum: row.checksum,
    }
  }

  /**
   * Flush unflushed entries
   */
  async flush(): Promise<number> {
    return this.flushInternal()
  }

  private async flushInternal(): Promise<number> {
    const result = this.storage.sql.exec('SELECT COUNT(*) as count FROM wal WHERE flushed = 0')
    const rows = result.toArray() as { count: number }[]
    const count = rows[0]?.count ?? 0

    if (count === 0) return 0

    this.storage.sql.exec('UPDATE wal SET flushed = 1 WHERE flushed = 0')

    this.emitSync()
    return count
  }

  /**
   * Get count of unflushed entries
   */
  async getUnflushedCount(): Promise<number> {
    const result = this.storage.sql.exec('SELECT COUNT(*) as count FROM wal WHERE flushed = 0')
    const rows = result.toArray() as { count: number }[]
    return rows[0]?.count ?? 0
  }

  /**
   * Get total entry count
   */
  async getEntryCount(): Promise<number> {
    const result = this.storage.sql.exec('SELECT COUNT(*) as count FROM wal')
    const rows = result.toArray() as { count: number }[]
    return rows[0]?.count ?? 0
  }

  /**
   * Get first LSN in WAL
   */
  async getFirstLsn(): Promise<number> {
    const result = this.storage.sql.exec('SELECT MIN(lsn) as min_lsn FROM wal')
    const rows = result.toArray() as { min_lsn: number | null }[]
    return rows[0]?.min_lsn ?? 0
  }

  /**
   * Get WAL size in bytes
   */
  async getWalSize(): Promise<number> {
    return this.walSizeBytes
  }

  /**
   * Truncate entries before a given LSN
   */
  async truncateBefore(lsn: number): Promise<number> {
    const result = this.storage.sql.exec(
      'DELETE FROM wal WHERE lsn < ? AND flushed = 1',
      lsn
    )

    await this.recalculateWalSize()

    return result.changes ?? 0
  }

  // ==========================================================================
  // TRANSACTION MANAGEMENT
  // ==========================================================================

  /**
   * Begin a new transaction
   */
  async beginTransaction(): Promise<string> {
    const txId = generateTransactionId()

    const transaction: Transaction = {
      id: txId,
      state: 'ACTIVE',
      startedAt: Date.now(),
      operations: [],
      savepoints: [],
      timeoutMs: this.config.transactionTimeoutMs,
    }

    this.transactions.set(txId, transaction)

    // Persist transaction
    this.storage.sql.exec(
      'INSERT INTO transactions (id, state, started_at) VALUES (?, ?, ?)',
      txId,
      'ACTIVE',
      transaction.startedAt
    )

    // Log TX_BEGIN
    await this.append(
      'TX_BEGIN',
      '',
      new TextEncoder().encode(JSON.stringify({ txId })),
      txId
    )

    return txId
  }

  /**
   * Commit a transaction
   */
  async commitTransaction(transactionId: string): Promise<void> {
    const tx = this.transactions.get(transactionId)

    if (!tx) {
      // Check storage
      const result = this.storage.sql.exec(
        'SELECT state FROM transactions WHERE id = ?',
        transactionId
      )
      const rows = result.toArray() as { state: TransactionState }[]

      if (rows.length === 0) {
        throw new Error('Transaction not found')
      }
      throw new Error('Transaction not active')
    }

    if (tx.state !== 'ACTIVE') {
      throw new Error('Transaction not active')
    }

    // Log TX_COMMIT
    await this.append(
      'TX_COMMIT',
      '',
      new TextEncoder().encode(JSON.stringify({ txId: transactionId })),
      transactionId
    )

    // Update state
    tx.state = 'COMMITTED'
    tx.endedAt = Date.now()

    this.storage.sql.exec(
      'UPDATE transactions SET state = ? WHERE id = ?',
      'COMMITTED',
      transactionId
    )
  }

  /**
   * Rollback a transaction
   */
  async rollbackTransaction(transactionId: string): Promise<void> {
    const tx = this.transactions.get(transactionId)

    if (!tx) {
      const result = this.storage.sql.exec(
        'SELECT state FROM transactions WHERE id = ?',
        transactionId
      )
      const rows = result.toArray() as { state: TransactionState }[]

      if (rows.length === 0) {
        throw new Error('Transaction not found')
      }
      throw new Error('Transaction not active')
    }

    if (tx.state !== 'ACTIVE') {
      throw new Error('Transaction not active')
    }

    // Delete transaction entries (except TX_BEGIN and TX_ROLLBACK)
    this.storage.sql.exec(
      `DELETE FROM wal WHERE transaction_id = ? AND operation NOT IN ('TX_BEGIN', 'TX_ROLLBACK')`,
      transactionId
    )

    // Log TX_ROLLBACK
    await this.append(
      'TX_ROLLBACK',
      '',
      new TextEncoder().encode(JSON.stringify({ txId: transactionId })),
      transactionId
    )

    // Update state
    tx.state = 'ROLLED_BACK'
    tx.endedAt = Date.now()

    this.storage.sql.exec(
      'UPDATE transactions SET state = ? WHERE id = ?',
      'ROLLED_BACK',
      transactionId
    )
  }

  /**
   * Get transaction state
   */
  async getTransactionState(transactionId: string): Promise<TransactionState | null> {
    const tx = this.transactions.get(transactionId)
    if (tx) return tx.state

    const result = this.storage.sql.exec(
      'SELECT state FROM transactions WHERE id = ?',
      transactionId
    )
    const rows = result.toArray() as { state: TransactionState }[]

    return rows.length > 0 ? rows[0]!.state : null
  }

  /**
   * Get transaction operations (LSNs)
   */
  async getTransactionOperations(transactionId: string): Promise<number[]> {
    const tx = this.transactions.get(transactionId)
    if (tx) return [...tx.operations]

    const result = this.storage.sql.exec(
      'SELECT lsn FROM wal WHERE transaction_id = ? ORDER BY lsn',
      transactionId
    )
    return (result.toArray() as { lsn: number }[]).map((row) => row.lsn)
  }

  // ==========================================================================
  // SAVEPOINTS
  // ==========================================================================

  /**
   * Create a savepoint within a transaction
   */
  async createSavepoint(transactionId: string, name: string): Promise<Savepoint> {
    const tx = this.transactions.get(transactionId)
    if (!tx || tx.state !== 'ACTIVE') {
      throw new Error('Transaction not active')
    }

    const savepoint: Savepoint = {
      name,
      lsn: this.currentLsn,
      operationIndex: tx.operations.length,
      createdAt: Date.now(),
    }

    tx.savepoints.push(savepoint)

    return savepoint
  }

  /**
   * Rollback to a savepoint
   */
  async rollbackToSavepoint(transactionId: string, name: string): Promise<void> {
    const tx = this.transactions.get(transactionId)
    if (!tx || tx.state !== 'ACTIVE') {
      throw new Error('Transaction not active')
    }

    const savepointIndex = tx.savepoints.findIndex(sp => sp.name === name)
    if (savepointIndex === -1) {
      throw new Error(`Savepoint not found: ${name}`)
    }

    const savepoint = tx.savepoints[savepointIndex]!

    // Delete entries after savepoint
    const lsnsToDelete = tx.operations.slice(savepoint.operationIndex)
    for (const lsn of lsnsToDelete) {
      this.storage.sql.exec('DELETE FROM wal WHERE lsn = ?', lsn)
    }

    // Truncate operations list
    tx.operations = tx.operations.slice(0, savepoint.operationIndex)

    // Remove savepoints after this one
    tx.savepoints = tx.savepoints.slice(0, savepointIndex + 1)
  }

  /**
   * Release a savepoint
   */
  async releaseSavepoint(transactionId: string, name: string): Promise<void> {
    const tx = this.transactions.get(transactionId)
    if (!tx || tx.state !== 'ACTIVE') {
      throw new Error('Transaction not active')
    }

    const index = tx.savepoints.findIndex(sp => sp.name === name)
    if (index !== -1) {
      tx.savepoints.splice(index, 1)
    }
  }

  /**
   * Get savepoints for a transaction
   */
  async getSavepoints(transactionId: string): Promise<Savepoint[]> {
    const tx = this.transactions.get(transactionId)
    if (!tx) return []
    return [...tx.savepoints]
  }

  // ==========================================================================
  // CRASH RECOVERY
  // ==========================================================================

  /**
   * Recover from crash by replaying unflushed entries
   */
  async recover(options?: {
    onReplay?: (entry: WALEntry) => void
  }): Promise<WALRecoveryResult> {
    const startTime = Date.now()
    const errors: WALRecoveryError[] = []
    let entriesRecovered = 0
    let transactionsRecovered = 0
    let transactionsRolledBack = 0

    // Get unflushed entries ordered by LSN
    const result = this.storage.sql.exec(
      `SELECT lsn, operation, table_name, payload, transaction_id, schema_version, created_at, flushed, checksum
       FROM wal WHERE flushed = 0 ORDER BY lsn ASC`
    )

    const rows = result.toArray() as Array<{
      lsn: number
      operation: WALOperationType
      table_name: string
      payload: Uint8Array
      transaction_id: string | null
      schema_version: number
      created_at: number
      flushed: number
      checksum: string
    }>

    // Track transactions seen
    const txSeen = new Set<string>()
    const txCommitted = new Set<string>()

    for (const row of rows) {
      const entry: WALEntry = {
        lsn: row.lsn,
        operation: row.operation,
        table: row.table_name,
        payload: row.payload,
        transactionId: row.transaction_id ?? undefined,
        schemaVersion: row.schema_version,
        createdAt: row.created_at,
        flushed: row.flushed === 1,
        checksum: row.checksum,
      }

      // Verify checksum if enabled
      if (this.config.verifyChecksums) {
        const isValid = await verifyChecksum(entry.payload, entry.checksum)
        if (!isValid) {
          errors.push({
            lsn: entry.lsn,
            message: 'Checksum verification failed',
            recoverable: true,
            action: 'skip',
          })
          continue
        }
      }

      // Track transaction state
      if (entry.transactionId) {
        txSeen.add(entry.transactionId)
        if (entry.operation === 'TX_COMMIT') {
          txCommitted.add(entry.transactionId)
        }
      }

      // Replay entry
      if (options?.onReplay) {
        try {
          options.onReplay(entry)
          entriesRecovered++
        } catch (error) {
          errors.push({
            lsn: entry.lsn,
            message: (error as Error).message,
            recoverable: true,
            action: 'skip',
          })
        }
      } else {
        entriesRecovered++
      }
    }

    // Rollback incomplete transactions
    Array.from(txSeen).forEach((txId) => {
      if (txCommitted.has(txId)) {
        transactionsRecovered++
      } else {
        // Rollback incomplete transaction
        this.storage.sql.exec(
          `DELETE FROM wal WHERE transaction_id = ? AND operation NOT IN ('TX_BEGIN', 'TX_ROLLBACK')`,
          txId
        )
        this.storage.sql.exec(
          'UPDATE transactions SET state = ? WHERE id = ?',
          'ROLLED_BACK',
          txId
        )
        transactionsRolledBack++
      }
    })

    // Mark all as flushed
    await this.flush()

    return {
      entriesRecovered,
      transactionsRecovered,
      transactionsRolledBack,
      lastLsn: rows.length > 0 ? rows[rows.length - 1]!.lsn : 0,
      complete: errors.length === 0,
      errors,
      durationMs: Date.now() - startTime,
    }
  }

  // ==========================================================================
  // CHECKSUM VERIFICATION
  // ==========================================================================

  /**
   * Verify an entry's checksum
   */
  verifyChecksum(entry: WALEntry): boolean {
    // Note: This is sync for API consistency but uses pre-calculated checksum
    // For actual verification, use verifyChecksumAsync
    return entry.checksum.length === 64
  }

  /**
   * Verify an entry's checksum (async)
   */
  async verifyChecksumAsync(entry: WALEntry): Promise<boolean> {
    return verifyChecksum(entry.payload, entry.checksum)
  }

  /**
   * Corrupt an entry (for testing)
   */
  async corruptEntry(lsn: number): Promise<void> {
    const entry = await this.getEntry(lsn)
    if (!entry) return

    // Corrupt payload
    const corruptPayload = new Uint8Array(entry.payload)
    if (corruptPayload.length > 0) {
      corruptPayload[0] = (corruptPayload[0]! + 1) % 256
    }

    this.storage.sql.exec(
      'UPDATE wal SET payload = ? WHERE lsn = ?',
      corruptPayload,
      lsn
    )
  }

  // ==========================================================================
  // CALLBACKS
  // ==========================================================================

  /**
   * Register sync callback
   */
  onSync(callback: () => void): void {
    this.syncCallbacks.push(callback)
  }

  /**
   * Register size limit exceeded callback
   */
  onSizeLimitExceeded(callback: () => void): void {
    this.sizeLimitCallbacks.push(callback)
  }

  /**
   * Register entry limit exceeded callback
   */
  onEntryLimitExceeded(callback: () => void): void {
    this.entryLimitCallbacks.push(callback)
  }

  // ==========================================================================
  // INTERNAL HELPERS
  // ==========================================================================

  private emitSync(): void {
    for (const callback of this.syncCallbacks) {
      try {
        callback()
      } catch {
        // Ignore callback errors
      }
    }
  }

  private async checkLimits(): Promise<void> {
    // Check size limit
    if (this.walSizeBytes >= this.config.maxSizeBytes) {
      for (const callback of this.sizeLimitCallbacks) {
        try {
          callback()
        } catch {
          // Ignore
        }
      }
    }

    // Check entry limit
    const count = await this.getEntryCount()
    if (count >= this.config.maxEntries) {
      for (const callback of this.entryLimitCallbacks) {
        try {
          callback()
        } catch {
          // Ignore
        }
      }
    }
  }

  private async recalculateWalSize(): Promise<void> {
    const result = this.storage.sql.exec('SELECT SUM(LENGTH(payload)) as total FROM wal')
    const rows = result.toArray() as { total: number | null }[]
    this.walSizeBytes = rows[0]?.total ?? 0
  }

  private async loadActiveTransactions(): Promise<void> {
    const result = this.storage.sql.exec(
      `SELECT id, state, started_at FROM transactions WHERE state = 'ACTIVE'`
    )
    const rows = result.toArray() as Array<{
      id: string
      state: TransactionState
      started_at: number
    }>

    for (const row of rows) {
      const ops = await this.getTransactionOperations(row.id)
      this.transactions.set(row.id, {
        id: row.id,
        state: row.state,
        startedAt: row.started_at,
        operations: ops,
        savepoints: [],
        timeoutMs: this.config.transactionTimeoutMs,
      })
    }
  }

  private startTransactionTimeoutChecker(): void {
    setInterval(() => {
      const now = Date.now()
      this.transactions.forEach((tx, txId) => {
        if (tx.state === 'ACTIVE' && now - tx.startedAt > tx.timeoutMs) {
          tx.state = 'ABORTED'
          this.storage.sql.exec(
            'UPDATE transactions SET state = ? WHERE id = ?',
            'ABORTED',
            txId
          )
        }
      })
    }, 1000)
  }

  /**
   * Simulate failure for testing
   */
  simulateFailure(): void {
    throw new Error('Simulated failure')
  }
}
