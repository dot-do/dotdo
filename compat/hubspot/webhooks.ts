/**
 * @dotdo/hubspot/webhooks - HubSpot Webhooks API Compatibility Layer
 *
 * Drop-in replacement for HubSpot Webhooks API with edge compatibility.
 * Provides webhook subscription management and event delivery.
 *
 * @example
 * ```typescript
 * import { HubSpotWebhooks } from '@dotdo/hubspot/webhooks'
 *
 * const webhooks = new HubSpotWebhooks(storage, {
 *   appId: 'app_123',
 *   clientSecret: 'secret_xxx',
 * })
 *
 * // Subscribe to contact creation
 * await webhooks.subscribe({
 *   eventType: 'contact.creation',
 *   webhookUrl: 'https://example.com/webhook',
 *   active: true,
 * })
 *
 * // Trigger an event
 * await webhooks.triggerEvent({
 *   eventType: 'contact.creation',
 *   objectType: 'contact',
 *   objectId: '123',
 *   propertyName: null,
 *   propertyValue: null,
 * })
 * ```
 *
 * @module @dotdo/hubspot/webhooks
 */

import * as crypto from 'crypto'

// =============================================================================
// Types
// =============================================================================

/**
 * Webhook event types
 */
export type WebhookEventType =
  // Contact events
  | 'contact.creation'
  | 'contact.deletion'
  | 'contact.propertyChange'
  | 'contact.merge'
  | 'contact.associationChange'
  // Company events
  | 'company.creation'
  | 'company.deletion'
  | 'company.propertyChange'
  | 'company.merge'
  | 'company.associationChange'
  // Deal events
  | 'deal.creation'
  | 'deal.deletion'
  | 'deal.propertyChange'
  | 'deal.merge'
  | 'deal.associationChange'
  // Ticket events
  | 'ticket.creation'
  | 'ticket.deletion'
  | 'ticket.propertyChange'
  | 'ticket.merge'
  | 'ticket.associationChange'
  // Line item events
  | 'line_item.creation'
  | 'line_item.deletion'
  | 'line_item.propertyChange'
  // Product events
  | 'product.creation'
  | 'product.deletion'
  | 'product.propertyChange'
  // Quote events
  | 'quote.creation'
  | 'quote.deletion'
  | 'quote.propertyChange'
  // Form events
  | 'form.submission'
  // Conversation events
  | 'conversation.creation'
  | 'conversation.newMessage'
  | 'conversation.propertyChange'
  // Pipeline events
  | 'pipeline.creation'
  | 'pipeline.deletion'
  | 'pipeline.propertyChange'

/**
 * Object types for webhooks
 */
export type WebhookObjectType =
  | 'contact'
  | 'company'
  | 'deal'
  | 'ticket'
  | 'line_item'
  | 'product'
  | 'quote'
  | 'form'
  | 'conversation'
  | 'pipeline'

/**
 * Webhook subscription
 */
export interface WebhookSubscription {
  id: string
  eventType: WebhookEventType
  webhookUrl: string
  active: boolean
  createdAt: string
  updatedAt: string
  propertyName?: string // For propertyChange events
}

/**
 * Webhook event payload
 */
export interface WebhookEvent {
  eventId: string
  subscriptionId: string
  portalId: number
  appId: number
  occurredAt: number
  eventType: WebhookEventType
  objectType: WebhookObjectType
  objectId: string
  propertyName?: string
  propertyValue?: string
  changeSource?: string
  sourceId?: string
  subscriptionType?: string
  attemptNumber: number
}

/**
 * Webhook delivery log
 */
export interface WebhookDelivery {
  id: string
  eventId: string
  subscriptionId: string
  webhookUrl: string
  status: 'pending' | 'success' | 'failed'
  statusCode?: number
  response?: string
  error?: string
  attemptNumber: number
  deliveredAt?: string
  createdAt: string
}

/**
 * Webhook subscription input
 */
export interface CreateSubscriptionInput {
  eventType: WebhookEventType
  webhookUrl: string
  active?: boolean
  propertyName?: string
}

