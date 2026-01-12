/**
 * @dotdo/twilio/sms - Twilio SMS API Compatibility Layer
 *
 * Focused SMS sending with status tracking, webhook handling, and rate limiting.
 *
 * @example
 * ```typescript
 * import { TwilioSMS } from '@dotdo/twilio/sms'
 *
 * const sms = new TwilioSMS({
 *   accountSid: 'AC123',
 *   authToken: 'token123',
 * })
 *
 * const message = await sms.send({
 *   to: '+15558675310',
 *   from: '+15017122661',
 *   body: 'Hello from dotdo!',
 * })
 *
 * // Get message status
 * const status = await sms.getStatus(message.sid)
 *
 * // Handle webhook
 * const webhookHandler = sms.createWebhookHandler()
 * ```
 *
 * @module @dotdo/twilio/sms
 */

import { Hono } from 'hono'
import { Pipe } from '../../primitives/pipe'
import type {
  Message,
  MessageStatus,
  MessageDirection,
  MessageCreateParams,
  MessageListParams,
  MessageWebhookPayload,
  TwilioClientConfig,
  TwilioErrorResponse,
} from './types'

// =============================================================================
// SMS-Specific Types
// =============================================================================

/**
 * SMS send request parameters
 */
export interface SMSSendRequest {
  /** Recipient phone number in E.164 format */
  to: string
  /** Sender phone number or messaging service SID */
  from?: string
  /** Message body text */
  body: string
  /** Messaging service SID (alternative to from) */
  messagingServiceSid?: string
  /** URL for status callback webhooks */
  statusCallback?: string
  /** Media URLs for MMS */
  mediaUrl?: string[]
  /** Message validity period in seconds (14400 max) */
  validityPeriod?: number
  /** Force delivery even if user has opted out */
  forceDelivery?: boolean
  /** Schedule message for future delivery */
  sendAt?: Date
  /** Send as MMS instead of SMS */
  sendAsMms?: boolean
  /** Shorten URLs in message body */
  shortenUrls?: boolean
}

/**
 * SMS send response
 */
export interface SMSSendResponse {
  sid: string
  accountSid: string
  to: string
  from: string
  body: string
  status: MessageStatus
  direction: MessageDirection
  dateCreated: Date
  dateSent: Date | null
  errorCode: number | null
  errorMessage: string | null
  numSegments: number
  price: string | null
  priceUnit: string
}

/**
 * SMS status tracking entry
 */
export interface SMSStatusEntry {
  sid: string
  status: MessageStatus
  errorCode: number | null
  errorMessage: string | null
  updatedAt: Date
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum requests per window */
  maxRequests: number
  /** Window size in milliseconds */
  windowMs: number
  /** Key function to determine rate limit bucket */
  keyFn?: (request: SMSSendRequest) => string
}

/**
 * TwilioSMS client configuration
 */
export interface TwilioSMSConfig extends TwilioClientConfig {
  /** Rate limiting configuration */
  rateLimit?: RateLimitConfig
  /** Default from number */
  defaultFrom?: string
  /** Default messaging service SID */
  defaultMessagingServiceSid?: string
  /** Webhook secret for signature verification */
  webhookSecret?: string
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Twilio SMS API Error
 */
export class TwilioSMSError extends Error {
  code: number
  status: number
  moreInfo: string

  constructor(response: TwilioErrorResponse) {
    super(response.message)
    this.name = 'TwilioSMSError'
    this.code = response.code
    this.status = response.status
    this.moreInfo = response.more_info
  }
}

/**
 * Rate limit exceeded error
 */
export class RateLimitError extends Error {
  retryAfter: number

  constructor(retryAfter: number) {
    super(`Rate limit exceeded. Retry after ${retryAfter}ms`)
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
  }
}

// =============================================================================
// Rate Limiter
// =============================================================================

/**
 * Simple token bucket rate limiter
 */
class RateLimiter {
  private buckets: Map<string, { tokens: number; lastRefill: number }> = new Map()
  private config: RateLimitConfig

