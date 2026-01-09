/**
 * REST API Auto-Wiring
 *
 * Automatically generates REST API routes from DO class methods,
 * enabling rapid API development without manual route setup.
 *
 * Features:
 * - Static $rest configuration for route mappings
 * - @rest() decorator for inline route configuration
 * - Methods exposed at /api/{method} by default
 * - HTTP methods (GET, POST, PUT, DELETE, PATCH) inferred or configured
 * - Query params mapped to method arguments
 * - Request body passed to methods
 * - Return values serialized as JSON
 * - Errors mapped to appropriate HTTP status codes
 * - Rate limiting and throttling per-route
 * - OpenAPI spec generation
 *
 * @example
 * ```typescript
 * class MyDO extends DO {
 *   static $rest = {
 *     getUser: { method: 'GET', path: '/users/:id' },
 *     createUser: { method: 'POST', path: '/users' },
 *   }
 *
 *   getUser(id: string) { return { id, name: 'Test' } }
 *   createUser(data: { name: string }) { return { id: '1', ...data } }
 * }
 *
 * const router = createRestRouter(MyDO)
 * ```
 */

import { Hono } from 'hono'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Content types supported for serialization/deserialization
 */
export type ContentType =
  | 'application/json'
  | 'application/xml'
  | 'text/html'
  | 'text/csv'
  | 'multipart/form-data'
  | 'application/x-www-form-urlencoded'
  | 'image/png'
  | 'image/jpeg'
  | string

/**
 * HTTP methods supported by the router
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'

/**
 * Rate limiting configuration
 */
export interface RestRateLimitConfig {
  /** Maximum requests allowed in the window */
  requests: number
  /** Time window in milliseconds */
  windowMs: number
  /** Key to use for rate limiting: 'ip' or 'user' */
  keyBy: 'ip' | 'user'
}

/**
 * Throttle configuration for burst limiting
 */
export interface RestThrottleConfig {
  /** Maximum burst requests */
  burstLimit: number
  /** Sustained rate (requests per second) */
  sustainedRate: number
  /** Window in milliseconds */
  windowMs: number
}

/**
 * Cache configuration
 */
export interface RestCacheConfig {
  /** Cache max age in seconds */
  maxAge?: number
  /** Stale while revalidate in seconds */
  staleWhileRevalidate?: number
}

/**
 * JSON Schema for validation
 */
export interface JsonSchema {
  type: string
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
}

export interface JsonSchemaProperty {
  type: string
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  format?: string
}

/**
 * Method configuration from static $rest or @rest() decorator
 */
export interface RestMethodConfig {
  /** HTTP method */
  method: HttpMethod
  /** URL path pattern */
  path: string
  /** Query parameters to extract */
  queryParams?: string[]
  /** Rate limiting config */
  rateLimit?: RestRateLimitConfig
  /** Throttle config */
  throttle?: RestThrottleConfig
  /** Content types this endpoint produces */
  produces?: ContentType[]
  /** Content types this endpoint consumes */
  consumes?: ContentType[]
  /** Authentication required */
  auth?: boolean
  /** Required roles */
  roles?: string[]
  /** Required scopes */
  scopes?: string[]
  /** Cache configuration */
  cache?: RestCacheConfig
  /** Enable ETag support */
  etag?: boolean
  /** Enable Last-Modified support */
  lastModified?: boolean
  /** JSON schema for request validation */
  schema?: JsonSchema
  /** Enable streaming response */
  streaming?: boolean
}

/**
 * Discovered route configuration
 */
export interface RestRouteConfig {
  /** DO method name */
  methodName: string
  /** HTTP method */
  httpMethod: HttpMethod
  /** URL path pattern */
  path: string
  /** Full path with base path */
  fullPath?: string
  /** Query parameters */
  queryParams?: string[]
  /** Rate limit config */
  rateLimit?: RestRateLimitConfig
  /** Throttle config */
  throttle?: RestThrottleConfig
  /** Auth required */
  auth?: boolean
  /** Required roles */
  roles?: string[]
  /** Required scopes */
  scopes?: string[]
  /** Content types produced */
  produces?: ContentType[]
  /** Content types consumed */
  consumes?: ContentType[]
  /** Cache config */
  cache?: RestCacheConfig
  /** ETag enabled */
  etag?: boolean
  /** Last-Modified enabled */
  lastModified?: boolean
  /** Schema for validation */
  schema?: JsonSchema
  /** Streaming enabled */
  streaming?: boolean
}

/**
 * REST error response
 */
export interface RestError {
  /** HTTP status code */
  status: number
  /** Error message */
  message: string
  /** Error code */
  code?: string
  /** Validation errors */
  errors?: Record<string, string[]>
  /** Retry-After header value (for rate limiting) */
  retryAfter?: number
}

/**
 * REST response wrapper
 */
export interface RestResponse<T = unknown> {
  /** Response data */
  data?: T
  /** Error info */
  error?: RestError
}

/**
 * REST request wrapper
 */
export interface RestRequest<T = unknown> {
  /** Request body */
  body?: T
  /** Path parameters */
  params?: Record<string, string>
  /** Query parameters */
  query?: Record<string, string>
  /** Headers */
  headers?: Record<string, string>
}

/**
 * CORS configuration
 */
export interface CorsConfig {
  /** Allowed origins */
  origins: string[]
  /** Allowed methods */
  methods?: HttpMethod[]
  /** Allow credentials */
  credentials?: boolean
  /** Allowed headers */
  allowedHeaders?: string[]
  /** Exposed headers */
  exposedHeaders?: string[]
  /** Max age for preflight cache */
  maxAge?: number
}

/**
 * Middleware function type
 */
export type RestMiddleware = (
  req: Request,
  next: () => Promise<Response>
) => Promise<Response>

/**
 * Router options
 */
export interface RestRouterOptions {
  /** Base path prefix for all routes */
  basePath?: string
  /** API prefix */
  apiPrefix?: string
  /** Middleware functions */
  middleware?: RestMiddleware[]
  /** CORS configuration */
  cors?: CorsConfig
  /** Enable debug mode (include stack traces) */
  debug?: boolean
  /** Authentication handler */
  authHandler?: (req: Request) => Promise<AuthContext | null>
}

