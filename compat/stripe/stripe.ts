/**
 * @dotdo/stripe - Stripe API Compatibility Layer
 *
 * Drop-in replacement for Stripe SDK with edge compatibility.
 * Uses @dotdo/rpc for method proxying and batching.
 *
 * @example
 * ```typescript
 * import { Stripe } from '@dotdo/stripe'
 *
 * const stripe = new Stripe('sk_test_xxx')
 *
 * // Create a customer
 * const customer = await stripe.customers.create({
 *   email: 'customer@example.com',
 *   name: 'John Doe',
 * })
 *
 * // Create a subscription
 * const subscription = await stripe.subscriptions.create({
 *   customer: customer.id,
 *   items: [{ price: 'price_xxx' }],
 * })
 *
 * // Create a payment intent
 * const paymentIntent = await stripe.paymentIntents.create({
 *   amount: 2000,
 *   currency: 'usd',
 *   customer: customer.id,
 * })
 * ```
 *
 * @module @dotdo/stripe
 */

import type {
  Customer,
  CustomerCreateParams,
  CustomerUpdateParams,
  CustomerListParams,
  DeletedCustomer,
  Subscription,
  SubscriptionCreateParams,
  SubscriptionUpdateParams,
  SubscriptionListParams,
  SubscriptionCancelParams,
  PaymentIntent,
  PaymentIntentCreateParams,
  PaymentIntentUpdateParams,
  PaymentIntentConfirmParams,
  PaymentIntentCaptureParams,
  PaymentIntentCancelParams,
  PaymentIntentListParams,
  Charge,
  ChargeCreateParams,
  ChargeUpdateParams,
  ChargeCaptureParams,
  ChargeListParams,
  Refund,
  RefundCreateParams,
  RefundUpdateParams,
  RefundListParams,
  PaymentMethod,
  ListResponse,
  RequestOptions,
  StripeError,
  StripeErrorResponse,
  WebhookEvent,
} from './types'

// =============================================================================
// Configuration
// =============================================================================

/**
 * Stripe client configuration options
 */
export interface StripeConfig {
  /** API version to use (default: 2024-12-18.acacia) */
  apiVersion?: string
  /** Maximum number of network retries */
  maxNetworkRetries?: number
  /** Request timeout in milliseconds */
  timeout?: number
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Telemetry disabled */
  telemetry?: boolean
  /** Base URL override (for testing) */
  host?: string
  /** Port override (for testing) */
  port?: number
  /** Protocol override (for testing) */
  protocol?: 'http' | 'https'
}

const DEFAULT_API_VERSION = '2024-12-18.acacia'
const DEFAULT_BASE_URL = 'https://api.stripe.com'
const DEFAULT_TIMEOUT = 80000 // 80 seconds (Stripe's default)
const MAX_NETWORK_RETRIES = 2

// =============================================================================
// Stripe Error Class
// =============================================================================

/**
 * Stripe API Error
 */
export class StripeAPIError extends Error {
  type: StripeError['type']
  code?: string
  decline_code?: string
  doc_url?: string
  param?: string
  statusCode: number
  requestId?: string
  raw: StripeError

  constructor(error: StripeError, statusCode: number, requestId?: string) {
    super(error.message)
    this.name = 'StripeAPIError'
    this.type = error.type
    this.code = error.code
    this.decline_code = error.decline_code
    this.doc_url = error.doc_url
    this.param = error.param
    this.statusCode = statusCode
    this.requestId = requestId
    this.raw = error
  }
}

// =============================================================================
// Resource Base Class
// =============================================================================

/**
 * Base class for Stripe API resources
 */
abstract class StripeResource {
  protected stripe: Stripe

  constructor(stripe: Stripe) {
    this.stripe = stripe
  }

  protected request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<T> {
    return this.stripe._request(method, path, params, options)
  }
}

// =============================================================================
// Customers Resource
// =============================================================================

/**
 * Customers resource for managing Stripe customers
 */
export class CustomersResource extends StripeResource {
  /**
   * Create a new customer
   */
  async create(params: CustomerCreateParams, options?: RequestOptions): Promise<Customer> {
    return this.request('POST', '/v1/customers', params, options)
  }

  /**
   * Retrieve a customer by ID
   */
  async retrieve(id: string, options?: RequestOptions): Promise<Customer> {
    return this.request('GET', `/v1/customers/${id}`, undefined, options)
  }

  /**
   * Update a customer
   */
  async update(id: string, params: CustomerUpdateParams, options?: RequestOptions): Promise<Customer> {
    return this.request('POST', `/v1/customers/${id}`, params, options)
  }

