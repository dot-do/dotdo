/**
 * Validation Middleware for Hono
 *
 * Provides Zod-based validation middleware for request body, query params,
 * path params, and headers. Integrates with the error transformation
 * system for consistent error responses.
 */

import type { Context, MiddlewareHandler, ValidationTargets } from 'hono'
import { validator } from 'hono/validator'
import { z, ZodType, ZodError } from 'zod'
import { transformValidationError, ValidationError } from './error-transform'

/**
 * Validation targets supported by the middleware
 */
export type ValidationTarget = keyof ValidationTargets

/**
 * Options for the validation middleware
 */
export interface ValidatorOptions {
  /** Whether to strip unknown keys from objects (default: false) */
  strict?: boolean
  /** Custom error message prefix */
  errorPrefix?: string
  /** Whether to log validation errors in development (default: true) */
  logErrors?: boolean
}

/**
 * Create a Zod validator middleware for request body
 *
 * @param schema - Zod schema to validate against
 * @param options - Validation options
 * @returns Hono middleware handler
 *
 * @example
 * ```ts
 * const CreateUserSchema = z.object({
 *   name: z.string().min(1),
 *   email: z.string().email(),
 * })
 *
 * app.post('/users', zodBody(CreateUserSchema), (c) => {
 *   const data = c.req.valid('json')
 *   // data is fully typed as { name: string, email: string }
 * })
 * ```
 */
export function zodBody<T extends ZodType<unknown>>(
  schema: T,
  options?: ValidatorOptions
) {
  const processedSchema = options?.strict ? makeStrict(schema) : schema

  return validator('json', async (value, c) => {
    const result = await processedSchema.safeParseAsync(value)

    if (!result.success) {
      logValidationError('body', result.error, options)
      throw transformValidationError(result.error, 'body', options?.errorPrefix)
    }

    return result.data as z.infer<T>
  })
}

/**
 * Create a Zod validator middleware for query parameters
 *
 * @param schema - Zod schema to validate against
 * @param options - Validation options
 * @returns Hono middleware handler
 *
 * @example
 * ```ts
 * const QuerySchema = z.object({
 *   page: z.coerce.number().int().positive().default(1),
 *   limit: z.coerce.number().int().min(1).max(100).default(20),
 * })
 *
 * app.get('/items', zodQuery(QuerySchema), (c) => {
 *   const { page, limit } = c.req.valid('query')
 *   // Both are typed as numbers with proper coercion applied
 * })
 * ```
 */
export function zodQuery<T extends ZodType<unknown>>(
  schema: T,
  options?: ValidatorOptions
) {
  const processedSchema = options?.strict ? makeStrict(schema) : schema

  return validator('query', async (value, c) => {
    const result = await processedSchema.safeParseAsync(value)

    if (!result.success) {
      logValidationError('query', result.error, options)
      throw transformValidationError(result.error, 'query', options?.errorPrefix)
    }

    return result.data as z.infer<T>
  })
}

/**
 * Create a Zod validator middleware for path parameters
 *
 * @param schema - Zod schema to validate against
 * @param options - Validation options
 * @returns Hono middleware handler
 *
 * @example
 * ```ts
 * const PathSchema = z.object({
 *   id: z.string().uuid(),
 *   version: z.coerce.number().int().positive(),
 * })
 *
 * app.get('/items/:id/versions/:version', zodParam(PathSchema), (c) => {
 *   const { id, version } = c.req.valid('param')
 * })
 * ```
 */
export function zodParam<T extends ZodType<unknown>>(
  schema: T,
  options?: ValidatorOptions
) {
  const processedSchema = options?.strict ? makeStrict(schema) : schema

  return validator('param', async (value, c) => {
    const result = await processedSchema.safeParseAsync(value)

    if (!result.success) {
      logValidationError('param', result.error, options)
      throw transformValidationError(result.error, 'param', options?.errorPrefix)
    }

    return result.data as z.infer<T>
  })
}

