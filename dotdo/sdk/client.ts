/**
 * @dotdo/sdk - Programmatic TypeScript SDK
 *
 * A type-safe client for interacting with dotdo DOs from Node.js,
 * tests, CI/CD pipelines, and programmatic use cases.
 *
 * @module @dotdo/sdk
 *
 * @example
 * ```typescript
 * import { DotdoClient } from 'dotdo/sdk'
 *
 * const client = new DotdoClient({
 *   baseUrl: 'https://my-tenant.api.dotdo.dev',
 *   apiKey: process.env.DOTDO_API_KEY
 * })
 *
 * // CRUD operations
 * const customer = await client.things.create({
 *   $type: 'Customer',
 *   name: 'Alice',
 *   email: 'alice@example.com'
 * })
 *
 * // Query by type
 * const customers = await client.things.list({ $type: 'Customer' })
 *
 * // Emit events
 * await client.events.emit({
 *   type: 'Customer.signup',
 *   payload: { customerId: customer.$id }
 * })
 * ```
 */

import type { Thing, Event, Relationship, JsonValue } from '@dotdo/db'

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base error class for SDK errors.
 * Provides HTTP status code and optional response body.
 */
export class DotdoSDKError extends Error {
  readonly status: number
  readonly response?: unknown
  readonly code: string

  constructor(message: string, status: number, code: string, response?: unknown) {
    super(message)
    this.name = 'DotdoSDKError'
    this.status = status
    this.code = code
    this.response = response
    // Maintain proper stack trace for V8 engines
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DotdoSDKError)
    }
  }
}

/**
 * Error thrown when a resource is not found (404).
 */
export class NotFoundError extends DotdoSDKError {
  constructor(message: string, response?: unknown) {
    super(message, 404, 'NOT_FOUND', response)
    this.name = 'NotFoundError'
  }
}

/**
 * Error thrown when request validation fails (400).
 */
export class ValidationError extends DotdoSDKError {
  readonly errors?: Array<{ field: string; message: string }>

  constructor(message: string, errors?: Array<{ field: string; message: string }>, response?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', response)
    this.name = 'ValidationError'
    this.errors = errors
  }
}

/**
 * Error thrown when authentication fails (401).
 */
export class AuthenticationError extends DotdoSDKError {
  constructor(message: string = 'Authentication required', response?: unknown) {
    super(message, 401, 'AUTHENTICATION_ERROR', response)
    this.name = 'AuthenticationError'
  }
}

/**
 * Error thrown when authorization fails (403).
 */
export class AuthorizationError extends DotdoSDKError {
  constructor(message: string = 'Access denied', response?: unknown) {
    super(message, 403, 'AUTHORIZATION_ERROR', response)
    this.name = 'AuthorizationError'
  }
}

/**
 * Error thrown when rate limited (429).
 */
export class RateLimitError extends DotdoSDKError {
  readonly retryAfter?: number

  constructor(message: string = 'Rate limit exceeded', retryAfter?: number, response?: unknown) {
    super(message, 429, 'RATE_LIMIT_ERROR', response)
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
  }
}

/**
 * Error thrown when server errors occur (5xx).
 */
export class ServerError extends DotdoSDKError {
  constructor(message: string = 'Internal server error', status: number = 500, response?: unknown) {
    super(message, status, 'SERVER_ERROR', response)
    this.name = 'ServerError'
  }
}

/**
 * Error thrown when network/connection fails.
 */
export class NetworkError extends DotdoSDKError {
  readonly cause?: Error

  constructor(message: string = 'Network error', cause?: Error) {
    super(message, 0, 'NETWORK_ERROR')
    this.name = 'NetworkError'
    this.cause = cause
  }
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Client configuration options.
 */
export interface DotdoClientOptions {
  /** Base URL of the dotdo API (e.g., 'https://tenant.api.dotdo.dev') */
  baseUrl: string
  /** API key for authentication (Bearer token) */
  apiKey?: string
  /** JWT token for authentication */
  token?: string
  /** Custom headers to include in all requests */
  headers?: Record<string, string>
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Enable automatic retry on transient failures */
  retry?: boolean | RetryOptions
  /** Custom fetch implementation (for testing/Node.js) */
  fetch?: typeof globalThis.fetch
}

/**
 * Retry configuration options.
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number
  /** Initial delay between retries in ms (default: 1000) */
  initialDelay?: number
  /** Maximum delay between retries in ms (default: 10000) */
  maxDelay?: number
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number
  /** HTTP status codes to retry (default: [408, 429, 500, 502, 503, 504]) */
  retryableStatuses?: number[]
}

