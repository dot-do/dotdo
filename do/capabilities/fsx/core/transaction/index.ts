/**
 * @fileoverview Transaction module for atomic file system operations.
 *
 * This module provides a Transaction class and related types for building
 * sequences of file operations that execute atomically with rollback support.
 *
 * @example Basic usage
 * ```typescript
 * import { Transaction } from './transaction'
 *
 * const tx = new Transaction()
 *   .writeFile('/config.json', JSON.stringify(config))
 *   .mkdir('/logs', { recursive: true })
 *   .rename('/temp/output.txt', '/final/output.txt')
 *
 * await tx.execute(storage)
 * ```
 *
 * @example Using static factory methods
 * ```typescript
 * // Atomic file swap
 * const tx = Transaction.atomicSwap('/config.json', configData)
 *
 * // Git-style lock swap
 * const tx = Transaction.atomicLockSwap('/refs/heads/main', sha)
 *
 * // Batch writes
 * const tx = Transaction.writeAll([
 *   ['/a.txt', dataA],
 *   ['/b.txt', dataB],
 * ])
 * ```
 *
 * @example Type-safe operation inspection
 * ```typescript
 * const writes = tx.getOperationsByType('write')
 * for (const write of writes) {
 *   console.log(write.path, write.data.length)
 * }
 * ```
 *
 * @module transaction
 */

// =============================================================================
// Main Transaction Class
// =============================================================================

export { Transaction } from './transaction.js'

// =============================================================================
// Operation Types (Discriminated Union)
// =============================================================================

export type {
  // Main union type
  Operation,
  OperationType,
  OperationByType,

  // Individual operation types
  WriteOperation,
  DeleteOperation,
  UnlinkOperation,
  RmOperation,
  RmdirOperation,
  RenameOperation,
  MkdirOperation,
} from './transaction.js'

// =============================================================================
// Options Types
// =============================================================================

export type {
  // Write options
  WriteFileOptions,
  BufferEncoding,

  // Delete options
  RmOptions,
  RmdirOptions,

  // Mkdir options
  MkdirOptions,
} from './transaction.js'

// =============================================================================
// Transaction Types
// =============================================================================

export type {
  // Status
  TransactionStatus,

  // Storage interface
  TransactionStorage,

  // Execution options
  TransactionExecuteOptions,
  TransactionLogger,

  // Metrics
  TransactionMetrics,

  // Rollback
  RollbackSummary,
} from './transaction.js'
