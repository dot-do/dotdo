/**
 * EmailDO - Transactional Email Durable Object
 *
 * Production-grade email management with:
 * - SendGrid-compatible API
 * - Template rendering with variables
 * - Batch campaign support
 * - Webhook processing for delivery events
 * - Bounce/complaint handling with automatic suppression
 * - Unsubscribe management with one-click support
 */

import { DurableObject } from 'cloudflare:workers'

// ============================================================================
// Types
// ============================================================================

export interface EmailAddress {
  email: string
  name?: string
}

export interface EmailTemplate {
  id: string
  name: string
  subject: string
  html: string
  text?: string
  variables?: string[]
  created_at: Date
  updated_at: Date
}

export type WebhookEventType =
  | 'delivered'
  | 'bounced'
  | 'opened'
  | 'clicked'
  | 'complained'
  | 'unsubscribed'
  | 'failed'

export interface WebhookEvent {
  id: string
  type: WebhookEventType
  email_id: string
  recipient: string
  timestamp: Date
  metadata?: Record<string, unknown>
  url?: string
  bounce_type?: 'hard' | 'soft'
  bounce_reason?: string
}

export interface WebhookSubscription {
  id: string
  url: string
  events: WebhookEventType[]
  secret?: string
  enabled: boolean
  created_at: Date
}

export interface User {
  id: string
  email: string
  name: string
  preferences?: {
    marketing?: boolean
    transactional?: boolean
    digest?: boolean
  }
}

export interface Campaign {
  id: string
  name: string
  template_id: string
  recipients: string[]
  status: 'draft' | 'sending' | 'sent' | 'failed'
  sent_count: number
  failed_count: number
  created_at: Date
  sent_at?: Date
}

export interface EmailLog {
  id: string
  to: string
  template_id?: string
  subject: string
  status: 'queued' | 'sent' | 'delivered' | 'bounced' | 'failed' | 'opened' | 'clicked'
  sent_at: Date
  delivered_at?: Date
  opened_at?: Date
  clicked_at?: Date
  bounce_type?: 'hard' | 'soft'
  bounce_reason?: string
}

export interface SuppressionEntry {
  email: string
  reason: 'bounce' | 'complaint' | 'unsubscribe'
  created_at: Date
}

export interface Env {
  EMAIL_DO: DurableObjectNamespace
  RESEND_API_KEY?: string
  SENDGRID_API_KEY?: string
  FROM_EMAIL: string
  FROM_NAME?: string
}

// ============================================================================
// Template Storage (SQLite-backed)
// ============================================================================

class SQLiteTemplateStorage {
  private sql: SqlStorage

  constructor(sql: SqlStorage) {
    this.sql = sql
    this.init()
  }

  private init(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS email_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        subject TEXT NOT NULL,
        html TEXT NOT NULL,
        text TEXT,
        variables TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
  }

  async get(id: string): Promise<EmailTemplate | null> {
    const cursor = this.sql.exec('SELECT * FROM email_templates WHERE id = ?', id)
    const rows = cursor.toArray()
    if (rows.length === 0) return null

    const row = rows[0] as Record<string, unknown>
    return {
      id: row.id as string,
      name: row.name as string,
      subject: row.subject as string,
      html: row.html as string,
      text: row.text as string | undefined,
      variables: row.variables ? JSON.parse(row.variables as string) : undefined,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
    }
  }

