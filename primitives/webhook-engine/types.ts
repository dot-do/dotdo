/**
 * WebhookEngine Types
 * Comprehensive type definitions for webhook delivery system
 */

/**
 * Configuration for a webhook endpoint
 */
export interface WebhookConfig {
  /** Target URL for webhook delivery */
  url: string
  /** Secret key for HMAC signature generation */
  secret: string
  /** List of event types this webhook subscribes to */
  events: string[]
  /** Custom headers to include in webhook requests */
  headers?: Record<string, string>
  /** Whether the webhook is currently active */
  enabled?: boolean
}

/**
 * Webhook event to be delivered
 */
export interface WebhookEvent {
  /** Unique identifier for this event */
  id: string
  /** Event type (e.g., "user.created", "order.completed") */
  type: string
  /** Event payload data */
  payload: unknown
  /** Timestamp when event was created */
  timestamp: Date
}

/**
 * Record of a single delivery attempt
 */
export interface WebhookDelivery {
  /** Unique identifier for this delivery */
  id: string
  /** ID of the webhook subscription */
  webhookId: string
  /** ID of the event being delivered */
  eventId: string
  /** Attempt number (1-based) */
  attempt: number
  /** HTTP status code received */
  status: number | null
  /** Response body received */
  response: string | null
  /** Duration of the request in milliseconds */
  duration: number
  /** Timestamp of this delivery attempt */
  timestamp: Date
  /** Whether this attempt was successful */
  success: boolean
  /** Error message if failed */
  error?: string
}

/**
 * Webhook subscription (registered webhook)
 */
export interface WebhookSubscription {
  /** Unique identifier for this subscription */
  id: string
  /** Webhook configuration */
  config: WebhookConfig
  /** Current status of the subscription */
  status: 'active' | 'disabled' | 'failed'
  /** When the subscription was created */
  createdAt: Date
  /** When the subscription was last updated */
  updatedAt: Date
}

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  /** Maximum number of delivery attempts */
  maxAttempts: number
  /** Backoff strategy */
  backoff: 'exponential' | 'linear' | 'fixed'
  /** Base delay in milliseconds */
  baseDelay: number
  /** Maximum delay between retries in milliseconds */
  maxDelay?: number
  /** Custom delays for each retry (overrides backoff calculation) */
  delays?: number[]
}

/**
 * Result of a webhook delivery operation
 */
export interface DeliveryResult {
  /** Whether delivery ultimately succeeded */
  success: boolean
  /** Total number of attempts made */
  attempts: number
  /** Error from last failed attempt, if any */
  lastError?: string
  /** All delivery attempts */
  deliveries: WebhookDelivery[]
}

/**
 * Webhook signature configuration
 */
export interface WebhookSignature {
  /** Hashing algorithm (e.g., "sha256") */
  algorithm: 'sha256' | 'sha1' | 'sha512'
  /** Header name for the signature */
  header: string
  /** Signed payload representation */
  signature: string
}

/**
 * Options for triggering events
 */
export interface TriggerOptions {
  /** Only deliver to specific webhook IDs */
  webhookIds?: string[]
  /** Custom retry policy for this trigger */
  retryPolicy?: RetryPolicy
  /** Skip disabled webhooks (default: true) */
  skipDisabled?: boolean
}

/**
 * Payload transformer function type
 */
export type PayloadTransformer = (event: WebhookEvent, webhookId: string) => unknown

/**
 * Event filter function type
 */
export type EventFilter = (event: WebhookEvent, subscription: WebhookSubscription) => boolean

/**
 * HTTP client interface for making webhook requests
 */
export interface HttpClient {
  post(url: string, options: HttpRequestOptions): Promise<HttpResponse>
}

/**
 * HTTP request options
 */
export interface HttpRequestOptions {
  headers: Record<string, string>
  body: string
  timeout?: number
}

/**
 * HTTP response
 */
export interface HttpResponse {
  status: number
  body: string
  headers: Record<string, string>
}
