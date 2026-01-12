/**
 * Shared Utilities for Transport Handlers
 *
 * Common utilities used across REST, MCP, RPC, and Auth handlers:
 * - JSON parsing with error handling
 * - Response construction
 * - Error formatting
 * - Request logging
 * - Schema validation
 */

import type { Logger } from './handler'

// ============================================================================
// JSON PARSING
// ============================================================================

/**
 * Result of parsing JSON body
 */
export interface ParseJsonResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Parse JSON body from a request with error handling
 *
 * @param request - The HTTP request to parse
 * @returns Parsed JSON data or error information
 *
 * @example
 * ```typescript
 * const result = await parseJsonBody<{ name: string }>(request)
 * if (!result.success) {
 *   return buildErrorResponse({ message: result.error!, code: 'PARSE_ERROR' }, 400)
 * }
 * const data = result.data!
 * ```
 */
export async function parseJsonBody<T = unknown>(request: Request): Promise<ParseJsonResult<T>> {
  try {
    // Check content type
    const contentType = request.headers.get('Content-Type') || ''

    // Handle empty body
    if (!request.body) {
      return { success: true, data: {} as T }
    }

    // Clone request to avoid consuming the body
    const text = await request.clone().text()

    if (!text || text.trim() === '') {
      return { success: true, data: {} as T }
    }

    // Parse based on content type
    if (contentType.includes('application/json')) {
      const data = JSON.parse(text) as T
      return { success: true, data }
    }

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(text)
      const data: Record<string, string> = {}
      params.forEach((value, key) => {
        data[key] = value
      })
      return { success: true, data: data as T }
    }

    // Try to parse as JSON anyway
    try {
      const data = JSON.parse(text) as T
      return { success: true, data }
    } catch {
      return { success: false, error: 'Unable to parse request body' }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON body'
    return { success: false, error: message }
  }
}

/**
 * Parse JSON body and throw on error (for use in try-catch)
 */
export async function parseJsonBodyOrThrow<T = unknown>(request: Request): Promise<T> {
  const result = await parseJsonBody<T>(request)
  if (!result.success) {
    throw new Error(result.error || 'Failed to parse JSON body')
  }
  return result.data as T
}

// ============================================================================
// RESPONSE CONSTRUCTION
// ============================================================================

/**
 * Options for building JSON responses
 */
export interface JsonResponseOptions {
  /** HTTP status code (default: 200) */
  status?: number
  /** Additional headers */
  headers?: Record<string, string>
  /** Pretty print JSON (default: false) */
  pretty?: boolean
}

/**
 * Build a JSON response with proper headers
 *
 * @param data - The data to serialize
 * @param options - Response options
 * @returns HTTP Response with JSON body
 *
 * @example
 * ```typescript
 * return buildJsonResponse({ id: '123', name: 'Test' }, { status: 201 })
 * ```
 */
export function buildJsonResponse(
  data: unknown,
  options: JsonResponseOptions = {}
): Response {
  const { status = 200, headers = {}, pretty = false } = options

  // Handle null/undefined
  if (data === null || data === undefined) {
    return new Response(null, {
      status: 204,
      headers: { 'Content-Type': 'application/json', ...headers },
    })
  }

  const body = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)

  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

/**
 * Build a streaming JSON response (for large data or real-time updates)
 *
 * @param iterator - Async iterator of data chunks
 * @param options - Response options
 * @returns HTTP Response with streaming body
 */
export function buildStreamingResponse(
  iterator: AsyncIterable<unknown>,
  options: JsonResponseOptions = {}
): Response {
  const { headers = {} } = options
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of iterator) {
          controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'))
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
      ...headers,
    },
  })
}

// ============================================================================
// ERROR FORMATTING
// ============================================================================

/**
 * Standard error structure for transport responses
 */
export interface TransportError {
  /** Error message */
  message: string
  /** Error code */
  code?: string
  /** HTTP status code */
  status?: number
  /** Validation errors */
  errors?: Record<string, string[]>
  /** Retry-After value for rate limiting */
  retryAfter?: number
  /** Stack trace (debug mode only) */
  stack?: string
  /** Request ID for correlation */
  requestId?: string
}

/**
 * Build an error response with proper formatting
 *
 * @param error - Error information
 * @param status - HTTP status code (default: from error or 500)
 * @param options - Additional options
 * @returns HTTP Response with error body
 *
 * @example
 * ```typescript
 * return buildErrorResponse(
 *   { message: 'Not found', code: 'NOT_FOUND' },
 *   404
 * )
 * ```
 */
