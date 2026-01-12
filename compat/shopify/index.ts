/**
 * @dotdo/shopify - Shopify API Compatibility Layer
 *
 * Drop-in replacement for @shopify/shopify-api with edge compatibility.
 * Implements Products, Orders, Customers, Inventory, Webhooks, Auth, and GraphQL.
 *
 * @example
 * ```typescript
 * import { shopifyApi, LATEST_API_VERSION } from '@dotdo/shopify'
 *
 * const shopify = shopifyApi({
 *   apiKey: 'key',
 *   apiSecretKey: 'secret',
 *   scopes: ['read_products', 'write_orders'],
 *   hostName: 'my-store.myshopify.com',
 *   apiVersion: LATEST_API_VERSION,
 * })
 *
 * // REST API
 * const session = await shopify.auth.tokenExchange({ shop, code })
 * const restClient = new shopify.clients.Rest({ session })
 *
 * const products = await restClient.get({ path: 'products' })
 * const order = await restClient.post({ path: 'orders', data: { order: {...} } })
 *
 * // GraphQL API
 * const gqlClient = new shopify.clients.Graphql({ session })
 * const response = await gqlClient.query({
 *   data: `query { shop { name } }`,
 * })
 *
 * // Webhooks
 * const valid = await shopify.webhooks.validate({
 *   rawBody: '...',
 *   hmac: '...',
 * })
 * ```
 *
 * @module @dotdo/shopify
 */

import {
  LATEST_API_VERSION,
  type ShopifyConfig,
  type ResolvedConfig,
  type Session,
  type TokenExchangeParams,
  type TokenExchangeResponse,
  type AuthorizationUrlParams,
  type AuthorizationUrlResult,
  type RestResponse,
  type RestRequestOptions,
  type GraphqlResponse,
  type GraphqlQueryOptions,
  type WebhookValidateParams,
  type ShopifyErrorResponse,
} from './types'

// Re-export types and constants
export * from './types'

// Re-export resource modules for direct use
export * from './client'
export * from './products'
export * from './orders'
export * from './customers'
export * from './inventory'

// Re-export Storefront API
export {
  createStorefrontClient,
  STOREFRONT_API_VERSION,
  StorefrontAPIError,
  type StorefrontClient,
  type StorefrontConfig,
  type StorefrontResponse,
  type StorefrontError,
  type StorefrontProduct,
  type StorefrontCollection,
  type ProductVariant,
  type ProductConnection,
  type CollectionConnection,
  type Cart,
  type CartLine,
  type CartLineInput,
  type CartLineUpdateInput,
  type CartCreatePayload,
  type CartLinesAddPayload,
  type CartLinesUpdatePayload,
  type CartLinesRemovePayload,
  type Checkout,
  type CheckoutCreateInput,
  type CheckoutCreatePayload,
  type CheckoutLineItemInput,
  type Customer as StorefrontCustomer,
  type CustomerAccessToken,
  type CustomerAccessTokenCreatePayload,
  type CustomerCreateInput,
  type CustomerCreatePayload,
  type CustomerUpdateInput,
  type CustomerUpdatePayload,
  type MoneyV2,
  type MailingAddress,
  type MailingAddressInput,
  type Image,
  type PageInfo,
  type ConnectionArgs,
  type ProductSortKeys,
  type CollectionSortKeys,
  type ProductFilter,
} from './storefront'

const DEFAULT_RETRIES = 2
const DEFAULT_TIMEOUT = 60000 // 60 seconds
const RETRY_WAIT_BASE = 500 // 500ms base for exponential backoff

// =============================================================================
// Error Classes
// =============================================================================

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

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a random state string for OAuth
 */
