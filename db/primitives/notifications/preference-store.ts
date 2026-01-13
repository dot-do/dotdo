/**
 * PreferenceStore - User notification preference management
 *
 * Stub implementation for TDD RED phase.
 * This file exports types and stub implementations that will make
 * tests compile but fail on assertions.
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

export interface QuietHoursConfig {
  enabled: boolean
  start?: string // HH:mm format
  end?: string // HH:mm format
  timezone?: string
  days?: string[]
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
}

export interface PreferenceSourceContext extends ResolveContext {}

// =============================================================================
// PreferenceStore Class - Stub Implementation
// =============================================================================

export class PreferenceStore {
  private disposed = false

  constructor(_options?: PreferenceStoreOptions) {
    // Stub constructor
  }

  // =========================================================================
  // User Preferences - Global Opt-Out
  // =========================================================================

  async setGlobalOptOut(
    _userId: string,
    _optOut: boolean,
    _metadata?: { reason?: string; source?: string }
  ): Promise<void> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async getUserPreferences(_userId: string): Promise<UserPreference> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async canSendToUser(_userId: string, _context: SendContext): Promise<boolean> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  // =========================================================================
  // Category Opt-Out
  // =========================================================================

  async setCategoryOptOut(_userId: string, _category: NotificationCategory, _optOut: boolean): Promise<void> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async getOptedOutCategories(_userId: string): Promise<NotificationCategory[]> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  // =========================================================================
  // Channel Opt-Out
  // =========================================================================

  async setChannelOptOut(_userId: string, _channel: ChannelType, _optOut: boolean): Promise<void> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async getEnabledChannels(_userId: string): Promise<ChannelType[]> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  // =========================================================================
  // Channel Priority
  // =========================================================================

  async setChannelPriority(_userId: string, _priority: ChannelType[]): Promise<void> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async getChannelPriority(_userId: string): Promise<ChannelType[]> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async getEnabledChannelPriority(_userId: string): Promise<ChannelType[]> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async getPreferredChannel(_userId: string, _context?: ResolveContext & { category?: NotificationCategory }): Promise<ChannelType | null> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async moveChannelInPriority(_userId: string, _channel: ChannelType, _position: number): Promise<void> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async setCategoryChannels(_userId: string, _category: NotificationCategory, _channels: ChannelType[]): Promise<void> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async getEnabledCategoryChannels(_userId: string, _category: NotificationCategory): Promise<ChannelType[]> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  // =========================================================================
  // Category Subscriptions
  // =========================================================================

  async subscribeToCategory(_userId: string, _category: NotificationCategory): Promise<void> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async unsubscribeFromCategory(_userId: string, _category: NotificationCategory): Promise<void> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async isSubscribedToCategory(_userId: string, _category: NotificationCategory): Promise<boolean> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async getSubscribedCategories(_userId: string): Promise<NotificationCategory[]> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async getAvailableCategories(): Promise<NotificationCategory[]> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async setCategoryFrequency(_userId: string, _category: NotificationCategory, _frequency: FrequencyConfig): Promise<void> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async recordCategoryNotification(_userId: string, _category: NotificationCategory): Promise<void> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async isWithinCategoryFrequency(_userId: string, _category: NotificationCategory): Promise<boolean> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async setCategoryDigest(_userId: string, _category: NotificationCategory, _digest: DigestConfig): Promise<void> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async subscribeToSubCategory(_userId: string, _category: NotificationCategory, _subCategory: string): Promise<void> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async unsubscribeFromSubCategory(_userId: string, _category: NotificationCategory, _subCategory: string): Promise<void> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  // =========================================================================
  // Quiet Hours / DND
  // =========================================================================

  async setQuietHours(_userId: string, _config: QuietHoursConfig): Promise<void> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async isInQuietHours(_userId: string): Promise<boolean> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async setQuietHoursExceptions(_userId: string, _exceptions: { categories?: NotificationCategory[]; channels?: ChannelType[] }): Promise<void> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async enableDND(_userId: string, _config: { duration?: number; until?: Date }): Promise<void> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async disableDND(_userId: string): Promise<void> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async isDNDActive(_userId: string): Promise<boolean> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  // =========================================================================
  // Org/Team Preferences (Inheritance)
  // =========================================================================

  async setOrgPreferences(_orgId: string, _prefs: OrgPreference): Promise<void> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async getOrgPreferences(_orgId: string): Promise<OrgPreference> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async setTeamPreferences(_teamId: string, _orgId: string, _prefs: OrgPreference): Promise<void> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async getTeamPreferences(_teamId: string): Promise<TeamPreference> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async resolvePreferences(_userId: string, _context: ResolveContext): Promise<InheritedPreferences> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async getPreferenceSource(_userId: string, _preference: string, _context: PreferenceSourceContext): Promise<PreferenceScope> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async isChannelAllowed(_userId: string, _channel: ChannelType, _context?: ResolveContext): Promise<boolean> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async getUsersInOrg(_orgId: string): Promise<string[]> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  async getUsersInTeam(_teamId: string): Promise<string[]> {
    this.checkDisposed()
    throw new Error('Not implemented')
  }

  // =========================================================================
  // Events
  // =========================================================================

  on(_event: string, _handler: (data: unknown) => void): void {
    // Stub
  }

  off(_event: string, _handler: (data: unknown) => void): void {
    // Stub
  }

  // =========================================================================
  // Disposal
  // =========================================================================

  dispose(): void {
    this.disposed = true
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
