/**
 * @fileoverview Transaction module for atomic file system operations.
 *
 * This module provides a Transaction class that allows queuing multiple
 * file system operations (write, delete, rename, mkdir) and executing
 * them atomically with rollback support on failure.
 *
 * @example
 * ```typescript
 * import { Transaction } from './transaction'
 *
 * const tx = new Transaction()
 *   .writeFile('/config.json', JSON.stringify(config), { mode: 0o644 })
 *   .mkdir('/logs', { recursive: true })
 *   .rename('/temp/output.txt', '/final/output.txt')
 *
 * await tx.execute(storage)
 * ```
 *
 * @module transaction
 */

/**
 * Supported encodings for string data in write operations.
 *
 * Currently only 'utf-8' is supported as it is the web platform standard.
 * Additional encodings may be added in the future.
 */
export type BufferEncoding = 'utf-8' | 'utf8'

/**
 * Options for write file operations.
 *
 * These options mirror the Node.js fs.writeFile options interface,
 * providing control over file permissions, write behavior, and encoding.
 *
 * @example
 * ```typescript
 * // Create an executable script with exclusive write
 * tx.writeFile('/script.sh', '#!/bin/bash\necho hello', {
 *   mode: 0o755,
 *   flag: 'wx',
 *   encoding: 'utf-8'
 * })
 * ```
 */
export interface WriteFileOptions {
  /**
   * File mode (permission bits) for the new file.
   *
   * Uses Unix-style octal notation (e.g., 0o644 for rw-r--r--).
   * Note: Mode may be affected by the process umask.
   *
   * @default 0o666
   *
   * @example
   * ```typescript
   * // Read-only file
   * { mode: 0o444 }
   *
   * // Executable script
   * { mode: 0o755 }
   *
   * // Private file (owner read/write only)
   * { mode: 0o600 }
   * ```
   */
  mode?: number

  /**
   * Write flag controlling how the file is opened.
   *
   * - 'w': Open for writing, creating or truncating (default)
   * - 'wx': Like 'w' but fails if file exists (exclusive create)
   * - 'a': Open for appending, creating if doesn't exist
   *
   * @default 'w'
   *
   * @example
   * ```typescript
   * // Fail if file already exists (atomic create)
   * { flag: 'wx' }
   *
   * // Append to existing file or create new
   * { flag: 'a' }
   * ```
   */
  flag?: 'w' | 'wx' | 'a'

  /**
   * Character encoding for string data.
   *
   * When data is provided as a string, this encoding is used to convert
   * it to bytes. Only UTF-8 encoding is currently supported.
   *
   * @default 'utf-8'
   *
   * @example
   * ```typescript
   * // Explicit UTF-8 encoding (default)
   * tx.writeFile('/file.txt', 'Hello World', { encoding: 'utf-8' })
   * ```
   */
  encoding?: BufferEncoding
}

/**
 * Represents a queued write operation in a transaction.
 *
 * Write operations store the target path, binary data, and optional
 * configuration for file permissions and write behavior.
 */
export type WriteOperation = {
  /** Operation type identifier */
  type: 'write'
  /** Absolute path where the file will be written */
  path: string
  /** Binary data to write (strings are pre-converted to Uint8Array) */
  data: Uint8Array
  /** Optional write configuration (mode, flag, encoding) */
  options?: WriteFileOptions
}

/**
 * Represents a queued delete operation in a transaction.
 *
 * @deprecated Use UnlinkOperation for POSIX-compliant semantics
 */
export type DeleteOperation = {
  type: 'delete' | 'unlink'
  path: string
}

/**
 * Options for rm operations (remove files or directories).
 *
 * These options mirror the Node.js fs.rm options, providing control over
 * how missing files are handled and whether directories are removed recursively.
 *
 * @example
 * ```typescript
 * // Force remove (ignore if file doesn't exist)
 * tx.rm('/maybe-exists.txt', { force: true })
 *
 * // Remove directory and all contents (like rm -r)
 * tx.rm('/mydir', { recursive: true })
 *
 * // Equivalent to rm -rf (safe cleanup)
 * tx.rm('/temp', { force: true, recursive: true })
 * ```
 */
export interface RmOptions {
  /**
   * If true, ignore nonexistent files and arguments.
   *
   * When `force` is true:
   * - No error is thrown if the path does not exist
   * - Useful for cleanup operations where files may or may not exist
   *
   * When `force` is false (default):
   * - An error is thrown if the path does not exist (ENOENT)
   *
   * @default false
   *
   * @example
   * ```typescript
   * // This won't error even if the file doesn't exist
   * tx.rm('/maybe-exists.txt', { force: true })
   * ```
   */
  force?: boolean

  /**
   * If true, remove directories and their contents recursively.
   *
   * When `recursive` is true:
   * - Directories and all their contents are removed
   * - Works like `rm -r` on Unix systems
   *
   * When `recursive` is false (default):
   * - Only files can be removed
   * - Attempting to remove a directory throws an error (EISDIR)
   *
   * @default false
   *
   * @example
   * ```typescript
   * // Remove a directory and all its contents
   * tx.rm('/mydir', { recursive: true })
   * ```
   */
  recursive?: boolean
}

/**
 * Represents a queued unlink operation in a transaction.
 *
 * Unlink removes a file from the filesystem. Unlike rm(), unlink does not
 * support options and will fail if the file doesn't exist or is a directory.
 *
 * @see {@link RmOperation} for more flexible removal with options
 */
export type UnlinkOperation = {
  /** Operation type identifier */
  type: 'unlink'
  /** Absolute path to the file to remove */
  path: string
}

/**
 * Represents a queued rm operation in a transaction.
 *
 * The rm operation provides flexible file and directory removal with
 * options for handling missing files (force) and recursive deletion.
 *
 * @see {@link RmOptions} for available options
 */
export type RmOperation = {
  /** Operation type identifier */
  type: 'rm'
  /** Absolute path to remove (file or directory) */
  path: string
  /** Optional configuration for rm behavior */
  options?: RmOptions
}

/**
 * Options for rmdir operations (remove directories).
 *
 * These options control whether the directory must be empty or can be
 * removed with all its contents.
 *
 * @example
 * ```typescript
 * // Remove an empty directory
 * tx.rmdir('/empty-dir')
 *
 * // Remove a directory with contents
 * tx.rmdir('/non-empty-dir', { recursive: true })
 * ```
 */
export interface RmdirOptions {
  /**
   * If true, remove directory and its contents recursively.
   *
   * When `recursive` is true:
   * - Directory and all nested files/directories are removed
   * - Works like `rm -r` on Unix systems
   *
   * When `recursive` is false (default):
   * - Only empty directories can be removed
   * - Attempting to remove a non-empty directory throws an error (ENOTEMPTY)
   *
   * @default false
   *
   * @example
   * ```typescript
   * // Remove a non-empty directory
   * tx.rmdir('/logs', { recursive: true })
   * ```
   */
  recursive?: boolean
}

/**
 * Represents a queued rmdir operation in a transaction.
 *
 * The rmdir operation removes directories. By default, it only removes
 * empty directories. With `recursive: true`, it removes directories
 * and all their contents.
 *
 * @see {@link RmdirOptions} for available options
 */
export type RmdirOperation = {
  /** Operation type identifier */
  type: 'rmdir'
  /** Absolute path to the directory to remove */
  path: string
  /** Optional configuration for rmdir behavior */
  options?: RmdirOptions
}

