/**
 * payments.do - Payment Providers
 *
 * Multi-provider payment backend supporting Stripe, Paddle, and LemonSqueezy.
 */

import type {
  PaymentProvider,
  ProviderConfig,
  RoutingRule,
  ProviderResult,
  ProviderError,
  PaymentIntent,
  PaymentIntentCreateParams,
  PaymentIntentConfirmParams,
  PaymentIntentCaptureParams,
  Customer,
  CustomerCreateParams,
  Subscription,
  SubscriptionCreateParams,
  Refund,
  RefundCreateParams,
  Currency,
} from './types'

// =============================================================================
// Provider Interface
// =============================================================================

export interface PaymentProviderAdapter {
  readonly name: PaymentProvider

  // Customers
  createCustomer(params: CustomerCreateParams): Promise<ProviderResult<Customer>>
  getCustomer(id: string): Promise<ProviderResult<Customer>>

  // Payment Intents
  createPaymentIntent(params: PaymentIntentCreateParams): Promise<ProviderResult<PaymentIntent>>
  confirmPaymentIntent(id: string, params?: PaymentIntentConfirmParams): Promise<ProviderResult<PaymentIntent>>
  capturePaymentIntent(id: string, params?: PaymentIntentCaptureParams): Promise<ProviderResult<PaymentIntent>>
  cancelPaymentIntent(id: string): Promise<ProviderResult<PaymentIntent>>

  // Subscriptions
  createSubscription(params: SubscriptionCreateParams): Promise<ProviderResult<Subscription>>
  cancelSubscription(id: string): Promise<ProviderResult<Subscription>>

  // Refunds
  createRefund(params: RefundCreateParams): Promise<ProviderResult<Refund>>

  // Validation
  validateConfig(): Promise<boolean>
}

// =============================================================================
// Stripe Provider
// =============================================================================

export interface StripeProviderConfig {
  secretKey: string
  webhookSecret?: string
  apiVersion?: string
}

export class StripeProvider implements PaymentProviderAdapter {
  readonly name: PaymentProvider = 'stripe'
  private secretKey: string
  private apiVersion: string
  private baseUrl = 'https://api.stripe.com'

