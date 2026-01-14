/**
 * WebhookEngine - Comprehensive webhook delivery system
 *
 * A production-ready webhook delivery system for the dotdo platform that provides:
 * - HMAC signature generation and verification (SHA-256, SHA-1, SHA-512)
 * - Configurable retry policies with exponential, linear, or fixed backoff
 * - Complete delivery tracking and history
 * - Event filtering per subscription with wildcard support
 * - Custom payload transformation per webhook
 *
 * @example
 * ```typescript
 * import { WebhookEngine } from 'dotdo/primitives/webhook-engine'
 *
 * const engine = new WebhookEngine({
 *   httpClient: myHttpClient,
 *   retryPolicy: { maxAttempts: 5, backoff: 'exponential', baseDelay: 1000 }
 * })
 *
 * // Register a webhook
 * const subscription = await engine.register({
 *   url: 'https://example.com/webhook',
 *   secret: 'my-secret',
 *   events: ['user.created', 'order.*']
 * })
 *
 * // Trigger an event
 * await engine.trigger({
 *   id: 'evt-123',
 *   type: 'user.created',
 *   payload: { userId: '456' },
 *   timestamp: new Date()
 * })
 * ```
 */

export * from './types'

import { createHmac, timingSafeEqual } from 'crypto'
import type {
  WebhookConfig,
  WebhookEvent,
  WebhookDelivery,
  WebhookSubscription,
  RetryPolicy,
  DeliveryResult,
  WebhookSignature,
  HttpClient,
  PayloadTransformer as PayloadTransformerFn,
} from './types'

// ============================================================================
// Constants
// ============================================================================

/** Default signature header name */
const DEFAULT_SIGNATURE_HEADER = 'X-Webhook-Signature'

/** Default retry policy for webhook delivery */
const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoff: 'exponential',
  baseDelay: 1000,
  maxDelay: 60000,
}

/** HTTP status codes that should not be retried */
const NON_RETRYABLE_STATUS_MIN = 400
const NON_RETRYABLE_STATUS_MAX = 499

/** HTTP status codes considered successful */
const SUCCESS_STATUS_MIN = 200
const SUCCESS_STATUS_MAX = 299

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique ID for webhooks and deliveries
 * Format: timestamp(base36)-random(base36)
 */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Check if an HTTP status code indicates success
 */
function isSuccessStatus(status: number): boolean {
  return status >= SUCCESS_STATUS_MIN && status <= SUCCESS_STATUS_MAX
}

/**
 * Check if an HTTP status code should not be retried (client errors)
 */
function isNonRetryableStatus(status: number): boolean {
  return status >= NON_RETRYABLE_STATUS_MIN && status <= NON_RETRYABLE_STATUS_MAX
}

// ============================================================================
// SignatureGenerator
// ============================================================================

/**
 * Generates and verifies HMAC signatures for webhook payloads.
 *
 * Supports SHA-256, SHA-1, and SHA-512 algorithms. Uses timing-safe
 * comparison to prevent timing attacks during verification.
 *
 * @example
 * ```typescript
 * const generator = new SignatureGenerator()
 *
 * // Generate signature
 * const sig = generator.generate(payload, secret, 'sha256')
 * // sig.signature = 'sha256=abc123...'
 *
 * // Verify signature
 * const isValid = generator.verify(payload, secret, 'sha256=abc123...')
 * ```
 */
export class SignatureGenerator {
  /**
   * Generate an HMAC signature for a payload
   *
   * @param payload - The string payload to sign
   * @param secret - The secret key for HMAC
   * @param algorithm - Hash algorithm to use
   * @returns Signature object with algorithm, header name, and signature string
   */
  generate(
    payload: string,
    secret: string,
    algorithm: 'sha256' | 'sha1' | 'sha512'
  ): WebhookSignature {
    const hmac = createHmac(algorithm, secret)
    hmac.update(payload)
    const signature = hmac.digest('hex')

    return {
      algorithm,
      header: DEFAULT_SIGNATURE_HEADER,
      signature: `${algorithm}=${signature}`,
    }
  }

  /**
   * Verify an HMAC signature against a payload
   *
   * Uses timing-safe comparison to prevent timing attacks.
   *
   * @param payload - The string payload that was signed
   * @param secret - The secret key used for signing
   * @param signature - The signature string in format "algorithm=hash"
   * @returns true if signature is valid, false otherwise
   */
  verify(payload: string, secret: string, signature: string): boolean {
    const [algorithm, hash] = signature.split('=')
    if (!algorithm || !hash) {
      return false
    }

    try {
      const hmac = createHmac(algorithm as 'sha256' | 'sha1' | 'sha512', secret)
      hmac.update(payload)
      const expected = hmac.digest('hex')

      // Use timing-safe comparison to prevent timing attacks
      const expectedBuffer = Buffer.from(expected, 'hex')
      const actualBuffer = Buffer.from(hash, 'hex')

      if (expectedBuffer.length !== actualBuffer.length) {
        return false
      }

      return timingSafeEqual(expectedBuffer, actualBuffer)
    } catch {
      return false
    }
  }
}

