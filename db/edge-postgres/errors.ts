/**
 * EdgePostgres Error Types
 *
 * Custom error classes for EdgePostgres operations providing:
 * - Semantic error types for different failure modes
 * - Clear, actionable error messages
 * - Proper error inheritance for instanceof checks
 *
 * @module db/edge-postgres/errors
 */

// ============================================================================
// BASE ERROR CLASS
// ============================================================================

/**
 * Base error class for all EdgePostgres errors
 */
export class EdgePostgresError extends Error {
  /** Error code for programmatic handling */
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'EdgePostgresError'
    this.code = code
    // Maintains proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}

// ============================================================================
// LIFECYCLE ERRORS
// ============================================================================

/**
 * Error thrown when attempting to use a closed EdgePostgres instance
 */
export class ClosedError extends EdgePostgresError {
  constructor() {
    super('EdgePostgres is closed or terminated', 'EDGE_POSTGRES_CLOSED')
    this.name = 'ClosedError'
  }
}

/**
 * Error thrown when PGLite initialization fails
 */
export class InitializationError extends EdgePostgresError {
  /** The underlying cause of the initialization failure */
  readonly cause?: Error

  constructor(message: string, cause?: Error) {
    super(`PGLite initialization failed: ${message}`, 'EDGE_POSTGRES_INIT_FAILED')
    this.name = 'InitializationError'
    this.cause = cause
  }
}

// ============================================================================
// QUERY ERRORS
// ============================================================================

/**
 * Error thrown when a query times out
 */
export class QueryTimeoutError extends EdgePostgresError {
  /** The timeout duration in milliseconds */
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`Query exceeded timeout of ${timeoutMs}ms`, 'EDGE_POSTGRES_QUERY_TIMEOUT')
    this.name = 'QueryTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/**
 * Error thrown for SQL syntax or execution errors
 *
 * Wraps PGLite errors with additional context
 */
export class QueryExecutionError extends EdgePostgresError {
  /** The SQL query that failed */
  readonly sql?: string
  /** The underlying database error message */
  readonly dbMessage: string

  constructor(dbMessage: string, sql?: string) {
    const truncatedSql = sql && sql.length > 100 ? sql.substring(0, 100) + '...' : sql
    const message = sql
      ? `Query execution failed: ${dbMessage} (SQL: ${truncatedSql})`
      : `Query execution failed: ${dbMessage}`
    super(message, 'EDGE_POSTGRES_QUERY_FAILED')
    this.name = 'QueryExecutionError'
    this.sql = sql
    this.dbMessage = dbMessage
  }
}

// ============================================================================
// STORAGE ERRORS
// ============================================================================

/**
 * Error thrown when checkpoint operations fail
 */
export class CheckpointError extends EdgePostgresError {
  /** The underlying cause of the checkpoint failure */
  readonly cause?: Error

  constructor(message: string, cause?: Error) {
    super(`Checkpoint failed: ${message}`, 'EDGE_POSTGRES_CHECKPOINT_FAILED')
    this.name = 'CheckpointError'
    this.cause = cause
  }
}

/**
 * Error thrown when storage operations fail
 */
export class StorageError extends EdgePostgresError {
  /** The storage key involved (if applicable) */
  readonly key?: string
  /** The underlying cause of the storage failure */
  readonly cause?: Error

  constructor(message: string, key?: string, cause?: Error) {
    const fullMessage = key ? `Storage error for key '${key}': ${message}` : `Storage error: ${message}`
    super(fullMessage, 'EDGE_POSTGRES_STORAGE_FAILED')
    this.name = 'StorageError'
    this.key = key
    this.cause = cause
  }
}

// ============================================================================
// TRANSACTION ERRORS
// ============================================================================

/**
 * Error thrown when a transaction fails to commit or rollback
 */
export class TransactionError extends EdgePostgresError {
  /** The underlying cause of the transaction failure */
  readonly cause?: Error

  constructor(message: string, cause?: Error) {
    super(`Transaction failed: ${message}`, 'EDGE_POSTGRES_TRANSACTION_FAILED')
    this.name = 'TransactionError'
    this.cause = cause
  }
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if an error is an EdgePostgres error
 */
export function isEdgePostgresError(error: unknown): error is EdgePostgresError {
  return error instanceof EdgePostgresError
}

/**
 * Check if an error indicates the database is closed
 */
export function isClosedError(error: unknown): error is ClosedError {
  return error instanceof ClosedError
}

/**
 * Check if an error is a query timeout
 */
export function isTimeoutError(error: unknown): error is QueryTimeoutError {
  return error instanceof QueryTimeoutError
}