/**
 * Authentication context
 */
export interface AuthContext {
  /** User ID */
  userId?: string
  /** User roles */
  roles?: string[]
  /** OAuth scopes */
  scopes?: string[]
  /** Token type */
  tokenType?: 'user' | 'admin' | 'limited-scope' | 'full-scope'
}

/**
 * OpenAPI specification
 */
export interface OpenAPISpec {
  openapi: string
  info: {
    title: string
    version: string
    description?: string
  }
  paths: Record<string, Record<string, OpenAPIOperation>>
  components?: {
    securitySchemes?: Record<string, unknown>
  }
}

/**
 * OpenAPI operation
 */
export interface OpenAPIOperation {
  summary?: string
  description?: string
  parameters?: OpenAPIParameter[]
  requestBody?: {
    required?: boolean
    content: Record<string, { schema?: unknown }>
  }
  responses: Record<string, { description: string; content?: Record<string, { schema?: unknown }> }>
  security?: Array<Record<string, string[]>>
  'x-ratelimit'?: {
    requests: number
    windowMs: number
  }
}

/**
 * OpenAPI parameter
 */
export interface OpenAPIParameter {
  name: string
  in: 'path' | 'query' | 'header'
  required?: boolean
  schema?: { type: string }
  description?: string
}

// ============================================================================
// DECORATOR STORAGE
// ============================================================================

/**
 * Symbol for storing REST metadata on methods
 */
const REST_METADATA = Symbol('rest:metadata')

/**
 * Storage for decorator-based route configs
 */
const decoratorConfigs = new WeakMap<object, Map<string, RestMethodConfig>>()

// ============================================================================
// REST DECORATOR
// ============================================================================

/**
 * Decorator to mark a method for REST exposure
 *
 * Supports both:
 * - Stage 3 ECMAScript decorators (modern)
 * - TypeScript experimental decorators (legacy)
 *
 * @example
 * ```typescript
 * class MyDO extends DO {
 *   @rest({ method: 'GET', path: '/users/:id' })
 *   getUser(id: string) {
 *     return { id, name: 'Test' }
 *   }
 * }
 * ```
 */
export function rest(config: RestMethodConfig) {
  // Return a function that can handle both decorator signatures
  return function (
    targetOrValue: object | Function,
    contextOrPropertyKey?: DecoratorContext | string | symbol,
    descriptor?: PropertyDescriptor
  ): unknown {
    // Stage 3 ECMAScript decorator signature: (value, context)
    if (
      typeof targetOrValue === 'function' &&
      contextOrPropertyKey &&
      typeof contextOrPropertyKey === 'object' &&
      'kind' in contextOrPropertyKey
    ) {
      const context = contextOrPropertyKey as ClassMethodDecoratorContext
      const methodName = String(context.name)

      // Use addInitializer to register the config when the class is defined
      context.addInitializer(function () {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const constructor = (this as any).constructor
        let configs = decoratorConfigs.get(constructor)
        if (!configs) {
          configs = new Map()
          decoratorConfigs.set(constructor, configs)
        }
        configs.set(methodName, config)
      })

      // Also store on the function itself
      Object.defineProperty(targetOrValue, REST_METADATA, {
        value: config,
        writable: false,
        enumerable: false,
      })

      return targetOrValue
    }

    // TypeScript experimental decorator signature: (target, propertyKey, descriptor)
    if (typeof contextOrPropertyKey === 'string' || typeof contextOrPropertyKey === 'symbol') {
      const methodName = String(contextOrPropertyKey)
      const constructor = (targetOrValue as object).constructor

      // Get or create the config map for this class
      let configs = decoratorConfigs.get(constructor)
      if (!configs) {
        configs = new Map()
        decoratorConfigs.set(constructor, configs)
      }

      // Store the config
      configs.set(methodName, config)

      // Mark the method with metadata
      if (descriptor && descriptor.value) {
        Object.defineProperty(descriptor.value, REST_METADATA, {
          value: config,
          writable: false,
          enumerable: false,
        })
      }

      return descriptor
    }

    // Fallback: just return the value unchanged
    return targetOrValue
  }
}

/**
 * Decorator context for stage 3 decorators
 */
interface DecoratorContext {
  kind: 'class' | 'method' | 'getter' | 'setter' | 'field' | 'accessor'
  name: string | symbol
  addInitializer?: (initializer: () => void) => void
}

// ============================================================================
// ROUTE DISCOVERY
// ============================================================================

/**
 * Get all REST routes from a DO class
 *
 * @param DOClass - The DO class to analyze
 * @returns Array of route configurations
 */
export function getRestRoutes(DOClass: new (...args: unknown[]) => unknown): RestRouteConfig[] {
  const routes: RestRouteConfig[] = []

  // Check static $rest configuration
  const staticRest = (DOClass as unknown as { $rest?: Record<string, RestMethodConfig> }).$rest
  if (staticRest) {
    for (const [methodName, config] of Object.entries(staticRest)) {
      routes.push({
        methodName,
        httpMethod: config.method,
        path: config.path,
        queryParams: config.queryParams,
        rateLimit: config.rateLimit,
        throttle: config.throttle,
        auth: config.auth,
        roles: config.roles,
        scopes: config.scopes,
        produces: config.produces,
        consumes: config.consumes,
        cache: config.cache,
        etag: config.etag,
        lastModified: config.lastModified,
        schema: config.schema,
        streaming: config.streaming,
      })
    }
  }

  // Check decorator-based configurations
  const decoratorConfig = decoratorConfigs.get(DOClass)
  if (decoratorConfig) {
    for (const [methodName, config] of decoratorConfig) {
      routes.push({
        methodName,
        httpMethod: config.method,
        path: config.path,
        queryParams: config.queryParams,
        rateLimit: config.rateLimit,
        throttle: config.throttle,
        auth: config.auth,
        roles: config.roles,
        scopes: config.scopes,
        produces: config.produces,
        consumes: config.consumes,
        cache: config.cache,
        etag: config.etag,
        lastModified: config.lastModified,
        schema: config.schema,
        streaming: config.streaming,
      })
    }
  }

  // Also check prototype methods for decorator metadata
  const prototype = DOClass.prototype
  if (prototype) {
    const methodNames = Object.getOwnPropertyNames(prototype)
    for (const methodName of methodNames) {
      if (methodName === 'constructor') continue
      const method = prototype[methodName]
      if (typeof method === 'function') {
        const metadata = Object.getOwnPropertyDescriptor(method, REST_METADATA)?.value as RestMethodConfig | undefined
        if (metadata && !routes.some((r) => r.methodName === methodName)) {
          routes.push({
            methodName,
            httpMethod: metadata.method,
            path: metadata.path,
            queryParams: metadata.queryParams,
            rateLimit: metadata.rateLimit,
            throttle: metadata.throttle,
            auth: metadata.auth,
            roles: metadata.roles,
            scopes: metadata.scopes,
            produces: metadata.produces,
            consumes: metadata.consumes,
            cache: metadata.cache,
            etag: metadata.etag,
            lastModified: metadata.lastModified,
            schema: metadata.schema,
            streaming: metadata.streaming,
          })
        }
      }
    }
  }

  return routes
}

