/**
 * Notification Digest/Batching System
 *
 * Provides notification aggregation and digest delivery for daily/weekly summaries.
 * Groups notifications by user, category, and time window for efficient delivery.
 *
 * ## Features
 * - **Batch Collection**: Accumulate notifications by user and category
 * - **Digest Templates**: Generate HTML/text summaries with grouping
 * - **Schedule-based Delivery**: Daily, weekly, or custom schedule digests
 * - **Preference Management**: User-configurable digest settings
 *
 * ## Architecture
 *
 * ```
 * Notification -> DigestCollector -> DigestBatch -> DigestRenderer -> Channel
 *                      |                  |              |
 *                   [Group]           [Aggregate]     [Template]
 *                      |                  |              |
 *                 [User/Category]    [Time Window]   [HTML/Text]
 * ```
 *
 * @example Basic usage
 * ```typescript
 * import { NotificationDigest, createDigestCollector } from 'dotdo/lib/channels'
 *
 * // Create a digest collector
 * const collector = createDigestCollector({
 *   schedule: 'daily',
 *   groupBy: ['category', 'sender'],
 * })
 *
 * // Add notifications
 * collector.add({
 *   userId: 'user-123',
 *   category: 'comments',
 *   title: 'New comment on your post',
 *   message: 'Alice commented...',
 *   sender: 'Alice',
 * })
 *
 * // Generate digest
 * const digest = await collector.generateDigest('user-123')
 * console.log(digest.html)
 * ```
 *
 * @module lib/channels/digest
 */

// =============================================================================
// Types
// =============================================================================

/** Digest schedule options */
export type DigestSchedule = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'

/** Day of week for weekly digests */
export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'

/** Digest format options */
export type DigestFormat = 'html' | 'text' | 'markdown' | 'json'

/** Priority level for notifications */
export type NotificationPriority = 'urgent' | 'high' | 'normal' | 'low'

/**
 * Individual notification to be batched
 */
export interface DigestNotification {
  /** Unique notification ID */
  id?: string
  /** Target user ID */
  userId: string
  /** Notification category (e.g., 'comments', 'mentions', 'updates') */
  category: string
  /** Notification title/subject */
  title: string
  /** Notification message body */
  message: string
  /** Sender name or identifier */
  sender?: string
  /** Related entity (e.g., project name, document) */
  entity?: string
  /** Entity type (e.g., 'project', 'document', 'task') */
  entityType?: string
  /** Link URL for this notification */
  link?: string
  /** Timestamp (defaults to now) */
  timestamp?: Date
  /** Priority level */
  priority?: NotificationPriority
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** Icon/avatar URL */
  iconUrl?: string
}

/**
 * Group of notifications for rendering
 */
export interface NotificationGroup {
  /** Group key (category, sender, etc.) */
  key: string
  /** Group label for display */
  label: string
  /** Notifications in this group */
  notifications: DigestNotification[]
  /** Group count */
  count: number
  /** Latest notification timestamp */
  latestAt: Date
  /** Earliest notification timestamp */
  earliestAt: Date
}

/**
 * Generated digest output
 */
export interface DigestOutput {
  /** User ID */
  userId: string
  /** HTML formatted digest */
  html: string
  /** Plain text digest */
  text: string
  /** Markdown formatted digest */
  markdown: string
  /** Structured JSON data */
  json: DigestData
  /** Digest period start */
  periodStart: Date
  /** Digest period end */
  periodEnd: Date
  /** Total notification count */
  totalCount: number
  /** Groups in this digest */
  groups: NotificationGroup[]
  /** Subject line for email */
  subject: string
}

/**
 * Structured digest data
 */
export interface DigestData {
  userId: string
  periodStart: string
  periodEnd: string
  totalCount: number
  groups: Array<{
    key: string
    label: string
    count: number
    notifications: Array<{
      id?: string
      title: string
      message: string
      sender?: string
      entity?: string
      link?: string
      timestamp: string
      priority?: NotificationPriority
    }>
  }>
}

/**
 * User digest preferences
 */
