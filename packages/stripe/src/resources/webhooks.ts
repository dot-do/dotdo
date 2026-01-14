/**
 * Stripe Webhooks Resource - Local Implementation
 *
 * Handles webhook event generation, signature verification, and delivery.
 */

import type { WebhookEvent, WebhookEventType } from '../types'

export interface WebhookEndpoint {
  id: string
  url: string
  secret: string
  enabled_events: string[]
  status: 'enabled' | 'disabled'
  created: number
  metadata: Record<string, string>
}

export interface WebhookDeliveryAttempt {
  id: string
  event_id: string
  endpoint_id: string
  status: 'pending' | 'succeeded' | 'failed'
  response_status?: number
  response_body?: string
  created: number
  delivered_at?: number
  error_message?: string
}

export interface WebhooksResourceOptions {
  /** Default tolerance for signature verification (seconds) */
  defaultTolerance?: number
  /** Callback for delivering events */
  onDeliver?: (endpoint: WebhookEndpoint, event: WebhookEvent) => Promise<{ status: number; body?: string }>
}

/**
 * Webhooks utility for signature verification and event generation
 */
export class LocalWebhooksResource {
  private endpoints: Map<string, WebhookEndpoint> = new Map()
  private events: Map<string, WebhookEvent> = new Map()
  private deliveryAttempts: Map<string, WebhookDeliveryAttempt[]> = new Map()
  private eventQueue: WebhookEvent[] = []
  private defaultTolerance: number
  private onDeliver?: (endpoint: WebhookEndpoint, event: WebhookEvent) => Promise<{ status: number; body?: string }>

  constructor(options?: WebhooksResourceOptions) {
    this.defaultTolerance = options?.defaultTolerance ?? 300 // 5 minutes
    this.onDeliver = options?.onDeliver
  }

  // ==========================================================================
  // Webhook Endpoints Management
  // ==========================================================================

  /**
   * Create a webhook endpoint
   */
  async createEndpoint(params: {
    url: string
    enabled_events: string[]
    metadata?: Record<string, string>
  }): Promise<WebhookEndpoint> {
    const id = `we_${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`
    const secret = `whsec_${crypto.randomUUID().replace(/-/g, '')}`

    const endpoint: WebhookEndpoint = {
      id,
      url: params.url,
      secret,
      enabled_events: params.enabled_events,
      status: 'enabled',
      created: Math.floor(Date.now() / 1000),
      metadata: params.metadata ?? {},
    }

    this.endpoints.set(id, endpoint)
    return endpoint
  }

  /**
   * Retrieve a webhook endpoint
   */
  async retrieveEndpoint(id: string): Promise<WebhookEndpoint> {
    const endpoint = this.endpoints.get(id)
    if (!endpoint) {
      throw this.createError('resource_missing', `No such webhook endpoint: '${id}'`, 'id')
    }
    return endpoint
  }

  /**
   * Update a webhook endpoint
   */
  async updateEndpoint(
    id: string,
    params: {
      url?: string
      enabled_events?: string[]
      disabled?: boolean
      metadata?: Record<string, string>
    }
  ): Promise<WebhookEndpoint> {
    const existing = await this.retrieveEndpoint(id)

    const updated: WebhookEndpoint = {
      ...existing,
      url: params.url ?? existing.url,
      enabled_events: params.enabled_events ?? existing.enabled_events,
      status: params.disabled !== undefined ? (params.disabled ? 'disabled' : 'enabled') : existing.status,
      metadata: params.metadata ?? existing.metadata,
    }

    this.endpoints.set(id, updated)
    return updated
  }

  /**
   * Delete a webhook endpoint
   */
  async deleteEndpoint(id: string): Promise<{ id: string; object: 'webhook_endpoint'; deleted: true }> {
    await this.retrieveEndpoint(id)
    this.endpoints.delete(id)
    return { id, object: 'webhook_endpoint', deleted: true }
  }

  /**
   * List webhook endpoints
   */
  async listEndpoints(params?: {
    limit?: number
    starting_after?: string
  }): Promise<{ object: 'list'; data: WebhookEndpoint[]; has_more: boolean }> {
    const limit = Math.min(params?.limit ?? 10, 100)
    let endpoints = Array.from(this.endpoints.values())

    endpoints.sort((a, b) => b.created - a.created)

    let startIndex = 0
    if (params?.starting_after) {
      const idx = endpoints.findIndex((e) => e.id === params.starting_after)
      if (idx !== -1) startIndex = idx + 1
    }

    const page = endpoints.slice(startIndex, startIndex + limit)

    return {
      object: 'list',
      data: page,
      has_more: startIndex + limit < endpoints.length,
    }
  }