/**
 * Webhook subscription update input
 */
export interface UpdateSubscriptionInput {
  webhookUrl?: string
  active?: boolean
  propertyName?: string
}

/**
 * Webhook trigger input
 */
export interface TriggerEventInput {
  eventType: WebhookEventType
  objectType: WebhookObjectType
  objectId: string
  propertyName?: string | null
  propertyValue?: string | null
  changeSource?: string
}

/**
 * Webhook settings
 */
export interface WebhookSettings {
  throttling: {
    maxConcurrentRequests: number
    period: number
  }
  targetUrl?: string
}

/**
 * Configuration
 */
export interface WebhookConfig {
  appId: string
  clientSecret: string
  portalId?: number
  maxRetries?: number
  retryDelay?: number
}

/**
 * Storage interface
 */
export interface WebhookStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list(options?: { prefix?: string; limit?: number }): Promise<Map<string, unknown>>
}

/**
 * List result
 */
export interface ListResult<T> {
  results: T[]
  paging?: {
    next?: { after: string }
  }
}

// =============================================================================
// Error Class
// =============================================================================

export class HubSpotWebhookError extends Error {
  category: string
  statusCode: number
  correlationId: string
  context?: Record<string, unknown>

  constructor(
    message: string,
    category: string,
    statusCode: number = 400,
    context?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'HubSpotWebhookError'
    this.category = category
    this.statusCode = statusCode
    this.correlationId = generateId('correlation')
    this.context = context
  }
}

// =============================================================================
// Utilities
// =============================================================================

