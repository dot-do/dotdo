/**
 * Push Notification Channel Adapter
 *
 * Provides push notification delivery through various providers:
 * - Firebase Cloud Messaging (FCM)
 * - Apple Push Notification Service (APNS)
 * - Web Push (VAPID)
 * - OneSignal
 * - Expo Push Notifications
 *
 * @example
 * ```typescript
 * import { createPushAdapter } from 'db/primitives/notifications/channels/push'
 *
 * const pushAdapter = createPushAdapter({
 *   provider: 'fcm',
 *   serverKey: process.env.FCM_SERVER_KEY,
 *   // Or for FCM v1:
 *   serviceAccount: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT)
 * })
 *
 * router.registerChannel(pushAdapter)
 * ```
 *
 * @module db/primitives/notifications/channels/push
 */

import type { ChannelAdapter, NotificationPayload, Recipient } from '../router'

// =============================================================================
// Types
// =============================================================================

export type PushProvider = 'fcm' | 'apns' | 'webpush' | 'onesignal' | 'expo' | 'mock'

export interface PushConfig {
  provider: PushProvider
  // FCM
  serverKey?: string
  serviceAccount?: {
    project_id: string
    private_key: string
    client_email: string
  }
  // APNS
  apnsKeyId?: string
  apnsTeamId?: string
  apnsKey?: string
  apnsBundle?: string
  apnsProduction?: boolean
  // Web Push
  vapidPublicKey?: string
  vapidPrivateKey?: string
  vapidSubject?: string
  // OneSignal
  appId?: string
  restApiKey?: string
  // Expo
  accessToken?: string
  // Custom send function (for testing or custom providers)
  customSend?: (payload: PushPayload) => Promise<{ messageId: string }>
}

export interface PushPayload {
  deviceToken: string
  title: string
  body: string
  data?: Record<string, unknown>
  badge?: number
  sound?: string
  icon?: string
  image?: string
  clickAction?: string
  ttl?: number
  priority?: 'normal' | 'high'
  metadata?: Record<string, unknown>
}

// =============================================================================
// Push Adapter Implementation
// =============================================================================

export function createPushAdapter(config: PushConfig): ChannelAdapter {
  return {
    type: 'push',

    async send(notification: NotificationPayload, recipient: Recipient): Promise<{ messageId: string }> {
      if (!recipient.deviceToken) {
        const error = new Error('Recipient device token is required')
        ;(error as any).retryable = false
        throw error
      }

      const payload: PushPayload = {
        deviceToken: recipient.deviceToken,
        title: notification.subject ?? '',
        body: notification.body,
        data: notification.metadata,
        priority: notification.priority === 'high' || notification.priority === 'critical' ? 'high' : 'normal',
        metadata: notification.metadata,
      }

      // Use custom send if provided
      if (config.customSend) {
        return config.customSend(payload)
      }

      // Provider-specific implementations
      switch (config.provider) {
        case 'fcm':
          return sendViaFCM(payload, config)
        case 'apns':
          return sendViaAPNS(payload, config)
        case 'webpush':
          return sendViaWebPush(payload, config)
        case 'onesignal':
          return sendViaOneSignal(payload, config)
        case 'expo':
          return sendViaExpo(payload, config)
        case 'mock':
          return sendViaMock(payload)
        default:
          throw new Error(`Unknown push provider: ${config.provider}`)
      }
    },

    async validateRecipient(recipient: Recipient): Promise<boolean> {
      // Device tokens are typically alphanumeric strings
      if (!recipient.deviceToken) return false
      return recipient.deviceToken.length > 10
    },
  }
}

// =============================================================================
// Provider Implementations
// =============================================================================

