/**
 * PreferenceStore - User notification preference management
 *
 * Full implementation for TDD GREEN phase.
 * Handles opt-out/unsubscribe, channel priority ordering, category subscriptions,
 * quiet hours/DND settings, and preference inheritance hierarchy (org -> team -> user).
 *
 * @module db/primitives/notifications/preference-store
 */

// =============================================================================
// Types
// =============================================================================

export type ChannelType = 'email' | 'sms' | 'push' | 'in-app' | 'slack' | 'webhook'

export type NotificationCategory =
  | 'transactional'
  | 'marketing'
  | 'social'
  | 'security'
  | 'system'
  | 'promotional'
  | 'digest'

export type DigestInterval = 'hourly' | 'daily' | 'weekly'

export type PreferenceScope = 'user' | 'team' | 'org' | 'default'

export type DayOfWeek = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'

export interface QuietHoursConfig {
  enabled: boolean
  start?: string // HH:mm format
  end?: string // HH:mm format
  timezone?: string
  days?: DayOfWeek[]
  exceptions?: {
    categories?: NotificationCategory[]
    channels?: ChannelType[]
  }
}

export interface ChannelPriorityConfig {
  priority: ChannelType[]
}

export interface FrequencyConfig {
  maxPerHour?: number
  maxPerDay?: number
}

export interface DigestConfig {
  enabled: boolean
  interval?: DigestInterval
  deliveryTime?: string
  timezone?: string
}

export interface SubCategoryConfig {
  subscribed: boolean
}

export interface CategoryConfig {
  enabled: boolean
  subscribed: boolean
  channels?: ChannelType[]
  frequency?: FrequencyConfig
  digest?: DigestConfig
  subCategories?: Record<string, SubCategoryConfig>
}

export interface ChannelConfig {
  enabled: boolean
  frequencyCap?: FrequencyConfig
}

export interface DNDConfig {
  enabled: boolean
  expiresAt?: Date
}

export interface UserPreference {
  globalOptOut: boolean
  globalOptOutAt?: Date
  globalOptOutReason?: string
  globalOptOutSource?: string
  channels: Record<ChannelType, ChannelConfig>
  categories: Record<NotificationCategory, CategoryConfig>
  channelPriority: ChannelType[]
  quietHours: QuietHoursConfig
  dnd: DNDConfig
}

export interface OrgPreference {
  defaultQuietHours?: QuietHoursConfig
  defaultChannelPriority?: ChannelType[]
  allowedChannels?: ChannelType[]
  disabledChannels?: ChannelType[]
  disabledCategories?: NotificationCategory[]
}

export interface TeamPreference extends OrgPreference {
  effectiveDisabledChannels?: ChannelType[]
  orgId?: string
}

export interface CategorySubscription {
  category: NotificationCategory
  subscribed: boolean
  channels?: ChannelType[]
}

export interface InheritedPreferences extends UserPreference {
  disabledChannels: ChannelType[]
}

export interface PreferenceStoreOptions {
  defaultQuietHours?: QuietHoursConfig
  defaultFrequencyCap?: FrequencyConfig
  storage?: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<void>
  }
}

export interface SendContext {
  category: NotificationCategory
  subCategory?: string
  channel: ChannelType
  priority?: 'low' | 'normal' | 'high' | 'critical'
  orgId?: string
  teamId?: string
}

export interface ResolveContext {
  orgId?: string
  teamId?: string
  category?: NotificationCategory
}

export interface PreferenceSourceContext extends ResolveContext {}

// =============================================================================
// Constants
// =============================================================================

const VALID_CHANNELS: ChannelType[] = ['email', 'sms', 'push', 'in-app', 'slack', 'webhook']

const VALID_CATEGORIES: NotificationCategory[] = [
  'transactional',
  'marketing',
  'social',
  'security',
  'system',
  'promotional',
  'digest',
]

const MANDATORY_CATEGORIES: NotificationCategory[] = ['transactional', 'security']

const VALID_DAYS: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

const VALID_DIGEST_INTERVALS: DigestInterval[] = ['hourly', 'daily', 'weekly']

const DEFAULT_CHANNEL_PRIORITY: ChannelType[] = ['email', 'push', 'sms', 'in-app', 'slack', 'webhook']

// =============================================================================
// Helper Types
// =============================================================================

interface FrequencyTracker {
  hourly: { count: number; resetAt: number }
  daily: { count: number; resetAt: number }
}

