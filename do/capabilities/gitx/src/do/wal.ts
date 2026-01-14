/**
 * @fileoverview Write-Ahead Log (WAL) Manager for Transaction Durability
 *
 * This module provides a Write-Ahead Log implementation for ensuring durability
 * and crash recovery in the Git object storage. All operations are logged before
 * being applied, allowing recovery after failures.
 *
 * **Key Features**:
 * - Transaction support with begin/commit/rollback semantics
 * - Checkpoint creation for efficient recovery
 * - WAL truncation after successful checkpoints
 * - Unflushed entry recovery for crash recovery
 *
 * @module durable-object/wal
 *
 * @example
 * ```typescript
 * import { WALManager } from './durable-object/wal'
 *
 * const wal = new WALManager(storage)
 *
 * // Simple operation logging
 * const entryId = await wal.append('PUT', payload)
 *
 * // Transaction support
 * const txId = await wal.beginTransaction()
 * await wal.append('PUT', payload1, txId)
 * await wal.append('PUT', payload2, txId)
 * await wal.commitTransaction(txId)
 *
 * // Create checkpoint for recovery point
 * const checkpoint = await wal.createCheckpoint()
 * ```
 */

import { DurableObjectStorage } from './schema'

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Types of operations that can be logged to the WAL.
 *
 * @description
 * - `PUT`: Object creation or update
 * - `DELETE`: Object deletion
 * - `UPDATE`: Object modification
 * - `BATCH`: Multiple operations grouped together
 * - `TX_BEGIN`: Transaction start marker
 * - `TX_COMMIT`: Transaction commit marker
 * - `TX_ROLLBACK`: Transaction rollback marker
 */
export type WALOperationType = 'PUT' | 'DELETE' | 'UPDATE' | 'BATCH' | 'TX_BEGIN' | 'TX_COMMIT' | 'TX_ROLLBACK'

/**
 * Possible states for a transaction.
 *
 * @description
 * - `ACTIVE`: Transaction is in progress
 * - `COMMITTED`: Transaction has been committed successfully
 * - `ROLLED_BACK`: Transaction has been rolled back
 */
export type TransactionState = 'ACTIVE' | 'COMMITTED' | 'ROLLED_BACK'

/**
 * A single entry in the Write-Ahead Log.
 *
 * @description
 * Represents one logged operation with its metadata.
 * Entries are ordered by ID for replay during recovery.
 *
 * @example
 * ```typescript
 * const entry: WALEntry = {
 *   id: 42,
 *   operation: 'PUT',
 *   payload: new Uint8Array([...]),
 *   transactionId: 'tx-abc123',
 *   createdAt: 1704067200000,
 *   flushed: false
 * }
 * ```
 */
export interface WALEntry {
  /** Unique sequential ID for ordering */
  id: number
  /** Type of operation logged */
  operation: WALOperationType
  /** Binary payload containing operation details */
  payload: Uint8Array
  /** Transaction ID if part of a transaction, null otherwise */
  transactionId: string | null
  /** Unix timestamp (milliseconds) when entry was created */
  createdAt: number
  /** Whether this entry has been flushed (persisted durably) */
  flushed: boolean
}

/**
 * Transaction metadata tracking state and operations.
 *
 * @description
 * Tracks the state of a transaction and all operations performed within it.
 * Used for commit/rollback logic and recovery.
 *
 * @example
 * ```typescript
 * const tx: Transaction = {
 *   id: 'tx-abc123',
 *   state: 'ACTIVE',
 *   startedAt: 1704067200000,
 *   operations: [42, 43, 44]  // WAL entry IDs
 * }
 * ```
 */
export interface Transaction {
  /** Unique transaction identifier */
  id: string
  /** Current state of the transaction */
  state: TransactionState
  /** Unix timestamp (milliseconds) when transaction started */
  startedAt: number
  /** Array of WAL entry IDs belonging to this transaction */
  operations: number[]
}

/**
 * A checkpoint representing a consistent point in the WAL.
 *
 * @description
 * Checkpoints mark points where all prior operations have been
 * successfully applied. They enable efficient recovery by allowing
 * truncation of old WAL entries.
 *
 * @example
 * ```typescript
 * const checkpoint: Checkpoint = {
 *   id: 5,
 *   walPosition: 150,  // All entries up to 150 are committed
 *   createdAt: 1704067200000,
 *   metadata: 'Daily checkpoint'
 * }
 * ```
 */
export interface Checkpoint {
  /** Unique checkpoint ID */
  id: number
  /** WAL position (entry ID) at checkpoint creation */
  walPosition: number
  /** Unix timestamp (milliseconds) when checkpoint was created */
  createdAt: number
  /** Optional descriptive metadata */
  metadata: string | null
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique transaction ID.
 *
 * @description
 * Creates a unique identifier for transactions using timestamp
 * and random components to avoid collisions.
 *
 * @returns Unique transaction ID string (e.g., 'tx-lxyz123-abc12345')
 * @internal
 */
function generateTransactionId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `tx-${timestamp}-${random}`
}

