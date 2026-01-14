/**
 * Email Channel Adapter
 *
 * Provides email delivery through various providers:
 * - SendGrid
 * - AWS SES
 * - Resend
 * - Custom SMTP
 *
 * @example
 * ```typescript
 * import { createEmailAdapter } from 'db/primitives/notifications/channels/email'
 *
 * const emailAdapter = createEmailAdapter({
 *   provider: 'sendgrid',
 *   apiKey: process.env.SENDGRID_API_KEY,
 *   fromAddress: 'notifications@myapp.com',
 *   fromName: 'MyApp'
 * })
 *
 * router.registerChannel(emailAdapter)
 * ```
 *
 * @module db/primitives/notifications/channels/email
 */

import type { ChannelAdapter, NotificationPayload, Recipient } from '../router'

// =============================================================================
// Types
// =============================================================================

export type EmailProvider = 'sendgrid' | 'ses' | 'resend' | 'smtp' | 'mock'

export interface EmailConfig {
  provider: EmailProvider
  apiKey?: string
  fromAddress: string
  fromName?: string
  replyTo?: string
  // SMTP-specific
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  smtpPassword?: string
  smtpSecure?: boolean
  // Custom send function (for testing or custom providers)
  customSend?: (payload: EmailPayload) => Promise<{ messageId: string }>
}

export interface EmailPayload {
  to: string
  from: string
  fromName?: string
  replyTo?: string
  subject: string
  body: string
  html?: string
  attachments?: EmailAttachment[]
  headers?: Record<string, string>
  metadata?: Record<string, unknown>
}

export interface EmailAttachment {
  filename: string
  content: string | Buffer
  contentType?: string
}

// =============================================================================
// Email Adapter Implementation
// =============================================================================

export function createEmailAdapter(config: EmailConfig): ChannelAdapter {
  return {
    type: 'email',

    async send(notification: NotificationPayload, recipient: Recipient): Promise<{ messageId: string }> {
      if (!recipient.email) {
        const error = new Error('Recipient email is required')
        ;(error as any).retryable = false
        throw error
      }

      const payload: EmailPayload = {
        to: recipient.email,
        from: config.fromAddress,
        fromName: config.fromName,
        replyTo: config.replyTo,
        subject: notification.subject ?? '',
        body: notification.body,
        metadata: notification.metadata,
      }

      // Add HTML version if content type is html
      if (notification.contentType === 'text/html') {
        payload.html = notification.body
      }

      // Use custom send if provided
      if (config.customSend) {
        return config.customSend(payload)
      }

      // Provider-specific implementations
      switch (config.provider) {
        case 'sendgrid':
          return sendViaSendGrid(payload, config)
        case 'ses':
          return sendViaSES(payload, config)
        case 'resend':
          return sendViaResend(payload, config)
        case 'smtp':
          return sendViaSMTP(payload, config)
        case 'mock':
          return sendViaMock(payload)
        default:
          throw new Error(`Unknown email provider: ${config.provider}`)
      }
    },

    async validateRecipient(recipient: Recipient): Promise<boolean> {
      if (!recipient.email) return false

      // Basic email format validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      return emailRegex.test(recipient.email)
    },
  }
}

// =============================================================================
// Provider Implementations
// =============================================================================

async function sendViaSendGrid(payload: EmailPayload, config: EmailConfig): Promise<{ messageId: string }> {
  if (!config.apiKey) {
    throw new Error('SendGrid API key is required')
  }

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: payload.to }] }],
      from: {
        email: payload.from,
        name: payload.fromName,
      },
      reply_to: payload.replyTo ? { email: payload.replyTo } : undefined,
      subject: payload.subject,
      content: [
        {
          type: payload.html ? 'text/html' : 'text/plain',
          value: payload.html ?? payload.body,
        },
      ],
    }),
  })

  if (!response.ok) {
    const error = new Error(`SendGrid API error: ${response.status}`)
    ;(error as any).retryable = response.status >= 500 || response.status === 429
    throw error
  }

  const messageId = response.headers.get('X-Message-Id') ?? `sg_${Date.now()}`
  return { messageId }
}

async function sendViaSES(payload: EmailPayload, config: EmailConfig): Promise<{ messageId: string }> {
  // AWS SES implementation would go here
  // For now, return a placeholder that indicates it's not implemented
  throw new Error('AWS SES provider not yet implemented - use customSend for integration')
}

async function sendViaResend(payload: EmailPayload, config: EmailConfig): Promise<{ messageId: string }> {
  if (!config.apiKey) {
    throw new Error('Resend API key is required')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: payload.fromName ? `${payload.fromName} <${payload.from}>` : payload.from,
      to: payload.to,
      reply_to: payload.replyTo,
      subject: payload.subject,
      html: payload.html,
      text: payload.body,
    }),
  })

  if (!response.ok) {
    const error = new Error(`Resend API error: ${response.status}`)
    ;(error as any).retryable = response.status >= 500 || response.status === 429
    throw error
  }

  const data = (await response.json()) as { id: string }
  return { messageId: data.id }
}

async function sendViaSMTP(payload: EmailPayload, config: EmailConfig): Promise<{ messageId: string }> {
  // SMTP implementation would go here
  // For now, return a placeholder that indicates it's not implemented
  throw new Error('SMTP provider not yet implemented - use customSend for integration')
}

async function sendViaMock(payload: EmailPayload): Promise<{ messageId: string }> {
  // Mock implementation for testing
  console.log('[Mock Email]', {
    to: payload.to,
    from: payload.from,
    subject: payload.subject,
    body: payload.body.substring(0, 100),
  })
  return { messageId: `mock_${Date.now()}_${Math.random().toString(36).slice(2)}` }
}

// =============================================================================
// Exports
// =============================================================================

export type { ChannelAdapter }