// ============================================================================
// RetryScheduler
// ============================================================================

/**
 * Calculates retry delays based on a configured policy.
 *
 * Supports three backoff strategies:
 * - exponential: delay = baseDelay * 2^(attempt-1)
 * - linear: delay = baseDelay * attempt
 * - fixed: delay = baseDelay
 *
 * @example
 * ```typescript
 * const scheduler = new RetryScheduler({
 *   maxAttempts: 5,
 *   backoff: 'exponential',
 *   baseDelay: 1000,
 *   maxDelay: 30000
 * })
 *
 * scheduler.getDelay(1) // 1000ms
 * scheduler.getDelay(2) // 2000ms
 * scheduler.getDelay(3) // 4000ms
 * scheduler.shouldRetry(4) // true
 * scheduler.shouldRetry(5) // false
 * ```
 */
export class RetryScheduler {
  private readonly policy: RetryPolicy

  constructor(policy: RetryPolicy) {
    this.policy = policy
  }

  /**
   * Get the delay before the next retry attempt
   *
   * @param attempt - Current attempt number (1-based)
   * @returns Delay in milliseconds
   */
  getDelay(attempt: number): number {
    // Use custom delays if provided
    if (this.policy.delays && this.policy.delays.length >= attempt) {
      return this.policy.delays[attempt - 1]
    }

    let delay: number

    switch (this.policy.backoff) {
      case 'exponential':
        delay = Math.pow(2, attempt - 1) * this.policy.baseDelay
        break
      case 'linear':
        delay = attempt * this.policy.baseDelay
        break
      case 'fixed':
      default:
        delay = this.policy.baseDelay
    }

    // Respect max delay if set
    if (this.policy.maxDelay !== undefined) {
      delay = Math.min(delay, this.policy.maxDelay)
    }

    return delay
  }

  /**
   * Check if another retry is allowed
   *
   * @param attempt - Current attempt number (1-based)
   * @returns true if more retries are allowed
   */
  shouldRetry(attempt: number): boolean {
    return attempt < this.policy.maxAttempts
  }
}

// ============================================================================
// DeliveryTracker
// ============================================================================

/** Input for tracking a delivery attempt */
export interface DeliveryTrackInput {
  webhookId: string
  eventId: string
  attempt: number
  status: number | null
  response: string | null
  duration: number
  success: boolean
  error?: string
}

/**
 * Tracks webhook delivery attempts for audit and debugging.
 *
 * Maintains an in-memory index of deliveries by webhook ID for efficient
 * lookup. In a production system, this would be backed by persistent storage.
 *
 * @example
 * ```typescript
 * const tracker = new DeliveryTracker()
 *
 * const delivery = tracker.track({
 *   webhookId: 'wh-123',
 *   eventId: 'evt-456',
 *   attempt: 1,
 *   status: 200,
 *   response: 'OK',
 *   duration: 150,
 *   success: true
 * })
 *
 * const history = tracker.getByWebhookId('wh-123')
 * ```
 */
export class DeliveryTracker {
  private readonly deliveries = new Map<string, WebhookDelivery>()
  private readonly byWebhookId = new Map<string, string[]>()

  /**
   * Track a delivery attempt
   *
   * @param input - Delivery attempt details
   * @returns The created delivery record with generated ID
   */
  track(input: DeliveryTrackInput): WebhookDelivery {
    const id = generateId()
    const delivery: WebhookDelivery = {
      id,
      webhookId: input.webhookId,
      eventId: input.eventId,
      attempt: input.attempt,
      status: input.status,
      response: input.response,
      duration: input.duration,
      timestamp: new Date(),
      success: input.success,
      error: input.error,
    }

    this.deliveries.set(id, delivery)

    // Index by webhook ID for efficient lookup
    const webhookDeliveries = this.byWebhookId.get(input.webhookId) || []
    webhookDeliveries.push(id)
    this.byWebhookId.set(input.webhookId, webhookDeliveries)

    return delivery
  }