  /**
   * Delete a customer
   */
  async del(id: string, options?: RequestOptions): Promise<DeletedCustomer> {
    return this.request('DELETE', `/v1/customers/${id}`, undefined, options)
  }

  /**
   * List all customers
   */
  async list(params?: CustomerListParams, options?: RequestOptions): Promise<ListResponse<Customer>> {
    return this.request('GET', '/v1/customers', params, options)
  }

  /**
   * Search for customers
   */
  async search(
    params: { query: string; limit?: number; page?: string },
    options?: RequestOptions
  ): Promise<{ data: Customer[]; has_more: boolean; next_page?: string }> {
    return this.request('GET', '/v1/customers/search', params, options)
  }
}

// =============================================================================
// Subscriptions Resource
// =============================================================================

/**
 * Subscriptions resource for managing recurring billing
 */
export class SubscriptionsResource extends StripeResource {
  /**
   * Create a new subscription
   */
  async create(params: SubscriptionCreateParams, options?: RequestOptions): Promise<Subscription> {
    return this.request('POST', '/v1/subscriptions', params, options)
  }

  /**
   * Retrieve a subscription by ID
   */
  async retrieve(id: string, options?: RequestOptions): Promise<Subscription> {
    return this.request('GET', `/v1/subscriptions/${id}`, undefined, options)
  }

  /**
   * Update a subscription
   */
  async update(id: string, params: SubscriptionUpdateParams, options?: RequestOptions): Promise<Subscription> {
    return this.request('POST', `/v1/subscriptions/${id}`, params, options)
  }

  /**
   * Cancel a subscription
   */
  async cancel(id: string, params?: SubscriptionCancelParams, options?: RequestOptions): Promise<Subscription> {
    return this.request('DELETE', `/v1/subscriptions/${id}`, params, options)
  }

  /**
   * List all subscriptions
   */
  async list(params?: SubscriptionListParams, options?: RequestOptions): Promise<ListResponse<Subscription>> {
    return this.request('GET', '/v1/subscriptions', params, options)
  }

  /**
   * Resume a paused subscription
   */
  async resume(
    id: string,
    params?: { billing_cycle_anchor?: 'now' | 'unchanged'; proration_behavior?: 'always_invoice' | 'create_prorations' | 'none' },
    options?: RequestOptions
  ): Promise<Subscription> {
    return this.request('POST', `/v1/subscriptions/${id}/resume`, params, options)
  }

  /**
   * Search for subscriptions
   */
  async search(
    params: { query: string; limit?: number; page?: string },
    options?: RequestOptions
  ): Promise<{ data: Subscription[]; has_more: boolean; next_page?: string }> {
    return this.request('GET', '/v1/subscriptions/search', params, options)
  }
}

// =============================================================================
// Payment Intents Resource
// =============================================================================

/**
 * PaymentIntents resource for handling payments
 */
export class PaymentIntentsResource extends StripeResource {
  /**
   * Create a new payment intent
   */
  async create(params: PaymentIntentCreateParams, options?: RequestOptions): Promise<PaymentIntent> {
    return this.request('POST', '/v1/payment_intents', params, options)
  }

  /**
   * Retrieve a payment intent by ID
   */
  async retrieve(id: string, options?: RequestOptions): Promise<PaymentIntent> {
    return this.request('GET', `/v1/payment_intents/${id}`, undefined, options)
  }

  /**
   * Update a payment intent
   */
  async update(id: string, params: PaymentIntentUpdateParams, options?: RequestOptions): Promise<PaymentIntent> {
    return this.request('POST', `/v1/payment_intents/${id}`, params, options)
  }

  /**
   * Confirm a payment intent
   */
  async confirm(id: string, params?: PaymentIntentConfirmParams, options?: RequestOptions): Promise<PaymentIntent> {
    return this.request('POST', `/v1/payment_intents/${id}/confirm`, params, options)
  }

  /**
   * Capture a payment intent
   */
  async capture(id: string, params?: PaymentIntentCaptureParams, options?: RequestOptions): Promise<PaymentIntent> {
    return this.request('POST', `/v1/payment_intents/${id}/capture`, params, options)
  }

  /**
   * Cancel a payment intent
   */
  async cancel(id: string, params?: PaymentIntentCancelParams, options?: RequestOptions): Promise<PaymentIntent> {
    return this.request('POST', `/v1/payment_intents/${id}/cancel`, params, options)
  }

