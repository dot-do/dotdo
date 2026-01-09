/**
 * FunctionMiddleware
 *
 * Pre-built middleware for function execution:
 * - Logging middleware
 * - Metrics middleware
 * - Auth middleware
 * - Validation middleware
 * - Rate limiting middleware
 * - Caching middleware
 */

import type { ExecutionMiddleware, MiddlewareContext, MiddlewareNext } from './BaseFunctionExecutor'

// ============================================================================
// TYPES
// ============================================================================

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  timestamp: Date
  functionId: string
  invocationId: string
  functionType: string
  duration?: number
  success?: boolean
  error?: string
  metadata?: Record<string, unknown>
}

export type LogSink = (entry: LogEntry) => void | Promise<void>

export interface MetricsEntry {
  functionId: string
  functionType: string
  duration: number
  success: boolean
  timestamp: Date
  metadata?: Record<string, unknown>
}

export type MetricsSink = (entry: MetricsEntry) => void | Promise<void>

export interface AuthContext {
  userId?: string
  roles?: string[]
  permissions?: string[]
  token?: string
  [key: string]: unknown
}

export type AuthProvider = (
  ctx: MiddlewareContext
) => AuthContext | Promise<AuthContext | null> | null

export type AuthValidator = (
  ctx: MiddlewareContext,
  auth: AuthContext
) => boolean | Promise<boolean>

export interface CacheEntry<T = unknown> {
  value: T
  expiresAt: number
}

export interface CacheStore<T = unknown> {
  get: (key: string) => CacheEntry<T> | undefined | Promise<CacheEntry<T> | undefined>
  set: (key: string, entry: CacheEntry<T>) => void | Promise<void>
  delete: (key: string) => void | Promise<void>
}

export interface RateLimitInfo {
  remaining: number
  limit: number
  resetAt: Date
}

export interface RateLimitStore {
  check: (key: string) => Promise<RateLimitInfo>
  increment: (key: string) => Promise<void>
}

// ============================================================================
// LOGGING MIDDLEWARE
// ============================================================================

export interface LoggingOptions {
  sink?: LogSink
  logInput?: boolean
  logOutput?: boolean
  logErrors?: boolean
  level?: 'debug' | 'info' | 'warn' | 'error'
}

/**
 * Create logging middleware
 */