  /**
   * Get all deliveries for a webhook
   *
   * @param webhookId - Webhook subscription ID
   * @returns Array of delivery records in chronological order
   */
  getByWebhookId(webhookId: string): WebhookDelivery[] {
    const ids = this.byWebhookId.get(webhookId) || []
    return ids.map((id) => this.deliveries.get(id)!).filter(Boolean)
  }

  /**
   * Get a specific delivery by ID
   *
   * @param id - Delivery ID
   * @returns Delivery record or undefined if not found
   */
  getById(id: string): WebhookDelivery | undefined {
    return this.deliveries.get(id)
  }
}

// ============================================================================
// EventFilter
// ============================================================================

/**
 * Filters events based on subscription configuration.
 *
 * Supports three matching modes:
 * - Exact match: event type equals subscription event
 * - Wildcard: subscription event is '*' (matches all)
 * - Prefix wildcard: subscription event ends with '.*' (e.g., 'user.*')
 *
 * @example
 * ```typescript
 * const filter = new EventFilter()
 *
 * // Exact match
 * filter.matches({ type: 'user.created' }, { events: ['user.created'] }) // true
 *
 * // Wildcard
 * filter.matches({ type: 'anything' }, { events: ['*'] }) // true
 *
 * // Prefix wildcard
 * filter.matches({ type: 'user.updated' }, { events: ['user.*'] }) // true
 * ```
 */
export class EventFilter {
  /**
   * Check if an event matches a subscription
   *
   * @param event - The event to check
   * @param subscription - The subscription to match against
   * @returns true if the event should be delivered to this subscription
   */
  matches(event: WebhookEvent, subscription: WebhookSubscription): boolean {
    // Disabled webhooks never match
    if (subscription.status === 'disabled') {
      return false
    }

    const { events } = subscription.config

    // Check for full wildcard match
    if (events.includes('*')) {
      return true
    }

    // Check for exact match
    if (events.includes(event.type)) {
      return true
    }

    // Check for prefix wildcard match (e.g., "user.*" matches "user.created")
    for (const pattern of events) {
      if (pattern.endsWith('.*')) {
        const prefix = pattern.slice(0, -2)
        if (event.type.startsWith(prefix + '.')) {
          return true
        }
      }
    }

    return false
  }
}

// ============================================================================
// PayloadTransformer
// ============================================================================

/**
 * Transforms event payloads before delivery.
 *
 * Supports custom transformers per webhook for format customization.
 * Default transformation wraps the event in a standard envelope.
 *
 * @example
 * ```typescript
 * const transformer = new PayloadTransformer()
 *
 * // Default transformation
 * transformer.transform(event)
 * // { id, type, data: payload, timestamp: ISO string }
 *
 * // Custom transformation
 * transformer.register('wh-123', (event) => ({
 *   customFormat: true,
 *   event: event.type,
 *   data: event.payload
 * }))
 * ```
 */
export class PayloadTransformer {
  private readonly transformers = new Map<string, PayloadTransformerFn>()

  /**
   * Transform an event payload
   *
   * @param event - The event to transform
   * @param webhookId - Optional webhook ID for custom transformation
   * @returns Transformed payload
   */
  transform(event: WebhookEvent, webhookId?: string): unknown {
    // Use custom transformer if registered
    if (webhookId) {
      const customTransformer = this.transformers.get(webhookId)
      if (customTransformer) {
        return customTransformer(event, webhookId)
      }
    }

    // Default transformation: standard envelope format
    return {
      id: event.id,
      type: event.type,
      data: event.payload,
      timestamp: event.timestamp.toISOString(),
    }
  }

  /**
   * Register a custom transformer for a webhook
   *
   * @param webhookId - Webhook subscription ID
   * @param transformer - Transformer function
   */
  register(webhookId: string, transformer: PayloadTransformerFn): void {
    this.transformers.set(webhookId, transformer)
  }

  /**
   * Unregister a custom transformer
   *
   * @param webhookId - Webhook subscription ID
   */
  unregister(webhookId: string): void {
    this.transformers.delete(webhookId)
  }
}

// ============================================================================
// WebhookDispatcher
// ============================================================================

/**
 * Handles webhook delivery with automatic retries.
 *
 * Orchestrates signature generation, HTTP requests, and retry logic.
 * Tracks all delivery attempts for audit purposes.
 *
 * @example
 * ```typescript
 * const dispatcher = new WebhookDispatcher(httpClient, {
 *   maxAttempts: 5,
 *   backoff: 'exponential',
 *   baseDelay: 1000
 * })
 *
 * const result = await dispatcher.deliver(subscription, event)
 * // result.success, result.attempts, result.deliveries
 * ```
 */