/**
 * Options for rename/move operations within transactions.
 *
 * These options provide enhanced control over cross-directory moves,
 * including automatic parent directory creation.
 *
 * @example
 * ```typescript
 * // Auto-create destination directory if it doesn't exist
 * tx.move('/source/file.txt', '/new/deep/path/file.txt', { mkdirp: true })
 *
 * // Prevent overwriting existing files
 * tx.rename('/a.txt', '/b.txt', { overwrite: false })
 * ```
 */
export interface RenameOptions {
  /**
   * Automatically create parent directories for the destination path.
   *
   * When true, behaves like combining mkdir -p with the rename operation.
   * This is particularly useful for cross-directory moves where the
   * destination directory may not exist.
   *
   * @default false
   *
   * @example
   * ```typescript
   * // Without mkdirp, this would fail if /dest doesn't exist
   * tx.move('/source/file.txt', '/dest/file.txt', { mkdirp: true })
   * ```
   */
  mkdirp?: boolean

  /**
   * Allow overwriting existing files at the destination.
   *
   * When false, the operation will fail if a file already exists at newPath.
   * When true (default), existing files will be overwritten.
   *
   * @default true
   *
   * @example
   * ```typescript
   * // Fail if /new.txt already exists
   * tx.rename('/old.txt', '/new.txt', { overwrite: false })
   * ```
   */
  overwrite?: boolean
}

export type RenameOperation = {
  type: 'rename'
  oldPath: string
  newPath: string
  options?: RenameOptions
}

/**
 * Options for mkdir operations within transactions
 */
export interface MkdirOptions {
  /**
   * Create parent directories as needed (like mkdir -p)
   * @default false
   */
  recursive?: boolean
  /**
   * File mode (permission bits) for the new directory
   * @default 0o777
   */
  mode?: number
}

export type MkdirOperation = {
  type: 'mkdir'
  path: string
  options?: MkdirOptions
}

/**
 * Union type of all supported transaction operations.
 *
 * This discriminated union allows type-safe pattern matching on operation types:
 *
 * @example Type-safe operation handling
 * ```typescript
 * for (const op of tx.operations) {
 *   switch (op.type) {
 *     case 'write':
 *       console.log(`Write ${op.data.length} bytes to ${op.path}`)
 *       break
 *     case 'rename':
 *       console.log(`Rename ${op.oldPath} -> ${op.newPath}`)
 *       break
 *     case 'mkdir':
 *       console.log(`Create directory ${op.path}`)
 *       break
 *     // TypeScript ensures all cases are handled
 *   }
 * }
 * ```
 */
export type Operation = WriteOperation | DeleteOperation | UnlinkOperation | RmOperation | RmdirOperation | RenameOperation | MkdirOperation

/**
 * Extract operation type discriminator values.
 *
 * @example
 * ```typescript
 * const opType: OperationType = 'write' // Type-safe
 * ```
 */
export type OperationType = Operation['type']

/**
 * Extract a specific operation type from the union.
 *
 * @example
 * ```typescript
 * type Write = OperationByType<'write'> // WriteOperation
 * type Delete = OperationByType<'delete'> // DeleteOperation
 * ```
 */
export type OperationByType<T extends OperationType> = Extract<Operation, { type: T }>

/**
 * Current status of a transaction.
 *
 * - `'pending'`: Transaction can accept new operations and has not been executed
 * - `'committed'`: Transaction executed successfully, all operations completed
 * - `'rolled_back'`: Transaction failed and all completed operations were reversed
 */
export type TransactionStatus = 'pending' | 'committed' | 'rolled_back'

// ============================================================================
// Logging and Options Interfaces
// ============================================================================

/**
 * Logger interface for transaction operations.
 *
 * Allows integration with any logging system (console, winston, pino, etc.)
 * for debugging and monitoring transaction execution.
 *
 * @example
 * ```typescript
 * const logger: TransactionLogger = {
 *   debug: (msg, ...args) => console.debug(`[TX] ${msg}`, ...args),
 *   info: (msg, ...args) => console.info(`[TX] ${msg}`, ...args),
 *   warn: (msg, ...args) => console.warn(`[TX] ${msg}`, ...args),
 *   error: (msg, ...args) => console.error(`[TX] ${msg}`, ...args),
 * }
 * ```
 */
export interface TransactionLogger {
  /** Log debug-level information (operation details, state changes) */
  debug(message: string, ...args: unknown[]): void
  /** Log info-level information (transaction start/commit/rollback) */
  info(message: string, ...args: unknown[]): void
  /** Log warning-level information (rollback failures, partial state) */
  warn(message: string, ...args: unknown[]): void
  /** Log error-level information (failures, exceptions) */
  error(message: string, ...args: unknown[]): void
}

/**
 * Default no-op logger that silently discards all log messages.
 * Used when no logger is provided to avoid null checks.
 */
const noopLogger: TransactionLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

/**
 * Options for transaction execution.
 *
 * @example
 * ```typescript
 * await tx.execute(storage, {
 *   logger: console,
 *   dryRun: true,
 *   transactionId: 'tx-123'
 * })
 * ```
 */
export interface TransactionExecuteOptions {
  /**
   * Logger instance for debugging and monitoring.
   * If not provided, no logging occurs.
   */
  logger?: TransactionLogger

  /**
   * When true, simulates execution without making changes.
   * Validates operations and logs what would happen.
   * @default false
   */
  dryRun?: boolean

  /**
   * Transaction ID for correlation in logs.
   * Auto-generated if not provided.
   */
  transactionId?: string

  /**
   * When true, use database-level transaction if storage supports it.
   *
   * Database-level transactions provide true ACID guarantees:
   * - **Atomicity**: All operations commit or none do
   * - **Consistency**: Database constraints are enforced
   * - **Isolation**: Concurrent transactions don't interfere
   * - **Durability**: Committed data survives crashes
   *
   * When false or when storage doesn't support beginTransaction(),
   * falls back to application-level rollback (best effort).
   *
   * @default true
   */
  useDbTransaction?: boolean

  /**
   * Transaction timeout in milliseconds.
   *
   * If the transaction takes longer than this duration, it will be
   * automatically rolled back with a timeout error.
   *
   * @default undefined (no timeout)
   */
  timeoutMs?: number

  /**
   * When true, capture previous file content before overwriting.
   *
   * This enables content-preserving rollback for overwrites but adds
   * I/O overhead. When false, overwritten files cannot be restored
   * during rollback (they will be deleted instead).
   *
   * @default true
   */
  captureContent?: boolean

  /**
   * Callback for transaction metrics/timing.
   *
   * Receives detailed timing information after transaction completes
   * (whether successful or rolled back).
   */
  onMetrics?: (metrics: TransactionMetrics) => void
}

/**
 * Transaction timing and performance metrics.
 */
export interface TransactionMetrics {
  /** Transaction ID for correlation */
  transactionId: string
  /** Total transaction duration in milliseconds */
  totalDurationMs: number
  /** Time spent executing operations */
  operationDurationMs: number
  /** Time spent on rollback (if applicable) */
  rollbackDurationMs?: number
  /** Number of operations executed */
  operationsExecuted: number
  /** Number of operations rolled back */
  operationsRolledBack?: number
  /** Whether database-level transaction was used */
  usedDbTransaction: boolean
  /** Final transaction status */
  status: TransactionStatus
  /** Error message if failed */
  errorMessage?: string
}

/**
 * Represents a completed operation that may need to be rolled back.
 * Captures enough information to undo the operation.
 * @internal
 */
interface CompletedOperation {
  /** Type of operation that was completed */
  type: 'write' | 'delete' | 'rename' | 'mkdir' | 'unlink' | 'rm' | 'rmdir'
  /** Primary path affected by the operation */
  path: string
  /** Secondary path for rename operations (the new path after rename) */
  newPath?: string
  /** Original content for operations that modified existing files */
  previousContent?: Uint8Array
  /** Whether the file existed before the operation */
  existed?: boolean
  /** Timestamp when the operation completed */
  completedAt: number
}

