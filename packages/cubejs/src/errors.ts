/**
 * @dotdo/cubejs - Error Types
 *
 * Custom error classes for the Cube.js compatibility layer.
 */

/**
 * Base error class for all Cube.js errors
 */
export class CubeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CubeError'
    Object.setPrototypeOf(this, CubeError.prototype)
  }
}

/**
 * Error thrown during schema validation
 */
export class ValidationError extends CubeError {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
    Object.setPrototypeOf(this, ValidationError.prototype)
  }
}

/**
 * Error thrown during query execution
 */
export class QueryError extends CubeError {
  /**
   * The query that caused the error
   */
  public readonly query?: unknown

  /**
   * HTTP status code if from API
   */
  public readonly statusCode?: number

  /**
   * Additional error details
   */
  public readonly details?: Record<string, unknown>

  constructor(
    message: string,
    options?: {
      query?: unknown
      statusCode?: number
      details?: Record<string, unknown>
    }
  ) {
    super(message)
    this.name = 'QueryError'
    this.query = options?.query
    this.statusCode = options?.statusCode
    this.details = options?.details
    Object.setPrototypeOf(this, QueryError.prototype)
  }
}

/**
 * Error thrown when authentication fails
 */
export class AuthenticationError extends CubeError {
  constructor(message: string = 'Authentication failed') {
    super(message)
    this.name = 'AuthenticationError'
    Object.setPrototypeOf(this, AuthenticationError.prototype)
  }
}

/**
 * Error thrown when a resource is not found
 */
export class NotFoundError extends CubeError {
  /**
   * Type of resource not found
   */
  public readonly resourceType: string

  /**
   * Name of the resource
   */
  public readonly resourceName: string

  constructor(resourceType: string, resourceName: string) {
    super(`${resourceType} not found: ${resourceName}`)
    this.name = 'NotFoundError'
    this.resourceType = resourceType
    this.resourceName = resourceName
    Object.setPrototypeOf(this, NotFoundError.prototype)
  }
}

/**
 * Error thrown when a pre-aggregation cannot be used
 */
export class PreAggregationError extends CubeError {
  /**
   * Reason the pre-aggregation cannot be used
   */
  public readonly reason: string

  constructor(message: string, reason: string) {
    super(message)
    this.name = 'PreAggregationError'
    this.reason = reason
    Object.setPrototypeOf(this, PreAggregationError.prototype)
  }
}

/**
 * Error thrown during SQL generation
 */
export class SQLGenerationError extends CubeError {
  /**
   * The query being compiled
   */
  public readonly query?: unknown

  constructor(message: string, query?: unknown) {
    super(message)
    this.name = 'SQLGenerationError'
    this.query = query
    Object.setPrototypeOf(this, SQLGenerationError.prototype)
  }
}
