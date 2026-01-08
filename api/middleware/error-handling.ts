import type { Context, MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'

/**
 * Custom error classes for specific HTTP errors
 */
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

interface ErrorResponse {
  error: {
    code: string
    message: string
    details?: Record<string, string[]>
    requestId?: string
    stack?: string
  }
}

function getStatusCode(err: unknown): number {
  if (err instanceof HTTPException) return err.status
  if (err instanceof BadRequestError) return 400
  if (err instanceof UnauthorizedError) return 401
  if (err instanceof ForbiddenError) return 403
  if (err instanceof NotFoundError) return 404
  if (err instanceof MethodNotAllowedError) return 405
  if (err instanceof ConflictError) return 409
  if (err instanceof UnprocessableEntityError) return 422
  if (err instanceof InternalServerError) return 500
  if (err && typeof err === 'object' && 'status' in err) {
    return (err as { status: number }).status
  }
  return 500
}

function getErrorCode(err: unknown): string {
  if (err instanceof HTTPException) {
    switch (err.status) {
      case 400:
        return 'BAD_REQUEST'
      case 401:
        return 'UNAUTHORIZED'
      case 403:
        return 'FORBIDDEN'
      case 404:
        return 'NOT_FOUND'
      case 405:
        return 'METHOD_NOT_ALLOWED'
      case 409:
        return 'CONFLICT'
      case 422:
        return 'UNPROCESSABLE_ENTITY'
      default:
        return 'INTERNAL_SERVER_ERROR'
    }
  }
  if (err && typeof err === 'object' && 'code' in err) {
    return (err as { code: string }).code
  }
  return 'INTERNAL_SERVER_ERROR'
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return 'An unexpected error occurred'
}

/**
 * Error handling middleware
 * Catches errors and returns consistent JSON responses
 */
export const errorHandler: MiddlewareHandler = async (c, next) => {
  try {
    await next()
  } catch (err) {
    const status = getStatusCode(err)
    const code = getErrorCode(err)
    const message = getErrorMessage(err)

    const body: ErrorResponse = {
      error: {
        code,
        message,
      },
    }

    // Add validation details for 422 errors
    if (err instanceof UnprocessableEntityError && err.errors) {
      body.error.details = err.errors
    }

    // Add request ID if present
    const requestId = c.req.header('x-request-id')
    if (requestId) {
      body.error.requestId = requestId
    }

    // Add stack trace in development
    if (process.env.NODE_ENV === 'development' && err instanceof Error) {
      body.error.stack = err.stack
    }

    return c.json(body, status)
  }
}

/**
 * 404 handler for routes that don't match
 */
export function notFoundHandler(c: Context) {
  return c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: `Route not found: ${c.req.method} ${c.req.path}`,
      },
    },
    404,
  )
}

export default errorHandler