  constructor(config: RateLimitConfig) {
    this.config = config
  }

  /**
   * Check if request is allowed and consume a token
   */
  async acquire(key: string): Promise<{ allowed: boolean; retryAfter?: number }> {
    const now = Date.now()
    let bucket = this.buckets.get(key)

    if (!bucket) {
      bucket = { tokens: this.config.maxRequests, lastRefill: now }
      this.buckets.set(key, bucket)
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill
    const refillAmount = Math.floor((elapsed / this.config.windowMs) * this.config.maxRequests)

    if (refillAmount > 0) {
      bucket.tokens = Math.min(this.config.maxRequests, bucket.tokens + refillAmount)
      bucket.lastRefill = now
    }

    if (bucket.tokens > 0) {
      bucket.tokens--
      return { allowed: true }
    }

    // Calculate retry after
    const tokensNeeded = 1
    const timePerToken = this.config.windowMs / this.config.maxRequests
    const retryAfter = Math.ceil(tokensNeeded * timePerToken)

    return { allowed: false, retryAfter }
  }

  /**
   * Get current rate limit status for a key
   */
  getStatus(key: string): { remaining: number; reset: number } {
    const bucket = this.buckets.get(key)
    if (!bucket) {
      return { remaining: this.config.maxRequests, reset: Date.now() + this.config.windowMs }
    }

    const now = Date.now()
    const elapsed = now - bucket.lastRefill
    const refillAmount = Math.floor((elapsed / this.config.windowMs) * this.config.maxRequests)
    const tokens = Math.min(this.config.maxRequests, bucket.tokens + refillAmount)

    return {
      remaining: tokens,
      reset: bucket.lastRefill + this.config.windowMs,
    }
  }

  /**
   * Clear all rate limit buckets
   */
  clear(): void {
    this.buckets.clear()
  }
}

// =============================================================================
// Status Tracker
// =============================================================================

/**
 * In-memory message status tracker
 */
class MessageStatusTracker {
  private statuses: Map<string, SMSStatusEntry> = new Map()

  /**
   * Track a new message
   */
  track(sid: string, status: MessageStatus): void {
    this.statuses.set(sid, {
      sid,
      status,
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    })
  }

  /**
   * Update message status
   */
  update(sid: string, status: MessageStatus, errorCode?: number, errorMessage?: string): void {
    const entry = this.statuses.get(sid) || {
      sid,
      status: 'queued' as MessageStatus,
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    }

    entry.status = status
    entry.errorCode = errorCode ?? null
    entry.errorMessage = errorMessage ?? null
    entry.updatedAt = new Date()

    this.statuses.set(sid, entry)
  }

  /**
   * Get message status
   */
  get(sid: string): SMSStatusEntry | null {
    return this.statuses.get(sid) || null
  }

  /**
   * List all tracked messages
   */
  list(): SMSStatusEntry[] {
    return Array.from(this.statuses.values())
  }

  /**
   * Clear all tracked messages
   */
  clear(): void {
    this.statuses.clear()
  }
}

// =============================================================================
// TwilioSMS Client
// =============================================================================

const DEFAULT_API_VERSION = '2010-04-01'
const DEFAULT_TIMEOUT = 30000
const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 100,
  windowMs: 1000, // 100 requests per second
}

/**
 * TwilioSMS - Focused SMS client with status tracking and rate limiting
 */
export class TwilioSMS {
  private accountSid: string
  private authToken: string
  private config: TwilioSMSConfig
  private baseUrl: string
  private _fetch: typeof fetch
  private rateLimiter: RateLimiter | null
  private statusTracker: MessageStatusTracker

  // Pipe-based send with retry
  private sendPipe: ReturnType<typeof Pipe<SMSSendRequest, SMSSendResponse>>

