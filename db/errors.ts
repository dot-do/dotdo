/**
 * @dotdo/db - Error Types
 *
 * Simple error types for the database layer.
 * These are intentionally decoupled from @dotdo/rpc to keep db as a pure storage layer
 * with no RPC dependencies.
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
 */
export class ValidationError extends DatabaseError {
  constructor(message = 'Validation failed', details?: Record<string, unknown>) {
    super(message, details)
    this.name = 'ValidationError'
  }

  /**
   * Create a ValidationError with multiple field errors
   */
  static withErrors(errors: Array<{ field: string; message: string }>): ValidationError {
    const messages = errors.map((e) => `${e.field}: ${e.message}`).join(', ')
    return new ValidationError(`Validation failed: ${messages}`, { errors })
  }

  /**
   * Create a ValidationError for a single field
   */
  static forField(field: string, constraint: string, value?: unknown): ValidationError {
    return new ValidationError(
      `Validation failed: ${field} ${constraint}`,
      { field, constraint, value }
    )
  }
}

/**
 * Resource not found error
 */
export class NotFoundError extends DatabaseError {
  constructor(message = 'Resource not found', details?: Record<string, unknown>) {
    super(message, details)
    this.name = 'NotFoundError'
  }

  /**
   * Create a NotFoundError for a specific resource type and ID
   */
  static forResource(resourceType: string, resourceId: string): NotFoundError {
    return new NotFoundError(
      `${resourceType} with id ${resourceId} not found`,
      { resourceType, resourceId }
    )
  }
}
