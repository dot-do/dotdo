/**
 * payments.do - Webhook Handling
 *
 * Multi-provider webhook handling with signature verification and idempotency.
 */

/// <reference types="@cloudflare/workers-types" />

import type {
  PaymentProvider,
  WebhookEvent,
  WebhookEventLog,
  WebhookEventType,
} from './types'

// =============================================================================
// Webhook Signature Verification
// =============================================================================

/**
 * Verify Stripe webhook signature
 */
export async function verifyStripeSignature(
  payload: string | ArrayBuffer,
  signature: string,
  secret: string,
  tolerance = 300
): Promise<{ valid: boolean; error?: string }> {
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
    return { valid: false, error: 'Unable to extract timestamp from signature header' }
  }

  if (signatureParts.signatures.length === 0) {
    return { valid: false, error: 'No valid signature found in header' }
  }

  // Check timestamp tolerance
  const now = Math.floor(Date.now() / 1000)
  if (now - signatureParts.timestamp > tolerance) {
    return { valid: false, error: `Webhook timestamp too old. Timestamp: ${signatureParts.timestamp}, now: ${now}` }
  }

  // Compute expected signature
  const signedPayload = `${signatureParts.timestamp}.${payloadString}`
  const expectedSignature = await computeHmacSignature(signedPayload, secret)

  // Verify at least one signature matches
  const isValid = signatureParts.signatures.some(
    (sig) => secureCompare(sig, expectedSignature)
  )

  if (!isValid) {
    return { valid: false, error: 'Webhook signature verification failed' }
  }

  return { valid: true }
}

/**
 * Verify Paddle webhook signature
 */
export async function verifyPaddleSignature(
  payload: string,
  signature: string,
  publicKey: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Paddle uses RSA signatures
    const encoder = new TextEncoder()
    const data = encoder.encode(payload)

    // Import the public key
    const key = await crypto.subtle.importKey(
      'spki',
      base64ToArrayBuffer(publicKey),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' },
      false,
      ['verify']
    )

    // Verify the signature
    const signatureBuffer = base64ToArrayBuffer(signature)
    const isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      signatureBuffer,
      data
    )

    return { valid: isValid }
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : 'Signature verification failed' }
  }
}

/**
 * Verify LemonSqueezy webhook signature
 */
export async function verifyLemonSqueezySignature(
  payload: string,
  signature: string,
  secret: string
): Promise<{ valid: boolean; error?: string }> {
  const expectedSignature = await computeHmacSignature(payload, secret, 'SHA-256')
  const isValid = secureCompare(signature, expectedSignature)

  if (!isValid) {
    return { valid: false, error: 'Webhook signature verification failed' }
  }

  return { valid: true }
}

// =============================================================================
// Event Parsing
// =============================================================================

/**
 * Parse Stripe webhook event
 */
export function parseStripeEvent(payload: string): WebhookEvent {
  const data = JSON.parse(payload) as {
    id: string
    type: string
    data: { object: unknown; previous_attributes?: Record<string, unknown> }
    created: number
    livemode: boolean
    request?: { id?: string; idempotency_key?: string }
  }

  return {
    id: data.id,
    object: 'event',
    type: data.type as WebhookEventType,
    data: data.data,
    created: data.created,
    livemode: data.livemode,
    provider: 'stripe',
    request: data.request ? {
      id: data.request.id ?? null,
      idempotency_key: data.request.idempotency_key ?? null,
    } : null,
  }
}

/**
 * Parse Paddle webhook event
 */
export function parsePaddleEvent(payload: string): WebhookEvent {
  const data = JSON.parse(payload) as {
    alert_name: string
    alert_id: string
    [key: string]: unknown
  }

  // Map Paddle alert names to our event types
  const eventTypeMap: Record<string, WebhookEventType> = {
    subscription_created: 'subscription.created',
    subscription_updated: 'subscription.updated',
    subscription_cancelled: 'subscription.canceled',
    subscription_payment_succeeded: 'invoice.paid',
    subscription_payment_failed: 'invoice.payment_failed',
    payment_succeeded: 'payment_intent.succeeded',
    payment_refunded: 'refund.succeeded',
  }

  return {
    id: data.alert_id,
    object: 'event',
    type: eventTypeMap[data.alert_name] || data.alert_name,
    data: { object: data },
    created: Math.floor(Date.now() / 1000),
    livemode: true, // Paddle doesn't have sandbox events in payload
    provider: 'paddle',
    request: null,
  }
}