export function buildErrorResponse(
  error: TransportError | Error | string,
  status?: number,
  options: { debug?: boolean; requestId?: string; headers?: Record<string, string> } = {}
): Response {
  const { debug = false, requestId, headers = {} } = options

  let errorBody: { error: TransportError }

  if (typeof error === 'string') {
    errorBody = {
      error: {
        message: error,
        code: 'ERROR',
        ...(requestId && { requestId }),
      },
    }
  } else if (error instanceof Error) {
    errorBody = {
      error: {
        message: error.message,
        code: error.name.toUpperCase().replace('ERROR', '').replace(/\s+/g, '_') || 'INTERNAL_ERROR',
        ...(debug && { stack: error.stack }),
        ...(requestId && { requestId }),
      },
    }
  } else {
    errorBody = {
      error: {
        message: error.message,
        code: error.code || 'ERROR',
        ...(error.errors && { errors: error.errors }),
        ...(error.retryAfter && { retryAfter: error.retryAfter }),
        ...(debug && error.stack && { stack: error.stack }),
        ...(requestId && { requestId }),
      },
    }
  }

  const responseStatus = status ?? (error as TransportError).status ?? 500

  const responseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  }

  if ((error as TransportError).retryAfter) {
    responseHeaders['Retry-After'] = String((error as TransportError).retryAfter)
  }

  return new Response(JSON.stringify(errorBody), {
    status: responseStatus,
    headers: responseHeaders,
  })
}

/**
 * Map common errors to HTTP status codes
 */
export function mapErrorToStatus(error: Error | TransportError): number {
  // Check for explicit status
  if ('status' in error && typeof error.status === 'number') {
    return error.status
  }

  // Check for statusCode property (common convention)
  if ('statusCode' in error && typeof (error as Error & { statusCode?: number }).statusCode === 'number') {
    return (error as Error & { statusCode: number }).statusCode
  }

  // Map by error name/code
  const code = ('code' in error ? error.code : (error as Error).name) || ''

  const statusMap: Record<string, number> = {
    VALIDATION_ERROR: 400,
    INVALID_REQUEST: 400,
    PARSE_ERROR: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    CONFLICT: 409,
    RATE_LIMIT_EXCEEDED: 429,
    INTERNAL_ERROR: 500,
    NOT_IMPLEMENTED: 501,
    SERVICE_UNAVAILABLE: 503,
  }

  return statusMap[code.toUpperCase()] || 500
}

// ============================================================================
// REQUEST LOGGING
// ============================================================================

/**
 * Log entry for request tracking
 */
export interface RequestLog {
  timestamp: Date
  method: string
  path: string
  status?: number
  durationMs?: number
  requestId?: string
  userId?: string
  userAgent?: string
  ip?: string
  error?: string
}

/**
 * Log a request for debugging/monitoring
 *
 * @param request - The HTTP request
 * @param context - Additional context
 * @param logger - Optional logger instance
 *
 * @example
 * ```typescript
 * const log = logRequest(request, { status: 200, durationMs: 45 })
 * console.log(`${log.method} ${log.path} - ${log.status} (${log.durationMs}ms)`)
 * ```
 */
export function logRequest(
  request: Request,
  context: {
    status?: number
    durationMs?: number
    requestId?: string
    userId?: string
    error?: string
  } = {},
  logger?: Logger
): RequestLog {
  const url = new URL(request.url)

  const log: RequestLog = {
    timestamp: new Date(),
    method: request.method,
    path: url.pathname,
    status: context.status,
    durationMs: context.durationMs,
    requestId: context.requestId || request.headers.get('X-Request-ID') || undefined,
    userId: context.userId,
    userAgent: request.headers.get('User-Agent') || undefined,
    ip: request.headers.get('CF-Connecting-IP') ||
        request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
        undefined,
    error: context.error,
  }

  if (logger) {
    const level = log.error ? 'error' : log.status && log.status >= 400 ? 'warn' : 'info'
    logger[level](
      `${log.method} ${log.path} ${log.status || '-'} ${log.durationMs || '-'}ms`,
      { requestId: log.requestId, userId: log.userId }
    )
  }

  return log
}

/**
 * Create a request timer for measuring duration
 *
 * @returns Timer object with stop() method
 */
export function createRequestTimer(): { stop: () => number } {
  const start = Date.now()
  return {
    stop: () => Date.now() - start,
  }
}