export interface DigestPreferences {
  /** Whether digests are enabled */
  enabled: boolean
  /** Digest schedule */
  schedule: DigestSchedule
  /** Preferred delivery time (hour in 24h format, 0-23) */
  deliveryHour: number
  /** Preferred day for weekly digests */
  weeklyDay?: DayOfWeek
  /** Preferred day of month for monthly digests (1-28) */
  monthlyDay?: number
  /** Custom cron expression (for custom schedule) */
  cronExpression?: string
  /** Preferred format */
  format: DigestFormat
  /** Categories to include (empty = all) */
  includedCategories: string[]
  /** Categories to exclude */
  excludedCategories: string[]
  /** Minimum priority to include */
  minimumPriority?: NotificationPriority
  /** Group notifications by */
  groupBy: ('category' | 'sender' | 'entity' | 'entityType' | 'priority')[]
  /** Maximum notifications per digest */
  maxNotifications?: number
  /** Preferred timezone */
  timezone?: string
  /** Email address for delivery */
  email?: string
  /** Additional delivery channels */
  channels?: string[]
}

/**
 * Digest collector configuration
 */
export interface DigestCollectorConfig {
  /** Default schedule for users without preferences */
  defaultSchedule?: DigestSchedule
  /** Default delivery hour */
  defaultDeliveryHour?: number
  /** Default grouping */
  defaultGroupBy?: DigestPreferences['groupBy']
  /** Maximum age for notifications (ms) - older notifications are discarded */
  maxNotificationAge?: number
  /** Maximum batch size per user */
  maxBatchSize?: number
  /** Storage adapter for persistence */
  storage?: DigestStorage
}

/**
 * Storage interface for digest persistence
 */
export interface DigestStorage {
  /** Save pending notifications for a user */
  saveNotifications(userId: string, notifications: DigestNotification[]): Promise<void>
  /** Load pending notifications for a user */
  loadNotifications(userId: string): Promise<DigestNotification[]>
  /** Clear notifications for a user */
  clearNotifications(userId: string): Promise<void>
  /** Save user preferences */
  savePreferences(userId: string, preferences: DigestPreferences): Promise<void>
  /** Load user preferences */
  loadPreferences(userId: string): Promise<DigestPreferences | null>
  /** Get all user IDs with pending notifications */
  getUsersWithPendingNotifications(): Promise<string[]>
  /** Record last digest sent time */
  recordDigestSent(userId: string, timestamp: Date): Promise<void>
  /** Get last digest sent time */
  getLastDigestSent(userId: string): Promise<Date | null>
}

/**
 * Digest delivery result
 */
export interface DigestDeliveryResult {
  userId: string
  delivered: boolean
  channel: string
  messageId?: string
  error?: string
  timestamp: Date
}

/**
 * Digest statistics
 */
export interface DigestStats {
  /** Total notifications batched */
  totalBatched: number
  /** Notifications by user */
  byUser: Record<string, number>
  /** Notifications by category */
  byCategory: Record<string, number>
  /** Digests generated */
  digestsGenerated: number
  /** Digests delivered */
  digestsDelivered: number
  /** Average notifications per digest */
  avgNotificationsPerDigest: number
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_DELIVERY_HOUR = 9 // 9 AM

const PRIORITY_ORDER: Record<NotificationPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
}

const DAY_TO_NUMBER: Record<DayOfWeek, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

const DEFAULT_PREFERENCES: DigestPreferences = {
  enabled: true,
  schedule: 'daily',
  deliveryHour: DEFAULT_DELIVERY_HOUR,
  format: 'html',
  includedCategories: [],
  excludedCategories: [],
  groupBy: ['category'],
}

// =============================================================================
// Utilities
// =============================================================================

function generateId(): string {
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatDateTime(date: Date): string {
  return `${formatDate(date)} at ${formatTime(date)}`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength - 3) + '...'
}