// ============================================================================
// WALManager Class
// ============================================================================

/**
 * Write-Ahead Log Manager for transaction durability.
 *
 * @description
 * Provides durability guarantees by logging all operations before they are applied.
 * Supports transactions with begin/commit/rollback semantics and checkpoint management.
 *
 * **Usage Pattern**:
 * 1. Log operations using `append()` before applying them
 * 2. Use transactions for atomic multi-operation changes
 * 3. Create checkpoints periodically for efficient recovery
 * 4. Truncate WAL after successful checkpoints
 *
 * @example
 * ```typescript
 * const wal = new WALManager(storage)
 *
 * // Single operation
 * const payload = new TextEncoder().encode(JSON.stringify({ sha: 'abc123' }))
 * const id = await wal.append('PUT', payload)
 *
 * // Transaction
 * const txId = await wal.beginTransaction()
 * try {
 *   await wal.append('PUT', payload1, txId)
 *   await wal.append('PUT', payload2, txId)
 *   await wal.commitTransaction(txId)
 * } catch (e) {
 *   await wal.rollbackTransaction(txId)
 *   throw e
 * }
 *
 * // Checkpoint and cleanup
 * const checkpoint = await wal.createCheckpoint()
 * await wal.truncateBeforeCheckpoint(checkpoint)
 * ```
 */
export class WALManager {
  /** Durable Object storage interface */
  private storage: DurableObjectStorage
  /** In-memory transaction tracking */
  private transactions: Map<string, Transaction> = new Map()
  /** Current WAL position for entry ID assignment */
  private currentWalPosition: number = 0

  /**
   * Create a new WALManager.
   *
   * @param storage - Durable Object storage interface with SQL support
   */
  constructor(storage: DurableObjectStorage) {
    this.storage = storage
  }

  /**
   * Append an operation to the WAL.
   *
   * @description
   * Logs an operation to the WAL before it is applied. Operations can
   * optionally be associated with a transaction for atomic commit/rollback.
   *
   * @param operation - The type of operation being logged
   * @param payload - Binary data describing the operation (usually JSON-encoded)
   * @param transactionId - Optional transaction ID to associate with this operation
   * @returns The ID of the appended WAL entry
   *
   * @example
   * ```typescript
   * // Simple append
   * const payload = new TextEncoder().encode(JSON.stringify({
   *   sha: 'abc123',
   *   type: 'blob',
   *   timestamp: Date.now()
   * }))
   * const entryId = await wal.append('PUT', payload)
   *
   * // Append within transaction
   * const txId = await wal.beginTransaction()
   * await wal.append('PUT', payload, txId)
   * ```
   */
  async append(operation: WALOperationType, payload: Uint8Array, transactionId?: string): Promise<number> {
    const result = this.storage.sql.exec(
      'INSERT INTO wal (operation, payload, transaction_id) VALUES (?, ?, ?)',
      operation,
      payload,
      transactionId ?? null
    )

    const rows = result.toArray() as { id: number }[]
    const entryId = rows[0]?.id ?? this.currentWalPosition + 1
    this.currentWalPosition = entryId

    // Track operation in transaction if applicable
    if (transactionId) {
      const tx = this.transactions.get(transactionId)
      if (tx) {
        tx.operations.push(entryId)
      }
    }

    return entryId
  }

  /**
   * Flush all unflushed WAL entries.
   *
   * @description
   * Marks all unflushed entries as flushed, indicating they have been
   * durably persisted. This is typically called before creating a checkpoint.
   *
   * @returns The number of entries that were flushed
   *
   * @example
   * ```typescript
   * const count = await wal.flush()
   * console.log(`Flushed ${count} entries`)
   * ```
   */
  async flush(): Promise<number> {
    // Get count of unflushed entries
    const countResult = this.storage.sql.exec(
      'SELECT COUNT(*) as count FROM wal WHERE flushed = 0'
    )
    const countRows = countResult.toArray() as { count: number }[]
    const count = countRows[0]?.count ?? 0

    if (count === 0) {
      return 0
    }

    // Mark all unflushed entries as flushed
    this.storage.sql.exec('UPDATE wal SET flushed = 1 WHERE flushed = 0')

    return count
  }