  /**
   * List payment intents
   */
  async list(params?: PaymentIntentListParams, options?: RequestOptions): Promise<ListResponse<PaymentIntent>> {
    return this.request('GET', '/v1/payment_intents', params, options)
  }

  /**
   * Search for payment intents
   */
  async search(
    params: { query: string; limit?: number; page?: string },
    options?: RequestOptions
  ): Promise<{ data: PaymentIntent[]; has_more: boolean; next_page?: string }> {
    return this.request('GET', '/v1/payment_intents/search', params, options)
  }

  /**
   * Increment the authorization on a payment intent
   */
  async incrementAuthorization(
    id: string,
    params: { amount: number; description?: string; metadata?: Record<string, string> },
    options?: RequestOptions
  ): Promise<PaymentIntent> {
    return this.request('POST', `/v1/payment_intents/${id}/increment_authorization`, params, options)
  }
}

// =============================================================================
// Charges Resource
// =============================================================================

/**
 * Charges resource (legacy - prefer PaymentIntents)
 */
export class ChargesResource extends StripeResource {
  /**
   * Create a new charge
   * @deprecated Use PaymentIntents instead
   */
  async create(params: ChargeCreateParams, options?: RequestOptions): Promise<Charge> {
    return this.request('POST', '/v1/charges', params, options)
  }

  /**
   * Retrieve a charge by ID
   */
  async retrieve(id: string, options?: RequestOptions): Promise<Charge> {
    return this.request('GET', `/v1/charges/${id}`, undefined, options)
  }

  /**
   * Update a charge
   */
  async update(id: string, params: ChargeUpdateParams, options?: RequestOptions): Promise<Charge> {
    return this.request('POST', `/v1/charges/${id}`, params, options)
  }

  /**
   * Capture a charge
   */
  async capture(id: string, params?: ChargeCaptureParams, options?: RequestOptions): Promise<Charge> {
    return this.request('POST', `/v1/charges/${id}/capture`, params, options)
  }

  /**
   * List all charges
   */
  async list(params?: ChargeListParams, options?: RequestOptions): Promise<ListResponse<Charge>> {
    return this.request('GET', '/v1/charges', params, options)
  }

  /**
   * Search for charges
   */
  async search(
    params: { query: string; limit?: number; page?: string },
    options?: RequestOptions
  ): Promise<{ data: Charge[]; has_more: boolean; next_page?: string }> {
    return this.request('GET', '/v1/charges/search', params, options)
  }
}

// =============================================================================
// Refunds Resource
// =============================================================================

/**
 * Refunds resource for managing refunds
 */
export class RefundsResource extends StripeResource {
  /**
   * Create a new refund
   */
  async create(params: RefundCreateParams, options?: RequestOptions): Promise<Refund> {
    return this.request('POST', '/v1/refunds', params, options)
  }

  /**
   * Retrieve a refund by ID
   */
  async retrieve(id: string, options?: RequestOptions): Promise<Refund> {
    return this.request('GET', `/v1/refunds/${id}`, undefined, options)
  }

  /**
   * Update a refund
   */
  async update(id: string, params: RefundUpdateParams, options?: RequestOptions): Promise<Refund> {
    return this.request('POST', `/v1/refunds/${id}`, params, options)
  }

  /**
   * Cancel a refund
   */
  async cancel(id: string, options?: RequestOptions): Promise<Refund> {
    return this.request('POST', `/v1/refunds/${id}/cancel`, undefined, options)
  }

  /**
   * List all refunds
   */
  async list(params?: RefundListParams, options?: RequestOptions): Promise<ListResponse<Refund>> {
    return this.request('GET', '/v1/refunds', params, options)
  }
}

// =============================================================================
// Payment Methods Resource
// =============================================================================

/**
 * PaymentMethods resource for managing payment methods
 */
export class PaymentMethodsResource extends StripeResource {
  /**
   * Create a new payment method
   */
  async create(
    params: {
      type: string
      billing_details?: {
        address?: {
          city?: string
          country?: string
          line1?: string
          line2?: string
          postal_code?: string
          state?: string
        }
        email?: string
        name?: string
        phone?: string
      }
      card?: {
        exp_month: number
        exp_year: number
        number: string
        cvc?: string
      }
      metadata?: Record<string, string>
    },
    options?: RequestOptions
  ): Promise<PaymentMethod> {
    return this.request('POST', '/v1/payment_methods', params, options)
  }

  /**
   * Retrieve a payment method by ID
   */
  async retrieve(id: string, options?: RequestOptions): Promise<PaymentMethod> {
    return this.request('GET', `/v1/payment_methods/${id}`, undefined, options)
  }