/**
 * Result of rolling back a single operation.
 */
interface RollbackResult {
  /** Path that was rolled back */
  path: string
  /** Whether rollback succeeded */
  success: boolean
  /** Error message if rollback failed */
  error?: string
  /** Full error object if rollback failed */
  errorObject?: Error
}

/**
 * Summary of a transaction rollback operation.
 */
export interface RollbackSummary {
  /** Transaction ID for correlation */
  transactionId: string
  /** Total operations that needed rollback */
  totalOperations: number
  /** Number of operations successfully rolled back */
  successCount: number
  /** Number of operations that failed to roll back */
  failureCount: number
  /** Detailed results for each rollback operation */
  results: RollbackResult[]
  /** Overall duration of rollback in milliseconds */
  durationMs: number
}

/**
 * Generate a unique transaction ID for correlation in logs.
 * @internal
 */
function generateTransactionId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `tx-${timestamp}-${random}`
}

// ============================================================================
// Storage Interface
// ============================================================================

/**
 * Storage interface for transaction execution.
 *
 * Implementations must provide writeFile at minimum. Other methods are optional
 * and operations will be skipped if the corresponding method is not provided.
 *
 * For content-preserving rollback, implement `readFile` and `exists` methods.
 *
 * @example
 * ```typescript
 * const storage: TransactionStorage = {
 *   writeFile: async (path, data) => { ... },
 *   readFile: async (path) => { ... },   // For content-preserving rollback
 *   exists: async (path) => { ... },      // For tracking file existence
 *   unlink: async (path) => { ... },
 *   rm: async (path, options) => { ... },
 *   rmdir: async (path, options) => { ... },
 *   rename: async (oldPath, newPath) => { ... },
 *   mkdir: async (path, options) => { ... },
 * }
 * ```
 */
export interface TransactionStorage {
  /** Write a file to storage (required) */
  writeFile(path: string, data: Uint8Array): Promise<void>

  /**
   * Read file content (enables content-preserving rollback).
   * If not provided, overwritten files cannot be restored during rollback.
   */
  readFile?(path: string): Promise<Uint8Array>

  /**
   * Check if a file or directory exists.
   * Enables tracking whether files existed before operations.
   */
  exists?(path: string): Promise<boolean>

  /**
   * Remove a file (simple delete).
   * @deprecated Use rm() or unlink() instead
   */
  deleteFile?(path: string): Promise<void>

  /**
   * Unlink a file from the filesystem.
   *
   * Similar to POSIX unlink(2). Throws ENOENT if file doesn't exist.
   * Only removes files, not directories.
   */
  unlink?(path: string): Promise<void>

  /**
   * Remove a file or directory with options.
   *
   * @param path - Path to remove
   * @param options - Optional configuration
   * @param options.force - If true, ignore nonexistent files (no ENOENT error)
   * @param options.recursive - If true, remove directories and contents recursively
   */
  rm?(path: string, options?: RmOptions): Promise<void>

  /**
   * Remove an empty directory.
   *
   * @param path - Directory path to remove
   * @param options - Optional configuration
   * @param options.recursive - If true, remove directory and all contents
   */
  rmdir?(path: string, options?: RmdirOptions): Promise<void>

  /** Rename/move a file or directory */
  rename?(oldPath: string, newPath: string): Promise<void>

  /** Create a directory */
  mkdir?(path: string, options?: MkdirOptions): Promise<void>

  /**
   * Begin a database-level transaction.
   *
   * When implemented, the Transaction.execute() method will wrap all
   * operations in a database transaction for true ACID guarantees.
   * This provides better atomicity than application-level rollback
   * as the database handles consistency and durability.
   *
   * @param name - Optional savepoint name for nested transactions
   * @returns A commit/rollback interface
   */
  beginTransaction?(name?: string): Promise<{
    /** Commit the transaction, making all changes permanent */
    commit(): Promise<void>
    /** Rollback the transaction, discarding all changes */
    rollback(): Promise<void>
  }>
}

// ============================================================================
// Transaction Class
// ============================================================================

/**
 * Transaction class for building a sequence of file system operations.
 *
 * Provides a fluent, chainable API for queuing multiple file system operations
 * (write, delete, rename, mkdir) that can be executed atomically with automatic
 * rollback on failure.
 *
 * ## Key Features
 *
 * - **Atomic Execution**: All operations succeed or all are rolled back
 * - **Chainable API**: Fluent interface for building operation sequences
 * - **Type Safety**: Full TypeScript support with discriminated unions
 * - **Rollback Support**: Automatic cleanup on execution failure
 * - **Content Preservation**: Can restore overwritten file content during rollback
 * - **Logging**: Optional logging for debugging and monitoring
 * - **Dry Run**: Preview changes without executing
 *
 * ## Supported Operations
 *
 * | Operation | Method | Description |
 * |-----------|--------|-------------|
 * | Write | `writeFile()`, `writeFileString()` | Create or overwrite a file |
 * | Delete | `deleteFile()`, `unlink()` | Remove a file |
 * | Remove | `rm()`, `rmdir()` | Remove files/directories with options |
 * | Rename | `rename()`, `move()` | Move or rename a file/directory |
 * | Mkdir | `mkdir()` | Create a directory |
 *
 * @example Basic usage
 * ```typescript
 * const tx = new Transaction()
 *   .writeFile('/config.json', JSON.stringify(config))
 *   .mkdir('/logs', { recursive: true })
 *   .rename('/temp/output.txt', '/final/output.txt')
 *
 * await tx.execute(storage)
 * console.log(tx.status) // 'committed'
 * ```
 *
 * @example With logging and dry run
 * ```typescript
 * const tx = new Transaction()
 *   .writeFile('/important.txt', data)
 *
 * // Preview changes
 * await tx.execute(storage, { logger: console, dryRun: true })
 *
 * // Execute for real
 * await tx.execute(storage, { logger: console })
 * ```
 *
 * @example Atomic git ref update pattern
 * ```typescript
 * const tx = new Transaction()
 *   .writeFile('/refs/heads/main.lock', newSha, { flag: 'wx' })
 *   .rename('/refs/heads/main.lock', '/refs/heads/main')
 *
 * try {
 *   await tx.execute(fs)
 * } catch (err) {
 *   console.log('Ref update failed, lock released')
 * }
 * ```
 */
export class Transaction {
  /**
   * Queue of operations to be executed.
   *
   * Operations are stored in insertion order and executed sequentially.
   * Each operation is a discriminated union type for type-safe access.
   */
  public operations: Array<Operation> = []

  /**
   * Current transaction status.
   *
   * - `'pending'`: Transaction can accept new operations
   * - `'committed'`: Transaction executed successfully
   * - `'rolled_back'`: Transaction failed and was rolled back
   */
  public status: TransactionStatus = 'pending'

  /**
   * Rollback summary from the last failed execution.
   * Only populated if the transaction was rolled back.
   */
  public lastRollbackSummary?: RollbackSummary

  /**
   * Validates that the transaction is in a state where new operations can be added.
   *
   * @throws {Error} If transaction has already been committed or rolled back
   * @internal
   */
  private assertPending(): void {
    if (this.status !== 'pending') {
      throw new Error(`Cannot add operations to transaction with status '${this.status}'`)
    }
  }

  /**
   * Queue a write file operation with binary data.
   *
   * @param path - Absolute path where the file will be written
   * @param data - Binary data to write (Uint8Array)
   * @param options - Optional write configuration
   * @returns `this` for method chaining
   */
  writeFile(path: string, data: Uint8Array, options?: WriteFileOptions): this

