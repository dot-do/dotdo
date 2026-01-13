/**
 * Validated Handler Factory
 *
 * Creates Hono route handlers with built-in request and response validation.
 * Provides type-safe handlers that automatically validate inputs and outputs.
 */

import type { Context, Handler, MiddlewareHandler } from 'hono'
import { z, ZodType } from 'zod'
import { transformValidationError, ValidationError } from './error-transform'

/**
 * Configuration for a validated handler
 */
export interface ValidatedHandlerConfig<
  TBody extends ZodType<unknown> | undefined = undefined,
  TQuery extends ZodType<unknown> | undefined = undefined,
  TParam extends ZodType<unknown> | undefined = undefined,
  THeader extends ZodType<unknown> | undefined = undefined,
  TResponse extends ZodType<unknown> | undefined = undefined,
> {
  /** Schema for request body validation */
  body?: TBody
  /** Schema for query parameter validation */
  query?: TQuery
  /** Schema for path parameter validation */
  param?: TParam
  /** Schema for header validation */
  header?: THeader
  /** Schema for response validation (development only) */
  response?: TResponse
  /** Whether to validate response in production (default: false) */
  validateResponseInProduction?: boolean
}

/**
 * Validated data passed to the handler
 */
export interface ValidatedData<
  TBody = unknown,
  TQuery = unknown,
  TParam = unknown,
  THeader = unknown,
> {
  body: TBody
  query: TQuery
  param: TParam
  header: THeader
}

/**
 * Create a validated handler with type-safe request and response
 *
 * @param config - Validation configuration with schemas
 * @param handler - The handler function receiving validated data
 * @returns Hono handler with built-in validation
 *
 * @example
 * ```ts
 * const handler = createValidatedHandler(
 *   {
 *     body: z.object({ name: z.string() }),
 *     param: z.object({ id: z.string().uuid() }),
 *     response: z.object({ success: z.boolean() }),
 *   },
 *   async ({ body, param }, c) => {
 *     // body and param are fully typed
 *     await updateUser(param.id, body)
 *     return { success: true }
 *   }
 * )
 *
 * app.put('/users/:id', handler)
 * ```
 */
export function createValidatedHandler<
  TBody extends ZodType<unknown> | undefined = undefined,
  TQuery extends ZodType<unknown> | undefined = undefined,
  TParam extends ZodType<unknown> | undefined = undefined,
  THeader extends ZodType<unknown> | undefined = undefined,
  TResponse extends ZodType<unknown> | undefined = undefined,
>(
  config: ValidatedHandlerConfig<TBody, TQuery, TParam, THeader, TResponse>,
  handler: (
    validated: ValidatedData<
      TBody extends ZodType<infer B> ? B : undefined,
      TQuery extends ZodType<infer Q> ? Q : undefined,
      TParam extends ZodType<infer P> ? P : undefined,
      THeader extends ZodType<infer H> ? H : undefined
    >,
    c: Context
  ) => Promise<TResponse extends ZodType<infer R> ? R : unknown>
): Handler {
  return async (c: Context) => {
    // Validate all inputs
    const validated = await validateInputs(c, config)

    // Call the handler
    const result = await handler(validated, c)

    // Validate response if schema provided
    if (config.response) {
      const shouldValidateResponse =
        config.validateResponseInProduction ||
        (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production')

      if (shouldValidateResponse) {
        const responseResult = config.response.safeParse(result)
        if (!responseResult.success) {
          // Log the error but don't expose to client
          console.error(
            '[Response Validation Error]',
            responseResult.error.format()
          )
          if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
            throw new ValidationError({
              message: 'Response validation failed',
              path: [],
              code: 'RESPONSE_VALIDATION_ERROR',
              status: 500,
            })
          }
        }
      }
    }

    return c.json(result)
  }
}

/**
 * Validate all inputs from the request context
 */
async function validateInputs<
  TBody extends ZodType<unknown> | undefined,
  TQuery extends ZodType<unknown> | undefined,
  TParam extends ZodType<unknown> | undefined,
  THeader extends ZodType<unknown> | undefined,
>(
  c: Context,
  config: ValidatedHandlerConfig<TBody, TQuery, TParam, THeader, unknown>
): Promise<
  ValidatedData<
    TBody extends ZodType<infer B> ? B : undefined,
    TQuery extends ZodType<infer Q> ? Q : undefined,
    TParam extends ZodType<infer P> ? P : undefined,
    THeader extends ZodType<infer H> ? H : undefined
  >