  /**
   * Update a payment method
   */
  async update(
    id: string,
    params: {
      billing_details?: {
        address?: {
          city?: string
          country?: string
          line1?: string
          line2?: string
          postal_code?: string
          state?: string
        }
        email?: string
        name?: string
        phone?: string
      }
      card?: { exp_month?: number; exp_year?: number }
      metadata?: Record<string, string> | ''
    },
    options?: RequestOptions
  ): Promise<PaymentMethod> {
    return this.request('POST', `/v1/payment_methods/${id}`, params, options)
  }

  /**
   * Attach a payment method to a customer
   */
  async attach(id: string, params: { customer: string }, options?: RequestOptions): Promise<PaymentMethod> {
    return this.request('POST', `/v1/payment_methods/${id}/attach`, params, options)
  }

  /**
   * Detach a payment method from a customer
   */
  async detach(id: string, options?: RequestOptions): Promise<PaymentMethod> {
    return this.request('POST', `/v1/payment_methods/${id}/detach`, undefined, options)
  }

  /**
   * List payment methods
   */
  async list(
    params: { customer?: string; type?: string; limit?: number; starting_after?: string; ending_before?: string },
    options?: RequestOptions
  ): Promise<ListResponse<PaymentMethod>> {
    return this.request('GET', '/v1/payment_methods', params, options)
  }
}

// =============================================================================
// Webhooks Utility
// =============================================================================

/**
 * Webhooks utility for signature verification
 */
export class Webhooks {
  /**
   * Construct a webhook event from a raw payload and signature
   *
   * @param payload - Raw webhook payload (string or Buffer)
   * @param signature - Stripe-Signature header value
   * @param secret - Webhook signing secret (whsec_xxx)
   * @param tolerance - Maximum age of the signature in seconds (default: 300)
   * @returns Parsed and verified webhook event
   * @throws Error if signature is invalid
   */
  static async constructEvent(
    payload: string | ArrayBuffer,
    signature: string,
    secret: string,
    tolerance = 300
  ): Promise<WebhookEvent> {
    const payloadString = typeof payload === 'string' ? payload : new TextDecoder().decode(payload)

    // Parse the signature header
    const signatureParts = signature.split(',').reduce(
      (acc, part) => {
        const [key, value] = part.split('=')
        if (key === 't') acc.timestamp = parseInt(value, 10)
        else if (key === 'v1') acc.signatures.push(value)
        return acc
      },
      { timestamp: 0, signatures: [] as string[] }
    )

    if (!signatureParts.timestamp) {
      throw new Error('Unable to extract timestamp from signature header')
    }

    if (signatureParts.signatures.length === 0) {
      throw new Error('No valid signature found in header')
    }

    // Check timestamp tolerance
    const now = Math.floor(Date.now() / 1000)
    if (now - signatureParts.timestamp > tolerance) {
      throw new Error(`Webhook timestamp too old. Timestamp: ${signatureParts.timestamp}, now: ${now}`)
    }

    // Compute expected signature
    const signedPayload = `${signatureParts.timestamp}.${payloadString}`
    const expectedSignature = await computeHmacSignature(signedPayload, secret)

    // Verify at least one signature matches
    const isValid = signatureParts.signatures.some(
      (sig) => secureCompare(sig, expectedSignature)
    )

    if (!isValid) {
      throw new Error('Webhook signature verification failed')
    }

    // Parse and return the event
    return JSON.parse(payloadString) as WebhookEvent
  }

  /**
   * Verify a webhook signature without parsing the event
   */
  static async verifySignature(
    payload: string | ArrayBuffer,
    signature: string,
    secret: string,
    tolerance = 300
  ): Promise<boolean> {
    try {
      await Webhooks.constructEvent(payload, signature, secret, tolerance)
      return true
    } catch {
      return false
    }
  }

  /**
   * Generate a test webhook signature (for testing only)
   */
  static async generateTestHeaderString(options: {
    payload: string
    secret: string
    timestamp?: number
  }): Promise<string> {
    const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000)
    const signedPayload = `${timestamp}.${options.payload}`
    const signature = await computeHmacSignature(signedPayload, options.secret)
    return `t=${timestamp},v1=${signature}`
  }
}

/**
 * Compute HMAC-SHA256 signature
 */