  constructor(config: TwilioSMSConfig & { accountSid: string; authToken: string }) {
    if (!config.accountSid) {
      throw new Error('accountSid is required')
    }
    if (!config.authToken) {
      throw new Error('authToken is required')
    }

    this.accountSid = config.accountSid
    this.authToken = config.authToken
    this.config = config
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis)
    this.statusTracker = new MessageStatusTracker()

    // Build base URL
    let apiHost = 'api.twilio.com'
    if (config.edge) {
      apiHost = `api.${config.edge}.twilio.com`
    }
    if (config.region) {
      apiHost = `api.${config.region}.twilio.com`
    }
    this.baseUrl = `https://${apiHost}`

    // Initialize rate limiter
    this.rateLimiter = config.rateLimit
      ? new RateLimiter(config.rateLimit)
      : null

    // Initialize send pipe with retry logic
    this.sendPipe = Pipe<SMSSendRequest, SMSSendResponse>(async (request) => {
      return this._sendMessage(request)
    }).retry({
      maxAttempts: config.autoRetry ? (config.maxRetries ?? 3) : 1,
      delayMs: 1000,
      backoffMultiplier: 2,
      maxDelayMs: 8000,
      retryOn: (error) => {
        // Don't retry client errors (4xx)
        if (error instanceof TwilioSMSError && error.status >= 400 && error.status < 500) {
          return false
        }
        // Don't retry rate limit errors
        if (error instanceof RateLimitError) {
          return false
        }
        return true
      },
    })
  }

  /**
   * Send an SMS message
   */
  async send(request: SMSSendRequest): Promise<SMSSendResponse> {
    // Validate required fields
    this._validateRequest(request)

    // Apply defaults
    const normalizedRequest: SMSSendRequest = {
      ...request,
      from: request.from || this.config.defaultFrom,
      messagingServiceSid: request.messagingServiceSid || this.config.defaultMessagingServiceSid,
    }

    // Check rate limit
    if (this.rateLimiter) {
      const key = this.config.rateLimit?.keyFn?.(normalizedRequest) || 'global'
      const { allowed, retryAfter } = await this.rateLimiter.acquire(key)
      if (!allowed) {
        throw new RateLimitError(retryAfter!)
      }
    }

    // Send via pipe (includes retry logic)
    return this.sendPipe.process(normalizedRequest)
  }

  /**
   * Send multiple SMS messages (batch)
   */
  async sendBatch(requests: SMSSendRequest[]): Promise<SMSSendResponse[]> {
    const results: SMSSendResponse[] = []
    const errors: Array<{ index: number; error: Error }> = []

    for (let i = 0; i < requests.length; i++) {
      try {
        const result = await this.send(requests[i])
        results.push(result)
      } catch (error) {
        errors.push({ index: i, error: error as Error })
      }
    }

    if (errors.length > 0) {
      const errorMessage = errors.map((e) => `[${e.index}]: ${e.error.message}`).join('; ')
      console.warn(`Batch send completed with ${errors.length} errors: ${errorMessage}`)
    }

    return results
  }

  /**
   * Get message status from Twilio API
   */
  async getStatus(sid: string): Promise<SMSStatusEntry> {
    const response = await this._request(
      'GET',
      `/${DEFAULT_API_VERSION}/Accounts/${this.accountSid}/Messages/${sid}.json`
    ) as Message

    const entry: SMSStatusEntry = {
      sid: response.sid,
      status: response.status,
      errorCode: response.error_code,
      errorMessage: response.error_message,
      updatedAt: new Date(response.date_updated),
    }

    // Update local tracker
    this.statusTracker.update(sid, entry.status, entry.errorCode ?? undefined, entry.errorMessage ?? undefined)

    return entry
  }

  /**
   * Get locally tracked message status
   */
  getTrackedStatus(sid: string): SMSStatusEntry | null {
    return this.statusTracker.get(sid)
  }