  /**
   * Queue a write file operation with string data.
   *
   * The string is automatically converted to UTF-8 encoded Uint8Array.
   *
   * @param path - Absolute path where the file will be written
   * @param data - String data to write (will be UTF-8 encoded)
   * @param options - Optional write configuration
   * @returns `this` for method chaining
   */
  writeFile(path: string, data: string, options?: WriteFileOptions): this

  /**
   * Queue a write file operation.
   *
   * Writes data to the specified path. Accepts both binary (Uint8Array) and
   * string data. Strings are automatically converted to UTF-8.
   *
   * Supports optional configuration for file permissions, write behavior,
   * and encoding.
   *
   * @param path - Absolute path where the file will be written
   * @param data - Data to write (Uint8Array or string)
   * @param options - Optional write configuration
   * @returns `this` for method chaining
   *
   * @example Binary data write
   * ```typescript
   * const imageData = new Uint8Array([0x89, 0x50, 0x4E, 0x47, ...])
   * tx.writeFile('/image.png', imageData)
   * ```
   *
   * @example String data write
   * ```typescript
   * tx.writeFile('/hello.txt', 'Hello, World!')
   * tx.writeFile('/config.json', JSON.stringify(config, null, 2))
   * ```
   *
   * @example Write with permissions
   * ```typescript
   * tx.writeFile('/private.key', keyData, { mode: 0o600 })
   * ```
   *
   * @example Exclusive create (fail if exists)
   * ```typescript
   * tx.writeFile('/lock.pid', pidData, { flag: 'wx' })
   * ```
   */
  writeFile(path: string, data: Uint8Array | string, options?: WriteFileOptions): this {
    this.assertPending()

    // Convert string to Uint8Array
    const binaryData = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data

    const operation: WriteOperation = {
      type: 'write',
      path,
      data: binaryData
    }
    if (options && Object.keys(options).length > 0) {
      operation.options = { ...options }
    }
    this.operations.push(operation)
    return this
  }

  /**
   * Queue a write file operation with string data.
   *
   * Automatically converts string to Uint8Array using TextEncoder (UTF-8).
   * For binary data, use the `writeFile()` method with Uint8Array.
   *
   * @param path - Absolute path where the file will be written
   * @param data - String data to write (will be UTF-8 encoded)
   * @param options - Optional write configuration including encoding
   * @returns `this` for method chaining
   *
   * @example Simple text file
   * ```typescript
   * tx.writeFileString('/hello.txt', 'Hello, World!')
   * ```
   *
   * @example JSON configuration file
   * ```typescript
   * tx.writeFileString('/config.json', JSON.stringify(config, null, 2), {
   *   mode: 0o644
   * })
   * ```
   *
   * @example Executable script
   * ```typescript
   * tx.writeFileString('/deploy.sh', '#!/bin/bash\nnpm run build', {
   *   mode: 0o755
   * })
   * ```
   */
  writeFileString(path: string, data: string, options?: WriteFileOptions): this {
    this.assertPending()
    const encoder = new TextEncoder()
    const operation: WriteOperation = {
      type: 'write',
      path,
      data: encoder.encode(data)
    }
    if (options && Object.keys(options).length > 0) {
      operation.options = { ...options }
    }
    this.operations.push(operation)
    return this
  }

  /**
   * Queue a write file operation with explicit options.
   *
   * This method requires options to be provided, making the intent explicit.
   * For writes without options, use `writeFile()` instead.
   *
   * @param path - Absolute path where the file will be written
   * @param data - Binary data to write (Uint8Array)
   * @param options - Write configuration (mode, flag, encoding)
   * @returns `this` for method chaining
   *
   * @example Create executable with exclusive flag
   * ```typescript
   * tx.writeFileWithOptions('/script.sh', scriptBytes, {
   *   mode: 0o755,
   *   flag: 'wx'
   * })
   * ```
   *
   * @example Append to log file
   * ```typescript
   * tx.writeFileWithOptions('/app.log', logEntryBytes, {
   *   flag: 'a'
   * })
   * ```
   */
  writeFileWithOptions(path: string, data: Uint8Array, options: WriteFileOptions): this {
    this.assertPending()
    this.operations.push({
      type: 'write',
      path,
      data,
      options: { ...options }
    })
    return this
  }

  /**
   * Queue a delete file operation.
   * @param path - The path to delete
   * @returns this for chaining
   */
  deleteFile(path: string): this {
    this.assertPending()
    this.operations.push({
      type: 'unlink',
      path
    })
    return this
  }

  /**
   * Queue an unlink operation (remove a file).
   *
   * Similar to POSIX unlink(2), this removes a name from the filesystem.
   * If that name was the last link to a file and no processes have the
   * file open, the file is deleted.
   *
   * @param path - The path to unlink
   * @returns this for chaining
   *
   * @example
   * // Remove a single file
   * tx.unlink('/tmp/old-file.txt')
   *
   * @example
   * // Chain with other operations
   * tx.writeFile('/new.txt', data)
   *   .unlink('/old.txt')
   */
  unlink(path: string): this {
    this.assertPending()
    this.operations.push({
      type: 'unlink',
      path
    })
    return this
  }

  /**
   * Queue an rm operation (remove files or directories).
   *
   * Provides behavior similar to the `rm` command with options for
   * force and recursive removal.
   *
   * @param path - The path to remove
   * @param options - Optional configuration for rm behavior
   * @param options.force - If true, ignore nonexistent files
   * @param options.recursive - If true, remove directories recursively
   * @returns this for chaining
   *
   * @example
   * // Remove a file
   * tx.rm('/tmp/file.txt')
   *
   * @example
   * // Remove a directory recursively
   * tx.rm('/tmp/mydir', { recursive: true })
   *
   * @example
   * // Force remove (ignore if doesn't exist)
   * tx.rm('/maybe-exists.txt', { force: true })
   *
   * @example
   * // Equivalent to rm -rf
   * tx.rm('/tmp/dir', { force: true, recursive: true })
   */
  rm(path: string, options?: RmOptions): this {
    this.assertPending()
    // Copy options to prevent external mutation
    const opOptions = options ? { ...options } : undefined
    this.operations.push({
      type: 'rm',
      path,
      ...(opOptions && { options: opOptions })
    })
    return this
  }

  /**
   * Queue an rmdir operation (remove an empty directory).
   *
   * Similar to POSIX rmdir(2), this removes an empty directory.
   * With the recursive option, it can remove non-empty directories.
   *
   * @param path - The directory path to remove
   * @param options - Optional configuration for rmdir behavior
   * @param options.recursive - If true, remove directory and its contents
   * @returns this for chaining
   *
   * @example
   * // Remove an empty directory
   * tx.rmdir('/tmp/empty-dir')
   *
   * @example
   * // Remove a directory recursively
   * tx.rmdir('/tmp/non-empty-dir', { recursive: true })
   */
  rmdir(path: string, options?: RmdirOptions): this {
    this.assertPending()
    // Copy options to prevent external mutation
    const opOptions = options ? { ...options } : undefined
    this.operations.push({
      type: 'rmdir',
      path,
      ...(opOptions && { options: opOptions })
    })
    return this
  }