async function sendViaFCM(payload: PushPayload, config: PushConfig): Promise<{ messageId: string }> {
  // FCM Legacy API (using server key)
  if (config.serverKey) {
    const response = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        Authorization: `key=${config.serverKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: payload.deviceToken,
        notification: {
          title: payload.title,
          body: payload.body,
          icon: payload.icon,
          image: payload.image,
          click_action: payload.clickAction,
        },
        data: payload.data,
        priority: payload.priority,
        time_to_live: payload.ttl,
      }),
    })

    if (!response.ok) {
      const error = new Error(`FCM API error: ${response.status}`)
      ;(error as any).retryable = response.status >= 500 || response.status === 429
      throw error
    }

    const data = (await response.json()) as {
      failure: number
      multicast_id?: number
      results?: Array<{ error?: string }>
    }

    if (data.failure > 0) {
      const resultError = data.results?.[0]?.error
      const error = new Error(`FCM send failed: ${resultError}`)
      // Some errors are not retryable (e.g., InvalidRegistration)
      ;(error as any).retryable = !['InvalidRegistration', 'NotRegistered', 'InvalidPackageName'].includes(resultError ?? '')
      throw error
    }

    return { messageId: data.multicast_id?.toString() ?? `fcm_${Date.now()}` }
  }

  // FCM v1 API (using service account)
  if (config.serviceAccount) {
    // Get access token
    const accessToken = await getFCMAccessToken(config.serviceAccount)

    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${config.serviceAccount.project_id}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: payload.deviceToken,
            notification: {
              title: payload.title,
              body: payload.body,
              image: payload.image,
            },
            data: payload.data ? Object.fromEntries(Object.entries(payload.data).map(([k, v]) => [k, String(v)])) : undefined,
            android: {
              priority: payload.priority === 'high' ? 'HIGH' : 'NORMAL',
              ttl: payload.ttl ? `${payload.ttl}s` : undefined,
            },
          },
        }),
      }
    )

    if (!response.ok) {
      const error = new Error(`FCM v1 API error: ${response.status}`)
      ;(error as any).retryable = response.status >= 500 || response.status === 429
      throw error
    }

    const data = (await response.json()) as { name: string }
    return { messageId: data.name }
  }

  throw new Error('FCM serverKey or serviceAccount is required')
}

async function getFCMAccessToken(serviceAccount: PushConfig['serviceAccount']): Promise<string> {
  // In production, use proper JWT signing
  // This is a simplified placeholder
  throw new Error('FCM v1 authentication not yet implemented - use serverKey or customSend')
}

async function sendViaAPNS(payload: PushPayload, config: PushConfig): Promise<{ messageId: string }> {
  // APNS implementation would use HTTP/2 client
  throw new Error('APNS provider not yet implemented - use customSend for integration')
}

async function sendViaWebPush(payload: PushPayload, config: PushConfig): Promise<{ messageId: string }> {
  // Web Push implementation
  throw new Error('Web Push provider not yet implemented - use customSend for integration')
}

async function sendViaOneSignal(payload: PushPayload, config: PushConfig): Promise<{ messageId: string }> {
  if (!config.appId || !config.restApiKey) {
    throw new Error('OneSignal appId and restApiKey are required')
  }

  const response = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${config.restApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app_id: config.appId,
      include_player_ids: [payload.deviceToken],
      headings: { en: payload.title },
      contents: { en: payload.body },
      data: payload.data,
      priority: payload.priority === 'high' ? 10 : 5,
    }),
  })

  if (!response.ok) {
    const error = new Error(`OneSignal API error: ${response.status}`)
    ;(error as any).retryable = response.status >= 500 || response.status === 429
    throw error
  }

  const data = (await response.json()) as { id: string }
  return { messageId: data.id }
}

async function sendViaExpo(payload: PushPayload, config: PushConfig): Promise<{ messageId: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (config.accessToken) {
    headers['Authorization'] = `Bearer ${config.accessToken}`
  }

  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      to: payload.deviceToken,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      badge: payload.badge,
      sound: payload.sound ?? 'default',
      priority: payload.priority,
      ttl: payload.ttl,
    }),
  })

  if (!response.ok) {
    const error = new Error(`Expo Push API error: ${response.status}`)
    ;(error as any).retryable = response.status >= 500 || response.status === 429
    throw error
  }

  const data = (await response.json()) as {
    data?: {
      id?: string
      status?: string
      message?: string
      details?: { error?: string }
    }
  }

  if (data.data?.status === 'error') {
    const error = new Error(`Expo Push failed: ${data.data.message}`)
    ;(error as any).retryable = data.data.details?.error !== 'DeviceNotRegistered'
    throw error
  }

  return { messageId: data.data?.id ?? `expo_${Date.now()}` }
}

async function sendViaMock(payload: PushPayload): Promise<{ messageId: string }> {
  // Mock implementation for testing
  console.log('[Mock Push]', {
    deviceToken: payload.deviceToken.substring(0, 20) + '...',
    title: payload.title,
    body: payload.body.substring(0, 100),
  })
  return { messageId: `mock_push_${Date.now()}_${Math.random().toString(36).slice(2)}` }
}

// =============================================================================
// Exports
// =============================================================================

export type { ChannelAdapter }
