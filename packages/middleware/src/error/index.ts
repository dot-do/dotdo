/**
 * Error handling middleware
 *
 * TDD RED PHASE: Stub implementation that will fail tests.
 */

import type { Context, MiddlewareHandler } from 'hono'

// Error classes - these are implemented as they're just data structures
export class BadRequestError extends Error {
  code = 'BAD_REQUEST'
  status = 400
  constructor(message: string) {
    super(message)
    this.name = 'BadRequestError'
  }
}

export class UnauthorizedError extends Error {
  code = 'UNAUTHORIZED'
  status = 401
  constructor(message: string = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends Error {
  code = 'FORBIDDEN'
  status = 403
  constructor(message: string = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends Error {
  code = 'NOT_FOUND'
  status = 404
  constructor(message: string = 'Not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class MethodNotAllowedError extends Error {
  code = 'METHOD_NOT_ALLOWED'
  status = 405
  allowed: string[]
  constructor(allowed: string[], message?: string) {
    super(message || `Method not allowed. Allowed: ${allowed.join(', ')}`)
    this.name = 'MethodNotAllowedError'
    this.allowed = allowed
  }
}

export class ConflictError extends Error {
  code = 'CONFLICT'
  status = 409
  constructor(message: string = 'Conflict') {
    super(message)
    this.name = 'ConflictError'
  }
}

export class UnprocessableEntityError extends Error {
  code = 'UNPROCESSABLE_ENTITY'
  status = 422
  errors?: Record<string, string[]>
  constructor(message: string = 'Validation failed', errors?: Record<string, string[]>) {
    super(message)
    this.name = 'UnprocessableEntityError'
    this.errors = errors
  }
}

export class InternalServerError extends Error {
  code = 'INTERNAL_SERVER_ERROR'
  status = 500
  constructor(message: string = 'Internal server error') {
    super(message)
    this.name = 'InternalServerError'
  }
}

// TDD RED: Stub - will fail tests
export const errorHandler: MiddlewareHandler = async (_c, _next) => {
  throw new Error('errorHandler not implemented')
}

// TDD RED: Stub - will fail tests
export function notFoundHandler(_c: Context): Response {
  throw new Error('notFoundHandler not implemented')
}

export default errorHandler