  /**
   * List messages from Twilio API
   */
  async list(params?: MessageListParams): Promise<SMSSendResponse[]> {
    const apiParams: Record<string, unknown> = {}

    if (params) {
      if (params.to) apiParams.To = params.to
      if (params.from) apiParams.From = params.from
      if (params.dateSent) apiParams.DateSent = params.dateSent.toISOString().split('T')[0]
      if (params.dateSentAfter) apiParams['DateSent>'] = params.dateSentAfter.toISOString().split('T')[0]
      if (params.dateSentBefore) apiParams['DateSent<'] = params.dateSentBefore.toISOString().split('T')[0]
      if (params.pageSize) apiParams.PageSize = params.pageSize
      if (params.page !== undefined) apiParams.Page = params.page
    }

    const response = await this._request(
      'GET',
      `/${DEFAULT_API_VERSION}/Accounts/${this.accountSid}/Messages.json`,
      apiParams
    ) as { messages: Message[] }

    return (response.messages || []).map(this._messageToResponse)
  }

  /**
   * Cancel a scheduled message
   */
  async cancel(sid: string): Promise<SMSStatusEntry> {
    const response = await this._request(
      'POST',
      `/${DEFAULT_API_VERSION}/Accounts/${this.accountSid}/Messages/${sid}.json`,
      { Status: 'canceled' }
    ) as Message

    const entry: SMSStatusEntry = {
      sid: response.sid,
      status: response.status,
      errorCode: response.error_code,
      errorMessage: response.error_message,
      updatedAt: new Date(response.date_updated),
    }

    this.statusTracker.update(sid, entry.status)
    return entry
  }

  /**
   * Delete a message
   */
  async delete(sid: string): Promise<boolean> {
    await this._request(
      'DELETE',
      `/${DEFAULT_API_VERSION}/Accounts/${this.accountSid}/Messages/${sid}.json`
    )
    return true
  }

  /**
   * Handle incoming webhook from Twilio
   */
  handleWebhook(payload: MessageWebhookPayload): SMSStatusEntry {
    const entry: SMSStatusEntry = {
      sid: payload.MessageSid,
      status: payload.SmsStatus,
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    }

    this.statusTracker.update(payload.MessageSid, payload.SmsStatus)

    return entry
  }

  /**
   * Verify webhook signature
   */
  async verifyWebhookSignature(
    signature: string,
    url: string,
    params: Record<string, string>
  ): Promise<boolean> {
    const secret = this.config.webhookSecret || this.authToken
    const expectedSignature = await this._getExpectedSignature(secret, url, params)
    return this._secureCompare(signature, expectedSignature)
  }

  /**
   * Create a Hono router for handling webhooks
   */
  createWebhookHandler(): Hono {
    const router = new Hono()

    // Status callback webhook
    router.post('/status', async (c) => {
      const contentType = c.req.header('Content-Type') || ''

      let payload: Record<string, string>
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await c.req.parseBody()
        payload = Object.fromEntries(
          Object.entries(formData).map(([k, v]) => [k, String(v)])
        )
      } else {
        payload = await c.req.json()
      }

      // Verify signature if configured
      const signature = c.req.header('X-Twilio-Signature')
      if (signature && this.config.webhookSecret) {
        const url = c.req.url
        const isValid = await this.verifyWebhookSignature(signature, url, payload)
        if (!isValid) {
          return c.json({ error: 'Invalid signature' }, 403)
        }
      }

      const webhookPayload: MessageWebhookPayload = {
        MessageSid: payload.MessageSid,
        AccountSid: payload.AccountSid,
        MessagingServiceSid: payload.MessagingServiceSid,
        From: payload.From,
        To: payload.To,
        Body: payload.Body,
        NumMedia: payload.NumMedia,
        NumSegments: payload.NumSegments,
        SmsStatus: payload.SmsStatus as MessageStatus,
        SmsSid: payload.SmsSid,
        SmsMessageSid: payload.SmsMessageSid,
        ApiVersion: payload.ApiVersion,
        MediaContentType0: payload.MediaContentType0,
        MediaUrl0: payload.MediaUrl0,
      }

      this.handleWebhook(webhookPayload)

      return new Response(null, { status: 204 })
    })

