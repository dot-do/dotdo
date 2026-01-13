/**
 * NotificationRouter - Multi-channel notification delivery primitive
 *
 * Provides unified notification delivery with:
 * - Multi-channel routing (email, SMS, push, in-app, Slack, webhook)
 * - User preference management (opt-in/out, frequency limits, quiet hours)
 * - Template rendering with variable substitution
 * - Delivery tracking and retry logic with exponential backoff
 * - Rate limiting per user/channel/global
 * - Digest/batching for high-frequency notifications
 * - Deduplication using ExactlyOnceContext pattern
 *
 * @example
 * ```typescript
 * import { createNotificationRouter } from 'db/primitives/notifications'
 *
 * const router = createNotificationRouter()
 *
 * // Register channels
 * router.registerChannel({
 *   type: 'email',
 *   send: async (notification, recipient) => {
 *     // Send via email provider
 *     return { messageId: 'msg_123' }
 *   },
 *   validateRecipient: async (recipient) => !!recipient.email
 * })
 *
 * // Register templates
 * router.registerTemplate({
 *   id: 'welcome',
 *   name: 'Welcome Email',
 *   subject: 'Welcome to {{appName}}, {{userName}}!',
 *   body: 'Hi {{userName}}, thanks for joining.',
 *   variables: ['appName', 'userName']
 * })
 *
 * // Set user preferences
 * await router.setPreferences('user_123', {
 *   channels: {
 *     email: { enabled: true, categories: ['transactional'] },
 *     sms: { enabled: true, categories: ['transactional'] }
 *   },
 *   quietHours: {
 *     enabled: true,
 *     start: '22:00',
 *     end: '08:00',
 *     timezone: 'America/New_York'
 *   }
 * })
 *
 * // Send notification
 * const result = await router.send({
 *   userId: 'user_123',
 *   channels: ['email', 'push'],
 *   content: { subject: 'Hello', body: 'World' },
 *   recipient: { email: 'user@example.com' }
 * })
 *
 * // Send using template
 * await router.sendTemplate({
 *   userId: 'user_123',
 *   templateId: 'welcome',
 *   channels: ['email'],
 *   variables: { appName: 'MyApp', userName: 'Alice' },
 *   recipient: { email: 'alice@example.com' }
 * })
 *
 * // Configure digest batching
 * router.configureDigest('daily_digest', {
 *   enabled: true,
 *   interval: hours(24),
 *   channels: ['email'],
 *   categories: ['social'],
 *   minItems: 1,
 *   maxItems: 50
 * })
 * ```
 *
 * @module db/primitives/notifications
 */

// =============================================================================
// Main Exports
// =============================================================================

export {
  // Factory
  createNotificationRouter,
  // Main class
  NotificationRouter,
  // Duration helpers
  hours,
  minutes,
  seconds,
  // Types - Duration
  type Duration,
  // Types - Channel
  type Channel,
  type ChannelType,
  type ChannelAdapter,
  type ChannelConfig,
  // Types - Notification
  type Notification,
  type NotificationOptions,
  type NotificationContent,
  type NotificationPayload,
  type NotificationResult,
  type Recipient,
  // Types - Delivery
  type DeliveryStatus,
  type DeliveryRecord,
  // Types - Preferences
  type UserPreferences,
  type PreferenceOptions,
  type ChannelPreference,
  type FrequencyLimit,
  type QuietHours,
  type DigestPreference,
  // Types - Template
  type NotificationTemplate,
  type TemplateVariables,
  type ChannelTemplate,
  // Types - Rate Limiting
  type RateLimitConfig,
  type RateLimitResult,
  type RateLimitStatus,
  // Types - Digest
  type DigestConfig,
  type DigestBatch,
  // Types - Retry
  type RetryPolicy,
  type RetryResult,
  // Types - Events
  type NotificationEventType,
  type NotificationEventHandler,
  // Types - Stats
  type NotificationStats,
  // Types - Router Options
  type NotificationRouterOptions,
} from './router'

// =============================================================================
// Delivery Queue Exports
// =============================================================================

export {
  // Factory
  createDeliveryQueue,
  // Main class
  DeliveryQueue,
  // Types - Storage
  type QueueStorage,
  // Types - Channel
  type NotificationChannel,
  // Types - Priority
  type DeliveryPriority,
  // Types - Item
  type DeliveryItem,
  type EnqueueRequest,
  type EnqueueResult,
  type DeliveryResult,
  type DeliveryHandler,
  type DeliveryItemStatus,
  // Types - DLQ
  type DeadLetterEntry,
  type ReplayResult,
  type BulkReplayResult,
  // Types - Config
  type RetryConfig,
  type BatchConfig,
  type ChannelRateLimit,
  type RateLimitConfig as DeliveryRateLimitConfig,
  type RateLimitStatus as DeliveryRateLimitStatus,
  // Types - Stats
  type QueueStats,
  // Types - Options
  type DeliveryQueueOptions,
} from './delivery-queue'

// =============================================================================
// Template Engine Exports
// =============================================================================

export {
  // Factory
  createTemplateEngine,
  // Main class
  TemplateEngine,
  // Types - Escape
  type EscapeMode,
  // Types - Helper & Filter
  type TemplateHelper,
  type TemplateFilter,
  // Types - Compiled
  type CompiledTemplate,
  type TemplateNode,
  type TemplateNodeType,
  // Types - Config
  type TemplateEngineConfig,
  type TemplateEngineOptions,
  // Types - Render
  type RenderOptions,
} from './template-engine'