function generateId(prefix: string = 'webhook'): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${timestamp}${random}`
}

function now(): string {
  return new Date().toISOString()
}

// =============================================================================
// HubSpotWebhooks Class
// =============================================================================

/**
 * HubSpot Webhooks compatibility layer with DO storage
 */
export class HubSpotWebhooks {
  private storage: WebhookStorage
  private config: WebhookConfig
  private fetchFn: typeof fetch

  private readonly PREFIX = {
    subscription: 'webhook_sub:',
    event: 'webhook_event:',
    delivery: 'webhook_delivery:',
    settings: 'webhook_settings',
    queue: 'webhook_queue:',
  }

  constructor(
    storage: WebhookStorage,
    config: WebhookConfig,
    fetchFn: typeof fetch = globalThis.fetch.bind(globalThis)
  ) {
    this.storage = storage
    this.config = {
      maxRetries: 3,
      retryDelay: 60000, // 1 minute
      ...config,
    }
    this.fetchFn = fetchFn
  }

  // ===========================================================================
  // Subscriptions
  // ===========================================================================

  /**
   * Create a webhook subscription
   */
  async subscribe(input: CreateSubscriptionInput): Promise<WebhookSubscription> {
    const id = generateId('sub')
    const timestamp = now()

    // Validate URL
    try {
      new URL(input.webhookUrl)
    } catch {
      throw new HubSpotWebhookError(
        'Invalid webhook URL',
        'INVALID_URL',
        400
      )
    }

    // Check for duplicate subscription
    const existing = await this.findSubscription(input.eventType, input.webhookUrl)
    if (existing) {
      throw new HubSpotWebhookError(
        'Subscription already exists for this event type and URL',
        'DUPLICATE_SUBSCRIPTION',
        409
      )
    }

    const subscription: WebhookSubscription = {
      id,
      eventType: input.eventType,
      webhookUrl: input.webhookUrl,
      active: input.active ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
      propertyName: input.propertyName,
    }

    await this.storage.put(`${this.PREFIX.subscription}${id}`, subscription)
    return subscription
  }

  /**
   * Get a subscription by ID
   */
  async getSubscription(subscriptionId: string): Promise<WebhookSubscription> {
    const subscription = await this.storage.get<WebhookSubscription>(
      `${this.PREFIX.subscription}${subscriptionId}`
    )
    if (!subscription) {
      throw new HubSpotWebhookError(
        `Subscription not found: ${subscriptionId}`,
        'SUBSCRIPTION_NOT_FOUND',
        404
      )
    }
    return subscription
  }

  /**
   * Update a subscription
   */
  async updateSubscription(
    subscriptionId: string,
    input: UpdateSubscriptionInput
  ): Promise<WebhookSubscription> {
    const subscription = await this.getSubscription(subscriptionId)
    const timestamp = now()

    if (input.webhookUrl) {
      try {
        new URL(input.webhookUrl)
      } catch {
        throw new HubSpotWebhookError(
          'Invalid webhook URL',
          'INVALID_URL',
          400
        )
      }
    }

    const updated: WebhookSubscription = {
      ...subscription,
      ...input,
      updatedAt: timestamp,
    }

    await this.storage.put(`${this.PREFIX.subscription}${subscriptionId}`, updated)
    return updated
  }

  /**
   * Delete a subscription
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    await this.getSubscription(subscriptionId) // Verify it exists
    await this.storage.delete(`${this.PREFIX.subscription}${subscriptionId}`)
  }

  /**
   * List all subscriptions
   */
  async listSubscriptions(options?: {
    eventType?: WebhookEventType
    active?: boolean
    limit?: number
    after?: string
  }): Promise<ListResult<WebhookSubscription>> {
    const subsMap = await this.storage.list({ prefix: this.PREFIX.subscription })
    const subscriptions: WebhookSubscription[] = []

    for (const value of subsMap.values()) {
      const sub = value as WebhookSubscription
      if (options?.eventType && sub.eventType !== options.eventType) continue
      if (options?.active !== undefined && sub.active !== options.active) continue
      subscriptions.push(sub)
    }

    // Sort by createdAt
    subscriptions.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    // Pagination
    const limit = options?.limit ?? 100
    let startIndex = 0
    if (options?.after) {
      const afterIndex = subscriptions.findIndex((s) => s.id === options.after)
      if (afterIndex !== -1) {
        startIndex = afterIndex + 1
      }
    }

    const paged = subscriptions.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < subscriptions.length

    return {
      results: paged,
      paging: hasMore
        ? { next: { after: paged[paged.length - 1]?.id ?? '' } }
        : undefined,
    }
  }

  /**
   * Find subscription by event type and URL
   */
  private async findSubscription(
    eventType: WebhookEventType,
    webhookUrl: string
  ): Promise<WebhookSubscription | null> {
    const subsMap = await this.storage.list({ prefix: this.PREFIX.subscription })

    for (const value of subsMap.values()) {
      const sub = value as WebhookSubscription
      if (sub.eventType === eventType && sub.webhookUrl === webhookUrl) {
        return sub
      }
    }

    return null
  }

  /**
   * Get subscriptions for an event type
   */
  private async getSubscriptionsForEvent(
    eventType: WebhookEventType,
    propertyName?: string
  ): Promise<WebhookSubscription[]> {
    const subsMap = await this.storage.list({ prefix: this.PREFIX.subscription })
    const matching: WebhookSubscription[] = []

    for (const value of subsMap.values()) {
      const sub = value as WebhookSubscription
      if (!sub.active) continue
      if (sub.eventType !== eventType) continue

      // For propertyChange events, check if propertyName matches
      if (eventType.endsWith('.propertyChange') && sub.propertyName) {
        if (sub.propertyName !== propertyName) continue
      }

      matching.push(sub)
    }

    return matching
  }

  // ===========================================================================
  // Event Triggering
  // ===========================================================================

  /**
   * Trigger a webhook event
   */
  async triggerEvent(input: TriggerEventInput): Promise<WebhookEvent[]> {
    const subscriptions = await this.getSubscriptionsForEvent(
      input.eventType,
      input.propertyName ?? undefined
    )

    const events: WebhookEvent[] = []

    for (const subscription of subscriptions) {
      const eventId = generateId('event')
      const timestamp = Date.now()

      const event: WebhookEvent = {
        eventId,
        subscriptionId: subscription.id,
        portalId: this.config.portalId ?? 0,
        appId: parseInt(this.config.appId.replace(/\D/g, '')) || 0,
        occurredAt: timestamp,
        eventType: input.eventType,
        objectType: input.objectType,
        objectId: input.objectId,
        propertyName: input.propertyName ?? undefined,
        propertyValue: input.propertyValue ?? undefined,
        changeSource: input.changeSource ?? 'CRM',
        attemptNumber: 1,
      }

      // Store event
      await this.storage.put(`${this.PREFIX.event}${eventId}`, event)

      // Queue for delivery
      await this.queueDelivery(subscription, event)

      events.push(event)
    }

    return events
  }

  /**
   * Queue an event for delivery
   */
  private async queueDelivery(
    subscription: WebhookSubscription,
    event: WebhookEvent
  ): Promise<void> {
    const deliveryId = generateId('delivery')
    const timestamp = now()

    const delivery: WebhookDelivery = {
      id: deliveryId,
      eventId: event.eventId,
      subscriptionId: subscription.id,
      webhookUrl: subscription.webhookUrl,
      status: 'pending',
      attemptNumber: 1,
      createdAt: timestamp,
    }

    await this.storage.put(`${this.PREFIX.delivery}${deliveryId}`, delivery)

    // Attempt immediate delivery
    await this.deliverWebhook(delivery, event)
  }

  /**
   * Deliver a webhook
   */
  private async deliverWebhook(
    delivery: WebhookDelivery,
    event: WebhookEvent
  ): Promise<boolean> {
    const payload = [event] // HubSpot sends events as an array
    const timestamp = Date.now().toString()
    const signature = this.createSignature(payload, timestamp)

    try {
      const response = await this.fetchFn(delivery.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-HubSpot-Request-Timestamp': timestamp,
          'X-HubSpot-Signature': signature,
          'X-HubSpot-Signature-Version': 'v1',
        },
        body: JSON.stringify(payload),
      })

      const updatedDelivery: WebhookDelivery = {
        ...delivery,
        status: response.ok ? 'success' : 'failed',
        statusCode: response.status,
        deliveredAt: now(),
      }

      if (!response.ok) {
        try {
          updatedDelivery.response = await response.text()
        } catch {
          // Ignore response parsing errors
        }
      }

      await this.storage.put(
        `${this.PREFIX.delivery}${delivery.id}`,
        updatedDelivery
      )

      return response.ok
    } catch (error) {
      const updatedDelivery: WebhookDelivery = {
        ...delivery,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      }

      await this.storage.put(
        `${this.PREFIX.delivery}${delivery.id}`,
        updatedDelivery
      )

      // Schedule retry if under max attempts
      if (delivery.attemptNumber < (this.config.maxRetries ?? 3)) {
        await this.scheduleRetry(delivery, event)
      }

      return false
    }
  }

  /**
   * Schedule a retry for failed delivery
   */
  private async scheduleRetry(
    delivery: WebhookDelivery,
    event: WebhookEvent
  ): Promise<void> {
    const retryDeliveryId = generateId('delivery')
    const timestamp = now()

    const retryDelivery: WebhookDelivery = {
      id: retryDeliveryId,
      eventId: event.eventId,
      subscriptionId: delivery.subscriptionId,
      webhookUrl: delivery.webhookUrl,
      status: 'pending',
      attemptNumber: delivery.attemptNumber + 1,
      createdAt: timestamp,
    }

    await this.storage.put(
      `${this.PREFIX.delivery}${retryDeliveryId}`,
      retryDelivery
    )

    // Update event attempt number
    const updatedEvent: WebhookEvent = {
      ...event,
      attemptNumber: delivery.attemptNumber + 1,
    }

    await this.storage.put(`${this.PREFIX.event}${event.eventId}`, updatedEvent)
  }

  /**
   * Retry failed deliveries
   */
  async retryFailedDeliveries(): Promise<number> {
    const deliveriesMap = await this.storage.list({ prefix: this.PREFIX.delivery })
    let retried = 0

    for (const value of deliveriesMap.values()) {
      const delivery = value as WebhookDelivery
      if (delivery.status !== 'failed') continue
      if (delivery.attemptNumber >= (this.config.maxRetries ?? 3)) continue

      // Get the event
      const event = await this.storage.get<WebhookEvent>(
        `${this.PREFIX.event}${delivery.eventId}`
      )
      if (!event) continue

      // Create new delivery attempt
      const newDeliveryId = generateId('delivery')
      const newDelivery: WebhookDelivery = {
        id: newDeliveryId,
        eventId: delivery.eventId,
        subscriptionId: delivery.subscriptionId,
        webhookUrl: delivery.webhookUrl,
        status: 'pending',
        attemptNumber: delivery.attemptNumber + 1,
        createdAt: now(),
      }

      await this.storage.put(`${this.PREFIX.delivery}${newDeliveryId}`, newDelivery)
      await this.deliverWebhook(newDelivery, event)
      retried++
    }

    return retried
  }

  // ===========================================================================
  // Signature Verification
  // ===========================================================================

  /**
   * Create a webhook signature
   */
  createSignature(payload: unknown, timestamp: string): string {
    const source = `${this.config.clientSecret}${JSON.stringify(payload)}${timestamp}`
    return crypto.createHash('sha256').update(source).digest('hex')
  }

  /**
   * Verify a webhook signature (for incoming webhooks)
   */
  verifySignature(
    payload: string,
    signature: string,
    timestamp: string
  ): boolean {
    const expectedSignature = this.createSignature(JSON.parse(payload), timestamp)
    // Handle different length signatures gracefully
    if (signature.length !== expectedSignature.length) {
      return false
    }
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      )
    } catch {
      return false
    }
  }

  /**
   * Verify a webhook request (v2 signature)
   */
  verifyWebhookV2(
    requestBody: string,
    signature: string,
    timestamp: string,
    method: string,
    url: string
  ): boolean {
    const uri = new URL(url).pathname
    const source = `${method}${uri}${requestBody}${timestamp}`
    const expectedSignature = crypto
      .createHmac('sha256', this.config.clientSecret)
      .update(source)
      .digest('base64')
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  }

  // ===========================================================================
  // Event History
  // ===========================================================================

  /**
   * Get event by ID
   */
  async getEvent(eventId: string): Promise<WebhookEvent> {
    const event = await this.storage.get<WebhookEvent>(
      `${this.PREFIX.event}${eventId}`
    )
    if (!event) {
      throw new HubSpotWebhookError(
        `Event not found: ${eventId}`,
        'EVENT_NOT_FOUND',
        404
      )
    }
    return event
  }

  /**
   * List events
   */
  async listEvents(options?: {
    eventType?: WebhookEventType
    objectType?: WebhookObjectType
    objectId?: string
    limit?: number
    after?: string
  }): Promise<ListResult<WebhookEvent>> {
    const eventsMap = await this.storage.list({ prefix: this.PREFIX.event })
    const events: WebhookEvent[] = []

    for (const value of eventsMap.values()) {
      const event = value as WebhookEvent
      if (options?.eventType && event.eventType !== options.eventType) continue
      if (options?.objectType && event.objectType !== options.objectType) continue
      if (options?.objectId && event.objectId !== options.objectId) continue
      events.push(event)
    }

    // Sort by occurredAt descending
    events.sort((a, b) => b.occurredAt - a.occurredAt)

    // Pagination
    const limit = options?.limit ?? 100
    let startIndex = 0
    if (options?.after) {
      const afterIndex = events.findIndex((e) => e.eventId === options.after)
      if (afterIndex !== -1) {
        startIndex = afterIndex + 1
      }
    }

    const paged = events.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < events.length

    return {
      results: paged,
      paging: hasMore
        ? { next: { after: paged[paged.length - 1]?.eventId ?? '' } }
        : undefined,
    }
  }

  // ===========================================================================
  // Delivery History
  // ===========================================================================

  /**
   * Get delivery by ID
   */
  async getDelivery(deliveryId: string): Promise<WebhookDelivery> {
    const delivery = await this.storage.get<WebhookDelivery>(
      `${this.PREFIX.delivery}${deliveryId}`
    )
    if (!delivery) {
      throw new HubSpotWebhookError(
        `Delivery not found: ${deliveryId}`,
        'DELIVERY_NOT_FOUND',
        404
      )
    }
    return delivery
  }

  /**
   * List deliveries
   */
  async listDeliveries(options?: {
    subscriptionId?: string
    eventId?: string
    status?: WebhookDelivery['status']
    limit?: number
    after?: string
  }): Promise<ListResult<WebhookDelivery>> {
    const deliveriesMap = await this.storage.list({ prefix: this.PREFIX.delivery })
    const deliveries: WebhookDelivery[] = []

    for (const value of deliveriesMap.values()) {
      const delivery = value as WebhookDelivery
      if (options?.subscriptionId && delivery.subscriptionId !== options.subscriptionId) continue
      if (options?.eventId && delivery.eventId !== options.eventId) continue
      if (options?.status && delivery.status !== options.status) continue
      deliveries.push(delivery)
    }

    // Sort by createdAt descending
    deliveries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    // Pagination
    const limit = options?.limit ?? 100
    let startIndex = 0
    if (options?.after) {
      const afterIndex = deliveries.findIndex((d) => d.id === options.after)
      if (afterIndex !== -1) {
        startIndex = afterIndex + 1
      }
    }

    const paged = deliveries.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < deliveries.length

    return {
      results: paged,
      paging: hasMore
        ? { next: { after: paged[paged.length - 1]?.id ?? '' } }
        : undefined,
    }
  }

  /**
   * Get delivery stats
   */
  async getDeliveryStats(options?: { subscriptionId?: string }): Promise<{
    total: number
    pending: number
    success: number
    failed: number
    successRate: number
  }> {
    const deliveriesMap = await this.storage.list({ prefix: this.PREFIX.delivery })

    let total = 0
    let pending = 0
    let success = 0
    let failed = 0

    for (const value of deliveriesMap.values()) {
      const delivery = value as WebhookDelivery
      if (options?.subscriptionId && delivery.subscriptionId !== options.subscriptionId) continue

      total++
      switch (delivery.status) {
        case 'pending':
          pending++
          break
        case 'success':
          success++
          break
        case 'failed':
          failed++
          break
      }
    }

    return {
      total,
      pending,
      success,
      failed,
      successRate: total > 0 ? (success / total) * 100 : 0,
    }
  }

  // ===========================================================================
  // Settings
  // ===========================================================================

  /**
   * Get webhook settings
   */
  async getSettings(): Promise<WebhookSettings> {
    const settings = await this.storage.get<WebhookSettings>(this.PREFIX.settings)
    return settings ?? {
      throttling: {
        maxConcurrentRequests: 10,
        period: 1000,
      },
    }
  }

  /**
   * Update webhook settings
   */
  async updateSettings(settings: Partial<WebhookSettings>): Promise<WebhookSettings> {
    const current = await this.getSettings()
    const updated: WebhookSettings = {
      ...current,
      ...settings,
      throttling: {
        ...current.throttling,
        ...settings.throttling,
      },
    }
    await this.storage.put(this.PREFIX.settings, updated)
    return updated
  }

  // ===========================================================================
  // Utility
  // ===========================================================================

  /**
   * Clear all webhooks data (for testing)
   */
  async clear(): Promise<void> {
    const subs = await this.storage.list({ prefix: this.PREFIX.subscription })
    for (const key of subs.keys()) {
      await this.storage.delete(key as string)
    }

    const events = await this.storage.list({ prefix: this.PREFIX.event })
    for (const key of events.keys()) {
      await this.storage.delete(key as string)
    }

    const deliveries = await this.storage.list({ prefix: this.PREFIX.delivery })
    for (const key of deliveries.keys()) {
      await this.storage.delete(key as string)
    }

    await this.storage.delete(this.PREFIX.settings)
  }
}

// =============================================================================
// Export Default
// =============================================================================

export default HubSpotWebhooks