interface UserMembership {
  orgId?: string
  teamId?: string
}

type EventHandler = (data: unknown) => void

// =============================================================================
// PreferenceStore Class - Full Implementation
// =============================================================================

export class PreferenceStore {
  private disposed = false
  private options: PreferenceStoreOptions

  // In-memory storage
  private userPreferences: Map<string, UserPreference> = new Map()
  private orgPreferences: Map<string, OrgPreference> = new Map()
  private teamPreferences: Map<string, TeamPreference> = new Map()
  private frequencyTrackers: Map<string, Map<NotificationCategory, FrequencyTracker>> = new Map()
  private userMemberships: Map<string, UserMembership> = new Map()

  // Event handling
  private eventHandlers: Map<string, Set<EventHandler>> = new Map()

  constructor(options?: PreferenceStoreOptions) {
    this.options = options ?? {}
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private getDefaultUserPreference(): UserPreference {
    const channels: Record<ChannelType, ChannelConfig> = {} as Record<ChannelType, ChannelConfig>
    for (const channel of VALID_CHANNELS) {
      channels[channel] = { enabled: true }
    }

    const categories: Record<NotificationCategory, CategoryConfig> = {} as Record<NotificationCategory, CategoryConfig>
    for (const category of VALID_CATEGORIES) {
      categories[category] = {
        enabled: true,
        subscribed: true,
        frequency: {},
        digest: { enabled: false },
        subCategories: {},
      }
    }

    return {
      globalOptOut: false,
      channels,
      categories,
      channelPriority: [...DEFAULT_CHANNEL_PRIORITY],
      quietHours: { enabled: false, exceptions: { categories: [], channels: [] } },
      dnd: { enabled: false },
    }
  }

  private ensureUserPreferences(userId: string): UserPreference {
    if (!this.userPreferences.has(userId)) {
      this.userPreferences.set(userId, this.getDefaultUserPreference())
    }
    return this.userPreferences.get(userId)!
  }

  private ensureOrgPreferences(orgId: string): OrgPreference {
    if (!this.orgPreferences.has(orgId)) {
      this.orgPreferences.set(orgId, {})
    }
    return this.orgPreferences.get(orgId)!
  }

  private ensureTeamPreferences(teamId: string): TeamPreference {
    if (!this.teamPreferences.has(teamId)) {
      this.teamPreferences.set(teamId, {})
    }
    return this.teamPreferences.get(teamId)!
  }

  private validateChannel(channel: string): asserts channel is ChannelType {
    if (!VALID_CHANNELS.includes(channel as ChannelType)) {
      throw new Error(`Invalid channel: ${channel}`)
    }
  }

  private validateCategory(category: string): asserts category is NotificationCategory {
    if (!VALID_CATEGORIES.includes(category as NotificationCategory)) {
      throw new Error(`Invalid category: ${category}`)
    }
  }

  private validateTimeFormat(time: string): void {
    const match = time.match(/^(\d{2}):(\d{2})$/)
    if (!match) {
      throw new Error(`Invalid time format: ${time}. Expected HH:mm`)
    }
    const hours = parseInt(match[1], 10)
    const minutes = parseInt(match[2], 10)
    if (hours < 0 || hours > 23) {
      throw new Error(`Invalid time: ${time}. Hours must be 00-23`)
    }
    if (minutes < 0 || minutes > 59) {
      throw new Error(`Invalid time: ${time}. Minutes must be 00-59`)
    }
  }

  private validateTimezone(timezone: string): void {
    try {
      Intl.DateTimeFormat('en-US', { timeZone: timezone })
    } catch {
      throw new Error(`Invalid timezone: ${timezone}`)
    }
  }

  private validateDay(day: string): asserts day is DayOfWeek {
    if (!VALID_DAYS.includes(day as DayOfWeek)) {
      throw new Error(`Invalid day: ${day}`)
    }
  }

  private validateDigestInterval(interval: string): asserts interval is DigestInterval {
    if (!VALID_DIGEST_INTERVALS.includes(interval as DigestInterval)) {
      throw new Error(`Invalid interval: ${interval}`)
    }
  }

  private isMandatoryCategory(category: NotificationCategory): boolean {
    return MANDATORY_CATEGORIES.includes(category)
  }

  private getTimeInTimezone(timezone: string): { hours: number; minutes: number; dayOfWeek: DayOfWeek } {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      weekday: 'long',
    })

