// RPC Server - exposes methods via HTTP/RPC
// Includes Cap'n Proto-style promise pipelining support
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { generateCorrelationId, CORRELATION_ID_HEADER } from './client'
import {
  NotFoundError,
  ValidationError,
  InternalError,
  AuthorizationError,
  serializeError,
  isRPCError,
} from './errors'
import {
  validateArgs,
  getMethodSchema,
  isValidRPCMethod,
  type MethodSchemaRegistry,
} from './validation'
import {
  executePipeline,
  type PipelineRequest,
  type PipelineExecutorOptions,
} from './pipeline'

// Re-export for convenience
export { CORRELATION_ID_HEADER }

export interface RPCServerOptions {
  target: object
  /** Optional whitelist of allowed method names or glob patterns */
  whitelist?: string[]
  /** Optional schema registry for argument validation */
  schemas?: MethodSchemaRegistry
  /** Options for pipeline execution */
  pipeline?: PipelineExecutorOptions
  /** Enable pipeline support (default: true) */
  enablePipeline?: boolean
}

/**
 * Extended Hono app with updateWhitelist and updateSchemas methods
 */
export interface RPCServerApp extends ReturnType<typeof createHonoApp> {
  updateWhitelist(whitelist: string[]): void
  updateSchemas(schemas: MethodSchemaRegistry): void
}

