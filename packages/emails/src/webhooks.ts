/**
 * @dotdo/emails - Email Webhooks
 *
 * Webhook handling for email events (delivered, bounced, opened, clicked, etc.)
 */

/// <reference types="@cloudflare/workers-types" />

import type {
  WebhookEvent,
  WebhookEventType,
  WebhookSubscription,
} from './types'

// ============================================================================
// Webhook Storage
// ============================================================================

export interface WebhookStorage {
  getSubscription(id: string): Promise<WebhookSubscription | null>
  getSubscriptionsByEvent(event: WebhookEventType): Promise<WebhookSubscription[]>
  setSubscription(subscription: WebhookSubscription): Promise<void>
  deleteSubscription(id: string): Promise<void>
  listSubscriptions(): Promise<WebhookSubscription[]>
}

/**
 * In-memory webhook storage
 */
export class InMemoryWebhookStorage implements WebhookStorage {
  private subscriptions: Map<string, WebhookSubscription> = new Map()

  async getSubscription(id: string): Promise<WebhookSubscription | null> {
    return this.subscriptions.get(id) || null
  }

  async getSubscriptionsByEvent(event: WebhookEventType): Promise<WebhookSubscription[]> {
    return Array.from(this.subscriptions.values()).filter(
      (sub) => sub.enabled && sub.events.includes(event)
    )
  }

  async setSubscription(subscription: WebhookSubscription): Promise<void> {
    this.subscriptions.set(subscription.id, subscription)
  }

  async deleteSubscription(id: string): Promise<void> {
    this.subscriptions.delete(id)
  }

  async listSubscriptions(): Promise<WebhookSubscription[]> {
    return Array.from(this.subscriptions.values())
  }

  clear(): void {
    this.subscriptions.clear()
  }
}

/**
 * SQLite-backed webhook storage (for DO storage)
 */
export class SQLiteWebhookStorage implements WebhookStorage {
  private sql: SqlStorage

  constructor(sql: SqlStorage) {
    this.sql = sql
    this.init()
  }

  private init(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS webhook_subscriptions (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        events TEXT NOT NULL,
        secret TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      )
    `)
  }

  async getSubscription(id: string): Promise<WebhookSubscription | null> {
    const cursor = this.sql.exec(
      'SELECT * FROM webhook_subscriptions WHERE id = ?',
      id
    )
    const rows = cursor.toArray()
    if (rows.length === 0) return null

    return this.rowToSubscription(rows[0] as Record<string, unknown>)
  }

  async getSubscriptionsByEvent(event: WebhookEventType): Promise<WebhookSubscription[]> {
    const cursor = this.sql.exec(
      'SELECT * FROM webhook_subscriptions WHERE enabled = 1'
    )
    const rows = cursor.toArray()
    return rows
      .map((row) => this.rowToSubscription(row as Record<string, unknown>))
      .filter((sub) => sub.events.includes(event))
  }

  async setSubscription(subscription: WebhookSubscription): Promise<void> {
    this.sql.exec(
      `INSERT OR REPLACE INTO webhook_subscriptions
       (id, url, events, secret, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      subscription.id,
      subscription.url,
      JSON.stringify(subscription.events),
      subscription.secret || null,
      subscription.enabled ? 1 : 0,
      subscription.created_at.toISOString()
    )
  }

  async deleteSubscription(id: string): Promise<void> {
    this.sql.exec('DELETE FROM webhook_subscriptions WHERE id = ?', id)
  }

  async listSubscriptions(): Promise<WebhookSubscription[]> {
    const cursor = this.sql.exec('SELECT * FROM webhook_subscriptions')
    const rows = cursor.toArray()
    return rows.map((row) => this.rowToSubscription(row as Record<string, unknown>))
  }

  private rowToSubscription(row: Record<string, unknown>): WebhookSubscription {
    return {
      id: row.id as string,
      url: row.url as string,
      events: JSON.parse(row.events as string),
      secret: row.secret as string | undefined,
      enabled: Boolean(row.enabled),
      created_at: new Date(row.created_at as string),
    }
  }
}