async function computeHmacSignature(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const payloadData = encoder.encode(payload)

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign('HMAC', key, payloadData)
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
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

// =============================================================================
// Main Stripe Client
// =============================================================================

/**
 * Stripe client for API interactions
 */
export class Stripe {
  private apiKey: string
  private apiVersion: string
  private baseUrl: string
  private timeout: number
  private maxNetworkRetries: number
  private _fetch: typeof fetch

  // Resources
  readonly customers: CustomersResource
  readonly subscriptions: SubscriptionsResource
  readonly paymentIntents: PaymentIntentsResource
  readonly charges: ChargesResource
  readonly refunds: RefundsResource
  readonly paymentMethods: PaymentMethodsResource

  // Static utilities
  static readonly webhooks = Webhooks

  constructor(apiKey: string, config: StripeConfig = {}) {
    if (!apiKey) {
      throw new Error('Stripe API key is required')
    }

    this.apiKey = apiKey
    this.apiVersion = config.apiVersion ?? DEFAULT_API_VERSION

    // Build base URL
    const protocol = config.protocol ?? 'https'
    const host = config.host ?? 'api.stripe.com'
    const port = config.port
    this.baseUrl = port ? `${protocol}://${host}:${port}` : `${protocol}://${host}`

    this.timeout = config.timeout ?? DEFAULT_TIMEOUT
    this.maxNetworkRetries = config.maxNetworkRetries ?? MAX_NETWORK_RETRIES
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis)

    // Initialize resources
    this.customers = new CustomersResource(this)
    this.subscriptions = new SubscriptionsResource(this)
    this.paymentIntents = new PaymentIntentsResource(this)
    this.charges = new ChargesResource(this)
    this.refunds = new RefundsResource(this)
    this.paymentMethods = new PaymentMethodsResource(this)
  }

  /**
   * Make a raw API request
   * @internal
   */
  async _request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<T> {
    const url = new URL(path, this.baseUrl)

    // Add query params for GET requests
    if (method === 'GET' && params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          if (typeof value === 'object') {
            // Handle nested objects like created[gt]
            for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
              if (nestedValue !== undefined) {
                url.searchParams.set(`${key}[${nestedKey}]`, String(nestedValue))
              }
            }
          } else {
            url.searchParams.set(key, String(value))
          }
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${options?.apiKey ?? this.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': options?.apiVersion ?? this.apiVersion,
    }

    if (options?.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey
    }

    if (options?.stripeAccount) {
      headers['Stripe-Account'] = options.stripeAccount
    }

    // Build request body for POST/DELETE with params
    let body: string | undefined
    if ((method === 'POST' || method === 'DELETE') && params) {
      body = encodeFormData(params)
    }

    let lastError: Error | null = null
    const maxRetries = options?.maxNetworkRetries ?? this.maxNetworkRetries

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), options?.timeout ?? this.timeout)

        try {
          const response = await this._fetch(url.toString(), {
            method,
            headers,
            body,
            signal: controller.signal,
          })

          const data = await response.json()

          if (!response.ok) {
            const errorResponse = data as StripeErrorResponse
            throw new StripeAPIError(
              errorResponse.error,
              response.status,
              response.headers.get('request-id') ?? undefined
            )
          }

          return data as T
        } finally {
          clearTimeout(timeoutId)
        }
      } catch (error) {
        lastError = error as Error

        // Don't retry client errors (4xx)
        if (error instanceof StripeAPIError && error.statusCode >= 400 && error.statusCode < 500) {
          throw error
        }

        // Don't retry if it's an abort error
        if (error instanceof Error && error.name === 'AbortError') {
          throw new StripeAPIError(
            { type: 'api_error', message: 'Request timed out' },
            408
          )
        }

        // Retry with exponential backoff
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000)
          await sleep(delay)
        }
      }
    }

    throw lastError ?? new Error('Unknown error')
  }
}

/**
 * Encode an object as form data (Stripe uses application/x-www-form-urlencoded)
 */
function encodeFormData(data: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = []

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue

    const fullKey = prefix ? `${prefix}[${key}]` : key

    if (value === null || value === '') {
      parts.push(`${encodeURIComponent(fullKey)}=`)
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === 'object' && item !== null) {
          parts.push(encodeFormData(item as Record<string, unknown>, `${fullKey}[${index}]`))
        } else {
          parts.push(`${encodeURIComponent(`${fullKey}[${index}]`)}=${encodeURIComponent(String(item))}`)
        }
      })
    } else if (typeof value === 'object') {
      parts.push(encodeFormData(value as Record<string, unknown>, fullKey))
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`)
    }
  }

  return parts.filter((p) => p).join('&')
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// =============================================================================
// Exports
// =============================================================================

export default Stripe
