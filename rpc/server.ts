// RPC Server - exposes methods via HTTP/RPC
import { Hono } from 'hono'
import { generateCorrelationId, CORRELATION_ID_HEADER } from './client'
import {
  RPCError,
  NotFoundError,
  ValidationError,
  InternalError,
  serializeError,
  isRPCError,
} from './errors'

// Re-export for convenience
export { CORRELATION_ID_HEADER }

export interface RPCServerOptions {
  target: object
}

export interface RPCRequest {
  method: string
  args: unknown[]
}

/**
 * Dangerous property names that could lead to prototype pollution or
 * unintended access to internal JavaScript object properties.
 */
const FORBIDDEN_PROPERTY_NAMES = new Set([
  '__proto__',
  'constructor',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toString',
  'valueOf',
])

/** Maximum allowed length for a method path string */
const MAX_METHOD_PATH_LENGTH = 1000

/** Maximum allowed nesting depth for method paths */
const MAX_METHOD_PATH_DEPTH = 100

/**
 * Validates an RPC method path for security and correctness.
 *
 * Valid method paths:
 * - Must be a non-empty string
 * - Can contain alphanumeric characters, underscores, and dots (for nesting)
 * - Must not start or end with a dot
 * - Must not contain consecutive dots
 * - Must not contain forbidden property names (prototype pollution prevention)
 * - Must not exceed length or depth limits
 *
 * @returns An object with `valid: true` and parsed `parts`, or `valid: false` with an `error` message
 */
export function validateMethodPath(method: unknown): { valid: true; parts: string[] } | { valid: false; error: string } {
  // Must be a string
  if (typeof method !== 'string') {
    return { valid: false, error: 'Invalid method path: must be a string' }
  }

  // Must not be empty
  if (method.length === 0) {
    return { valid: false, error: 'Invalid method path: cannot be empty' }
  }

  // Check length limit
  if (method.length > MAX_METHOD_PATH_LENGTH) {
    return { valid: false, error: `Invalid method path: exceeds maximum length of ${MAX_METHOD_PATH_LENGTH}` }
  }

  // Only allow safe characters: alphanumeric, underscore, and dot
  // This rejects slashes, backslashes, brackets, parentheses, spaces, null bytes, etc.
  if (!/^[a-zA-Z0-9_.]+$/.test(method)) {
    return { valid: false, error: 'Invalid method path: contains invalid characters' }
  }

  // Must not start or end with a dot
  if (method.startsWith('.') || method.endsWith('.')) {
    return { valid: false, error: 'Invalid method path: cannot start or end with a dot' }
  }

  // Must not contain consecutive dots
  if (method.includes('..')) {
    return { valid: false, error: 'Invalid method path: cannot contain consecutive dots' }
  }

  // Split into parts
  const parts = method.split('.')

  // Check depth limit
  if (parts.length > MAX_METHOD_PATH_DEPTH) {
    return { valid: false, error: `Invalid method path: exceeds maximum depth of ${MAX_METHOD_PATH_DEPTH}` }
  }

  // Check each part for forbidden names
  for (const part of parts) {
    if (part.length === 0) {
      return { valid: false, error: 'Invalid method path: contains empty segment' }
    }
    if (FORBIDDEN_PROPERTY_NAMES.has(part)) {
      return { valid: false, error: `Invalid method path: '${part}' is a forbidden property name` }
    }
  }

  return { valid: true, parts }
}

export function createServer(options: RPCServerOptions) {
  const { target } = options
  const app = new Hono()

  // RPC endpoint
  app.post('/rpc', async (c) => {
    // Extract or generate correlation ID for request tracing
    const incomingCorrelationId = c.req.header(CORRELATION_ID_HEADER)
    const correlationId = incomingCorrelationId || generateCorrelationId()

    // Set correlation ID in response header for tracing
    c.header(CORRELATION_ID_HEADER, correlationId)

    try {
      const body = await c.req.json<RPCRequest>()
      const { method, args } = body

      // Validate method path before processing
      const validation = validateMethodPath(method)
      if (!validation.valid) {
        const error = new ValidationError(validation.error, { method })
        return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus)
      }

      const { parts } = validation

      // Navigate nested paths (e.g., "users.create")
      let current: any = target

      for (let i = 0; i < parts.length - 1; i++) {
        // Only access own properties to prevent prototype chain traversal
        if (!Object.prototype.hasOwnProperty.call(current, parts[i])) {
          const error = NotFoundError.forResource('Method', method)
          return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus)
        }
        current = current[parts[i]]
        if (!current || typeof current !== 'object') {
          const error = NotFoundError.forResource('Method', method)
          return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus)
        }
      }

      const methodName = parts[parts.length - 1]

      // Only access own properties for the final method
      if (!Object.prototype.hasOwnProperty.call(current, methodName)) {
        const error = NotFoundError.forResource('Method', method)
        return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus)
      }

      const fn = current[methodName]
      if (typeof fn !== 'function') {
        const error = NotFoundError.forResource('Method', method)
        return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus)
      }

      const result = await fn.apply(current, args)
      return c.json(result)
    } catch (error) {
      // If it's already an RPCError, serialize it with its proper status code
      if (isRPCError(error)) {
        return c.json(
          { ...serializeError(error, { includeStack: false }), correlationId },
          error.httpStatus
        )
      }

      // Wrap unknown errors in InternalError
      const wrappedError = InternalError.wrap(error)
      return c.json(
        { ...serializeError(wrappedError, { includeStack: false }), correlationId },
        wrappedError.httpStatus
      )
    }
  })

  // Health check
  app.get('/', (c) => c.json({ status: 'ok' }))

  return app
}

// Cloudflare Worker export helper
export function createWorkerFromTarget(target: object) {
  const app = createServer({ target })

  return {
    fetch: app.fetch.bind(app)
  }
}
