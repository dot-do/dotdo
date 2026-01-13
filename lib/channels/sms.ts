/**
 * SMS Channel Adapter
 *
 * Provides SMS delivery through various providers for human notifications
 * and interactive workflows.
 *
 * Supported providers:
 * - Twilio (default)
 * - MessageBird
 * - Vonage (Nexmo)
 * - Telnyx
 *
 * @example
 * ```typescript
 * import { SMSChannel } from 'lib/channels/sms'
 *
 * const sms = new SMSChannel({
 *   provider: 'twilio',
 *   accountSid: process.env.TWILIO_ACCOUNT_SID,
 *   authToken: process.env.TWILIO_AUTH_TOKEN,
 *   fromNumber: '+15551234567',
 * })
 *
 * // Send a notification
 * const result = await sms.send({
 *   message: 'Your order has shipped!',
 *   to: '+15559876543',
 * })
 *
 * // Send with approval links
 * const approval = await sms.sendApproval({
 *   message: 'Approve expense report?',
 *   to: '+15559876543',
 *   requestId: 'req-123',
 *   baseUrl: 'https://app.dotdo.dev',
 * })
 * ```
 *
 * @module lib/channels/sms
 */

import type { HumanResponse } from './types'
import { buildActionId, parseActionId, generateMessageId } from './base'

// =============================================================================
// Types
// =============================================================================

export type SMSProvider = 'twilio' | 'messagebird' | 'vonage' | 'telnyx' | 'mock'

/**
 * SMS Channel configuration
 */
export interface SMSChannelConfig {
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
  /** Webhook URL for status callbacks */
  statusCallbackUrl?: string
  /** Custom fetch function for testing */
  fetch?: typeof fetch
}

/**
 * SMS send payload
 */
export interface SMSSendPayload {
  /** Message body */
  message: string
  /** Recipient phone number in E.164 format */
  to: string
  /** Optional media URLs for MMS */
  mediaUrl?: string[]
}

/**
 * SMS send result
 */
export interface SMSSendResult {
  delivered: boolean
  messageId?: string
  status?: 'queued' | 'sent' | 'delivered' | 'failed'
}

/**
 * Approval SMS options
 */
export interface SMSApprovalOptions {
  message: string
  to: string
  requestId: string
  baseUrl?: string
  /** Custom actions instead of default approve/reject */
  actions?: Array<{ label: string; value: string }>
}

/**
 * SMS webhook payload (for incoming messages and status updates)
 */
export interface SMSWebhookPayload {
  /** Provider-specific message SID */
  messageSid?: string
  MessageSid?: string
  /** Sender phone number */
  from?: string
  From?: string
  /** Recipient phone number */
  to?: string
  To?: string
  /** Message body */
  body?: string
  Body?: string
  /** Message status */
  status?: string
  SmsStatus?: string
  MessageStatus?: string
  /** Error code if failed */
  errorCode?: number
  ErrorCode?: string
}

/**
 * SMS webhook response
 */
export interface SMSWebhookResponse {
  type: 'incoming' | 'status'
  from: string
  to: string
  body?: string
  status?: string
  messageSid?: string
  /** Parsed action and request ID if message contains approval link response */
  action?: string
  requestId?: string
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BASE_URL = 'https://app.dotdo.dev'

// =============================================================================
// SMS Channel Implementation
// =============================================================================

/**
 * SMS Channel for sending notifications and approval requests via SMS
 */
export class SMSChannel {
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