/**
 * Query options for list operations.
 */
export interface ListOptions {
  /** Filter by type */
  $type?: string
  /** Maximum number of results (default: 100) */
  limit?: number
  /** Cursor for pagination */
  cursor?: string
  /** Order by field */
  orderBy?: string
  /** Order direction */
  order?: 'asc' | 'desc'
  /** Additional filters */
  where?: Record<string, JsonValue>
}

/**
 * Paginated response wrapper.
 */
export interface PaginatedResponse<T> {
  data: T[]
  cursor?: string
  hasMore: boolean
  total?: number
}

/**
 * RPC call options.
 */
export interface RPCOptions {
  /** Request timeout override */
  timeout?: number
}

// ============================================================================
// Resource Interfaces
// ============================================================================

/**
 * Things resource operations.
 */
export interface ThingsResource {
  /** List all things, optionally filtered */
  list(options?: ListOptions): Promise<PaginatedResponse<Thing>>
  /** Get a thing by ID */
  get(id: string): Promise<Thing>
  /** Create a new thing */
  create(data: Omit<Thing, '$id' | '$createdAt' | '$updatedAt'>): Promise<Thing>
  /** Update an existing thing */
  update(id: string, data: Partial<Omit<Thing, '$id' | '$createdAt' | '$updatedAt'>>): Promise<Thing>
  /** Delete a thing */
  delete(id: string): Promise<void>
  /** Bulk create things */
  bulkCreate(items: Array<Omit<Thing, '$id' | '$createdAt' | '$updatedAt'>>): Promise<Thing[]>
  /** Bulk update things */
  bulkUpdate(updates: Array<{ id: string; data: Partial<Omit<Thing, '$id'>> }>): Promise<Thing[]>
  /** Bulk delete things */
  bulkDelete(ids: string[]): Promise<void>
}

/**
 * Events resource operations.
 */
export interface EventsResource {
  /** List events, optionally filtered */
  list(options?: { type?: string; source?: string; limit?: number; cursor?: string }): Promise<PaginatedResponse<Event>>
  /** Get an event by ID */
  get(id: string): Promise<Event>
  /** Emit a new event */
  emit(event: { type: string; payload?: JsonValue; source?: string; correlationId?: string }): Promise<Event>
}

/**
 * Relationships resource operations.
 */
export interface RelationshipsResource {
  /** List all relationships */
  list(options?: ListOptions): Promise<PaginatedResponse<Relationship>>
  /** Find relationships by query */
  find(query: { subject?: string; predicate?: string; object?: string }): Promise<Relationship[]>
  /** Add a new relationship */
  add(relationship: { subject: string; predicate: string; object: string; metadata?: JsonValue }): Promise<Relationship>
  /** Remove a relationship */
  remove(query: { subject: string; predicate: string; object: string }): Promise<void>
}

/**
 * Health check response.
 */
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'unhealthy'
  version?: string
  uptime?: number
  checks?: Record<string, { status: string; message?: string }>
}

// ============================================================================
// Main Client Class
// ============================================================================

/**
 * DotdoClient - Type-safe programmatic SDK for dotdo.
 *
 * Provides a fluent, promise-based API for interacting with dotdo
 * Durable Objects from any JavaScript/TypeScript environment.
 *
 * @example
 * ```typescript
 * const client = new DotdoClient({
 *   baseUrl: 'https://tenant.api.dotdo.dev',
 *   apiKey: 'sk_live_xxx'
 * })
 *
 * // Things CRUD
 * const customer = await client.things.create({
 *   $type: 'Customer',
 *   name: 'Alice'
 * })
 *
 * // Events
 * await client.events.emit({
 *   type: 'Customer.signup',
 *   payload: { id: customer.$id }
 * })
 *
 * // RPC
 * const result = await client.rpc('myMethod', [arg1, arg2])
 * ```
 */
export class DotdoClient {
  private readonly config: Required<Pick<DotdoClientOptions, 'baseUrl' | 'timeout'>> & DotdoClientOptions
  private readonly fetchFn: typeof globalThis.fetch

