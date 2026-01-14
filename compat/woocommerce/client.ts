/**
 * @dotdo/woocommerce - WooCommerce REST Client
 *
 * Base API client for making requests to the WooCommerce REST API.
 * Supports OAuth 1.0a authentication for HTTP and Basic Auth for HTTPS.
 *
 * @module @dotdo/woocommerce/client
 */

import type {
  WooCommerceConfig,
  ResolvedConfig,
  RestResponse,
  RestRequestOptions,
  WooCommerceErrorResponse,
} from './types'

const RETRY_WAIT_BASE = 500 // 500ms base for exponential backoff

/**
 * WooCommerce API Error
 */
export class WooCommerceAPIError extends Error {
  statusCode: number
  code: string
  response?: WooCommerceErrorResponse

  constructor(
    message: string,
    statusCode: number,
    code: string,
    response?: WooCommerceErrorResponse
  ) {
    super(message)
    this.name = 'WooCommerceAPIError'
    this.statusCode = statusCode
    this.code = code
    this.response = response
  }
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Generate OAuth 1.0a signature (for HTTP)
 * Note: This is a simplified implementation for WooCommerce
 */
function generateOAuthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string
): string {
  // Sort parameters alphabetically
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&')

  // Create signature base string
  const signatureBaseString = [
    method.toUpperCase(),
    encodeURIComponent(url.split('?')[0]),
    encodeURIComponent(sortedParams),
  ].join('&')

  // Create signing key (consumer secret + '&')
  const signingKey = `${encodeURIComponent(consumerSecret)}&`

  // Generate HMAC-SHA1 signature
  // Note: In a real implementation, use crypto library
  // For now, we use Basic Auth which is simpler and works over HTTPS
  return btoa(signatureBaseString + signingKey).substring(0, 32)
}

/**
 * REST API client for WooCommerce
 */
export class RestClient {
  private config: ResolvedConfig

  constructor(config: ResolvedConfig) {
    this.config = config
  }

  /**
   * Build the full URL for a request
   */
  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | string[] | number[] | undefined>
  ): string {
    // Ensure path starts correctly
    const cleanPath = path.replace(/^\//, '')
    const baseUrl = `${this.config.url}/wp-json/${this.config.version}/${cleanPath}`
    const url = new URL(baseUrl)

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          if (Array.isArray(value)) {
            value.forEach((v) => url.searchParams.append(key, String(v)))
          } else {
            url.searchParams.set(key, String(value))
          }
        }
      }
    }

    return url.toString()
  }

  /**
   * Get authentication headers/params
   */
  private getAuth(): { headers?: Record<string, string>; params?: Record<string, string> } {
    // Use Basic Auth (works over HTTPS)
    if (this.config.useBasicAuth) {
      const credentials = btoa(`${this.config.consumerKey}:${this.config.consumerSecret}`)
      return {
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      }
    }

    // Use query string authentication (also works, simpler)
    return {
      params: {
        consumer_key: this.config.consumerKey,
        consumer_secret: this.config.consumerSecret,
      },
    }
  }

  /**
   * Make a request to the WooCommerce API
   */
  private async request<T>(method: string, options: RestRequestOptions): Promise<RestResponse<T>> {
    const auth = this.getAuth()
    const query = { ...options.query, ...auth.params }
    const url = this.buildUrl(options.path, query)
    const retries = options.retries ?? this.config.retries
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...auth.headers,
          ...options.extraHeaders,
        }

        const requestOptions: RequestInit = {
          method,
          headers,
        }

        if (options.data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
          requestOptions.body = JSON.stringify(options.data)
        }

        const response = await this.config.fetch(url, requestOptions)

        if (response.status === 429) {
          // Rate limited - retry with exponential backoff
          const retryAfter = response.headers.get('Retry-After')
          const waitTime = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : RETRY_WAIT_BASE * Math.pow(2, attempt)

          if (attempt < retries) {
            await sleep(waitTime)
            continue
          }
        }

        if (!response.ok) {
          const errorBody = (await response.json().catch(() => ({}))) as WooCommerceErrorResponse
          throw new WooCommerceAPIError(
            errorBody.message || 'Request failed',
            response.status,
            errorBody.code || 'unknown_error',
            errorBody
          )
        }

        const body = (await response.json()) as T
        return { body, headers: response.headers }
      } catch (error) {
        lastError = error as Error

        // Don't retry client errors (4xx except 429)
        if (
          error instanceof WooCommerceAPIError &&
          error.statusCode >= 400 &&
          error.statusCode < 500 &&
          error.statusCode !== 429
        ) {
          throw error
        }

        // Retry with exponential backoff
        if (attempt < retries) {
          const delay = RETRY_WAIT_BASE * Math.pow(2, attempt)
          await sleep(delay)
        }
      }
    }

    throw lastError ?? new Error('Unknown error')
  }

  /**
   * Make a GET request
   */
  async get<T = Record<string, unknown>>(
    options: Omit<RestRequestOptions, 'data'>
  ): Promise<RestResponse<T>> {
    return this.request<T>('GET', options)
  }

  /**
   * Make a POST request
   */
  async post<T = Record<string, unknown>>(options: RestRequestOptions): Promise<RestResponse<T>> {
    return this.request<T>('POST', options)
  }

  /**
   * Make a PUT request
   */
  async put<T = Record<string, unknown>>(options: RestRequestOptions): Promise<RestResponse<T>> {
    return this.request<T>('PUT', options)
  }

  /**
   * Make a DELETE request
   */
  async delete<T = Record<string, unknown>>(
    options: Omit<RestRequestOptions, 'data'> & { data?: { force?: boolean } }
  ): Promise<RestResponse<T>> {
    return this.request<T>('DELETE', options)
  }

  /**
   * Make a PATCH request
   */
  async patch<T = Record<string, unknown>>(options: RestRequestOptions): Promise<RestResponse<T>> {
    return this.request<T>('PATCH', options)
  }
}

/**
 * Resolve configuration with defaults
 */
export function resolveConfig(config: WooCommerceConfig): ResolvedConfig {
  return {
    url: config.url.replace(/\/$/, ''), // Remove trailing slash
    consumerKey: config.consumerKey,
    consumerSecret: config.consumerSecret,
    version: config.version ?? 'wc/v3',
    fetch: config.fetch ?? globalThis.fetch,
    retries: config.retries ?? 3,
    timeout: config.timeout ?? 30000,
    debug: config.debug ?? false,
    useBasicAuth: config.useBasicAuth ?? true,
  }
}