export function createLoggingMiddleware(options: LoggingOptions = {}): ExecutionMiddleware {
  const {
    sink = (entry) => console.log(JSON.stringify(entry)),
    logInput = false,
    logOutput = false,
    logErrors = true,
    level = 'info',
  } = options

  return async (ctx, next) => {
    const startTime = Date.now()

    // Log start
    await sink({
      level,
      message: `Function started: ${ctx.functionId}`,
      timestamp: new Date(),
      functionId: ctx.functionId,
      invocationId: ctx.invocationId,
      functionType: ctx.functionType,
      metadata: logInput ? { input: ctx.input } : undefined,
    })

    try {
      const result = await next()

      // Log success
      await sink({
        level,
        message: `Function completed: ${ctx.functionId}`,
        timestamp: new Date(),
        functionId: ctx.functionId,
        invocationId: ctx.invocationId,
        functionType: ctx.functionType,
        duration: Date.now() - startTime,
        success: true,
        metadata: logOutput ? { output: result } : undefined,
      })

      return result
    } catch (error) {
      // Log error
      if (logErrors) {
        await sink({
          level: 'error',
          message: `Function failed: ${ctx.functionId}`,
          timestamp: new Date(),
          functionId: ctx.functionId,
          invocationId: ctx.invocationId,
          functionType: ctx.functionType,
          duration: Date.now() - startTime,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      throw error
    }
  }
}

// ============================================================================
// METRICS MIDDLEWARE
// ============================================================================

export interface MetricsOptions {
  sink: MetricsSink
  includeMetadata?: boolean
}

/**
 * Create metrics middleware
 */
export function createMetricsMiddleware(options: MetricsOptions): ExecutionMiddleware {
  const { sink, includeMetadata = false } = options

  return async (ctx, next) => {
    const startTime = Date.now()

    try {
      const result = await next()

      await sink({
        functionId: ctx.functionId,
        functionType: ctx.functionType,
        duration: Date.now() - startTime,
        success: true,
        timestamp: new Date(),
        metadata: includeMetadata ? ctx.metadata : undefined,
      })

      return result
    } catch (error) {
      await sink({
        functionId: ctx.functionId,
        functionType: ctx.functionType,
        duration: Date.now() - startTime,
        success: false,
        timestamp: new Date(),
        metadata: includeMetadata ? ctx.metadata : undefined,
      })

      throw error
    }
  }
}

/**
 * Create a simple in-memory metrics collector
 */
export function createMetricsCollector(): {
  middleware: ExecutionMiddleware
  getMetrics: () => MetricsEntry[]
  getSummary: () => {
    total: number
    succeeded: number
    failed: number
    avgDuration: number
    byFunction: Record<string, { count: number; avgDuration: number; successRate: number }>
  }
  clear: () => void
} {
  const entries: MetricsEntry[] = []

  const middleware = createMetricsMiddleware({
    sink: (entry) => {
      entries.push(entry)
    },
  })

  return {
    middleware,
    getMetrics: () => [...entries],
    getSummary: () => {
      const total = entries.length
      const succeeded = entries.filter((e) => e.success).length
      const failed = total - succeeded
      const avgDuration = total > 0 ? entries.reduce((sum, e) => sum + e.duration, 0) / total : 0

      const byFunction: Record<string, { count: number; totalDuration: number; succeeded: number }> = {}
      for (const entry of entries) {
        if (!byFunction[entry.functionId]) {
          byFunction[entry.functionId] = { count: 0, totalDuration: 0, succeeded: 0 }
        }
        byFunction[entry.functionId].count++
        byFunction[entry.functionId].totalDuration += entry.duration
        if (entry.success) {
          byFunction[entry.functionId].succeeded++
        }
      }

      const byFunctionSummary: Record<string, { count: number; avgDuration: number; successRate: number }> = {}
      for (const [fnId, data] of Object.entries(byFunction)) {
        byFunctionSummary[fnId] = {
          count: data.count,
          avgDuration: data.totalDuration / data.count,
          successRate: data.succeeded / data.count,
        }
      }

      return {
        total,
        succeeded,
        failed,
        avgDuration,
        byFunction: byFunctionSummary,
      }
    },
    clear: () => {
      entries.length = 0
    },
  }
}

// ============================================================================
// AUTH MIDDLEWARE
// ============================================================================

export class AuthenticationError extends Error {
  constructor(message: string = 'Authentication required') {
    super(message)
    this.name = 'AuthenticationError'
  }
}

export class AuthorizationError extends Error {
  constructor(message: string = 'Not authorized') {
    super(message)
    this.name = 'AuthorizationError'
  }
}

export interface AuthOptions {
  provider: AuthProvider
  validator?: AuthValidator
  required?: boolean
  requiredRoles?: string[]
  requiredPermissions?: string[]
}

/**
 * Create auth middleware
 */
export function createAuthMiddleware(options: AuthOptions): ExecutionMiddleware {
  const {
    provider,
    validator,
    required = true,
    requiredRoles = [],
    requiredPermissions = [],
  } = options

  return async (ctx, next) => {
    // Get auth context
    const auth = await provider(ctx)

    // Check if auth is required
    if (required && !auth) {
      throw new AuthenticationError()
    }

    if (auth) {
      // Custom validator
      if (validator) {
        const valid = await validator(ctx, auth)
        if (!valid) {
          throw new AuthorizationError()
        }
      }

      // Check required roles
      if (requiredRoles.length > 0) {
        const hasRole = requiredRoles.some((role) => auth.roles?.includes(role))
        if (!hasRole) {
          throw new AuthorizationError(`Missing required role: ${requiredRoles.join(' or ')}`)
        }
      }

      // Check required permissions
      if (requiredPermissions.length > 0) {
        const hasPermission = requiredPermissions.every((perm) =>
          auth.permissions?.includes(perm)
        )
        if (!hasPermission) {
          throw new AuthorizationError(`Missing required permissions: ${requiredPermissions.join(', ')}`)
        }
      }

      // Store auth in metadata for downstream use
      ctx.metadata.auth = auth
    }

    return next()
  }
}

// ============================================================================
// VALIDATION MIDDLEWARE
// ============================================================================

export interface ValidationOptions {
  inputValidator?: (input: unknown) => boolean | string | Promise<boolean | string>
  outputValidator?: (output: unknown) => boolean | string | Promise<boolean | string>
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

/**
 * Create validation middleware
 */
export function createValidationMiddleware(options: ValidationOptions): ExecutionMiddleware {
  const { inputValidator, outputValidator } = options

  return async (ctx, next) => {
    // Validate input
    if (inputValidator) {
      const inputResult = await inputValidator(ctx.input)
      if (inputResult === false) {
        throw new ValidationError('Input validation failed')
      }
      if (typeof inputResult === 'string') {
        throw new ValidationError(inputResult)
      }
    }

    const result = await next()

    // Validate output
    if (outputValidator) {
      const outputResult = await outputValidator(result)
      if (outputResult === false) {
        throw new ValidationError('Output validation failed')
      }
      if (typeof outputResult === 'string') {
        throw new ValidationError(outputResult)
      }
    }

    return result
  }
}

// ============================================================================
// RATE LIMITING MIDDLEWARE
// ============================================================================

export class RateLimitError extends Error {
  remaining: number
  resetAt: Date

  constructor(message: string, remaining: number, resetAt: Date) {
    super(message)
    this.name = 'RateLimitError'
    this.remaining = remaining
    this.resetAt = resetAt
  }
}

export interface RateLimitOptions {
  store: RateLimitStore
  keyGenerator?: (ctx: MiddlewareContext) => string
  onLimit?: (ctx: MiddlewareContext, info: RateLimitInfo) => void
}

/**
 * Create rate limiting middleware
 */
export function createRateLimitMiddleware(options: RateLimitOptions): ExecutionMiddleware {
  const {
    store,
    keyGenerator = (ctx) => `${ctx.functionId}:${ctx.metadata.userId || 'anonymous'}`,
    onLimit,
  } = options

  return async (ctx, next) => {
    const key = keyGenerator(ctx)
    const info = await store.check(key)

    if (info.remaining <= 0) {
      onLimit?.(ctx, info)
      throw new RateLimitError(
        `Rate limit exceeded. Try again after ${info.resetAt.toISOString()}`,
        info.remaining,
        info.resetAt
      )
    }

    await store.increment(key)
    return next()
  }
}

/**
 * Create a simple in-memory rate limit store
 */
export function createInMemoryRateLimitStore(
  limit: number,
  windowMs: number
): RateLimitStore {
  const windows: Map<string, { count: number; resetAt: number }> = new Map()

  return {
    async check(key: string): Promise<RateLimitInfo> {
      const now = Date.now()
      const window = windows.get(key)

      if (!window || window.resetAt < now) {
        return {
          remaining: limit,
          limit,
          resetAt: new Date(now + windowMs),
        }
      }

      return {
        remaining: Math.max(0, limit - window.count),
        limit,
        resetAt: new Date(window.resetAt),
      }
    },

    async increment(key: string): Promise<void> {
      const now = Date.now()
      const window = windows.get(key)

      if (!window || window.resetAt < now) {
        windows.set(key, { count: 1, resetAt: now + windowMs })
      } else {
        window.count++
      }
    },
  }
}

// ============================================================================
// CACHING MIDDLEWARE
// ============================================================================

export interface CacheOptions {
  store: CacheStore
  keyGenerator?: (ctx: MiddlewareContext) => string
  ttl: number
  shouldCache?: (ctx: MiddlewareContext, result: unknown) => boolean
}

/**
 * Create caching middleware
 */
export function createCachingMiddleware(options: CacheOptions): ExecutionMiddleware {
  const {
    store,
    keyGenerator = (ctx) => `${ctx.functionId}:${JSON.stringify(ctx.input)}`,
    ttl,
    shouldCache = () => true,
  } = options

  return async (ctx, next) => {
    const key = keyGenerator(ctx)

    // Check cache
    const cached = await store.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      ctx.metadata.cacheHit = true
      return cached.value
    }

    // Execute function
    const result = await next()

    // Cache result
    if (shouldCache(ctx, result)) {
      await store.set(key, {
        value: result,
        expiresAt: Date.now() + ttl,
      })
    }

    ctx.metadata.cacheHit = false
    return result
  }
}

/**
 * Create a simple in-memory cache store
 */
export function createInMemoryCacheStore<T = unknown>(): CacheStore<T> {
  const cache: Map<string, CacheEntry<T>> = new Map()

  // Periodic cleanup
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of cache) {
      if (entry.expiresAt < now) {
        cache.delete(key)
      }
    }
  }, 60000) // Clean up every minute

  return {
    get(key: string): CacheEntry<T> | undefined {
      return cache.get(key)
    },
    set(key: string, entry: CacheEntry<T>): void {
      cache.set(key, entry)
    },
    delete(key: string): void {
      cache.delete(key)
    },
  }
}