  /**
   * Recover unflushed WAL entries for replay.
   *
   * @description
   * Returns all unflushed WAL entries in order for replay during
   * crash recovery. Entries should be replayed in order by ID.
   *
   * @returns Array of unflushed WAL entries sorted by ID
   *
   * @example
   * ```typescript
   * const entries = await wal.recover()
   * for (const entry of entries) {
   *   console.log(`Replaying ${entry.operation} ${entry.id}`)
   *   // Apply the operation...
   * }
   * ```
   */
  async recover(): Promise<WALEntry[]> {
    const result = this.storage.sql.exec(
      'SELECT id, operation, payload, transaction_id, created_at, flushed FROM wal WHERE flushed = 0 ORDER BY id ASC'
    )

    const rows = result.toArray() as WALEntry[]
    return rows.sort((a, b) => a.id - b.id)
  }

  /**
   * Begin a new transaction.
   *
   * @description
   * Starts a new transaction and returns its ID. Operations appended
   * with this transaction ID will be atomically committed or rolled back.
   *
   * @returns The unique transaction ID
   *
   * @example
   * ```typescript
   * const txId = await wal.beginTransaction()
   * try {
   *   await wal.append('PUT', payload1, txId)
   *   await wal.append('DELETE', payload2, txId)
   *   await wal.commitTransaction(txId)
   * } catch (e) {
   *   await wal.rollbackTransaction(txId)
   * }
   * ```
   */
  async beginTransaction(): Promise<string> {
    const txId = generateTransactionId()

    const transaction: Transaction = {
      id: txId,
      state: 'ACTIVE',
      startedAt: Date.now(),
      operations: []
    }

    this.transactions.set(txId, transaction)

    // Log transaction begin
    this.storage.sql.exec(
      'INSERT INTO transactions (id, state) VALUES (?, ?)',
      txId,
      'ACTIVE'
    )

    // Append TX_BEGIN entry to WAL
    await this.append('TX_BEGIN', new TextEncoder().encode(JSON.stringify({ txId })), txId)

    return txId
  }

  /**
   * Commit a transaction.
   *
   * @description
   * Commits all operations in the transaction, making them permanent.
   * After commit, the transaction cannot be rolled back.
   *
   * @param transactionId - The transaction ID to commit
   * @throws Error if transaction not found or not active
   *
   * @example
   * ```typescript
   * const txId = await wal.beginTransaction()
   * await wal.append('PUT', payload, txId)
   * await wal.commitTransaction(txId)
   * // Transaction is now committed
   * ```
   */
  async commitTransaction(transactionId: string): Promise<void> {
    const tx = this.transactions.get(transactionId)

    if (!tx) {
      // Check if transaction exists in storage
      const result = this.storage.sql.exec(
        'SELECT id, state FROM transactions WHERE id = ?',
        transactionId
      )
      const rows = result.toArray() as Transaction[]
      if (rows.length === 0) {
        throw new Error('Transaction not found')
      }
      throw new Error('Transaction not active')
    }

    if (tx.state !== 'ACTIVE') {
      throw new Error('Transaction not active')
    }

    // Append TX_COMMIT entry to WAL
    await this.append('TX_COMMIT', new TextEncoder().encode(JSON.stringify({ txId: transactionId })), transactionId)

    // Update transaction state
    tx.state = 'COMMITTED'
    this.storage.sql.exec(
      'UPDATE transactions SET state = ? WHERE id = ?',
      'COMMITTED',
      transactionId
    )
  }

  /**
   * Rollback a transaction.
   *
   * @description
   * Rolls back all operations in the transaction, undoing their effects.
   * After rollback, the transaction is marked as rolled back.
   *
   * @param transactionId - The transaction ID to rollback
   * @throws Error if transaction not found or not active
   *
   * @example
   * ```typescript
   * const txId = await wal.beginTransaction()
   * try {
   *   await wal.append('PUT', payload, txId)
   *   throw new Error('Something went wrong')
   * } catch (e) {
   *   await wal.rollbackTransaction(txId)
   *   // All operations in transaction are undone
   * }
   * ```
   */
  async rollbackTransaction(transactionId: string): Promise<void> {
    const tx = this.transactions.get(transactionId)

    if (!tx) {
      const result = this.storage.sql.exec(
        'SELECT id, state FROM transactions WHERE id = ?',
        transactionId
      )
      const rows = result.toArray() as Transaction[]
      if (rows.length === 0) {
        throw new Error('Transaction not found')
      }
      throw new Error('Transaction not active')
    }

    if (tx.state !== 'ACTIVE') {
      throw new Error('Transaction not active')
    }

    // Delete transaction entries from WAL (except TX_BEGIN)
    this.storage.sql.exec(
      'DELETE FROM wal WHERE transaction_id = ? AND operation NOT IN (?, ?)',
      transactionId,
      'TX_BEGIN',
      'TX_ROLLBACK'
    )

    // Append TX_ROLLBACK entry to WAL
    await this.append('TX_ROLLBACK', new TextEncoder().encode(JSON.stringify({ txId: transactionId })), transactionId)

    // Update transaction state
    tx.state = 'ROLLED_BACK'
    this.storage.sql.exec(
      'UPDATE transactions SET state = ? WHERE id = ?',
      'ROLLED_BACK',
      transactionId
    )
  }