  // ==========================================================================
  // Event Generation
  // ==========================================================================

  /**
   * Generate a webhook event
   */
  createEvent(type: WebhookEventType, data: unknown, previousAttributes?: Record<string, unknown>): WebhookEvent {
    const id = `evt_${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`
    const now = Math.floor(Date.now() / 1000)

    const event: WebhookEvent = {
      id,
      object: 'event',
      api_version: '2024-12-18.acacia',
      created: now,
      data: {
        object: data,
        previous_attributes: previousAttributes,
      },
      livemode: false,
      pending_webhooks: this.endpoints.size,
      request: {
        id: `req_${crypto.randomUUID().replace(/-/g, '').substring(0, 14)}`,
        idempotency_key: null,
      },
      type,
    }

    this.events.set(id, event)
    this.eventQueue.push(event)
    return event
  }

  /**
   * Retrieve an event
   */
  async retrieveEvent(id: string): Promise<WebhookEvent> {
    const event = this.events.get(id)
    if (!event) {
      throw this.createError('resource_missing', `No such event: '${id}'`, 'id')
    }
    return event
  }

  /**
   * List events
   */
  async listEvents(params?: {
    type?: string
    types?: string[]
    created?: { gt?: number; gte?: number; lt?: number; lte?: number }
    delivery_success?: boolean
    limit?: number
    starting_after?: string
  }): Promise<{ object: 'list'; data: WebhookEvent[]; has_more: boolean }> {
    const limit = Math.min(params?.limit ?? 10, 100)
    let events = Array.from(this.events.values())

    // Apply filters
    if (params?.type) {
      events = events.filter((e) => e.type === params.type)
    }
    if (params?.types) {
      events = events.filter((e) => params.types!.includes(e.type))
    }
    if (params?.created) {
      events = events.filter((e) => {
        if (params.created!.gt !== undefined && e.created <= params.created!.gt) return false
        if (params.created!.gte !== undefined && e.created < params.created!.gte) return false
        if (params.created!.lt !== undefined && e.created >= params.created!.lt) return false
        if (params.created!.lte !== undefined && e.created > params.created!.lte) return false
        return true
      })
    }

    events.sort((a, b) => b.created - a.created)

    let startIndex = 0
    if (params?.starting_after) {
      const idx = events.findIndex((e) => e.id === params.starting_after)
      if (idx !== -1) startIndex = idx + 1
    }

    const page = events.slice(startIndex, startIndex + limit)

    return {
      object: 'list',
      data: page,
      has_more: startIndex + limit < events.length,
    }
  }

  // ==========================================================================
  // Event Delivery
  // ==========================================================================

  /**
   * Deliver pending events to all matching endpoints
   */
  async deliverEvents(): Promise<WebhookDeliveryAttempt[]> {
    const attempts: WebhookDeliveryAttempt[] = []
    const eventsToDeliver = [...this.eventQueue]
    this.eventQueue = []

    for (const event of eventsToDeliver) {
      for (const endpoint of this.endpoints.values()) {
        if (endpoint.status !== 'enabled') continue

        // Check if endpoint is subscribed to this event type
        const isSubscribed =
          endpoint.enabled_events.includes('*') ||
          endpoint.enabled_events.includes(event.type) ||
          endpoint.enabled_events.some((e) => event.type.startsWith(e.replace('*', '')))

        if (!isSubscribed) continue

        const attemptId = `wda_${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`
        const attempt: WebhookDeliveryAttempt = {
          id: attemptId,
          event_id: event.id,
          endpoint_id: endpoint.id,
          status: 'pending',
          created: Math.floor(Date.now() / 1000),
        }

        try {
          if (this.onDeliver) {
            const result = await this.onDeliver(endpoint, event)
            attempt.status = result.status >= 200 && result.status < 300 ? 'succeeded' : 'failed'
            attempt.response_status = result.status
            attempt.response_body = result.body
            attempt.delivered_at = Math.floor(Date.now() / 1000)
          } else {
            // Mock successful delivery
            attempt.status = 'succeeded'
            attempt.response_status = 200
            attempt.delivered_at = Math.floor(Date.now() / 1000)
          }
        } catch (error) {
          attempt.status = 'failed'
          attempt.error_message = error instanceof Error ? error.message : 'Unknown error'
        }

        attempts.push(attempt)

        // Track delivery attempts per event
        if (!this.deliveryAttempts.has(event.id)) {
          this.deliveryAttempts.set(event.id, [])
        }
        this.deliveryAttempts.get(event.id)!.push(attempt)
      }
    }

    return attempts
  }