  /**
   * Queue a rename operation.
   *
   * Renames or moves a file from oldPath to newPath. Supports options for
   * auto-creating parent directories and controlling overwrite behavior.
   *
   * @param oldPath - The current path of the file
   * @param newPath - The new path for the file
   * @param options - Optional configuration for rename behavior
   * @param options.mkdirp - Auto-create parent directories for destination
   * @param options.overwrite - Allow overwriting existing files (default: true)
   * @returns this for chaining
   *
   * @example
   * // Simple rename in same directory
   * tx.rename('/old.txt', '/new.txt')
   *
   * @example
   * // Cross-directory move with auto-mkdir
   * tx.rename('/source/file.txt', '/new/path/file.txt', { mkdirp: true })
   *
   * @example
   * // Prevent overwriting existing files
   * tx.rename('/a.txt', '/b.txt', { overwrite: false })
   */
  rename(oldPath: string, newPath: string, options?: RenameOptions): this {
    this.assertPending()
    const op: RenameOperation = {
      type: 'rename',
      oldPath,
      newPath
    }
    if (options && Object.keys(options).length > 0) {
      op.options = { ...options }
    }
    this.operations.push(op)
    return this
  }

  /**
   * Queue a move operation (alias for rename).
   *
   * This is semantically identical to rename but provides a more intuitive
   * name when moving files between directories.
   *
   * @param oldPath - The current path
   * @param newPath - The new path
   * @param options - Optional configuration for move behavior
   * @param options.mkdirp - Auto-create parent directories for destination
   * @param options.overwrite - Allow overwriting existing files (default: true)
   * @returns this for chaining
   *
   * @example
   * // Move a file to a different directory
   * tx.move('/source/file.txt', '/dest/file.txt')
   *
   * @example
   * // Move with auto-mkdir for cross-directory moves
   * tx.move('/source/file.txt', '/dest/subdir/file.txt', { mkdirp: true })
   *
   * @example
   * // Chain with other operations
   * tx.mkdir('/dest')
   *   .move('/source/file.txt', '/dest/file.txt')
   */
  move(oldPath: string, newPath: string, options?: RenameOptions): this {
    return this.rename(oldPath, newPath, options)
  }

  /**
   * Queue a mkdir operation.
   *
   * Creates a directory at the specified path. When `recursive` is true,
   * creates parent directories as needed (like `mkdir -p`).
   *
   * @param path - The directory path to create
   * @param options - Optional configuration for mkdir behavior
   * @param options.recursive - If true, creates parent directories as needed
   * @param options.mode - File mode (permission bits) for the new directory
   * @returns this for chaining
   *
   * @example
   * // Create a single directory
   * tx.mkdir('/home/user/newdir')
   *
   * @example
   * // Create nested directories recursively
   * tx.mkdir('/home/user/a/b/c', { recursive: true })
   *
   * @example
   * // Create with specific permissions
   * tx.mkdir('/home/user/restricted', { mode: 0o700 })
   */
  mkdir(path: string, options?: MkdirOptions): this {
    this.assertPending()
    // Only include options if provided and non-empty
    const hasOptions = options && Object.keys(options).length > 0
    this.operations.push({
      type: 'mkdir',
      path,
      ...(hasOptions && { options })
    })
    return this
  }

  // ============================================================================
  // Type-Safe Operation Accessors
  // ============================================================================

  /**
   * Get the number of queued operations.
   *
   * @returns The count of operations in the queue
   *
   * @example
   * ```typescript
   * const tx = new Transaction()
   *   .writeFile('/a.txt', data)
   *   .mkdir('/dir')
   *
   * console.log(tx.size) // 2
   * ```
   */
  get size(): number {
    return this.operations.length
  }

  /**
   * Check if the transaction has any queued operations.
   *
   * @returns true if no operations are queued
   *
   * @example
   * ```typescript
   * const tx = new Transaction()
   * console.log(tx.isEmpty) // true
   *
   * tx.writeFile('/a.txt', data)
   * console.log(tx.isEmpty) // false
   * ```
   */
  get isEmpty(): boolean {
    return this.operations.length === 0
  }

  /**
   * Check if the transaction can accept new operations.
   *
   * @returns true if status is 'pending'
   *
   * @example
   * ```typescript
   * const tx = new Transaction()
   * console.log(tx.isPending) // true
   *
   * await tx.execute(storage)
   * console.log(tx.isPending) // false
   * ```
   */
  get isPending(): boolean {
    return this.status === 'pending'
  }

  /**
   * Check if the transaction was committed successfully.
   *
   * @returns true if status is 'committed'
   */
  get isCommitted(): boolean {
    return this.status === 'committed'
  }

  /**
   * Check if the transaction was rolled back.
   *
   * @returns true if status is 'rolled_back'
   */
  get isRolledBack(): boolean {
    return this.status === 'rolled_back'
  }

  /**
   * Filter operations by type with full type safety.
   *
   * Returns an array of operations of the specified type with proper
   * TypeScript narrowing applied.
   *
   * @param type - The operation type to filter by
   * @returns Array of operations of the specified type
   *
   * @example
   * ```typescript
   * const writes = tx.getOperationsByType('write')
   * // TypeScript knows writes is WriteOperation[]
   * for (const write of writes) {
   *   console.log(write.path, write.data.length)
   * }
   *
   * const renames = tx.getOperationsByType('rename')
   * // TypeScript knows renames is RenameOperation[]
   * for (const rename of renames) {
   *   console.log(rename.oldPath, '->', rename.newPath)
   * }
   * ```
   */
  getOperationsByType<T extends OperationType>(type: T): OperationByType<T>[] {
    return this.operations.filter((op): op is OperationByType<T> => op.type === type)
  }

  /**
   * Check if the transaction contains any operation of the specified type.
   *
   * @param type - The operation type to check for
   * @returns true if at least one operation of this type exists
   *
   * @example
   * ```typescript
   * if (tx.hasOperationType('write')) {
   *   console.log('Transaction will write files')
   * }
   * ```
   */
  hasOperationType(type: OperationType): boolean {
    return this.operations.some(op => op.type === type)
  }

  /**
   * Get all unique paths affected by the transaction.
   *
   * For rename operations, both oldPath and newPath are included.
   *
   * @returns Set of all paths affected by operations
   *
   * @example
   * ```typescript
   * const tx = new Transaction()
   *   .writeFile('/a.txt', data)
   *   .rename('/b.txt', '/c.txt')
   *
   * console.log(tx.affectedPaths) // Set { '/a.txt', '/b.txt', '/c.txt' }
   * ```
   */
  get affectedPaths(): Set<string> {
    const paths = new Set<string>()
    for (const op of this.operations) {
      if ('path' in op) {
        paths.add(op.path)
      }
      if (op.type === 'rename') {
        paths.add(op.oldPath)
        paths.add(op.newPath)
      }
    }
    return paths
  }

  // ============================================================================
  // Operation Ordering and Cross-Directory Move Helpers
  // ============================================================================

  /**
   * Check if a rename operation is a cross-directory move.
   *
   * A cross-directory move occurs when the parent directory of the source
   * and destination paths differ. This is useful for determining if
   * additional setup (like creating parent directories) may be needed.
   *
   * @param oldPath - Source path
   * @param newPath - Destination path
   * @returns true if the move crosses directory boundaries
   *
   * @example
   * ```typescript
   * Transaction.isCrossDirectoryMove('/a/file.txt', '/b/file.txt') // true
   * Transaction.isCrossDirectoryMove('/dir/old.txt', '/dir/new.txt') // false
   * ```
   */
  static isCrossDirectoryMove(oldPath: string, newPath: string): boolean {
    const getParent = (path: string): string => {
      const lastSlash = path.lastIndexOf('/')
      if (lastSlash <= 0) return '/'
      return path.slice(0, lastSlash)
    }
    return getParent(oldPath) !== getParent(newPath)
  }