// ============================================================================
// Webhook Dispatcher
// ============================================================================

export interface WebhookDispatcherConfig {
  storage: WebhookStorage
  maxRetries?: number
  retryDelay?: number // ms
  timeout?: number // ms
}

export class WebhookDispatcher {
  private storage: WebhookStorage
  private maxRetries: number
  private retryDelay: number
  private timeout: number

  constructor(config: WebhookDispatcherConfig) {
    this.storage = config.storage
    this.maxRetries = config.maxRetries ?? 3
    this.retryDelay = config.retryDelay ?? 1000
    this.timeout = config.timeout ?? 10000
  }

  /**
   * Dispatch an email event to all subscribed webhooks
   */
  async dispatch(event: WebhookEvent): Promise<WebhookDispatchResult[]> {
    const subscriptions = await this.storage.getSubscriptionsByEvent(event.type)
    const results: WebhookDispatchResult[] = []

    for (const subscription of subscriptions) {
      const result = await this.sendWebhook(subscription, event)
      results.push(result)
    }

    return results
  }

  /**
   * Send a webhook to a specific subscription
   */
  private async sendWebhook(
    subscription: WebhookSubscription,
    event: WebhookEvent
  ): Promise<WebhookDispatchResult> {
    const payload = this.buildPayload(event)
    const signature = subscription.secret
      ? await this.signPayload(JSON.stringify(payload), subscription.secret)
      : undefined

    let lastError: Error | undefined
    let attempts = 0

    while (attempts < this.maxRetries) {
      attempts++

      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), this.timeout)

        const response = await fetch(subscription.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(signature && { 'X-Webhook-Signature': signature }),
            'X-Webhook-Event': event.type,
            'X-Webhook-ID': event.id,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (response.ok) {
          return {
            subscription_id: subscription.id,
            success: true,
            status_code: response.status,
            attempts,
          }
        }

        lastError = new Error(`HTTP ${response.status}: ${await response.text()}`)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
      }

      // Wait before retry
      if (attempts < this.maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay * attempts))
      }
    }

    return {
      subscription_id: subscription.id,
      success: false,
      error: lastError?.message || 'Unknown error',
      attempts,
    }
  }

  /**
   * Build webhook payload
   */
  private buildPayload(event: WebhookEvent): WebhookPayload {
    return {
      id: event.id,
      type: event.type,
      created_at: event.timestamp.toISOString(),
      data: {
        email_id: event.email_id,
        recipient: event.recipient,
        ...(event.url && { url: event.url }),
        ...(event.bounce_type && { bounce_type: event.bounce_type }),
        ...(event.bounce_reason && { bounce_reason: event.bounce_reason }),
        ...(event.metadata && { metadata: event.metadata }),
      },
    }
  }

  /**
   * Sign payload with HMAC-SHA256
   */
  private async signPayload(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
    const hashArray = Array.from(new Uint8Array(signature))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }
}

export interface WebhookDispatchResult {
  subscription_id: string
  success: boolean
  status_code?: number
  error?: string
  attempts: number
}

export interface WebhookPayload {
  id: string
  type: WebhookEventType
  created_at: string
  data: {
    email_id: string
    recipient: string
    url?: string
    bounce_type?: 'hard' | 'soft'
    bounce_reason?: string
    metadata?: Record<string, unknown>
  }
}

// ============================================================================
// Event Processing
// ============================================================================

/**
 * Process SendGrid webhook events
 */
export function parseSendGridWebhook(body: unknown[]): WebhookEvent[] {
  if (!Array.isArray(body)) return []

  return body
    .map((event) => {
      const e = event as Record<string, unknown>
      const type = mapSendGridEventType(e.event as string)
      if (!type) return null

      return {
        id: crypto.randomUUID(),
        type,
        email_id: e.sg_message_id as string || '',
        recipient: e.email as string || '',
        timestamp: new Date((e.timestamp as number) * 1000),
        url: e.url as string | undefined,
        bounce_type: e.type === 'bounce' ? (e.bounce_type as 'hard' | 'soft') : undefined,
        bounce_reason: e.reason as string | undefined,
        metadata: {
          ip: e.ip,
          useragent: e.useragent,
          sg_event_id: e.sg_event_id,
        },
      } as WebhookEvent
    })
    .filter((e): e is WebhookEvent => e !== null)
}

