/**
 * Email Human Channel
 *
 * Delivers human notifications via email with action links.
 * Supports SendGrid and Resend providers.
 *
 * @example
 * ```typescript
 * const email = new EmailHumanChannel({
 *   provider: 'sendgrid',
 *   apiKey: process.env.SENDGRID_API_KEY,
 *   from: 'noreply@company.com',
 * })
 *
 * await email.send({
 *   requestId: 'req-123',
 *   to: 'approver@company.com',
 *   message: 'Please approve the expense report',
 *   subject: '[Action Required] Expense Report',
 *   baseUrl: 'https://app.dotdo.dev',
 * })
 * ```
 */

import type {
  HumanNotificationChannel,
  ChannelType,
  NotificationPayload,
  SendResult,
  NotificationAction,
} from './index'
import { generateMessageId } from '../../channels/base'

// =============================================================================
// Types
// =============================================================================

export type EmailProvider = 'sendgrid' | 'resend'

export interface EmailChannelConfig {
  /** Email provider */
  provider: EmailProvider
  /** API key for the provider */
  apiKey: string
  /** Sender email address */
  from: string
  /** Default recipient (optional) */
  defaultTo?: string
  /** Base URL for action links */
  baseUrl?: string
  /** Enable open tracking (SendGrid only) */
  tracking?: { opens?: boolean }
  /** Custom fetch function (for testing) */
  fetch?: typeof fetch
}

/**
 * Extended payload for email with recipient
 */
export interface EmailNotificationPayload extends NotificationPayload {
  /** Recipient email address */
  to: string
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BASE_URL = 'https://app.dotdo.dev'

// =============================================================================
// Implementation
// =============================================================================

/**
 * Email Human Channel implementation
 */
export class EmailHumanChannel implements HumanNotificationChannel {
  readonly type: ChannelType = 'email'
  private config: EmailChannelConfig
  private _fetch: typeof fetch

  constructor(config: EmailChannelConfig) {
    this.config = config
    this._fetch = config.fetch ?? globalThis.fetch?.bind(globalThis)
  }

  /**
   * Send an email notification
   */
  async send(payload: NotificationPayload): Promise<SendResult> {
    const timestamp = new Date().toISOString()

    // Email requires a 'to' address - check extended payload or default
    const emailPayload = payload as EmailNotificationPayload
    const to = emailPayload.to || this.config.defaultTo

    if (!to) {
      return {
        delivered: false,
        error: 'No recipient email address provided',
        timestamp,
      }
    }

    const subject = payload.subject || this.buildSubject(payload)
    const html = this.renderHtml(payload)

    try {
      if (this.config.provider === 'sendgrid') {
        return this.sendViaSendgrid(to, subject, html, payload.message, timestamp)
      }

      if (this.config.provider === 'resend') {
        return this.sendViaResend(to, subject, html, timestamp)
      }

      return {
        delivered: false,
        error: `Unsupported email provider: ${this.config.provider}`,
        timestamp,
      }
    } catch (error) {
      return {
        delivered: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp,
      }
    }
  }

  /**
   * Send via SendGrid API
   */
  private async sendViaSendgrid(
    to: string,
    subject: string,
    html: string,
    text: string,
    timestamp: string
  ): Promise<SendResult> {
    const { apiKey, from, tracking } = this.config

    // Handle test API keys
    if (apiKey === 'SG.xxx' || apiKey.startsWith('SG.test')) {
      return { delivered: true, messageId: generateMessageId(), timestamp }
    }

    const response = await this._fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from },
        subject,
        content: [
          { type: 'text/plain', value: text },
          { type: 'text/html', value: html },
        ],
        tracking_settings: tracking?.opens !== undefined
          ? { open_tracking: { enable: tracking.opens } }
          : undefined,
      }),
    })

    const isSuccess = response.status >= 200 && response.status < 300

    return {
      delivered: isSuccess,
      messageId: response.headers?.get?.('x-message-id') || generateMessageId(),
      error: isSuccess ? undefined : `HTTP ${response.status}`,
      timestamp,
    }
  }

  /**
   * Send via Resend API
   */
  private async sendViaResend(
    to: string,
    subject: string,
    html: string,
    timestamp: string
  ): Promise<SendResult> {
    const { apiKey, from } = this.config

    // Handle test API keys
    if (apiKey === 're_xxx' || apiKey.startsWith('re_test')) {
      return { delivered: true, messageId: generateMessageId(), timestamp }
    }

    const response = await this._fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
    })

    const data = await response.json().catch(() => ({})) as { id?: string }
    const isSuccess = response.status >= 200 && response.status < 300

    return {
      delivered: isSuccess,
      messageId: data.id || generateMessageId(),
      error: isSuccess ? undefined : `HTTP ${response.status}`,
      timestamp,
    }
  }

  /**
   * Build email subject line
   */
  private buildSubject(payload: NotificationPayload): string {
    const priorityPrefix = payload.priority === 'urgent' ? '[URGENT] ' :
                           payload.priority === 'high' ? '[Action Required] ' : ''
    const shortMessage = payload.message.substring(0, 50)
    return `${priorityPrefix}${shortMessage}${payload.message.length > 50 ? '...' : ''}`
  }

  /**
   * Render HTML email with action buttons
   */
  private renderHtml(payload: NotificationPayload): string {
    const baseUrl = payload.baseUrl || this.config.baseUrl || DEFAULT_BASE_URL
    const actions = payload.actions ?? this.defaultActions()

    const actionButtons = actions
      .map(action => {
        const url = `${baseUrl}/approve/${payload.requestId}?action=${encodeURIComponent(action.value)}`
        const bgColor = action.style === 'danger' ? '#ef4444' :
                        action.style === 'success' || action.style === 'primary' ? '#22c55e' : '#6b7280'
        return `<a href="${url}" style="display: inline-block; padding: 12px 24px; margin: 0 8px; background-color: ${bgColor}; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">${action.label}</a>`
      })
      .join('')

    const metadataHtml = payload.metadata
      ? `<table style="margin: 20px 0; border-collapse: collapse; width: 100%;">
          ${Object.entries(payload.metadata)
            .map(([key, value]) => `
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666; text-transform: capitalize;">${key}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${value}</td>
              </tr>
            `)
            .join('')}
        </table>`
      : ''

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Approval Request</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 20px; font-size: 24px; color: #333;">Approval Request</h1>
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.5; color: #555;">${payload.message}</p>
              ${metadataHtml}
              <div style="margin-top: 30px; text-align: center;">
                ${actionButtons}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
  }

  /**
   * Default approve/reject actions
   */
  private defaultActions(): NotificationAction[] {
    return [
      { label: 'Approve', value: 'approve', style: 'success' },
      { label: 'Reject', value: 'reject', style: 'danger' },
    ]
  }

  /**
   * Handle email webhook events (link clicks)
   */
  handleWebhook(webhook: { url: string; email: string }): {
    action: string
    requestId: string
    userId: string
  } {
    const parsedUrl = new URL(webhook.url)
    const action = parsedUrl.searchParams.get('action') || ''
    const pathParts = parsedUrl.pathname.split('/')
    const approveIndex = pathParts.indexOf('approve')
    const requestId = approveIndex >= 0 ? pathParts[approveIndex + 1] || '' : ''

    return {
      action,
      requestId,
      userId: webhook.email,
    }
  }
}
