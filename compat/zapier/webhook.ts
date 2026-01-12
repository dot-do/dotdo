/**
 * Zapier Webhook Integration
 *
 * Handles webhook subscriptions, payloads, and responses.
 */

import type {
  Bundle,
  ZObject,
  WebhookSubscription,
  WebhookHandlerResult,
  HookTriggerConfig,
  RawRequest,
} from './types'

// ============================================================================
// WEBHOOK HANDLER
// ============================================================================

/**
 * Webhook request handler for incoming webhooks
 */
export class WebhookHandler {
  private subscriptions = new Map<string, WebhookSubscription>()

  /**
   * Register a webhook subscription
   */
  registerSubscription(subscription: WebhookSubscription): void {
    this.subscriptions.set(subscription.id, subscription)
  }

  /**
   * Unregister a webhook subscription
   */
  unregisterSubscription(id: string): boolean {
    return this.subscriptions.delete(id)
  }

  /**
   * Get subscription by ID
   */
  getSubscription(id: string): WebhookSubscription | undefined {
    return this.subscriptions.get(id)
  }

  /**
   * Get all subscriptions
   */
  getAllSubscriptions(): WebhookSubscription[] {
    return Array.from(this.subscriptions.values())
  }

  /**
   * Handle incoming webhook request
   */
  async handleRequest(
    request: Request,
    trigger: HookTriggerConfig,
    z: ZObject,
    authData: Record<string, unknown> = {}
  ): Promise<WebhookHandlerResult> {
    // Parse request
    const url = new URL(request.url)
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })

    // Parse body based on content type
    const contentType = headers['content-type'] || ''
    let cleanedRequest: Record<string, unknown> = {}

    if (contentType.includes('application/json')) {
      try {
        cleanedRequest = (await request.json()) as Record<string, unknown>
      } catch {
        cleanedRequest = {}
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await request.text()
      const params = new URLSearchParams(text)
      params.forEach((value, key) => {
        cleanedRequest[key] = value
      })
    } else if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      formData.forEach((value, key) => {
        cleanedRequest[key] = value
      })
    } else {
      // Try to parse as JSON anyway
      try {
        const text = await request.text()
        if (text) {
          cleanedRequest = JSON.parse(text)
        }
      } catch {
        cleanedRequest = {}
      }
    }

    // Build raw request object
    const rawRequest: RawRequest = {
      method: request.method,
      headers,
      content: JSON.stringify(cleanedRequest),
      querystring: url.search.slice(1),
    }

    // Build bundle
    const bundle: Bundle = {
      inputData: {},
      authData,
      cleanedRequest,
      rawRequest,
    }

    // Execute trigger perform
    const data = await trigger.operation.perform(z, bundle)

    return {
      data,
      status: 200,
    }
  }

  /**
   * Validate webhook signature (HMAC)
   */
  validateSignature(
    payload: string,
    signature: string,
    secret: string,
    algorithm: 'sha256' | 'sha1' = 'sha256'
  ): boolean {
    return validateHmacSignature(payload, signature, secret, algorithm)
  }
}

// ============================================================================
// WEBHOOK SUBSCRIPTION MANAGER
// ============================================================================

/**
 * Manages webhook subscriptions lifecycle
 */
export class WebhookSubscriptionManager {
  private subscriptions = new Map<string, WebhookSubscription>()
  private storage?: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<void>
  }

  constructor(storage?: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<void>
  }) {
    this.storage = storage
  }

  /**
   * Create a webhook subscription
   */
  async subscribe(
    trigger: HookTriggerConfig,
    z: ZObject,
    bundle: Bundle
  ): Promise<WebhookSubscription> {
    const result = await trigger.operation.performSubscribe(z, bundle)

    const subscription: WebhookSubscription = {
      id: result.id,
      targetUrl: bundle.targetUrl || '',
      event: bundle.inputData.event as string,
      createdAt: Date.now(),
      metadata: result,
    }

    this.subscriptions.set(subscription.id, subscription)

    if (this.storage) {
      await this.storage.set(`webhook:${subscription.id}`, subscription)
    }

    return subscription
  }

  /**
   * Remove a webhook subscription
   */
  async unsubscribe(
    trigger: HookTriggerConfig,
    z: ZObject,
    bundle: Bundle
  ): Promise<void> {
    await trigger.operation.performUnsubscribe(z, bundle)

    const subscriptionId = (bundle.subscribeData as { id?: string })?.id
    if (subscriptionId) {
      this.subscriptions.delete(subscriptionId)

      if (this.storage) {
        await this.storage.delete(`webhook:${subscriptionId}`)
      }
    }
  }

  /**
   * Get a subscription by ID
   */
  async getSubscription(id: string): Promise<WebhookSubscription | undefined> {
    const cached = this.subscriptions.get(id)
    if (cached) {
      return cached
    }

    if (this.storage) {
      const stored = (await this.storage.get(
        `webhook:${id}`
      )) as WebhookSubscription | null
      if (stored) {
        this.subscriptions.set(id, stored)
        return stored
      }
    }

    return undefined
  }

  /**
   * List all subscriptions
   */
  getAllSubscriptions(): WebhookSubscription[] {
    return Array.from(this.subscriptions.values())
  }

  /**
   * Check if subscription exists
   */
  hasSubscription(id: string): boolean {
    return this.subscriptions.has(id)
  }

  /**
   * Load subscriptions from storage
   */
  async loadFromStorage(): Promise<void> {
    // Would need to implement listing keys from storage
    // For now, just use in-memory cache
  }
}

// ============================================================================
// WEBHOOK UTILITIES
// ============================================================================

/**
 * Validate HMAC signature
 */