  constructor(config: StripeProviderConfig) {
    this.secretKey = config.secretKey
    this.apiVersion = config.apiVersion ?? '2024-12-18.acacia'
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params?: Record<string, unknown>
  ): Promise<ProviderResult<T>> {
    const url = new URL(path, this.baseUrl)

    if (method === 'GET' && params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': this.apiVersion,
    }

    let body: string | undefined
    if ((method === 'POST' || method === 'DELETE') && params) {
      body = this.encodeFormData(params)
    }

    try {
      const response = await fetch(url.toString(), { method, headers, body })
      const data = await response.json()

      if (!response.ok) {
        const error = data as { error: { type: string; message: string; code?: string; decline_code?: string; param?: string } }
        return {
          success: false,
          error: {
            type: error.error.type as ProviderError['type'],
            code: error.error.code,
            message: error.error.message,
            decline_code: error.error.decline_code,
            param: error.error.param,
            retryable: this.isRetryable(error.error.type, response.status),
          },
          provider: 'stripe',
        }
      }

      return { success: true, data: data as T, provider: 'stripe' }
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'network_error',
          message: error instanceof Error ? error.message : 'Network error',
          retryable: true,
        },
        provider: 'stripe',
      }
    }
  }

  private isRetryable(errorType: string, status: number): boolean {
    // Card errors are not retryable
    if (errorType === 'card_error') return false
    // Invalid request errors are not retryable
    if (errorType === 'invalid_request_error') return false
    // Rate limits are retryable
    if (status === 429) return true
    // Server errors are retryable
    if (status >= 500) return true
    return false
  }

  private encodeFormData(data: Record<string, unknown>, prefix = ''): string {
    const parts: string[] = []

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue

      const fullKey = prefix ? `${prefix}[${key}]` : key

      if (value === null || value === '') {
        parts.push(`${encodeURIComponent(fullKey)}=`)
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => {
          if (typeof item === 'object' && item !== null) {
            parts.push(this.encodeFormData(item as Record<string, unknown>, `${fullKey}[${index}]`))
          } else {
            parts.push(`${encodeURIComponent(`${fullKey}[${index}]`)}=${encodeURIComponent(String(item))}`)
          }
        })
      } else if (typeof value === 'object') {
        parts.push(this.encodeFormData(value as Record<string, unknown>, fullKey))
      } else {
        parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`)
      }
    }

    return parts.filter((p) => p).join('&')
  }

  async createCustomer(params: CustomerCreateParams): Promise<ProviderResult<Customer>> {
    const result = await this.request<{
      id: string
      email?: string
      name?: string
      phone?: string
      address?: Record<string, unknown>
      metadata: Record<string, string>
      created: number
      livemode: boolean
      balance: number
      currency?: string
      delinquent: boolean
      default_source?: string
    }>('POST', '/v1/customers', params)

    if (!result.success || !result.data) return result as ProviderResult<Customer>

    return {
      success: true,
      data: {
        id: result.data.id,
        object: 'customer',
        email: result.data.email ?? null,
        name: result.data.name ?? null,
        phone: result.data.phone ?? null,
        address: result.data.address as Customer['address'],
        metadata: result.data.metadata,
        created: result.data.created,
        updated: result.data.created,
        provider_ids: { stripe: result.data.id },
        default_payment_method: result.data.default_source ?? null,
        balance: result.data.balance,
        currency: result.data.currency as Currency ?? null,
        delinquent: result.data.delinquent,
        livemode: result.data.livemode,
      },
      provider: 'stripe',
    }
  }

  async getCustomer(id: string): Promise<ProviderResult<Customer>> {
    const result = await this.request<{
      id: string
      email?: string
      name?: string
      phone?: string
      address?: Record<string, unknown>
      metadata: Record<string, string>
      created: number
      livemode: boolean
      balance: number
      currency?: string
      delinquent: boolean
      default_source?: string
    }>('GET', `/v1/customers/${id}`)

    if (!result.success || !result.data) return result as ProviderResult<Customer>

    return {
      success: true,
      data: {
        id: result.data.id,
        object: 'customer',
        email: result.data.email ?? null,
        name: result.data.name ?? null,
        phone: result.data.phone ?? null,
        address: result.data.address as Customer['address'],
        metadata: result.data.metadata,
        created: result.data.created,
        updated: result.data.created,
        provider_ids: { stripe: result.data.id },
        default_payment_method: result.data.default_source ?? null,
        balance: result.data.balance,
        currency: result.data.currency as Currency ?? null,
        delinquent: result.data.delinquent,
        livemode: result.data.livemode,
      },
      provider: 'stripe',
    }
  }

  async createPaymentIntent(params: PaymentIntentCreateParams): Promise<ProviderResult<PaymentIntent>> {
    const result = await this.request<{
      id: string
      amount: number
      amount_capturable: number
      amount_received: number
      currency: string
      status: string
      customer?: string
      description?: string
      metadata: Record<string, string>
      payment_method?: string
      payment_method_types: string[]
      capture_method: string
      client_secret: string
      created: number
      livemode: boolean
      canceled_at?: number
      cancellation_reason?: string
      last_payment_error?: Record<string, unknown>
      receipt_email?: string
      statement_descriptor?: string
    }>('POST', '/v1/payment_intents', params)

    if (!result.success || !result.data) return result as ProviderResult<PaymentIntent>

    return {
      success: true,
      data: {
        id: result.data.id,
        object: 'payment_intent',
        amount: result.data.amount,
        amount_capturable: result.data.amount_capturable,
        amount_received: result.data.amount_received,
        currency: result.data.currency as Currency,
        status: result.data.status as PaymentIntent['status'],
        customer: result.data.customer ?? null,
        description: result.data.description ?? null,
        metadata: result.data.metadata,
        payment_method: result.data.payment_method ?? null,
        payment_method_types: result.data.payment_method_types,
        capture_method: result.data.capture_method as PaymentIntent['capture_method'],
        client_secret: result.data.client_secret,
        created: result.data.created,
        livemode: result.data.livemode,
        canceled_at: result.data.canceled_at ?? null,
        cancellation_reason: result.data.cancellation_reason as PaymentIntent['cancellation_reason'] ?? null,
        last_payment_error: result.data.last_payment_error as PaymentIntent['last_payment_error'] ?? null,
        provider: 'stripe',
        provider_id: result.data.id,
        receipt_email: result.data.receipt_email ?? null,
        statement_descriptor: result.data.statement_descriptor ?? null,
      },
      provider: 'stripe',
    }
  }

  async confirmPaymentIntent(id: string, params?: PaymentIntentConfirmParams): Promise<ProviderResult<PaymentIntent>> {
    return this.request<PaymentIntent>('POST', `/v1/payment_intents/${id}/confirm`, params)
  }

  async capturePaymentIntent(id: string, params?: PaymentIntentCaptureParams): Promise<ProviderResult<PaymentIntent>> {
    return this.request<PaymentIntent>('POST', `/v1/payment_intents/${id}/capture`, params)
  }

  async cancelPaymentIntent(id: string): Promise<ProviderResult<PaymentIntent>> {
    return this.request<PaymentIntent>('POST', `/v1/payment_intents/${id}/cancel`)
  }

  async createSubscription(params: SubscriptionCreateParams): Promise<ProviderResult<Subscription>> {
    return this.request<Subscription>('POST', '/v1/subscriptions', params)
  }

  async cancelSubscription(id: string): Promise<ProviderResult<Subscription>> {
    return this.request<Subscription>('DELETE', `/v1/subscriptions/${id}`)
  }

  async createRefund(params: RefundCreateParams): Promise<ProviderResult<Refund>> {
    return this.request<Refund>('POST', '/v1/refunds', params)
  }

  async validateConfig(): Promise<boolean> {
    if (!this.secretKey || !this.secretKey.startsWith('sk_')) {
      return false
    }
    return true
  }
}

// =============================================================================
// Paddle Provider (EU/VAT handling)
// =============================================================================

export interface PaddleProviderConfig {
  vendorId: string
  authCode: string
  sandbox?: boolean
}

export class PaddleProvider implements PaymentProviderAdapter {
  readonly name: PaymentProvider = 'paddle'
  private vendorId: string
  private authCode: string
  private baseUrl: string

  constructor(config: PaddleProviderConfig) {
    this.vendorId = config.vendorId
    this.authCode = config.authCode
    this.baseUrl = config.sandbox
      ? 'https://sandbox-vendors.paddle.com/api'
      : 'https://vendors.paddle.com/api'
  }

  private async request<T>(
    path: string,
    params: Record<string, unknown>
  ): Promise<ProviderResult<T>> {
    const url = new URL(path, this.baseUrl)

    const body = new URLSearchParams({
      vendor_id: this.vendorId,
      vendor_auth_code: this.authCode,
      ...Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      ),
    })

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })

      const data = await response.json() as { success: boolean; response?: T; error?: { code: number; message: string } }

      if (!data.success) {
        return {
          success: false,
          error: {
            type: 'api_error',
            code: String(data.error?.code),
            message: data.error?.message || 'Paddle API error',
            retryable: false,
          },
          provider: 'paddle',
        }
      }

      return { success: true, data: data.response as T, provider: 'paddle' }
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'network_error',
          message: error instanceof Error ? error.message : 'Network error',
          retryable: true,
        },
        provider: 'paddle',
      }
    }
  }

  async createCustomer(params: CustomerCreateParams): Promise<ProviderResult<Customer>> {
    // Paddle uses different customer creation flow
    const result = await this.request<{ customer_id: string }>('/2.0/subscription/users/create', {
      email: params.email,
      marketing_consent: 0,
    })

    if (!result.success || !result.data) return result as ProviderResult<Customer>

    return {
      success: true,
      data: {
        id: `paddle_${result.data.customer_id}`,
        object: 'customer',
        email: params.email ?? null,
        name: params.name ?? null,
        phone: params.phone ?? null,
        address: params.address ?? null,
        metadata: params.metadata ?? {},
        created: Math.floor(Date.now() / 1000),
        updated: Math.floor(Date.now() / 1000),
        provider_ids: { paddle: result.data.customer_id },
        default_payment_method: null,
        balance: 0,
        currency: null,
        delinquent: false,
        livemode: !this.baseUrl.includes('sandbox'),
      },
      provider: 'paddle',
    }
  }

  async getCustomer(id: string): Promise<ProviderResult<Customer>> {
    const paddleId = id.replace('paddle_', '')
    const result = await this.request<{ customer_id: string; email: string }>('/2.0/subscription/users', {
      customer_id: paddleId,
    })

    if (!result.success || !result.data) return result as ProviderResult<Customer>

    return {
      success: true,
      data: {
        id: `paddle_${result.data.customer_id}`,
        object: 'customer',
        email: result.data.email ?? null,
        name: null,
        phone: null,
        address: null,
        metadata: {},
        created: Math.floor(Date.now() / 1000),
        updated: Math.floor(Date.now() / 1000),
        provider_ids: { paddle: result.data.customer_id },
        default_payment_method: null,
        balance: 0,
        currency: null,
        delinquent: false,
        livemode: !this.baseUrl.includes('sandbox'),
      },
      provider: 'paddle',
    }
  }

  async createPaymentIntent(_params: PaymentIntentCreateParams): Promise<ProviderResult<PaymentIntent>> {
    // Paddle uses a different payment flow (pay links)
    // This would generate a pay link instead
    return {
      success: false,
      error: {
        type: 'api_error',
        message: 'Paddle uses pay links instead of payment intents',
        retryable: false,
      },
      provider: 'paddle',
    }
  }

  async confirmPaymentIntent(_id: string, _params?: PaymentIntentConfirmParams): Promise<ProviderResult<PaymentIntent>> {
    return {
      success: false,
      error: {
        type: 'api_error',
        message: 'Paddle handles confirmation through pay links',
        retryable: false,
      },
      provider: 'paddle',
    }
  }

  async capturePaymentIntent(_id: string, _params?: PaymentIntentCaptureParams): Promise<ProviderResult<PaymentIntent>> {
    return {
      success: false,
      error: {
        type: 'api_error',
        message: 'Paddle handles capture automatically',
        retryable: false,
      },
      provider: 'paddle',
    }
  }

  async cancelPaymentIntent(_id: string): Promise<ProviderResult<PaymentIntent>> {
    return {
      success: false,
      error: {
        type: 'api_error',
        message: 'Paddle does not support payment intent cancellation',
        retryable: false,
      },
      provider: 'paddle',
    }
  }

  async createSubscription(params: SubscriptionCreateParams): Promise<ProviderResult<Subscription>> {
    // Paddle subscription creation requires a pay link
    // This is a simplified implementation
    const result = await this.request<{ subscription_id: string }>('/2.1/subscription/users', {
      customer_id: params.customer,
    })

    if (!result.success) return result as ProviderResult<Subscription>

    const now = Math.floor(Date.now() / 1000)
    return {
      success: true,
      data: {
        id: `paddle_sub_${result.data?.subscription_id}`,
        object: 'subscription',
        customer: params.customer,
        status: 'active',
        items: [],
        current_period_start: now,
        current_period_end: now + 30 * 24 * 60 * 60,
        cancel_at_period_end: false,
        canceled_at: null,
        ended_at: null,
        trial_start: null,
        trial_end: null,
        metadata: params.metadata ?? {},
        default_payment_method: null,
        collection_method: 'charge_automatically',
        created: now,
        livemode: !this.baseUrl.includes('sandbox'),
        provider: 'paddle',
        provider_id: result.data?.subscription_id,
      },
      provider: 'paddle',
    }
  }

  async cancelSubscription(id: string): Promise<ProviderResult<Subscription>> {
    const paddleId = id.replace('paddle_sub_', '')
    return this.request<Subscription>('/2.0/subscription/users_cancel', {
      subscription_id: paddleId,
    })
  }

  async createRefund(params: RefundCreateParams): Promise<ProviderResult<Refund>> {
    const result = await this.request<{ refund_id: string }>('/2.0/payment/refund', {
      order_id: params.payment_intent,
      amount: params.amount,
      reason: params.reason,
    })

    if (!result.success) return result as ProviderResult<Refund>

    return {
      success: true,
      data: {
        id: `paddle_re_${result.data?.refund_id}`,
        object: 'refund',
        amount: params.amount ?? 0,
        currency: 'usd',
        payment_intent: params.payment_intent,
        status: 'succeeded',
        reason: params.reason ?? null,
        created: Math.floor(Date.now() / 1000),
        metadata: params.metadata ?? {},
      },
      provider: 'paddle',
    }
  }

  async validateConfig(): Promise<boolean> {
    if (!this.vendorId || !this.authCode) {
      return false
    }
    return true
  }
}

// =============================================================================
// LemonSqueezy Provider (Digital products)
// =============================================================================

export interface LemonSqueezyProviderConfig {
  apiKey: string
  storeId: string
}

export class LemonSqueezyProvider implements PaymentProviderAdapter {
  readonly name: PaymentProvider = 'lemonsqueezy'
  private apiKey: string
  private storeId: string
  private baseUrl = 'https://api.lemonsqueezy.com/v1'

  constructor(config: LemonSqueezyProviderConfig) {
    this.apiKey = config.apiKey
    this.storeId = config.storeId
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    path: string,
    params?: Record<string, unknown>
  ): Promise<ProviderResult<T>> {
    const url = new URL(path, this.baseUrl)

    try {
      const response = await fetch(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/vnd.api+json',
          Accept: 'application/vnd.api+json',
        },
        body: params ? JSON.stringify({ data: params }) : undefined,
      })

      const data = await response.json() as { data?: T; errors?: Array<{ title: string; detail: string }> }

      if (!response.ok) {
        return {
          success: false,
          error: {
            type: 'api_error',
            message: data.errors?.[0]?.detail || 'LemonSqueezy API error',
            retryable: response.status >= 500,
          },
          provider: 'lemonsqueezy',
        }
      }

      return { success: true, data: data.data as T, provider: 'lemonsqueezy' }
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'network_error',
          message: error instanceof Error ? error.message : 'Network error',
          retryable: true,
        },
        provider: 'lemonsqueezy',
      }
    }
  }

  async createCustomer(params: CustomerCreateParams): Promise<ProviderResult<Customer>> {
    const result = await this.request<{ id: string; attributes: { email: string; name: string } }>(
      'POST',
      '/customers',
      {
        type: 'customers',
        attributes: {
          email: params.email,
          name: params.name,
        },
        relationships: {
          store: {
            data: { type: 'stores', id: this.storeId },
          },
        },
      }
    )

    if (!result.success || !result.data) return result as ProviderResult<Customer>

    return {
      success: true,
      data: {
        id: `ls_${result.data.id}`,
        object: 'customer',
        email: result.data.attributes.email ?? null,
        name: result.data.attributes.name ?? null,
        phone: null,
        address: null,
        metadata: params.metadata ?? {},
        created: Math.floor(Date.now() / 1000),
        updated: Math.floor(Date.now() / 1000),
        provider_ids: { lemonsqueezy: result.data.id },
        default_payment_method: null,
        balance: 0,
        currency: null,
        delinquent: false,
        livemode: true,
      },
      provider: 'lemonsqueezy',
    }
  }

  async getCustomer(id: string): Promise<ProviderResult<Customer>> {
    const lsId = id.replace('ls_', '')
    return this.request<Customer>('GET', `/customers/${lsId}`)
  }

  async createPaymentIntent(_params: PaymentIntentCreateParams): Promise<ProviderResult<PaymentIntent>> {
    // LemonSqueezy uses checkout links
    return {
      success: false,
      error: {
        type: 'api_error',
        message: 'LemonSqueezy uses checkout links instead of payment intents',
        retryable: false,
      },
      provider: 'lemonsqueezy',
    }
  }

  async confirmPaymentIntent(_id: string, _params?: PaymentIntentConfirmParams): Promise<ProviderResult<PaymentIntent>> {
    return {
      success: false,
      error: {
        type: 'api_error',
        message: 'LemonSqueezy handles confirmation through checkout',
        retryable: false,
      },
      provider: 'lemonsqueezy',
    }
  }

  async capturePaymentIntent(_id: string, _params?: PaymentIntentCaptureParams): Promise<ProviderResult<PaymentIntent>> {
    return {
      success: false,
      error: {
        type: 'api_error',
        message: 'LemonSqueezy handles capture automatically',
        retryable: false,
      },
      provider: 'lemonsqueezy',
    }
  }

  async cancelPaymentIntent(_id: string): Promise<ProviderResult<PaymentIntent>> {
    return {
      success: false,
      error: {
        type: 'api_error',
        message: 'LemonSqueezy does not support payment intent cancellation',
        retryable: false,
      },
      provider: 'lemonsqueezy',
    }
  }

  async createSubscription(params: SubscriptionCreateParams): Promise<ProviderResult<Subscription>> {
    const result = await this.request<{ id: string; attributes: { status: string; created_at: string } }>(
      'POST',
      '/subscriptions',
      {
        type: 'subscriptions',
        attributes: {
          customer_id: params.customer.replace('ls_', ''),
        },
      }
    )

    if (!result.success || !result.data) return result as ProviderResult<Subscription>

    const now = Math.floor(Date.now() / 1000)
    return {
      success: true,
      data: {
        id: `ls_sub_${result.data.id}`,
        object: 'subscription',
        customer: params.customer,
        status: result.data.attributes.status as Subscription['status'],
        items: [],
        current_period_start: now,
        current_period_end: now + 30 * 24 * 60 * 60,
        cancel_at_period_end: false,
        canceled_at: null,
        ended_at: null,
        trial_start: null,
        trial_end: null,
        metadata: params.metadata ?? {},
        default_payment_method: null,
        collection_method: 'charge_automatically',
        created: now,
        livemode: true,
        provider: 'lemonsqueezy',
        provider_id: result.data.id,
      },
      provider: 'lemonsqueezy',
    }
  }

  async cancelSubscription(id: string): Promise<ProviderResult<Subscription>> {
    const lsId = id.replace('ls_sub_', '')
    return this.request<Subscription>('DELETE', `/subscriptions/${lsId}`)
  }

  async createRefund(params: RefundCreateParams): Promise<ProviderResult<Refund>> {
    // LemonSqueezy refunds are done through orders
    const result = await this.request<{ id: string }>('POST', '/refunds', {
      type: 'refunds',
      attributes: {
        order_id: params.payment_intent,
        amount: params.amount,
      },
    })

    if (!result.success) return result as ProviderResult<Refund>

    return {
      success: true,
      data: {
        id: `ls_re_${result.data?.id}`,
        object: 'refund',
        amount: params.amount ?? 0,
        currency: 'usd',
        payment_intent: params.payment_intent,
        status: 'succeeded',
        reason: params.reason ?? null,
        created: Math.floor(Date.now() / 1000),
        metadata: params.metadata ?? {},
      },
      provider: 'lemonsqueezy',
    }
  }

  async validateConfig(): Promise<boolean> {
    if (!this.apiKey || !this.storeId) {
      return false
    }
    return true
  }
}

// =============================================================================
// Payment Router (Multi-provider with routing & failover)
// =============================================================================

export interface PaymentRouterConfig {
  providers: ProviderConfig[]
  defaultProvider: PaymentProvider
  rules?: RoutingRule[]
  retryOnFail?: boolean
  maxRetries?: number
}

interface CircuitBreakerState {
  failures: number
  successes: number
  lastFailure: number | null
  state: 'closed' | 'open' | 'half_open'
  openedAt: number | null
}

export class PaymentRouter {
  private providers: Map<PaymentProvider, PaymentProviderAdapter> = new Map()
  private config: PaymentRouterConfig
  private circuitBreakers: Map<PaymentProvider, CircuitBreakerState> = new Map()
  private readonly circuitBreakerThreshold = 0.5
  private readonly circuitBreakerResetTime = 30000 // 30 seconds

  constructor(config: PaymentRouterConfig) {
    this.config = config
    this.initializeProviders()
    this.initializeCircuitBreakers()
  }

  private initializeProviders(): void {
    for (const providerConfig of this.config.providers) {
      if (!providerConfig.enabled) continue

      switch (providerConfig.provider) {
        case 'stripe':
          if (providerConfig.secretKey) {
            this.providers.set(
              'stripe',
              new StripeProvider({ secretKey: providerConfig.secretKey })
            )
          }
          break
        case 'paddle':
          if (providerConfig.apiKey && providerConfig.secretKey) {
            this.providers.set(
              'paddle',
              new PaddleProvider({
                vendorId: providerConfig.apiKey,
                authCode: providerConfig.secretKey,
                sandbox: providerConfig.sandbox,
              })
            )
          }
          break
        case 'lemonsqueezy':
          if (providerConfig.apiKey && providerConfig.secretKey) {
            this.providers.set(
              'lemonsqueezy',
              new LemonSqueezyProvider({
                apiKey: providerConfig.apiKey,
                storeId: providerConfig.secretKey,
              })
            )
          }
          break
      }
    }
  }

  private initializeCircuitBreakers(): void {
    for (const provider of this.providers.keys()) {
      this.circuitBreakers.set(provider, {
        failures: 0,
        successes: 0,
        lastFailure: null,
        state: 'closed',
        openedAt: null,
      })
    }
  }

  private getCircuitState(provider: PaymentProvider): CircuitBreakerState {
    const state = this.circuitBreakers.get(provider)
    if (!state) {
      return { failures: 0, successes: 0, lastFailure: null, state: 'closed', openedAt: null }
    }

    // Check if circuit should transition from open to half-open
    if (state.state === 'open' && state.openedAt) {
      if (Date.now() - state.openedAt > this.circuitBreakerResetTime) {
        state.state = 'half_open'
      }
    }

    return state
  }

  private recordSuccess(provider: PaymentProvider): void {
    const state = this.circuitBreakers.get(provider)
    if (state) {
      state.successes++
      if (state.state === 'half_open') {
        state.state = 'closed'
        state.failures = 0
      }
    }
  }

  private recordFailure(provider: PaymentProvider): void {
    const state = this.circuitBreakers.get(provider)
    if (state) {
      state.failures++
      state.lastFailure = Date.now()

      const total = state.failures + state.successes
      if (total >= 10 && state.failures / total > this.circuitBreakerThreshold) {
        state.state = 'open'
        state.openedAt = Date.now()
      }
    }
  }

  private isCircuitOpen(provider: PaymentProvider): boolean {
    const state = this.getCircuitState(provider)
    return state.state === 'open'
  }

  /**
   * Select provider based on routing rules
   */
  selectProvider(context: {
    currency?: Currency
    country?: string
    amount?: number
    productType?: 'physical' | 'digital' | 'subscription' | 'service'
  }): PaymentProvider {
    if (!this.config.rules) {
      return this.config.defaultProvider
    }

    for (const rule of this.config.rules) {
      if (this.matchesCondition(rule.condition, context)) {
        // Check if provider is available
        if (this.providers.has(rule.provider) && !this.isCircuitOpen(rule.provider)) {
          return rule.provider
        }
      }
    }

    return this.config.defaultProvider
  }

  private matchesCondition(
    condition: RoutingRule['condition'],
    context: {
      currency?: Currency
      country?: string
      amount?: number
      productType?: 'physical' | 'digital' | 'subscription' | 'service'
    }
  ): boolean {
    switch (condition.type) {
      case 'currency':
        return context.currency ? condition.currencies.includes(context.currency) : false
      case 'country':
        return context.country ? condition.countries.includes(context.country) : false
      case 'amount':
        if (context.amount === undefined) return false
        if (condition.min !== undefined && context.amount < condition.min) return false
        if (condition.max !== undefined && context.amount > condition.max) return false
        return true
      case 'product_type':
        return context.productType ? condition.types.includes(context.productType) : false
      case 'always':
        return true
    }
  }

  /**
   * Get sorted providers by priority for failover
   */
  private getSortedProviders(): PaymentProvider[] {
    return [...this.config.providers]
      .filter((p) => p.enabled && this.providers.has(p.provider))
      .sort((a, b) => (a.priority || 99) - (b.priority || 99))
      .map((p) => p.provider)
  }

  /**
   * Execute operation with failover support
   */
  async execute<T>(
    operation: (provider: PaymentProviderAdapter) => Promise<ProviderResult<T>>,
    preferredProvider?: PaymentProvider
  ): Promise<ProviderResult<T>> {
    const providers = this.getSortedProviders()
    const startWith = preferredProvider && this.providers.has(preferredProvider)
      ? preferredProvider
      : providers[0]

    // Try preferred provider first
    if (startWith && !this.isCircuitOpen(startWith)) {
      const provider = this.providers.get(startWith)
      if (provider) {
        const result = await operation(provider)
        if (result.success) {
          this.recordSuccess(startWith)
          return result
        }
        this.recordFailure(startWith)

        // Don't retry if error is not retryable
        if (result.error && !result.error.retryable) {
          return result
        }
      }
    }

    // Failover to other providers
    if (this.config.retryOnFail) {
      for (const providerName of providers) {
        if (providerName === startWith) continue
        if (this.isCircuitOpen(providerName)) continue

        const provider = this.providers.get(providerName)
        if (!provider) continue

        const result = await operation(provider)
        if (result.success) {
          this.recordSuccess(providerName)
          return result
        }
        this.recordFailure(providerName)

        // Don't continue if error is not retryable
        if (result.error && !result.error.retryable) {
          return result
        }
      }
    }

    return {
      success: false,
      error: {
        type: 'api_error',
        message: 'All providers failed',
        retryable: false,
      },
      provider: startWith || this.config.defaultProvider,
    }
  }

  getProvider(name: PaymentProvider): PaymentProviderAdapter | undefined {
    return this.providers.get(name)
  }

  listProviders(): PaymentProvider[] {
    return Array.from(this.providers.keys())
  }

  getCircuitBreakerStats(): Record<PaymentProvider, CircuitBreakerState> {
    const stats: Record<string, CircuitBreakerState> = {}
    for (const [provider, state] of this.circuitBreakers) {
      stats[provider] = { ...state }
    }
    return stats as Record<PaymentProvider, CircuitBreakerState>
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createProvider(config: ProviderConfig): PaymentProviderAdapter | null {
  switch (config.provider) {
    case 'stripe':
      if (!config.secretKey) return null
      return new StripeProvider({ secretKey: config.secretKey })
    case 'paddle':
      if (!config.apiKey || !config.secretKey) return null
      return new PaddleProvider({
        vendorId: config.apiKey,
        authCode: config.secretKey,
        sandbox: config.sandbox,
      })
    case 'lemonsqueezy':
      if (!config.apiKey || !config.secretKey) return null
      return new LemonSqueezyProvider({
        apiKey: config.apiKey,
        storeId: config.secretKey,
      })
    default:
      return null
  }
}