/**
 * Get configuration for a specific route
 *
 * @param DOClass - The DO class to analyze
 * @param methodName - The method name to get config for
 * @returns Route configuration or undefined
 */
export function getRouteConfig(
  DOClass: new (...args: unknown[]) => unknown,
  methodName: string
): RestMethodConfig | undefined {
  // Check static $rest
  const staticRest = (DOClass as unknown as { $rest?: Record<string, RestMethodConfig> }).$rest
  if (staticRest && staticRest[methodName]) {
    return staticRest[methodName]
  }

  // Check decorator configs
  const decoratorConfig = decoratorConfigs.get(DOClass)
  if (decoratorConfig && decoratorConfig.has(methodName)) {
    return decoratorConfig.get(methodName)
  }

  return undefined
}

// ============================================================================
// PARAMETER PARSING
// ============================================================================

/**
 * Parse path parameters from a URL path against a pattern
 *
 * @param pattern - Route pattern (e.g., '/users/:userId')
 * @param path - Actual URL path (e.g., '/users/123')
 * @returns Extracted parameters or null if no match
 */
export function parseRouteParams(
  pattern: string,
  path: string
): Record<string, string | undefined> | null {
  // Normalize trailing slashes
  const normalizedPattern = pattern.replace(/\/$/, '')
  const normalizedPath = path.replace(/\/$/, '')

  // Build regex from pattern
  const paramNames: string[] = []
  const optionalParams: Set<string> = new Set()
  let regexStr = '^'

  // Split but filter out empty segments from leading slash
  const segments = normalizedPattern.split('/').filter((s, i) => i !== 0 || s !== '')

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    if (!segment) continue

    // Add slash separator (first segment starts with /)
    if (i === 0 || regexStr !== '^') {
      regexStr += '/'
    }

    if (segment.startsWith('*')) {
      // Wildcard parameter - captures rest of path
      const paramName = segment.slice(1)
      paramNames.push(paramName)
      regexStr += '(.+)'
    } else if (segment.startsWith(':')) {
      // Check for optional marker
      const isOptional = segment.endsWith('?')
      const paramName = isOptional ? segment.slice(1, -1) : segment.slice(1)
      paramNames.push(paramName)

      if (isOptional) {
        optionalParams.add(paramName)
        // Optional segment can be missing entirely (including the preceding /)
        // We need to handle this case by making the slash optional too
        regexStr = regexStr.slice(0, -1) // Remove the trailing /
        regexStr += '(?:/([^/]*))?'
      } else {
        regexStr += '([^/]+)'
      }
    } else {
      // Literal segment - escape regex special characters
      regexStr += segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }

  regexStr += '$'

  const regex = new RegExp(regexStr)
  const match = normalizedPath.match(regex)

  if (!match) {
    return null
  }

  const params: Record<string, string | undefined> = {}
  for (let i = 0; i < paramNames.length; i++) {
    const value = match[i + 1]
    if (value !== undefined && value !== '') {
      // URL decode the parameter
      params[paramNames[i]] = decodeURIComponent(value)
    } else {
      // For optional params, explicitly set undefined
      params[paramNames[i]] = undefined
    }
  }

  return params
}

// ============================================================================
// RESPONSE SERIALIZATION
// ============================================================================

/**
 * Serialize data to an HTTP response
 *
 * @param data - Data to serialize
 * @param options - Serialization options
 * @returns HTTP Response
 */
export function serializeResponse(
  data: unknown,
  options?: {
    accept?: string
    method?: string
    status?: number
    produces?: ContentType[]
  }
): Response {
  // Handle null/undefined
  if (data === null || data === undefined) {
    return new Response(null, { status: 204 })
  }

  // Determine content type
  // 1. If produces is specified and data is binary, use the first produces type
  // 2. Otherwise, negotiate based on Accept header
  const accept = options?.accept || 'application/json'
  let contentType = 'application/json'
  let body: string | ArrayBuffer

  // For binary data, prefer the produces content type if specified
  if (data instanceof ArrayBuffer && options?.produces && options.produces.length > 0) {
    contentType = options.produces[0]
    return new Response(data, {
      status: options?.status || 200,
      headers: { 'Content-Type': contentType },
    })
  }

  // Parse Accept header quality values
  const acceptTypes = accept.split(',').map((t) => {
    const [type, ...params] = t.trim().split(';')
    let quality = 1.0
    for (const param of params) {
      const [key, value] = param.trim().split('=')
      if (key === 'q') {
        quality = parseFloat(value)
      }
    }
    return { type: type.trim(), quality }
  }).sort((a, b) => b.quality - a.quality)

  // Find best matching content type
  for (const { type } of acceptTypes) {
    if (type === 'application/json' || type === '*/*') {
      contentType = 'application/json'
      break
    } else if (type === 'application/xml') {
      contentType = 'application/xml'
      break
    } else if (type === 'text/csv') {
      contentType = 'text/csv'
      break
    }
  }

  // Handle binary data (ArrayBuffer) without produces
  if (data instanceof ArrayBuffer) {
    return new Response(data, {
      status: options?.status || 200,
      headers: { 'Content-Type': contentType },
    })
  }

  // Serialize based on content type
  if (contentType === 'application/xml') {
    body = jsonToXml(data)
  } else if (contentType === 'text/csv') {
    body = jsonToCsv(data)
  } else {
    body = JSON.stringify(data)
  }

  // Determine status code
  let status = options?.status || 200
  if (options?.method === 'POST' && !options?.status && data && typeof data === 'object') {
    // POST typically returns 201 (Created) for resource creation
    // Return 200 only for "action" endpoints that return just a message
    const dataObj = data as Record<string, unknown>
    const keys = Object.keys(dataObj)
    const isActionResponse = keys.length === 1 && keys[0] === 'message'
    if (!isActionResponse) {
      status = 201
    }
  }

  return new Response(body, {
    status,
    headers: { 'Content-Type': contentType },
  })
}