/**
 * Create a Zod validator middleware for request headers
 *
 * @param schema - Zod schema to validate against
 * @param options - Validation options
 * @returns Hono middleware handler
 *
 * @example
 * ```ts
 * const HeaderSchema = z.object({
 *   authorization: z.string().startsWith('Bearer '),
 *   'x-request-id': z.string().uuid().optional(),
 * })
 *
 * app.get('/secure', zodHeader(HeaderSchema), (c) => {
 *   const { authorization } = c.req.valid('header')
 * })
 * ```
 */
export function zodHeader<T extends ZodType<unknown>>(
  schema: T,
  options?: ValidatorOptions
) {
  const processedSchema = options?.strict ? makeStrict(schema) : schema

  return validator('header', async (value, c) => {
    const result = await processedSchema.safeParseAsync(value)

    if (!result.success) {
      logValidationError('header', result.error, options)
      throw transformValidationError(result.error, 'header', options?.errorPrefix)
    }

    return result.data as z.infer<T>
  })
}

/**
 * Create a Zod validator middleware for form data
 *
 * @param schema - Zod schema to validate against
 * @param options - Validation options
 * @returns Hono middleware handler
 */
export function zodForm<T extends ZodType<unknown>>(
  schema: T,
  options?: ValidatorOptions
) {
  const processedSchema = options?.strict ? makeStrict(schema) : schema

  return validator('form', async (value, c) => {
    const result = await processedSchema.safeParseAsync(value)

    if (!result.success) {
      logValidationError('form', result.error, options)
      throw transformValidationError(result.error, 'form', options?.errorPrefix)
    }

    return result.data as z.infer<T>
  })
}

/**
 * Combined validator for multiple validation targets
 *
 * @param schemas - Object containing schemas for each target
 * @param options - Validation options
 * @returns Array of middleware handlers
 *
 * @example
 * ```ts
 * const validators = zodValidate({
 *   body: CreateItemSchema,
 *   query: PaginationSchema,
 *   param: z.object({ orgId: z.string() }),
 * })
 *
 * app.post('/orgs/:orgId/items', ...validators, handler)
 * ```
 */
export function zodValidate<
  B extends ZodType<unknown> | undefined = undefined,
  Q extends ZodType<unknown> | undefined = undefined,
  P extends ZodType<unknown> | undefined = undefined,
  H extends ZodType<unknown> | undefined = undefined,
>(
  schemas: {
    body?: B
    query?: Q
    param?: P
    header?: H
  },
  options?: ValidatorOptions
): MiddlewareHandler[] {
  const middlewares: MiddlewareHandler[] = []

  if (schemas.param) {
    middlewares.push(zodParam(schemas.param, options))
  }
  if (schemas.header) {
    middlewares.push(zodHeader(schemas.header, options))
  }
  if (schemas.query) {
    middlewares.push(zodQuery(schemas.query, options))
  }
  if (schemas.body) {
    middlewares.push(zodBody(schemas.body, options))
  }

  return middlewares
}

/**
 * Make a schema strict (reject unknown keys)
 */
function makeStrict<T extends ZodType<unknown>>(schema: T): T {
  if (schema instanceof z.ZodObject) {
    return schema.strict() as unknown as T
  }
  return schema
}

/**
 * Log validation errors in development mode
 */
function logValidationError(
  target: string,
  error: ZodError,
  options?: ValidatorOptions
): void {
  if (options?.logErrors === false) return
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') return

  console.warn(`[Validation Error] ${target}:`, error.format())
}

/**
 * Global validation configuration
 */
let globalStrictMode = false
let globalLogErrors = true

/**
 * Enable strict validation mode globally
 * In strict mode, extra keys in objects throw errors
 */
export function enableStrictValidation(enabled = true): void {
  globalStrictMode = enabled
}

/**
 * Check if strict validation is enabled
 */
export function isStrictValidationEnabled(): boolean {
  return globalStrictMode
}

/**
 * Enable validation error logging
 */
export function enableValidationLogging(enabled = true): void {
  globalLogErrors = enabled
}

/**
 * Check if validation logging is enabled
 */
export function isValidationLoggingEnabled(): boolean {
  return globalLogErrors
}