/**
 * Parse LemonSqueezy webhook event
 */
export function parseLemonSqueezyEvent(payload: string): WebhookEvent {
  const data = JSON.parse(payload) as {
    meta: { event_name: string; custom_data?: Record<string, unknown> }
    data: { id: string; attributes: Record<string, unknown> }
  }

  // Map LemonSqueezy event names to our event types
  const eventTypeMap: Record<string, WebhookEventType> = {
    subscription_created: 'subscription.created',
    subscription_updated: 'subscription.updated',
    subscription_cancelled: 'subscription.canceled',
    subscription_resumed: 'subscription.resumed',
    subscription_paused: 'subscription.paused',
    order_created: 'payment_intent.succeeded',
    order_refunded: 'refund.succeeded',
  }

  return {
    id: data.data.id,
    object: 'event',
    type: eventTypeMap[data.meta.event_name] || data.meta.event_name,
    data: { object: data.data },
    created: Math.floor(Date.now() / 1000),
    livemode: true,
    provider: 'lemonsqueezy',
    request: null,
  }
}

// =============================================================================
// Webhook Event Log Storage Interface
// =============================================================================

export interface WebhookEventStorage {
  /**
   * Check if an event has already been processed
   */
  hasProcessed(eventId: string, provider: PaymentProvider): Promise<boolean>

  /**
   * Get event log by event ID
   */
  getLog(eventId: string, provider: PaymentProvider): Promise<WebhookEventLog | null>

  /**
   * Save event log
   */
  saveLog(log: WebhookEventLog): Promise<void>

  /**
   * Update event log status
   */
  updateLogStatus(
    eventId: string,
    provider: PaymentProvider,
    status: 'processing' | 'succeeded' | 'failed',
    error?: string
  ): Promise<void>

  /**
   * Increment retry count
   */
  incrementRetry(eventId: string, provider: PaymentProvider): Promise<void>

  /**
   * Get events for replay (failed or pending)
   */
  getEventsForReplay(
    provider?: PaymentProvider,
    limit?: number
  ): Promise<WebhookEventLog[]>
}

/**
 * In-memory webhook event storage (for testing)
 */
export class InMemoryWebhookStorage implements WebhookEventStorage {
  private logs: Map<string, WebhookEventLog> = new Map()

  private getKey(eventId: string, provider: PaymentProvider): string {
    return `${provider}:${eventId}`
  }

  async hasProcessed(eventId: string, provider: PaymentProvider): Promise<boolean> {
    const log = this.logs.get(this.getKey(eventId, provider))
    return log?.status === 'succeeded'
  }

  async getLog(eventId: string, provider: PaymentProvider): Promise<WebhookEventLog | null> {
    return this.logs.get(this.getKey(eventId, provider)) ?? null
  }

  async saveLog(log: WebhookEventLog): Promise<void> {
    this.logs.set(this.getKey(log.event_id, log.provider), log)
  }

  async updateLogStatus(
    eventId: string,
    provider: PaymentProvider,
    status: 'processing' | 'succeeded' | 'failed',
    error?: string
  ): Promise<void> {
    const key = this.getKey(eventId, provider)
    const log = this.logs.get(key)
    if (log) {
      log.status = status
      if (error) log.error = error
    }
  }

  async incrementRetry(eventId: string, provider: PaymentProvider): Promise<void> {
    const key = this.getKey(eventId, provider)
    const log = this.logs.get(key)
    if (log) {
      log.retries++
    }
  }

  async getEventsForReplay(
    provider?: PaymentProvider,
    limit = 100
  ): Promise<WebhookEventLog[]> {
    const events: WebhookEventLog[] = []

    for (const log of this.logs.values()) {
      if (log.status === 'failed' || log.status === 'processing') {
        if (!provider || log.provider === provider) {
          events.push(log)
          if (events.length >= limit) break
        }
      }
    }

    return events
  }
}