  /**
   * Get delivery attempts for an event
   */
  async getDeliveryAttempts(eventId: string): Promise<WebhookDeliveryAttempt[]> {
    return this.deliveryAttempts.get(eventId) ?? []
  }

  // ==========================================================================
  // Signature Verification
  // ==========================================================================

  /**
   * Construct and verify a webhook event
   */
  async constructEvent(
    payload: string | ArrayBuffer,
    signature: string,
    secret: string,
    tolerance?: number
  ): Promise<WebhookEvent> {
    const payloadString = typeof payload === 'string' ? payload : new TextDecoder().decode(payload)
    const effectiveTolerance = tolerance ?? this.defaultTolerance

    // Parse signature header
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
    if (now - signatureParts.timestamp > effectiveTolerance) {
      throw new Error(`Webhook timestamp too old. Timestamp: ${signatureParts.timestamp}, now: ${now}`)
    }

    // Compute expected signature
    const signedPayload = `${signatureParts.timestamp}.${payloadString}`
    const expectedSignature = await this.computeHmacSignature(signedPayload, secret)

    // Verify at least one signature matches
    const isValid = signatureParts.signatures.some((sig) => this.secureCompare(sig, expectedSignature))

    if (!isValid) {
      throw new Error('Webhook signature verification failed')
    }

    return JSON.parse(payloadString) as WebhookEvent
  }

  /**
   * Verify a signature without parsing
   */
  async verifySignature(
    payload: string | ArrayBuffer,
    signature: string,
    secret: string,
    tolerance?: number
  ): Promise<boolean> {
    try {
      await this.constructEvent(payload, signature, secret, tolerance)
      return true
    } catch {
      return false
    }
  }

  /**
   * Generate a test signature header
   */
  async generateTestHeaderString(options: {
    payload: string
    secret: string
    timestamp?: number
  }): Promise<string> {
    const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000)
    const signedPayload = `${timestamp}.${options.payload}`
    const signature = await this.computeHmacSignature(signedPayload, options.secret)
    return `t=${timestamp},v1=${signature}`
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private async computeHmacSignature(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const keyData = encoder.encode(secret)
    const payloadData = encoder.encode(payload)

    const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])

    const signature = await crypto.subtle.sign('HMAC', key, payloadData)
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false

    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return result === 0
  }

  private createError(code: string, message: string, param?: string): Error {
    const error = new Error(message) as Error & { type: string; code: string; param?: string }
    error.type = 'invalid_request_error'
    error.code = code
    error.param = param
    return error
  }

  /**
   * Clear all state (for testing)
   */
  async clear(): Promise<void> {
    this.endpoints.clear()
    this.events.clear()
    this.deliveryAttempts.clear()
    this.eventQueue = []
  }
}

/**
 * Static webhooks utility (matches Stripe.webhooks API)
 */
export const Webhooks = {
  async constructEvent(
    payload: string | ArrayBuffer,
    signature: string,
    secret: string,
    tolerance = 300
  ): Promise<WebhookEvent> {
    const resource = new LocalWebhooksResource()
    return resource.constructEvent(payload, signature, secret, tolerance)
  },

  async verifySignature(
    payload: string | ArrayBuffer,
    signature: string,
    secret: string,
    tolerance = 300
  ): Promise<boolean> {
    const resource = new LocalWebhooksResource()
    return resource.verifySignature(payload, signature, secret, tolerance)
  },

  async generateTestHeaderString(options: {
    payload: string
    secret: string
    timestamp?: number
  }): Promise<string> {
    const resource = new LocalWebhooksResource()
    return resource.generateTestHeaderString(options)
  },
}