function generateState(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Compute HMAC-SHA256 signature
 */
async function computeHmacSignature(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const messageData = encoder.encode(data)

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign('HMAC', key, messageData)
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
}

/**
 * Constant-time string comparison
 */
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// =============================================================================
// REST Client
// =============================================================================

/**
 * REST API client for Shopify Admin API
 */
class RestClient {
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

// =============================================================================
// GraphQL Client
// =============================================================================

/**
 * GraphQL API client for Shopify Admin API
 */
class GraphqlClient {
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

// =============================================================================
// Auth Module
// =============================================================================

/**
 * Authentication module for Shopify OAuth
 */
class AuthModule {
  private config: ResolvedConfig

  constructor(config: ResolvedConfig) {
    this.config = config
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthorizationUrl(params: AuthorizationUrlParams): AuthorizationUrlResult {
    const state = params.state ?? generateState()
    const scopes = this.config.scopes.join(',')

    const queryParams = new URLSearchParams({
      client_id: this.config.apiKey,
      scope: scopes,
      redirect_uri: params.redirectUri,
      state,
    })

    if (params.isOnline) {
      queryParams.set('grant_options[]', 'per-user')
    }

    const url = `https://${params.shop}/admin/oauth/authorize?${queryParams.toString()}`

    return { url, state }
  }

  /**
   * Exchange authorization code for access token
   */
  async tokenExchange(params: TokenExchangeParams): Promise<Session> {
    const url = `https://${params.shop}/admin/oauth/access_token`

    const response = await this.config.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.config.apiKey,
        client_secret: this.config.apiSecretKey,
        code: params.code,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new ShopifyAPIError(`Token exchange failed: ${error}`, response.status)
    }

    const data = (await response.json()) as TokenExchangeResponse

    const isOnline = params.isOnline ?? false
    const sessionId = isOnline
      ? `online_${params.shop}_${data.associated_user?.id}`
      : `offline_${params.shop}`

    const session: Session = {
      id: sessionId,
      shop: params.shop,
      state: '',
      isOnline,
      accessToken: data.access_token,
      scope: data.scope,
    }

    if (isOnline && data.expires_in && data.associated_user) {
      session.expires = new Date(Date.now() + data.expires_in * 1000)
      session.onlineAccessInfo = {
        expiresIn: data.expires_in,
        associatedUserScope: data.associated_user_scope || '',
        associatedUser: data.associated_user,
      }
    }

    return session
  }
}

// =============================================================================
// Webhooks Module
// =============================================================================

/**
 * Webhooks module for signature validation
 */
class WebhooksModule {
  private config: ResolvedConfig

  constructor(config: ResolvedConfig) {
    this.config = config
  }

  /**
   * Validate webhook signature
   */
  async validate(params: WebhookValidateParams): Promise<boolean> {
    const rawBodyString =
      typeof params.rawBody === 'string'
        ? params.rawBody
        : new TextDecoder().decode(params.rawBody)

    try {
      const expectedHmac = await computeHmacSignature(rawBodyString, this.config.apiSecretKey)
      return secureCompare(params.hmac, expectedHmac)
    } catch {
      return false
    }
  }

  /**
   * Generate test HMAC for testing purposes
   */
  async generateTestHmac(rawBody: string): Promise<string> {
    return computeHmacSignature(rawBody, this.config.apiSecretKey)
  }
}

// =============================================================================
// Clients Factory
// =============================================================================

/**
 * Factory for creating API clients
 */
class ClientsFactory {
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

// =============================================================================
// Shopify API Instance
// =============================================================================

/**
 * Shopify API instance with auth, clients, and webhooks
 */
export interface ShopifyApi {
  /** Configuration */
  config: ResolvedConfig
  /** Authentication module */
  auth: AuthModule
  /** API clients factory */
  clients: ClientsFactory
  /** Webhooks module */
  webhooks: WebhooksModule
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a Shopify API instance
 *
 * @example
 * ```typescript
 * const shopify = shopifyApi({
 *   apiKey: 'your-api-key',
 *   apiSecretKey: 'your-api-secret',
 *   scopes: ['read_products', 'write_orders'],
 *   hostName: 'my-store.myshopify.com',
 * })
 * ```
 */
export function shopifyApi(config: ShopifyConfig): ShopifyApi {
  // Validate required config
  if (!config.apiKey) {
    throw new Error('API key is required')
  }
  if (!config.apiSecretKey) {
    throw new Error('API secret key is required')
  }
  if (!config.scopes || config.scopes.length === 0) {
    throw new Error('At least one scope is required')
  }
  if (!config.hostName) {
    throw new Error('Host name is required')
  }

  // Resolve config with defaults
  const resolvedConfig: ResolvedConfig = {
    apiKey: config.apiKey,
    apiSecretKey: config.apiSecretKey,
    scopes: config.scopes,
    hostName: config.hostName,
    apiVersion: config.apiVersion || LATEST_API_VERSION,
    fetch: config.fetch || globalThis.fetch.bind(globalThis),
    retries: config.retries ?? DEFAULT_RETRIES,
    timeout: config.timeout ?? DEFAULT_TIMEOUT,
    debug: config.debug ?? false,
  }

  return {
    config: resolvedConfig,
    auth: new AuthModule(resolvedConfig),
    clients: new ClientsFactory(resolvedConfig),
    webhooks: new WebhooksModule(resolvedConfig),
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default shopifyApi