  /**
   * Get the state of a transaction.
   *
   * @description
   * Returns the current state of a transaction, checking both in-memory
   * cache and persistent storage.
   *
   * @param transactionId - The transaction ID to check
   * @returns Transaction state or null if not found
   *
   * @example
   * ```typescript
   * const state = await wal.getTransactionState(txId)
   * if (state === 'COMMITTED') {
   *   console.log('Transaction was committed')
   * }
   * ```
   */
  async getTransactionState(transactionId: string): Promise<TransactionState | null> {
    const tx = this.transactions.get(transactionId)
    if (tx) {
      return tx.state
    }

    const result = this.storage.sql.exec(
      'SELECT state FROM transactions WHERE id = ?',
      transactionId
    )
    const rows = result.toArray() as { state: TransactionState }[]
    return rows.length > 0 ? rows[0].state : null
  }

  /**
   * Create a checkpoint at the current WAL position.
   *
   * @description
   * Creates a checkpoint marking a consistent point where all prior
   * operations have been successfully applied. Flushes pending entries first.
   *
   * @param metadata - Optional descriptive metadata for the checkpoint
   * @returns The created checkpoint
   *
   * @example
   * ```typescript
   * // Create checkpoint after batch of operations
   * const checkpoint = await wal.createCheckpoint('Post-push checkpoint')
   * console.log(`Checkpoint at position ${checkpoint.walPosition}`)
   * ```
   */
  async createCheckpoint(metadata?: string): Promise<Checkpoint> {
    // Flush all pending entries before creating checkpoint
    await this.flush()

    // Get current WAL position
    const countResult = this.storage.sql.exec(
      'SELECT MAX(id) as max_id FROM wal'
    )
    const countRows = countResult.toArray() as { max_id: number | null }[]
    const walPosition = countRows[0]?.max_id ?? 0

    // Create checkpoint entry
    const result = this.storage.sql.exec(
      'INSERT INTO checkpoints (wal_position, metadata) VALUES (?, ?)',
      walPosition,
      metadata ?? null
    )

    const rows = result.toArray() as { id: number }[]
    const checkpointId = rows[0]?.id ?? 1

    const checkpoint: Checkpoint = {
      id: checkpointId,
      walPosition,
      createdAt: Date.now(),
      metadata: metadata ?? null
    }

    return checkpoint
  }

  /**
   * Get the most recent checkpoint.
   *
   * @description
   * Returns the last checkpoint created, or null if none exist.
   * Useful for determining where to start recovery.
   *
   * @returns The last checkpoint or null
   *
   * @example
   * ```typescript
   * const lastCheckpoint = await wal.getLastCheckpoint()
   * if (lastCheckpoint) {
   *   console.log(`Last checkpoint at position ${lastCheckpoint.walPosition}`)
   * }
   * ```
   */
  async getLastCheckpoint(): Promise<Checkpoint | null> {
    const result = this.storage.sql.exec(
      'SELECT id, wal_position, created_at, metadata FROM checkpoints ORDER BY id DESC LIMIT 1'
    )

    const rows = result.toArray() as Checkpoint[]
    return rows.length > 0 ? rows[0] : null
  }

  /**
   * Truncate WAL entries before a checkpoint.
   *
   * @description
   * Removes all WAL entries before (and including) the checkpoint position
   * that have been flushed. This reclaims space after a successful checkpoint.
   *
   * **Note**: Only truncates flushed entries to avoid data loss.
   *
   * @param checkpoint - The checkpoint to truncate before
   *
   * @example
   * ```typescript
   * const checkpoint = await wal.createCheckpoint()
   * // After verifying all operations are applied...
   * await wal.truncateBeforeCheckpoint(checkpoint)
   * ```
   */
  async truncateBeforeCheckpoint(checkpoint: Checkpoint): Promise<void> {
    this.storage.sql.exec(
      'DELETE FROM wal WHERE id <= ? AND flushed = 1',
      checkpoint.walPosition
    )
  }

  /**
   * Get the count of unflushed WAL entries.
   *
   * @description
   * Returns the number of WAL entries that have not yet been flushed.
   * Useful for monitoring WAL growth and deciding when to flush.
   *
   * @returns Number of unflushed entries
   *
   * @example
   * ```typescript
   * const count = await wal.getUnflushedCount()
   * if (count > 1000) {
   *   await wal.flush()
   * }
   * ```
   */
  async getUnflushedCount(): Promise<number> {
    const result = this.storage.sql.exec(
      'SELECT COUNT(*) as count FROM wal WHERE flushed = 0'
    )

    const rows = result.toArray() as { count: number }[]
    return rows[0]?.count ?? 0
  }
}
