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
  /** Original message before any splitting */
  originalBody?: string
  /** Part number if this is a multipart message */
  partNumber?: number
  /** Total parts in the multipart message */
  totalParts?: number
  metadata?: Record<string, unknown>
}

// SMS character limits
export const SMS_LIMITS = {
  /** Standard GSM-7 single message limit */
  GSM7_SINGLE: 160,
  /** GSM-7 limit per part in multipart */
  GSM7_MULTIPART: 153,
  /** Unicode (UCS-2) single message limit */
  UCS2_SINGLE: 70,
  /** UCS-2 limit per part in multipart */
  UCS2_MULTIPART: 67,
  /** Maximum recommended parts to avoid delivery issues */
  MAX_PARTS: 10,
}

/**
 * Check if a string contains only GSM-7 characters
 */
export function isGSM7(text: string): boolean {
  // GSM-7 basic character set
  const gsm7Chars = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-.\/0-9:;<=>?¡A-ZÄÖÑܧ¿a-zäöñüà]*$/
  // Extended GSM-7 characters that take 2 bytes
  const gsm7Extended = /[€\[\]{}\\|^~]/

  // Remove extended chars for basic check
  const textWithoutExtended = text.replace(/[€\[\]{}\\|^~]/g, '')
  return gsm7Chars.test(textWithoutExtended)
}

/**
 * Calculate the number of SMS parts needed for a message
 */
export function calculateSMSParts(text: string): {
  parts: number
  encoding: 'GSM-7' | 'UCS-2'
  charsPerPart: number
  totalChars: number
} {
  const encoding = isGSM7(text) ? 'GSM-7' : 'UCS-2'

  // Count extended GSM-7 chars that take 2 bytes
  const extendedCount = (text.match(/[€\[\]{}\\|^~]/g) || []).length
  const effectiveLength = encoding === 'GSM-7' ? text.length + extendedCount : text.length

  const singleLimit = encoding === 'GSM-7' ? SMS_LIMITS.GSM7_SINGLE : SMS_LIMITS.UCS2_SINGLE
  const multipartLimit = encoding === 'GSM-7' ? SMS_LIMITS.GSM7_MULTIPART : SMS_LIMITS.UCS2_MULTIPART

  if (effectiveLength <= singleLimit) {
    return {
      parts: 1,
      encoding,
      charsPerPart: singleLimit,
      totalChars: effectiveLength,
    }
  }

  const parts = Math.ceil(effectiveLength / multipartLimit)
  return {
    parts,
    encoding,
    charsPerPart: multipartLimit,
    totalChars: effectiveLength,
  }
}

/**
 * Split a message into SMS parts
 */
export function splitSMSMessage(text: string, maxParts: number = SMS_LIMITS.MAX_PARTS): string[] {
  const { parts, encoding, charsPerPart } = calculateSMSParts(text)

  if (parts === 1) {
    return [text]
  }

  // If too many parts, truncate with indicator
  if (parts > maxParts) {
    const truncateIndicator = '...'
    const availableChars = (charsPerPart * maxParts) - truncateIndicator.length
    return splitTextIntoParts(text.substring(0, availableChars) + truncateIndicator, charsPerPart)
  }

  return splitTextIntoParts(text, charsPerPart)
}

function splitTextIntoParts(text: string, partSize: number): string[] {
  const parts: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    // Try to split at word boundary if possible
    let splitPoint = partSize
    if (remaining.length > partSize) {
      const lastSpace = remaining.lastIndexOf(' ', partSize)
      if (lastSpace > partSize * 0.7) {
        splitPoint = lastSpace
      }
    }

    parts.push(remaining.substring(0, splitPoint).trim())
    remaining = remaining.substring(splitPoint).trim()
  }

  return parts
}

// =============================================================================
// SMS Adapter Implementation
// =============================================================================

export interface SMSAdapterConfig extends SMSConfig {
  /** Enable multipart message handling */
  enableMultipart?: boolean
  /** Maximum parts for multipart messages (default: 10) */
  maxParts?: number
  /** Add part indicators like (1/3) to messages */
  addPartIndicators?: boolean
}

export function createSMSAdapter(config: SMSAdapterConfig): ChannelAdapter {
  const enableMultipart = config.enableMultipart ?? true
  const maxParts = config.maxParts ?? SMS_LIMITS.MAX_PARTS
  const addPartIndicators = config.addPartIndicators ?? false

  return {
    type: 'sms',

    async send(notification: NotificationPayload, recipient: Recipient): Promise<{ messageId: string }> {
      if (!recipient.phone) {
        const error = new Error('Recipient phone number is required')
        ;(error as any).retryable = false
        throw error
      }

      const toNumber = normalizePhoneNumber(recipient.phone)
      const originalBody = notification.body

      // Check if we need multipart handling
      const { parts: partCount } = calculateSMSParts(originalBody)

      if (enableMultipart && partCount > 1) {
        // Split message into parts
        const messageParts = splitSMSMessage(originalBody, maxParts)
        const messageIds: string[] = []

        for (let i = 0; i < messageParts.length; i++) {
          let partBody = messageParts[i]

          // Add part indicators if enabled
          if (addPartIndicators && messageParts.length > 1) {
            partBody = `(${i + 1}/${messageParts.length}) ${partBody}`
          }

          const payload: SMSPayload = {
            to: toNumber,
            from: config.fromNumber,
            body: partBody,
            originalBody,
            partNumber: i + 1,
            totalParts: messageParts.length,
            metadata: notification.metadata,
          }

          // Use custom send if provided
          if (config.customSend) {
            const result = await config.customSend(payload)
            messageIds.push(result.messageId)
            continue
          }

          // Send via provider
          const result = await sendPart(payload, config)
          messageIds.push(result.messageId)
        }

        // Return combined message ID for all parts
        return { messageId: messageIds.join(',') }
      }

      // Single message - no splitting needed
      const payload: SMSPayload = {
        to: toNumber,
        from: config.fromNumber,
        body: originalBody,
        metadata: notification.metadata,
      }

      // Use custom send if provided
      if (config.customSend) {
        return config.customSend(payload)
      }

      return sendPart(payload, config)
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

async function sendPart(payload: SMSPayload, config: SMSConfig): Promise<{ messageId: string }> {
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
