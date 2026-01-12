/**
 * SMS Channel Adapter
 *
 * Provides SMS delivery through various providers:
 * - Twilio
 * - AWS SNS
 * - MessageBird
 * - Vonage (Nexmo)
 *
 * @example
 * ```typescript
 * import { createSMSAdapter } from 'db/primitives/notifications/channels/sms'
 *
 * const smsAdapter = createSMSAdapter({
 *   provider: 'twilio',
 *   accountSid: process.env.TWILIO_ACCOUNT_SID,
 *   authToken: process.env.TWILIO_AUTH_TOKEN,
 *   fromNumber: '+15551234567'
 * })
 *
 * router.registerChannel(smsAdapter)
 * ```
 *
 * @module db/primitives/notifications/channels/sms
 */

import type { ChannelAdapter, NotificationPayload, Recipient } from '../router'

// =============================================================================
// Types
// =============================================================================

export type SMSProvider = 'twilio' | 'sns' | 'messagebird' | 'vonage' | 'mock'

export interface SMSConfig {
  provider: SMSProvider
  // Twilio
  accountSid?: string
  authToken?: string
  // AWS SNS
  awsRegion?: string
  awsAccessKeyId?: string
  awsSecretAccessKey?: string
  // MessageBird
  accessKey?: string
  // Vonage
  apiKey?: string
  apiSecret?: string
  // Common
  fromNumber: string
  // Custom send function (for testing or custom providers)
  customSend?: (payload: SMSPayload) => Promise<{ messageId: string }>
}

export interface SMSPayload {
  to: string
  from: string
  body: string
  metadata?: Record<string, unknown>
}

// =============================================================================
// SMS Adapter Implementation
// =============================================================================

export function createSMSAdapter(config: SMSConfig): ChannelAdapter {
  return {
    type: 'sms',

    async send(notification: NotificationPayload, recipient: Recipient): Promise<{ messageId: string }> {
      if (!recipient.phone) {
        const error = new Error('Recipient phone number is required')
        ;(error as any).retryable = false
        throw error
      }

      const payload: SMSPayload = {
        to: normalizePhoneNumber(recipient.phone),
        from: config.fromNumber,
        body: notification.body,
        metadata: notification.metadata,
      }

      // Use custom send if provided
      if (config.customSend) {
        return config.customSend(payload)
      }

      // Provider-specific implementations
      switch (config.provider) {
        case 'twilio':
          return sendViaTwilio(payload, config)
        case 'sns':
          return sendViaSNS(payload, config)
        case 'messagebird':
          return sendViaMessageBird(payload, config)
        case 'vonage':
          return sendViaVonage(payload, config)
        case 'mock':
          return sendViaMock(payload)
        default:
          throw new Error(`Unknown SMS provider: ${config.provider}`)
      }
    },

    async validateRecipient(recipient: Recipient): Promise<boolean> {
      if (!recipient.phone) return false

      // Basic phone number validation (E.164 format or common formats)
      const phoneRegex = /^\+?[1-9]\d{6,14}$/
      const normalized = recipient.phone.replace(/[\s\-\(\)]/g, '')
      return phoneRegex.test(normalized)
    },
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function normalizePhoneNumber(phone: string): string {
  // Remove common formatting characters
  let normalized = phone.replace(/[\s\-\(\)]/g, '')

  // Ensure E.164 format starts with +
  if (!normalized.startsWith('+')) {
    // Assume US number if no country code
    if (normalized.length === 10) {
      normalized = '+1' + normalized
    } else if (normalized.length === 11 && normalized.startsWith('1')) {
      normalized = '+' + normalized
    }
  }

  return normalized
}

// =============================================================================
// Provider Implementations
// =============================================================================

async function sendViaTwilio(payload: SMSPayload, config: SMSConfig): Promise<{ messageId: string }> {
  if (!config.accountSid || !config.authToken) {
    throw new Error('Twilio accountSid and authToken are required')
  }

  const credentials = btoa(`${config.accountSid}:${config.authToken}`)

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: payload.to,
      From: payload.from,
      Body: payload.body,
    }).toString(),
  })

  if (!response.ok) {
    const error = new Error(`Twilio API error: ${response.status}`)
    ;(error as any).retryable = response.status >= 500 || response.status === 429
    throw error
  }

  const data = (await response.json()) as { sid: string }
  return { messageId: data.sid }
}

async function sendViaSNS(payload: SMSPayload, config: SMSConfig): Promise<{ messageId: string }> {
  // AWS SNS implementation would go here
  throw new Error('AWS SNS provider not yet implemented - use customSend for integration')
}

async function sendViaMessageBird(payload: SMSPayload, config: SMSConfig): Promise<{ messageId: string }> {
  if (!config.accessKey) {
    throw new Error('MessageBird access key is required')
  }

  const response = await fetch('https://rest.messagebird.com/messages', {
    method: 'POST',
    headers: {
      Authorization: `AccessKey ${config.accessKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      originator: payload.from,
      recipients: [payload.to],
      body: payload.body,
    }),
  })

  if (!response.ok) {
    const error = new Error(`MessageBird API error: ${response.status}`)
    ;(error as any).retryable = response.status >= 500 || response.status === 429
    throw error
  }

  const data = (await response.json()) as { id: string }
  return { messageId: data.id }
}

async function sendViaVonage(payload: SMSPayload, config: SMSConfig): Promise<{ messageId: string }> {
  if (!config.apiKey || !config.apiSecret) {
    throw new Error('Vonage apiKey and apiSecret are required')
  }

  const response = await fetch('https://rest.nexmo.com/sms/json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      from: payload.from,
      to: payload.to,
      text: payload.body,
    }),
  })

  if (!response.ok) {
    const error = new Error(`Vonage API error: ${response.status}`)
    ;(error as any).retryable = response.status >= 500 || response.status === 429
    throw error
  }

  const data = (await response.json()) as {
    messages?: Array<{ status: string; 'error-text'?: string; 'message-id'?: string }>
  }
  if (data.messages?.[0]?.status !== '0') {
    const error = new Error(`Vonage send failed: ${data.messages?.[0]?.['error-text']}`)
    ;(error as any).retryable = false
    throw error
  }

  return { messageId: data.messages![0]!['message-id']! }
}

async function sendViaMock(payload: SMSPayload): Promise<{ messageId: string }> {
  // Mock implementation for testing
  console.log('[Mock SMS]', {
    to: payload.to,
    from: payload.from,
    body: payload.body.substring(0, 100),
  })
  return { messageId: `mock_sms_${Date.now()}_${Math.random().toString(36).slice(2)}` }
}

// =============================================================================
// Exports
// =============================================================================

export type { ChannelAdapter }