export async function validateHmacSignature(
  payload: string,
  signature: string,
  secret: string,
  algorithm: 'sha256' | 'sha1' = 'sha256'
): Promise<boolean> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const payloadData = encoder.encode(payload)

  const cryptoAlgorithm = algorithm === 'sha256' ? 'SHA-256' : 'SHA-1'

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: cryptoAlgorithm },
    false,
    ['sign']
  )

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, payloadData)
  const computedSignature = arrayBufferToHex(signatureBuffer)

  // Handle different signature formats
  const cleanSignature = signature
    .replace(/^sha256=/, '')
    .replace(/^sha1=/, '')
    .toLowerCase()

  return computedSignature === cleanSignature
}

/**
 * Convert ArrayBuffer to hex string
 */
function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generate webhook verification token
 */
export function generateVerificationToken(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return arrayBufferToHex(array.buffer)
}

/**
 * Parse webhook event type from payload
 */
export function parseEventType(
  payload: Record<string, unknown>,
  eventField = 'event'
): string | undefined {
  if (typeof payload[eventField] === 'string') {
    return payload[eventField] as string
  }

  // Common patterns
  if (payload.type && typeof payload.type === 'string') {
    return payload.type
  }

  if (
    payload.event_type &&
    typeof payload.event_type === 'string'
  ) {
    return payload.event_type
  }

  if (payload.action && typeof payload.action === 'string') {
    return payload.action
  }

  return undefined
}

/**
 * Extract data from webhook payload
 */
export function extractWebhookData(
  payload: Record<string, unknown>,
  dataField?: string
): unknown {
  if (dataField && payload[dataField] !== undefined) {
    return payload[dataField]
  }

  // Common data field names
  const commonFields = ['data', 'payload', 'object', 'resource', 'body']

  for (const field of commonFields) {
    if (payload[field] !== undefined) {
      return payload[field]
    }
  }

  // Return entire payload if no data field found
  return payload
}

/**
 * Create webhook response
 */
export function createWebhookResponse(
  status: number,
  body?: unknown,
  headers?: Record<string, string>
): Response {
  const responseHeaders = new Headers({
    'Content-Type': 'application/json',
    ...headers,
  })

  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: responseHeaders,
  })
}

/**
 * Create success response for webhook
 */
export function webhookSuccess(
  data?: unknown,
  message = 'OK'
): Response {
  return createWebhookResponse(200, { success: true, message, data })
}

/**
 * Create error response for webhook
 */
export function webhookError(
  status: number,
  message: string,
  code?: string
): Response {
  return createWebhookResponse(status, { success: false, error: message, code })
}

// ============================================================================
// WEBHOOK RETRY HANDLING
// ============================================================================

/**
 * Webhook delivery status
 */
export interface WebhookDelivery {
  id: string
  webhookId: string
  payload: unknown
  status: 'pending' | 'delivered' | 'failed'
  attempts: number
  maxAttempts: number
  lastAttemptAt?: number
  nextAttemptAt?: number
  error?: string
  responseStatus?: number
  createdAt: number
}

/**
 * Webhook retry manager
 */
export class WebhookRetryManager {
  private deliveries = new Map<string, WebhookDelivery>()
  private maxAttempts = 5
  private backoffMs = [0, 60000, 300000, 900000, 3600000] // 0, 1min, 5min, 15min, 1hr

  /**
   * Record a delivery attempt
   */
  recordAttempt(
    deliveryId: string,
    success: boolean,
    responseStatus?: number,
    error?: string
  ): WebhookDelivery {
    const delivery = this.deliveries.get(deliveryId)
    if (!delivery) {
      throw new Error(`Delivery ${deliveryId} not found`)
    }

    delivery.attempts++
    delivery.lastAttemptAt = Date.now()

    if (success) {
      delivery.status = 'delivered'
      delivery.responseStatus = responseStatus
    } else {
      delivery.error = error
      delivery.responseStatus = responseStatus

      if (delivery.attempts >= delivery.maxAttempts) {
        delivery.status = 'failed'
      } else {
        const backoffIndex = Math.min(
          delivery.attempts,
          this.backoffMs.length - 1
        )
        delivery.nextAttemptAt = Date.now() + this.backoffMs[backoffIndex]
      }
    }

    return delivery
  }

  /**
   * Create a new delivery
   */
  createDelivery(
    webhookId: string,
    payload: unknown
  ): WebhookDelivery {
    const delivery: WebhookDelivery = {
      id: crypto.randomUUID(),
      webhookId,
      payload,
      status: 'pending',
      attempts: 0,
      maxAttempts: this.maxAttempts,
      createdAt: Date.now(),
    }

    this.deliveries.set(delivery.id, delivery)
    return delivery
  }

  /**
   * Get deliveries pending retry
   */
  getPendingRetries(): WebhookDelivery[] {
    const now = Date.now()
    return Array.from(this.deliveries.values()).filter(
      (d) =>
        d.status === 'pending' &&
        (!d.nextAttemptAt || d.nextAttemptAt <= now)
    )
  }

  /**
   * Get delivery by ID
   */
  getDelivery(id: string): WebhookDelivery | undefined {
    return this.deliveries.get(id)
  }

  /**
   * Get all deliveries for a webhook
   */
  getDeliveriesForWebhook(webhookId: string): WebhookDelivery[] {
    return Array.from(this.deliveries.values()).filter(
      (d) => d.webhookId === webhookId
    )
  }

  /**
   * Clean up old deliveries
   */
  cleanup(maxAge = 86400000): number {
    const cutoff = Date.now() - maxAge
    let cleaned = 0

    for (const [id, delivery] of this.deliveries) {
      if (
        delivery.createdAt < cutoff &&
        (delivery.status === 'delivered' || delivery.status === 'failed')
      ) {
        this.deliveries.delete(id)
        cleaned++
      }
    }

    return cleaned
  }
}
