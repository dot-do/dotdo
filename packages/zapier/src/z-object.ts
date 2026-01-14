/**
 * Zapier Z Object Implementation
 *
 * The main interface for making HTTP requests and using utilities in Zapier apps.
 */

import type {
  ZObject,
  ZRequestOptions,
  ZResponse,
  ZConsole,
  ZJSON,
  ZErrors,
  ZCursor,
  DehydrateFunc,
  Bundle,
  BeforeRequestMiddleware,
  AfterResponseMiddleware,
} from './types'
import {
  ZapierError,
  ExpiredAuthError,
  RefreshAuthError,
  HaltedError,
  ThrottledError,
  ResponseError,
} from './types'

// ============================================================================
// Z OBJECT FACTORY
// ============================================================================

/**
 * Options for creating a Z object
 */
export interface CreateZObjectOptions {
  beforeRequest?: BeforeRequestMiddleware[]
  afterResponse?: AfterResponseMiddleware[]
  bundle?: Bundle
  cursorStorage?: {
    get: () => Promise<string | undefined>
    set: (cursor: string) => Promise<void>
  }
  hydrationStore?: Map<string, { func: DehydrateFunc; inputData: Record<string, unknown> }>
}

/**
 * Create a Z object for making HTTP requests and using utilities
 */
export function createZObject(options: CreateZObjectOptions = {}): ZObject {
  const timers = new Map<string, number>()
  const hydrationStore =
    options.hydrationStore ||
    new Map<string, { func: DehydrateFunc; inputData: Record<string, unknown> }>()
  let hydrationCounter = 0

  // Console
  const zConsole: ZConsole = {
    log: (...args: unknown[]) => console.log('[Zapier]', ...args),
    time: (label: string) => {
      timers.set(label, Date.now())
    },
    timeEnd: (label: string) => {
      const start = timers.get(label)
      if (start) {
        console.log(`[Zapier] ${label}: ${Date.now() - start}ms`)
        timers.delete(label)
      }
    },
  }

  // JSON
  const zJSON: ZJSON = {
    parse: (text: string) => JSON.parse(text),
    stringify: (value: unknown) => JSON.stringify(value),
  }

  // Errors
  const zErrors: ZErrors = {
    Error: ZapierError,
    ExpiredAuthError,
    RefreshAuthError,
    HaltedError,
    ThrottledError,
    ResponseError,
  }

  // Cursor
  const zCursor: ZCursor = {
    get: async () => {
      if (options.cursorStorage) {
        return options.cursorStorage.get()
      }
      return undefined
    },
    set: async (cursor: string) => {
      if (options.cursorStorage) {
        await options.cursorStorage.set(cursor)
      }
    },
  }

  // Request function
  async function makeRequest(urlOrOptions: string | ZRequestOptions): Promise<ZResponse> {
    let requestOptions: ZRequestOptions =
      typeof urlOrOptions === 'string' ? { url: urlOrOptions } : { ...urlOrOptions }

    // Apply beforeRequest middleware
    if (options.beforeRequest && options.bundle) {
      for (const middleware of options.beforeRequest) {
        requestOptions = await middleware(requestOptions, z, options.bundle)
      }
    }

    let url = requestOptions.url

    // Add query params
    if (requestOptions.params) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(requestOptions.params)) {
        if (value !== undefined && value !== null) {
          params.append(key, String(value))
        }
      }
      const paramString = params.toString()
      if (paramString) {
        url += (url.includes('?') ? '&' : '?') + paramString
      }
    }

    // Build headers
    const headers: Record<string, string> = {
      ...requestOptions.headers,
    }

    // Build body
    let body: string | FormData | undefined

    if (requestOptions.json !== undefined) {
      body = JSON.stringify(requestOptions.json)
      headers['Content-Type'] = headers['Content-Type'] || 'application/json'
    } else if (requestOptions.body !== undefined) {
      if (typeof requestOptions.body === 'string') {
        body = requestOptions.body
      } else if (requestOptions.body instanceof FormData) {
        body = requestOptions.body
      } else {
        body = JSON.stringify(requestOptions.body)
        headers['Content-Type'] = headers['Content-Type'] || 'application/json'
      }
    } else if (requestOptions.form) {
      body = new URLSearchParams(requestOptions.form).toString()
      headers['Content-Type'] =
        headers['Content-Type'] || 'application/x-www-form-urlencoded'
    }

    // Make the request
    const fetchOptions: RequestInit = {
      method: requestOptions.method || 'GET',
      headers,
      redirect: requestOptions.redirect || 'follow',
    }

    if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(fetchOptions.method!)) {
      fetchOptions.body = body
    }

    // Add timeout via AbortController
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (requestOptions.timeout) {
      const controller = new AbortController()
      fetchOptions.signal = controller.signal
      timeoutId = setTimeout(() => controller.abort(), requestOptions.timeout)
    }

    try {
      const response = await fetch(url, fetchOptions)

      // Parse response
      const contentType = response.headers.get('content-type') || ''
      let data: unknown
      let content: string

      if (requestOptions.raw) {
        content = ''
        data = await response.arrayBuffer()
      } else if (requestOptions.skipParseResponse) {
        content = await response.text()
        data = content
      } else {
        content = await response.text()

        // Remove BOM if requested
        if (requestOptions.removeBOM && content.charCodeAt(0) === 0xfeff) {
          content = content.slice(1)
        }

        // Try to parse as JSON
        const isJsonContentType = contentType.includes('application/json')
        const looksLikeJson =
          content.trim().startsWith('{') || content.trim().startsWith('[')

        if (isJsonContentType || looksLikeJson) {
          try {
            data = JSON.parse(content)
          } catch {
            data = content
          }
        } else {
          data = content
        }
      }

      let zResponse: ZResponse = {
        status: response.status,
        headers: response.headers,
        data,
        content,
        json: data,
        request: requestOptions,
        getHeader: (name: string) => response.headers.get(name),
        throwForStatus: () => {
          if (!response.ok) {
            throw new ResponseError(zResponse)
          }
        },
      }

      // Apply afterResponse middleware
      if (options.afterResponse && options.bundle) {
        for (const middleware of options.afterResponse) {
          zResponse = await middleware(zResponse, z, options.bundle)
        }
      }

      // Auto throw for non-2xx unless skipped
      if (!requestOptions.skipThrowForStatus && !response.ok) {
        throw new ResponseError(zResponse)
      }

      return zResponse
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }

  // Hash function
  function hash(algorithm: 'md5' | 'sha1' | 'sha256', value: string): string {
    // Simple hash implementation (for deduplication, not crypto)
    // In production, would use crypto.subtle for real hashing
    let h = 0
    for (let i = 0; i < value.length; i++) {
      const char = value.charCodeAt(i)
      h = (h << 5) - h + char
      h = h & h // Convert to 32bit integer
    }
    return Math.abs(h).toString(16).padStart(8, '0')
  }

  const z: ZObject = {
    request: makeRequest as ZObject['request'],
    console: zConsole,
    JSON: zJSON,
    errors: zErrors,
    cursor: zCursor,

    dehydrate: <T = unknown>(
      func: DehydrateFunc<T>,
      inputData: Record<string, unknown>
    ): string => {
      const id = `hydrate:${++hydrationCounter}:${Date.now()}`
      hydrationStore.set(id, { func: func as DehydrateFunc, inputData })
      return id
    },

    dehydrateFile: <T = unknown>(
      func: DehydrateFunc<T>,
      inputData: Record<string, unknown>
    ): string => {
      const id = `hydrate:file:${++hydrationCounter}:${Date.now()}`
      hydrationStore.set(id, { func: func as DehydrateFunc, inputData })
      return id
    },

    stashFile: async (
      url: string,
      opts?: { filename?: string; contentType?: string }
    ): Promise<string> => {
      // In a real implementation, this would upload to Zapier's file stash
      const filename = opts?.filename || 'file'
      const id = crypto.randomUUID()
      return `https://zapier.com/stash/${id}/${filename}`
    },

    generateCallbackUrl: (): string => {
      const id = crypto.randomUUID()
      return `https://hooks.zapier.com/hooks/callback/${id}`
    },

    hash,
  }

  return z
}