// ============================================================================
// SCHEMA VALIDATION
// ============================================================================

/**
 * JSON Schema property definition
 */
export interface SchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description?: string
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  pattern?: string
  format?: 'email' | 'uri' | 'date' | 'date-time' | 'uuid'
  items?: SchemaProperty
  properties?: Record<string, SchemaProperty>
  required?: string[]
}

/**
 * JSON Schema definition
 */
export interface JsonSchema {
  type: 'object'
  properties: Record<string, SchemaProperty>
  required?: string[]
  additionalProperties?: boolean
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean
  errors: Record<string, string[]>
}

/**
 * Validate data against a JSON schema
 *
 * @param data - Data to validate
 * @param schema - JSON schema to validate against
 * @returns Validation result with errors
 *
 * @example
 * ```typescript
 * const result = validateSchema(data, {
 *   type: 'object',
 *   properties: {
 *     name: { type: 'string', minLength: 1 },
 *     email: { type: 'string', format: 'email' }
 *   },
 *   required: ['name', 'email']
 * })
 *
 * if (!result.valid) {
 *   return buildErrorResponse({ message: 'Validation failed', errors: result.errors }, 400)
 * }
 * ```
 */
export function validateSchema(
  data: Record<string, unknown>,
  schema: JsonSchema
): ValidationResult {
  const errors: Record<string, string[]> = {}

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (data[field] === undefined || data[field] === null) {
        errors[field] = errors[field] || []
        errors[field].push(`${field} is required`)
      }
    }
  }

  // Validate properties
  for (const [field, prop] of Object.entries(schema.properties)) {
    const value = data[field]
    if (value === undefined || value === null) continue

    const fieldErrors = validateProperty(value, prop, field)
    if (fieldErrors.length > 0) {
      errors[field] = fieldErrors
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  }
}

/**
 * Validate a single property value
 */
