/**
 * @dotdo/compat/core/http-client - Shared HTTP Client Infrastructure
 *
 * Common HTTP client patterns extracted from 40+ compat/ providers.
 * Provides unified request handling, authentication, retries, and error normalization.
 *
 * @example
 * ```typescript
 * import { createHttpClient, HttpClient } from 'compat/core/http-client'
 *
 * const client = createHttpClient({
 *   baseUrl: 'https://api.service.com/v1',
 *   auth: { type: 'bearer', token: 'xxx' },
 *   timeout: 30000,
 *   retries: 3,
 * })
 *
 * // Make requests
 * const data = await client.get('/users')
 * await client.post('/users', { name: 'Alice' })
 * await client.put('/users/123', { name: 'Bob' })
 * await client.delete('/users/123')
 * ```
 *
 * @see compat/core/errors.ts for error types
 * @see compat/core/retry.ts for retry configuration
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Authentication configuration types
 */
export type AuthType =
  | 'none'
  | 'api_key'
  | 'bearer'
  | 'basic'
  | 'oauth2'
  | 'aws_signature'
  | 'custom'

/**
 * Authentication configuration
 */
export interface AuthConfig {
  type: AuthType
  /** API key value */
  apiKey?: string
  /** Header name for API key (default: Authorization) */
  apiKeyHeader?: string
  /** Bearer token */
  token?: string
  /** Basic auth username */
  username?: string
  /** Basic auth password */
  password?: string
  /** OAuth2 access token */
  accessToken?: string
  /** Custom header to add */
  customHeaders?: Record<string, string>
}

/**
 * HTTP client configuration
 */
export interface HttpClientConfig {
  /** Base URL for all requests */
  baseUrl: string
  /** Authentication configuration */
  auth?: AuthConfig
  /** Default timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Number of retries on failure (default: 0) */
  retries?: number
  /** Delay between retries in ms (default: 1000) */
  retryDelay?: number
  /** Maximum retry delay with exponential backoff (default: 30000) */
  maxRetryDelay?: number
  /** Custom headers to add to all requests */
  headers?: Record<string, string>
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Enable debug logging */
  debug?: boolean
  /** Rate limit configuration */
  rateLimit?: RateLimitConfig
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum requests per window */
  maxRequests: number
  /** Window duration in milliseconds */
  windowMs: number
  /** Whether to queue requests when limited */
  queue?: boolean
}

/**
 * Request options for individual requests
 */
export interface RequestOptions {
  /** HTTP method */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
  /** Request headers */
  headers?: Record<string, string>
  /** Query parameters */
  params?: Record<string, string | number | boolean | undefined>
  /** Request body (will be JSON-stringified if object) */
  body?: unknown
  /** Request timeout (overrides client default) */
  timeout?: number
  /** Signal for cancellation */
  signal?: AbortSignal
  /** Skip authentication for this request */
  skipAuth?: boolean
  /** Number of retries (overrides client default) */
  retries?: number
  /** Response type */
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer'
}

/**
 * Response wrapper with metadata
 */
export interface HttpResponse<T = unknown> {
  /** Response data */
  data: T
  /** HTTP status code */
  status: number
  /** Status text */
  statusText: string
  /** Response headers */
  headers: Headers
  /** Request URL */
  url: string
  /** Request duration in milliseconds */
  duration: number
}

/**
 * HTTP client interface
 */
export interface HttpClient {
  /** Configuration */
  readonly config: HttpClientConfig

  /** Make a generic request */
  request<T = unknown>(path: string, options?: RequestOptions): Promise<HttpResponse<T>>

  /** GET request */
  get<T = unknown>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>

  /** POST request */
  post<T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>

  /** PUT request */
  put<T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>

  /** PATCH request */
  patch<T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>

  /** DELETE request */
  delete<T = unknown>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>

  /** Set authentication dynamically */
  setAuth(auth: AuthConfig): void

  /** Get current auth config */
  getAuth(): AuthConfig | undefined
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * HTTP error with rich metadata
 */
export class HttpError extends Error {
  readonly status: number
  readonly statusText: string
  readonly url: string
  readonly method: string
  readonly code: string
  readonly retryable: boolean
  readonly response?: unknown
  readonly requestId?: string

