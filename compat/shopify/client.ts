/**
 * @dotdo/shopify - Shopify REST & GraphQL Client
 *
 * Base API client for making requests to the Shopify Admin API.
 * Supports both REST and GraphQL endpoints with retry and rate limiting.
 *
 * @module @dotdo/shopify/client
 */

import type {
  ResolvedConfig,
  Session,
  RestResponse,
  RestRequestOptions,
  GraphqlResponse,
  GraphqlQueryOptions,
  ShopifyErrorResponse,
} from './types'

const RETRY_WAIT_BASE = 500 // 500ms base for exponential backoff

/**
 * Shopify API Error
 */
export class ShopifyAPIError extends Error {
  statusCode: number
  requestId?: string
  response?: ShopifyErrorResponse

  constructor(
    message: string,
    statusCode: number,
    requestId?: string,
    response?: ShopifyErrorResponse
  ) {
    super(message)
    this.name = 'ShopifyAPIError'
    this.statusCode = statusCode
    this.requestId = requestId
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
 * REST API client for Shopify Admin API
 */
export class RestClient {
  private config: ResolvedConfig
  private session: Session

  constructor(config: ResolvedConfig, options: { session: Session }) {
    this.config = config
    this.session = options.session
  }

  /**
   * Build the full URL for a request
   */
  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    // Ensure path doesn't start with / and doesn't include .json
    const cleanPath = path.replace(/^\//, '').replace(/\.json$/, '')
    const baseUrl = `https://${this.session.shop}/admin/api/${this.config.apiVersion}/${cleanPath}.json`
    const url = new URL(baseUrl)

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    return url.toString()
  }

  /**
   * Make a request to the Shopify API
   */
  private async request<T>(
    method: string,
    options: RestRequestOptions
  ): Promise<RestResponse<T>> {
    const url = this.buildUrl(options.path, options.query)
    const retries = options.retries ?? this.config.retries
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.session.accessToken || '',
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
        const requestId = response.headers.get('x-request-id') || undefined

        if (response.status === 429) {
          // Rate limited - extract retry delay and retry
          const retryAfter = response.headers.get('Retry-After')
          const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : RETRY_WAIT_BASE * Math.pow(2, attempt)

          if (attempt < retries) {
            await sleep(waitTime)
            continue
          }
        }

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({})) as ShopifyErrorResponse
          throw new ShopifyAPIError(
            typeof errorBody.errors === 'string' ? errorBody.errors : 'Request failed',
            response.status,
            requestId,
            errorBody
          )
        }

        const body = await response.json() as T
        return { body, headers: response.headers }
      } catch (error) {
        lastError = error as Error

        // Don't retry client errors (4xx except 429)
        if (error instanceof ShopifyAPIError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
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
  async get<T = Record<string, unknown>>(options: Omit<RestRequestOptions, 'data'>): Promise<RestResponse<T>> {
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
  async delete<T = Record<string, unknown>>(options: Omit<RestRequestOptions, 'data'>): Promise<RestResponse<T>> {
    return this.request<T>('DELETE', options)
  }
}

/**
 * GraphQL API client for Shopify Admin API
 */
export class GraphqlClient {
  private config: ResolvedConfig
  private session: Session

  constructor(config: ResolvedConfig, options: { session: Session }) {
    this.config = config
    this.session = options.session
  }

  /**
   * Execute a GraphQL query or mutation
   */
  async query<T = Record<string, unknown>>(options: GraphqlQueryOptions): Promise<GraphqlResponse<T>> {
    const url = `https://${this.session.shop}/admin/api/${this.config.apiVersion}/graphql.json`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': this.session.accessToken || '',
      ...options.extraHeaders,
    }

    let body: string
    if (typeof options.data === 'string') {
      body = JSON.stringify({ query: options.data })
    } else {
      body = JSON.stringify(options.data)
    }

    const response = await this.config.fetch(url, {
      method: 'POST',
      headers,
      body,
    })

    const responseBody = await response.json() as { data: T | null; errors?: unknown[]; extensions?: Record<string, unknown> }

    return {
      body: responseBody as GraphqlResponse<T>['body'],
      headers: response.headers,
    }
  }
}

/**
 * Factory for creating API clients
 */
export class ClientsFactory {
  private config: ResolvedConfig

  /** REST client class */
  Rest: new (options: { session: Session }) => RestClient
  /** GraphQL client class */
  Graphql: new (options: { session: Session }) => GraphqlClient

  constructor(config: ResolvedConfig) {
    this.config = config

    // Create bound constructors that capture the config
    const boundConfig = config
    this.Rest = class extends RestClient {
      constructor(options: { session: Session }) {
        super(boundConfig, options)
      }
    }
    this.Graphql = class extends GraphqlClient {
      constructor(options: { session: Session }) {
        super(boundConfig, options)
      }
    }
  }
}