    const parts = formatter.formatToParts(now)
    const hourPart = parts.find(p => p.type === 'hour')
    const minutePart = parts.find(p => p.type === 'minute')
    const dayPart = parts.find(p => p.type === 'weekday')

    const hours = parseInt(hourPart?.value ?? '0', 10)
    const minutes = parseInt(minutePart?.value ?? '0', 10)
    const dayOfWeek = (dayPart?.value?.toLowerCase() ?? 'sunday') as DayOfWeek

    return { hours, minutes, dayOfWeek }
  }

  private parseTime(time: string): { hours: number; minutes: number } {
    const [hours, minutes] = time.split(':').map(Number)
    return { hours, minutes }
  }

  private isTimeInRange(
    current: { hours: number; minutes: number },
    start: { hours: number; minutes: number },
    end: { hours: number; minutes: number }
  ): boolean {
    const currentMinutes = current.hours * 60 + current.minutes
    const startMinutes = start.hours * 60 + start.minutes
    const endMinutes = end.hours * 60 + end.minutes

    // Handle overnight ranges (e.g., 22:00 - 08:00)
    if (startMinutes > endMinutes) {
      // Time is in range if it's after start OR before end
      return currentMinutes >= startMinutes || currentMinutes < endMinutes
    }

    // Normal range (e.g., 09:00 - 17:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes
  }

  private emit(event: string, data?: unknown): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      for (const handler of handlers) {
        handler(data)
      }
    }
  }

  // =========================================================================
  // User Preferences - Global Opt-Out
  // =========================================================================

  async setGlobalOptOut(
    userId: string,
    optOut: boolean,
    metadata?: { reason?: string; source?: string }
  ): Promise<void> {
    this.checkDisposed()
    const prefs = this.ensureUserPreferences(userId)
    prefs.globalOptOut = optOut

    if (optOut) {
      prefs.globalOptOutAt = new Date()
      prefs.globalOptOutReason = metadata?.reason
      prefs.globalOptOutSource = metadata?.source
    } else {
      prefs.globalOptOutAt = undefined
      prefs.globalOptOutReason = undefined
      prefs.globalOptOutSource = undefined
    }
  }

  async getUserPreferences(userId: string): Promise<UserPreference> {
    this.checkDisposed()
    return this.ensureUserPreferences(userId)
  }

  async canSendToUser(userId: string, context: SendContext): Promise<boolean> {
    this.checkDisposed()
    const prefs = this.ensureUserPreferences(userId)

    // Check if category is mandatory - bypass most restrictions
    const isMandatory = this.isMandatoryCategory(context.category)

    // Check global opt-out (mandatory categories bypass this)
    if (prefs.globalOptOut && !isMandatory) {
      return false
    }

    // Check DND (mandatory categories bypass this)
    if (await this.isDNDActive(userId) && !isMandatory) {
      return false
    }

    // Check quiet hours (mandatory and critical priority bypass this)
    const inQuietHours = await this.isInQuietHours(userId)
    if (inQuietHours && !isMandatory && context.priority !== 'critical') {
      return false
    }

    // Check org-level restrictions
    if (context.orgId) {
      const orgPrefs = this.orgPreferences.get(context.orgId)
      if (orgPrefs) {
        // Check org disabled channels
        if (orgPrefs.disabledChannels?.includes(context.channel)) {
          return false
        }
        // Check org disabled categories (mandatory bypass this)
        if (!isMandatory && orgPrefs.disabledCategories?.includes(context.category)) {
          return false
        }
      }
    }

    // Check team-level restrictions
    if (context.teamId) {
      const teamPrefs = this.teamPreferences.get(context.teamId)
      if (teamPrefs) {
        // Check team disabled channels
        if (teamPrefs.disabledChannels?.includes(context.channel)) {
          return false
        }
        // Check team disabled categories (mandatory bypass this)
        if (!isMandatory && teamPrefs.disabledCategories?.includes(context.category)) {
          return false
        }
      }
    }

    // Check user category opt-out
    const categoryConfig = prefs.categories[context.category]
    if (!categoryConfig?.enabled && !isMandatory) {
      return false
    }

    // Check sub-category subscription
    if (context.subCategory && categoryConfig?.subCategories) {
      const subCatConfig = categoryConfig.subCategories[context.subCategory]
      if (subCatConfig && !subCatConfig.subscribed && !isMandatory) {
        return false
      }
    }

    // Check channel opt-out
    const channelConfig = prefs.channels[context.channel]
    if (!channelConfig?.enabled) {
      return false
    }

    return true
  }

  // =========================================================================
  // Category Opt-Out
  // =========================================================================

  async setCategoryOptOut(userId: string, category: NotificationCategory, optOut: boolean): Promise<void> {
    this.checkDisposed()
    this.validateCategory(category)

    const prefs = this.ensureUserPreferences(userId)

    // Cannot opt-out of mandatory categories
    if (this.isMandatoryCategory(category)) {
      // Silently ignore - mandatory categories stay enabled
      return
    }

    prefs.categories[category].enabled = !optOut
  }

  async getOptedOutCategories(userId: string): Promise<NotificationCategory[]> {
    this.checkDisposed()
    const prefs = this.ensureUserPreferences(userId)

    return VALID_CATEGORIES.filter(cat => !prefs.categories[cat].enabled)
  }

  // =========================================================================
  // Channel Opt-Out
  // =========================================================================

  async setChannelOptOut(userId: string, channel: ChannelType, optOut: boolean): Promise<void> {
    this.checkDisposed()
    this.validateChannel(channel)

    const prefs = this.ensureUserPreferences(userId)
    prefs.channels[channel].enabled = !optOut
  }

  async getEnabledChannels(userId: string): Promise<ChannelType[]> {
    this.checkDisposed()
    const prefs = this.ensureUserPreferences(userId)

    return VALID_CHANNELS.filter(ch => prefs.channels[ch].enabled)
  }

  // =========================================================================
  // Channel Priority
  // =========================================================================

  async setChannelPriority(userId: string, priority: ChannelType[]): Promise<void> {
    this.checkDisposed()

    // Validate all channels
    for (const channel of priority) {
      this.validateChannel(channel)
    }

    // Check for duplicates
    const uniqueChannels = new Set(priority)
    if (uniqueChannels.size !== priority.length) {
      throw new Error('Duplicate channels in priority list')
    }

    const prefs = this.ensureUserPreferences(userId)
    prefs.channelPriority = [...priority]
  }

  async getChannelPriority(userId: string): Promise<ChannelType[]> {
    this.checkDisposed()
    const prefs = this.ensureUserPreferences(userId)
    return [...prefs.channelPriority]
  }

  async getEnabledChannelPriority(userId: string): Promise<ChannelType[]> {
    this.checkDisposed()
    const prefs = this.ensureUserPreferences(userId)
    return prefs.channelPriority.filter(ch => prefs.channels[ch].enabled)
  }

  async getPreferredChannel(userId: string, context?: ResolveContext & { category?: NotificationCategory }): Promise<ChannelType | null> {
    this.checkDisposed()
    const prefs = this.ensureUserPreferences(userId)

    // Get priority order - use resolved if context provided
    let priority: ChannelType[]
    if (context?.orgId || context?.teamId) {
      const resolved = await this.resolvePreferences(userId, context)
      priority = resolved.channelPriority
    } else {
      priority = prefs.channelPriority
    }

    // If category specified, filter by category-specific channels
    let allowedChannels: ChannelType[] | undefined
    if (context?.category) {
      const categoryConfig = prefs.categories[context.category]
      if (categoryConfig?.channels && categoryConfig.channels.length > 0) {
        allowedChannels = categoryConfig.channels
      }
    }

    // Find first enabled channel in priority order
    for (const channel of priority) {
      // Check if channel is enabled for user
      if (!prefs.channels[channel]?.enabled) continue

      // Check if channel is allowed for category
      if (allowedChannels && !allowedChannels.includes(channel)) continue

      // Check org/team restrictions
      if (context?.orgId || context?.teamId) {
        const allowed = await this.isChannelAllowed(userId, channel, context)
        if (!allowed) continue
      }

      return channel
    }

    return null
  }

  async moveChannelInPriority(userId: string, channel: ChannelType, position: number): Promise<void> {
    this.checkDisposed()
    const prefs = this.ensureUserPreferences(userId)

    const currentIndex = prefs.channelPriority.indexOf(channel)
    if (currentIndex === -1) {
      throw new Error(`Channel not found in priority list: ${channel}`)
    }

    if (position < 0 || position >= prefs.channelPriority.length) {
      throw new Error(`Invalid position: ${position}`)
    }

    // Remove from current position
    prefs.channelPriority.splice(currentIndex, 1)
    // Insert at new position
    prefs.channelPriority.splice(position, 0, channel)
  }

  async setCategoryChannels(userId: string, category: NotificationCategory, channels: ChannelType[]): Promise<void> {
    this.checkDisposed()
    this.validateCategory(category)

    for (const channel of channels) {
      this.validateChannel(channel)
    }

    const prefs = this.ensureUserPreferences(userId)
    prefs.categories[category].channels = [...channels]
  }

  async getEnabledCategoryChannels(userId: string, category: NotificationCategory): Promise<ChannelType[]> {
    this.checkDisposed()
    this.validateCategory(category)

    const prefs = this.ensureUserPreferences(userId)
    const categoryConfig = prefs.categories[category]

    // If category has specific channels, filter by those
    if (categoryConfig.channels && categoryConfig.channels.length > 0) {
      return categoryConfig.channels.filter(ch => prefs.channels[ch].enabled)
    }

    // Otherwise return all enabled channels from priority
    return prefs.channelPriority.filter(ch => prefs.channels[ch].enabled)
  }

  // =========================================================================
  // Category Subscriptions
  // =========================================================================

  async subscribeToCategory(userId: string, category: NotificationCategory): Promise<void> {
    this.checkDisposed()
    this.validateCategory(category)

    const prefs = this.ensureUserPreferences(userId)
    prefs.categories[category].subscribed = true
  }

  async unsubscribeFromCategory(userId: string, category: NotificationCategory): Promise<void> {
    this.checkDisposed()
    this.validateCategory(category)

    // Cannot unsubscribe from mandatory categories
    if (this.isMandatoryCategory(category)) {
      return
    }

    const prefs = this.ensureUserPreferences(userId)
    prefs.categories[category].subscribed = false
  }

  async isSubscribedToCategory(userId: string, category: NotificationCategory): Promise<boolean> {
    this.checkDisposed()
    this.validateCategory(category)

    const prefs = this.ensureUserPreferences(userId)
    return prefs.categories[category].subscribed
  }

  async getSubscribedCategories(userId: string): Promise<NotificationCategory[]> {
    this.checkDisposed()
    const prefs = this.ensureUserPreferences(userId)

    return VALID_CATEGORIES.filter(cat => prefs.categories[cat].subscribed)
  }

  async getAvailableCategories(): Promise<NotificationCategory[]> {
    this.checkDisposed()
    return [...VALID_CATEGORIES]
  }

  async setCategoryFrequency(userId: string, category: NotificationCategory, frequency: FrequencyConfig): Promise<void> {
    this.checkDisposed()
    this.validateCategory(category)

    const prefs = this.ensureUserPreferences(userId)
    prefs.categories[category].frequency = { ...frequency }
  }

  async recordCategoryNotification(userId: string, category: NotificationCategory): Promise<void> {
    this.checkDisposed()
    this.validateCategory(category)

    if (!this.frequencyTrackers.has(userId)) {
      this.frequencyTrackers.set(userId, new Map())
    }

    const userTrackers = this.frequencyTrackers.get(userId)!
    if (!userTrackers.has(category)) {
      userTrackers.set(category, {
        hourly: { count: 0, resetAt: Date.now() + 60 * 60 * 1000 },
        daily: { count: 0, resetAt: Date.now() + 24 * 60 * 60 * 1000 },
      })
    }

    const tracker = userTrackers.get(category)!
    const now = Date.now()

    // Reset hourly if needed
    if (now >= tracker.hourly.resetAt) {
      tracker.hourly.count = 0
      tracker.hourly.resetAt = now + 60 * 60 * 1000
    }

    // Reset daily if needed
    if (now >= tracker.daily.resetAt) {
      tracker.daily.count = 0
      tracker.daily.resetAt = now + 24 * 60 * 60 * 1000
    }

    tracker.hourly.count++
    tracker.daily.count++
  }

  async isWithinCategoryFrequency(userId: string, category: NotificationCategory): Promise<boolean> {
    this.checkDisposed()
    this.validateCategory(category)

    const prefs = this.ensureUserPreferences(userId)
    const frequencyConfig = prefs.categories[category].frequency

    // If no frequency limits set, always within cap
    if (!frequencyConfig?.maxPerHour && !frequencyConfig?.maxPerDay) {
      return true
    }

    const userTrackers = this.frequencyTrackers.get(userId)
    if (!userTrackers) {
      return true
    }

    const tracker = userTrackers.get(category)
    if (!tracker) {
      return true
    }

    const now = Date.now()

    // Reset counters if windows have passed
    if (now >= tracker.hourly.resetAt) {
      tracker.hourly.count = 0
      tracker.hourly.resetAt = now + 60 * 60 * 1000
    }

    if (now >= tracker.daily.resetAt) {
      tracker.daily.count = 0
      tracker.daily.resetAt = now + 24 * 60 * 60 * 1000
    }

    // Check hourly limit
    if (frequencyConfig.maxPerHour && tracker.hourly.count >= frequencyConfig.maxPerHour) {
      return false
    }

    // Check daily limit
    if (frequencyConfig.maxPerDay && tracker.daily.count >= frequencyConfig.maxPerDay) {
      return false
    }

    return true
  }

  async setCategoryDigest(userId: string, category: NotificationCategory, digest: DigestConfig): Promise<void> {
    this.checkDisposed()
    this.validateCategory(category)

    if (digest.interval) {
      this.validateDigestInterval(digest.interval)
    }

    const prefs = this.ensureUserPreferences(userId)
    prefs.categories[category].digest = { ...digest }
  }

  async subscribeToSubCategory(userId: string, category: NotificationCategory, subCategory: string): Promise<void> {
    this.checkDisposed()
    this.validateCategory(category)

    const prefs = this.ensureUserPreferences(userId)
    if (!prefs.categories[category].subCategories) {
      prefs.categories[category].subCategories = {}
    }
    prefs.categories[category].subCategories![subCategory] = { subscribed: true }
  }

  async unsubscribeFromSubCategory(userId: string, category: NotificationCategory, subCategory: string): Promise<void> {
    this.checkDisposed()
    this.validateCategory(category)

    const prefs = this.ensureUserPreferences(userId)
    if (!prefs.categories[category].subCategories) {
      prefs.categories[category].subCategories = {}
    }
    prefs.categories[category].subCategories![subCategory] = { subscribed: false }
  }

  // =========================================================================
  // Quiet Hours / DND
  // =========================================================================

  async setQuietHours(userId: string, config: QuietHoursConfig): Promise<void> {
    this.checkDisposed()

    if (config.enabled && config.start) {
      this.validateTimeFormat(config.start)
    }

    if (config.enabled && config.end) {
      this.validateTimeFormat(config.end)
    }

    if (config.timezone) {
      this.validateTimezone(config.timezone)
    }

    if (config.days) {
      for (const day of config.days) {
        this.validateDay(day)
      }
    }

    const prefs = this.ensureUserPreferences(userId)

    // Merge with existing config
    prefs.quietHours = {
      ...prefs.quietHours,
      ...config,
      exceptions: {
        ...prefs.quietHours.exceptions,
        ...config.exceptions,
      },
    }
  }

  async isInQuietHours(userId: string): Promise<boolean> {
    this.checkDisposed()
    const prefs = this.ensureUserPreferences(userId)
    const qh = prefs.quietHours

    // Not enabled means not in quiet hours
    if (!qh.enabled) {
      return false
    }

    // Need start, end, and timezone to determine
    if (!qh.start || !qh.end || !qh.timezone) {
      return false
    }

    const currentTime = this.getTimeInTimezone(qh.timezone)
    const start = this.parseTime(qh.start)
    const end = this.parseTime(qh.end)

    // Check day restrictions if specified
    if (qh.days && qh.days.length > 0) {
      if (!qh.days.includes(currentTime.dayOfWeek)) {
        return false
      }
    }

    return this.isTimeInRange(currentTime, start, end)
  }

  async setQuietHoursExceptions(userId: string, exceptions: { categories?: NotificationCategory[]; channels?: ChannelType[] }): Promise<void> {
    this.checkDisposed()
    const prefs = this.ensureUserPreferences(userId)

    if (!prefs.quietHours.exceptions) {
      prefs.quietHours.exceptions = { categories: [], channels: [] }
    }

    if (exceptions.categories) {
      prefs.quietHours.exceptions.categories = [...exceptions.categories]
    }

    if (exceptions.channels) {
      prefs.quietHours.exceptions.channels = [...exceptions.channels]
    }
  }

  async enableDND(userId: string, config: { duration?: number; until?: Date }): Promise<void> {
    this.checkDisposed()
    const prefs = this.ensureUserPreferences(userId)

    prefs.dnd.enabled = true

    if (config.until) {
      prefs.dnd.expiresAt = config.until
    } else if (config.duration) {
      prefs.dnd.expiresAt = new Date(Date.now() + config.duration)
    }
  }

  async disableDND(userId: string): Promise<void> {
    this.checkDisposed()
    const prefs = this.ensureUserPreferences(userId)
    prefs.dnd.enabled = false
    prefs.dnd.expiresAt = undefined
  }

  async isDNDActive(userId: string): Promise<boolean> {
    this.checkDisposed()
    const prefs = this.ensureUserPreferences(userId)

    if (!prefs.dnd.enabled) {
      return false
    }

    // Check if DND has expired
    if (prefs.dnd.expiresAt) {
      if (new Date() > prefs.dnd.expiresAt) {
        // DND has expired, disable it
        prefs.dnd.enabled = false
        prefs.dnd.expiresAt = undefined
        return false
      }
    }

    return true
  }

  // =========================================================================
  // Org/Team Preferences (Inheritance)
  // =========================================================================

  async setOrgPreferences(orgId: string, prefs: OrgPreference): Promise<void> {
    this.checkDisposed()

    const existing = this.ensureOrgPreferences(orgId)
    Object.assign(existing, prefs)
  }

  async getOrgPreferences(orgId: string): Promise<OrgPreference> {
    this.checkDisposed()
    return this.ensureOrgPreferences(orgId)
  }

  async setTeamPreferences(teamId: string, orgId: string, prefs: OrgPreference): Promise<void> {
    this.checkDisposed()

    const existing = this.ensureTeamPreferences(teamId)
    Object.assign(existing, prefs)
    existing.orgId = orgId

    // Compute effective disabled channels (org + team)
    const orgPrefs = this.orgPreferences.get(orgId)
    const orgDisabled = orgPrefs?.disabledChannels ?? []
    const teamDisabled = prefs.disabledChannels ?? []

    existing.effectiveDisabledChannels = [...new Set([...orgDisabled, ...teamDisabled])]
  }

  async getTeamPreferences(teamId: string): Promise<TeamPreference> {
    this.checkDisposed()

    const teamPrefs = this.ensureTeamPreferences(teamId)

    // Compute effective disabled channels if orgId is set
    if (teamPrefs.orgId) {
      const orgPrefs = this.orgPreferences.get(teamPrefs.orgId)
      const orgDisabled = orgPrefs?.disabledChannels ?? []
      const teamDisabled = teamPrefs.disabledChannels ?? []

      teamPrefs.effectiveDisabledChannels = [...new Set([...orgDisabled, ...teamDisabled])]
    }

    return teamPrefs
  }

  async resolvePreferences(userId: string, context: ResolveContext): Promise<InheritedPreferences> {
    this.checkDisposed()

    // Track user membership
    if (context.orgId || context.teamId) {
      this.userMemberships.set(userId, {
        orgId: context.orgId,
        teamId: context.teamId,
      })
    }

    const userPrefs = this.ensureUserPreferences(userId)
    const orgPrefs = context.orgId ? this.orgPreferences.get(context.orgId) : undefined
    const teamPrefs = context.teamId ? this.teamPreferences.get(context.teamId) : undefined

    // Start with user preferences
    const resolved: InheritedPreferences = {
      ...userPrefs,
      disabledChannels: [],
    }

    // Collect disabled channels from org and team
    if (orgPrefs?.disabledChannels) {
      resolved.disabledChannels.push(...orgPrefs.disabledChannels)
    }
    if (teamPrefs?.disabledChannels) {
      resolved.disabledChannels.push(...teamPrefs.disabledChannels)
    }
    resolved.disabledChannels = [...new Set(resolved.disabledChannels)]

    // Resolve quiet hours: user > team > org > default
    const userHasQuietHours = userPrefs.quietHours.start !== undefined
    const teamHasQuietHours = teamPrefs?.defaultQuietHours?.start !== undefined
    const orgHasQuietHours = orgPrefs?.defaultQuietHours?.start !== undefined

    if (!userHasQuietHours) {
      if (teamHasQuietHours && teamPrefs?.defaultQuietHours) {
        resolved.quietHours = { ...teamPrefs.defaultQuietHours }
      } else if (orgHasQuietHours && orgPrefs?.defaultQuietHours) {
        resolved.quietHours = { ...orgPrefs.defaultQuietHours }
      }
    }

    // Resolve channel priority: user > team > org > default
    // Check if user has explicitly set channel priority (different from default)
    const userDefaultPriority = JSON.stringify(DEFAULT_CHANNEL_PRIORITY)
    const userCurrentPriority = JSON.stringify(userPrefs.channelPriority)
    const userHasCustomPriority = userCurrentPriority !== userDefaultPriority

    if (!userHasCustomPriority) {
      if (teamPrefs?.defaultChannelPriority) {
        resolved.channelPriority = [...teamPrefs.defaultChannelPriority]
      } else if (orgPrefs?.defaultChannelPriority) {
        resolved.channelPriority = [...orgPrefs.defaultChannelPriority]
      }
    }

    return resolved
  }

  async getPreferenceSource(userId: string, preference: string, context: PreferenceSourceContext): Promise<PreferenceScope> {
    this.checkDisposed()

    const userPrefs = this.userPreferences.get(userId)
    const orgPrefs = context.orgId ? this.orgPreferences.get(context.orgId) : undefined
    const teamPrefs = context.teamId ? this.teamPreferences.get(context.teamId) : undefined

    if (preference === 'quietHours') {
      // Check if user has explicitly set quiet hours
      if (userPrefs?.quietHours?.start !== undefined) {
        return 'user'
      }
      // Check team
      if (teamPrefs?.defaultQuietHours?.start !== undefined) {
        return 'team'
      }
      // Check org
      if (orgPrefs?.defaultQuietHours?.start !== undefined) {
        return 'org'
      }
      return 'default'
    }

    if (preference === 'channelPriority') {
      // Check if user has custom priority
      if (userPrefs) {
        const defaultStr = JSON.stringify(DEFAULT_CHANNEL_PRIORITY)
        const userStr = JSON.stringify(userPrefs.channelPriority)
        if (userStr !== defaultStr) {
          return 'user'
        }
      }
      // Check team
      if (teamPrefs?.defaultChannelPriority) {
        return 'team'
      }
      // Check org
      if (orgPrefs?.defaultChannelPriority) {
        return 'org'
      }
      return 'default'
    }

    return 'default'
  }

  async isChannelAllowed(userId: string, channel: ChannelType, context?: ResolveContext): Promise<boolean> {
    this.checkDisposed()
    this.validateChannel(channel)

    // Check org restrictions
    if (context?.orgId) {
      const orgPrefs = this.orgPreferences.get(context.orgId)
      if (orgPrefs?.disabledChannels?.includes(channel)) {
        return false
      }
      if (orgPrefs?.allowedChannels && !orgPrefs.allowedChannels.includes(channel)) {
        return false
      }
    }

    // Check team restrictions
    if (context?.teamId) {
      const teamPrefs = this.teamPreferences.get(context.teamId)
      if (teamPrefs?.disabledChannels?.includes(channel)) {
        return false
      }
      if (teamPrefs?.allowedChannels && !teamPrefs.allowedChannels.includes(channel)) {
        return false
      }
    }

    // Check user preferences
    const userPrefs = this.userPreferences.get(userId)
    if (userPrefs && !userPrefs.channels[channel]?.enabled) {
      return false
    }

    return true
  }

  async getUsersInOrg(orgId: string): Promise<string[]> {
    this.checkDisposed()

    const users: string[] = []
    for (const [userId, membership] of this.userMemberships.entries()) {
      if (membership.orgId === orgId) {
        users.push(userId)
      }
    }
    return users
  }

  async getUsersInTeam(teamId: string): Promise<string[]> {
    this.checkDisposed()

    const users: string[] = []
    for (const [userId, membership] of this.userMemberships.entries()) {
      if (membership.teamId === teamId) {
        users.push(userId)
      }
    }
    return users
  }

  // =========================================================================
  // Events
  // =========================================================================

  on(event: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)
  }

  off(event: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      handlers.delete(handler)
    }
  }

  // =========================================================================
  // Disposal
  // =========================================================================

  dispose(): void {
    this.disposed = true
    this.emit('disposed')

    // Clear all data
    this.userPreferences.clear()
    this.orgPreferences.clear()
    this.teamPreferences.clear()
    this.frequencyTrackers.clear()
    this.userMemberships.clear()
    this.eventHandlers.clear()
  }

  private checkDisposed(): void {
    if (this.disposed) {
      throw new Error('PreferenceStore has been disposed')
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createPreferenceStore(options?: PreferenceStoreOptions): PreferenceStore {
  return new PreferenceStore(options)
}
