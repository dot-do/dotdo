/**
 * NotificationRouter - Multi-channel notification delivery primitive
 *
 * Provides unified notification delivery across multiple channels:
 * - Channels: email, SMS, push, in-app, webhook
 * - Routing: user preferences, fallback chains, priority
 * - Templates: per-channel templates with variable substitution
 * - Delivery: batching, rate limiting, retry logic
 * - Tracking: delivery status, opens, clicks
 *
 * @module db/primitives/notification-router
 */

// ============================================================================
// TYPES
// ============================================================================

export type Priority = 'low' | 'normal' | 'high' | 'critical'
export type DigestFrequency = 'none' | 'hourly' | 'daily' | 'weekly'
export type DeliveryState = 'pending' | 'sent' | 'delivered' | 'failed' | 'skipped'

export interface QuietHours {
  start: string // HH:mm format
  end: string
  timezone?: string
}

export interface ChannelPreferences {
  enabled: boolean
  digest?: DigestFrequency
  quietHours?: QuietHours
  categories?: Record<string, boolean>
}

export interface UserPreferences {
  email?: ChannelPreferences
  sms?: ChannelPreferences
  push?: ChannelPreferences
  'in-app'?: ChannelPreferences
  webhook?: ChannelPreferences
  [channel: string]: ChannelPreferences | undefined
}

export interface TemplateContent {
  subject?: string
  body: string
  html?: string
  title?: string
  icon?: string
  action?: {
    type: string
    url: string
    label?: string
  }
}

export interface Template {
  email?: TemplateContent
  sms?: TemplateContent
  push?: TemplateContent
  'in-app'?: TemplateContent
  webhook?: TemplateContent
  [channel: string]: TemplateContent | undefined
}

export interface ChannelAdapterResult {
  success: boolean
  messageId?: string
  error?: string
}

export interface ChannelAdapter {
  name: string
  send: (notification: RenderedNotification) => Promise<ChannelAdapterResult>
}

export interface RenderedNotification {
  userId: string
  channel: string
  subject?: string
  body: string
  html?: string
  title?: string
  icon?: string
  action?: {
    type: string
    url: string
    label?: string
  }
  priority: Priority
  url?: string
  [key: string]: unknown
}

export interface Notification {
  userId: string
  template?: string
  content?: Record<string, TemplateContent>
  data?: Record<string, unknown>
  channels?: string[]
  priority?: Priority
  category?: string
  fallbackOnFailure?: boolean
  webhookUrl?: string
}

export interface ChannelResult {
  success: boolean
  messageId?: string
  error?: string
  attempts?: number
  skipped?: boolean
  reason?: string
  status?: DeliveryState
  deliveredAt?: Date
  opens?: number
  openedAt?: Date
  clicks?: number
  clickedLinks?: string[]
}

export interface NotificationResult {
  success: boolean
  notificationId: string
  channels: Record<string, ChannelResult>
}

export interface BatchResult {
  success: boolean
  sent: number
  failed: number
  skipped: number
  results: NotificationResult[]
}

export interface DeliveryStatus {
  notificationId: string
  userId: string
  template?: string
  createdAt: Date
  channels: Record<string, ChannelResult>
}

export interface RateLimitConfig {
  maxPerSecond: number
}

export interface RateLimitStatus {
  maxPerSecond: number
  currentRate: number
  available: number
}