function mapSendGridEventType(sgEvent: string): WebhookEventType | null {
  const mapping: Record<string, WebhookEventType> = {
    delivered: 'delivered',
    bounce: 'bounced',
    open: 'opened',
    click: 'clicked',
    spamreport: 'complained',
    unsubscribe: 'unsubscribed',
    dropped: 'failed',
    deferred: 'failed',
  }
  return mapping[sgEvent] || null
}

/**
 * Process Resend webhook events
 */
export function parseResendWebhook(body: unknown): WebhookEvent | null {
  const e = body as Record<string, unknown>
  const type = mapResendEventType(e.type as string)
  if (!type) return null

  const data = e.data as Record<string, unknown>
  return {
    id: crypto.randomUUID(),
    type,
    email_id: data.email_id as string || '',
    recipient: (data.to as string[])?.join(', ') || '',
    timestamp: new Date(e.created_at as string),
    url: data.url as string | undefined,
    bounce_reason: data.reason as string | undefined,
  }
}

function mapResendEventType(resendEvent: string): WebhookEventType | null {
  const mapping: Record<string, WebhookEventType> = {
    'email.sent': 'delivered',
    'email.delivered': 'delivered',
    'email.bounced': 'bounced',
    'email.opened': 'opened',
    'email.clicked': 'clicked',
    'email.complained': 'complained',
  }
  return mapping[resendEvent] || null
}

// ============================================================================
// Hono Route Handler
// ============================================================================

import { Hono } from 'hono'

export interface WebhookEnv {
  WEBHOOK_SECRET?: string
}

/**
 * Create a Hono router for webhook management
 */
export function createWebhookRouter(storage: WebhookStorage): Hono<{ Bindings: WebhookEnv }> {
  const router = new Hono<{ Bindings: WebhookEnv }>()

  // POST /webhooks - Create subscription
  router.post('/webhooks', async (c) => {
    const body = (await c.req.json()) as {
      url: string
      events: WebhookEventType[]
      secret?: string
    }

    const subscription: WebhookSubscription = {
      id: crypto.randomUUID(),
      url: body.url,
      events: body.events,
      secret: body.secret,
      enabled: true,
      created_at: new Date(),
    }

    await storage.setSubscription(subscription)
    return c.json(subscription, 201)
  })

  // GET /webhooks - List subscriptions
  router.get('/webhooks', async (c) => {
    const subscriptions = await storage.listSubscriptions()
    return c.json({ data: subscriptions })
  })

  // GET /webhooks/:id - Get subscription
  router.get('/webhooks/:id', async (c) => {
    const id = c.req.param('id')
    const subscription = await storage.getSubscription(id)
    if (!subscription) {
      return c.json({ error: 'Not found' }, 404)
    }
    return c.json(subscription)
  })

  // DELETE /webhooks/:id - Delete subscription
  router.delete('/webhooks/:id', async (c) => {
    const id = c.req.param('id')
    await storage.deleteSubscription(id)
    return c.body(null, 204)
  })

  // POST /webhooks/sendgrid - Receive SendGrid events
  router.post('/webhooks/sendgrid', async (c) => {
    const body = await c.req.json()
    const events = parseSendGridWebhook(body as unknown[])

    const dispatcher = new WebhookDispatcher({ storage })
    for (const event of events) {
      await dispatcher.dispatch(event)
    }

    return c.body(null, 200)
  })

  // POST /webhooks/resend - Receive Resend events
  router.post('/webhooks/resend', async (c) => {
    const body = await c.req.json()
    const event = parseResendWebhook(body)

    if (event) {
      const dispatcher = new WebhookDispatcher({ storage })
      await dispatcher.dispatch(event)
    }

    return c.body(null, 200)
  })

  return router
}