    // Inbound message webhook
    router.post('/inbound', async (c) => {
      const contentType = c.req.header('Content-Type') || ''

      let payload: Record<string, string>
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await c.req.parseBody()
        payload = Object.fromEntries(
          Object.entries(formData).map(([k, v]) => [k, String(v)])
        )
      } else {
        payload = await c.req.json()
      }

      // Verify signature if configured
      const signature = c.req.header('X-Twilio-Signature')
      if (signature && this.config.webhookSecret) {
        const url = c.req.url
        const isValid = await this.verifyWebhookSignature(signature, url, payload)
        if (!isValid) {
          return c.json({ error: 'Invalid signature' }, 403)
        }
      }

      // Return empty TwiML response
      return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
        'Content-Type': 'application/xml',
      })
    })

    return router
  }

  /**
   * Get rate limit status
   */
  getRateLimitStatus(key = 'global'): { remaining: number; reset: number } | null {
    if (!this.rateLimiter) return null
    return this.rateLimiter.getStatus(key)
  }

  /**
   * Clear all tracked statuses
   */
  clearTrackedStatuses(): void {
    this.statusTracker.clear()
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  /**
   * Validate send request
   */
  private _validateRequest(request: SMSSendRequest): void {
    if (!request.to) {
      throw new TwilioSMSError({
        code: 21604,
        message: "The 'To' phone number is required.",
        more_info: 'https://www.twilio.com/docs/errors/21604',
        status: 400,
      })
    }

    if (!request.body && !request.mediaUrl?.length) {
      throw new TwilioSMSError({
        code: 21602,
        message: "A 'Body' or 'MediaUrl' parameter is required.",
        more_info: 'https://www.twilio.com/docs/errors/21602',
        status: 400,
      })
    }

    if (!request.from && !request.messagingServiceSid && !this.config.defaultFrom && !this.config.defaultMessagingServiceSid) {
      throw new TwilioSMSError({
        code: 21603,
        message: "A 'From' phone number or 'MessagingServiceSid' is required.",
        more_info: 'https://www.twilio.com/docs/errors/21603',
        status: 400,
      })
    }

    // Validate E.164 format
    if (!this._isValidPhoneNumber(request.to)) {
      throw new TwilioSMSError({
        code: 21211,
        message: "The 'To' number is not a valid phone number.",
        more_info: 'https://www.twilio.com/docs/errors/21211',
        status: 400,
      })
    }

    if (request.from && !this._isValidPhoneNumber(request.from) && !request.from.startsWith('MG')) {
      throw new TwilioSMSError({
        code: 21212,
        message: "The 'From' number is not a valid phone number.",
        more_info: 'https://www.twilio.com/docs/errors/21212',
        status: 400,
      })
    }
  }

  /**
   * Validate phone number (E.164 format or WhatsApp)
   */
  private _isValidPhoneNumber(phone: string): boolean {
    // E.164 format
    if (/^\+[1-9]\d{1,14}$/.test(phone)) {
      return true
    }
    // WhatsApp format
    if (/^whatsapp:\+[1-9]\d{1,14}$/.test(phone)) {
      return true
    }
    return false
  }

  /**
   * Send message via Twilio API
   */
  private async _sendMessage(request: SMSSendRequest): Promise<SMSSendResponse> {
    const apiParams: Record<string, unknown> = {
      To: request.to,
      Body: request.body,
      From: request.from,
      MessagingServiceSid: request.messagingServiceSid,
      MediaUrl: request.mediaUrl,
      StatusCallback: request.statusCallback,
      ValidityPeriod: request.validityPeriod,
      ForceDelivery: request.forceDelivery,
      SendAt: request.sendAt?.toISOString(),
      SendAsMms: request.sendAsMms,
      ShortenUrls: request.shortenUrls,
    }

    // Remove undefined values
    Object.keys(apiParams).forEach((key) => {
      if (apiParams[key] === undefined) delete apiParams[key]
    })

    const response = await this._request(
      'POST',
      `/${DEFAULT_API_VERSION}/Accounts/${this.accountSid}/Messages.json`,
      apiParams
    ) as Message

    // Track the message
    this.statusTracker.track(response.sid, response.status)

    return this._messageToResponse(response)
  }

  /**
   * Convert Twilio Message to SMSSendResponse
   */
  private _messageToResponse = (message: Message): SMSSendResponse => {
    return {
      sid: message.sid,
      accountSid: message.account_sid,
      to: message.to,
      from: message.from,
      body: message.body,
      status: message.status,
      direction: message.direction,
      dateCreated: new Date(message.date_created),
      dateSent: message.date_sent ? new Date(message.date_sent) : null,
      errorCode: message.error_code,
      errorMessage: message.error_message,
      numSegments: parseInt(message.num_segments, 10),
      price: message.price,
      priceUnit: message.price_unit,
    }
  }

  /**
   * Make API request to Twilio
   */
  private async _request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    const url = new URL(path, this.baseUrl)

    // Add query params for GET requests
    if (method === 'GET' && params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    // Build Basic Auth header
    const auth = btoa(`${this.accountSid}:${this.authToken}`)

    const headers: Record<string, string> = {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }

    // Build request body for POST
    let body: string | undefined
    if (method === 'POST' && params) {
      body = this._encodeFormData(params)
    }

    const controller = new AbortController()
    const timeout = this.config.timeout ?? DEFAULT_TIMEOUT
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await this._fetch(url.toString(), {
        method,
        headers,
        body,
        signal: controller.signal,
      })

      if (method === 'DELETE' && response.status === 204) {
        return true
      }

      const data = await response.json()

      if (!response.ok) {
        throw new TwilioSMSError(data as TwilioErrorResponse)
      }

      return data
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Encode form data
   */
  private _encodeFormData(data: Record<string, unknown>, prefix = ''): string {
    const parts: string[] = []

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue

      const fullKey = prefix ? `${prefix}[${key}]` : key

      if (value === null || value === '') {
        parts.push(`${encodeURIComponent(fullKey)}=`)
      } else if (Array.isArray(value)) {
        value.forEach((item) => {
          parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(item))}`)
        })
      } else if (typeof value === 'object') {
        parts.push(this._encodeFormData(value as Record<string, unknown>, fullKey))
      } else {
        parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`)
      }
    }

    return parts.filter((p) => p).join('&')
  }

  /**
   * Get expected Twilio signature
   */
  private async _getExpectedSignature(
    authToken: string,
    url: string,
    params: Record<string, string>
  ): Promise<string> {
    const sortedKeys = Object.keys(params).sort()
    let data = url
    for (const key of sortedKeys) {
      data += key + params[key]
    }

    const encoder = new TextEncoder()
    const keyData = encoder.encode(authToken)
    const messageData = encoder.encode(data)

    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    )

    const signature = await crypto.subtle.sign('HMAC', key, messageData)
    const signatureBytes = new Uint8Array(signature)
    return btoa(Array.from(signatureBytes).map((b) => String.fromCharCode(b)).join(''))
  }

  /**
   * Constant-time string comparison
   */
  private _secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false

    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return result === 0
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a TwilioSMS client
 */
export function createTwilioSMS(
  accountSid: string,
  authToken: string,
  config?: Omit<TwilioSMSConfig, 'accountSid' | 'authToken'>
): TwilioSMS {
  return new TwilioSMS({ accountSid, authToken, ...config })
}

// =============================================================================
// Exports
// =============================================================================

export default TwilioSMS
