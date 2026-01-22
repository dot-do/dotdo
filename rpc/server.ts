// RPC Server - exposes methods via HTTP/RPC
// Includes Cap'n Proto-style promise pipelining support
// Integrates with observability context for correlation ID propagation
import { Hono } from 'hono'
import { generateCorrelationId, CORRELATION_ID_HEADER } from './headers'
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
  validateZodArgs,
  getZodMethodSchema,
  isZodMethodSchema,
  type ZodMethodSchemaRegistry,
} from './validation'
import {
  executePipeline,
  type PipelineRequest,
  type PipelineExecutorOptions,
} from './pipeline'

// Re-export for convenience
export { CORRELATION_ID_HEADER }

/**
 * RPC execution context passed to method handlers
 * Contains correlation ID and other request-scoped metadata
 */
export interface RPCExecutionContext {
  /** Correlation ID for request tracing */
  correlationId: string
  /** Source DO ID if this is a DO-to-DO call */
  sourceDoId?: string
  /** Whether this is an internal (trusted) request */
  isInternal?: boolean
}

/**
 * Symbol used to pass execution context to method handlers
 * Methods can accept this as a parameter to access request context
 */
export const RPC_CONTEXT = Symbol('rpcContext')

export interface RPCServerOptions {
  target: object
  /** Optional whitelist of allowed method names or glob patterns */
  whitelist?: string[]
  /** Optional schema registry for argument validation (supports both regular and Zod schemas) */
  schemas?: MethodSchemaRegistry | ZodMethodSchemaRegistry
  /** Options for pipeline execution */
  pipeline?: PipelineExecutorOptions
  /** Enable pipeline support (default: true) */
  enablePipeline?: boolean
  /** Pass execution context to method handlers */
  passContext?: boolean
}

/**
 * Extended Hono app with updateWhitelist and updateSchemas methods
 */
export interface RPCServerApp extends ReturnType<typeof createHonoApp> {
  updateWhitelist(whitelist: string[]): void
  updateSchemas(schemas: MethodSchemaRegistry | ZodMethodSchemaRegistry): void
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

/**
 * Creates an RPC server that exposes methods via HTTP.
 *
 * The server provides JSON-RPC style method invocation over HTTP POST requests.
 * Features include:
 * - Method whitelisting with glob pattern support
 * - Schema validation for arguments (supports both Zod and regular schemas)
 * - Cap'n Proto-style promise pipelining for reduced round trips
 * - Correlation ID propagation for distributed tracing
 * - Execution context injection for method handlers
 * - Protection against prototype pollution attacks
 *
 * @param options - Server configuration options
 * @returns A Hono app configured as an RPC server
 *
 * @example
 * ```typescript
 * import { createServer } from '@dotdo/rpc'
 *
 * // Basic usage
 * const api = {
 *   greet(name: string) { return `Hello, ${name}!` },
 *   users: {
 *     create(user: User) { return { id: generateId(), ...user } }
 *   }
 * }
 *
 * const server = createServer({ target: api })
 *
 * // With whitelist (only expose specific methods)
 * const server = createServer({
 *   target: api,
 *   whitelist: ['greet', 'users.*']  // Glob patterns supported
 * })
 *
 * // With Zod schema validation
 * import { z } from 'zod'
 *
 * const server = createServer({
 *   target: api,
 *   schemas: {
 *     greet: { type: 'zod', schema: z.tuple([z.string()]) },
 *     'users.create': { type: 'zod', schema: z.tuple([userSchema]) }
 *   }
 * })
 *
 * // With execution context (correlation ID, caller info)
 * const server = createServer({
 *   target: api,
 *   passContext: true  // Methods receive execution context as last arg
 * })
 * ```
 *
 * @stable
 * @since 1.0.0
 */
export function createServer(options: RPCServerOptions): RPCServerApp {
  const { target, enablePipeline = true, pipeline: pipelineOptions, passContext = false } = options
  let currentWhitelist: string[] | undefined = options.whitelist
  let currentSchemas: MethodSchemaRegistry | ZodMethodSchemaRegistry | undefined = options.schemas
  const app = new Hono() as RPCServerApp

  // Add updateWhitelist method to the app
  app.updateWhitelist = (newWhitelist: string[]) => {
    currentWhitelist = newWhitelist
  }

  // Add updateSchemas method to the app
  app.updateSchemas = (newSchemas: MethodSchemaRegistry | ZodMethodSchemaRegistry) => {
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
          return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus)
        }

