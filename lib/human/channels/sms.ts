/**
 * SMS Human Channel
 *
 * Delivers human notifications via SMS with action links.
 * Supports multiple providers: Twilio, MessageBird, Vonage, Telnyx.
 *
 * @example
 * ```typescript
 * const sms = new SMSHumanChannel({
 *   provider: 'twilio',
 *   accountSid: process.env.TWILIO_ACCOUNT_SID,
 *   authToken: process.env.TWILIO_AUTH_TOKEN,
 *   fromNumber: '+15551234567',
 * })
 *
 * await sms.send({
 *   requestId: 'req-123',
 *   to: '+15559876543',
 *   message: 'Please approve the expense report',
 *   baseUrl: 'https://app.dotdo.dev',
 * })
 * ```
 */

import type {
  HumanNotificationChannel,
  ChannelType,
  NotificationPayload,
  SendResult,
  HumanResponse,
  NotificationAction,
} from './index'
import { generateMessageId } from '../../channels/base'

// =============================================================================
// Types
// =============================================================================

export type SMSProvider = 'twilio' | 'messagebird' | 'vonage' | 'telnyx' | 'mock'

export interface SMSChannelConfig {
  /** SMS provider */
  provider: SMSProvider
  /** Sender phone number in E.164 format */
  fromNumber: string
  /** Twilio account SID */
  accountSid?: string
  /** Twilio auth token */
  authToken?: string
  /** MessageBird access key */
  accessKey?: string
  /** Vonage API key */
  apiKey?: string
  /** Vonage API secret */
  apiSecret?: string
  /** Telnyx API key */
  telnyxApiKey?: string
  /** Base URL for action links */
  baseUrl?: string
  /** Webhook URL for status callbacks */
  statusCallbackUrl?: string
  /** Custom fetch function (for testing) */
  fetch?: typeof fetch
}

/**
 * Extended payload for SMS with recipient
 */
export interface SMSNotificationPayload extends NotificationPayload {
  /** Recipient phone number in E.164 format */
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
 * SMS Human Channel implementation
 */
export class SMSHumanChannel implements HumanNotificationChannel {
  readonly type: ChannelType = 'sms'
  private config: SMSChannelConfig
  private _fetch: typeof fetch

  constructor(config: SMSChannelConfig) {
    this.config = config
    this._fetch = config.fetch ?? globalThis.fetch?.bind(globalThis)
    this.validateConfig()
  }

  /**
   * Validate configuration
   */
  private validateConfig(): void {
    if (!this.config.fromNumber) {
      throw new Error('fromNumber is required')
    }

    if (!this.isValidE164(this.config.fromNumber)) {
      throw new Error('fromNumber must be in E.164 format (e.g., +15551234567)')
    }

    switch (this.config.provider) {
      case 'twilio':
        if (!this.config.accountSid || !this.config.authToken) {
          throw new Error('Twilio requires accountSid and authToken')
        }
        break
      case 'messagebird':
        if (!this.config.accessKey) {
          throw new Error('MessageBird requires accessKey')
        }
        break
      case 'vonage':
        if (!this.config.apiKey || !this.config.apiSecret) {
          throw new Error('Vonage requires apiKey and apiSecret')
        }
        break
      case 'telnyx':
        if (!this.config.telnyxApiKey) {
          throw new Error('Telnyx requires telnyxApiKey')
        }
        break
      case 'mock':
        // No validation needed
        break
      default:
        throw new Error(`Unknown SMS provider: ${this.config.provider}`)
    }
  }

  /**
   * Validate E.164 phone number format
   */
  private isValidE164(phone: string): boolean {
    return /^\+[1-9]\d{1,14}$/.test(phone)
  }

  /**
   * Normalize phone number to E.164 format
   */
  private normalizePhoneNumber(phone: string): string {
    let normalized = phone.replace(/[\s\-\(\)\.]/g, '')

    if (!normalized.startsWith('+')) {
      if (normalized.length === 10 && /^\d+$/.test(normalized)) {
        normalized = '+1' + normalized
      } else if (normalized.length === 11 && normalized.startsWith('1')) {
        normalized = '+' + normalized
      } else if (/^\d+$/.test(normalized)) {
        normalized = '+' + normalized
      }
    }

    return normalized
  }