  constructor(options: {
    message: string
    status: number
    statusText: string
    url: string
    method: string
    code?: string
    retryable?: boolean
    response?: unknown
    requestId?: string
  }) {
    super(options.message)
    this.name = 'HttpError'
    this.status = options.status
    this.statusText = options.statusText
    this.url = options.url
    this.method = options.method
    this.code = options.code || `HTTP_${options.status}`
    this.retryable = options.retryable ?? isRetryableStatus(options.status)
    this.response = options.response
    this.requestId = options.requestId

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HttpError)
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      statusText: this.statusText,
      url: this.url,
      method: this.method,
      code: this.code,
      retryable: this.retryable,
      requestId: this.requestId,
    }
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends Error {
  readonly timeout: number
  readonly url: string

  constructor(timeout: number, url: string) {
    super(`Request to ${url} timed out after ${timeout}ms`)
    this.name = 'TimeoutError'
    this.timeout = timeout
    this.url = url
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends HttpError {
  readonly retryAfter?: number

  constructor(
    url: string,
    method: string,
    retryAfter?: number,
    response?: unknown
  ) {
    super({
      message: `Rate limited${retryAfter ? `, retry after ${retryAfter}s` : ''}`,
      status: 429,
      statusText: 'Too Many Requests',
      url,
      method,
      code: 'RATE_LIMITED',
      retryable: true,
      response,
    })
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
  }
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create an HTTP client instance
 */
export function createHttpClient(config: HttpClientConfig): HttpClient {
  const fetchFn = config.fetch || globalThis.fetch
  let authConfig = config.auth

  // Rate limiting state
  const rateLimitState = config.rateLimit
    ? { count: 0, windowStart: Date.now() }
    : null

  /**
   * Build auth headers based on config
   */
  function buildAuthHeaders(auth: AuthConfig | undefined): Record<string, string> {
    if (!auth || auth.type === 'none') {
      return {}
    }

    const headers: Record<string, string> = {}

    switch (auth.type) {
      case 'api_key':
        if (auth.apiKey) {
          const headerName = auth.apiKeyHeader || 'Authorization'
          headers[headerName] = auth.apiKey
        }
        break

      case 'bearer':
        if (auth.token) {
          headers['Authorization'] = `Bearer ${auth.token}`
        } else if (auth.accessToken) {
          headers['Authorization'] = `Bearer ${auth.accessToken}`
        }
        break

      case 'basic':
        if (auth.username !== undefined && auth.password !== undefined) {
          const encoded = btoa(`${auth.username}:${auth.password}`)
          headers['Authorization'] = `Basic ${encoded}`
        }
        break

      case 'oauth2':
        if (auth.accessToken) {
          headers['Authorization'] = `Bearer ${auth.accessToken}`
        }
        break

      case 'custom':
        if (auth.customHeaders) {
          Object.assign(headers, auth.customHeaders)
        }
        break
    }

    return headers
  }

  /**
   * Build full URL with base and query params
   */
  function buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    // Handle absolute URLs
    if (path.startsWith('http://') || path.startsWith('https://')) {
      const url = new URL(path)
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined) {
            url.searchParams.set(key, String(value))
          }
        }
      }
      return url.toString()
    }

    // Build from base URL
    const base = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl
    const pathPart = path.startsWith('/') ? path : `/${path}`
    const url = new URL(`${base}${pathPart}`)

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    return url.toString()
  }

  /**
   * Check rate limit and wait if needed
   */
  async function checkRateLimit(): Promise<void> {
    if (!rateLimitState || !config.rateLimit) {
      return
    }

    const now = Date.now()
    const windowEnd = rateLimitState.windowStart + config.rateLimit.windowMs

    // Reset window if expired
    if (now > windowEnd) {
      rateLimitState.count = 0
      rateLimitState.windowStart = now
    }

    // Check if we're at the limit
    if (rateLimitState.count >= config.rateLimit.maxRequests) {
      if (config.rateLimit.queue) {
        // Wait for next window
        const waitTime = windowEnd - now
        if (waitTime > 0) {
          await sleep(waitTime)
          rateLimitState.count = 0
          rateLimitState.windowStart = Date.now()
        }
      } else {
        throw new RateLimitError(config.baseUrl, 'RATE_LIMIT', Math.ceil((windowEnd - now) / 1000))
      }
    }

    rateLimitState.count++
  }

  /**
   * Execute request with retries
   */
  async function executeWithRetries<T>(
    url: string,
    init: RequestInit,
    options: RequestOptions,
    remainingRetries: number
  ): Promise<HttpResponse<T>> {
    const startTime = Date.now()
    const timeout = options.timeout ?? config.timeout ?? 30000

    try {
      // Check rate limit
      await checkRateLimit()

      // Create timeout controller
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      // Combine signals if provided
      const signal = options.signal
        ? combineSignals([options.signal, controller.signal])
        : controller.signal

      try {
        const response = await fetchFn(url, { ...init, signal })
        clearTimeout(timeoutId)

        const duration = Date.now() - startTime

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After')
          const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : undefined
          throw new RateLimitError(url, init.method || 'GET', retryAfterSeconds)
        }

        // Parse response based on content type or options
        let data: T
        const contentType = response.headers.get('content-type') || ''

        if (options.responseType === 'text') {
          data = (await response.text()) as T
        } else if (options.responseType === 'blob') {
          data = (await response.blob()) as T
        } else if (options.responseType === 'arrayBuffer') {
          data = (await response.arrayBuffer()) as T
        } else if (contentType.includes('application/json')) {
          const text = await response.text()
          data = text ? JSON.parse(text) : null
        } else {
          data = (await response.text()) as T
        }

        // Handle error responses
        if (!response.ok) {
          const requestId = response.headers.get('x-request-id') || undefined

          throw new HttpError({
            message: `${init.method || 'GET'} ${url} failed with status ${response.status}`,
            status: response.status,
            statusText: response.statusText,
            url,
            method: init.method || 'GET',
            retryable: isRetryableStatus(response.status),
            response: data,
            requestId,
          })
        }

        return {
          data,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          url: response.url || url,
          duration,
        }
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (error) {
      // Handle abort/timeout
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TimeoutError(timeout, url)
      }

      // Check if retryable
      const isRetryable =
        error instanceof HttpError
          ? error.retryable
          : error instanceof RateLimitError || isNetworkError(error)

      // Retry if possible
      if (isRetryable && remainingRetries > 0) {
        const delay = calculateRetryDelay(
          config.retries! - remainingRetries,
          config.retryDelay ?? 1000,
          config.maxRetryDelay ?? 30000,
          error instanceof RateLimitError ? error.retryAfter : undefined
        )

        if (config.debug) {
          console.log(`[HTTP] Retrying ${url} after ${delay}ms (${remainingRetries} retries left)`)
        }

        await sleep(delay)
        return executeWithRetries(url, init, options, remainingRetries - 1)
      }

      throw error
    }
  }