export class WebhookDispatcher {
  private readonly httpClient: HttpClient
  private readonly retryScheduler: RetryScheduler
  private readonly signatureGenerator: SignatureGenerator
  private readonly tracker: DeliveryTracker
  private readonly transformer: PayloadTransformer

  constructor(
    httpClient: HttpClient,
    retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
    tracker?: DeliveryTracker,
    transformer?: PayloadTransformer
  ) {
    this.httpClient = httpClient
    this.retryScheduler = new RetryScheduler(retryPolicy)
    this.signatureGenerator = new SignatureGenerator()
    this.tracker = tracker || new DeliveryTracker()
    this.transformer = transformer || new PayloadTransformer()
  }

  /**
   * Deliver an event to a webhook subscription with automatic retries
   *
   * @param subscription - Target webhook subscription
   * @param event - Event to deliver
   * @returns Delivery result with success status, attempt count, and delivery history
   */
  async deliver(
    subscription: WebhookSubscription,
    event: WebhookEvent
  ): Promise<DeliveryResult> {
    const deliveries: WebhookDelivery[] = []
    let attempt = 0
    let lastError: string | undefined

    while (true) {
      attempt++
      const startTime = Date.now()

      try {
        const result = await this.attemptDelivery(subscription, event, attempt, startTime)
        deliveries.push(result.delivery)

        if (result.success) {
          return { success: true, attempts: attempt, deliveries }
        }

        if (result.nonRetryable) {
          lastError = result.error
          break
        }

        lastError = result.error
      } catch (error) {
        const duration = Date.now() - startTime
        lastError = error instanceof Error ? error.message : String(error)

        const delivery = this.tracker.track({
          webhookId: subscription.id,
          eventId: event.id,
          attempt,
          status: null,
          response: null,
          duration,
          success: false,
          error: lastError,
        })
        deliveries.push(delivery)
      }

      // Check if we should retry
      if (!this.retryScheduler.shouldRetry(attempt)) {
        break
      }

      // Wait before retry
      const delay = this.retryScheduler.getDelay(attempt)
      if (delay > 0) {
        await this.delay(delay)
      }
    }

    return { success: false, attempts: attempt, lastError, deliveries }
  }

  /**
   * Attempt a single delivery
   */
  private async attemptDelivery(
    subscription: WebhookSubscription,
    event: WebhookEvent,
    attempt: number,
    startTime: number
  ): Promise<{
    success: boolean
    nonRetryable: boolean
    error?: string
    delivery: WebhookDelivery
  }> {
    // Transform payload
    const payload = this.transformer.transform(event, subscription.id)
    const body = JSON.stringify(payload)

    // Generate signature
    const signature = this.signatureGenerator.generate(
      body,
      subscription.config.secret,
      'sha256'
    )

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [signature.header]: signature.signature,
      ...subscription.config.headers,
    }

    // Make request
    const response = await this.httpClient.post(subscription.config.url, { headers, body })
    const duration = Date.now() - startTime
    const success = isSuccessStatus(response.status)

    // Track delivery
    const delivery = this.tracker.track({
      webhookId: subscription.id,
      eventId: event.id,
      attempt,
      status: response.status,
      response: response.body,
      duration,
      success,
      error: success ? undefined : `HTTP ${response.status}`,
    })

    return {
      success,
      nonRetryable: isNonRetryableStatus(response.status),
      error: `HTTP ${response.status}: ${response.body}`,
      delivery,
    }
  }

  /**
   * Delay execution for retry backoff
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Get the delivery tracker instance
   */
  getTracker(): DeliveryTracker {
    return this.tracker
  }
}

// ============================================================================
// WebhookEngine
// ============================================================================

/** Configuration options for WebhookEngine */
export interface WebhookEngineOptions {
  /** HTTP client for making webhook requests */
  httpClient?: HttpClient
  /** Retry policy for failed deliveries */
  retryPolicy?: RetryPolicy
}

/**
 * Main entry point for webhook management.
 *
 * Provides a high-level API for registering webhooks, triggering events,
 * and managing delivery history.
 *
 * @example
 * ```typescript
 * const engine = new WebhookEngine({ httpClient, retryPolicy })
 *
 * // Register webhook
 * const sub = await engine.register({
 *   url: 'https://example.com/webhook',
 *   secret: 'secret',
 *   events: ['user.*']
 * })
 *
 * // Trigger event
 * const results = await engine.trigger({
 *   id: 'evt-1',
 *   type: 'user.created',
 *   payload: { userId: '123' },
 *   timestamp: new Date()
 * })
 *
 * // Get delivery history
 * const deliveries = await engine.getDeliveries(sub.id)
 *
 * // Manage webhooks
 * await engine.disable(sub.id)
 * await engine.enable(sub.id)
 * await engine.unregister(sub.id)
 * ```
 */