  /**
   * Check if the rename at the given index is a cross-directory move.
   *
   * @param index - Index of the rename operation to check
   * @returns true if the operation is a cross-directory rename
   * @throws Error if index is out of bounds or operation is not a rename
   *
   * @example
   * ```typescript
   * tx.move('/source/file.txt', '/dest/file.txt')
   * tx.isCrossDirectoryRename(0) // true
   * ```
   */
  isCrossDirectoryRename(index: number): boolean {
    const op = this.operations[index]
    if (!op || op.type !== 'rename') {
      return false
    }
    return Transaction.isCrossDirectoryMove(op.oldPath, op.newPath)
  }

  /**
   * Get all rename operations that cross directory boundaries.
   *
   * @returns Array of rename operations that are cross-directory moves
   *
   * @example
   * ```typescript
   * const crossDirMoves = tx.getCrossDirectoryRenames()
   * for (const move of crossDirMoves) {
   *   console.log(`Moving ${move.oldPath} to ${move.newPath}`)
   * }
   * ```
   */
  getCrossDirectoryRenames(): RenameOperation[] {
    return this.getOperationsByType('rename').filter(
      op => Transaction.isCrossDirectoryMove(op.oldPath, op.newPath)
    )
  }

  // ============================================================================
  // Static Factory Methods
  // ============================================================================

  /**
   * Create a transaction for an atomic file swap operation.
   *
   * This pattern writes to a temporary file first, removes the original,
   * then renames the temp file to the target path. Useful for atomic updates.
   *
   * @param path - Target path for the file
   * @param data - Binary data to write
   * @param tempSuffix - Suffix for temporary file (default: '.tmp')
   * @returns A new Transaction with the swap operations queued
   *
   * @example
   * ```typescript
   * const tx = Transaction.atomicSwap('/config.json', configData)
   * await tx.execute(storage)
   * ```
   */
  static atomicSwap(path: string, data: Uint8Array, tempSuffix = '.tmp'): Transaction {
    const tempPath = path + tempSuffix
    return new Transaction()
      .writeFile(tempPath, data)
      .rm(path, { force: true })
      .rename(tempPath, path)
  }

  /**
   * Create a transaction for an atomic file swap using a lock file pattern.
   *
   * This pattern uses exclusive file creation (wx flag) to prevent concurrent
   * updates. Common in git ref updates.
   *
   * @param path - Target path for the file
   * @param data - Binary data to write
   * @param lockSuffix - Suffix for lock file (default: '.lock')
   * @returns A new Transaction with the lock-based swap operations queued
   *
   * @example
   * ```typescript
   * const tx = Transaction.atomicLockSwap('/refs/heads/main', newSha)
   * await tx.execute(storage)
   * ```
   */
  static atomicLockSwap(path: string, data: Uint8Array, lockSuffix = '.lock'): Transaction {
    const lockPath = path + lockSuffix
    return new Transaction()
      .writeFileWithOptions(lockPath, data, { flag: 'wx' })
      .rename(lockPath, path)
  }

  /**
   * Create a transaction for writing multiple files atomically.
   *
   * All files are written together - if any write fails, all are rolled back.
   *
   * @param files - Array of [path, data] tuples
   * @returns A new Transaction with all write operations queued
   *
   * @example
   * ```typescript
   * const tx = Transaction.writeAll([
   *   ['/config.json', configData],
   *   ['/state.json', stateData],
   *   ['/index.json', indexData],
   * ])
   * await tx.execute(storage)
   * ```
   */
  static writeAll(files: Array<[string, Uint8Array]>): Transaction {
    const tx = new Transaction()
    for (const [path, data] of files) {
      tx.writeFile(path, data)
    }
    return tx
  }

  /**
   * Create a transaction for deleting multiple files atomically.
   *
   * @param paths - Array of paths to delete
   * @param options - Optional rm options applied to all deletions
   * @returns A new Transaction with all delete operations queued
   *
   * @example
   * ```typescript
   * // Clean up temporary files
   * const tx = Transaction.deleteAll(['/tmp/a.txt', '/tmp/b.txt'], { force: true })
   * await tx.execute(storage)
   * ```
   */
  static deleteAll(paths: string[], options?: RmOptions): Transaction {
    const tx = new Transaction()
    for (const path of paths) {
      tx.rm(path, options)
    }
    return tx
  }

  /**
   * Create a transaction from an existing array of operations.
   *
   * Useful for deserializing saved transactions or programmatic construction.
   *
   * @param operations - Array of operations to add to the transaction
   * @returns A new Transaction with the operations queued
   *
   * @example
   * ```typescript
   * const ops: Operation[] = JSON.parse(savedOps)
   * const tx = Transaction.from(ops)
   * await tx.execute(storage)
   * ```
   */
  static from(operations: Operation[]): Transaction {
    const tx = new Transaction()
    tx.operations.push(...operations)
    return tx
  }

  // ============================================================================
  // Operation Ordering
  // ============================================================================

  /**
   * Priority order for operation types during execution.
   *
   * Operations are sorted to ensure:
   * 1. Directories exist before files are written to them (mkdir first)
   * 2. Files are written before they can be moved (write before rename)
   * 3. Renames complete before deletions (preserve atomic swap patterns)
   * 4. Deletions happen last (safe cleanup)
   *
   * @internal
   */
  private static readonly OPERATION_PRIORITY: Record<OperationType, number> = {
    'mkdir': 0,   // Create directories first
    'write': 1,   // Write files to those directories
    'rename': 2,  // Move/rename after files exist
    'delete': 3,  // Legacy delete type
    'unlink': 3,  // Remove files
    'rm': 3,      // Remove files/directories
    'rmdir': 4,   // Remove directories last (they should be empty)
  }

  /**
   * Get operations reordered for optimal execution.
   *
   * Reorders the queued operations to:
   * 1. mkdir operations (ensure directories exist)
   * 2. write operations (create/update files)
   * 3. rename operations (move/rename files)
   * 4. delete operations (rm, unlink, delete)
   * 5. rmdir operations (remove empty directories last)
   *
   * Within each type group, operations maintain their original insertion order
   * to preserve user intent for operations on the same path.
   *
   * @returns A new array with operations in optimal execution order
   *
   * @example
   * ```typescript
   * const tx = new Transaction()
   *   .writeFile('/dir/file.txt', data)  // Queued second
   *   .mkdir('/dir', { recursive: true }) // Queued first
   *
   * // Optimal order: mkdir first, then write
   * const ordered = tx.getOptimalOperationOrder()
   * // [{ type: 'mkdir', path: '/dir' }, { type: 'write', path: '/dir/file.txt' }]
   * ```
   */
  private getOptimalOperationOrder(): Operation[] {
    // Create a stable sort by tracking original indices
    const indexed = this.operations.map((op, index) => ({ op, index }))

    // Sort by operation type priority, then by original index for stability
    indexed.sort((a, b) => {
      const priorityA = Transaction.OPERATION_PRIORITY[a.op.type]
      const priorityB = Transaction.OPERATION_PRIORITY[b.op.type]

      if (priorityA !== priorityB) {
        return priorityA - priorityB
      }

      // Same priority: maintain original order
      return a.index - b.index
    })

    return indexed.map(({ op }) => op)
  }