> {
  type Result = ValidatedData<
    TBody extends ZodType<infer B> ? B : undefined,
    TQuery extends ZodType<infer Q> ? Q : undefined,
    TParam extends ZodType<infer P> ? P : undefined,
    THeader extends ZodType<infer H> ? H : undefined
  >

  const result: {
    body: unknown
    query: unknown
    param: unknown
    header: unknown
  } = {
    body: undefined,
    query: undefined,
    param: undefined,
    header: undefined,
  }

  // Validate body
  if (config.body) {
    try {
      const body = await c.req.json()
      const parsed = config.body.safeParse(body)
      if (!parsed.success) {
        throw transformValidationError(parsed.error, 'body')
      }
      result.body = parsed.data
    } catch (e) {
      if (e instanceof ValidationError) throw e
      throw new ValidationError({
        message: 'Invalid JSON in request body',
        path: [],
        code: 'BAD_REQUEST',
        status: 400,
      })
    }
  }

  // Validate query
  if (config.query) {
    const query = c.req.query()
    const parsed = config.query.safeParse(query)
    if (!parsed.success) {
      throw transformValidationError(parsed.error, 'query')
    }
    result.query = parsed.data
  }

  // Validate param
  if (config.param) {
    const param = c.req.param()
    const parsed = config.param.safeParse(param)
    if (!parsed.success) {
      throw transformValidationError(parsed.error, 'param')
    }
    result.param = parsed.data
  }

  // Validate header
  if (config.header) {
    // Get all headers as an object
    const headers: Record<string, string> = {}
    c.req.raw.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })
    const parsed = config.header.safeParse(headers)
    if (!parsed.success) {
      throw transformValidationError(parsed.error, 'header')
    }
    result.header = parsed.data
  }

  return result as Result
}

/**
 * Create middleware that validates request body
 *
 * @param schema - Zod schema for body validation
 * @returns Middleware that validates and attaches typed body
 */
export function validateBody<T extends ZodType<unknown>>(
  schema: T
): MiddlewareHandler {
  return async (c, next) => {
    try {
      const body = await c.req.json()
      const result = schema.safeParse(body)

      if (!result.success) {
        throw transformValidationError(result.error, 'body')
      }

      // Store validated body for later use
      c.set('validatedBody', result.data)
      await next()
    } catch (e) {
      if (e instanceof ValidationError) throw e
      throw new ValidationError({
        message: 'Invalid JSON in request body',
        path: [],
        code: 'BAD_REQUEST',
        status: 400,
      })
    }
  }
}

/**
 * Create middleware that validates query parameters
 *
 * @param schema - Zod schema for query validation
 * @returns Middleware that validates and attaches typed query
 */
export function validateQuery<T extends ZodType<unknown>>(
  schema: T
): MiddlewareHandler {
  return async (c, next) => {
    const query = c.req.query()
    const result = schema.safeParse(query)

    if (!result.success) {
      throw transformValidationError(result.error, 'query')
    }

    c.set('validatedQuery', result.data)
    await next()
  }
}

/**
 * Create middleware that validates path parameters
 *
 * @param schema - Zod schema for param validation
 * @returns Middleware that validates and attaches typed params
 */
export function validateParam<T extends ZodType<unknown>>(
  schema: T
): MiddlewareHandler {
  return async (c, next) => {
    const param = c.req.param()
    const result = schema.safeParse(param)

    if (!result.success) {
      throw transformValidationError(result.error, 'param')
    }

    c.set('validatedParam', result.data)
    await next()
  }
}

/**
 * Get validated body from context
 */
export function getValidatedBody<T>(c: Context): T {
  return c.get('validatedBody') as T
}

/**
 * Get validated query from context
 */
export function getValidatedQuery<T>(c: Context): T {
  return c.get('validatedQuery') as T
}

/**
 * Get validated params from context
 */
export function getValidatedParam<T>(c: Context): T {
  return c.get('validatedParam') as T
}

/**
 * Validate API request body using a schema
 *
 * @param schema - Zod schema to validate against
 * @param body - Request body to validate
 * @returns Validated data
 * @throws ValidationError if validation fails
 */
export function validateApiRequest<T>(
  schema: ZodType<T>,
  body: unknown
): T {
  const result = schema.safeParse(body)

  if (!result.success) {
    throw transformValidationError(result.error, 'body')
  }

  return result.data
}

/**
 * Validate API response data
 *
 * @param schema - Zod schema to validate against
 * @param data - Response data to validate
 * @returns Validated data
 * @throws ValidationError if validation fails (in development)
 */
export function validateApiResponse<T>(
  schema: ZodType<T>,
  data: unknown
): T {
  const result = schema.safeParse(data)

  if (!result.success) {
    const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production'
    if (isDev) {
      throw new ValidationError({
        message: 'Response validation failed',
        path: result.error.issues[0]?.path ?? [],
        code: 'RESPONSE_VALIDATION_ERROR',
        status: 500,
      })
    }
    // In production, log but don't throw
    console.error('[Response Validation Error]', result.error.format())
  }

  return data as T
}