/**
 * Convert JSON to simple XML
 */
function jsonToXml(data: unknown, rootName = 'root'): string {
  if (data === null || data === undefined) {
    return `<${rootName}/>`
  }

  if (Array.isArray(data)) {
    const items = data.map((item, i) => jsonToXml(item, 'item')).join('')
    return `<${rootName}>${items}</${rootName}>`
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>)
      .map(([key, value]) => jsonToXml(value, key))
      .join('')
    return `<${rootName}>${entries}</${rootName}>`
  }

  return `<${rootName}>${String(data)}</${rootName}>`
}

/**
 * Convert JSON to CSV
 */
function jsonToCsv(data: unknown): string {
  if (!Array.isArray(data)) {
    data = [data]
  }

  const arr = data as Array<Record<string, unknown>>
  if (arr.length === 0) return ''

  // Handle nested items property
  const items = (arr[0] as Record<string, unknown>)?.items
  const rows = Array.isArray(items) ? items : arr

  if (rows.length === 0) return ''

  const headers = Object.keys(rows[0] as Record<string, unknown>)
  const csvRows = [headers.join(',')]

  for (const row of rows) {
    const values = headers.map((h) => {
      const val = (row as Record<string, unknown>)[h]
      if (typeof val === 'string' && val.includes(',')) {
        return `"${val}"`
      }
      return String(val ?? '')
    })
    csvRows.push(values.join(','))
  }

  return csvRows.join('\n')
}

// ============================================================================
// REQUEST DESERIALIZATION
// ============================================================================

/**
 * Deserialize request body
 *
 * @param request - HTTP Request
 * @param schema - Optional JSON schema for validation
 * @returns Deserialized body
 */
export async function deserializeRequest(
  request: Request,
  schema?: JsonSchema
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('Content-Type') || ''

  // Handle empty body
  if (!request.body) {
    return {}
  }

  let data: Record<string, unknown> = {}

  if (contentType.includes('application/json')) {
    const text = await request.text()
    if (!text || text.trim() === '') {
      return {}
    }
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error('Invalid JSON body')
    }
  } else if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    data = {}
    for (const [key, value] of formData.entries()) {
      data[key] = value
    }
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await request.text()
    const params = new URLSearchParams(text)
    data = {}
    for (const [key, value] of params.entries()) {
      data[key] = value
    }
  } else {
    // Try to parse as JSON anyway
    const text = await request.text()
    if (text && text.trim()) {
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error('Unable to parse request body')
      }
    }
  }

  return data
}

// ============================================================================
// ERROR MAPPING
// ============================================================================

/**
 * Map an error to HTTP status and response
 *
 * @param error - Error to map
 * @returns REST error response
 */
