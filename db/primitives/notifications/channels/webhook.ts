/**
 * Webhook Channel Adapter
 *
 * Provides webhook-based notification delivery:
 * - HTTP POST to custom endpoints
 * - Configurable headers and authentication
 * - Retry with exponential backoff
 * - Signature verification support
 *
 * @example
 * ```typescript
 * import { createWebhookAdapter } from 'db/primitives/notifications/channels/webhook'
 *
 * const webhookAdapter = createWebhookAdapter({
 *   defaultUrl: 'https://api.example.com/webhooks/notifications',
 *   headers: {
 *     'X-API-Key': process.env.WEBHOOK_API_KEY
 *   },
 *   signatureSecret: process.env.WEBHOOK_SECRET
 * })
 *
 * router.registerChannel(webhookAdapter)
 * ```
 *
 * @module db/primitives/notifications/channels/webhook
 */

import type { ChannelAdapter, NotificationPayload, Recipient } from '../router'

// =============================================================================
// Types
// =============================================================================

export interface WebhookConfig {
  defaultUrl?: string
  headers?: Record<string, string>
  signatureSecret?: string
  signatureHeader?: string
  timeout?: number
  method?: 'POST' | 'PUT' | 'PATCH'
  // Custom send function (for testing or custom providers)
  customSend?: (payload: WebhookPayload) => Promise<{ messageId: string }>
}

export interface WebhookPayload {
  url: string
  method: 'POST' | 'PUT' | 'PATCH'
  headers: Record<string, string>
  body: Record<string, unknown>
  timeout?: number
}

// =============================================================================
// Webhook Adapter Implementation
// =============================================================================

export function createWebhookAdapter(config: WebhookConfig): ChannelAdapter {
  return {
    type: 'webhook',

    async send(notification: NotificationPayload, recipient: Recipient): Promise<{ messageId: string }> {
      const url = recipient.webhookUrl ?? config.defaultUrl

      if (!url) {
        const error = new Error('Webhook URL is required')
        ;(error as any).retryable = false
        throw error
      }

      const body: Record<string, unknown> = {
        notificationId: notification.notificationId,
        userId: notification.userId,
        subject: notification.subject,
        body: notification.body,
        priority: notification.priority,
        category: notification.category,
        metadata: notification.metadata,
        timestamp: new Date().toISOString(),
      }

      // Handle digest notifications
      if (notification.isDigest && notification.items) {
        body.isDigest = true
        body.items = notification.items
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...config.headers,
      }

      // Add signature if secret is configured
      if (config.signatureSecret) {
        const signature = await generateSignature(JSON.stringify(body), config.signatureSecret)
        headers[config.signatureHeader ?? 'X-Webhook-Signature'] = signature
      }

      const payload: WebhookPayload = {
        url,
        method: config.method ?? 'POST',
        headers,
        body,
        timeout: config.timeout ?? 30000,
      }

      // Use custom send if provided
      if (config.customSend) {
        return config.customSend(payload)
      }

      return sendViaHTTP(payload)
    },

    async validateRecipient(recipient: Recipient): Promise<boolean> {
      const url = recipient.webhookUrl ?? config.defaultUrl
      if (!url) return false

      // Validate URL format
      try {
        new URL(url)
        return true
      } catch {
        return false
      }
    },
  }
}

// =============================================================================
// HTTP Implementation
// =============================================================================

async function sendViaHTTP(payload: WebhookPayload): Promise<{ messageId: string }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), payload.timeout ?? 30000)

  try {
    const response = await fetch(payload.url, {
      method: payload.method,
      headers: payload.headers,
      body: JSON.stringify(payload.body),
      signal: controller.signal,
    })

    if (!response.ok) {
      const error = new Error(`Webhook HTTP error: ${response.status}`)
      // Retry on server errors and rate limits
      ;(error as any).retryable = response.status >= 500 || response.status === 429
      throw error
    }

    // Try to extract message ID from response
    try {
      const data = (await response.json()) as { id?: string; messageId?: string }
      return { messageId: data.id ?? data.messageId ?? `webhook_${Date.now()}` }
    } catch {
      return { messageId: `webhook_${Date.now()}_${Math.random().toString(36).slice(2)}` }
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Webhook request timed out')
      ;(timeoutError as any).retryable = true
      throw timeoutError
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

// =============================================================================
// Signature Generation
// =============================================================================

async function generateSignature(payload: string, secret: string): Promise<string> {
  // Use Web Crypto API for HMAC-SHA256 signature
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const messageData = encoder.encode(payload)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
  const signatureArray = new Uint8Array(signature)

  // Convert to hex string
  return Array.from(signatureArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Verify a webhook signature
 * Use this when receiving webhooks from other services
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const expectedSignature = await generateSignature(payload, secret)
  return signature === expectedSignature
}

// =============================================================================
// Exports
// =============================================================================

export type { ChannelAdapter }