  /**
   * Send an SMS notification
   */
  async send(payload: NotificationPayload): Promise<SendResult> {
    const timestamp = new Date().toISOString()

    const smsPayload = payload as SMSNotificationPayload
    const to = this.normalizePhoneNumber(smsPayload.to || '')

    if (!to || !this.isValidE164(to)) {
      return {
        delivered: false,
        error: 'Invalid or missing phone number',
        timestamp,
      }
    }

    const body = this.buildMessageBody(payload)

    try {
      switch (this.config.provider) {
        case 'twilio':
          return this.sendViaTwilio(body, to, timestamp)
        case 'messagebird':
          return this.sendViaMessageBird(body, to, timestamp)
        case 'vonage':
          return this.sendViaVonage(body, to, timestamp)
        case 'telnyx':
          return this.sendViaTelnyx(body, to, timestamp)
        case 'mock':
          return this.sendViaMock(body, to, timestamp)
        default:
          return {
            delivered: false,
            error: `Unsupported provider: ${this.config.provider}`,
            timestamp,
          }
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
   * Build SMS message body with action links
   */
  private buildMessageBody(payload: NotificationPayload): string {
    const baseUrl = payload.baseUrl || this.config.baseUrl || DEFAULT_BASE_URL
    const actions = payload.actions ?? this.defaultActions()

    let body = payload.message + '\n\n'

    for (const action of actions) {
      const url = `${baseUrl}/approve/${payload.requestId}?action=${encodeURIComponent(action.value)}`
      body += `${action.label}: ${url}\n`
    }

    return body.trim()
  }

  /**
   * Default approve/reject actions
   */
  private defaultActions(): NotificationAction[] {
    return [
      { label: 'Approve', value: 'approve' },
      { label: 'Reject', value: 'reject' },
    ]
  }

  /**
   * Send via Twilio
   */
  private async sendViaTwilio(body: string, to: string, timestamp: string): Promise<SendResult> {
    const { accountSid, authToken, fromNumber, statusCallbackUrl } = this.config

    // Handle test credentials
    if (accountSid?.startsWith('AC_test') || authToken === 'test_token') {
      return { delivered: true, messageId: `SM_test_${Date.now()}`, timestamp }
    }

    const credentials = btoa(`${accountSid}:${authToken}`)
    const formData = new URLSearchParams({ To: to, From: fromNumber, Body: body })

    if (statusCallbackUrl) {
      formData.append('StatusCallback', statusCallbackUrl)
    }

    const response = await this._fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      }
    )

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as Record<string, unknown>
      throw new Error(`Twilio API error: ${error.message || response.status}`)
    }

    const data = await response.json() as { sid: string }

    return { delivered: true, messageId: data.sid, timestamp }
  }

  /**
   * Send via MessageBird
   */
  private async sendViaMessageBird(body: string, to: string, timestamp: string): Promise<SendResult> {
    const { accessKey, fromNumber } = this.config

    if (accessKey?.startsWith('test_')) {
      return { delivered: true, messageId: `mb_test_${Date.now()}`, timestamp }
    }

    const response = await this._fetch('https://rest.messagebird.com/messages', {
      method: 'POST',
      headers: {
        Authorization: `AccessKey ${accessKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ originator: fromNumber, recipients: [to], body }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as Record<string, unknown>
      throw new Error(`MessageBird API error: ${(error.errors as any)?.[0]?.description || response.status}`)
    }

    const data = await response.json() as { id: string }

    return { delivered: true, messageId: data.id, timestamp }
  }

  /**
   * Send via Vonage
   */
  private async sendViaVonage(body: string, to: string, timestamp: string): Promise<SendResult> {
    const { apiKey, apiSecret, fromNumber } = this.config

    if (apiKey?.startsWith('test_')) {
      return { delivered: true, messageId: `vonage_test_${Date.now()}`, timestamp }
    }

    const response = await this._fetch('https://rest.nexmo.com/sms/json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        api_secret: apiSecret,
        from: fromNumber.replace('+', ''),
        to: to.replace('+', ''),
        text: body,
      }),
    })

    if (!response.ok) {
      throw new Error(`Vonage API error: ${response.status}`)
    }

    const data = await response.json() as {
      messages?: Array<{ status: string; 'message-id'?: string; 'error-text'?: string }>
    }

    if (data.messages?.[0]?.status !== '0') {
      throw new Error(`Vonage send failed: ${data.messages?.[0]?.['error-text'] || 'Unknown error'}`)
    }

    return { delivered: true, messageId: data.messages![0]!['message-id']!, timestamp }
  }

  /**
   * Send via Telnyx
   */
  private async sendViaTelnyx(body: string, to: string, timestamp: string): Promise<SendResult> {
    const { telnyxApiKey, fromNumber } = this.config

    if (telnyxApiKey?.startsWith('test_')) {
      return { delivered: true, messageId: `telnyx_test_${Date.now()}`, timestamp }
    }

    const response = await this._fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${telnyxApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: fromNumber, to, text: body }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as Record<string, unknown>
      throw new Error(`Telnyx API error: ${(error.errors as any)?.[0]?.detail || response.status}`)
    }

    const data = await response.json() as { data: { id: string } }

    return { delivered: true, messageId: data.data.id, timestamp }
  }

  /**
   * Send via mock (for testing)
   */
  private async sendViaMock(body: string, to: string, timestamp: string): Promise<SendResult> {
    console.log('[Mock SMS]', { from: this.config.fromNumber, to, body: body.substring(0, 100) })
    return { delivered: true, messageId: generateMessageId(), timestamp }
  }

  /**
   * Handle incoming SMS webhook
   */
  handleWebhook(payload: {
    from?: string
    From?: string
    body?: string
    Body?: string
    messageSid?: string
    MessageSid?: string
  }): HumanResponse | null {
    const from = payload.from || payload.From || ''
    const body = (payload.body || payload.Body || '').toLowerCase().trim()

    let action: string | undefined
    if (['yes', 'approve', 'y', '1'].includes(body)) {
      action = 'approve'
    } else if (['no', 'reject', 'n', '0'].includes(body)) {
      action = 'reject'
    }

    if (!action) return null

    return {
      action,
      userId: from,
      timestamp: new Date(),
    }
  }
}