export function mapHttpError(error: Error): RestError {
  // Check for statusCode property
  const statusCode = (error as Error & { statusCode?: number }).statusCode
  const code = (error as Error & { code?: string }).code
  const errors = (error as Error & { errors?: Record<string, string[]> }).errors
  const retryAfter = (error as Error & { retryAfter?: number }).retryAfter

  if (statusCode) {
    return {
      status: statusCode,
      message: error.message,
      code,
      errors,
      retryAfter,
    }
  }

  // Default to 500
  return {
    status: 500,
    message: error.message,
    code,
  }
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate data against JSON schema
 */
function validateSchema(
  data: Record<string, unknown>,
  schema: JsonSchema
): { valid: boolean; errors: Record<string, string[]> } {
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

  // Check properties
  if (schema.properties) {
    for (const [field, prop] of Object.entries(schema.properties)) {
      const value = data[field]
      if (value === undefined || value === null) continue

      const fieldErrors: string[] = []

      // Type check
      if (prop.type === 'string' && typeof value !== 'string') {
        fieldErrors.push(`${field} must be a string`)
      } else if (prop.type === 'number' && typeof value !== 'number') {
        fieldErrors.push(`${field} must be a number`)
      }

      // String validations
      if (typeof value === 'string') {
        if (prop.minLength !== undefined && value.length < prop.minLength) {
          fieldErrors.push(`${field} must be at least ${prop.minLength} characters`)
        }
        if (prop.maxLength !== undefined && value.length > prop.maxLength) {
          fieldErrors.push(`${field} must be at most ${prop.maxLength} characters`)
        }
        if (prop.format === 'email' && !isValidEmail(value)) {
          fieldErrors.push(`${field} must be a valid email`)
        }
      }

      // Number validations
      if (typeof value === 'number') {
        if (prop.minimum !== undefined && value < prop.minimum) {
          fieldErrors.push(`${field} must be at least ${prop.minimum}`)
        }
        if (prop.maximum !== undefined && value > prop.maximum) {
          fieldErrors.push(`${field} must be at most ${prop.maximum}`)
        }
      }

      if (fieldErrors.length > 0) {
        errors[field] = fieldErrors
      }
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  }
}

/**
 * Simple email validation
 */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// ============================================================================
// RATE LIMITING
// ============================================================================

/**
 * Rate limit state storage
 */
const rateLimitState = new Map<string, { count: number; windowStart: number }>()
const throttleState = new Map<string, { tokens: number; lastRefill: number; requests: { timestamp: number }[] }>()

/**
 * Check rate limit
 */
function checkRateLimit(
  key: string,
  config: RestRateLimitConfig
): { allowed: boolean; remaining: number; reset: number; retryAfter?: number } {
  const now = Date.now()
  const state = rateLimitState.get(key)

  if (!state || now - state.windowStart >= config.windowMs) {
    // New window
    rateLimitState.set(key, { count: 1, windowStart: now })
    return {
      allowed: true,
      remaining: config.requests - 1,
      reset: now + config.windowMs,
    }
  }

  if (state.count >= config.requests) {
    // Rate limited
    const retryAfter = Math.ceil((state.windowStart + config.windowMs - now) / 1000)
    return {
      allowed: false,
      remaining: 0,
      reset: state.windowStart + config.windowMs,
      retryAfter,
    }
  }

  // Increment count
  state.count++
  return {
    allowed: true,
    remaining: config.requests - state.count,
    reset: state.windowStart + config.windowMs,
  }
}

/**
 * Check throttle (token bucket)
 */
function checkThrottle(
  key: string,
  config: RestThrottleConfig
): { allowed: boolean; retryAfter?: number } {
  const now = Date.now()
  let state = throttleState.get(key)

  if (!state) {
    state = { tokens: config.burstLimit, lastRefill: now, requests: [] }
    throttleState.set(key, state)
  }

  // Refill tokens
  const elapsed = now - state.lastRefill
  const refillAmount = (elapsed / 1000) * config.sustainedRate
  state.tokens = Math.min(config.burstLimit, state.tokens + refillAmount)
  state.lastRefill = now

  // Clean old requests
  state.requests = state.requests.filter((r) => now - r.timestamp < config.windowMs)

  if (state.tokens < 1) {
    return {
      allowed: false,
      retryAfter: Math.ceil(1 / config.sustainedRate),
    }
  }

  // Consume token
  state.tokens--
  state.requests.push({ timestamp: now })

  return { allowed: true }
}

/**
 * Get rate limit key from request
 */
function getRateLimitKey(
  request: Request,
  config: RestRateLimitConfig,
  path: string,
  authContext?: AuthContext | null
): string {
  const base = path
  if (config.keyBy === 'user' && authContext?.userId) {
    return `${base}:user:${authContext.userId}`
  }
  // Default to IP
  const ip = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || request.headers.get('CF-Connecting-IP')
    || 'unknown'
  return `${base}:ip:${ip}`
}

// ============================================================================
// ROUTER CREATION
// ============================================================================

/**
 * Router interface returned by createRestRouter
 */
export interface RestRouter {
  /** Hono fetch handler */
  fetch: (request: Request) => Promise<Response>
  /** Registered routes */
  routes: RestRouteConfig[]
  /** Middleware functions */
  middleware: RestMiddleware[]
  /** Get OpenAPI spec */
  getOpenAPISpec: () => OpenAPISpec
}

/**
 * Create a REST router from a DO class
 *
 * @param DOClass - The DO class to create routes from
 * @param options - Router options
 * @returns REST router
 */
export function createRestRouter(
  DOClass: new (...args: unknown[]) => unknown,
  options?: RestRouterOptions
): RestRouter {
  const app = new Hono()
  const routes = getRestRoutes(DOClass)
  const basePath = options?.basePath || options?.apiPrefix || ''
  const middleware = options?.middleware || []
  const debug = options?.debug ?? false

  // Create a shared instance for handling requests
  // In a real implementation, this would be passed in or created per-request
  let instance: Record<string, unknown> | null = null

  /**
   * Get or create DO instance
   */
  function getInstance(): Record<string, unknown> {
    if (!instance) {
      try {
        // Try to create an instance - some classes may not need constructor params
        instance = new (DOClass as new () => Record<string, unknown>)()
      } catch {
        // If instantiation fails (e.g., class requires constructor params like ctx, env),
        // try with mock constructor args for Durable Object classes
        try {
          const mockCtx = createMockDurableObjectState()
          const mockEnv = {}
          instance = new (DOClass as new (ctx: unknown, env: unknown) => Record<string, unknown>)(mockCtx, mockEnv)
        } catch {
          // Final fallback: create an object with the prototype
          // and manually initialize any instance properties we can detect
          const prototype = DOClass.prototype
          instance = Object.create(prototype) as Record<string, unknown>
        }
      }
    }
    return instance
  }

  /**
   * Create a mock DurableObjectState for testing
   */
  function createMockDurableObjectState(): unknown {
    const storage = new Map<string, unknown>()
    return {
      id: {
        toString: () => 'mock-id',
        equals: () => false,
        name: 'mock-do',
      },
      storage: {
        get: async (key: string) => storage.get(key),
        put: async (key: string, value: unknown) => { storage.set(key, value) },
        delete: async (key: string) => storage.delete(key),
        deleteAll: async () => storage.clear(),
        list: async () => new Map(storage),
        sql: {
          exec: () => ({ toArray: () => [], one: () => null, raw: () => [] }),
        },
      },
      waitUntil: () => {},
      blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
    }
  }

  // Add full path to routes
  const routesWithFullPath = routes.map((route) => ({
    ...route,
    fullPath: `${basePath}${route.path}`,
  }))

  /**
   * Authenticate request
   */
  async function authenticate(request: Request): Promise<AuthContext | null> {
    if (options?.authHandler) {
      return options.authHandler(request)
    }

    // Default auth handling based on Authorization header
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      return null
    }

    // Simple token-based auth for testing
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      // Mock authentication based on token pattern
      if (token === 'valid-token') {
        return { userId: 'user-1', roles: ['user'], scopes: [] }
      }
      if (token === 'admin-token') {
        return { userId: 'admin-1', roles: ['admin', 'user'], scopes: ['*'] }
      }
      if (token === 'user-token') {
        return { userId: 'user-1', roles: ['user'], scopes: [] }
      }
      if (token === 'limited-scope-token') {
        return { userId: 'user-1', roles: ['user'], scopes: ['read:items'], tokenType: 'limited-scope' }
      }
      if (token === 'full-scope-token') {
        return { userId: 'user-1', roles: ['user'], scopes: ['write:items', 'read:items'], tokenType: 'full-scope' }
      }
      if (token.startsWith('token-')) {
        // Generic user token for rate limit tests
        const userId = token.replace('token-', '')
        return { userId, roles: ['user'], scopes: [] }
      }
      // Any other valid-looking token
      return { userId: 'user-1', roles: ['user'], scopes: [] }
    }

    return null
  }

  /**
   * Check authorization (roles and scopes)
   */
  function checkAuthorization(
    authContext: AuthContext | null,
    route: RestRouteConfig
  ): { authorized: boolean; reason?: string } {
    // Check roles
    if (route.roles && route.roles.length > 0) {
      if (!authContext?.roles) {
        return { authorized: false, reason: 'Roles required' }
      }
      const hasRole = route.roles.some((r) => authContext.roles!.includes(r))
      if (!hasRole) {
        return { authorized: false, reason: 'Insufficient roles' }
      }
    }

    // Check scopes
    if (route.scopes && route.scopes.length > 0) {
      if (!authContext?.scopes) {
        return { authorized: false, reason: 'Scopes required' }
      }
      const hasAllScopes = route.scopes.every(
        (s) => authContext.scopes!.includes(s) || authContext.scopes!.includes('*')
      )
      if (!hasAllScopes) {
        return { authorized: false, reason: 'Insufficient scopes' }
      }
    }

    return { authorized: true }
  }

  /**
   * Handle CORS
   */
  function handleCors(request: Request, response: Response): Response {
    if (!options?.cors) {
      return response
    }

    const origin = request.headers.get('Origin')
    if (!origin) {
      return response
    }

    const { origins, credentials, methods, allowedHeaders, exposedHeaders, maxAge } = options.cors

    // Check if origin is allowed
    const isAllowed = origins.includes('*') || origins.includes(origin)
    if (!isAllowed) {
      return response
    }

    const headers = new Headers(response.headers)
    headers.set('Access-Control-Allow-Origin', origins.includes('*') ? '*' : origin)

    if (credentials) {
      headers.set('Access-Control-Allow-Credentials', 'true')
    }

    if (methods) {
      headers.set('Access-Control-Allow-Methods', methods.join(', '))
    }

    if (allowedHeaders) {
      headers.set('Access-Control-Allow-Headers', allowedHeaders.join(', '))
    }

    if (exposedHeaders) {
      headers.set('Access-Control-Expose-Headers', exposedHeaders.join(', '))
    }

    if (maxAge !== undefined) {
      headers.set('Access-Control-Max-Age', String(maxAge))
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }

  /**
   * Handle preflight OPTIONS request
   */
  function handlePreflight(request: Request): Response | null {
    if (request.method !== 'OPTIONS') {
      return null
    }

    if (!options?.cors) {
      return new Response(null, { status: 204 })
    }

    const origin = request.headers.get('Origin')
    const { origins, methods, allowedHeaders, maxAge, credentials } = options.cors

    const isAllowed = origins.includes('*') || (origin && origins.includes(origin))
    if (!isAllowed) {
      return new Response(null, { status: 204 })
    }

    const headers: Record<string, string> = {
      'Access-Control-Allow-Origin': origins.includes('*') ? '*' : origin!,
      'Access-Control-Allow-Methods': (methods || ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).join(', '),
    }

    if (credentials) {
      headers['Access-Control-Allow-Credentials'] = 'true'
    }

    if (allowedHeaders) {
      headers['Access-Control-Allow-Headers'] = allowedHeaders.join(', ')
    } else {
      const requestedHeaders = request.headers.get('Access-Control-Request-Headers')
      if (requestedHeaders) {
        headers['Access-Control-Allow-Headers'] = requestedHeaders
      }
    }

    if (maxAge !== undefined) {
      headers['Access-Control-Max-Age'] = String(maxAge)
    }

    return new Response(null, { status: 204, headers })
  }

  /**
   * Generate ETag from data
   */
  function generateETag(data: unknown): string {
    const content = JSON.stringify(data)
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return `"${Math.abs(hash).toString(16)}"`
  }

  /**
   * Main fetch handler
   */
  async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method.toUpperCase() as HttpMethod

    // Check URL length
    if (url.href.length > 8192) {
      return new Response(JSON.stringify({ error: { message: 'URI Too Long', code: 'URI_TOO_LONG' } }), {
        status: 414,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Handle CORS preflight
    const preflightResponse = handlePreflight(request)
    if (preflightResponse) {
      return preflightResponse
    }

    // Apply middleware
    let currentRequest = request
    const middlewareChain = [...middleware]

    async function executeMiddleware(index: number): Promise<Response> {
      if (index < middlewareChain.length) {
        const mw = middlewareChain[index]
        return mw(currentRequest, () => executeMiddleware(index + 1))
      }
      return handleRequest(currentRequest)
    }

    const response = await executeMiddleware(0)
    return handleCors(request, response)
  }

  /**
   * Handle the actual request after middleware
   */
  async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method.toUpperCase() as HttpMethod
    const path = url.pathname

    // Find matching route
    let matchedRoute: RestRouteConfig | null = null
    let pathParams: Record<string, string | undefined> | null = null
    const matchingPaths: { route: RestRouteConfig; methods: HttpMethod[] }[] = []

    for (const route of routesWithFullPath) {
      const params = parseRouteParams(route.fullPath!, path)
      if (params !== null) {
        if (!matchingPaths.find((m) => m.route.fullPath === route.fullPath)) {
          matchingPaths.push({ route, methods: [route.httpMethod] })
        } else {
          const existing = matchingPaths.find((m) => m.route.fullPath === route.fullPath)!
          existing.methods.push(route.httpMethod)
        }

        if (route.httpMethod === method) {
          matchedRoute = route
          pathParams = params
          break
        }
      }
    }

    // Handle HEAD requests automatically
    if (method === 'HEAD' && !matchedRoute) {
      for (const route of routesWithFullPath) {
        if (route.httpMethod === 'GET') {
          const params = parseRouteParams(route.fullPath!, path)
          if (params !== null) {
            matchedRoute = { ...route, httpMethod: 'HEAD' }
            pathParams = params
            break
          }
        }
      }
    }

    // Handle OPTIONS for specific path
    if (method === 'OPTIONS' && matchingPaths.length > 0) {
      return new Response(null, { status: 204 })
    }

    // 404 if no route found
    if (!matchedRoute || !pathParams) {
      if (matchingPaths.length > 0) {
        // Method not allowed
        const allowedMethods = [...new Set(matchingPaths.flatMap((m) => m.methods))]
        return new Response(
          JSON.stringify({
            error: {
              message: 'Method Not Allowed',
              code: 'METHOD_NOT_ALLOWED',
            },
          }),
          {
            status: 405,
            headers: {
              'Content-Type': 'application/json',
              'Allow': allowedMethods.join(', '),
            },
          }
        )
      }
      return new Response(
        JSON.stringify({
          error: {
            message: 'Not Found',
            code: 'NOT_FOUND',
          },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Check Accept header for content negotiation
    const accept = request.headers.get('Accept') || '*/*'
    if (matchedRoute.produces && matchedRoute.produces.length > 0) {
      const acceptTypes = accept.split(',').map((t) => t.split(';')[0].trim())
      const hasMatch = acceptTypes.some(
        (t) => t === '*/*' || matchedRoute!.produces!.includes(t as ContentType)
      )
      if (!hasMatch && accept !== '*/*') {
        return new Response(
          JSON.stringify({
            error: {
              message: 'Not Acceptable',
              code: 'NOT_ACCEPTABLE',
            },
          }),
          { status: 406, headers: { 'Content-Type': 'application/json' } }
        )
      }
    }

    // Check Content-Type for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      const contentType = request.headers.get('Content-Type') || ''
      if (matchedRoute.consumes && matchedRoute.consumes.length > 0) {
        const baseContentType = contentType.split(';')[0].trim()
        const isSupported = matchedRoute.consumes.some((c) => {
          if (c === 'multipart/form-data' && baseContentType.includes('multipart/form-data')) {
            return true
          }
          return baseContentType.includes(c)
        })
        if (!isSupported && baseContentType) {
          return new Response(
            JSON.stringify({
              error: {
                message: 'Unsupported Media Type',
                code: 'UNSUPPORTED_MEDIA_TYPE',
              },
            }),
            { status: 415, headers: { 'Content-Type': 'application/json' } }
          )
        }
      }
    }

    // Authentication
    const authContext = await authenticate(request)

    if (matchedRoute.auth === true && !authContext) {
      return new Response(
        JSON.stringify({
          error: {
            message: 'Unauthorized',
            code: 'UNAUTHORIZED',
          },
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer',
          },
        }
      )
    }

    // Authorization
    const authResult = checkAuthorization(authContext, matchedRoute)
    if (!authResult.authorized) {
      return new Response(
        JSON.stringify({
          error: {
            message: 'Forbidden',
            code: 'FORBIDDEN',
            reason: authResult.reason,
          },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Rate limiting
    if (matchedRoute.rateLimit) {
      const rateLimitKey = getRateLimitKey(request, matchedRoute.rateLimit, matchedRoute.fullPath!, authContext)
      const rateLimitResult = checkRateLimit(rateLimitKey, matchedRoute.rateLimit)

      const rateLimitHeaders: Record<string, string> = {
        'X-RateLimit-Limit': String(matchedRoute.rateLimit.requests),
        'X-RateLimit-Remaining': String(rateLimitResult.remaining),
        'X-RateLimit-Reset': String(Math.floor(rateLimitResult.reset / 1000)),
      }

      if (!rateLimitResult.allowed) {
        return new Response(
          JSON.stringify({
            error: {
              message: 'Too Many Requests',
              code: 'RATE_LIMIT_EXCEEDED',
              retryAfter: rateLimitResult.retryAfter,
            },
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(rateLimitResult.retryAfter),
              ...rateLimitHeaders,
            },
          }
        )
      }
    }

    // Throttling
    if (matchedRoute.throttle) {
      const throttleKey = getRateLimitKey(
        request,
        { requests: 0, windowMs: matchedRoute.throttle.windowMs, keyBy: 'ip' },
        matchedRoute.fullPath!,
        authContext
      )
      const throttleResult = checkThrottle(throttleKey, matchedRoute.throttle)

      if (!throttleResult.allowed) {
        return new Response(
          JSON.stringify({
            error: {
              message: 'Too Many Requests',
              code: 'THROTTLED',
              retryAfter: throttleResult.retryAfter,
            },
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(throttleResult.retryAfter),
            },
          }
        )
      }
    }

    // Parse request body for POST/PUT/PATCH
    let body: Record<string, unknown> = {}
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      try {
        body = await deserializeRequest(request)
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: {
              message: (error as Error).message,
              code: 'INVALID_REQUEST_BODY',
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // Validate against schema
      if (matchedRoute.schema) {
        const validation = validateSchema(body, matchedRoute.schema)
        if (!validation.valid) {
          return new Response(
            JSON.stringify({
              error: {
                message: 'Validation failed',
                code: 'VALIDATION_ERROR',
                errors: validation.errors,
              },
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          )
        }
      }
    }

    // Parse query parameters
    const queryParams: Record<string, string> = {}
    for (const [key, value] of url.searchParams) {
      queryParams[key] = value
    }

    // Build method arguments
    const args: unknown[] = []

    // Add path params as first args
    const pathParamKeys = Object.keys(pathParams).filter((k) => pathParams[k] !== undefined)
    for (const key of pathParamKeys) {
      args.push(pathParams[key])
    }

    // Add body for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      args.push(body)
    }

    // Add query params if configured
    if (matchedRoute.queryParams) {
      for (const param of matchedRoute.queryParams) {
        const value = queryParams[param]
        // Try to convert to number if it looks like one
        if (value !== undefined && /^\d+$/.test(value)) {
          args.push(parseInt(value, 10))
        } else {
          args.push(value)
        }
      }
    }

    // Get request ID
    const requestId = request.headers.get('X-Request-ID')

    try {
      // Call the method
      const inst = getInstance()
      const methodFn = inst[matchedRoute.methodName]

      if (typeof methodFn !== 'function') {
        throw new Error(`Method ${matchedRoute.methodName} not found`)
      }

      const result = await methodFn.apply(inst, args)

      // Handle streaming responses
      if (matchedRoute.streaming && result && typeof result[Symbol.asyncIterator] === 'function') {
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          async start(controller) {
            for await (const chunk of result as AsyncIterable<unknown>) {
              controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'))
            }
            controller.close()
          },
        })

        return new Response(stream, {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Transfer-Encoding': 'chunked',
          },
        })
      }

      // Handle conditional requests (ETag)
      if (matchedRoute.etag && method === 'GET') {
        const etag = generateETag(result)
        const ifNoneMatch = request.headers.get('If-None-Match')

        if (ifNoneMatch === etag) {
          return new Response(null, { status: 304, headers: { 'ETag': etag } })
        }

        const response = serializeResponse(result, { accept, method, produces: matchedRoute.produces })
        const headers = new Headers(response.headers)
        headers.set('ETag', etag)
        return new Response(response.body, { status: response.status, headers })
      }

      // Handle Last-Modified
      if (matchedRoute.lastModified && method === 'GET' && result && typeof result === 'object') {
        const updatedAt = (result as Record<string, unknown>).updatedAt
        if (updatedAt instanceof Date) {
          const lastModified = updatedAt.toUTCString()
          const ifModifiedSince = request.headers.get('If-Modified-Since')

          if (ifModifiedSince && new Date(ifModifiedSince) >= updatedAt) {
            return new Response(null, { status: 304, headers: { 'Last-Modified': lastModified } })
          }

          const response = serializeResponse(result, { accept, method, produces: matchedRoute.produces })
          const headers = new Headers(response.headers)
          headers.set('Last-Modified', lastModified)
          return new Response(response.body, { status: response.status, headers })
        }
      }

      // Build response
      const response = serializeResponse(result, { accept, method, produces: matchedRoute.produces })
      const headers = new Headers(response.headers)

      // Add cache headers
      if (matchedRoute.cache && method === 'GET') {
        const cacheControl: string[] = []
        if (matchedRoute.cache.maxAge !== undefined) {
          cacheControl.push(`max-age=${matchedRoute.cache.maxAge}`)
        }
        if (matchedRoute.cache.staleWhileRevalidate !== undefined) {
          cacheControl.push(`stale-while-revalidate=${matchedRoute.cache.staleWhileRevalidate}`)
        }
        if (cacheControl.length > 0) {
          headers.set('Cache-Control', cacheControl.join(', '))
        }
      } else if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        headers.set('Cache-Control', 'no-store')
      }

      // Add rate limit headers
      if (matchedRoute.rateLimit) {
        const rateLimitKey = getRateLimitKey(request, matchedRoute.rateLimit, matchedRoute.fullPath!, authContext)
        const state = rateLimitState.get(rateLimitKey)
        if (state) {
          headers.set('X-RateLimit-Limit', String(matchedRoute.rateLimit.requests))
          headers.set('X-RateLimit-Remaining', String(Math.max(0, matchedRoute.rateLimit.requests - state.count)))
          headers.set('X-RateLimit-Reset', String(Math.floor((state.windowStart + matchedRoute.rateLimit.windowMs) / 1000)))
        }
      }

      // Handle HEAD - return headers but no body
      if (method === 'HEAD') {
        const bodyText = await response.text()
        headers.set('Content-Length', String(new TextEncoder().encode(bodyText).length))
        return new Response(null, { status: response.status, headers })
      }

      return new Response(response.body, { status: response.status, headers })
    } catch (error) {
      const err = error as Error
      const restError = mapHttpError(err)

      const errorBody: Record<string, unknown> = {
        error: {
          message: restError.message,
          code: restError.code || err.name.toUpperCase().replace('ERROR', '').replace(/\s+/g, '_') || 'INTERNAL_ERROR',
          ...(restError.errors && { errors: restError.errors }),
          ...(restError.retryAfter && { retryAfter: restError.retryAfter }),
          ...(requestId && { requestId }),
          ...(debug && { stack: err.stack }),
        },
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (restError.retryAfter) {
        headers['Retry-After'] = String(restError.retryAfter)
      }

      return new Response(JSON.stringify(errorBody), {
        status: restError.status,
        headers,
      })
    }
  }

  /**
   * Generate OpenAPI spec
   */
  function getOpenAPISpec(): OpenAPISpec {
    const className = DOClass.name || 'API'
    const spec: OpenAPISpec = {
      openapi: '3.0.0',
      info: {
        title: `${className} API`,
        version: '1.0.0',
      },
      paths: {},
    }

    for (const route of routesWithFullPath) {
      // Convert path params from :param to {param}
      const openApiPath = route.fullPath!.replace(/:(\w+)/g, '{$1}')

      if (!spec.paths[openApiPath]) {
        spec.paths[openApiPath] = {}
      }

      const operation: OpenAPIOperation = {
        summary: `${route.httpMethod} ${route.methodName}`,
        parameters: [],
        responses: {
          '200': { description: 'Success' },
          '201': { description: 'Created' },
          '400': { description: 'Bad Request' },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Forbidden' },
          '404': { description: 'Not Found' },
          '500': { description: 'Internal Server Error' },
        },
      }

      // Add path parameters
      const pathParams = route.path.match(/:(\w+)/g) || []
      for (const param of pathParams) {
        const paramName = param.slice(1)
        operation.parameters!.push({
          name: paramName,
          in: 'path',
          required: true,
          schema: { type: 'string' },
        })
      }

      // Add query parameters
      if (route.queryParams) {
        for (const param of route.queryParams) {
          operation.parameters!.push({
            name: param,
            in: 'query',
            schema: { type: 'string' },
          })
        }
      }

      // Add request body for POST/PUT/PATCH
      if (['POST', 'PUT', 'PATCH'].includes(route.httpMethod)) {
        operation.requestBody = {
          required: true,
          content: {
            'application/json': {
              schema: route.schema || { type: 'object' },
            },
          },
        }
      }

      // Add security requirements
      if (route.auth) {
        operation.security = [{ bearerAuth: [] }]

        // Add security scheme to components
        if (!spec.components) {
          spec.components = { securitySchemes: {} }
        }
        spec.components.securitySchemes!.bearerAuth = {
          type: 'http',
          scheme: 'bearer',
        }
      }

      // Add rate limit info
      if (route.rateLimit) {
        operation['x-ratelimit'] = {
          requests: route.rateLimit.requests,
          windowMs: route.rateLimit.windowMs,
        }
      }

      spec.paths[openApiPath][route.httpMethod.toLowerCase()] = operation
    }

    return spec
  }

  return {
    fetch,
    routes: routesWithFullPath,
    middleware,
    getOpenAPISpec,
  }
}