  constructor(options: DotdoClientOptions) {
    if (!options.baseUrl) {
      throw new Error('baseUrl is required')
    }

    this.config = {
      ...options,
      baseUrl: options.baseUrl.replace(/\/$/, ''), // Remove trailing slash
      timeout: options.timeout ?? 30000,
    }

    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  // --------------------------------------------------------------------------
  // Internal Request Helper
  // --------------------------------------------------------------------------

  /**
   * Make an HTTP request with error handling and retries.
   * @internal
   */
  private async request<T>(
    path: string,
    options: {
      method?: string
      body?: unknown
      query?: Record<string, string | number | boolean | undefined>
      timeout?: number
    } = {}
  ): Promise<T> {
    const { method = 'GET', body, query, timeout = this.config.timeout } = options

    // Build URL with query params
    let url = `${this.config.baseUrl}${path}`
    if (query) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          params.set(key, String(value))
        }
      }
      const queryString = params.toString()
      if (queryString) {
        url += `?${queryString}`
      }
    }

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...this.config.headers,
    }

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`
    } else if (this.config.token) {
      headers['Authorization'] = `Bearer ${this.config.token}`
    }

    // Create abort controller for timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await this.fetchWithRetry(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      // Handle error responses
      if (!response.ok) {
        await this.handleErrorResponse(response)
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as T
      }

      // Parse JSON response
      const data = await response.json()

      // Handle wrapped responses
      if (data && typeof data === 'object' && 'data' in data && !('$id' in data)) {
        return data as T
      }

      return data as T
    } catch (error) {
      clearTimeout(timeoutId)

      if (error instanceof DotdoSDKError) {
        throw error
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new NetworkError(`Request timeout after ${timeout}ms`)
        }
        throw new NetworkError(error.message, error)
      }

      throw new NetworkError('Unknown error occurred')
    }
  }

  /**
   * Fetch with retry logic.
   * @internal
   */
  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    attempt: number = 0
  ): Promise<Response> {
    const retryConfig = this.getRetryConfig()

    try {
      const response = await this.fetchFn(url, init)

      // Check if we should retry
      if (
        retryConfig &&
        attempt < retryConfig.maxAttempts &&
        retryConfig.retryableStatuses.includes(response.status)
      ) {
        const delay = this.calculateRetryDelay(attempt, retryConfig)
        await this.sleep(delay)
        return this.fetchWithRetry(url, init, attempt + 1)
      }

      return response
    } catch (error) {
      // Retry on network errors
      if (
        retryConfig &&
        attempt < retryConfig.maxAttempts &&
        error instanceof Error &&
        error.name !== 'AbortError'
      ) {
        const delay = this.calculateRetryDelay(attempt, retryConfig)
        await this.sleep(delay)
        return this.fetchWithRetry(url, init, attempt + 1)
      }

      throw error
    }
  }

  /**
   * Get retry configuration.
   * @internal
   */
  private getRetryConfig(): Required<RetryOptions> | null {
    if (!this.config.retry) {
      return null
    }

    const defaults: Required<RetryOptions> = {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2,
      retryableStatuses: [408, 429, 500, 502, 503, 504],
    }

    if (this.config.retry === true) {
      return defaults
    }

    return { ...defaults, ...this.config.retry }
  }

  /**
   * Calculate retry delay with exponential backoff.
   * @internal
   */
  private calculateRetryDelay(attempt: number, config: Required<RetryOptions>): number {
    const delay = config.initialDelay * Math.pow(config.backoffMultiplier, attempt)
    return Math.min(delay, config.maxDelay)
  }

  /**
   * Sleep for a given number of milliseconds.
   * @internal
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Handle error responses and throw appropriate errors.
   * @internal
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    let errorBody: unknown

    try {
      errorBody = await response.json()
    } catch {
      errorBody = { error: response.statusText }
    }

    const message = this.extractErrorMessage(errorBody) || response.statusText

    switch (response.status) {
      case 400:
        throw new ValidationError(message, this.extractValidationErrors(errorBody), errorBody)
      case 401:
        throw new AuthenticationError(message, errorBody)
      case 403:
        throw new AuthorizationError(message, errorBody)
      case 404:
        throw new NotFoundError(message, errorBody)
      case 429: {
        const retryAfter = response.headers.get('Retry-After')
        throw new RateLimitError(message, retryAfter ? parseInt(retryAfter, 10) : undefined, errorBody)
      }
      default:
        if (response.status >= 500) {
          throw new ServerError(message, response.status, errorBody)
        }
        throw new DotdoSDKError(message, response.status, 'HTTP_ERROR', errorBody)
    }
  }

  /**
   * Extract error message from response body.
   * @internal
   */
  private extractErrorMessage(body: unknown): string | undefined {
    if (body && typeof body === 'object') {
      const obj = body as Record<string, unknown>
      if (typeof obj['error'] === 'string') return obj['error']
      if (typeof obj['message'] === 'string') return obj['message']
      if (typeof obj['detail'] === 'string') return obj['detail']
    }
    return undefined
  }

  /**
   * Extract validation errors from response body.
   * @internal
   */
  private extractValidationErrors(body: unknown): Array<{ field: string; message: string }> | undefined {
    if (body && typeof body === 'object') {
      const obj = body as Record<string, unknown>
      if (Array.isArray(obj['errors'])) {
        return obj['errors']
          .filter((e): e is { field: string; message: string } =>
            typeof e === 'object' && e !== null && 'field' in e && 'message' in e
          )
      }
    }
    return undefined
  }

  // --------------------------------------------------------------------------
  // Things Resource
  // --------------------------------------------------------------------------

  /**
   * Things resource for CRUD operations on digital objects.
   */
  readonly things: ThingsResource = {
    list: async (options?: ListOptions): Promise<PaginatedResponse<Thing>> => {
      const query: Record<string, string | number | boolean | undefined> = {}
      if (options?.$type) query['$type'] = options.$type
      if (options?.limit) query['limit'] = options.limit
      if (options?.cursor) query['cursor'] = options.cursor
      if (options?.orderBy) query['orderBy'] = options.orderBy
      if (options?.order) query['order'] = options.order

      const result = await this.request<{ data: Thing[]; cursor?: string; hasMore?: boolean; total?: number } | Thing[]>('/things', { query })

      if (Array.isArray(result)) {
        return { data: result, hasMore: false }
      }

      return {
        data: result.data || [],
        cursor: result.cursor,
        hasMore: result.hasMore ?? false,
        total: result.total,
      }
    },

    get: async (id: string): Promise<Thing> => {
      return this.request<Thing>(`/things/${encodeURIComponent(id)}`)
    },

    create: async (data: Omit<Thing, '$id' | '$createdAt' | '$updatedAt'>): Promise<Thing> => {
      return this.request<Thing>('/things', { method: 'POST', body: data })
    },

    update: async (id: string, data: Partial<Omit<Thing, '$id' | '$createdAt' | '$updatedAt'>>): Promise<Thing> => {
      return this.request<Thing>(`/things/${encodeURIComponent(id)}`, { method: 'PUT', body: data })
    },

    delete: async (id: string): Promise<void> => {
      await this.request<void>(`/things/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },

    bulkCreate: async (items: Array<Omit<Thing, '$id' | '$createdAt' | '$updatedAt'>>): Promise<Thing[]> => {
      const result = await this.request<{ data: Thing[] } | Thing[]>('/things/bulk', { method: 'POST', body: { items } })
      return Array.isArray(result) ? result : result.data
    },

    bulkUpdate: async (updates: Array<{ id: string; data: Partial<Omit<Thing, '$id'>> }>): Promise<Thing[]> => {
      const result = await this.request<{ data: Thing[] } | Thing[]>('/things/bulk', { method: 'PUT', body: { updates } })
      return Array.isArray(result) ? result : result.data
    },

    bulkDelete: async (ids: string[]): Promise<void> => {
      await this.request<void>('/things/bulk', { method: 'DELETE', body: { ids } })
    },
  }

  // --------------------------------------------------------------------------
  // Events Resource
  // --------------------------------------------------------------------------

  /**
   * Events resource for emitting and querying events.
   */
  readonly events: EventsResource = {
    list: async (options?: { type?: string; source?: string; limit?: number; cursor?: string }): Promise<PaginatedResponse<Event>> => {
      const query: Record<string, string | number | undefined> = {}
      if (options?.type) query['type'] = options.type
      if (options?.source) query['source'] = options.source
      if (options?.limit) query['limit'] = options.limit
      if (options?.cursor) query['cursor'] = options.cursor

      const result = await this.request<{ data: Event[]; cursor?: string; hasMore?: boolean } | Event[]>('/events', { query })

      if (Array.isArray(result)) {
        return { data: result, hasMore: false }
      }

      return {
        data: result.data || [],
        cursor: result.cursor,
        hasMore: result.hasMore ?? false,
      }
    },

    get: async (id: string): Promise<Event> => {
      return this.request<Event>(`/events/${encodeURIComponent(id)}`)
    },

    emit: async (event: { type: string; payload?: JsonValue; source?: string; correlationId?: string }): Promise<Event> => {
      return this.request<Event>('/events', { method: 'POST', body: event })
    },
  }

  // --------------------------------------------------------------------------
  // Relationships Resource
  // --------------------------------------------------------------------------

  /**
   * Relationships resource for managing entity relationships.
   */
  readonly relationships: RelationshipsResource = {
    list: async (options?: ListOptions): Promise<PaginatedResponse<Relationship>> => {
      const query: Record<string, string | number | undefined> = {}
      if (options?.limit) query['limit'] = options.limit
      if (options?.cursor) query['cursor'] = options.cursor

      const result = await this.request<{ data: Relationship[]; cursor?: string; hasMore?: boolean } | Relationship[]>('/relationships', { query })

      if (Array.isArray(result)) {
        return { data: result, hasMore: false }
      }

      return {
        data: result.data || [],
        cursor: result.cursor,
        hasMore: result.hasMore ?? false,
      }
    },

    find: async (query: { subject?: string; predicate?: string; object?: string }): Promise<Relationship[]> => {
      const params: Record<string, string | undefined> = {}
      if (query.subject) params['subject'] = query.subject
      if (query.predicate) params['predicate'] = query.predicate
      if (query.object) params['object'] = query.object

      const result = await this.request<{ data: Relationship[] } | Relationship[]>('/relationships', { query: params })

      if (Array.isArray(result)) {
        return result
      }

      return result.data || []
    },

    add: async (relationship: { subject: string; predicate: string; object: string; metadata?: JsonValue }): Promise<Relationship> => {
      return this.request<Relationship>('/relationships', { method: 'POST', body: relationship })
    },

    remove: async (query: { subject: string; predicate: string; object: string }): Promise<void> => {
      await this.request<void>('/relationships', { method: 'DELETE', body: query })
    },
  }

  // --------------------------------------------------------------------------
  // RPC
  // --------------------------------------------------------------------------

  /**
   * Make an RPC call to the DO.
   *
   * @param method - The RPC method name (e.g., 'myMethod' or 'things.list')
   * @param args - Arguments to pass to the method
   * @param options - Optional request options
   * @returns The result of the RPC call
   *
   * @example
   * ```typescript
   * const result = await client.rpc('calculateTotal', [items])
   * ```
   */
  async rpc<T = unknown>(method: string, args: unknown[] = [], options?: RPCOptions): Promise<T> {
    return this.request<T>('/rpc', {
      method: 'POST',
      body: { method, args },
      timeout: options?.timeout,
    })
  }

  // --------------------------------------------------------------------------
  // Health & Discovery
  // --------------------------------------------------------------------------

  /**
   * Check the health of the DO.
   */
  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health')
  }

  /**
   * Get the API root with HATEOAS links.
   */
  async root(): Promise<{
    name: string
    version?: string
    _links: Record<string, { href: string; method?: string }>
  }> {
    return this.request('/')
  }

  /**
   * Get the OpenAPI specification.
   */
  async openapi(): Promise<unknown> {
    return this.request('/openapi.json')
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new DotdoClient instance.
 *
 * @param options - Client configuration
 * @returns DotdoClient instance
 *
 * @example
 * ```typescript
 * const client = createDotdoClient({
 *   baseUrl: 'https://tenant.api.dotdo.dev',
 *   apiKey: process.env.DOTDO_API_KEY,
 *   retry: true
 * })
 * ```
 */
export function createDotdoClient(options: DotdoClientOptions): DotdoClient {
  return new DotdoClient(options)
}

/**
 * Create a client from environment variables.
 *
 * Reads from:
 * - DOTDO_BASE_URL or DOTDO_API_URL
 * - DOTDO_API_KEY
 *
 * @returns DotdoClient instance
 * @throws Error if required environment variables are missing
 *
 * @example
 * ```typescript
 * // Set DOTDO_BASE_URL and DOTDO_API_KEY in your environment
 * const client = createDotdoClientFromEnv()
 * ```
 */
export function createDotdoClientFromEnv(): DotdoClient {
  const baseUrl = process.env['DOTDO_BASE_URL'] || process.env['DOTDO_API_URL']
  const apiKey = process.env['DOTDO_API_KEY']

  if (!baseUrl) {
    throw new Error('DOTDO_BASE_URL or DOTDO_API_URL environment variable is required')
  }

  return new DotdoClient({
    baseUrl,
    apiKey,
    retry: true,
  })
}
