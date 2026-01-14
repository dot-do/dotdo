/**
 * PreferenceStore Tests - TDD RED Phase
 *
 * Comprehensive tests for user notification preference management.
 * Tests cover:
 * - User opt-out management (global opt-out, per-category)
 * - Channel priority ordering (email > sms > push)
 * - Notification category subscriptions
 * - Quiet hours / DND settings
 * - Preference inheritance (org -> team -> user)
 *
 * These tests should FAIL until PreferenceStore is implemented.
 *
 * Run: npx vitest run db/primitives/notifications/tests/preferences.test.ts --reporter=verbose
 *
 * @module db/primitives/notifications/tests/preferences
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// =============================================================================
// Types - These should be exported from the implementation
// =============================================================================

// Import types that should exist from the PreferenceStore implementation
// These imports will FAIL until implementation exists
import {
  // Factory
  createPreferenceStore,
  // Main class
  PreferenceStore,
  // Types
  type PreferenceStoreOptions,
  type UserPreference,
  type ChannelType,
  type NotificationCategory,
  type QuietHoursConfig,
  type ChannelPriorityConfig,
  type CategorySubscription,
  type PreferenceScope,
  type InheritedPreferences,
} from '../preference-store'

// =============================================================================
// Test Fixtures
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

interface TestContext {
  userId: string
  orgId: string
  teamId: string
}

const testUsers: TestContext[] = [
  { userId: 'user_1', orgId: 'org_acme', teamId: 'team_engineering' },
  { userId: 'user_2', orgId: 'org_acme', teamId: 'team_marketing' },
  { userId: 'user_3', orgId: 'org_widget', teamId: 'team_sales' },
]

// =============================================================================
// 1. User Opt-Out Management Tests
// =============================================================================

describe('User Opt-Out Management', () => {
  let store: PreferenceStore

  beforeEach(() => {
    store = createPreferenceStore()
  })

  describe('Global Opt-Out', () => {
    it('allows user to globally opt-out of all notifications', async () => {
      await store.setGlobalOptOut('user_1', true)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.globalOptOut).toBe(true)
    })

    it('blocks all non-mandatory notifications when globally opted out', async () => {
      await store.setGlobalOptOut('user_1', true)

      const canSendMarketing = await store.canSendToUser('user_1', {
        category: 'marketing',
        channel: 'email',
      })
      const canSendSocial = await store.canSendToUser('user_1', {
        category: 'social',
        channel: 'push',
      })

      expect(canSendMarketing).toBe(false)
      expect(canSendSocial).toBe(false)
    })

    it('still allows transactional notifications when globally opted out', async () => {
      await store.setGlobalOptOut('user_1', true)

      const canSendTransactional = await store.canSendToUser('user_1', {
        category: 'transactional',
        channel: 'email',
      })

      expect(canSendTransactional).toBe(true)
    })

    it('still allows security notifications when globally opted out', async () => {
      await store.setGlobalOptOut('user_1', true)

      const canSendSecurity = await store.canSendToUser('user_1', {
        category: 'security',
        channel: 'email',
      })

      expect(canSendSecurity).toBe(true)
    })

    it('allows user to re-subscribe after global opt-out', async () => {
      await store.setGlobalOptOut('user_1', true)
      await store.setGlobalOptOut('user_1', false)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.globalOptOut).toBe(false)
    })

    it('records opt-out timestamp', async () => {
      vi.useFakeTimers()
      const now = new Date('2024-06-15T10:00:00Z')
      vi.setSystemTime(now)

      await store.setGlobalOptOut('user_1', true)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.globalOptOutAt).toEqual(now)

      vi.useRealTimers()
    })

    it('records opt-out reason when provided', async () => {
      await store.setGlobalOptOut('user_1', true, {
        reason: 'Too many emails',
        source: 'unsubscribe_link',
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.globalOptOutReason).toBe('Too many emails')
      expect(prefs.globalOptOutSource).toBe('unsubscribe_link')
    })

    it('clears opt-out metadata when re-subscribing', async () => {
      await store.setGlobalOptOut('user_1', true, { reason: 'Too many emails' })
      await store.setGlobalOptOut('user_1', false)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.globalOptOutAt).toBeUndefined()
      expect(prefs.globalOptOutReason).toBeUndefined()
    })
  })

  describe('Per-Category Opt-Out', () => {
    it('allows user to opt-out of a specific category', async () => {
      await store.setCategoryOptOut('user_1', 'marketing', true)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.categories.marketing.enabled).toBe(false)
    })

    it('blocks notifications for opted-out category', async () => {
      await store.setCategoryOptOut('user_1', 'marketing', true)

      const canSend = await store.canSendToUser('user_1', {
        category: 'marketing',
        channel: 'email',
      })

      expect(canSend).toBe(false)
    })

    it('allows notifications for non-opted-out categories', async () => {
      await store.setCategoryOptOut('user_1', 'marketing', true)

      const canSendSocial = await store.canSendToUser('user_1', {
        category: 'social',
        channel: 'email',
      })

      expect(canSendSocial).toBe(true)
    })

    it('allows opting out of multiple categories', async () => {
      await store.setCategoryOptOut('user_1', 'marketing', true)
      await store.setCategoryOptOut('user_1', 'promotional', true)
      await store.setCategoryOptOut('user_1', 'digest', true)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.categories.marketing.enabled).toBe(false)
      expect(prefs.categories.promotional.enabled).toBe(false)
      expect(prefs.categories.digest.enabled).toBe(false)
    })

    it('prevents opt-out of transactional category', async () => {
      await store.setCategoryOptOut('user_1', 'transactional', true)

      const prefs = await store.getUserPreferences('user_1')
      // Transactional should always be enabled
      expect(prefs.categories.transactional.enabled).toBe(true)
    })

    it('prevents opt-out of security category', async () => {
      await store.setCategoryOptOut('user_1', 'security', true)

      const prefs = await store.getUserPreferences('user_1')
      // Security should always be enabled
      expect(prefs.categories.security.enabled).toBe(true)
    })

    it('allows re-subscribing to a category', async () => {
      await store.setCategoryOptOut('user_1', 'marketing', true)
      await store.setCategoryOptOut('user_1', 'marketing', false)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.categories.marketing.enabled).toBe(true)
    })

    it('throws error for invalid category', async () => {
      await expect(
        store.setCategoryOptOut('user_1', 'invalid_category' as NotificationCategory, true)
      ).rejects.toThrow(/invalid category/i)
    })

    it('returns list of opted-out categories', async () => {
      await store.setCategoryOptOut('user_1', 'marketing', true)
      await store.setCategoryOptOut('user_1', 'promotional', true)

      const optedOut = await store.getOptedOutCategories('user_1')

      expect(optedOut).toContain('marketing')
      expect(optedOut).toContain('promotional')
      expect(optedOut).not.toContain('social')
    })
  })

  describe('Per-Channel Opt-Out', () => {
    it('allows user to opt-out of a specific channel', async () => {
      await store.setChannelOptOut('user_1', 'sms', true)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.channels.sms.enabled).toBe(false)
    })

    it('blocks notifications on opted-out channel', async () => {
      await store.setChannelOptOut('user_1', 'sms', true)

      const canSend = await store.canSendToUser('user_1', {
        category: 'marketing',
        channel: 'sms',
      })

      expect(canSend).toBe(false)
    })

    it('allows notifications on other channels', async () => {
      await store.setChannelOptOut('user_1', 'sms', true)

      const canSendEmail = await store.canSendToUser('user_1', {
        category: 'marketing',
        channel: 'email',
      })

      expect(canSendEmail).toBe(true)
    })

    it('allows opting out of multiple channels', async () => {
      await store.setChannelOptOut('user_1', 'sms', true)
      await store.setChannelOptOut('user_1', 'push', true)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.channels.sms.enabled).toBe(false)
      expect(prefs.channels.push.enabled).toBe(false)
      expect(prefs.channels.email.enabled).not.toBe(false)
    })

    it('allows re-enabling a channel', async () => {
      await store.setChannelOptOut('user_1', 'sms', true)
      await store.setChannelOptOut('user_1', 'sms', false)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.channels.sms.enabled).toBe(true)
    })

    it('throws error for invalid channel', async () => {
      await expect(
        store.setChannelOptOut('user_1', 'carrier_pigeon' as ChannelType, true)
      ).rejects.toThrow(/invalid channel/i)
    })

    it('returns list of enabled channels', async () => {
      await store.setChannelOptOut('user_1', 'sms', true)
      await store.setChannelOptOut('user_1', 'webhook', true)

      const enabled = await store.getEnabledChannels('user_1')

      expect(enabled).toContain('email')
      expect(enabled).toContain('push')
      expect(enabled).not.toContain('sms')
      expect(enabled).not.toContain('webhook')
    })
  })

  describe('Combined Opt-Out Scenarios', () => {
    it('category opt-out takes precedence over channel being enabled', async () => {
      await store.setCategoryOptOut('user_1', 'marketing', true)
      // Email channel is enabled by default

      const canSend = await store.canSendToUser('user_1', {
        category: 'marketing',
        channel: 'email',
      })

      expect(canSend).toBe(false)
    })

    it('channel opt-out blocks even enabled categories', async () => {
      await store.setChannelOptOut('user_1', 'email', true)
      // Social category is enabled by default

      const canSend = await store.canSendToUser('user_1', {
        category: 'social',
        channel: 'email',
      })

      expect(canSend).toBe(false)
    })

    it('global opt-out overrides all other settings except mandatory', async () => {
      await store.setGlobalOptOut('user_1', true)
      // Even if we explicitly enable things, global opt-out wins

      const canSendMarketing = await store.canSendToUser('user_1', {
        category: 'marketing',
        channel: 'email',
      })
      const canSendSecurity = await store.canSendToUser('user_1', {
        category: 'security',
        channel: 'email',
      })

      expect(canSendMarketing).toBe(false)
      expect(canSendSecurity).toBe(true) // Mandatory overrides global
    })
  })
})

// =============================================================================
// 2. Channel Priority Ordering Tests
// =============================================================================

describe('Channel Priority Ordering', () => {
  let store: PreferenceStore

  beforeEach(() => {
    store = createPreferenceStore()
  })

  describe('Setting Channel Priority', () => {
    it('sets channel priority order', async () => {
      await store.setChannelPriority('user_1', ['email', 'sms', 'push'])

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.channelPriority).toEqual(['email', 'sms', 'push'])
    })

    it('updates existing priority order', async () => {
      await store.setChannelPriority('user_1', ['email', 'sms', 'push'])
      await store.setChannelPriority('user_1', ['push', 'email', 'sms'])

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.channelPriority).toEqual(['push', 'email', 'sms'])
    })

    it('validates all channels are valid', async () => {
      await expect(
        store.setChannelPriority('user_1', ['email', 'telepathy', 'sms'])
      ).rejects.toThrow(/invalid channel/i)
    })

    it('allows partial channel list (not all channels required)', async () => {
      await store.setChannelPriority('user_1', ['email', 'push'])

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.channelPriority).toEqual(['email', 'push'])
    })

    it('rejects duplicate channels in priority list', async () => {
      await expect(
        store.setChannelPriority('user_1', ['email', 'sms', 'email'])
      ).rejects.toThrow(/duplicate/i)
    })

    it('provides default priority for new users', async () => {
      const prefs = await store.getUserPreferences('new_user')

      expect(prefs.channelPriority).toBeDefined()
      expect(Array.isArray(prefs.channelPriority)).toBe(true)
      expect(prefs.channelPriority.length).toBeGreaterThan(0)
    })
  })

  describe('Getting Prioritized Channels', () => {
    it('returns channels in priority order', async () => {
      await store.setChannelPriority('user_1', ['push', 'email', 'sms'])

      const priority = await store.getChannelPriority('user_1')

      expect(priority[0]).toBe('push')
      expect(priority[1]).toBe('email')
      expect(priority[2]).toBe('sms')
    })

    it('filters out disabled channels from priority', async () => {
      await store.setChannelPriority('user_1', ['push', 'email', 'sms'])
      await store.setChannelOptOut('user_1', 'email', true)

      const enabledPriority = await store.getEnabledChannelPriority('user_1')

      expect(enabledPriority).toEqual(['push', 'sms'])
      expect(enabledPriority).not.toContain('email')
    })

    it('returns empty array if all channels disabled', async () => {
      await store.setChannelPriority('user_1', ['email', 'sms'])
      await store.setChannelOptOut('user_1', 'email', true)
      await store.setChannelOptOut('user_1', 'sms', true)

      const enabledPriority = await store.getEnabledChannelPriority('user_1')

      expect(enabledPriority).toEqual([])
    })
  })

  describe('Getting Preferred Channel', () => {
    it('returns highest priority enabled channel', async () => {
      await store.setChannelPriority('user_1', ['push', 'email', 'sms'])

      const preferred = await store.getPreferredChannel('user_1')

      expect(preferred).toBe('push')
    })

    it('skips disabled channels', async () => {
      await store.setChannelPriority('user_1', ['push', 'email', 'sms'])
      await store.setChannelOptOut('user_1', 'push', true)

      const preferred = await store.getPreferredChannel('user_1')

      expect(preferred).toBe('email')
    })

    it('returns null when all channels disabled', async () => {
      await store.setChannelPriority('user_1', ['push', 'email'])
      await store.setChannelOptOut('user_1', 'push', true)
      await store.setChannelOptOut('user_1', 'email', true)

      const preferred = await store.getPreferredChannel('user_1')

      expect(preferred).toBeNull()
    })

    it('considers category-specific channel preferences', async () => {
      await store.setChannelPriority('user_1', ['push', 'email', 'sms'])
      await store.setCategoryChannels('user_1', 'marketing', ['email', 'sms'])

      const preferred = await store.getPreferredChannel('user_1', {
        category: 'marketing',
      })

      // Push is highest priority but not enabled for marketing, so email
      expect(preferred).toBe('email')
    })
  })

  describe('Reordering Channels', () => {
    it('moves channel to new position', async () => {
      await store.setChannelPriority('user_1', ['email', 'sms', 'push'])
      await store.moveChannelInPriority('user_1', 'push', 0)

      const priority = await store.getChannelPriority('user_1')

      expect(priority).toEqual(['push', 'email', 'sms'])
    })

    it('moves channel down in priority', async () => {
      await store.setChannelPriority('user_1', ['email', 'sms', 'push'])
      await store.moveChannelInPriority('user_1', 'email', 2)

      const priority = await store.getChannelPriority('user_1')

      expect(priority).toEqual(['sms', 'push', 'email'])
    })

    it('throws error for invalid position', async () => {
      await store.setChannelPriority('user_1', ['email', 'sms', 'push'])

      await expect(
        store.moveChannelInPriority('user_1', 'email', 10)
      ).rejects.toThrow(/invalid position/i)
    })

    it('throws error for channel not in priority list', async () => {
      await store.setChannelPriority('user_1', ['email', 'sms'])

      await expect(
        store.moveChannelInPriority('user_1', 'push', 0)
      ).rejects.toThrow(/channel not found/i)
    })
  })

  describe('Category-Specific Channel Priority', () => {
    it('sets channels for a specific category', async () => {
      await store.setCategoryChannels('user_1', 'marketing', ['email'])

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.categories.marketing.channels).toEqual(['email'])
    })

    it('allows different channels for different categories', async () => {
      await store.setCategoryChannels('user_1', 'marketing', ['email'])
      await store.setCategoryChannels('user_1', 'social', ['push', 'in-app'])
      await store.setCategoryChannels('user_1', 'transactional', ['email', 'sms', 'push'])

      const prefs = await store.getUserPreferences('user_1')

      expect(prefs.categories.marketing.channels).toEqual(['email'])
      expect(prefs.categories.social.channels).toContain('push')
      expect(prefs.categories.social.channels).toContain('in-app')
      expect(prefs.categories.transactional.channels).toHaveLength(3)
    })

    it('category channels respect global channel opt-out', async () => {
      await store.setCategoryChannels('user_1', 'marketing', ['email', 'sms'])
      await store.setChannelOptOut('user_1', 'email', true)

      const enabledChannels = await store.getEnabledCategoryChannels('user_1', 'marketing')

      expect(enabledChannels).toEqual(['sms'])
    })

    it('returns all enabled channels if no category-specific setting', async () => {
      await store.setChannelPriority('user_1', ['email', 'sms', 'push'])

      const channelsForSocial = await store.getEnabledCategoryChannels('user_1', 'social')

      // Should return all enabled channels from priority
      expect(channelsForSocial).toContain('email')
      expect(channelsForSocial).toContain('sms')
      expect(channelsForSocial).toContain('push')
    })
  })
})

// =============================================================================
// 3. Notification Category Subscriptions Tests
// =============================================================================

describe('Notification Category Subscriptions', () => {
  let store: PreferenceStore

  beforeEach(() => {
    store = createPreferenceStore()
  })

  describe('Subscription Management', () => {
    it('subscribes user to a category', async () => {
      await store.subscribeToCategory('user_1', 'marketing')

      const isSubscribed = await store.isSubscribedToCategory('user_1', 'marketing')
      expect(isSubscribed).toBe(true)
    })

    it('unsubscribes user from a category', async () => {
      await store.subscribeToCategory('user_1', 'marketing')
      await store.unsubscribeFromCategory('user_1', 'marketing')

      const isSubscribed = await store.isSubscribedToCategory('user_1', 'marketing')
      expect(isSubscribed).toBe(false)
    })

    it('user is subscribed to all categories by default', async () => {
      const prefs = await store.getUserPreferences('new_user')

      expect(prefs.categories.marketing.subscribed).toBe(true)
      expect(prefs.categories.social.subscribed).toBe(true)
      expect(prefs.categories.digest.subscribed).toBe(true)
    })

    it('cannot unsubscribe from mandatory categories', async () => {
      await store.unsubscribeFromCategory('user_1', 'transactional')
      await store.unsubscribeFromCategory('user_1', 'security')

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.categories.transactional.subscribed).toBe(true)
      expect(prefs.categories.security.subscribed).toBe(true)
    })

    it('returns list of subscribed categories', async () => {
      await store.unsubscribeFromCategory('user_1', 'marketing')
      await store.unsubscribeFromCategory('user_1', 'promotional')

      const subscribed = await store.getSubscribedCategories('user_1')

      expect(subscribed).not.toContain('marketing')
      expect(subscribed).not.toContain('promotional')
      expect(subscribed).toContain('transactional')
      expect(subscribed).toContain('social')
    })

    it('returns list of available categories', async () => {
      const categories = await store.getAvailableCategories()

      expect(categories).toContain('transactional')
      expect(categories).toContain('marketing')
      expect(categories).toContain('social')
      expect(categories).toContain('security')
      expect(categories).toContain('promotional')
    })
  })

  describe('Category Frequency Settings', () => {
    it('sets frequency limit for a category', async () => {
      await store.setCategoryFrequency('user_1', 'marketing', {
        maxPerDay: 5,
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.categories.marketing.frequency.maxPerDay).toBe(5)
    })

    it('sets hourly and daily limits', async () => {
      await store.setCategoryFrequency('user_1', 'social', {
        maxPerHour: 3,
        maxPerDay: 20,
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.categories.social.frequency.maxPerHour).toBe(3)
      expect(prefs.categories.social.frequency.maxPerDay).toBe(20)
    })

    it('checks if within frequency cap', async () => {
      await store.setCategoryFrequency('user_1', 'marketing', {
        maxPerDay: 2,
      })

      await store.recordCategoryNotification('user_1', 'marketing')
      await store.recordCategoryNotification('user_1', 'marketing')

      const withinCap = await store.isWithinCategoryFrequency('user_1', 'marketing')
      expect(withinCap).toBe(false)
    })

    it('resets frequency counter after time window', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-06-15T10:00:00Z'))

      await store.setCategoryFrequency('user_1', 'marketing', {
        maxPerHour: 2,
      })

      await store.recordCategoryNotification('user_1', 'marketing')
      await store.recordCategoryNotification('user_1', 'marketing')

      // At cap
      expect(await store.isWithinCategoryFrequency('user_1', 'marketing')).toBe(false)

      // Advance 1 hour
      vi.advanceTimersByTime(60 * 60 * 1000)

      expect(await store.isWithinCategoryFrequency('user_1', 'marketing')).toBe(true)

      vi.useRealTimers()
    })
  })

  describe('Category Digest Preferences', () => {
    it('enables digest mode for a category', async () => {
      await store.setCategoryDigest('user_1', 'social', {
        enabled: true,
        interval: 'daily',
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.categories.social.digest.enabled).toBe(true)
      expect(prefs.categories.social.digest.interval).toBe('daily')
    })

    it('supports different digest intervals', async () => {
      await store.setCategoryDigest('user_1', 'marketing', {
        enabled: true,
        interval: 'weekly',
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.categories.marketing.digest.interval).toBe('weekly')
    })

    it('validates digest interval', async () => {
      await expect(
        store.setCategoryDigest('user_1', 'social', {
          enabled: true,
          interval: 'yearly' as any, // Invalid
        })
      ).rejects.toThrow(/invalid interval/i)
    })

    it('allows custom digest time', async () => {
      await store.setCategoryDigest('user_1', 'social', {
        enabled: true,
        interval: 'daily',
        deliveryTime: '09:00',
        timezone: 'America/New_York',
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.categories.social.digest.deliveryTime).toBe('09:00')
      expect(prefs.categories.social.digest.timezone).toBe('America/New_York')
    })
  })

  describe('Sub-Category Subscriptions', () => {
    it('subscribes to specific sub-categories', async () => {
      await store.subscribeToSubCategory('user_1', 'social', 'likes')
      await store.subscribeToSubCategory('user_1', 'social', 'comments')

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.categories.social.subCategories.likes.subscribed).toBe(true)
      expect(prefs.categories.social.subCategories.comments.subscribed).toBe(true)
    })

    it('unsubscribes from specific sub-categories', async () => {
      await store.subscribeToSubCategory('user_1', 'social', 'likes')
      await store.unsubscribeFromSubCategory('user_1', 'social', 'likes')

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.categories.social.subCategories.likes.subscribed).toBe(false)
    })

    it('parent category opt-out disables all sub-categories', async () => {
      await store.subscribeToSubCategory('user_1', 'social', 'likes')
      await store.setCategoryOptOut('user_1', 'social', true)

      const canSend = await store.canSendToUser('user_1', {
        category: 'social',
        subCategory: 'likes',
        channel: 'push',
      })

      expect(canSend).toBe(false)
    })
  })
})

// =============================================================================
// 4. Quiet Hours / DND Settings Tests
// =============================================================================

describe('Quiet Hours / DND Settings', () => {
  let store: PreferenceStore

  beforeEach(() => {
    store = createPreferenceStore()
  })

  describe('Basic Quiet Hours Configuration', () => {
    it('sets quiet hours with start and end time', async () => {
      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'America/New_York',
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.quietHours.enabled).toBe(true)
      expect(prefs.quietHours.start).toBe('22:00')
      expect(prefs.quietHours.end).toBe('08:00')
      expect(prefs.quietHours.timezone).toBe('America/New_York')
    })

    it('disables quiet hours', async () => {
      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'UTC',
      })

      await store.setQuietHours('user_1', { enabled: false })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.quietHours.enabled).toBe(false)
    })

    it('validates time format (HH:mm)', async () => {
      await expect(
        store.setQuietHours('user_1', {
          enabled: true,
          start: '25:00', // Invalid hour
          end: '08:00',
          timezone: 'UTC',
        })
      ).rejects.toThrow(/invalid time/i)

      await expect(
        store.setQuietHours('user_1', {
          enabled: true,
          start: '22:60', // Invalid minute
          end: '08:00',
          timezone: 'UTC',
        })
      ).rejects.toThrow(/invalid time/i)
    })

    it('validates timezone', async () => {
      await expect(
        store.setQuietHours('user_1', {
          enabled: true,
          start: '22:00',
          end: '08:00',
          timezone: 'Mars/Olympus_Mons',
        })
      ).rejects.toThrow(/invalid timezone/i)
    })
  })

  describe('Quiet Hours Detection', () => {
    it('returns true when current time is in quiet hours', async () => {
      vi.useFakeTimers()
      // 11 PM in New York
      vi.setSystemTime(new Date('2024-06-15T23:00:00-04:00'))

      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'America/New_York',
      })

      const inQuietHours = await store.isInQuietHours('user_1')
      expect(inQuietHours).toBe(true)

      vi.useRealTimers()
    })

    it('returns false when outside quiet hours', async () => {
      vi.useFakeTimers()
      // 2 PM in New York
      vi.setSystemTime(new Date('2024-06-15T14:00:00-04:00'))

      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'America/New_York',
      })

      const inQuietHours = await store.isInQuietHours('user_1')
      expect(inQuietHours).toBe(false)

      vi.useRealTimers()
    })

    it('handles overnight quiet hours (start > end)', async () => {
      vi.useFakeTimers()
      // 2 AM
      vi.setSystemTime(new Date('2024-06-15T02:00:00Z'))

      await store.setQuietHours('user_1', {
        enabled: true,
        start: '23:00',
        end: '07:00',
        timezone: 'UTC',
      })

      const inQuietHours = await store.isInQuietHours('user_1')
      expect(inQuietHours).toBe(true)

      vi.useRealTimers()
    })

    it('returns false when quiet hours disabled', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-06-15T23:00:00Z'))

      await store.setQuietHours('user_1', {
        enabled: false,
        start: '22:00',
        end: '08:00',
        timezone: 'UTC',
      })

      const inQuietHours = await store.isInQuietHours('user_1')
      expect(inQuietHours).toBe(false)

      vi.useRealTimers()
    })

    it('correctly calculates across timezone boundaries', async () => {
      vi.useFakeTimers()
      // 3 AM UTC = 11 PM previous day in New York (EST -5)
      vi.setSystemTime(new Date('2024-06-15T03:00:00Z'))

      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'America/New_York', // -4 in summer (EDT)
      })

      // At 3 AM UTC, it's 11 PM EDT in New York - within quiet hours
      const inQuietHours = await store.isInQuietHours('user_1')
      expect(inQuietHours).toBe(true)

      vi.useRealTimers()
    })
  })

  describe('Day-Specific Quiet Hours', () => {
    it('sets quiet hours for specific days only', async () => {
      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'UTC',
        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.quietHours.days).toContain('monday')
      expect(prefs.quietHours.days).not.toContain('saturday')
    })

    it('respects day restrictions', async () => {
      vi.useFakeTimers()
      // Saturday at 11 PM UTC
      vi.setSystemTime(new Date('2024-06-15T23:00:00Z')) // June 15, 2024 was a Saturday

      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'UTC',
        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], // Weekdays only
      })

      const inQuietHours = await store.isInQuietHours('user_1')
      expect(inQuietHours).toBe(false) // Saturday is not in the list

      vi.useRealTimers()
    })

    it('validates day names', async () => {
      await expect(
        store.setQuietHours('user_1', {
          enabled: true,
          start: '22:00',
          end: '08:00',
          timezone: 'UTC',
          days: ['monday', 'funday'] as any,
        })
      ).rejects.toThrow(/invalid day/i)
    })
  })

  describe('Quiet Hours Exceptions', () => {
    it('sets categories that bypass quiet hours', async () => {
      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'UTC',
      })

      await store.setQuietHoursExceptions('user_1', {
        categories: ['transactional', 'security'],
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.quietHours.exceptions.categories).toContain('transactional')
      expect(prefs.quietHours.exceptions.categories).toContain('security')
    })

    it('sets channels that bypass quiet hours', async () => {
      await store.setQuietHoursExceptions('user_1', {
        channels: ['sms'], // SMS for urgent only
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.quietHours.exceptions.channels).toContain('sms')
    })

    it('urgent notifications bypass quiet hours', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-06-15T23:00:00Z'))

      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'UTC',
      })

      const canSendRegular = await store.canSendToUser('user_1', {
        category: 'marketing',
        channel: 'email',
        priority: 'normal',
      })

      const canSendUrgent = await store.canSendToUser('user_1', {
        category: 'marketing',
        channel: 'email',
        priority: 'critical',
      })

      expect(canSendRegular).toBe(false)
      expect(canSendUrgent).toBe(true)

      vi.useRealTimers()
    })

    it('transactional always bypasses quiet hours', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-06-15T23:00:00Z'))

      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'UTC',
      })

      const canSend = await store.canSendToUser('user_1', {
        category: 'transactional',
        channel: 'email',
      })

      expect(canSend).toBe(true)

      vi.useRealTimers()
    })

    it('security always bypasses quiet hours', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-06-15T23:00:00Z'))

      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'UTC',
      })

      const canSend = await store.canSendToUser('user_1', {
        category: 'security',
        channel: 'email',
      })

      expect(canSend).toBe(true)

      vi.useRealTimers()
    })
  })

  describe('Do Not Disturb (DND) Mode', () => {
    it('enables temporary DND mode', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-06-15T10:00:00Z'))

      await store.enableDND('user_1', {
        duration: 60 * 60 * 1000, // 1 hour
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.dnd.enabled).toBe(true)

      vi.useRealTimers()
    })

    it('DND expires after duration', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-06-15T10:00:00Z'))

      await store.enableDND('user_1', {
        duration: 60 * 60 * 1000, // 1 hour
      })

      // Initially enabled
      expect(await store.isDNDActive('user_1')).toBe(true)

      // After 1 hour
      vi.advanceTimersByTime(60 * 60 * 1000 + 1000)

      expect(await store.isDNDActive('user_1')).toBe(false)

      vi.useRealTimers()
    })

    it('DND with end time', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-06-15T10:00:00Z'))

      await store.enableDND('user_1', {
        until: new Date('2024-06-15T14:00:00Z'),
      })

      expect(await store.isDNDActive('user_1')).toBe(true)

      vi.setSystemTime(new Date('2024-06-15T14:01:00Z'))

      expect(await store.isDNDActive('user_1')).toBe(false)

      vi.useRealTimers()
    })

    it('manually disables DND', async () => {
      await store.enableDND('user_1', {
        duration: 60 * 60 * 1000,
      })

      await store.disableDND('user_1')

      expect(await store.isDNDActive('user_1')).toBe(false)
    })

    it('DND blocks notifications', async () => {
      await store.enableDND('user_1', {
        duration: 60 * 60 * 1000,
      })

      const canSend = await store.canSendToUser('user_1', {
        category: 'marketing',
        channel: 'email',
      })

      expect(canSend).toBe(false)
    })

    it('DND has same exceptions as quiet hours', async () => {
      await store.enableDND('user_1', {
        duration: 60 * 60 * 1000,
      })

      const canSendSecurity = await store.canSendToUser('user_1', {
        category: 'security',
        channel: 'email',
      })

      expect(canSendSecurity).toBe(true)
    })
  })
})

// =============================================================================
// 5. Preference Inheritance Tests (Org -> Team -> User)
// =============================================================================

describe('Preference Inheritance (Org -> Team -> User)', () => {
  let store: PreferenceStore

  beforeEach(() => {
    store = createPreferenceStore()
  })

  describe('Organization Level Preferences', () => {
    it('sets organization-level default preferences', async () => {
      await store.setOrgPreferences('org_acme', {
        defaultQuietHours: {
          enabled: true,
          start: '22:00',
          end: '07:00',
          timezone: 'America/New_York',
        },
        defaultChannelPriority: ['email', 'in-app', 'push'],
      })

      const orgPrefs = await store.getOrgPreferences('org_acme')
      expect(orgPrefs.defaultQuietHours.enabled).toBe(true)
      expect(orgPrefs.defaultChannelPriority).toEqual(['email', 'in-app', 'push'])
    })

    it('sets organization channel restrictions', async () => {
      await store.setOrgPreferences('org_acme', {
        allowedChannels: ['email', 'in-app'], // Only email and in-app allowed
      })

      const orgPrefs = await store.getOrgPreferences('org_acme')
      expect(orgPrefs.allowedChannels).toEqual(['email', 'in-app'])
    })

    it('sets organization disabled channels', async () => {
      await store.setOrgPreferences('org_acme', {
        disabledChannels: ['sms', 'webhook'],
      })

      const orgPrefs = await store.getOrgPreferences('org_acme')
      expect(orgPrefs.disabledChannels).toContain('sms')
      expect(orgPrefs.disabledChannels).toContain('webhook')
    })

    it('org disabled channels affect all users', async () => {
      await store.setOrgPreferences('org_acme', {
        disabledChannels: ['sms'],
      })

      const canUseSms = await store.isChannelAllowed('user_1', 'sms', {
        orgId: 'org_acme',
      })

      expect(canUseSms).toBe(false)
    })
  })

  describe('Team Level Preferences', () => {
    it('sets team-level default preferences', async () => {
      await store.setTeamPreferences('team_engineering', 'org_acme', {
        defaultQuietHours: {
          enabled: true,
          start: '23:00',
          end: '09:00',
          timezone: 'America/Los_Angeles',
        },
      })

      const teamPrefs = await store.getTeamPreferences('team_engineering')
      expect(teamPrefs.defaultQuietHours.start).toBe('23:00')
    })

    it('team preferences inherit from org', async () => {
      await store.setOrgPreferences('org_acme', {
        disabledChannels: ['sms'],
      })

      await store.setTeamPreferences('team_engineering', 'org_acme', {
        disabledChannels: ['webhook'],
      })

      const teamPrefs = await store.getTeamPreferences('team_engineering')

      // Should include both org and team disabled channels
      expect(teamPrefs.effectiveDisabledChannels).toContain('sms')
      expect(teamPrefs.effectiveDisabledChannels).toContain('webhook')
    })

    it('team cannot enable channel disabled by org', async () => {
      await store.setOrgPreferences('org_acme', {
        disabledChannels: ['sms'],
      })

      await store.setTeamPreferences('team_engineering', 'org_acme', {
        allowedChannels: ['email', 'sms', 'push'], // Team tries to enable SMS
      })

      const canUseSms = await store.isChannelAllowed('user_1', 'sms', {
        orgId: 'org_acme',
        teamId: 'team_engineering',
      })

      expect(canUseSms).toBe(false) // Org restriction takes precedence
    })
  })

  describe('User Level Preferences', () => {
    it('user preferences inherit from team and org', async () => {
      // Org sets default quiet hours
      await store.setOrgPreferences('org_acme', {
        defaultQuietHours: {
          enabled: true,
          start: '22:00',
          end: '07:00',
          timezone: 'UTC',
        },
      })

      // Team overrides quiet hours timing
      await store.setTeamPreferences('team_engineering', 'org_acme', {
        defaultQuietHours: {
          enabled: true,
          start: '23:00',
          end: '08:00',
          timezone: 'America/Los_Angeles',
        },
      })

      // User has not set quiet hours

      const resolved = await store.resolvePreferences('user_1', {
        orgId: 'org_acme',
        teamId: 'team_engineering',
      })

      // Should use team's quiet hours (team overrides org)
      expect(resolved.quietHours.start).toBe('23:00')
      expect(resolved.quietHours.timezone).toBe('America/Los_Angeles')
    })

    it('user preferences override team and org', async () => {
      await store.setOrgPreferences('org_acme', {
        defaultChannelPriority: ['email', 'in-app'],
      })

      await store.setTeamPreferences('team_engineering', 'org_acme', {
        defaultChannelPriority: ['in-app', 'email'],
      })

      await store.setChannelPriority('user_1', ['push', 'email', 'sms'])

      const resolved = await store.resolvePreferences('user_1', {
        orgId: 'org_acme',
        teamId: 'team_engineering',
      })

      // User's priority wins
      expect(resolved.channelPriority).toEqual(['push', 'email', 'sms'])
    })

    it('user cannot enable channel disabled at org level', async () => {
      await store.setOrgPreferences('org_acme', {
        disabledChannels: ['webhook'],
      })

      // User tries to use webhook (default is enabled if not opted out)
      const canUseWebhook = await store.isChannelAllowed('user_1', 'webhook', {
        orgId: 'org_acme',
      })

      expect(canUseWebhook).toBe(false)
    })
  })

  describe('Preference Resolution', () => {
    it('resolves complete preference hierarchy', async () => {
      // Org defaults
      await store.setOrgPreferences('org_acme', {
        defaultQuietHours: {
          enabled: true,
          start: '21:00',
          end: '07:00',
          timezone: 'America/New_York',
        },
        defaultChannelPriority: ['email', 'in-app'],
        disabledChannels: ['webhook'],
      })

      // Team overrides quiet hours
      await store.setTeamPreferences('team_engineering', 'org_acme', {
        defaultQuietHours: {
          enabled: true,
          start: '23:00',
          end: '09:00',
          timezone: 'America/Los_Angeles',
        },
      })

      // User customizes channel priority only
      await store.setChannelPriority('user_1', ['push', 'sms', 'email'])

      const resolved = await store.resolvePreferences('user_1', {
        orgId: 'org_acme',
        teamId: 'team_engineering',
      })

      // Quiet hours from team (overrides org)
      expect(resolved.quietHours.start).toBe('23:00')
      expect(resolved.quietHours.timezone).toBe('America/Los_Angeles')

      // Channel priority from user (overrides team and org)
      expect(resolved.channelPriority).toEqual(['push', 'sms', 'email'])

      // Disabled channels from org (inherited)
      expect(resolved.disabledChannels).toContain('webhook')
    })

    it('indicates source of each preference', async () => {
      await store.setOrgPreferences('org_acme', {
        defaultQuietHours: {
          enabled: true,
          start: '22:00',
          end: '07:00',
          timezone: 'UTC',
        },
      })

      const source = await store.getPreferenceSource('user_1', 'quietHours', {
        orgId: 'org_acme',
        teamId: 'team_engineering',
      })

      expect(source).toBe('org')
    })

    it('returns "user" when user has explicit preference', async () => {
      await store.setQuietHours('user_1', {
        enabled: false,
        start: '22:00',
        end: '07:00',
        timezone: 'UTC',
      })

      const source = await store.getPreferenceSource('user_1', 'quietHours', {
        orgId: 'org_acme',
      })

      expect(source).toBe('user')
    })

    it('returns "team" when inherited from team', async () => {
      await store.setOrgPreferences('org_acme', {
        defaultChannelPriority: ['email', 'sms'],
      })

      await store.setTeamPreferences('team_engineering', 'org_acme', {
        defaultChannelPriority: ['push', 'email'],
      })

      const source = await store.getPreferenceSource('user_1', 'channelPriority', {
        orgId: 'org_acme',
        teamId: 'team_engineering',
      })

      expect(source).toBe('team')
    })

    it('returns "default" when no preference set at any level', async () => {
      const source = await store.getPreferenceSource('new_user', 'quietHours', {})

      expect(source).toBe('default')
    })
  })

  describe('Inheritance with Channel/Category Restrictions', () => {
    it('org can restrict notification categories', async () => {
      await store.setOrgPreferences('org_acme', {
        disabledCategories: ['promotional'], // Org disables promotional
      })

      const canSend = await store.canSendToUser('user_1', {
        category: 'promotional',
        channel: 'email',
        orgId: 'org_acme',
      })

      expect(canSend).toBe(false)
    })

    it('team can restrict categories beyond org restrictions', async () => {
      await store.setOrgPreferences('org_acme', {
        disabledCategories: ['promotional'],
      })

      await store.setTeamPreferences('team_engineering', 'org_acme', {
        disabledCategories: ['marketing'], // Team also disables marketing
      })

      const canSendPromotional = await store.canSendToUser('user_1', {
        category: 'promotional',
        channel: 'email',
        orgId: 'org_acme',
        teamId: 'team_engineering',
      })

      const canSendMarketing = await store.canSendToUser('user_1', {
        category: 'marketing',
        channel: 'email',
        orgId: 'org_acme',
        teamId: 'team_engineering',
      })

      expect(canSendPromotional).toBe(false) // Org restriction
      expect(canSendMarketing).toBe(false) // Team restriction
    })

    it('user opt-outs are respected alongside org/team restrictions', async () => {
      await store.setOrgPreferences('org_acme', {
        disabledCategories: ['promotional'],
      })

      await store.setCategoryOptOut('user_1', 'marketing', true)

      const canSendPromotional = await store.canSendToUser('user_1', {
        category: 'promotional',
        channel: 'email',
        orgId: 'org_acme',
      })

      const canSendMarketing = await store.canSendToUser('user_1', {
        category: 'marketing',
        channel: 'email',
        orgId: 'org_acme',
      })

      expect(canSendPromotional).toBe(false) // Org restriction
      expect(canSendMarketing).toBe(false) // User opt-out
    })

    it('mandatory categories bypass org restrictions', async () => {
      await store.setOrgPreferences('org_acme', {
        disabledCategories: ['transactional', 'security'], // Org tries to disable mandatory
      })

      const canSendTransactional = await store.canSendToUser('user_1', {
        category: 'transactional',
        channel: 'email',
        orgId: 'org_acme',
      })

      const canSendSecurity = await store.canSendToUser('user_1', {
        category: 'security',
        channel: 'email',
        orgId: 'org_acme',
      })

      expect(canSendTransactional).toBe(true) // Cannot disable mandatory
      expect(canSendSecurity).toBe(true) // Cannot disable mandatory
    })
  })

  describe('Bulk Operations with Hierarchy', () => {
    it('returns all users affected by org preference change', async () => {
      // Set up users in org
      await store.resolvePreferences('user_1', { orgId: 'org_acme', teamId: 'team_engineering' })
      await store.resolvePreferences('user_2', { orgId: 'org_acme', teamId: 'team_marketing' })
      await store.resolvePreferences('user_3', { orgId: 'org_widget', teamId: 'team_sales' })

      const affectedUsers = await store.getUsersInOrg('org_acme')

      expect(affectedUsers).toContain('user_1')
      expect(affectedUsers).toContain('user_2')
      expect(affectedUsers).not.toContain('user_3') // Different org
    })

    it('returns all users affected by team preference change', async () => {
      await store.resolvePreferences('user_1', { orgId: 'org_acme', teamId: 'team_engineering' })
      await store.resolvePreferences('user_2', { orgId: 'org_acme', teamId: 'team_marketing' })

      const affectedUsers = await store.getUsersInTeam('team_engineering')

      expect(affectedUsers).toContain('user_1')
      expect(affectedUsers).not.toContain('user_2') // Different team
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('PreferenceStore Integration', () => {
  describe('Complete notification decision flow', () => {
    it('makes correct send decision with all factors considered', async () => {
      const store = createPreferenceStore()

      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-06-15T14:00:00-04:00')) // 2 PM EDT

      // Set up org preferences
      await store.setOrgPreferences('org_acme', {
        disabledChannels: ['webhook'],
        defaultQuietHours: {
          enabled: true,
          start: '22:00',
          end: '07:00',
          timezone: 'America/New_York',
        },
      })

      // Set up team preferences
      await store.setTeamPreferences('team_engineering', 'org_acme', {
        defaultChannelPriority: ['push', 'email', 'sms'],
      })

      // Set up user preferences
      await store.setChannelOptOut('user_1', 'sms', true)
      await store.setCategoryOptOut('user_1', 'promotional', true)

      // Test various scenarios
      const canSendMarketingEmail = await store.canSendToUser('user_1', {
        category: 'marketing',
        channel: 'email',
        orgId: 'org_acme',
        teamId: 'team_engineering',
      })

      const canSendMarketingSms = await store.canSendToUser('user_1', {
        category: 'marketing',
        channel: 'sms',
        orgId: 'org_acme',
        teamId: 'team_engineering',
      })

      const canSendPromotionalEmail = await store.canSendToUser('user_1', {
        category: 'promotional',
        channel: 'email',
        orgId: 'org_acme',
        teamId: 'team_engineering',
      })

      const canSendWebhook = await store.canSendToUser('user_1', {
        category: 'system',
        channel: 'webhook',
        orgId: 'org_acme',
        teamId: 'team_engineering',
      })

      expect(canSendMarketingEmail).toBe(true) // Not in quiet hours, category enabled, channel enabled
      expect(canSendMarketingSms).toBe(false) // User opted out of SMS
      expect(canSendPromotionalEmail).toBe(false) // User opted out of promotional
      expect(canSendWebhook).toBe(false) // Org disabled webhook

      vi.useRealTimers()
    })

    it('correctly determines preferred channel with all factors', async () => {
      const store = createPreferenceStore()

      await store.setOrgPreferences('org_acme', {
        disabledChannels: ['webhook'],
        defaultChannelPriority: ['email', 'push', 'sms'],
      })

      await store.setTeamPreferences('team_engineering', 'org_acme', {
        defaultChannelPriority: ['push', 'email', 'sms'],
      })

      // User opts out of push
      await store.setChannelOptOut('user_1', 'push', true)

      const preferred = await store.getPreferredChannel('user_1', {
        orgId: 'org_acme',
        teamId: 'team_engineering',
        category: 'marketing',
      })

      // Team priority is push, email, sms
      // User disabled push
      // So preferred should be email
      expect(preferred).toBe('email')
    })
  })
})

// =============================================================================
// Cleanup and Disposal Tests
// =============================================================================

describe('PreferenceStore Cleanup', () => {
  it('disposes store and clears all data', async () => {
    const store = createPreferenceStore()

    await store.setGlobalOptOut('user_1', true)
    await store.setChannelPriority('user_1', ['push', 'email'])

    store.dispose()

    await expect(store.getUserPreferences('user_1')).rejects.toThrow(/disposed/i)
  })

  it('emits disposed event', async () => {
    const store = createPreferenceStore()
    const handler = vi.fn()

    store.on('disposed', handler)
    store.dispose()

    expect(handler).toHaveBeenCalled()
  })
})

// =============================================================================
// Module Export Tests
// =============================================================================

describe('Module Exports', () => {
  it('exports createPreferenceStore factory', () => {
    expect(createPreferenceStore).toBeDefined()
    expect(typeof createPreferenceStore).toBe('function')
  })

  it('exports PreferenceStore class', () => {
    expect(PreferenceStore).toBeDefined()
    expect(typeof PreferenceStore).toBe('function')
  })
})