    if (!this.isValidPhoneNumber(this.config.fromNumber)) {
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
  private isValidPhoneNumber(phone: string): boolean {
    return /^\+[1-9]\d{1,14}$/.test(phone)
  }

  /**
   * Normalize phone number to E.164 format
   */
  private normalizePhoneNumber(phone: string): string {
    // Remove common formatting
    let normalized = phone.replace(/[\s\-\(\)\.]/g, '')

    // Add + if missing and looks like E.164
    if (!normalized.startsWith('+')) {
      // Assume US number if 10 digits
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
   * Send an SMS message
   */
  async send(payload: SMSSendPayload): Promise<SMSSendResult> {
    const to = this.normalizePhoneNumber(payload.to)

    if (!this.isValidPhoneNumber(to)) {
      throw new Error(`Invalid phone number: ${payload.to}`)
    }

    switch (this.config.provider) {
      case 'twilio':
        return this.sendViaTwilio(payload.message, to, payload.mediaUrl)
      case 'messagebird':
        return this.sendViaMessageBird(payload.message, to)
      case 'vonage':
        return this.sendViaVonage(payload.message, to)
      case 'telnyx':
        return this.sendViaTelnyx(payload.message, to, payload.mediaUrl)
      case 'mock':
        return this.sendViaMock(payload.message, to)
      default:
        throw new Error(`Unsupported provider: ${this.config.provider}`)
    }
  }

  /**
   * Send an approval SMS with links
   */
  async sendApproval(options: SMSApprovalOptions): Promise<SMSSendResult> {
    const { message, to, requestId, baseUrl = DEFAULT_BASE_URL, actions } = options

    let body = message + '\n\n'

    if (actions && actions.length > 0) {
      for (const action of actions) {
        const url = `${baseUrl}/approve/${requestId}?action=${encodeURIComponent(action.value)}`
        body += `${action.label}: ${url}\n`
      }
    } else {
      // Default approve/reject
      body += `Approve: ${baseUrl}/approve/${requestId}?action=approve\n`
      body += `Reject: ${baseUrl}/approve/${requestId}?action=reject\n`
    }

    return this.send({ message: body.trim(), to })
  }

  /**
   * Handle incoming SMS webhook from provider
   */
  handleWebhook(payload: SMSWebhookPayload): SMSWebhookResponse {
    // Normalize field names (different providers use different casing)
    const from = payload.from || payload.From || ''
    const to = payload.to || payload.To || ''
    const body = payload.body || payload.Body || ''
    const messageSid = payload.messageSid || payload.MessageSid || ''
    const status = payload.status || payload.SmsStatus || payload.MessageStatus || ''

    // Determine if this is a status update or incoming message
    const isStatusUpdate = !!status && !body

    if (isStatusUpdate) {
      return {
        type: 'status',
        from,
        to,
        status,
        messageSid,
      }
    }

    // Parse body for approval response keywords
    let action: string | undefined
    let requestId: string | undefined

    // Check for simple keyword responses
    const lowerBody = body.toLowerCase().trim()
    if (lowerBody === 'yes' || lowerBody === 'approve' || lowerBody === 'y' || lowerBody === '1') {
      action = 'approve'
    } else if (lowerBody === 'no' || lowerBody === 'reject' || lowerBody === 'n' || lowerBody === '0') {
      action = 'reject'
    }

    // Try to extract request ID from message (e.g., "approve req-123" or "yes 123")
    const parts = body.trim().split(/\s+/)
    if (parts.length >= 2) {
      const potentialId = parts[parts.length - 1]
      if (potentialId && /^[a-zA-Z0-9\-_]+$/.test(potentialId)) {
        requestId = potentialId
      }
    }

    return {
      type: 'incoming',
      from,
      to,
      body,
      messageSid,
      action,
      requestId,
    }
  }

  // ===========================================================================
  // Provider Implementations
  // ===========================================================================

  /**
   * Send via Twilio
   */
  private async sendViaTwilio(
    body: string,
    to: string,
    mediaUrl?: string[]
  ): Promise<SMSSendResult> {
    const { accountSid, authToken, fromNumber, statusCallbackUrl } = this.config

    // Handle test credentials
    if (accountSid?.startsWith('AC_test') || authToken === 'test_token') {
      return { delivered: true, messageId: `SM_test_${Date.now()}`, status: 'queued' }
    }

    const credentials = btoa(`${accountSid}:${authToken}`)

    const formData = new URLSearchParams({
      To: to,
      From: fromNumber,
      Body: body,
    })

    if (mediaUrl && mediaUrl.length > 0) {
      for (const url of mediaUrl) {
        formData.append('MediaUrl', url)
      }
    }

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

    const data = (await response.json()) as { sid: string; status: string }

    return {
      delivered: true,
      messageId: data.sid,
      status: data.status as SMSSendResult['status'],
    }
  }

  /**
   * Send via MessageBird
   */
  private async sendViaMessageBird(body: string, to: string): Promise<SMSSendResult> {
    const { accessKey, fromNumber } = this.config

    // Handle test credentials
    if (accessKey?.startsWith('test_')) {
      return { delivered: true, messageId: `mb_test_${Date.now()}`, status: 'queued' }
    }

    const response = await this._fetch('https://rest.messagebird.com/messages', {
      method: 'POST',
      headers: {
        Authorization: `AccessKey ${accessKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        originator: fromNumber,
        recipients: [to],
        body,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as Record<string, unknown>
      throw new Error(`MessageBird API error: ${(error.errors as any)?.[0]?.description || response.status}`)
    }

    const data = (await response.json()) as { id: string }

    return {
      delivered: true,
      messageId: data.id,
      status: 'queued',
    }
  }

  /**
   * Send via Vonage (Nexmo)
   */
  private async sendViaVonage(body: string, to: string): Promise<SMSSendResult> {
    const { apiKey, apiSecret, fromNumber } = this.config

    // Handle test credentials
    if (apiKey?.startsWith('test_')) {
      return { delivered: true, messageId: `vonage_test_${Date.now()}`, status: 'queued' }
    }

    // Vonage requires numbers without + prefix
    const vonageTo = to.replace('+', '')
    const vonageFrom = fromNumber.replace('+', '')

    const response = await this._fetch('https://rest.nexmo.com/sms/json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        api_secret: apiSecret,
        from: vonageFrom,
        to: vonageTo,
        text: body,
      }),
    })

    if (!response.ok) {
      throw new Error(`Vonage API error: ${response.status}`)
    }

    const data = (await response.json()) as {
      messages?: Array<{
        status: string
        'error-text'?: string
        'message-id'?: string
      }>
    }

    if (data.messages?.[0]?.status !== '0') {
      throw new Error(`Vonage send failed: ${data.messages?.[0]?.['error-text'] || 'Unknown error'}`)
    }

    return {
      delivered: true,
      messageId: data.messages![0]!['message-id']!,
      status: 'queued',
    }
  }

  /**
   * Send via Telnyx
   */
  private async sendViaTelnyx(
    body: string,
    to: string,
    mediaUrl?: string[]
  ): Promise<SMSSendResult> {
    const { telnyxApiKey, fromNumber } = this.config

    // Handle test credentials
    if (telnyxApiKey?.startsWith('test_')) {
      return { delivered: true, messageId: `telnyx_test_${Date.now()}`, status: 'queued' }
    }

    const payload: Record<string, unknown> = {
      from: fromNumber,
      to,
      text: body,
    }

    if (mediaUrl && mediaUrl.length > 0) {
      payload.media_urls = mediaUrl
    }

    const response = await this._fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${telnyxApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as Record<string, unknown>
      throw new Error(`Telnyx API error: ${(error.errors as any)?.[0]?.detail || response.status}`)
    }

    const data = (await response.json()) as { data: { id: string } }

    return {
      delivered: true,
      messageId: data.data.id,
      status: 'queued',
    }
  }

  /**
   * Send via mock (for testing)
   */
  private async sendViaMock(body: string, to: string): Promise<SMSSendResult> {
    console.log('[Mock SMS]', {
      from: this.config.fromNumber,
      to,
      body: body.substring(0, 100) + (body.length > 100 ? '...' : ''),
    })

    return {
      delivered: true,
      messageId: generateMessageId(),
      status: 'sent',
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an SMS channel instance
 */
export function createSMSChannel(config: SMSChannelConfig): SMSChannel {
  return new SMSChannel(config)
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Format a phone number for display
 */
export function formatPhoneNumber(phone: string): string {
  // Remove non-numeric characters except +
  const cleaned = phone.replace(/[^\d+]/g, '')

  // US number formatting
  if (cleaned.startsWith('+1') && cleaned.length === 12) {
    const area = cleaned.slice(2, 5)
    const first = cleaned.slice(5, 8)
    const last = cleaned.slice(8, 12)
    return `+1 (${area}) ${first}-${last}`
  }

  return cleaned
}

/**
 * Validate if a string is a valid E.164 phone number
 */
export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone)
}

// =============================================================================
// Exports
// =============================================================================

export default SMSChannel
