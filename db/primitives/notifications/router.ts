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
 * // Send notification
 * await router.send({
 *   userId: 'user_123',
 *   channels: ['email', 'push'],
 *   content: { subject: 'Hello', body: 'World' },
 *   recipient: { email: 'user@example.com' }
 * })
 * ```
 *
 * @module db/primitives/notifications
 */

import { type MetricsCollector, noopMetrics, MetricNames } from '../observability'
import { murmurHash3 } from '../utils/murmur3'

// =============================================================================
// Duration Helpers
// =============================================================================

export interface Duration {
  toMillis(): number
}

class DurationImpl implements Duration {
  constructor(private readonly millis: number) {}

  toMillis(): number {
    return this.millis
  }
}

export function hours(n: number): Duration {
  return new DurationImpl(n * 60 * 60 * 1000)
}

export function minutes(n: number): Duration {
  return new DurationImpl(n * 60 * 1000)
}

export function seconds(n: number): Duration {
  return new DurationImpl(n * 1000)
}

// =============================================================================
// Types - Channel
// =============================================================================

export type ChannelType = 'email' | 'sms' | 'push' | 'in-app' | 'slack' | 'webhook'

export interface ChannelConfig {
  provider?: string
  [key: string]: unknown
}

export interface ChannelAdapter {
  type: ChannelType
  send: (notification: NotificationPayload, recipient: Recipient) => Promise<{ messageId: string }>
  validateRecipient: (recipient: Recipient) => Promise<boolean>
  priority?: number
}

export interface Channel {
  adapter: ChannelAdapter
  config?: ChannelConfig
}

// =============================================================================
// Types - Notification
// =============================================================================

export interface NotificationContent {
  subject?: string
  body: string
  contentType?: 'text/plain' | 'text/html'
}

export interface Recipient {
  email?: string
  phone?: string
  deviceToken?: string
  slackUserId?: string
  webhookUrl?: string
  [key: string]: unknown
}

export interface NotificationOptions {
  userId: string
  channels: ChannelType[]
  content: NotificationContent
  recipient: Recipient
  priority?: 'low' | 'normal' | 'high' | 'critical'
  category?: string
  metadata?: Record<string, unknown>
  idempotencyKey?: string
  retryPolicy?: Partial<RetryPolicy>
  bypassPreferences?: boolean
  fallbackChannels?: ChannelType[]
  digest?: string
}

export interface NotificationPayload extends NotificationContent {
  notificationId: string
  userId: string
  priority?: 'low' | 'normal' | 'high' | 'critical'
  category?: string
  metadata?: Record<string, unknown>
  isDigest?: boolean
  items?: NotificationContent[]
}

export interface Notification {
  id: string
  userId: string
  channels: ChannelType[]
  content: NotificationContent
  recipient: Recipient
  priority?: 'low' | 'normal' | 'high' | 'critical'
  category?: string
  metadata?: Record<string, unknown>
  createdAt: Date
}

// =============================================================================
// Types - Delivery
// =============================================================================

export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'skipped' | 'rate_limited' | 'queued'

export interface DeliveryRecord {
  notificationId: string
  channel: ChannelType
  status: DeliveryStatus
  messageId?: string
  attempts: number
  error?: string
  skipReason?: string
  metadata?: Record<string, unknown>
  createdAt: Date
  sentAt?: Date
  deliveredAt?: Date
  providerResponse?: unknown
}

export interface NotificationResult {
  notificationId: string
  status: 'sent' | 'partial' | 'failed' | 'skipped' | 'rate_limited' | 'deduplicated' | 'queued'
  deliveries: DeliveryRecord[]
  skipReason?: string
  queueReason?: string
}

// =============================================================================
// Types - Preferences
// =============================================================================

export interface ChannelPreference {
  enabled: boolean
  categories?: string[]
}

export interface QuietHours {
  enabled: boolean
  start: string // HH:mm format
  end: string // HH:mm format
  timezone: string
}

export interface FrequencyLimit {
  maxPerDay?: number
  maxPerWeek?: number
}

export interface DigestPreference {
  enabled: boolean
  interval?: Duration
}

export interface UserPreferences {
  globalOptOut: boolean
  channels: Record<string, ChannelPreference>
  quietHours?: QuietHours
  frequencyLimits?: FrequencyLimit
  digestPreferences?: Record<string, DigestPreference>
}

export interface PreferenceOptions {
  globalOptOut?: boolean
  channels?: Record<string, Partial<ChannelPreference>>
  quietHours?: QuietHours
  frequencyLimits?: FrequencyLimit
  digestPreferences?: Record<string, DigestPreference>
}

// =============================================================================
// Types - Template
// =============================================================================

export interface ChannelTemplate {
  subject?: string
  body: string
  contentType?: 'text/plain' | 'text/html'
}

export interface NotificationTemplate {
  id: string
  name: string
  subject?: string
  body?: string
  channels?: Record<string, ChannelTemplate>
  variables: string[]
}

export type TemplateVariables = Record<string, string | number | boolean | unknown[] | undefined>

// =============================================================================
// Types - Rate Limiting
// =============================================================================

export interface RateLimitConfig {
  maxPerMinute?: number
  maxPerHour?: number
}

export interface RateLimitStatus {
  global: {
    currentMinute: number
    currentHour: number
    remainingMinute: number
    remainingHour: number
  }
  byUser: Record<string, { currentMinute: number; currentHour: number }>
  byChannel: Record<string, { currentMinute: number; currentHour: number }>
}

export interface RateLimitResult {
  allowed: boolean
  reason?: string
  retryAfterMs?: number
}

// =============================================================================
// Types - Retry
// =============================================================================

export interface RetryPolicy {
  maxAttempts: number
  backoffMultiplier: number
  initialDelayMs: number
  maxDelayMs?: number
}

export interface RetryResult {
  success: boolean
  attempts: number
  lastError?: Error
}

// =============================================================================
// Types - Digest
// =============================================================================

export interface DigestConfig {
  enabled: boolean
  interval: Duration
  channels: ChannelType[]
  categories?: string[]
  minItems?: number
  maxItems?: number
  templateId?: string
}

export interface DigestBatch {
  userId: string
  digestId: string
  items: NotificationContent[]
  channels: ChannelType[]
  recipient: Recipient
  createdAt: Date
  scheduledAt: Date
}

// =============================================================================
// Types - Events
// =============================================================================

export type NotificationEventType =
  | 'notification:created'
  | 'notification:sent'
  | 'notification:failed'
  | 'delivery:status_changed'

export type NotificationEventHandler = (event: Record<string, unknown>) => void | Promise<void>

// =============================================================================
// Types - Stats
// =============================================================================

export interface NotificationStats {
  totalSent: number
  totalFailed: number
  totalSkipped: number
  totalRateLimited: number
  byChannel: Record<string, { sent: number; failed: number; skipped: number }>
}

// =============================================================================
// Types - Router Options
// =============================================================================

export interface NotificationRouterOptions {
  defaultRetryPolicy?: Partial<RetryPolicy>
  globalRateLimit?: RateLimitConfig
  deduplicationWindow?: Duration
  metrics?: MetricsCollector
}

// =============================================================================
// Utility Functions
// =============================================================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function generateIdempotencyKey(userId: string, content: NotificationContent, channels: ChannelType[]): string {
  // Include a timestamp bucket (per-second) to allow rapid consecutive notifications
  // but still deduplicate true duplicates within the same second
  const timestampBucket = Math.floor(Date.now() / 1000)
  const channelKey = channels.sort().join(',')
  const hash = murmurHash3(`${userId}:${content.subject ?? ''}:${content.body}:${channelKey}:${timestampBucket}`, 0)
  return `idem_${hash}`
}

function isInQuietHours(quietHours: QuietHours): boolean {
  if (!quietHours.enabled) return false

  const now = new Date()
  // Simple implementation - in production, use proper timezone library
  const currentHour = now.getHours()
  const currentMinute = now.getMinutes()
  const currentTime = currentHour * 60 + currentMinute

  const [startHour = 0, startMinute = 0] = quietHours.start.split(':').map(Number)
  const [endHour = 0, endMinute = 0] = quietHours.end.split(':').map(Number)
  const startTime = startHour * 60 + startMinute
  const endTime = endHour * 60 + endMinute

  // Handle overnight quiet hours (e.g., 22:00 to 08:00)
  if (startTime > endTime) {
    return currentTime >= startTime || currentTime < endTime
  }

  return currentTime >= startTime && currentTime < endTime
}

// =============================================================================
// NotificationRouter Implementation
// =============================================================================

export class NotificationRouter {
  private channels = new Map<ChannelType, ChannelAdapter>()
  private preferences = new Map<string, UserPreferences>()
  private templates = new Map<string, NotificationTemplate>()
  private deliveries = new Map<string, DeliveryRecord[]>()
  private userDeliveryHistory = new Map<string, string[]>()
  private processedIds = new Map<string, { timestamp: number }>()

  private rateLimitState = {
    global: { minute: 0, hour: 0, minuteStart: Date.now(), hourStart: Date.now() },
    byUser: new Map<string, { minute: number; hour: number; minuteStart: number; hourStart: number }>(),
    byChannel: new Map<string, { minute: number; hour: number; minuteStart: number; hourStart: number }>(),
  }
  private userRateLimits = new Map<string, RateLimitConfig>()
  private channelRateLimits = new Map<ChannelType, RateLimitConfig>()

  private digests = new Map<string, DigestConfig>()
  private pendingDigests = new Map<string, DigestBatch>()
  private digestTimers = new Map<string, ReturnType<typeof setTimeout>>()

  private eventHandlers = new Map<NotificationEventType, Set<NotificationEventHandler>>()

  private options: NotificationRouterOptions
  private defaultRetryPolicy: RetryPolicy
  private metrics: MetricsCollector
  private stats: NotificationStats = {
    totalSent: 0,
    totalFailed: 0,
    totalSkipped: 0,
    totalRateLimited: 0,
    byChannel: {},
  }

  constructor(options?: NotificationRouterOptions) {
    this.options = options ?? {}
    this.defaultRetryPolicy = {
      maxAttempts: options?.defaultRetryPolicy?.maxAttempts ?? 3,
      backoffMultiplier: options?.defaultRetryPolicy?.backoffMultiplier ?? 2,
      initialDelayMs: options?.defaultRetryPolicy?.initialDelayMs ?? 1000,
      maxDelayMs: options?.defaultRetryPolicy?.maxDelayMs,
    }
    this.metrics = options?.metrics ?? noopMetrics
  }

  // ===========================================================================
  // Channel Management
  // ===========================================================================

  registerChannel(adapter: ChannelAdapter): void {
    this.channels.set(adapter.type, adapter)
    this.stats.byChannel[adapter.type] = { sent: 0, failed: 0, skipped: 0 }
  }

  getChannel(type: ChannelType): ChannelAdapter | undefined {
    return this.channels.get(type)
  }

  getChannels(): ChannelType[] {
    return Array.from(this.channels.keys())
  }

  // ===========================================================================
  // Send Notifications
  // ===========================================================================

  async send(options: NotificationOptions): Promise<NotificationResult> {
    const start = performance.now()
    const notificationId = generateId()

    try {
      // Check deduplication only if explicit idempotencyKey is provided
      const idempotencyKey = options.idempotencyKey
      if (idempotencyKey) {
        const deduplicationWindow = this.options.deduplicationWindow?.toMillis() ?? 5 * 60 * 1000
        const existing = this.processedIds.get(idempotencyKey)

        if (existing && Date.now() - existing.timestamp < deduplicationWindow) {
          return {
            notificationId,
            status: 'deduplicated',
            deliveries: [],
          }
        }
      }

      // Emit created event
      this.emit('notification:created', { notificationId, userId: options.userId })

      // Get user preferences
      const prefs = await this.getPreferences(options.userId)

      // Check global opt-out (unless bypassed)
      if (prefs.globalOptOut && !options.bypassPreferences) {
        return {
          notificationId,
          status: 'skipped',
          deliveries: [],
          skipReason: 'global_opt_out',
        }
      }

      // Check quiet hours (unless critical or bypassed)
      if (
        prefs.quietHours &&
        isInQuietHours(prefs.quietHours) &&
        options.priority !== 'critical' &&
        !options.bypassPreferences
      ) {
        // Queue for later (simplified - just mark as queued)
        return {
          notificationId,
          status: 'queued',
          deliveries: [],
          queueReason: 'quiet_hours',
        }
      }

      // Check if this should go to digest
      if (options.digest) {
        const digestConfig = this.digests.get(options.digest)
        if (digestConfig?.enabled) {
          const userDigestPref = prefs.digestPreferences?.[options.digest]
          if (!userDigestPref || userDigestPref.enabled !== false) {
            return this.addToDigest(options, digestConfig, notificationId)
          }
        }
      }

      // Check global rate limit
      const globalRateLimitResult = this.checkGlobalRateLimit()
      if (!globalRateLimitResult.allowed) {
        this.stats.totalRateLimited++
        return {
          notificationId,
          status: 'rate_limited',
          deliveries: [],
        }
      }

      // Filter channels based on preferences and availability
      const deliveries: DeliveryRecord[] = []
      let successCount = 0
      let failCount = 0

      const channelsToTry = [...options.channels]
      const fallbackChannels = options.fallbackChannels ?? []
      let channelIndex = 0
      let usedFallback = false

      while (channelIndex < channelsToTry.length || (!usedFallback && failCount > 0 && fallbackChannels.length > 0)) {
        // If primary channels exhausted and all failed, try fallbacks
        if (channelIndex >= channelsToTry.length && failCount > 0 && !usedFallback) {
          channelsToTry.push(...fallbackChannels)
          usedFallback = true
        }

        if (channelIndex >= channelsToTry.length) break

        const channel = channelsToTry[channelIndex]!
        channelIndex++

        const adapter = this.channels.get(channel)
        if (!adapter) {
          continue
        }

        // Check channel preference
        const channelPref = prefs.channels[channel]
        if (channelPref && !channelPref.enabled && !options.bypassPreferences) {
          deliveries.push({
            notificationId,
            channel,
            status: 'skipped',
            skipReason: 'user_opted_out',
            attempts: 0,
            createdAt: new Date(),
          })
          if (this.stats.byChannel[channel]) this.stats.byChannel[channel].skipped++
          continue
        }

        // Check category preference
        if (
          options.category &&
          channelPref?.categories &&
          !channelPref.categories.includes(options.category) &&
          !options.bypassPreferences
        ) {
          deliveries.push({
            notificationId,
            channel,
            status: 'skipped',
            skipReason: 'category_not_subscribed',
            attempts: 0,
            createdAt: new Date(),
          })
          if (this.stats.byChannel[channel]) this.stats.byChannel[channel].skipped++
          continue
        }

        // Check channel rate limit
        const channelRateLimitResult = this.checkChannelRateLimit(channel)
        if (!channelRateLimitResult.allowed) {
          deliveries.push({
            notificationId,
            channel,
            status: 'rate_limited',
            attempts: 0,
            createdAt: new Date(),
          })
          if (this.stats.byChannel[channel]) this.stats.byChannel[channel].skipped++
          continue
        }

        // Check user rate limit
        const userRateLimitResult = this.checkUserRateLimit(options.userId)
        if (!userRateLimitResult.allowed) {
          deliveries.push({
            notificationId,
            channel,
            status: 'rate_limited',
            attempts: 0,
            createdAt: new Date(),
          })
          continue
        }

        // Attempt delivery with retries
        const retryPolicy = {
          ...this.defaultRetryPolicy,
          ...options.retryPolicy,
        }

        const payload: NotificationPayload = {
          notificationId,
          userId: options.userId,
          subject: options.content.subject,
          body: options.content.body,
          priority: options.priority,
          category: options.category,
          metadata: options.metadata,
        }

        const deliveryResult = await this.attemptDeliveryWithRetry(adapter, payload, options.recipient, retryPolicy)

        const delivery: DeliveryRecord = {
          notificationId,
          channel,
          status: deliveryResult.success ? 'sent' : 'failed',
          messageId: deliveryResult.messageId,
          attempts: deliveryResult.attempts,
          error: deliveryResult.error,
          metadata: options.metadata,
          createdAt: new Date(),
          sentAt: deliveryResult.success ? new Date() : undefined,
        }

        deliveries.push(delivery)

        if (deliveryResult.success) {
          successCount++
          this.stats.totalSent++
          if (this.stats.byChannel[channel]) this.stats.byChannel[channel].sent++
          this.incrementRateLimitCounters(options.userId, channel)

          // If we had failures before, stop trying more fallbacks
          if (usedFallback) break
        } else {
          failCount++
          this.stats.totalFailed++
          if (this.stats.byChannel[channel]) this.stats.byChannel[channel].failed++
        }
      }

      // Store deliveries
      this.deliveries.set(notificationId, deliveries)

      // Store in user history
      const userHistory = this.userDeliveryHistory.get(options.userId) ?? []
      userHistory.push(notificationId)
      this.userDeliveryHistory.set(options.userId, userHistory)

      // Mark as processed (only if explicit idempotencyKey was provided)
      if (idempotencyKey) {
        this.processedIds.set(idempotencyKey, { timestamp: Date.now() })
      }

      // Determine overall status
      // If fallback was used and succeeded, count it as 'sent' not 'partial'
      let status: NotificationResult['status']
      const primaryDeliveries = deliveries.filter((d) => options.channels.includes(d.channel))
      const fallbackDeliveries = deliveries.filter((d) => options.fallbackChannels?.includes(d.channel))
      const primarySuccessCount = primaryDeliveries.filter((d) => d.status === 'sent').length
      const primaryFailCount = primaryDeliveries.filter((d) => d.status === 'failed').length
      const fallbackSuccessCount = fallbackDeliveries.filter((d) => d.status === 'sent').length

      if (successCount > 0 && failCount === 0) {
        status = 'sent'
        this.emit('notification:sent', { notificationId, userId: options.userId })
      } else if (primarySuccessCount > 0 && primaryFailCount > 0) {
        // Some primary channels succeeded, some failed
        status = 'partial'
      } else if (primaryFailCount > 0 && fallbackSuccessCount > 0) {
        // Primary failed but fallback succeeded - count as sent
        status = 'sent'
        this.emit('notification:sent', { notificationId, userId: options.userId })
      } else if (deliveries.every((d) => d.status === 'skipped')) {
        status = 'skipped'
        this.stats.totalSkipped++
        const skipReason = deliveries[0]?.skipReason
        return {
          notificationId,
          status,
          deliveries,
          skipReason,
        }
      } else {
        status = 'failed'
        this.emit('notification:failed', { notificationId, userId: options.userId, error: deliveries[0]?.error })
      }

      return {
        notificationId,
        status,
        deliveries,
      }
    } finally {
      this.metrics.recordLatency('notification.send.latency', performance.now() - start)
    }
  }

  async sendOneOf(options: NotificationOptions): Promise<NotificationResult> {
    const notificationId = generateId()
    const prefs = await this.getPreferences(options.userId)

    for (const channel of options.channels) {
      const adapter = this.channels.get(channel)
      if (!adapter) continue

      // Check if channel is enabled
      const channelPref = prefs.channels[channel]
      if (channelPref && !channelPref.enabled) continue

      // Try to send
      const result = await this.send({
        ...options,
        channels: [channel],
      })

      if (result.status === 'sent') {
        return result
      }
    }

    return {
      notificationId,
      status: 'failed',
      deliveries: [],
    }
  }

  // ===========================================================================
  // Delivery Attempt with Retry
  // ===========================================================================

  private async attemptDeliveryWithRetry(
    adapter: ChannelAdapter,
    payload: NotificationPayload,
    recipient: Recipient,
    retryPolicy: RetryPolicy
  ): Promise<{ success: boolean; messageId?: string; attempts: number; error?: string }> {
    let attempts = 0
    let lastError: Error | undefined
    let delayMs = retryPolicy.initialDelayMs

    const maxAttempts = Math.max(1, retryPolicy.maxAttempts)

    while (attempts < maxAttempts) {
      attempts++

      try {
        const result = await adapter.send(payload, recipient)
        return {
          success: true,
          messageId: result.messageId,
          attempts,
        }
      } catch (error: any) {
        lastError = error

        // Check if error is non-retryable
        if (error.retryable === false) {
          return {
            success: false,
            attempts,
            error: error.message,
          }
        }

        // If we have more attempts, wait and retry
        if (attempts < maxAttempts) {
          await this.delay(delayMs)
          delayMs = Math.min(
            delayMs * retryPolicy.backoffMultiplier,
            retryPolicy.maxDelayMs ?? Number.MAX_SAFE_INTEGER
          )
        }
      }
    }

    return {
      success: false,
      attempts,
      error: lastError?.message,
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // ===========================================================================
  // Templates
  // ===========================================================================

  registerTemplate(template: NotificationTemplate): void {
    this.templates.set(template.id, template)
  }

  getTemplate(id: string): NotificationTemplate | undefined {
    return this.templates.get(id)
  }

  async renderTemplate(
    templateId: string,
    variables: TemplateVariables,
    channel?: ChannelType
  ): Promise<NotificationContent> {
    const template = this.templates.get(templateId)
    if (!template) {
      throw new Error(`Template '${templateId}' not found`)
    }

    // Check for missing required variables
    for (const varName of template.variables) {
      // Handle filter syntax like "items|join"
      const baseName = varName.split('|')[0] ?? varName
      if (variables[baseName] === undefined && baseName !== 'trackingUrl') {
        throw new Error(`missing required variable: ${baseName}`)
      }
    }

    // Get channel-specific template or fall back to default
    let subject = template.subject ?? ''
    let body = template.body ?? ''

    if (channel && template.channels?.[channel]) {
      subject = template.channels[channel].subject ?? subject
      body = template.channels[channel].body ?? body
    }

    // Render variables
    subject = this.renderVariables(subject, variables)
    body = this.renderVariables(body, variables)

    return { subject, body }
  }

  private renderVariables(text: string, variables: TemplateVariables): string {
    let result = text

    // Handle conditional sections {{#if var}}...{{/if}}
    result = result.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, varName, content) => {
      return variables[varName] ? content : ''
    })

    // Handle array iteration {{#each items}}...{{/each}}
    result = result.replace(/\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, varName, itemTemplate) => {
      const items = variables[varName] as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(items)) return ''

      return items
        .map((item) => {
          let rendered = itemTemplate
          for (const [key, value] of Object.entries(item)) {
            rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value))
          }
          return rendered
        })
        .join('')
    })

    // Handle simple variable substitution
    for (const [key, value] of Object.entries(variables)) {
      if (value !== undefined) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value))
      }
    }

    return result
  }

  async sendTemplate(options: {
    userId: string
    templateId: string
    channels: ChannelType[]
    variables: TemplateVariables
    recipient: Recipient
    category?: string
    priority?: 'low' | 'normal' | 'high' | 'critical'
    metadata?: Record<string, unknown>
    bypassPreferences?: boolean
  }): Promise<NotificationResult> {
    // Render content for each channel
    const content = await this.renderTemplate(options.templateId, options.variables)

    return this.send({
      userId: options.userId,
      channels: options.channels,
      content,
      recipient: options.recipient,
      category: options.category,
      priority: options.priority,
      metadata: options.metadata,
      bypassPreferences: options.bypassPreferences,
    })
  }

  // ===========================================================================
  // User Preferences
  // ===========================================================================

  async setPreferences(userId: string, options: PreferenceOptions): Promise<void> {
    const existing = this.preferences.get(userId) ?? this.getDefaultPreferences()

    const updated: UserPreferences = {
      globalOptOut: options.globalOptOut ?? existing.globalOptOut,
      channels: { ...existing.channels },
      quietHours: options.quietHours ?? existing.quietHours,
      frequencyLimits: options.frequencyLimits ?? existing.frequencyLimits,
      digestPreferences: options.digestPreferences ?? existing.digestPreferences,
    }

    // Merge channel preferences
    if (options.channels) {
      for (const [channel, pref] of Object.entries(options.channels)) {
        updated.channels[channel] = {
          enabled: pref.enabled ?? existing.channels[channel]?.enabled ?? true,
          categories: pref.categories ?? existing.channels[channel]?.categories,
        }
      }
    }

    this.preferences.set(userId, updated)
  }

  async getPreferences(userId: string): Promise<UserPreferences> {
    return this.preferences.get(userId) ?? this.getDefaultPreferences()
  }

  private getDefaultPreferences(): UserPreferences {
    return {
      globalOptOut: false,
      channels: {},
    }
  }

  // ===========================================================================
  // Rate Limiting
  // ===========================================================================

  setRateLimit(userId: string, config: RateLimitConfig): void {
    this.userRateLimits.set(userId, config)
  }

  setChannelRateLimit(channel: ChannelType, config: RateLimitConfig): void {
    this.channelRateLimits.set(channel, config)
  }

  private checkGlobalRateLimit(): RateLimitResult {
    const config = this.options.globalRateLimit
    if (!config) return { allowed: true }

    const now = Date.now()
    const state = this.rateLimitState.global

    // Reset minute counter if needed
    if (now - state.minuteStart >= 60 * 1000) {
      state.minute = 0
      state.minuteStart = now
    }

    // Reset hour counter if needed
    if (now - state.hourStart >= 60 * 60 * 1000) {
      state.hour = 0
      state.hourStart = now
    }

    if (config.maxPerMinute && state.minute >= config.maxPerMinute) {
      return { allowed: false, reason: 'global_minute_limit' }
    }

    if (config.maxPerHour && state.hour >= config.maxPerHour) {
      return { allowed: false, reason: 'global_hour_limit' }
    }

    return { allowed: true }
  }

  private checkUserRateLimit(userId: string): RateLimitResult {
    const config = this.userRateLimits.get(userId)
    if (!config) return { allowed: true }

    const now = Date.now()
    let state = this.rateLimitState.byUser.get(userId)

    if (!state) {
      state = { minute: 0, hour: 0, minuteStart: now, hourStart: now }
      this.rateLimitState.byUser.set(userId, state)
    }

    // Reset counters if needed
    if (now - state.minuteStart >= 60 * 1000) {
      state.minute = 0
      state.minuteStart = now
    }

    if (now - state.hourStart >= 60 * 60 * 1000) {
      state.hour = 0
      state.hourStart = now
    }

    if (config.maxPerMinute && state.minute >= config.maxPerMinute) {
      return { allowed: false, reason: 'user_minute_limit' }
    }

    if (config.maxPerHour && state.hour >= config.maxPerHour) {
      return { allowed: false, reason: 'user_hour_limit' }
    }

    return { allowed: true }
  }

  private checkChannelRateLimit(channel: ChannelType): RateLimitResult {
    const config = this.channelRateLimits.get(channel)
    if (!config) return { allowed: true }

    const now = Date.now()
    let state = this.rateLimitState.byChannel.get(channel)

    if (!state) {
      state = { minute: 0, hour: 0, minuteStart: now, hourStart: now }
      this.rateLimitState.byChannel.set(channel, state)
    }

    // Reset counters if needed
    if (now - state.minuteStart >= 60 * 1000) {
      state.minute = 0
      state.minuteStart = now
    }

    if (now - state.hourStart >= 60 * 60 * 1000) {
      state.hour = 0
      state.hourStart = now
    }

    if (config.maxPerMinute && state.minute >= config.maxPerMinute) {
      return { allowed: false, reason: 'channel_minute_limit' }
    }

    if (config.maxPerHour && state.hour >= config.maxPerHour) {
      return { allowed: false, reason: 'channel_hour_limit' }
    }

    return { allowed: true }
  }

  private incrementRateLimitCounters(userId: string, channel: ChannelType): void {
    // Global
    this.rateLimitState.global.minute++
    this.rateLimitState.global.hour++

    // User
    const userState = this.rateLimitState.byUser.get(userId)
    if (userState) {
      userState.minute++
      userState.hour++
    }

    // Channel
    const channelState = this.rateLimitState.byChannel.get(channel)
    if (channelState) {
      channelState.minute++
      channelState.hour++
    }
  }

  getRateLimitStatus(): RateLimitStatus {
    const globalConfig = this.options.globalRateLimit ?? {}
    return {
      global: {
        currentMinute: this.rateLimitState.global.minute,
        currentHour: this.rateLimitState.global.hour,
        remainingMinute: Math.max(0, (globalConfig.maxPerMinute ?? Infinity) - this.rateLimitState.global.minute),
        remainingHour: Math.max(0, (globalConfig.maxPerHour ?? Infinity) - this.rateLimitState.global.hour),
      },
      byUser: Object.fromEntries(
        Array.from(this.rateLimitState.byUser.entries()).map(([userId, state]) => [
          userId,
          { currentMinute: state.minute, currentHour: state.hour },
        ])
      ),
      byChannel: Object.fromEntries(
        Array.from(this.rateLimitState.byChannel.entries()).map(([channel, state]) => [
          channel,
          { currentMinute: state.minute, currentHour: state.hour },
        ])
      ),
    }
  }

  // ===========================================================================
  // Delivery Tracking
  // ===========================================================================

  async getDelivery(notificationId: string, channel?: ChannelType): Promise<DeliveryRecord | undefined> {
    const deliveries = this.deliveries.get(notificationId)
    if (!deliveries) return undefined

    if (channel) {
      return deliveries.find((d) => d.channel === channel)
    }

    return deliveries[0]
  }

  async getDeliveries(notificationId: string): Promise<DeliveryRecord[]> {
    return this.deliveries.get(notificationId) ?? []
  }

  async updateDeliveryStatus(
    notificationId: string,
    channel: ChannelType,
    update: {
      status: DeliveryStatus
      deliveredAt?: Date
      providerResponse?: unknown
    }
  ): Promise<void> {
    const deliveries = this.deliveries.get(notificationId)
    if (!deliveries) return

    const delivery = deliveries.find((d) => d.channel === channel)
    if (!delivery) return

    const previousStatus = delivery.status
    delivery.status = update.status
    delivery.deliveredAt = update.deliveredAt
    delivery.providerResponse = update.providerResponse

    this.emit('delivery:status_changed', {
      notificationId,
      channel,
      previousStatus,
      newStatus: update.status,
    })
  }

  async getDeliveryHistory(
    userId: string,
    options?: {
      limit?: number
      offset?: number
      channel?: ChannelType
      after?: Date
    }
  ): Promise<DeliveryRecord[]> {
    const notificationIds = this.userDeliveryHistory.get(userId) ?? []
    let allDeliveries: DeliveryRecord[] = []

    for (const notificationId of notificationIds) {
      const deliveries = this.deliveries.get(notificationId) ?? []
      allDeliveries.push(...deliveries)
    }

    // Filter by channel
    if (options?.channel) {
      allDeliveries = allDeliveries.filter((d) => d.channel === options.channel)
    }

    // Filter by date
    if (options?.after) {
      allDeliveries = allDeliveries.filter((d) => d.createdAt >= options.after!)
    }

    // Sort by created date (newest first)
    allDeliveries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    // Apply pagination
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? allDeliveries.length

    return allDeliveries.slice(offset, offset + limit)
  }

  // ===========================================================================
  // Digest/Batching
  // ===========================================================================

  configureDigest(digestId: string, config: DigestConfig): void {
    this.digests.set(digestId, config)
  }

  private addToDigest(
    options: NotificationOptions,
    config: DigestConfig,
    notificationId: string
  ): NotificationResult {
    const digestKey = `${options.userId}:${options.digest}`

    let batch = this.pendingDigests.get(digestKey)
    if (!batch) {
      batch = {
        userId: options.userId,
        digestId: options.digest!,
        items: [],
        channels: config.channels,
        recipient: options.recipient,
        createdAt: new Date(),
        scheduledAt: new Date(Date.now() + config.interval.toMillis()),
      }
      this.pendingDigests.set(digestKey, batch)

      // Schedule digest delivery
      const timer = setTimeout(() => {
        this.flushDigestInternal(digestKey, config)
      }, config.interval.toMillis())
      this.digestTimers.set(digestKey, timer)
    }

    batch.items.push(options.content)

    // Check if batch is full
    if (config.maxItems && batch.items.length >= config.maxItems) {
      clearTimeout(this.digestTimers.get(digestKey))
      this.digestTimers.delete(digestKey)
      this.flushDigestInternal(digestKey, config)
    }

    return {
      notificationId,
      status: 'queued',
      deliveries: [],
      queueReason: 'digest',
    }
  }

  private async flushDigestInternal(digestKey: string, config: DigestConfig): Promise<void> {
    const batch = this.pendingDigests.get(digestKey)
    if (!batch) return

    // Check minItems
    if (config.minItems && batch.items.length < config.minItems) {
      return
    }

    this.pendingDigests.delete(digestKey)

    // Build digest notification
    const payload: NotificationPayload = {
      notificationId: generateId(),
      userId: batch.userId,
      body: '',
      isDigest: true,
      items: batch.items,
    }

    // If we have a template, render it
    if (config.templateId) {
      const rendered = await this.renderTemplate(config.templateId, {
        items: batch.items,
        count: batch.items.length,
      })
      payload.subject = rendered.subject
      payload.body = rendered.body
    }

    // Send digest to first available channel
    for (const channel of batch.channels) {
      const adapter = this.channels.get(channel)
      if (adapter) {
        try {
          await adapter.send(payload, batch.recipient)
          this.stats.totalSent++
          break
        } catch {
          this.stats.totalFailed++
        }
      }
    }
  }

  async flushDigest(userId: string, digestId: string): Promise<void> {
    const digestKey = `${userId}:${digestId}`
    const config = this.digests.get(digestId)
    if (!config) return

    clearTimeout(this.digestTimers.get(digestKey))
    this.digestTimers.delete(digestKey)
    await this.flushDigestInternal(digestKey, config)
  }

  async getPendingDigest(userId: string, digestId: string): Promise<NotificationContent[]> {
    const digestKey = `${userId}:${digestId}`
    const batch = this.pendingDigests.get(digestKey)
    return batch?.items ?? []
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  on(event: NotificationEventType, handler: NotificationEventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)
  }

  off(event: NotificationEventType, handler: NotificationEventHandler): void {
    this.eventHandlers.get(event)?.delete(handler)
  }

  private emit(event: NotificationEventType, data: Record<string, unknown>): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      Array.from(handlers).forEach((handler) => {
        try {
          handler(data)
        } catch {
          // Ignore handler errors
        }
      })
    }
  }

  // ===========================================================================
  // Stats
  // ===========================================================================

  getStats(): NotificationStats {
    return { ...this.stats }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  dispose(): void {
    // Clear all timers
    Array.from(this.digestTimers.values()).forEach((timer) => {
      clearTimeout(timer)
    })
    this.digestTimers.clear()

    // Clear all state
    this.channels.clear()
    this.preferences.clear()
    this.templates.clear()
    this.deliveries.clear()
    this.userDeliveryHistory.clear()
    this.processedIds.clear()
    this.digests.clear()
    this.pendingDigests.clear()
    this.eventHandlers.clear()
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createNotificationRouter(options?: NotificationRouterOptions): NotificationRouter {
  return new NotificationRouter(options)
}