  /**
   * Execute all queued operations against the provided storage.
   *
   * Operations are automatically reordered for optimal execution:
   * 1. mkdir operations (ensure directories exist)
   * 2. write operations (create/update files)
   * 3. rename operations (move/rename files)
   * 4. delete operations (rm, unlink, rmdir)
   *
   * If any operation fails, all previously completed operations are rolled back
   * with content preservation when possible.
   *
   * ## Rollback Behavior
   *
   * - **Write operations**: Deleted, or restored to previous content if storage.readFile is available
   * - **Delete/unlink/rm operations**: Restored from captured content if storage.readFile was available
   * - **Rename operations**: Reversed (renamed back to original path)
   * - **Mkdir operations**: Removed (rmdir)
   *
   * ## Logging
   *
   * When a logger is provided, detailed progress information is logged:
   * - Transaction start/commit/rollback events (info level)
   * - Individual operation execution (debug level)
   * - Rollback progress and failures (warn/error levels)
   *
   * @param storage - The storage interface to execute operations against
   * @param options - Optional execution options (logger, dryRun, transactionId)
   * @throws Error if any operation fails (after rollback attempt)
   *
   * @example Basic execution
   * ```typescript
   * const tx = new Transaction()
   *   .writeFile('/a.txt', data1)
   *   .writeFile('/b.txt', data2)
   *
   * await tx.execute(storage) // Commits on success, rolls back on failure
   * ```
   *
   * @example With logging
   * ```typescript
   * await tx.execute(storage, {
   *   logger: console,
   *   transactionId: 'deploy-config-v2'
   * })
   * ```
   *
   * @example Dry run preview
   * ```typescript
   * await tx.execute(storage, { dryRun: true, logger: console })
   * // Logs what would happen without making changes
   * ```
   */
  async execute(storage: TransactionStorage, options?: TransactionExecuteOptions): Promise<void> {
    this.assertPending()

    const logger = options?.logger ?? noopLogger
    const dryRun = options?.dryRun ?? false
    const transactionId = options?.transactionId ?? generateTransactionId()
    const useDbTransaction = options?.useDbTransaction ?? true
    const captureContent = options?.captureContent ?? true
    const timeoutMs = options?.timeoutMs
    const onMetrics = options?.onMetrics

    // Timing metrics
    const startTime = Date.now()
    let operationStartTime = startTime
    let operationsExecuted = 0
    let rollbackDurationMs: number | undefined

    // Track completed operations for rollback (only used when no DB transaction)
    const completedOps: CompletedOperation[] = []

    // Reorder operations for optimal execution: mkdir -> write -> rename -> delete
    const orderedOps = this.getOptimalOperationOrder()

    // Check if storage supports database-level transactions
    const hasDbTransaction = !!storage.beginTransaction && useDbTransaction
    let dbTx: { commit(): Promise<void>; rollback(): Promise<void> } | null = null

    // Timeout tracking
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let timedOut = false

    const checkTimeout = () => {
      if (timedOut) {
        throw new Error(`Transaction ${transactionId} timed out after ${timeoutMs}ms`)
      }
    }

    logger.info(`Transaction ${transactionId} starting with ${this.operations.length} operations`, {
      dryRun,
      useDbTransaction: hasDbTransaction,
      timeoutMs,
    })

    // Set up timeout if specified
    if (timeoutMs && !dryRun) {
      timeoutId = setTimeout(() => {
        timedOut = true
      }, timeoutMs)
    }

    try {
      // Begin database-level transaction if supported
      if (hasDbTransaction && storage.beginTransaction && !dryRun) {
        dbTx = await storage.beginTransaction(transactionId)
        logger.debug(`[${transactionId}] Database transaction started`)
      }

      operationStartTime = Date.now()

      for (let i = 0; i < orderedOps.length; i++) {
        checkTimeout() // Check for timeout before each operation

        const op = orderedOps[i]
        if (!op) continue // Skip undefined entries (shouldn't happen but satisfies TypeScript)

        // Get path for logging - handle rename's different property names
        const opPath = op.type === 'rename' ? op.oldPath : op.path
        logger.debug(`[${transactionId}] Executing operation ${i + 1}/${orderedOps.length}: ${op.type}`, op)

        if (dryRun) {
          logger.info(`[${transactionId}] [DRY RUN] Would execute: ${op.type} on ${opPath}`)
          continue
        }

        switch (op.type) {
          case 'write': {
            // Capture previous content if file exists (for content-preserving rollback)
            // Skip capture if using DB transaction (database handles rollback) or if disabled
            let previousContent: Uint8Array | undefined
            let existed = false

            if (captureContent && !dbTx && storage.exists && storage.readFile) {
              try {
                existed = await storage.exists(op.path)
                if (existed) {
                  previousContent = await storage.readFile(op.path)
                  logger.debug(`[${transactionId}] Captured ${previousContent.length} bytes from existing file: ${op.path}`)
                }
              } catch {
                // File doesn't exist or can't be read - that's fine
                logger.debug(`[${transactionId}] Could not capture previous content for: ${op.path}`)
              }
            }

            await storage.writeFile(op.path, op.data)
            operationsExecuted++
            completedOps.push({
              type: 'write',
              path: op.path,
              previousContent,
              existed,
              completedAt: Date.now()
            })
            break
          }

          case 'delete':
          case 'unlink': {
            // Capture content before delete for restore
            // Skip capture if using DB transaction (database handles rollback) or if disabled
            let previousContent: Uint8Array | undefined

            if (captureContent && !dbTx && storage.readFile) {
              try {
                previousContent = await storage.readFile(op.path)
                logger.debug(`[${transactionId}] Captured ${previousContent.length} bytes before delete: ${op.path}`)
              } catch {
                // File might not exist or can't be read
                logger.debug(`[${transactionId}] Could not capture content before delete: ${op.path}`)
              }
            }

            // Execute delete
            if (storage.unlink) {
              await storage.unlink(op.path)
            } else if (storage.deleteFile) {
              await storage.deleteFile(op.path)
            }

            operationsExecuted++
            completedOps.push({
              type: op.type as 'delete' | 'unlink',
              path: op.path,
              previousContent,
              existed: true,
              completedAt: Date.now()
            })
            break
          }

          case 'rm': {
            // Capture content before rm for restore (if it's a file)
            // Skip capture if using DB transaction (database handles rollback) or if disabled
            let previousContent: Uint8Array | undefined

            if (captureContent && !dbTx && storage.readFile && !op.options?.recursive) {
              try {
                previousContent = await storage.readFile(op.path)
                logger.debug(`[${transactionId}] Captured ${previousContent.length} bytes before rm: ${op.path}`)
              } catch {
                // File might not exist, be a directory, or can't be read
                logger.debug(`[${transactionId}] Could not capture content before rm: ${op.path}`)
              }
            }

            // Execute rm
            if (storage.rm) {
              await storage.rm(op.path, op.options)
            } else if (storage.deleteFile) {
              await storage.deleteFile(op.path)
            }

            operationsExecuted++
            completedOps.push({
              type: 'rm',
              path: op.path,
              previousContent,
              existed: true,
              completedAt: Date.now()
            })
            break
          }

          case 'rmdir': {
            if (storage.rmdir) {
              await storage.rmdir(op.path, op.options)
            } else if (storage.rm && op.options?.recursive) {
              await storage.rm(op.path, { recursive: true })
            }

            operationsExecuted++
            completedOps.push({
              type: 'rmdir',
              path: op.path,
              existed: true,
              completedAt: Date.now()
            })
            break
          }

          case 'rename': {
            // Handle mkdirp option - create parent directories if needed
            if (op.options?.mkdirp && storage.mkdir) {
              const parentDir = op.newPath.substring(0, op.newPath.lastIndexOf('/'))
              if (parentDir && parentDir !== '/') {
                await storage.mkdir(parentDir, { recursive: true })
                logger.debug(`[${transactionId}] Created parent directory: ${parentDir}`)
              }
            }

            if (storage.rename) {
              await storage.rename(op.oldPath, op.newPath)
            }

            operationsExecuted++
            completedOps.push({
              type: 'rename',
              path: op.oldPath,
              newPath: op.newPath,
              completedAt: Date.now()
            })
            break
          }

          case 'mkdir': {
            if (storage.mkdir) {
              await storage.mkdir(op.path, op.options)
            }

            operationsExecuted++
            completedOps.push({
              type: 'mkdir',
              path: op.path,
              completedAt: Date.now()
            })
            break
          }
        }
      }

      // Clear timeout if set
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      const operationDurationMs = Date.now() - operationStartTime

      if (dryRun) {
        logger.info(`[${transactionId}] Dry run completed - no changes made`)
        // Don't change status for dry run
        return
      }

      // Commit database-level transaction if we have one
      if (dbTx) {
        await dbTx.commit()
        logger.debug(`[${transactionId}] Database transaction committed`)
      }

      this.status = 'committed'
      const totalDurationMs = Date.now() - startTime
      logger.info(`Transaction ${transactionId} committed successfully`, {
        operationsExecuted,
        totalDurationMs,
        operationDurationMs,
      })

      // Report metrics if callback provided
      if (onMetrics) {
        onMetrics({
          transactionId,
          totalDurationMs,
          operationDurationMs,
          operationsExecuted,
          usedDbTransaction: !!dbTx,
          status: 'committed',
        })
      }
    } catch (error) {
      // Clear timeout if set
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      const rollbackStartTime = Date.now()
      logger.error(`Transaction ${transactionId} failed, starting rollback`, { error, completedOps: completedOps.length })

      // Perform rollback - prefer database transaction rollback if available
      if (dbTx) {
        // Database-level rollback - much simpler and more reliable
        try {
          await dbTx.rollback()
          rollbackDurationMs = Date.now() - rollbackStartTime
          logger.debug(`[${transactionId}] Database transaction rolled back`)

          this.lastRollbackSummary = {
            transactionId,
            totalOperations: completedOps.length,
            successCount: completedOps.length,
            failureCount: 0,
            results: completedOps.map(op => ({ path: op.path, success: true })),
            durationMs: rollbackDurationMs,
          }
        } catch (rollbackError) {
          rollbackDurationMs = Date.now() - rollbackStartTime
          logger.error(`[${transactionId}] Database rollback failed`, { rollbackError })
          this.lastRollbackSummary = {
            transactionId,
            totalOperations: completedOps.length,
            successCount: 0,
            failureCount: 1,
            results: [{ path: '*', success: false, error: String(rollbackError) }],
            durationMs: rollbackDurationMs,
          }
        }
      } else {
        // Application-level rollback (fallback when no DB transaction)
        const rollbackSummary = await this.performRollback(storage, completedOps, transactionId, logger)
        rollbackDurationMs = rollbackSummary.durationMs
        this.lastRollbackSummary = rollbackSummary

        if (rollbackSummary.failureCount > 0) {
          logger.warn(`Transaction ${transactionId} rollback completed with ${rollbackSummary.failureCount} failures`, rollbackSummary)

          // Collect all rollback errors with operation context
          const rollbackErrors = rollbackSummary.results
            .filter(r => !r.success && r.errorObject)
            .map(r => {
              const err = r.errorObject!
              // Enhance error message with path context if not already present
              if (!err.message.includes(r.path)) {
                return new Error(`Rollback failed for ${r.path}: ${err.message}`)
              }
              return err
            })

          // Report metrics before throwing
          if (onMetrics) {
            onMetrics({
              transactionId,
              totalDurationMs: Date.now() - startTime,
              operationDurationMs: Date.now() - operationStartTime - (rollbackDurationMs ?? 0),
              rollbackDurationMs,
              operationsExecuted,
              operationsRolledBack: rollbackSummary.successCount,
              usedDbTransaction: false,
              status: 'rolled_back',
              errorMessage: (error as Error).message,
            })
          }

          // Throw AggregateError with original error first, then all rollback errors
          throw new AggregateError(
            [error as Error, ...rollbackErrors],
            `Transaction failed and rollback also failed with ${rollbackSummary.failureCount} error(s)`
          )
        } else {
          logger.info(`Transaction ${transactionId} rollback completed successfully`)
        }
      }

      this.status = 'rolled_back'

      // Report metrics if callback provided
      if (onMetrics) {
        onMetrics({
          transactionId,
          totalDurationMs: Date.now() - startTime,
          operationDurationMs: Date.now() - operationStartTime - (rollbackDurationMs ?? 0),
          rollbackDurationMs,
          operationsExecuted,
          operationsRolledBack: completedOps.length,
          usedDbTransaction: !!dbTx,
          status: 'rolled_back',
          errorMessage: (error as Error).message,
        })
      }

      throw error
    }
  }