  /**
   * Make a request
   */
  async function request<T = unknown>(
    path: string,
    options: RequestOptions = {}
  ): Promise<HttpResponse<T>> {
    const url = buildUrl(path, options.params)
    const method = options.method || 'GET'

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...config.headers,
      ...options.headers,
    }

    // Add auth headers unless skipped
    if (!options.skipAuth) {
      Object.assign(headers, buildAuthHeaders(authConfig))
    }

    // Build request init
    const init: RequestInit = {
      method,
      headers,
    }

    // Add body for non-GET requests
    if (options.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      init.body = typeof options.body === 'string'
        ? options.body
        : JSON.stringify(options.body)
    }

    const retries = options.retries ?? config.retries ?? 0

    if (config.debug) {
      console.log(`[HTTP] ${method} ${url}`)
    }

    return executeWithRetries(url, init, options, retries)
  }

  return {
    config,

    request,

    async get<T = unknown>(
      path: string,
      options?: Omit<RequestOptions, 'method' | 'body'>
    ): Promise<T> {
      const response = await request<T>(path, { ...options, method: 'GET' })
      return response.data
    },

    async post<T = unknown>(
      path: string,
      body?: unknown,
      options?: Omit<RequestOptions, 'method' | 'body'>
    ): Promise<T> {
      const response = await request<T>(path, { ...options, method: 'POST', body })
      return response.data
    },

    async put<T = unknown>(
      path: string,
      body?: unknown,
      options?: Omit<RequestOptions, 'method' | 'body'>
    ): Promise<T> {
      const response = await request<T>(path, { ...options, method: 'PUT', body })
      return response.data
    },

    async patch<T = unknown>(
      path: string,
      body?: unknown,
      options?: Omit<RequestOptions, 'method' | 'body'>
    ): Promise<T> {
      const response = await request<T>(path, { ...options, method: 'PATCH', body })
      return response.data
    },

    async delete<T = unknown>(
      path: string,
      options?: Omit<RequestOptions, 'method' | 'body'>
    ): Promise<T> {
      const response = await request<T>(path, { ...options, method: 'DELETE' })
      return response.data
    },

    setAuth(auth: AuthConfig): void {
      authConfig = auth
    },

    getAuth(): AuthConfig | undefined {
      return authConfig
    },
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if status code is retryable
 */
function isRetryableStatus(status: number): boolean {
  return (
    status === 408 || // Request Timeout
    status === 429 || // Too Many Requests
    status === 500 || // Internal Server Error
    status === 502 || // Bad Gateway
    status === 503 || // Service Unavailable
    status === 504    // Gateway Timeout
  )
}

/**
 * Check if error is a network error
 */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return (
    error.message.includes('network') ||
    error.message.includes('ECONNREFUSED') ||
    error.message.includes('ENOTFOUND') ||
    error.message.includes('ETIMEDOUT') ||
    error.name === 'TypeError' // Fetch network errors often throw TypeError
  )
}

/**
 * Calculate retry delay with exponential backoff
 */
function calculateRetryDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  retryAfter?: number
): number {
  // If server specified retry-after, use that
  if (retryAfter !== undefined) {
    return Math.min(retryAfter * 1000, maxDelay)
  }

  // Exponential backoff with jitter
  const exponentialDelay = baseDelay * Math.pow(2, attempt)
  const jitter = Math.random() * 0.3 * exponentialDelay // 0-30% jitter
  return Math.min(exponentialDelay + jitter, maxDelay)
}

/**
 * Sleep for a duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Combine multiple AbortSignals into one
 */
function combineSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort()
      break
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  return controller.signal
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if an error is an HttpError
 */
export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError
}

/**
 * Check if an error is a TimeoutError
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError
}

/**
 * Check if an error is a RateLimitError
 */
export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError
}