function createHonoApp() {
  return new Hono()
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

/**
 * Convert a glob pattern to a regular expression
 * Supports:
 * - * matches any characters (zero or more)
 * - Exact string matching
 * - Case-sensitive matching
 */
function globToRegex(pattern: string): RegExp {
  // Escape regex special characters except *
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  // Convert * to regex equivalent
  const regexPattern = escaped.replace(/\*/g, '.*')
  return new RegExp(`^${regexPattern}$`)
}

/**
 * Check if a method name matches any pattern in the whitelist
 * Case-sensitive matching
 */
function matchesWhitelist(methodPath: string, whitelist: string[]): boolean {
  for (const pattern of whitelist) {
    if (pattern === methodPath) {
      // Exact match
      return true
    }
    if (pattern.includes('*')) {
      // Glob pattern match
      const regex = globToRegex(pattern)
      if (regex.test(methodPath)) {
        return true
      }
    }
  }
  return false
}

/**
 * Check if any part of the method path starts with underscore (private method convention)
 * This includes checking all segments of nested paths like "users._internal"
 */
function hasPrivateSegment(methodPath: string): boolean {
  const parts = methodPath.split('.')
  return parts.some(part => part.startsWith('_'))
}

/**
 * Create an authorization error for method not allowed
 * Returns a generic message that doesn't reveal whether the method exists
 */
function createMethodNotAllowedError(): AuthorizationError {
  return new AuthorizationError('Method not allowed')
}

export function createServer(options: RPCServerOptions): RPCServerApp {
  const { target, enablePipeline = true, pipeline: pipelineOptions } = options
  let currentWhitelist: string[] | undefined = options.whitelist
  let currentSchemas: MethodSchemaRegistry | undefined = options.schemas
  const app = new Hono() as RPCServerApp

  // Add updateWhitelist method to the app
  app.updateWhitelist = (newWhitelist: string[]) => {
    currentWhitelist = newWhitelist
  }

  // Add updateSchemas method to the app
  app.updateSchemas = (newSchemas: MethodSchemaRegistry) => {
    currentSchemas = newSchemas
  }

  // Pipeline endpoint for Cap'n Proto-style promise pipelining
  if (enablePipeline) {
    app.post('/rpc/pipeline', async (c) => {
      const incomingCorrelationId = c.req.header(CORRELATION_ID_HEADER)
      const correlationId = incomingCorrelationId || generateCorrelationId()
      c.header(CORRELATION_ID_HEADER, correlationId)

      try {
        const request = await c.req.json<PipelineRequest>()

        // Validate initial method path
        const validation = validateMethodPath(request.method)
        if (!validation.valid) {
          const error = new ValidationError(validation.error, { method: request.method })
          return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus as ContentfulStatusCode)
        }

        // Check for private methods in initial call
        if (hasPrivateSegment(request.method)) {
          const error = createMethodNotAllowedError()
          return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus as ContentfulStatusCode)
        }

        // Check whitelist for initial method
        if (currentWhitelist !== undefined) {
          if (!matchesWhitelist(request.method, currentWhitelist)) {
            const error = createMethodNotAllowedError()
            return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus as ContentfulStatusCode)
          }
        }

        // Execute the pipeline
        const response = await executePipeline(target, { ...request, correlationId }, pipelineOptions)

        if (response.error) {
          const error = new InternalError(
            `Pipeline step ${response.error.stepIndex} failed: ${response.error.message}`,
            { stepIndex: response.error.stepIndex, code: response.error.code }
          )
          return c.json({ ...serializeError(error, { includeStack: false }), correlationId, ...response.error }, error.httpStatus as ContentfulStatusCode)
        }

        return c.json(response)
      } catch (error) {
        if (isRPCError(error)) {
          return c.json(
            { ...serializeError(error, { includeStack: false }), correlationId },
            error.httpStatus as ContentfulStatusCode
          )
        }

        const wrappedError = InternalError.wrap(error)
        return c.json(
          { ...serializeError(wrappedError, { includeStack: false }), correlationId },
          wrappedError.httpStatus as ContentfulStatusCode
        )
      }
    })
  }

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
        return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus as ContentfulStatusCode)
      }

      const { parts } = validation

      // Check for private methods (underscore prefix) - always blocked regardless of whitelist
      // This must return the same error as whitelist rejection to avoid method enumeration
      if (hasPrivateSegment(method)) {
        const error = createMethodNotAllowedError()
        return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus as ContentfulStatusCode)
      }

      // Check whitelist if specified
      // When whitelist is undefined, allow all methods (backward compatibility)
      // When whitelist is an empty array, block all methods
      if (currentWhitelist !== undefined) {
        if (!matchesWhitelist(method, currentWhitelist)) {
          // Return generic error - don't reveal whether method exists
          const error = createMethodNotAllowedError()
          return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus as ContentfulStatusCode)
        }
      }

      // Navigate nested paths (e.g., "users.create")
      // Using Record<string, unknown> to maintain type safety while allowing dynamic property access
      let current: Record<string, unknown> = target as Record<string, unknown>

      for (let i = 0; i < parts.length - 1; i++) {
        // Only access own properties to prevent prototype chain traversal
        if (!Object.prototype.hasOwnProperty.call(current, parts[i])) {
          // Return same error as whitelist rejection to prevent method enumeration
          if (currentWhitelist !== undefined) {
            const error = createMethodNotAllowedError()
            return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus as ContentfulStatusCode)
          }
          const error = NotFoundError.forResource('Method', method)
          return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus as ContentfulStatusCode)
        }
        const next = current[parts[i]]
        if (!next || typeof next !== 'object') {
          // Return same error as whitelist rejection to prevent method enumeration
          if (currentWhitelist !== undefined) {
            const error = createMethodNotAllowedError()
            return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus as ContentfulStatusCode)
          }
          const error = NotFoundError.forResource('Method', method)
          return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus as ContentfulStatusCode)
        }
        current = next as Record<string, unknown>
      }

      const methodName = parts[parts.length - 1]

      // For the final method, we need to check both own properties AND prototype methods
      // (class instances have methods on the prototype). The forbidden names check above
      // already blocks dangerous prototype properties like 'constructor', '__proto__', etc.
      // Use 'in' operator to find methods on object or its prototype chain
      const fn = (current as Record<string, unknown>)[methodName]
      if (typeof fn !== 'function') {
        // Return same error as whitelist rejection to prevent method enumeration
        if (currentWhitelist !== undefined) {
          const error = createMethodNotAllowedError()
          return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus as ContentfulStatusCode)
        }
        const error = NotFoundError.forResource('Method', method)
        return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus as ContentfulStatusCode)
      }

      // Validate arguments if schema is defined for this method
      if (currentSchemas) {
        const methodSchema = getMethodSchema(currentSchemas, method)
        if (methodSchema) {
          // validateArgs throws ValidationError if validation fails
          validateArgs(args, methodSchema)
        }
      }

      // fn is now known to be a function, cast to callable type for apply()
      const result = await (fn as (...args: unknown[]) => unknown).apply(current, args)
      return c.json(result)
    } catch (error) {
      // If it's already an RPCError, serialize it with its proper status code
      if (isRPCError(error)) {
        return c.json(
          { ...serializeError(error, { includeStack: false }), correlationId },
          error.httpStatus as ContentfulStatusCode
        )
      }

      // Wrap unknown errors in InternalError
      const wrappedError = InternalError.wrap(error)
      return c.json(
        { ...serializeError(wrappedError, { includeStack: false }), correlationId },
        wrappedError.httpStatus as ContentfulStatusCode
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