        // Check for private methods in initial call
        if (hasPrivateSegment(request.method)) {
          const error = createMethodNotAllowedError()
          return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus)
        }

        // Check whitelist for initial method
        if (currentWhitelist !== undefined) {
          if (!matchesWhitelist(request.method, currentWhitelist)) {
            const error = createMethodNotAllowedError()
            return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus)
          }
        }

        // Execute the pipeline
        const response = await executePipeline(target, { ...request, correlationId }, pipelineOptions)

        if (response.error) {
          const error = new InternalError(
            `Pipeline step ${response.error.stepIndex} failed: ${response.error.message}`,
            { stepIndex: response.error.stepIndex, code: response.error.code }
          )
          return c.json({ ...serializeError(error, { includeStack: false }), correlationId, ...response.error }, error.httpStatus)
        }

        return c.json(response)
      } catch (error) {
        if (isRPCError(error)) {
          return c.json(
            { ...serializeError(error, { includeStack: false }), correlationId },
            error.httpStatus
          )
        }

        const wrappedError = InternalError.wrap(error)
        return c.json(
          { ...serializeError(wrappedError, { includeStack: false }), correlationId },
          wrappedError.httpStatus
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
        return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus)
      }

      const { parts } = validation

      // Check for private methods (underscore prefix) - always blocked regardless of whitelist
      // This must return the same error as whitelist rejection to avoid method enumeration
      if (hasPrivateSegment(method)) {
        const error = createMethodNotAllowedError()
        return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus)
      }

      // Check whitelist if specified
      // When whitelist is undefined, allow all methods (backward compatibility)
      // When whitelist is an empty array, block all methods
      if (currentWhitelist !== undefined) {
        if (!matchesWhitelist(method, currentWhitelist)) {
          // Return generic error - don't reveal whether method exists
          const error = createMethodNotAllowedError()
          return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus)
        }
      }

      // Navigate nested paths (e.g., "users.create")
      // Using Record<string, unknown> to maintain type safety while allowing dynamic property access
      let current: Record<string, unknown> = target as Record<string, unknown>

      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]!
        // Only access own properties to prevent prototype chain traversal
        if (!Object.prototype.hasOwnProperty.call(current, part)) {
          // Return same error as whitelist rejection to prevent method enumeration
          if (currentWhitelist !== undefined) {
            const error = createMethodNotAllowedError()
            return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus)
          }
          const error = NotFoundError.forResource('Method', method)
          return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus)
        }
        const next = current[part]
        if (!next || typeof next !== 'object') {
          // Return same error as whitelist rejection to prevent method enumeration
          if (currentWhitelist !== undefined) {
            const error = createMethodNotAllowedError()
            return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus)
          }
          const error = NotFoundError.forResource('Method', method)
          return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus)
        }
        current = next as Record<string, unknown>
      }

      const methodName = parts[parts.length - 1]
      if (methodName === undefined) {
        // This should never happen as validateMethodPath ensures non-empty method names,
        // but TypeScript needs the explicit check for index safety
        const error = new ValidationError('Invalid method path: empty method name', { method })
        return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus)
      }

      // For the final method, we need to check both own properties AND prototype methods
      // (class instances have methods on the prototype). The forbidden names check above
      // already blocks dangerous prototype properties like 'constructor', '__proto__', etc.
      // Use 'in' operator to find methods on object or its prototype chain
      const fn = (current as Record<string, unknown>)[methodName]
      if (typeof fn !== 'function') {
        // Return same error as whitelist rejection to prevent method enumeration
        if (currentWhitelist !== undefined) {
          const error = createMethodNotAllowedError()
          return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus)
        }
        const error = NotFoundError.forResource('Method', method)
        return c.json({ ...serializeError(error, { includeStack: false }), correlationId }, error.httpStatus)
      }

      // Validate arguments if schema is defined for this method
      if (currentSchemas) {
        // First try Zod schemas
        const zodSchema = getZodMethodSchema(currentSchemas as ZodMethodSchemaRegistry, method)
        if (zodSchema && isZodMethodSchema(zodSchema)) {
          // validateZodArgs throws ValidationError if validation fails
          validateZodArgs(args, zodSchema)
        } else {
          // Fall back to regular schemas
          const methodSchema = getMethodSchema(currentSchemas as MethodSchemaRegistry, method)
          if (methodSchema) {
            // validateArgs throws ValidationError if validation fails
            validateArgs(args, methodSchema)
          }
        }
      }

      // Build execution context with correlation ID and other request metadata
      const sourceDoId = c.req.header('X-DO-Source-ID')
      const isInternalHeader = c.req.header('X-DO-Source') === 'true'
      const executionContext: RPCExecutionContext = {
        correlationId,
        ...(sourceDoId && { sourceDoId }),
        ...(isInternalHeader && { isInternal: isInternalHeader }),
      }

      // Prepare arguments - optionally append execution context
      const invokeArgs = passContext ? [...args, { [RPC_CONTEXT]: executionContext }] : args

      // fn is now known to be a function, cast to callable type for apply()
      let result = await (fn as (...args: unknown[]) => unknown).apply(current, invokeArgs)

      // Handle async generators by consuming them into an array
      if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
        const items: unknown[] = []
        for await (const item of result as AsyncIterable<unknown>) {
          items.push(item)
        }
        result = items
      }

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