  async set(template: EmailTemplate): Promise<void> {
    this.sql.exec(
      `INSERT OR REPLACE INTO email_templates
       (id, name, subject, html, text, variables, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      template.id,
      template.name,
      template.subject,
      template.html,
      template.text || null,
      template.variables ? JSON.stringify(template.variables) : null,
      template.created_at.toISOString(),
      template.updated_at.toISOString()
    )
  }

  async delete(id: string): Promise<void> {
    this.sql.exec('DELETE FROM email_templates WHERE id = ?', id)
  }

  async list(): Promise<EmailTemplate[]> {
    const cursor = this.sql.exec('SELECT * FROM email_templates ORDER BY updated_at DESC')
    const rows = cursor.toArray()
    return rows.map((row) => {
      const r = row as Record<string, unknown>
      return {
        id: r.id as string,
        name: r.name as string,
        subject: r.subject as string,
        html: r.html as string,
        text: r.text as string | undefined,
        variables: r.variables ? JSON.parse(r.variables as string) : undefined,
        created_at: new Date(r.created_at as string),
        updated_at: new Date(r.updated_at as string),
      }
    })
  }
}

// ============================================================================
// Webhook Storage (SQLite-backed)
// ============================================================================

class SQLiteWebhookStorage {
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

  async getSubscriptionsByEvent(event: WebhookEventType): Promise<WebhookSubscription[]> {
    const cursor = this.sql.exec('SELECT * FROM webhook_subscriptions WHERE enabled = 1')
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
// Template Renderer (Handlebars-style)
// ============================================================================

class TemplateRenderer {
  private storage: SQLiteTemplateStorage

  constructor(storage: SQLiteTemplateStorage) {
    this.storage = storage
  }

  async render(
    templateId: string,
    data: Record<string, unknown>
  ): Promise<{ subject: string; html: string; text?: string } | null> {
    const template = await this.storage.get(templateId)
    if (!template) return null

    return {
      subject: this.renderString(template.subject, data),
      html: this.renderString(template.html, data, true),
      text: template.text ? this.renderString(template.text, data) : undefined,
    }
  }

  renderString(template: string, data: Record<string, unknown>, escapeHtml = false): string {
    let result = template
    result = this.processEach(result, data, escapeHtml)
    result = this.processIf(result, data, escapeHtml)
    result = this.processVariables(result, data, escapeHtml)
    return result
  }

  private processVariables(template: string, data: Record<string, unknown>, escapeHtml: boolean): string {
    return template.replace(/\{\{([^#/}]+)\}\}/g, (_, key) => {
      const value = this.getValue(data, key.trim())
      const stringValue = value === undefined || value === null ? '' : String(value)
      return escapeHtml ? this.escape(stringValue) : stringValue
    })
  }

  private processIf(template: string, data: Record<string, unknown>, escapeHtml: boolean): string {
    const ifRegex = /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g
    return template.replace(ifRegex, (_, condition, content) => {
      const value = this.getValue(data, condition.trim())
      if (this.isTruthy(value)) {
        return this.renderString(content, data, escapeHtml)
      }
      return ''
    })
  }

  private processEach(template: string, data: Record<string, unknown>, escapeHtml: boolean): string {
    const eachRegex = /\{\{#each\s+([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g
    return template.replace(eachRegex, (_, arrayKey, content) => {
      const array = this.getValue(data, arrayKey.trim())
      if (!Array.isArray(array)) return ''
      return array
        .map((item, index) => {
          const itemData = { ...data, this: item, '@index': index, '@first': index === 0, '@last': index === array.length - 1 }
          return this.renderString(content, itemData, escapeHtml)
        })
        .join('')
    })
  }

  private getValue(data: Record<string, unknown>, path: string): unknown {
    const keys = path.split('.')
    let value: unknown = data
    for (const key of keys) {
      if (value === null || value === undefined) return undefined
      value = (value as Record<string, unknown>)[key]
    }
    return value
  }

  private isTruthy(value: unknown): boolean {
    if (Array.isArray(value)) return value.length > 0
    return Boolean(value)
  }

  private escape(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
  }
}

// ============================================================================
// Webhook Dispatcher
// ============================================================================

class WebhookDispatcher {
  private storage: SQLiteWebhookStorage
  private maxRetries: number
  private timeout: number

  constructor(config: { storage: SQLiteWebhookStorage; maxRetries?: number; timeout?: number }) {
    this.storage = config.storage
    this.maxRetries = config.maxRetries ?? 3
    this.timeout = config.timeout ?? 10000
  }

  async dispatch(event: WebhookEvent): Promise<void> {
    const subscriptions = await this.storage.getSubscriptionsByEvent(event.type)
    for (const subscription of subscriptions) {
      await this.sendWebhook(subscription, event)
    }
  }

  private async sendWebhook(subscription: WebhookSubscription, event: WebhookEvent): Promise<void> {
    const payload = {
      id: event.id,
      type: event.type,
      created_at: event.timestamp.toISOString(),
      data: {
        email_id: event.email_id,
        recipient: event.recipient,
        ...(event.url && { url: event.url }),
        ...(event.bounce_type && { bounce_type: event.bounce_type }),
        ...(event.bounce_reason && { bounce_reason: event.bounce_reason }),
      },
    }

    const signature = subscription.secret ? await this.signPayload(JSON.stringify(payload), subscription.secret) : undefined

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
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
        if (response.ok) return
      } catch {
        // Retry on failure
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
    }
  }

  private async signPayload(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
}

// ============================================================================
// Email Sending (MailChannels + Fallback)
// ============================================================================

interface SendGridMailRequest {
  personalizations: Array<{
    to: EmailAddress[]
    cc?: EmailAddress[]
    bcc?: EmailAddress[]
    subject?: string
    dynamic_template_data?: Record<string, unknown>
  }>
  from: EmailAddress
  subject?: string
  content?: Array<{ type: string; value: string }>
  template_id?: string
}

interface SendGridMailResponse {
  statusCode: 202 | 400 | 401 | 403 | 404 | 413 | 500
  headers?: { 'x-message-id'?: string }
}

class MailService {
  private resendApiKey?: string
  private sendgridApiKey?: string

  constructor(config: { resendApiKey?: string; sendgridApiKey?: string }) {
    this.resendApiKey = config.resendApiKey
    this.sendgridApiKey = config.sendgridApiKey
  }

  async send(request: SendGridMailRequest): Promise<SendGridMailResponse> {
    // Try MailChannels first (free with Workers)
    try {
      const result = await this.sendViaMailChannels(request)
      if (result.statusCode === 202) return result
    } catch {
      // Fall through to next provider
    }

    // Try Resend if configured
    if (this.resendApiKey) {
      try {
        const result = await this.sendViaResend(request)
        if (result.statusCode === 202) return result
      } catch {
        // Fall through to next provider
      }
    }

    // Try SendGrid if configured
    if (this.sendgridApiKey) {
      try {
        return await this.sendViaSendGrid(request)
      } catch {
        // All providers failed
      }
    }

    return { statusCode: 500 }
  }

  private async sendViaMailChannels(request: SendGridMailRequest): Promise<SendGridMailResponse> {
    const personalization = request.personalizations[0]
    const htmlContent = request.content?.find((c) => c.type === 'text/html')?.value
    const textContent = request.content?.find((c) => c.type === 'text/plain')?.value

    const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [
          {
            to: personalization.to.map((t) => ({ email: t.email, name: t.name })),
          },
        ],
        from: { email: request.from.email, name: request.from.name },
        subject: personalization.subject || request.subject,
        content: [
          ...(textContent ? [{ type: 'text/plain', value: textContent }] : []),
          ...(htmlContent ? [{ type: 'text/html', value: htmlContent }] : []),
        ],
      }),
    })

    if (response.ok || response.status === 202) {
      return {
        statusCode: 202,
        headers: { 'x-message-id': crypto.randomUUID() },
      }
    }

    return { statusCode: 500 }
  }

  private async sendViaResend(request: SendGridMailRequest): Promise<SendGridMailResponse> {
    const personalization = request.personalizations[0]
    const htmlContent = request.content?.find((c) => c.type === 'text/html')?.value
    const textContent = request.content?.find((c) => c.type === 'text/plain')?.value

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.resendApiKey}`,
      },
      body: JSON.stringify({
        from: request.from.name ? `${request.from.name} <${request.from.email}>` : request.from.email,
        to: personalization.to.map((t) => t.email),
        subject: personalization.subject || request.subject,
        html: htmlContent,
        text: textContent,
      }),
    })

    if (response.ok) {
      const data = (await response.json()) as { id: string }
      return {
        statusCode: 202,
        headers: { 'x-message-id': data.id },
      }
    }

    return { statusCode: 500 }
  }

  private async sendViaSendGrid(request: SendGridMailRequest): Promise<SendGridMailResponse> {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.sendgridApiKey}`,
      },
      body: JSON.stringify(request),
    })

    if (response.ok || response.status === 202) {
      return {
        statusCode: 202,
        headers: { 'x-message-id': response.headers.get('x-message-id') || crypto.randomUUID() },
      }
    }

    return { statusCode: response.status as SendGridMailResponse['statusCode'] }
  }
}

// ============================================================================
// Built-in Templates
// ============================================================================

const BUILT_IN_TEMPLATES: EmailTemplate[] = [
  {
    id: 'welcome',
    name: 'Welcome Email',
    subject: 'Welcome to {{company_name}}!',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 20px; font-size: 24px; color: #333;">Welcome, {{name}}!</h1>
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.5; color: #555;">
                Thank you for joining {{company_name}}. We're excited to have you on board!
              </p>
              {{#if cta_url}}
              <a href="{{cta_url}}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">
                {{cta_text}}
              </a>
              {{/if}}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    text: `Welcome, {{name}}!