// ============================================================================
// TIMEOUT MIDDLEWARE
// ============================================================================

export class TimeoutError extends Error {
  constructor(timeout: number) {
    super(`Function execution timed out after ${timeout}ms`)
    this.name = 'TimeoutError'
  }
}

export interface TimeoutOptions {
  timeout: number
  onTimeout?: (ctx: MiddlewareContext) => void
}

/**
 * Create timeout middleware
 */
export function createTimeoutMiddleware(options: TimeoutOptions): ExecutionMiddleware {
  const { timeout, onTimeout } = options

  return async (ctx, next) => {
    return Promise.race([
      next(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          onTimeout?.(ctx)
          reject(new TimeoutError(timeout))
        }, timeout)
      }),
    ])
  }
}

// ============================================================================
// TRACING MIDDLEWARE
// ============================================================================

export interface TraceSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  operationName: string
  startTime: number
  endTime?: number
  tags: Record<string, string | number | boolean>
  logs: Array<{ timestamp: number; message: string; data?: unknown }>
}

export type TraceSink = (span: TraceSpan) => void | Promise<void>

export interface TracingOptions {
  sink: TraceSink
  extractTraceContext?: (ctx: MiddlewareContext) => { traceId?: string; parentSpanId?: string }
}

/**
 * Create tracing middleware
 */