/**
 * Creates a Cloudflare Worker export from a target object.
 *
 * This helper wraps any object with RPC methods into a format
 * suitable for Cloudflare Worker export.
 *
 * @param target - The object containing methods to expose via RPC
 * @returns A Worker-compatible export with a fetch handler
 *
 * @example
 * ```typescript
 * import { createWorkerFromTarget } from '@dotdo/rpc'
 *
 * const api = {
 *   greet(name: string) { return `Hello, ${name}!` }
 * }
 *
 * export default createWorkerFromTarget(api)
 * ```
 *
 * @stable
 * @since 1.0.0
 */
export function createWorkerFromTarget(target: object) {
  const app = createServer({ target })

  return {
    fetch: app.fetch.bind(app)
  }
}

/**
 * Extract execution context from method arguments.
 * Use this in RPC methods when passContext is enabled.
 *
 * @example
 * ```typescript
 * class MyAPI {
 *   async myMethod(arg1: string, arg2: number, ctxArg?: unknown) {
 *     const ctx = getExecutionContext(ctxArg)
 *     if (ctx) {
 *       console.log('Correlation ID:', ctx.correlationId)
 *     }
 *     // ...
 *   }
 * }
 * ```
 */
export function getExecutionContext(arg: unknown): RPCExecutionContext | undefined {
  if (arg && typeof arg === 'object' && RPC_CONTEXT in arg) {
    return (arg as { [RPC_CONTEXT]: RPCExecutionContext })[RPC_CONTEXT]
  }
  return undefined
}

/**
 * Helper to get correlation ID from the last argument (for passContext mode)
 */
export function getCorrelationIdFromArgs(args: unknown[]): string | undefined {
  if (args.length === 0) return undefined
  const lastArg = args[args.length - 1]
  const ctx = getExecutionContext(lastArg)
  return ctx?.correlationId
}