function validateProperty(value: unknown, prop: SchemaProperty, field: string): string[] {
  const errors: string[] = []

  // Type check
  if (prop.type === 'string' && typeof value !== 'string') {
    errors.push(`${field} must be a string`)
    return errors
  }
  if (prop.type === 'number' && typeof value !== 'number') {
    errors.push(`${field} must be a number`)
    return errors
  }
  if (prop.type === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${field} must be a boolean`)
    return errors
  }
  if (prop.type === 'array' && !Array.isArray(value)) {
    errors.push(`${field} must be an array`)
    return errors
  }
  if (prop.type === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
    errors.push(`${field} must be an object`)
    return errors
  }

  // String validations
  if (typeof value === 'string') {
    if (prop.minLength !== undefined && value.length < prop.minLength) {
      errors.push(`${field} must be at least ${prop.minLength} characters`)
    }
    if (prop.maxLength !== undefined && value.length > prop.maxLength) {
      errors.push(`${field} must be at most ${prop.maxLength} characters`)
    }
    if (prop.pattern) {
      const regex = new RegExp(prop.pattern)
      if (!regex.test(value)) {
        errors.push(`${field} must match pattern ${prop.pattern}`)
      }
    }
    if (prop.format === 'email' && !isValidEmail(value)) {
      errors.push(`${field} must be a valid email`)
    }
    if (prop.format === 'uri' && !isValidUri(value)) {
      errors.push(`${field} must be a valid URI`)
    }
    if (prop.format === 'uuid' && !isValidUuid(value)) {
      errors.push(`${field} must be a valid UUID`)
    }
  }

  // Number validations
  if (typeof value === 'number') {
    if (prop.minimum !== undefined && value < prop.minimum) {
      errors.push(`${field} must be at least ${prop.minimum}`)
    }
    if (prop.maximum !== undefined && value > prop.maximum) {
      errors.push(`${field} must be at most ${prop.maximum}`)
    }
  }

  // Array validations
  if (Array.isArray(value) && prop.items) {
    for (let i = 0; i < value.length; i++) {
      const itemErrors = validateProperty(value[i], prop.items, `${field}[${i}]`)
      errors.push(...itemErrors)
    }
  }

  // Nested object validations
  if (prop.type === 'object' && prop.properties && typeof value === 'object' && value !== null) {
    const nestedSchema: JsonSchema = {
      type: 'object',
      properties: prop.properties,
      required: prop.required,
    }
    const nestedResult = validateSchema(value as Record<string, unknown>, nestedSchema)
    for (const [nestedField, nestedErrors] of Object.entries(nestedResult.errors)) {
      errors.push(...nestedErrors.map((e) => `${field}.${nestedField}: ${e}`))
    }
  }

  return errors
}

/**
 * Simple email validation
 */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/**
 * Simple URI validation
 */
function isValidUri(uri: string): boolean {
  try {
    new URL(uri)
    return true
  } catch {
    return false
  }
}

/**
 * UUID validation
 */
function isValidUuid(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)
}

// ============================================================================
// COMPILED SCHEMA CACHE
// ============================================================================

/**
 * Cache for compiled validators to avoid re-parsing schemas
 */
const schemaCache = new Map<string, JsonSchema>()

/**
 * Get or create a cached schema validator
 *
 * @param schemaKey - Unique key for the schema
 * @param schemaFactory - Factory function to create the schema
 * @returns Cached schema
 */
export function getCachedSchema(schemaKey: string, schemaFactory: () => JsonSchema): JsonSchema {
  if (!schemaCache.has(schemaKey)) {
    schemaCache.set(schemaKey, schemaFactory())
  }
  return schemaCache.get(schemaKey)!
}

/**
 * Clear the schema cache
 */
export function clearSchemaCache(): void {
  schemaCache.clear()
}

// ============================================================================
// HTTP HELPERS
// ============================================================================

/**
 * Extract path parameters from a URL path
 */
export function extractPathParams(
  pattern: string,
  path: string
): Record<string, string> | null {
  // Normalize trailing slashes
  const normalizedPattern = pattern.replace(/\/$/, '')
  const normalizedPath = path.replace(/\/$/, '')

  // Build regex from pattern
  const paramNames: string[] = []
  let regexStr = '^'

  const segments = normalizedPattern.split('/').filter((s, i) => i !== 0 || s !== '')

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    if (!segment) continue

    if (i === 0 || regexStr !== '^') {
      regexStr += '/'
    }

    if (segment.startsWith(':')) {
      const isOptional = segment.endsWith('?')
      const paramName = isOptional ? segment.slice(1, -1) : segment.slice(1)
      paramNames.push(paramName)

      if (isOptional) {
        regexStr = regexStr.slice(0, -1)
        regexStr += '(?:/([^/]*))?'
      } else {
        regexStr += '([^/]+)'
      }
    } else if (segment.startsWith('*')) {
      const paramName = segment.slice(1)
      paramNames.push(paramName)
      regexStr += '(.+)'
    } else {
      regexStr += segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }

  regexStr += '$'

  const regex = new RegExp(regexStr)
  const match = normalizedPath.match(regex)

  if (!match) {
    return null
  }

  const params: Record<string, string> = {}
  for (let i = 0; i < paramNames.length; i++) {
    const value = match[i + 1]
    const paramName = paramNames[i]!
    if (value !== undefined && value !== '') {
      params[paramName] = decodeURIComponent(value)
    }
  }

  return params
}

/**
 * Parse query parameters from a URL
 */
export function parseQueryParams(url: URL): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {}

  url.searchParams.forEach((value, key) => {
    if (key in params) {
      const existing = params[key]!
      if (Array.isArray(existing)) {
        existing.push(value)
      } else {
        params[key] = [existing, value]
      }
    } else {
      params[key] = value
    }
  })

  return params
}

/**
 * Parse Accept header into weighted list of types
 */
export function parseAcceptHeader(header: string): Array<{ type: string; quality: number }> {
  return header
    .split(',')
    .map((part) => {
      const [type, ...params] = part.trim().split(';')
      let quality = 1.0

      for (const param of params) {
        const [key, value] = param.trim().split('=')
        if (key === 'q') {
          quality = parseFloat(value!) || 1.0
        }
      }

      return { type: type!.trim(), quality }
    })
    .sort((a, b) => b.quality - a.quality)
}

/**
 * Get best matching content type from Accept header
 */
export function getBestContentType(
  acceptHeader: string,
  supported: string[]
): string | null {
  const accepted = parseAcceptHeader(acceptHeader)

  for (const { type } of accepted) {
    if (type === '*/*') {
      return supported[0] || null
    }
    if (supported.includes(type)) {
      return type
    }
    // Check type/*
    const typeBase = type.split('/')[0]
    if (type.endsWith('/*')) {
      const match = supported.find((s) => s.startsWith(`${typeBase}/`))
      if (match) return match
    }
  }

  return null
}
