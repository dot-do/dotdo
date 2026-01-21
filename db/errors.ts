/**
 * @dotdo/db - Error Types
 *
 * Simple error types for the database layer.
 * These are intentionally decoupled from @dotdo/rpc to keep db as a pure storage layer
 * with no RPC dependencies.
 *
 * Note: Named with Db prefix to avoid conflict with ValidationError interfaces
 * in schema.ts and schemas.ts which represent validation result data structures.
 */

/**
 * Base database error class
 */
export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'DatabaseError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Validation error for invalid input (e.g., missing required fields)
 *
 * Named DbValidationError to avoid conflict with ValidationError interfaces
 * in schema.ts and schemas.ts.
 */
export class DbValidationError extends DatabaseError {
  constructor(message = 'Validation failed', details?: Record<string, unknown>) {
    super(message, details)
    this.name = 'DbValidationError'
  }

  /**
   * Create a DbValidationError with multiple field errors
   */
  static withErrors(errors: Array<{ field: string; message: string }>): DbValidationError {
    const messages = errors.map((e) => `${e.field}: ${e.message}`).join(', ')
    return new DbValidationError(`Validation failed: ${messages}`, { errors })
  }

  /**
   * Create a DbValidationError for a single field
   */
  static forField(field: string, constraint: string, value?: unknown): DbValidationError {
    return new DbValidationError(
      `Validation failed: ${field} ${constraint}`,
      { field, constraint, value }
    )
  }
}

/**
 * Resource not found error
 *
 * Named DbNotFoundError for consistency with DbValidationError.
 */
export class DbNotFoundError extends DatabaseError {
  constructor(message = 'Resource not found', details?: Record<string, unknown>) {
    super(message, details)
    this.name = 'DbNotFoundError'
  }

  /**
   * Create a DbNotFoundError for a specific resource type and ID
   */
  static forResource(resourceType: string, resourceId: string): DbNotFoundError {
    return new DbNotFoundError(
      `${resourceType} with id ${resourceId} not found`,
      { resourceType, resourceId }
    )
  }
}

/**
 * Transaction-related errors for the database layer
 */
export class TransactionError extends DatabaseError {
  constructor(
    message: string,
    public readonly cause?: Error,
    details?: Record<string, unknown>
  ) {
    super(message, details)
    this.name = 'TransactionError'
  }

  /**
   * Create a TransactionError for rollback failure
   */
  static rollbackFailed(originalError: Error, rollbackError: Error): TransactionError {
    return new TransactionError(
      `Transaction rollback failed: ${rollbackError.message}`,
      rollbackError,
      {
        originalError: originalError.message,
        rollbackError: rollbackError.message
      }
    )
  }

  /**
   * Create a TransactionError for nested transaction failure
   */
  static nestedFailed(savepointName: string, error: Error): TransactionError {
    return new TransactionError(
      `Nested transaction '${savepointName}' failed: ${error.message}`,
      error,
      { savepointName }
    )
  }
}

/**
 * Error thrown when attempting nested transactions without support
 */
export class NestedTransactionError extends TransactionError {
  constructor(message = 'Nested transactions are not supported by this adapter') {
    super(message)
    this.name = 'NestedTransactionError'
  }
}