// ============================================================================
// HYDRATION
// ============================================================================

/**
 * Hydration manager for resolving dehydrated references
 */
export class HydrationManager {
  private store = new Map<string, { func: DehydrateFunc; inputData: Record<string, unknown> }>()

  /**
   * Register a hydration function
   */
  register(
    id: string,
    func: DehydrateFunc,
    inputData: Record<string, unknown>
  ): void {
    this.store.set(id, { func, inputData })
  }

  /**
   * Hydrate a dehydrated reference
   */
  async hydrate(id: string, z: ZObject, bundle: Bundle): Promise<unknown> {
    const entry = this.store.get(id)
    if (!entry) {
      throw new Error(`Hydration entry not found: ${id}`)
    }

    const hydrateBundle: Bundle = {
      ...bundle,
      inputData: entry.inputData,
    }

    return entry.func(z, hydrateBundle)
  }

  /**
   * Check if an ID is a dehydrated reference
   */
  isDehydrated(value: unknown): boolean {
    if (typeof value !== 'string') return false
    return value.startsWith('hydrate:')
  }

  /**
   * Recursively hydrate all dehydrated values in an object
   */
  async hydrateObject(
    obj: unknown,
    z: ZObject,
    bundle: Bundle
  ): Promise<unknown> {
    if (typeof obj === 'string' && this.isDehydrated(obj)) {
      return this.hydrate(obj, z, bundle)
    }

    if (Array.isArray(obj)) {
      return Promise.all(
        obj.map((item) => this.hydrateObject(item, z, bundle))
      )
    }

    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj)) {
        result[key] = await this.hydrateObject(value, z, bundle)
      }
      return result
    }

    return obj
  }

  /**
   * Get store for sharing with Z object
   */
  getStore(): Map<string, { func: DehydrateFunc; inputData: Record<string, unknown> }> {
    return this.store
  }
}