Thank you for joining {{company_name}}. We're excited to have you on board!

{{#if cta_url}}{{cta_text}}: {{cta_url}}{{/if}}`,
    variables: ['name', 'company_name', 'cta_url', 'cta_text'],
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: 'password-reset',
    name: 'Password Reset',
    subject: 'Reset your {{company_name}} password',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 20px; font-size: 24px; color: #333;">Reset Your Password</h1>
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.5; color: #555;">
                We received a request to reset your password. Click the button below to create a new password.
              </p>
              <a href="{{reset_url}}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">
                Reset Password
              </a>
              <p style="margin: 20px 0 0; font-size: 14px; color: #888;">
                This link will expire in {{expiry_hours}} hours. If you didn't request this, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    text: `Reset Your Password

We received a request to reset your password. Click the link below:

{{reset_url}}

This link will expire in {{expiry_hours}} hours.`,
    variables: ['reset_url', 'expiry_hours', 'company_name'],
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: 'order-confirmation',
    name: 'Order Confirmation',
    subject: 'Order #{{order_id}} Confirmed',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 20px; font-size: 24px; color: #333;">Order Confirmed!</h1>
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.5; color: #555;">
                Thank you for your order, {{name}}. Your order #{{order_id}} has been confirmed.
              </p>
              <div style="background: #f8f9fa; padding: 20px; border-radius: 6px; margin: 20px 0;">
                <p style="margin: 0 0 10px; font-size: 14px; color: #666;"><strong>Order Total:</strong> {{total}}</p>
                <p style="margin: 0; font-size: 14px; color: #666;"><strong>Estimated Delivery:</strong> {{delivery_date}}</p>
              </div>
              <a href="{{tracking_url}}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">
                Track Order
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    text: `Order Confirmed!

Thank you for your order, {{name}}. Your order #{{order_id}} has been confirmed.

Order Total: {{total}}
Estimated Delivery: {{delivery_date}}

Track your order: {{tracking_url}}`,
    variables: ['name', 'order_id', 'total', 'delivery_date', 'tracking_url'],
    created_at: new Date(),
    updated_at: new Date(),
  },
]

async function initializeBuiltInTemplates(storage: SQLiteTemplateStorage): Promise<void> {
  for (const template of BUILT_IN_TEMPLATES) {
    await storage.set(template)
  }
}

// ============================================================================
// EmailDO
// ============================================================================

export class EmailDO extends DurableObject<Env> {
  private sql: SqlStorage
  private templateStorage: SQLiteTemplateStorage
  private webhookStorage: SQLiteWebhookStorage
  private renderer: TemplateRenderer
  private mail: MailService
  private initialized = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.templateStorage = new SQLiteTemplateStorage(this.sql)
    this.webhookStorage = new SQLiteWebhookStorage(this.sql)
    this.renderer = new TemplateRenderer(this.templateStorage)
    this.mail = new MailService({
      resendApiKey: env.RESEND_API_KEY,
      sendgridApiKey: env.SENDGRID_API_KEY,
    })
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS email_logs (
        id TEXT PRIMARY KEY,
        recipient TEXT NOT NULL,
        template_id TEXT,
        subject TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        sent_at TEXT NOT NULL,
        delivered_at TEXT,
        opened_at TEXT,
        clicked_at TEXT,
        bounce_type TEXT,
        bounce_reason TEXT
      )
    `)

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS suppression_list (
        email TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `)

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS unsubscribes (
        email TEXT PRIMARY KEY,
        lists TEXT NOT NULL DEFAULT '["all"]',
        created_at TEXT NOT NULL
      )
    `)

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        template_id TEXT NOT NULL,
        recipients TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        sent_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        sent_at TEXT
      )
    `)

    await initializeBuiltInTemplates(this.templateStorage)
    this.initialized = true
  }

  // ============================================================================
  // Transactional Emails
  // ============================================================================

  async sendWelcome(user: User): Promise<{ success: boolean; id?: string }> {
    await this.ensureInitialized()

    if (await this.isSuppressed(user.email)) {
      return { success: false }
    }

    const rendered = await this.renderer.render('welcome', {
      name: user.name,
      company_name: this.env.FROM_NAME || 'Our Company',
      cta_url: 'https://example.com/get-started',
      cta_text: 'Get Started',
    })

    if (!rendered) return { success: false }

    const result = await this.mail.send({
      personalizations: [{ to: [{ email: user.email, name: user.name }] }],
      from: { email: this.env.FROM_EMAIL, name: this.env.FROM_NAME },
      subject: rendered.subject,
      content: [
        { type: 'text/plain', value: rendered.text || '' },
        { type: 'text/html', value: rendered.html },
      ],
    })

    if (result.statusCode === 202) {
      const id = result.headers?.['x-message-id'] || crypto.randomUUID()
      await this.logEmail(id, user.email, 'welcome', rendered.subject, 'sent')
      return { success: true, id }
    }

    return { success: false }
  }

  async sendPasswordReset(email: string, resetUrl: string): Promise<{ success: boolean; id?: string }> {
    await this.ensureInitialized()

    if (await this.isSuppressed(email)) return { success: false }

    const rendered = await this.renderer.render('password-reset', {
      reset_url: resetUrl,
      expiry_hours: 24,
      company_name: this.env.FROM_NAME || 'Our Company',
    })

    if (!rendered) return { success: false }

    const result = await this.mail.send({
      personalizations: [{ to: [{ email }] }],
      from: { email: this.env.FROM_EMAIL, name: this.env.FROM_NAME },
      subject: rendered.subject,
      content: [
        { type: 'text/plain', value: rendered.text || '' },
        { type: 'text/html', value: rendered.html },
      ],
    })

    if (result.statusCode === 202) {
      const id = result.headers?.['x-message-id'] || crypto.randomUUID()
      await this.logEmail(id, email, 'password-reset', rendered.subject, 'sent')
      return { success: true, id }
    }

    return { success: false }
  }

  async sendOrderConfirmation(
    user: User,
    order: { id: string; total: string; deliveryDate: string; trackingUrl: string }
  ): Promise<{ success: boolean; id?: string }> {
    await this.ensureInitialized()

    if (await this.isSuppressed(user.email)) return { success: false }

    const rendered = await this.renderer.render('order-confirmation', {
      name: user.name,
      order_id: order.id,
      total: order.total,
      delivery_date: order.deliveryDate,
      tracking_url: order.trackingUrl,
    })

    if (!rendered) return { success: false }

    const result = await this.mail.send({
      personalizations: [{ to: [{ email: user.email, name: user.name }] }],
      from: { email: this.env.FROM_EMAIL, name: this.env.FROM_NAME },
      subject: rendered.subject,
      content: [
        { type: 'text/plain', value: rendered.text || '' },
        { type: 'text/html', value: rendered.html },
      ],
    })

    if (result.statusCode === 202) {
      const id = result.headers?.['x-message-id'] || crypto.randomUUID()
      await this.logEmail(id, user.email, 'order-confirmation', rendered.subject, 'sent')
      return { success: true, id }
    }

    return { success: false }
  }

  async sendWithTemplate(to: string, templateId: string, data: Record<string, unknown>): Promise<{ success: boolean; id?: string }> {
    await this.ensureInitialized()

    if (await this.isSuppressed(to)) return { success: false }

    const rendered = await this.renderer.render(templateId, data)
    if (!rendered) return { success: false }

    const result = await this.mail.send({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: this.env.FROM_EMAIL, name: this.env.FROM_NAME },
      subject: rendered.subject,
      content: [
        { type: 'text/plain', value: rendered.text || '' },
        { type: 'text/html', value: rendered.html },
      ],
    })

    if (result.statusCode === 202) {
      const id = result.headers?.['x-message-id'] || crypto.randomUUID()
      await this.logEmail(id, to, templateId, rendered.subject, 'sent')
      return { success: true, id }
    }

    return { success: false }
  }

  // ============================================================================
  // Batch Campaigns
  // ============================================================================

  async createCampaign(name: string, templateId: string, recipients: string[]): Promise<Campaign> {
    await this.ensureInitialized()

    const campaign: Campaign = {
      id: crypto.randomUUID(),
      name,
      template_id: templateId,
      recipients,
      status: 'draft',
      sent_count: 0,
      failed_count: 0,
      created_at: new Date(),
    }

    this.sql.exec(
      `INSERT INTO campaigns (id, name, template_id, recipients, status, sent_count, failed_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      campaign.id,
      campaign.name,
      campaign.template_id,
      JSON.stringify(campaign.recipients),
      campaign.status,
      campaign.sent_count,
      campaign.failed_count,
      campaign.created_at.toISOString()
    )

    return campaign
  }

  async sendCampaign(campaignId: string, templateData: Record<string, unknown>): Promise<{ sent: number; failed: number }> {
    await this.ensureInitialized()

    const cursor = this.sql.exec('SELECT * FROM campaigns WHERE id = ?', campaignId)
    const rows = cursor.toArray()
    if (rows.length === 0) throw new Error('Campaign not found')

    const row = rows[0] as Record<string, unknown>
    const recipients = JSON.parse(row.recipients as string) as string[]

    this.sql.exec('UPDATE campaigns SET status = ? WHERE id = ?', 'sending', campaignId)

    let sent = 0
    let failed = 0

    const validRecipients: string[] = []
    for (const email of recipients) {
      if (!(await this.isSuppressed(email)) && !(await this.isUnsubscribed(email))) {
        validRecipients.push(email)
      }
    }

    const batchSize = 100
    for (let i = 0; i < validRecipients.length; i += batchSize) {
      const batch = validRecipients.slice(i, i + batchSize)
      const rendered = await this.renderer.render(row.template_id as string, templateData)

      if (rendered) {
        const result = await this.mail.send({
          personalizations: batch.map((email) => ({ to: [{ email }] })),
          from: { email: this.env.FROM_EMAIL, name: this.env.FROM_NAME },
          subject: rendered.subject,
          content: [
            { type: 'text/plain', value: rendered.text || '' },
            { type: 'text/html', value: rendered.html },
          ],
        })

        if (result.statusCode === 202) {
          sent += batch.length
        } else {
          failed += batch.length
        }
      } else {
        failed += batch.length
      }
    }

    this.sql.exec(
      `UPDATE campaigns SET status = ?, sent_count = ?, failed_count = ?, sent_at = ? WHERE id = ?`,
      failed > 0 && sent === 0 ? 'failed' : 'sent',
      sent,
      failed,
      new Date().toISOString(),
      campaignId
    )

    return { sent, failed }
  }

  async getCampaign(campaignId: string): Promise<Campaign | null> {
    await this.ensureInitialized()

    const cursor = this.sql.exec('SELECT * FROM campaigns WHERE id = ?', campaignId)
    const rows = cursor.toArray()
    if (rows.length === 0) return null

    const row = rows[0] as Record<string, unknown>
    return {
      id: row.id as string,
      name: row.name as string,
      template_id: row.template_id as string,
      recipients: JSON.parse(row.recipients as string),
      status: row.status as Campaign['status'],
      sent_count: row.sent_count as number,
      failed_count: row.failed_count as number,
      created_at: new Date(row.created_at as string),
      sent_at: row.sent_at ? new Date(row.sent_at as string) : undefined,
    }
  }

  // ============================================================================
  // Webhook Handling
  // ============================================================================

  async handleDelivered(event: WebhookEvent): Promise<void> {
    await this.ensureInitialized()
    this.sql.exec(`UPDATE email_logs SET status = 'delivered', delivered_at = ? WHERE id = ?`, event.timestamp.toISOString(), event.email_id)
    const dispatcher = new WebhookDispatcher({ storage: this.webhookStorage })
    await dispatcher.dispatch(event)
  }

  async handleBounce(event: WebhookEvent): Promise<void> {
    await this.ensureInitialized()
    this.sql.exec(`UPDATE email_logs SET status = 'bounced', bounce_type = ?, bounce_reason = ? WHERE id = ?`, event.bounce_type || 'unknown', event.bounce_reason || '', event.email_id)
    if (event.bounce_type === 'hard') {
      await this.addToSuppression(event.recipient, 'bounce')
    }
    const dispatcher = new WebhookDispatcher({ storage: this.webhookStorage })
    await dispatcher.dispatch(event)
  }

  async handleOpened(event: WebhookEvent): Promise<void> {
    await this.ensureInitialized()
    this.sql.exec(`UPDATE email_logs SET status = 'opened', opened_at = ? WHERE id = ? AND opened_at IS NULL`, event.timestamp.toISOString(), event.email_id)
    const dispatcher = new WebhookDispatcher({ storage: this.webhookStorage })
    await dispatcher.dispatch(event)
  }

  async handleClicked(event: WebhookEvent): Promise<void> {
    await this.ensureInitialized()
    this.sql.exec(`UPDATE email_logs SET clicked_at = ? WHERE id = ? AND clicked_at IS NULL`, event.timestamp.toISOString(), event.email_id)
    const dispatcher = new WebhookDispatcher({ storage: this.webhookStorage })
    await dispatcher.dispatch(event)
  }

  async handleComplaint(event: WebhookEvent): Promise<void> {
    await this.ensureInitialized()
    await this.addToSuppression(event.recipient, 'complaint')
    const dispatcher = new WebhookDispatcher({ storage: this.webhookStorage })
    await dispatcher.dispatch(event)
  }

  // ============================================================================
  // Suppression & Unsubscribe Management
  // ============================================================================

  async addToSuppression(email: string, reason: 'bounce' | 'complaint' | 'unsubscribe'): Promise<void> {
    await this.ensureInitialized()
    this.sql.exec(`INSERT OR REPLACE INTO suppression_list (email, reason, created_at) VALUES (?, ?, ?)`, email.toLowerCase(), reason, new Date().toISOString())
  }

  async isSuppressed(email: string): Promise<boolean> {
    await this.ensureInitialized()
    const cursor = this.sql.exec('SELECT email FROM suppression_list WHERE email = ?', email.toLowerCase())
    return cursor.toArray().length > 0
  }

  async removeFromSuppression(email: string): Promise<void> {
    await this.ensureInitialized()
    this.sql.exec('DELETE FROM suppression_list WHERE email = ?', email.toLowerCase())
  }

  async getSuppressionList(): Promise<SuppressionEntry[]> {
    await this.ensureInitialized()
    const cursor = this.sql.exec('SELECT * FROM suppression_list ORDER BY created_at DESC')
    return cursor.toArray().map((row) => {
      const r = row as Record<string, unknown>
      return {
        email: r.email as string,
        reason: r.reason as 'bounce' | 'complaint' | 'unsubscribe',
        created_at: new Date(r.created_at as string),
      }
    })
  }

  async unsubscribe(email: string, lists: string[] = ['all']): Promise<void> {
    await this.ensureInitialized()
    this.sql.exec(`INSERT OR REPLACE INTO unsubscribes (email, lists, created_at) VALUES (?, ?, ?)`, email.toLowerCase(), JSON.stringify(lists), new Date().toISOString())
  }

  async resubscribe(email: string): Promise<void> {
    await this.ensureInitialized()
    this.sql.exec('DELETE FROM unsubscribes WHERE email = ?', email.toLowerCase())
  }

  async isUnsubscribed(email: string, list = 'all'): Promise<boolean> {
    await this.ensureInitialized()
    const cursor = this.sql.exec('SELECT lists FROM unsubscribes WHERE email = ?', email.toLowerCase())
    const rows = cursor.toArray()
    if (rows.length === 0) return false
    const lists = JSON.parse((rows[0] as Record<string, unknown>).lists as string) as string[]
    return lists.includes('all') || lists.includes(list)
  }

  // ============================================================================
  // Template Management
  // ============================================================================

  async upsertTemplate(template: Omit<EmailTemplate, 'created_at' | 'updated_at'>): Promise<void> {
    await this.ensureInitialized()
    await this.templateStorage.set({ ...template, created_at: new Date(), updated_at: new Date() })
  }

  async getTemplate(templateId: string): Promise<EmailTemplate | null> {
    await this.ensureInitialized()
    return this.templateStorage.get(templateId)
  }

  async listTemplates(): Promise<EmailTemplate[]> {
    await this.ensureInitialized()
    return this.templateStorage.list()
  }

  async deleteTemplate(templateId: string): Promise<void> {
    await this.ensureInitialized()
    await this.templateStorage.delete(templateId)
  }

  // ============================================================================
  // Email Logs
  // ============================================================================

  private async logEmail(id: string, to: string, templateId: string | undefined, subject: string, status: string): Promise<void> {
    this.sql.exec(`INSERT INTO email_logs (id, recipient, template_id, subject, status, sent_at) VALUES (?, ?, ?, ?, ?, ?)`, id, to, templateId || null, subject, status, new Date().toISOString())
  }

  async getEmailLogs(options?: { status?: string; recipient?: string; limit?: number; offset?: number }): Promise<EmailLog[]> {
    await this.ensureInitialized()

    let query = 'SELECT * FROM email_logs WHERE 1=1'
    const params: unknown[] = []

    if (options?.status) {
      query += ' AND status = ?'
      params.push(options.status)
    }
    if (options?.recipient) {
      query += ' AND recipient = ?'
      params.push(options.recipient)
    }

    query += ' ORDER BY sent_at DESC'
    if (options?.limit) query += ` LIMIT ${options.limit}`
    if (options?.offset) query += ` OFFSET ${options.offset}`

    const cursor = this.sql.exec(query, ...params)
    return cursor.toArray().map((row) => {
      const r = row as Record<string, unknown>
      return {
        id: r.id as string,
        to: r.recipient as string,
        template_id: r.template_id as string | undefined,
        subject: r.subject as string,
        status: r.status as EmailLog['status'],
        sent_at: new Date(r.sent_at as string),
        delivered_at: r.delivered_at ? new Date(r.delivered_at as string) : undefined,
        opened_at: r.opened_at ? new Date(r.opened_at as string) : undefined,
        clicked_at: r.clicked_at ? new Date(r.clicked_at as string) : undefined,
        bounce_type: r.bounce_type as 'hard' | 'soft' | undefined,
        bounce_reason: r.bounce_reason as string | undefined,
      }
    })
  }

  async getStats(): Promise<{
    total: number
    sent: number
    delivered: number
    opened: number
    clicked: number
    bounced: number
    failed: number
    open_rate: number
    click_rate: number
    bounce_rate: number
  }> {
    await this.ensureInitialized()

    const stats = { total: 0, sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, failed: 0 }
    const cursor = this.sql.exec(`SELECT status, COUNT(*) as count FROM email_logs GROUP BY status`)

    for (const row of cursor.toArray()) {
      const r = row as Record<string, unknown>
      const count = r.count as number
      stats.total += count
      switch (r.status) {
        case 'sent': stats.sent += count; break
        case 'delivered': stats.delivered += count; break
        case 'opened': stats.opened += count; break
        case 'clicked': stats.clicked += count; break
        case 'bounced': stats.bounced += count; break
        case 'failed': stats.failed += count; break
      }
    }

    const delivered = stats.delivered + stats.opened + stats.clicked
    return {
      ...stats,
      open_rate: delivered > 0 ? ((stats.opened + stats.clicked) / delivered) * 100 : 0,
      click_rate: delivered > 0 ? (stats.clicked / delivered) * 100 : 0,
      bounce_rate: stats.total > 0 ? (stats.bounced / stats.total) * 100 : 0,
    }
  }
}