function getCategoryLabel(category: string): string {
  // Convert snake_case/kebab-case to Title Case
  return category
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function getPriorityLabel(priority: NotificationPriority): string {
  return priority.charAt(0).toUpperCase() + priority.slice(1)
}

function sortByPriority(a: DigestNotification, b: DigestNotification): number {
  const priorityA = PRIORITY_ORDER[a.priority || 'normal']
  const priorityB = PRIORITY_ORDER[b.priority || 'normal']
  if (priorityA !== priorityB) return priorityA - priorityB
  // Secondary sort by timestamp (newest first)
  return (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0)
}

// =============================================================================
// In-Memory Storage (Default)
// =============================================================================

/**
 * Simple in-memory storage for digest data
 * Use DigestStorage interface for production persistence
 */
export class InMemoryDigestStorage implements DigestStorage {
  private notifications = new Map<string, DigestNotification[]>()
  private preferences = new Map<string, DigestPreferences>()
  private lastSent = new Map<string, Date>()

  async saveNotifications(userId: string, notifications: DigestNotification[]): Promise<void> {
    this.notifications.set(userId, notifications)
  }

  async loadNotifications(userId: string): Promise<DigestNotification[]> {
    return this.notifications.get(userId) || []
  }

  async clearNotifications(userId: string): Promise<void> {
    this.notifications.delete(userId)
  }

  async savePreferences(userId: string, preferences: DigestPreferences): Promise<void> {
    this.preferences.set(userId, preferences)
  }

  async loadPreferences(userId: string): Promise<DigestPreferences | null> {
    return this.preferences.get(userId) || null
  }

  async getUsersWithPendingNotifications(): Promise<string[]> {
    return Array.from(this.notifications.keys()).filter(
      (userId) => (this.notifications.get(userId)?.length || 0) > 0
    )
  }

  async recordDigestSent(userId: string, timestamp: Date): Promise<void> {
    this.lastSent.set(userId, timestamp)
  }

  async getLastDigestSent(userId: string): Promise<Date | null> {
    return this.lastSent.get(userId) || null
  }

  /** Clear all data (for testing) */
  clear(): void {
    this.notifications.clear()
    this.preferences.clear()
    this.lastSent.clear()
  }
}

// =============================================================================
// Digest Collector Implementation
// =============================================================================

/**
 * NotificationDigest - Collects and batches notifications for digest delivery
 */
export class NotificationDigest {
  private readonly config: Required<DigestCollectorConfig>
  private readonly storage: DigestStorage

  // In-memory batch for current session
  private pendingBatch = new Map<string, DigestNotification[]>()

  // Statistics
  private stats: DigestStats = {
    totalBatched: 0,
    byUser: {},
    byCategory: {},
    digestsGenerated: 0,
    digestsDelivered: 0,
    avgNotificationsPerDigest: 0,
  }

  constructor(config?: DigestCollectorConfig) {
    const storage = config?.storage ?? new InMemoryDigestStorage()
    this.storage = storage
    this.config = {
      defaultSchedule: config?.defaultSchedule ?? 'daily',
      defaultDeliveryHour: config?.defaultDeliveryHour ?? DEFAULT_DELIVERY_HOUR,
      defaultGroupBy: config?.defaultGroupBy ?? ['category'],
      maxNotificationAge: config?.maxNotificationAge ?? 7 * 24 * 60 * 60 * 1000, // 7 days
      maxBatchSize: config?.maxBatchSize ?? 500,
      storage,
    }
  }

  // ===========================================================================
  // Collection API
  // ===========================================================================

  /**
   * Add a notification to the batch
   */
  async add(notification: DigestNotification): Promise<void> {
    const notif: DigestNotification = {
      ...notification,
      id: notification.id || generateId(),
      timestamp: notification.timestamp || new Date(),
    }

    // Get existing notifications
    const existing = this.pendingBatch.get(notif.userId) || []

    // Apply max batch size limit
    if (existing.length >= this.config.maxBatchSize) {
      // Remove oldest notification
      existing.shift()
    }

    existing.push(notif)
    this.pendingBatch.set(notif.userId, existing)

    // Update stats
    this.stats.totalBatched++
    this.stats.byUser[notif.userId] = (this.stats.byUser[notif.userId] || 0) + 1
    this.stats.byCategory[notif.category] = (this.stats.byCategory[notif.category] || 0) + 1
  }

  /**
   * Add multiple notifications
   */
  async addBatch(notifications: DigestNotification[]): Promise<void> {
    for (const notif of notifications) {
      await this.add(notif)
    }
  }

  /**
   * Get pending notifications for a user
   */
  async getPending(userId: string): Promise<DigestNotification[]> {
    // Combine in-memory and persisted
    const inMemory = this.pendingBatch.get(userId) || []
    const persisted = await this.storage.loadNotifications(userId)
    return [...persisted, ...inMemory]
  }

  /**
   * Get pending notification count for a user
   */
  async getPendingCount(userId: string): Promise<number> {
    const notifications = await this.getPending(userId)
    return notifications.length
  }

  /**
   * Clear pending notifications for a user
   */
  async clearPending(userId: string): Promise<void> {
    this.pendingBatch.delete(userId)
    await this.storage.clearNotifications(userId)
  }

  /**
   * Persist in-memory batch to storage
   */
  async persist(): Promise<void> {
    for (const [userId, notifications] of this.pendingBatch) {
      const existing = await this.storage.loadNotifications(userId)
      await this.storage.saveNotifications(userId, [...existing, ...notifications])
    }
    this.pendingBatch.clear()
  }

  // ===========================================================================
  // Preference Management
  // ===========================================================================

  /**
   * Get user digest preferences
   */
  async getPreferences(userId: string): Promise<DigestPreferences> {
    const stored = await this.storage.loadPreferences(userId)
    if (stored) return stored

    // Return defaults
    return {
      ...DEFAULT_PREFERENCES,
      deliveryHour: this.config.defaultDeliveryHour,
      schedule: this.config.defaultSchedule,
      groupBy: this.config.defaultGroupBy,
    }
  }

  /**
   * Update user digest preferences
   */
  async setPreferences(userId: string, preferences: Partial<DigestPreferences>): Promise<void> {
    const existing = await this.getPreferences(userId)
    const updated = { ...existing, ...preferences }
    await this.storage.savePreferences(userId, updated)
  }

  /**
   * Enable/disable digests for a user
   */
  async setEnabled(userId: string, enabled: boolean): Promise<void> {
    await this.setPreferences(userId, { enabled })
  }

  /**
   * Set digest schedule for a user
   */
  async setSchedule(
    userId: string,
    schedule: DigestSchedule,
    options?: { deliveryHour?: number; weeklyDay?: DayOfWeek; monthlyDay?: number }
  ): Promise<void> {
    await this.setPreferences(userId, {
      schedule,
      deliveryHour: options?.deliveryHour,
      weeklyDay: options?.weeklyDay,
      monthlyDay: options?.monthlyDay,
    })
  }

  // ===========================================================================
  // Digest Generation
  // ===========================================================================

  /**
   * Generate a digest for a user
   */
  async generateDigest(userId: string, options?: { since?: Date; until?: Date }): Promise<DigestOutput> {
    const preferences = await this.getPreferences(userId)
    const notifications = await this.getPending(userId)

    // Filter by time range
    const periodEnd = options?.until || new Date()
    const periodStart = options?.since || this.calculatePeriodStart(preferences, periodEnd)

    let filtered = notifications.filter((n) => {
      const ts = n.timestamp || new Date()
      return ts >= periodStart && ts <= periodEnd
    })

    // Filter by category preferences
    if (preferences.includedCategories.length > 0) {
      filtered = filtered.filter((n) => preferences.includedCategories.includes(n.category))
    }
    if (preferences.excludedCategories.length > 0) {
      filtered = filtered.filter((n) => !preferences.excludedCategories.includes(n.category))
    }

    // Filter by minimum priority
    if (preferences.minimumPriority) {
      const minPriority = PRIORITY_ORDER[preferences.minimumPriority]
      filtered = filtered.filter((n) => PRIORITY_ORDER[n.priority || 'normal'] <= minPriority)
    }

    // Apply max notifications limit
    if (preferences.maxNotifications && filtered.length > preferences.maxNotifications) {
      // Sort by priority and timestamp, take top N
      filtered = filtered.sort(sortByPriority).slice(0, preferences.maxNotifications)
    }

    // Group notifications
    const groups = this.groupNotifications(filtered, preferences.groupBy)

    // Render digest
    const digest = this.renderDigest(userId, groups, periodStart, periodEnd)

    this.stats.digestsGenerated++

    return digest
  }

  /**
   * Check if a user is due for a digest
   */
  async isDueForDigest(userId: string): Promise<boolean> {
    const preferences = await this.getPreferences(userId)
    if (!preferences.enabled) return false

    const lastSent = await this.storage.getLastDigestSent(userId)
    const now = new Date()

    if (!lastSent) {
      // Never sent before - check if we're at delivery time
      return now.getHours() >= preferences.deliveryHour
    }

    return this.isScheduleDue(preferences, lastSent, now)
  }

  /**
   * Get all users due for digest
   */
  async getUsersDueForDigest(): Promise<string[]> {
    const usersWithPending = await this.storage.getUsersWithPendingNotifications()
    const inMemoryUsers = Array.from(this.pendingBatch.keys())
    const allUsers = [...new Set([...usersWithPending, ...inMemoryUsers])]

    const dueUsers: string[] = []
    for (const userId of allUsers) {
      if (await this.isDueForDigest(userId)) {
        dueUsers.push(userId)
      }
    }

    return dueUsers
  }

  /**
   * Record that a digest was sent
   */
  async recordDigestSent(userId: string): Promise<void> {
    await this.storage.recordDigestSent(userId, new Date())
    this.stats.digestsDelivered++
  }

  // ===========================================================================
  // Grouping
  // ===========================================================================

  private groupNotifications(
    notifications: DigestNotification[],
    groupBy: DigestPreferences['groupBy']
  ): NotificationGroup[] {
    if (groupBy.length === 0 || notifications.length === 0) {
      // Single group with all notifications
      const sorted = [...notifications].sort(sortByPriority)
      return [
        {
          key: 'all',
          label: 'All Notifications',
          notifications: sorted,
          count: sorted.length,
          latestAt: sorted[0]?.timestamp || new Date(),
          earliestAt: sorted[sorted.length - 1]?.timestamp || new Date(),
        },
      ]
    }

    // Group by first groupBy dimension
    const primaryGroupBy = groupBy[0]
    const grouped = new Map<string, DigestNotification[]>()

    for (const notif of notifications) {
      const key = this.getGroupKey(notif, primaryGroupBy)
      const existing = grouped.get(key) || []
      existing.push(notif)
      grouped.set(key, existing)
    }

    // Convert to groups and sort
    const groups: NotificationGroup[] = []

    for (const [key, notifs] of grouped) {
      const sorted = notifs.sort(sortByPriority)
      groups.push({
        key,
        label: this.getGroupLabel(key, primaryGroupBy),
        notifications: sorted,
        count: sorted.length,
        latestAt: sorted[0]?.timestamp || new Date(),
        earliestAt: sorted[sorted.length - 1]?.timestamp || new Date(),
      })
    }

    // Sort groups by count (descending) then by latest timestamp
    return groups.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return b.latestAt.getTime() - a.latestAt.getTime()
    })
  }

  private getGroupKey(notification: DigestNotification, groupBy: string): string {
    switch (groupBy) {
      case 'category':
        return notification.category
      case 'sender':
        return notification.sender || 'unknown'
      case 'entity':
        return notification.entity || 'unknown'
      case 'entityType':
        return notification.entityType || 'unknown'
      case 'priority':
        return notification.priority || 'normal'
      default:
        return 'other'
    }
  }

  private getGroupLabel(key: string, groupBy: string): string {
    switch (groupBy) {
      case 'category':
        return getCategoryLabel(key)
      case 'sender':
        return key === 'unknown' ? 'Others' : key
      case 'entity':
        return key === 'unknown' ? 'Other Items' : key
      case 'entityType':
        return getCategoryLabel(key)
      case 'priority':
        return getPriorityLabel(key as NotificationPriority)
      default:
        return key
    }
  }

  // ===========================================================================
  // Rendering
  // ===========================================================================

  private renderDigest(
    userId: string,
    groups: NotificationGroup[],
    periodStart: Date,
    periodEnd: Date
  ): DigestOutput {
    const totalCount = groups.reduce((sum, g) => sum + g.count, 0)

    // Generate subject
    const subject = this.generateSubject(totalCount, periodStart, periodEnd)

    // Generate HTML
    const html = this.renderHtml(groups, periodStart, periodEnd, totalCount)

    // Generate plain text
    const text = this.renderText(groups, periodStart, periodEnd, totalCount)

    // Generate Markdown
    const markdown = this.renderMarkdown(groups, periodStart, periodEnd, totalCount)

    // Generate JSON
    const json = this.renderJson(userId, groups, periodStart, periodEnd)

    return {
      userId,
      html,
      text,
      markdown,
      json,
      periodStart,
      periodEnd,
      totalCount,
      groups,
      subject,
    }
  }

  private generateSubject(totalCount: number, periodStart: Date, periodEnd: Date): string {
    const dateStr = formatDate(periodStart)
    if (totalCount === 0) {
      return `Your Digest for ${dateStr} - No new notifications`
    }
    if (totalCount === 1) {
      return `Your Digest for ${dateStr} - 1 notification`
    }
    return `Your Digest for ${dateStr} - ${totalCount} notifications`
  }

  private renderHtml(
    groups: NotificationGroup[],
    periodStart: Date,
    periodEnd: Date,
    totalCount: number
  ): string {
    const dateRange =
      periodStart.toDateString() === periodEnd.toDateString()
        ? formatDate(periodStart)
        : `${formatDate(periodStart)} - ${formatDate(periodEnd)}`

    let groupsHtml = ''

    if (totalCount === 0) {
      groupsHtml = `
        <tr>
          <td style="padding: 40px; text-align: center; color: #666;">
            <p style="font-size: 16px; margin: 0;">No new notifications during this period.</p>
            <p style="font-size: 14px; margin: 10px 0 0; color: #999;">You're all caught up!</p>
          </td>
        </tr>
      `
    } else {
      for (const group of groups) {
        const notificationsHtml = group.notifications
          .map(
            (n) => `
          <tr>
            <td style="padding: 12px 0; border-bottom: 1px solid #eee;">
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  ${
                    n.iconUrl
                      ? `
                    <td width="40" style="vertical-align: top; padding-right: 12px;">
                      <img src="${escapeHtml(n.iconUrl)}" width="32" height="32" style="border-radius: 50%;" />
                    </td>
                  `
                      : ''
                  }
                  <td style="vertical-align: top;">
                    <div style="font-weight: 600; color: #333; margin-bottom: 4px;">
                      ${n.link ? `<a href="${escapeHtml(n.link)}" style="color: #0066cc; text-decoration: none;">${escapeHtml(n.title)}</a>` : escapeHtml(n.title)}
                      ${n.priority === 'urgent' ? '<span style="color: #dc2626; font-weight: bold;"> [URGENT]</span>' : ''}
                      ${n.priority === 'high' ? '<span style="color: #ea580c;"> [High Priority]</span>' : ''}
                    </div>
                    <div style="color: #555; font-size: 14px; line-height: 1.4;">
                      ${escapeHtml(truncate(n.message, 200))}
                    </div>
                    <div style="color: #999; font-size: 12px; margin-top: 4px;">
                      ${n.sender ? `From ${escapeHtml(n.sender)} &bull; ` : ''}${formatTime(n.timestamp || new Date())}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        `
          )
          .join('')

        groupsHtml += `
          <tr>
            <td style="padding: 20px 0 10px;">
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    <h2 style="margin: 0; font-size: 18px; color: #333;">
                      ${escapeHtml(group.label)}
                      <span style="font-weight: normal; color: #666; font-size: 14px;">(${group.count})</span>
                    </h2>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ${notificationsHtml}
        `
      }
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Notification Digest</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 30px 40px; border-bottom: 1px solid #eee;">
              <h1 style="margin: 0 0 8px; font-size: 24px; color: #333;">Your Notification Digest</h1>
              <p style="margin: 0; color: #666; font-size: 14px;">${dateRange} &bull; ${totalCount} notification${totalCount !== 1 ? 's' : ''}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 30px;">
              <table cellpadding="0" cellspacing="0" width="100%">
                ${groupsHtml}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px; background-color: #f9f9f9; border-top: 1px solid #eee; border-radius: 0 0 8px 8px;">
              <p style="margin: 0; font-size: 12px; color: #999; text-align: center;">
                You're receiving this digest because you have notifications enabled.
                <a href="#preferences" style="color: #666;">Manage preferences</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
  }

  private renderText(
    groups: NotificationGroup[],
    periodStart: Date,
    periodEnd: Date,
    totalCount: number
  ): string {
    const dateRange =
      periodStart.toDateString() === periodEnd.toDateString()
        ? formatDate(periodStart)
        : `${formatDate(periodStart)} - ${formatDate(periodEnd)}`

    let text = `YOUR NOTIFICATION DIGEST\n`
    text += `${dateRange} - ${totalCount} notification${totalCount !== 1 ? 's' : ''}\n`
    text += `${'='.repeat(50)}\n\n`

    if (totalCount === 0) {
      text += `No new notifications during this period.\n`
      text += `You're all caught up!\n`
      return text
    }

    for (const group of groups) {
      text += `${group.label.toUpperCase()} (${group.count})\n`
      text += `${'-'.repeat(40)}\n`

      for (const n of group.notifications) {
        const priorityTag = n.priority === 'urgent' ? ' [URGENT]' : n.priority === 'high' ? ' [High]' : ''
        text += `\n* ${n.title}${priorityTag}\n`
        text += `  ${truncate(n.message, 150)}\n`
        if (n.sender || n.timestamp) {
          text += `  `
          if (n.sender) text += `From ${n.sender}`
          if (n.sender && n.timestamp) text += ` - `
          if (n.timestamp) text += formatTime(n.timestamp)
          text += `\n`
        }
        if (n.link) {
          text += `  Link: ${n.link}\n`
        }
      }

      text += `\n`
    }

    text += `${'='.repeat(50)}\n`
    text += `Manage your notification preferences to change digest settings.\n`

    return text
  }

  private renderMarkdown(
    groups: NotificationGroup[],
    periodStart: Date,
    periodEnd: Date,
    totalCount: number
  ): string {
    const dateRange =
      periodStart.toDateString() === periodEnd.toDateString()
        ? formatDate(periodStart)
        : `${formatDate(periodStart)} - ${formatDate(periodEnd)}`

    let md = `# Your Notification Digest\n\n`
    md += `**${dateRange}** - ${totalCount} notification${totalCount !== 1 ? 's' : ''}\n\n`
    md += `---\n\n`

    if (totalCount === 0) {
      md += `*No new notifications during this period. You're all caught up!*\n`
      return md
    }

    for (const group of groups) {
      md += `## ${group.label} (${group.count})\n\n`

      for (const n of group.notifications) {
        const priorityTag = n.priority === 'urgent' ? ' **[URGENT]**' : n.priority === 'high' ? ' *[High]*' : ''

        if (n.link) {
          md += `### [${n.title}](${n.link})${priorityTag}\n\n`
        } else {
          md += `### ${n.title}${priorityTag}\n\n`
        }

        md += `${n.message}\n\n`

        if (n.sender || n.timestamp) {
          md += `> `
          if (n.sender) md += `From **${n.sender}**`
          if (n.sender && n.timestamp) md += ` - `
          if (n.timestamp) md += `*${formatTime(n.timestamp)}*`
          md += `\n\n`
        }
      }
    }

    md += `---\n\n`
    md += `*Manage your [notification preferences](#preferences) to change digest settings.*\n`

    return md
  }

  private renderJson(
    userId: string,
    groups: NotificationGroup[],
    periodStart: Date,
    periodEnd: Date
  ): DigestData {
    return {
      userId,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      totalCount: groups.reduce((sum, g) => sum + g.count, 0),
      groups: groups.map((g) => ({
        key: g.key,
        label: g.label,
        count: g.count,
        notifications: g.notifications.map((n) => ({
          id: n.id,
          title: n.title,
          message: n.message,
          sender: n.sender,
          entity: n.entity,
          link: n.link,
          timestamp: (n.timestamp || new Date()).toISOString(),
          priority: n.priority,
        })),
      })),
    }
  }

  // ===========================================================================
  // Schedule Helpers
  // ===========================================================================

  private calculatePeriodStart(preferences: DigestPreferences, periodEnd: Date): Date {
    const start = new Date(periodEnd)

    switch (preferences.schedule) {
      case 'hourly':
        start.setHours(start.getHours() - 1)
        break
      case 'daily':
        start.setDate(start.getDate() - 1)
        break
      case 'weekly':
        start.setDate(start.getDate() - 7)
        break
      case 'monthly':
        start.setMonth(start.getMonth() - 1)
        break
      default:
        start.setDate(start.getDate() - 1)
    }

    return start
  }

  private isScheduleDue(preferences: DigestPreferences, lastSent: Date, now: Date): boolean {
    const hoursSinceLastSent = (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60)

    switch (preferences.schedule) {
      case 'hourly':
        return hoursSinceLastSent >= 1

      case 'daily':
        // Check if we've passed the delivery hour since last sent
        if (hoursSinceLastSent < 20) return false // Not enough time passed
        return now.getHours() >= preferences.deliveryHour

      case 'weekly':
        if (hoursSinceLastSent < 6 * 24) return false // Less than 6 days
        const weeklyDay = preferences.weeklyDay || 'monday'
        return (
          now.getDay() === DAY_TO_NUMBER[weeklyDay] &&
          now.getHours() >= preferences.deliveryHour
        )

      case 'monthly':
        if (hoursSinceLastSent < 27 * 24) return false // Less than 27 days
        const monthlyDay = preferences.monthlyDay || 1
        return now.getDate() === monthlyDay && now.getHours() >= preferences.deliveryHour

      default:
        return hoursSinceLastSent >= 24
    }
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * Get digest statistics
   */
  getStats(): DigestStats {
    const totalDigests = this.stats.digestsGenerated
    return {
      ...this.stats,
      avgNotificationsPerDigest:
        totalDigests > 0 ? this.stats.totalBatched / totalDigests : 0,
    }
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalBatched: 0,
      byUser: {},
      byCategory: {},
      digestsGenerated: 0,
      digestsDelivered: 0,
      avgNotificationsPerDigest: 0,
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new NotificationDigest instance
 *
 * @param config - Configuration options
 * @returns A new NotificationDigest instance
 *
 * @example
 * ```typescript
 * const digest = createDigestCollector({
 *   defaultSchedule: 'daily',
 *   defaultDeliveryHour: 9,
 *   defaultGroupBy: ['category', 'sender'],
 * })
 *
 * // Add notifications
 * await digest.add({
 *   userId: 'user-123',
 *   category: 'comments',
 *   title: 'New comment',
 *   message: 'Alice commented on your post',
 *   sender: 'Alice',
 * })
 *
 * // Generate digest
 * const output = await digest.generateDigest('user-123')
 * console.log(output.html)
 * ```
 */
export function createDigestCollector(config?: DigestCollectorConfig): NotificationDigest {
  return new NotificationDigest(config)
}

/**
 * Create default digest preferences for a user
 */
export function createDefaultPreferences(
  overrides?: Partial<DigestPreferences>
): DigestPreferences {
  return {
    ...DEFAULT_PREFERENCES,
    ...overrides,
  }
}

// =============================================================================
// Exports
// =============================================================================

export default NotificationDigest