export class WebhookEngine {
  private readonly subscriptions = new Map<string, WebhookSubscription>()
  private readonly dispatcher: WebhookDispatcher
  private readonly filter: EventFilter
  private readonly tracker: DeliveryTracker
  private readonly transformer: PayloadTransformer

  constructor(options: WebhookEngineOptions = {}) {
    const httpClient = options.httpClient || {
      post: async () => ({ status: 200, body: 'OK', headers: {} }),
    }

    this.tracker = new DeliveryTracker()
    this.transformer = new PayloadTransformer()
    this.dispatcher = new WebhookDispatcher(
      httpClient,
      options.retryPolicy || DEFAULT_RETRY_POLICY,
      this.tracker,
      this.transformer
    )
    this.filter = new EventFilter()
  }

  /**
   * Register a new webhook subscription
   *
   * @param config - Webhook configuration
   * @returns Created subscription
   */
  async register(config: WebhookConfig): Promise<WebhookSubscription> {
    const id = generateId()
    const now = new Date()

    const subscription: WebhookSubscription = {
      id,
      config,
      status: config.enabled === false ? 'disabled' : 'active',
      createdAt: now,
      updatedAt: now,
    }

    this.subscriptions.set(id, subscription)
    return subscription
  }

  /**
   * Unregister a webhook subscription
   *
   * @param id - Subscription ID to remove
   * @returns true if removed, false if not found
   */
  async unregister(id: string): Promise<boolean> {
    return this.subscriptions.delete(id)
  }

  /**
   * Trigger an event to all matching webhooks
   *
   * @param event - Event to trigger
   * @returns Array of delivery results for each matching webhook
   */
  async trigger(event: WebhookEvent): Promise<DeliveryResult[]> {
    const results: DeliveryResult[] = []

    const subscriptions = Array.from(this.subscriptions.values())
    for (const subscription of subscriptions) {
      if (this.filter.matches(event, subscription)) {
        const result = await this.dispatcher.deliver(subscription, event)
        results.push(result)
      }
    }

    return results
  }

  /**
   * Get delivery history for a webhook
   *
   * @param webhookId - Webhook subscription ID
   * @returns Array of delivery records
   */
  async getDeliveries(webhookId: string): Promise<WebhookDelivery[]> {
    return this.tracker.getByWebhookId(webhookId)
  }

  /**
   * Manually retry a failed delivery
   *
   * @param deliveryId - ID of the delivery to retry
   * @returns New delivery result
   * @throws Error if delivery or webhook not found
   */
  async retry(deliveryId: string): Promise<DeliveryResult> {
    const delivery = this.tracker.getById(deliveryId)
    if (!delivery) {
      throw new Error('Delivery not found')
    }

    const subscription = this.subscriptions.get(delivery.webhookId)
    if (!subscription) {
      throw new Error('Webhook subscription not found')
    }

    // Create a synthetic event for retry
    // Note: In production, store original events for accurate retry
    const event: WebhookEvent = {
      id: delivery.eventId,
      type: 'retry',
      payload: {},
      timestamp: new Date(),
    }

    return this.dispatcher.deliver(subscription, event)
  }

  /**
   * Disable a webhook subscription
   *
   * @param id - Subscription ID
   * @returns Updated subscription or null if not found
   */
  async disable(id: string): Promise<WebhookSubscription | null> {
    const subscription = this.subscriptions.get(id)
    if (!subscription) {
      return null
    }

    subscription.status = 'disabled'
    subscription.updatedAt = new Date()
    return subscription
  }

  /**
   * Enable a webhook subscription
   *
   * @param id - Subscription ID
   * @returns Updated subscription or null if not found
   */
  async enable(id: string): Promise<WebhookSubscription | null> {
    const subscription = this.subscriptions.get(id)
    if (!subscription) {
      return null
    }

    subscription.status = 'active'
    subscription.updatedAt = new Date()
    return subscription
  }

  /**
   * Get a webhook subscription by ID
   *
   * @param id - Subscription ID
   * @returns Subscription or null if not found
   */
  async get(id: string): Promise<WebhookSubscription | null> {
    return this.subscriptions.get(id) || null
  }

  /**
   * List all webhook subscriptions
   *
   * @returns Array of all subscriptions
   */
  async list(): Promise<WebhookSubscription[]> {
    return Array.from(this.subscriptions.values())
  }
}