export function createTracingMiddleware(options: TracingOptions): ExecutionMiddleware {
  const { sink, extractTraceContext } = options

  return async (ctx, next) => {
    const traceContext = extractTraceContext?.(ctx) ?? {}
    const traceId = traceContext.traceId ?? crypto.randomUUID()
    const spanId = crypto.randomUUID()

    const span: TraceSpan = {
      traceId,
      spanId,
      parentSpanId: traceContext.parentSpanId,
      operationName: ctx.functionId,
      startTime: Date.now(),
      tags: {
        'function.type': ctx.functionType,
        'function.id': ctx.functionId,
        'invocation.id': ctx.invocationId,
      },
      logs: [],
    }

    // Store span info in metadata for downstream use
    ctx.metadata.traceId = traceId
    ctx.metadata.spanId = spanId

    try {
      const result = await next()

      span.endTime = Date.now()
      span.tags['success'] = true

      await sink(span)

      return result
    } catch (error) {
      span.endTime = Date.now()
      span.tags['success'] = false
      span.tags['error'] = true
      span.tags['error.message'] = error instanceof Error ? error.message : String(error)

      await sink(span)

      throw error
    }
  }
}

// ============================================================================
// COMPOSE MIDDLEWARE
// ============================================================================

/**
 * Compose multiple middleware into a single middleware
 */
export function composeMiddleware(...middlewares: ExecutionMiddleware[]): ExecutionMiddleware {
  return async (ctx, finalNext) => {
    let index = -1

    const dispatch = async (i: number): Promise<unknown> => {
      if (i <= index) {
        throw new Error('next() called multiple times')
      }
      index = i

      if (i >= middlewares.length) {
        return finalNext()
      }

      const middleware = middlewares[i]
      return middleware(ctx, () => dispatch(i + 1))
    }

    return dispatch(0)
  }
}

export default {
  createLoggingMiddleware,
  createMetricsMiddleware,
  createMetricsCollector,
  createAuthMiddleware,
  createValidationMiddleware,
  createRateLimitMiddleware,
  createInMemoryRateLimitStore,
  createCachingMiddleware,
  createInMemoryCacheStore,
  createTimeoutMiddleware,
  createTracingMiddleware,
  composeMiddleware,
}