/**
 * SQLite-backed webhook event storage (for Durable Objects)
 */
export class SQLiteWebhookStorage implements WebhookEventStorage {
  private sql: SqlStorage

  constructor(sql: SqlStorage) {
    this.sql = sql
    this.ensureTable()
  }

  private ensureTable(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        provider TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        processed_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        retries INTEGER DEFAULT 0,
        UNIQUE(event_id, provider)
      )
    `)

    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_webhook_status ON webhook_events(status, provider)
    `)
  }

  async hasProcessed(eventId: string, provider: PaymentProvider): Promise<boolean> {
    const result = this.sql.exec(
      `SELECT status FROM webhook_events WHERE event_id = ? AND provider = ?`,
      eventId,
      provider
    )
    const rows = result.toArray()
    return rows.length > 0 && (rows[0] as { status: string }).status === 'succeeded'
  }

  async getLog(eventId: string, provider: PaymentProvider): Promise<WebhookEventLog | null> {
    const result = this.sql.exec(
      `SELECT * FROM webhook_events WHERE event_id = ? AND provider = ?`,
      eventId,
      provider
    )
    const rows = result.toArray()
    if (rows.length === 0) return null

    const row = rows[0] as Record<string, unknown>
    return {
      id: row.id as string,
      event_id: row.event_id as string,
      event_type: row.event_type as WebhookEventType,
      provider: row.provider as PaymentProvider,
      payload_hash: row.payload_hash as string,
      processed_at: row.processed_at as number,
      status: row.status as 'processing' | 'succeeded' | 'failed',
      error: row.error as string | undefined,
      retries: row.retries as number,
    }
  }

  async saveLog(log: WebhookEventLog): Promise<void> {
    this.sql.exec(
      `INSERT OR REPLACE INTO webhook_events
       (id, event_id, event_type, provider, payload_hash, processed_at, status, error, retries)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      log.id,
      log.event_id,
      log.event_type,
      log.provider,
      log.payload_hash,
      log.processed_at,
      log.status,
      log.error ?? null,
      log.retries
    )
  }

  async updateLogStatus(
    eventId: string,
    provider: PaymentProvider,
    status: 'processing' | 'succeeded' | 'failed',
    error?: string
  ): Promise<void> {
    if (error) {
      this.sql.exec(
        `UPDATE webhook_events SET status = ?, error = ? WHERE event_id = ? AND provider = ?`,
        status,
        error,
        eventId,
        provider
      )
    } else {
      this.sql.exec(
        `UPDATE webhook_events SET status = ? WHERE event_id = ? AND provider = ?`,
        status,
        eventId,
        provider
      )
    }
  }

  async incrementRetry(eventId: string, provider: PaymentProvider): Promise<void> {
    this.sql.exec(
      `UPDATE webhook_events SET retries = retries + 1 WHERE event_id = ? AND provider = ?`,
      eventId,
      provider
    )
  }

  async getEventsForReplay(
    provider?: PaymentProvider,
    limit = 100
  ): Promise<WebhookEventLog[]> {
    let query = `SELECT * FROM webhook_events WHERE status IN ('failed', 'processing')`
    const params: unknown[] = []

    if (provider) {
      query += ` AND provider = ?`
      params.push(provider)
    }

    query += ` ORDER BY processed_at ASC LIMIT ?`
    params.push(limit)

    const result = this.sql.exec(query, ...params)
    const rows = result.toArray()

    return rows.map((row) => {
      const r = row as Record<string, unknown>
      return {
        id: r.id as string,
        event_id: r.event_id as string,
        event_type: r.event_type as WebhookEventType,
        provider: r.provider as PaymentProvider,
        payload_hash: r.payload_hash as string,
        processed_at: r.processed_at as number,
        status: r.status as 'processing' | 'succeeded' | 'failed',
        error: r.error as string | undefined,
        retries: r.retries as number,
      }
    })
  }
}

// =============================================================================
// Webhook Handler
// =============================================================================

export interface WebhookHandlerConfig {
  storage: WebhookEventStorage
  onEvent?: (event: WebhookEvent) => Promise<void>
  maxRetries?: number
}

export class WebhookHandler {
  private storage: WebhookEventStorage
  private onEvent?: (event: WebhookEvent) => Promise<void>
  private maxRetries: number

  constructor(config: WebhookHandlerConfig) {
    this.storage = config.storage
    this.onEvent = config.onEvent
    this.maxRetries = config.maxRetries ?? 3
  }

  /**
   * Handle incoming webhook
   */
  async handle(
    provider: PaymentProvider,
    payload: string,
    signature: string,
    secret: string
  ): Promise<{ success: boolean; error?: string; event?: WebhookEvent }> {
    // 1. Verify signature
    const verification = await this.verifySignature(provider, payload, signature, secret)
    if (!verification.valid) {
      return { success: false, error: verification.error }
    }

    // 2. Parse event
    const event = this.parseEvent(provider, payload)

    // 3. Check idempotency
    if (await this.storage.hasProcessed(event.id, provider)) {
      return { success: true, event } // Already processed, skip
    }

    // 4. Create log entry
    const log: WebhookEventLog = {
      id: crypto.randomUUID(),
      event_id: event.id,
      event_type: event.type,
      provider,
      payload_hash: await this.hashPayload(payload),
      processed_at: Math.floor(Date.now() / 1000),
      status: 'processing',
      retries: 0,
    }
    await this.storage.saveLog(log)

    // 5. Process event
    try {
      if (this.onEvent) {
        await this.onEvent(event)
      }
      await this.storage.updateLogStatus(event.id, provider, 'succeeded')
      return { success: true, event }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await this.storage.updateLogStatus(event.id, provider, 'failed', errorMessage)
      return { success: false, error: errorMessage, event }
    }
  }

  /**
   * Retry failed events
   */
  async retryFailed(provider?: PaymentProvider): Promise<{ processed: number; failed: number }> {
    const events = await this.storage.getEventsForReplay(provider)
    let processed = 0
    let failed = 0

    for (const log of events) {
      if (log.retries >= this.maxRetries) {
        failed++
        continue
      }

      await this.storage.incrementRetry(log.event_id, log.provider)

      try {
        // Re-process would require storing original payload
        // For now, just mark as needing manual review
        await this.storage.updateLogStatus(log.event_id, log.provider, 'failed', 'Max retries exceeded')
        failed++
      } catch {
        failed++
      }
    }

    return { processed, failed }
  }

  private async verifySignature(
    provider: PaymentProvider,
    payload: string,
    signature: string,
    secret: string
  ): Promise<{ valid: boolean; error?: string }> {
    switch (provider) {
      case 'stripe':
        return verifyStripeSignature(payload, signature, secret)
      case 'paddle':
        return verifyPaddleSignature(payload, signature, secret)
      case 'lemonsqueezy':
        return verifyLemonSqueezySignature(payload, signature, secret)
      default:
        return { valid: false, error: `Unknown provider: ${provider}` }
    }
  }

  private parseEvent(provider: PaymentProvider, payload: string): WebhookEvent {
    switch (provider) {
      case 'stripe':
        return parseStripeEvent(payload)
      case 'paddle':
        return parsePaddleEvent(payload)
      case 'lemonsqueezy':
        return parseLemonSqueezyEvent(payload)
      default:
        throw new Error(`Unknown provider: ${provider}`)
    }
  }

  private async hashPayload(payload: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(payload)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

async function computeHmacSignature(
  payload: string,
  secret: string,
  algorithm: 'SHA-256' = 'SHA-256'
): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const payloadData = encoder.encode(payload)

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign('HMAC', key, payloadData)
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * Generate test webhook signature (for testing only)
 */
export async function generateTestStripeSignature(options: {
  payload: string
  secret: string
  timestamp?: number
}): Promise<string> {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000)
  const signedPayload = `${timestamp}.${options.payload}`
  const signature = await computeHmacSignature(signedPayload, options.secret)
  return `t=${timestamp},v1=${signature}`
}