  /**
   * Perform rollback of completed operations in reverse order.
   * @internal
   */
  private async performRollback(
    storage: TransactionStorage,
    completedOps: CompletedOperation[],
    transactionId: string,
    logger: TransactionLogger
  ): Promise<RollbackSummary> {
    const startTime = Date.now()
    const results: RollbackResult[] = []
    let successCount = 0
    let failureCount = 0

    // Rollback in reverse order
    for (let i = completedOps.length - 1; i >= 0; i--) {
      const op = completedOps[i]
      if (!op) continue // Skip undefined entries (shouldn't happen but satisfies TypeScript)

      logger.debug(`[${transactionId}] Rolling back operation ${completedOps.length - i}/${completedOps.length}: ${op.type} on ${op.path}`)

      try {
        switch (op.type) {
          case 'write': {
            if (op.existed && op.previousContent) {
              // Restore previous content
              await storage.writeFile(op.path, op.previousContent)
              logger.debug(`[${transactionId}] Restored previous content for: ${op.path}`)
            } else {
              // Delete the newly created file
              const deleteFn = storage.rm ?? storage.unlink ?? storage.deleteFile
              if (deleteFn) {
                await deleteFn.call(storage, op.path)
                logger.debug(`[${transactionId}] Deleted new file: ${op.path}`)
              }
            }
            break
          }

          case 'delete':
          case 'unlink':
          case 'rm': {
            // Restore deleted file if we have the content
            if (op.previousContent) {
              await storage.writeFile(op.path, op.previousContent)
              logger.debug(`[${transactionId}] Restored deleted file: ${op.path}`)
            } else {
              logger.warn(`[${transactionId}] Cannot restore deleted file (no content captured): ${op.path}`)
            }
            break
          }

          case 'rename': {
            // Reverse the rename
            if (storage.rename && op.newPath) {
              await storage.rename(op.newPath, op.path)
              logger.debug(`[${transactionId}] Reversed rename: ${op.newPath} -> ${op.path}`)
            }
            break
          }

          case 'mkdir': {
            // Remove created directory
            if (storage.rmdir) {
              await storage.rmdir(op.path)
              logger.debug(`[${transactionId}] Removed created directory: ${op.path}`)
            } else if (storage.rm) {
              await storage.rm(op.path)
              logger.debug(`[${transactionId}] Removed created directory via rm: ${op.path}`)
            }
            break
          }

          case 'rmdir': {
            // Cannot restore a deleted directory and its contents
            // Log warning for visibility
            logger.warn(`[${transactionId}] Cannot restore removed directory: ${op.path}`)
            break
          }
        }

        results.push({ path: op.path, success: true })
        successCount++
      } catch (rollbackError) {
        const errorMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        const errorObject = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError))
        logger.error(`[${transactionId}] Rollback failed for ${op.path}: ${errorMessage}`)
        results.push({ path: op.path, success: false, error: errorMessage, errorObject })
        failureCount++
      }
    }

    return {
      transactionId,
      totalOperations: completedOps.length,
      successCount,
      failureCount,
      results,
      durationMs: Date.now() - startTime
    }
  }
}