export interface NotificationRouterOptions {
  defaultChannel?: string
  maxRetries?: number
  retryDelay?: number
  retryBackoff?: 'fixed' | 'exponential'
  batchSize?: number
  batchInterval?: number
  rateLimit?: Record<string, RateLimitConfig>
  onSend?: (notification: Notification) => void
  onDelivery?: (result: { success: boolean; channel: string; notificationId: string }) => void
  onError?: (error: Error) => void
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateId(): string {
  const hex = '0123456789abcdef'
  let id = ''
  for (let i = 0; i < 32; i++) {
    if (i === 8 || i === 12 || i === 16 || i === 20) {
      id += '-'
    }
    id += hex[Math.floor(Math.random() * 16)]
  }
  return `notif_${id}`
}

function renderTemplate(
  template: string,
  data: Record<string, unknown>
): string {
  // Process loops first (they contain inner templates that need substitution)
  let result = processLoops(template, data)

  // Process conditionals
  result = processConditionals(result, data)

  // Simple variable substitution: {{variable}}
  result = result.replace(/\{\{([^#/}][^}]*)\}\}/g, (match, path) => {
    const trimmedPath = path.trim()

    // Skip special syntax
    if (trimmedPath === 'else') {
      return match
    }

    // Navigate nested paths like customer.address.city
    const value = getNestedValue(data, trimmedPath)
    return value !== undefined ? String(value) : ''
  })

  return result
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current === 'object' && current !== null) {
      current = (current as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }

  return current
}

function processConditionals(template: string, data: Record<string, unknown>): string {
  // Match {{#if condition}}...{{else}}...{{/if}} or {{#if condition}}...{{/if}}
  const ifRegex = /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g

  return template.replace(ifRegex, (match, condition, content) => {
    const trimmedCondition = condition.trim()
    const value = getNestedValue(data, trimmedCondition)
    const isTruthy = Boolean(value)

    // Check for else block
    const elseParts = content.split(/\{\{else\}\}/)
    const trueBranch = elseParts[0]
    const falseBranch = elseParts[1] || ''

    return isTruthy ? trueBranch : falseBranch
  })
}

function processLoops(template: string, data: Record<string, unknown>): string {
  // Match {{#each array}}...{{/each}}
  const eachRegex = /\{\{#each\s+([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g

  return template.replace(eachRegex, (match, arrayPath, itemTemplate) => {
    const trimmedPath = arrayPath.trim()
    const array = getNestedValue(data, trimmedPath)

    if (!Array.isArray(array)) {
      return ''
    }

    return array
      .map((item, index) => {
        // Replace {{prop}} with item.prop for each item in array
        return itemTemplate.replace(/\{\{([^#/}][^}]*)\}\}/g, (m: string, prop: string) => {
          const trimmedProp = prop.trim()

          // Special loop variables
          if (trimmedProp === '@index') {
            return String(index)
          }
          if (trimmedProp === 'this') {
            return String(item)
          }

          // Access item property
          if (typeof item === 'object' && item !== null) {
            const value = (item as Record<string, unknown>)[trimmedProp]
            return value !== undefined ? String(value) : ''
          }

          // For primitive arrays, use item directly
          return trimmedProp === '' ? String(item) : ''
        })
      })
      .join('')
  })
}

function isInQuietHours(quietHours: QuietHours): boolean {
  const now = new Date()

  // Parse start and end times
  const [startHour, startMin] = quietHours.start.split(':').map(Number) as [number, number]
  const [endHour, endMin] = quietHours.end.split(':').map(Number) as [number, number]

  const currentHour = now.getHours()
  const currentMin = now.getMinutes()
  const currentTime = currentHour * 60 + currentMin
  const startTime = startHour * 60 + startMin
  const endTime = endHour * 60 + endMin

  // Handle overnight quiet hours (e.g., 22:00 to 08:00)
  if (startTime > endTime) {
    return currentTime >= startTime || currentTime < endTime
  }

  return currentTime >= startTime && currentTime < endTime
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// RATE LIMITER
// ============================================================================

class RateLimiter {
  private tokens: number
  private lastRefill: number
  private readonly maxTokens: number
  private readonly refillRate: number

  constructor(maxPerSecond: number) {
    this.maxTokens = maxPerSecond
    this.refillRate = maxPerSecond
    this.tokens = maxPerSecond
    this.lastRefill = Date.now()
  }

  async acquire(): Promise<void> {
    this.refill()

    while (this.tokens < 1) {
      const waitTime = (1 / this.refillRate) * 1000
      await delay(waitTime)
      this.refill()
    }

    this.tokens--
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000
    const tokensToAdd = elapsed * this.refillRate

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd)
    this.lastRefill = now
  }

  getStatus(): RateLimitStatus {
    this.refill()
    return {
      maxPerSecond: this.maxTokens,
      currentRate: this.refillRate,
      available: Math.floor(this.tokens),
    }
  }
}

// ============================================================================
// NOTIFICATION ROUTER CLASS
// ============================================================================

export class NotificationRouter {
  readonly options: Required<
    Pick<
      NotificationRouterOptions,
      | 'maxRetries'
      | 'retryDelay'
      | 'retryBackoff'
      | 'batchSize'
      | 'batchInterval'
    >
  > &
    Pick<NotificationRouterOptions, 'defaultChannel' | 'rateLimit' | 'onSend' | 'onDelivery' | 'onError'>

  private channels: Map<string, ChannelAdapter> = new Map()
  private templates: Map<string, Template> = new Map()
  private preferences: Map<string, UserPreferences> = new Map()
  private deliveryStatus: Map<string, DeliveryStatus> = new Map()
  private deliveryHistory: Map<string, DeliveryStatus[]> = new Map()
  private rateLimiters: Map<string, RateLimiter> = new Map()
  private pendingQueue: Notification[] = []
  private batchTimer: ReturnType<typeof setInterval> | null = null
  private closed = false
  private unreadCounts: Map<string, Map<string, number>> = new Map()

  constructor(options: NotificationRouterOptions = {}) {
    this.options = {
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? 1000,
      retryBackoff: options.retryBackoff ?? 'exponential',
      batchSize: options.batchSize ?? 50,
      batchInterval: options.batchInterval ?? 10000,
      defaultChannel: options.defaultChannel,
      rateLimit: options.rateLimit,
      onSend: options.onSend,
      onDelivery: options.onDelivery,
      onError: options.onError,
    }

    // Initialize rate limiters
    if (options.rateLimit) {
      for (const [channel, config] of Object.entries(options.rateLimit)) {
        this.rateLimiters.set(channel, new RateLimiter(config.maxPerSecond))
      }
    }

    // Start batch timer
    this.startBatchTimer()
  }

  private startBatchTimer(): void {
    if (this.options.batchInterval > 0) {
      this.batchTimer = setInterval(() => {
        this.flushQueue().catch((err) => {
          this.options.onError?.(err)
        })
      }, this.options.batchInterval)
    }
  }

  private stopBatchTimer(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer)
      this.batchTimer = null
    }
  }

  // ============================================================================
  // CHANNEL MANAGEMENT
  // ============================================================================

  registerChannel(name: string, adapter: ChannelAdapter): void {
    this.channels.set(name, adapter)
  }

  unregisterChannel(name: string): void {
    this.channels.delete(name)
  }

  hasChannel(name: string): boolean {
    return this.channels.has(name)
  }

  getChannel(name: string): ChannelAdapter | undefined {
    return this.channels.get(name)
  }

  getChannels(): string[] {
    return Array.from(this.channels.keys())
  }

  // ============================================================================
  // TEMPLATE MANAGEMENT
  // ============================================================================

  registerTemplate(name: string, template: Template): void {
    this.templates.set(name, template)
  }

  hasTemplate(name: string): boolean {
    return this.templates.has(name)
  }

  getTemplate(name: string): Template | undefined {
    return this.templates.get(name)
  }

  renderTemplate(
    templateName: string,
    channel: string,
    data: Record<string, unknown>
  ): TemplateContent {
    const template = this.templates.get(templateName)
    if (!template) {
      throw new Error(`Template not found: ${templateName}`)
    }

    const channelTemplate = template[channel]
    if (!channelTemplate) {
      throw new Error(`Template ${templateName} has no content for channel ${channel}`)
    }

    const rendered: TemplateContent = {
      body: renderTemplate(channelTemplate.body, data),
    }

    if (channelTemplate.subject) {
      rendered.subject = renderTemplate(channelTemplate.subject, data)
    }

    if (channelTemplate.html) {
      rendered.html = renderTemplate(channelTemplate.html, data)
    }

    if (channelTemplate.title) {
      rendered.title = renderTemplate(channelTemplate.title, data)
    }

    if (channelTemplate.icon) {
      rendered.icon = channelTemplate.icon
    }

    if (channelTemplate.action) {
      rendered.action = {
        type: channelTemplate.action.type,
        url: renderTemplate(channelTemplate.action.url, data),
        label: channelTemplate.action.label,
      }
    }

    return rendered
  }

  // ============================================================================
  // USER PREFERENCES
  // ============================================================================

  async setPreferences(userId: string, preferences: UserPreferences): Promise<void> {
    const existing = this.preferences.get(userId) || {}
    this.preferences.set(userId, { ...existing, ...preferences })
  }

  getPreferences(userId: string): UserPreferences | undefined {
    return this.preferences.get(userId)
  }

  private shouldSkipChannel(
    userId: string,
    channel: string,
    priority: Priority,
    category?: string
  ): { skip: boolean; reason?: string } {
    const prefs = this.preferences.get(userId)
    if (!prefs) {
      return { skip: false }
    }

    const channelPrefs = prefs[channel]
    if (!channelPrefs) {
      return { skip: false }
    }

    // Check if channel is disabled
    if (channelPrefs.enabled === false) {
      return { skip: true, reason: 'channel_disabled' }
    }

    // Check category preferences
    if (category && channelPrefs.categories) {
      if (channelPrefs.categories[category] === false) {
        return { skip: true, reason: 'category_disabled' }
      }
    }

    // Check quiet hours (bypass for critical priority)
    if (channelPrefs.quietHours && priority !== 'critical') {
      if (isInQuietHours(channelPrefs.quietHours)) {
        return { skip: true, reason: 'quiet_hours' }
      }
    }

    return { skip: false }
  }

  // ============================================================================
  // SENDING NOTIFICATIONS
  // ============================================================================

  async send(notification: Notification): Promise<NotificationResult> {
    if (this.closed) {
      throw new Error('Router is closed')
    }

    const notificationId = generateId()
    const channels = notification.channels || (this.options.defaultChannel ? [this.options.defaultChannel] : [])
    const priority = notification.priority || 'normal'
    const fallbackOnFailure = notification.fallbackOnFailure ?? false

    // Validate template exists if specified
    if (notification.template && !this.templates.has(notification.template)) {
      throw new Error(`Template not found: ${notification.template}`)
    }

    // Validate all channels are registered
    for (const channel of channels) {
      if (!this.channels.has(channel)) {
        throw new Error(`Channel not registered: ${channel}`)
      }
    }

    this.options.onSend?.(notification)

    const channelResults: Record<string, ChannelResult> = {}
    let hasSuccess = false

    for (const channel of channels) {
      // Check if we should skip this channel based on preferences
      const { skip, reason } = this.shouldSkipChannel(
        notification.userId,
        channel,
        priority,
        notification.category
      )

      if (skip) {
        channelResults[channel] = {
          success: false,
          skipped: true,
          reason,
          status: 'skipped',
        }
        continue
      }

      // In fallback mode, stop after first success
      if (fallbackOnFailure && hasSuccess) {
        break
      }

      // Rate limiting
      const rateLimiter = this.rateLimiters.get(channel)
      if (rateLimiter) {
        await rateLimiter.acquire()
      }

      // Get content - either from template or inline
      let content: TemplateContent
      if (notification.template) {
        content = this.renderTemplate(
          notification.template,
          channel,
          notification.data || {}
        )
      } else if (notification.content?.[channel]) {
        content = notification.content[channel]
      } else {
        throw new Error(`No content for channel ${channel}`)
      }

      // Build rendered notification
      const rendered: RenderedNotification = {
        userId: notification.userId,
        channel,
        ...content,
        priority,
      }

      if (notification.webhookUrl && channel === 'webhook') {
        rendered.url = notification.webhookUrl
      }

      // Send with retries
      const result = await this.sendWithRetry(channel, rendered)
      channelResults[channel] = result

      if (result.success) {
        hasSuccess = true
        result.status = 'delivered'
        result.deliveredAt = new Date()

        this.options.onDelivery?.({
          success: true,
          channel,
          notificationId,
        })

        // Track unread for in-app
        if (channel === 'in-app') {
          this.incrementUnread(notification.userId, channel)
        }
      } else {
        result.status = 'failed'
        this.options.onDelivery?.({
          success: false,
          channel,
          notificationId,
        })
      }
    }

    const result: NotificationResult = {
      success: hasSuccess || Object.values(channelResults).some((r) => r.success),
      notificationId,
      channels: channelResults,
    }

    // Store delivery status
    const status: DeliveryStatus = {
      notificationId,
      userId: notification.userId,
      template: notification.template,
      createdAt: new Date(),
      channels: channelResults,
    }
    this.deliveryStatus.set(notificationId, status)

    // Add to user's history
    const userHistory = this.deliveryHistory.get(notification.userId) || []
    userHistory.unshift(status)
    this.deliveryHistory.set(notification.userId, userHistory)

    return result
  }

  private async sendWithRetry(
    channel: string,
    notification: RenderedNotification
  ): Promise<ChannelResult> {
    const adapter = this.channels.get(channel)
    if (!adapter) {
      return { success: false, error: 'Channel not found', attempts: 0 }
    }

    let attempts = 0
    let lastError: string | undefined
    let delayMs = this.options.retryDelay

    const maxAttempts = 1 + this.options.maxRetries

    while (attempts < maxAttempts) {
      if (attempts > 0) {
        await delay(delayMs)
        if (this.options.retryBackoff === 'exponential') {
          delayMs *= 2
        }
      }

      attempts++

      try {
        const result = await adapter.send(notification)
        if (result.success) {
          return {
            success: true,
            messageId: result.messageId,
            attempts,
          }
        }
        lastError = result.error
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        this.options.onError?.(err instanceof Error ? err : new Error(lastError))
      }
    }

    return {
      success: false,
      error: lastError,
      attempts,
    }
  }

  async sendBatch(notifications: Notification[]): Promise<BatchResult> {
    const results: NotificationResult[] = []
    let sent = 0
    let failed = 0
    let skipped = 0

    for (const notification of notifications) {
      try {
        const result = await this.send(notification)
        results.push(result)

        if (result.success) {
          const anySkipped = Object.values(result.channels).some((c) => c.skipped)
          const anyDelivered = Object.values(result.channels).some(
            (c) => c.success && !c.skipped
          )

          if (anyDelivered) {
            sent++
          }
          if (anySkipped && !anyDelivered) {
            skipped++
          }
        } else {
          const allSkipped = Object.values(result.channels).every((c) => c.skipped)
          if (allSkipped) {
            skipped++
          } else {
            failed++
          }
        }
      } catch (err) {
        failed++
        results.push({
          success: false,
          notificationId: generateId(),
          channels: {},
        })
      }
    }

    return {
      success: failed === 0,
      sent,
      failed,
      skipped,
      results,
    }
  }

  queue(notification: Notification): void {
    if (this.closed) {
      throw new Error('Router is closed')
    }
    this.pendingQueue.push(notification)

    if (this.pendingQueue.length >= this.options.batchSize) {
      this.flushQueue().catch((err) => {
        this.options.onError?.(err)
      })
    }
  }

  private async flushQueue(): Promise<void> {
    if (this.pendingQueue.length === 0) {
      return
    }

    const batch = [...this.pendingQueue]
    this.pendingQueue = []

    await this.sendBatch(batch)
  }

  // ============================================================================
  // DELIVERY TRACKING
  // ============================================================================

  async getDeliveryStatus(notificationId: string): Promise<DeliveryStatus | undefined> {
    return this.deliveryStatus.get(notificationId)
  }

  async getDeliveryHistory(
    userId: string,
    options: { limit?: number; offset?: number; channel?: string } = {}
  ): Promise<DeliveryStatus[]> {
    const { limit = 20, offset = 0, channel } = options
    let history = this.deliveryHistory.get(userId) || []

    if (channel) {
      history = history.filter((status) =>
        Object.keys(status.channels).includes(channel)
      )
    }

    return history.slice(offset, offset + limit)
  }

  async trackOpen(notificationId: string, channel: string): Promise<void> {
    const status = this.deliveryStatus.get(notificationId)
    if (!status || !status.channels[channel]) {
      return
    }

    const channelStatus = status.channels[channel]
    channelStatus.opens = (channelStatus.opens || 0) + 1
    if (!channelStatus.openedAt) {
      channelStatus.openedAt = new Date()
    }
  }

  async trackClick(
    notificationId: string,
    channel: string,
    link: string
  ): Promise<void> {
    const status = this.deliveryStatus.get(notificationId)
    if (!status || !status.channels[channel]) {
      return
    }

    const channelStatus = status.channels[channel]
    channelStatus.clicks = (channelStatus.clicks || 0) + 1
    if (!channelStatus.clickedLinks) {
      channelStatus.clickedLinks = []
    }
    if (!channelStatus.clickedLinks.includes(link)) {
      channelStatus.clickedLinks.push(link)
    }
  }

  // ============================================================================
  // IN-APP NOTIFICATIONS
  // ============================================================================

  private incrementUnread(userId: string, channel: string): void {
    if (!this.unreadCounts.has(userId)) {
      this.unreadCounts.set(userId, new Map())
    }
    const userCounts = this.unreadCounts.get(userId)!
    const current = userCounts.get(channel) || 0
    userCounts.set(channel, current + 1)
  }

  async getUnreadCount(userId: string, channel: string): Promise<number> {
    const userCounts = this.unreadCounts.get(userId)
    if (!userCounts) {
      return 0
    }
    return userCounts.get(channel) || 0
  }

  async markAsRead(notificationId: string, channel: string): Promise<void> {
    const status = this.deliveryStatus.get(notificationId)
    if (!status) {
      return
    }

    const userCounts = this.unreadCounts.get(status.userId)
    if (userCounts) {
      const current = userCounts.get(channel) || 0
      if (current > 0) {
        userCounts.set(channel, current - 1)
      }
    }
  }

  // ============================================================================
  // RATE LIMITING
  // ============================================================================

  getRateLimitStatus(channel: string): RateLimitStatus | undefined {
    const limiter = this.rateLimiters.get(channel)
    return limiter?.getStatus()
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  async close(): Promise<void> {
    if (this.closed) {
      return
    }

    this.stopBatchTimer()
    await this.flushQueue()
    this.closed = true
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createNotificationRouter(
  options: NotificationRouterOptions = {}
): NotificationRouter {
  return new NotificationRouter(options)
}
