/**
 * Channel Adapters for NotificationRouter
 *
 * Pre-built adapters for common notification channels:
 * - Email (SendGrid, AWS SES, Resend, SMTP)
 * - SMS (Twilio, AWS SNS, MessageBird, Vonage) with multipart support
 * - Push (FCM, APNS, Web Push, OneSignal, Expo)
 * - Slack (rich formatting, blocks)
 * - Discord (webhooks, embeds, bot messages)
 * - Webhook (HTTP POST with signature verification)
 * - In-App (storage, real-time delivery)
 *
 * @example
 * ```typescript
 * import {
 *   createEmailAdapter,
 *   createSMSAdapter,
 *   createPushAdapter,
 *   createSlackAdapter,
 *   createWebhookAdapter,
 *   createInAppAdapter
 * } from 'db/primitives/notifications/channels'
 *
 * const router = createNotificationRouter()
 *
 * router.registerChannel(createEmailAdapter({
 *   provider: 'sendgrid',
 *   apiKey: process.env.SENDGRID_API_KEY,
 *   fromAddress: 'notifications@myapp.com'
 * }))
 *
 * router.registerChannel(createSMSAdapter({
 *   provider: 'twilio',
 *   accountSid: process.env.TWILIO_ACCOUNT_SID,
 *   authToken: process.env.TWILIO_AUTH_TOKEN,
 *   fromNumber: '+15551234567'
 * }))
 *
 * router.registerChannel(createPushAdapter({
 *   provider: 'fcm',
 *   serverKey: process.env.FCM_SERVER_KEY
 * }))
 *
 * router.registerChannel(createSlackAdapter({
 *   botToken: process.env.SLACK_BOT_TOKEN
 * }))
 *
 * router.registerChannel(createWebhookAdapter({
 *   defaultUrl: 'https://api.example.com/webhooks'
 * }))
 *
 * router.registerChannel(createInAppAdapter({
 *   storage: inAppStorage,
 *   onNotification: (userId, notification) => {
 *     websocket.sendToUser(userId, notification)
 *   }
 * }))
 * ```
 *
 * @module db/primitives/notifications/channels
 */

// =============================================================================
// Email
// =============================================================================

export {
  createEmailAdapter,
  type EmailProvider,
  type EmailConfig,
  type EmailPayload,
  type EmailAttachment,
} from './email'

// =============================================================================
// SMS
// =============================================================================

export {
  createSMSAdapter,
  isGSM7,
  calculateSMSParts,
  splitSMSMessage,
  SMS_LIMITS,
  type SMSProvider,
  type SMSConfig,
  type SMSPayload,
  type SMSAdapterConfig,
} from './sms'

// =============================================================================
// Discord
// =============================================================================

export {
  createDiscordAdapter,
  createDiscordEmbed,
  formatDiscordMarkdown,
  type DiscordConfig,
  type DiscordPayload,
  type DiscordEmbed,
  type DiscordEmbedField,
} from './discord'

// =============================================================================
// Push Notifications
// =============================================================================

export {
  createPushAdapter,
  type PushProvider,
  type PushConfig,
  type PushPayload,
} from './push'

// =============================================================================
// Slack
// =============================================================================

export {
  createSlackAdapter,
  createSlackMessage,
  type SlackConfig,
  type SlackPayload,
  type SlackBlock,
  type SlackText,
  type SlackAccessory,
  type SlackElement,
  type SlackAttachment,
} from './slack'

// =============================================================================
// Webhook
// =============================================================================

export {
  createWebhookAdapter,
  verifyWebhookSignature,
  type WebhookConfig,
  type WebhookPayload,
} from './webhook'

// =============================================================================
// In-App
// =============================================================================

export {
  createInAppAdapter,
  InMemoryInAppStorage,
  type InAppConfig,
  type InAppNotification,
  type InAppPayload,
  type InAppStorage,
} from './in-app'