// ============================================================================
// REQUEST HELPERS
// ============================================================================

/**
 * Create a simple GET request
 */
export function get(
  url: string,
  params?: Record<string, string>
): ZRequestOptions {
  return {
    url,
    method: 'GET',
    params,
  }
}

/**
 * Create a POST request with JSON body
 */
export function post(url: string, json?: unknown): ZRequestOptions {
  return {
    url,
    method: 'POST',
    json,
  }
}

/**
 * Create a PUT request with JSON body
 */
export function put(url: string, json?: unknown): ZRequestOptions {
  return {
    url,
    method: 'PUT',
    json,
  }
}

/**
 * Create a PATCH request with JSON body
 */
export function patch(url: string, json?: unknown): ZRequestOptions {
  return {
    url,
    method: 'PATCH',
    json,
  }
}

/**
 * Create a DELETE request
 */
export function del(url: string): ZRequestOptions {
  return {
    url,
    method: 'DELETE',
  }
}

/**
 * Add authentication header to request
 */
export function withAuth(
  request: ZRequestOptions,
  type: 'bearer' | 'basic',
  credentials: string | { username: string; password: string }
): ZRequestOptions {
  const headers = { ...request.headers }

  if (type === 'bearer') {
    headers['Authorization'] = `Bearer ${credentials as string}`
  } else if (type === 'basic') {
    const { username, password } = credentials as {
      username: string
      password: string
    }
    const encoded = btoa(`${username}:${password}`)
    headers['Authorization'] = `Basic ${encoded}`
  }

  return { ...request, headers }
}

/**
 * Add custom headers to request
 */
export function withHeaders(
  request: ZRequestOptions,
  headers: Record<string, string>
): ZRequestOptions {
  return {
    ...request,
    headers: { ...request.headers, ...headers },
  }
}

/**
 * Add query parameters to request
 */
export function withParams(
  request: ZRequestOptions,
  params: Record<string, string>
): ZRequestOptions {
  return {
    ...request,
    params: { ...request.params, ...params },
  }
}

// ============================================================================
// MIDDLEWARE HELPERS
// ============================================================================

/**
 * Create a middleware that adds a header to all requests
 */
export function addHeaderMiddleware(
  name: string,
  value: string | ((bundle: Bundle) => string)
): BeforeRequestMiddleware {
  return (request, z, bundle) => {
    const headerValue = typeof value === 'function' ? value(bundle) : value
    return {
      ...request,
      headers: { ...request.headers, [name]: headerValue },
    }
  }
}

/**
 * Create a middleware that adds auth from bundle
 */
export function authMiddleware(
  type: 'bearer' | 'basic' | 'api_key',
  options?: { headerName?: string; tokenField?: string }
): BeforeRequestMiddleware {
  return (request, z, bundle) => {
    const headers = { ...request.headers }

    switch (type) {
      case 'bearer': {
        const token =
          bundle.authData[options?.tokenField || 'access_token'] as string
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }
        break
      }

      case 'basic': {
        const username = bundle.authData.username as string
        const password = bundle.authData.password as string
        if (username && password) {
          const encoded = btoa(`${username}:${password}`)
          headers['Authorization'] = `Basic ${encoded}`
        }
        break
      }

      case 'api_key': {
        const apiKey =
          bundle.authData[options?.tokenField || 'api_key'] as string
        const headerName = options?.headerName || 'X-API-Key'
        if (apiKey) {
          headers[headerName] = apiKey
        }
        break
      }
    }

    return { ...request, headers }
  }
}

/**
 * Create a middleware that handles expired auth
 */
export function expiredAuthMiddleware(
  isExpired: (response: ZResponse) => boolean
): AfterResponseMiddleware {
  return (response, z, bundle) => {
    if (isExpired(response)) {
      throw new ExpiredAuthError()
    }
    return response
  }
}

/**
 * Create a middleware that handles rate limiting
 */
export function rateLimitMiddleware(
  isRateLimited: (response: ZResponse) => boolean,
  getRetryDelay?: (response: ZResponse) => number
): AfterResponseMiddleware {
  return (response, z, bundle) => {
    if (isRateLimited(response)) {
      const delay = getRetryDelay?.(response) || 60000
      throw new ThrottledError('Rate limited', delay)
    }
    return response
  }
}
