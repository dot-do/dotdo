/**
 * @dotdo/metabase - Error Types
 *
 * Error classes for the Metabase compat layer.
 */

/**
 * Base error for all Metabase errors
 */
export class MetabaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MetabaseError'
  }
}

/**
 * Authentication error (401)
 */
export class AuthenticationError extends MetabaseError {
  constructor(message: string = 'Authentication required') {
    super(message)
    this.name = 'AuthenticationError'
  }
}

/**
 * Authorization error (403)
 */
export class AuthorizationError extends MetabaseError {
  constructor(message: string = 'Permission denied') {
    super(message)
    this.name = 'AuthorizationError'
  }
}

/**
 * Resource not found error (404)
 */
export class NotFoundError extends MetabaseError {
  resource: string
  id: string | number

  constructor(resource: string, id: string | number) {
    super(`${resource} not found: ${id}`)
    this.name = 'NotFoundError'
    this.resource = resource
    this.id = id
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends MetabaseError {
  errors: Record<string, string[]>

  constructor(message: string, errors: Record<string, string[]> = {}) {
    super(message)
    this.name = 'ValidationError'
    this.errors = errors
  }
}

/**
 * Query execution error
 */
export class QueryError extends MetabaseError {
  query?: unknown
  nativeError?: string

  constructor(message: string, query?: unknown, nativeError?: string) {
    super(message)
    this.name = 'QueryError'
    this.query = query
    this.nativeError = nativeError
  }
}

/**
 * Database connection error
 */
export class DatabaseError extends MetabaseError {
  databaseId?: number

  constructor(message: string, databaseId?: number) {
    super(message)
    this.name = 'DatabaseError'
    this.databaseId = databaseId
  }
}
