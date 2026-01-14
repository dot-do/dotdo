/**
 * User Preferences Tests - TDD RED Phase
 *
 * Comprehensive tests for user notification preference management.
 * Tests cover:
 * - Opt-out per channel (email, SMS, push)
 * - Opt-out per notification type
 * - Channel priority ordering
 * - Quiet hours configuration
 * - Frequency capping (max N per day/hour)
 * - Global unsubscribe
 * - Preference inheritance (org > team > user)
 * - Preference storage and retrieval
 *
 * These tests should FAIL until PreferenceStore is implemented.
 *
 * @module db/primitives/notifications/tests/user-preferences
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
  // Types - Core
  type PreferenceStoreOptions,
  type UserPreference,
  type OrgPreference,
  type TeamPreference,
  type ChannelPreference,
  type NotificationTypePreference,
  type QuietHoursConfig,
  type FrequencyCapConfig,
  type ChannelPriority,
  // Types - Inheritance
  type PreferenceScope,
  type InheritedPreference,
  type PreferenceResolutionResult,
  // Types - Events
  type PreferenceEventType,
  type PreferenceEventHandler,
} from '../preference-store'

// =============================================================================
// Test Fixtures
// =============================================================================

interface TestUser {
  id: string
  email: string
  orgId: string
  teamId?: string
}

const testUsers: TestUser[] = [
  { id: 'user_1', email: 'alice@example.com', orgId: 'org_1', teamId: 'team_1' },
  { id: 'user_2', email: 'bob@example.com', orgId: 'org_1', teamId: 'team_2' },
  { id: 'user_3', email: 'charlie@example.com', orgId: 'org_2' },
]

const testOrgs = [
  { id: 'org_1', name: 'Acme Corp' },
  { id: 'org_2', name: 'Widget Inc' },
]

const testTeams = [
  { id: 'team_1', name: 'Engineering', orgId: 'org_1' },
  { id: 'team_2', name: 'Marketing', orgId: 'org_1' },
]

// =============================================================================
// Factory and Constructor Tests
// =============================================================================

describe('PreferenceStore Factory', () => {
  describe('createPreferenceStore()', () => {
    it('creates a PreferenceStore instance', () => {
      const store = createPreferenceStore()

      expect(store).toBeDefined()
      expect(store).toBeInstanceOf(PreferenceStore)
    })

    it('accepts optional configuration', () => {
      const store = createPreferenceStore({
        defaultQuietHours: {
          enabled: false,
          start: '22:00',
          end: '08:00',
          timezone: 'UTC',
        },
      })

      expect(store).toBeDefined()
    })

    it('accepts storage adapter option', () => {
      const mockStorage = {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
      }

      const store = createPreferenceStore({
        storage: mockStorage,
      })

      expect(store).toBeDefined()
    })
  })

  describe('PreferenceStore constructor', () => {
    it('initializes with default options', () => {
      const store = new PreferenceStore()

      expect(store).toBeDefined()
    })

    it('initializes with provided options', () => {
      const options: PreferenceStoreOptions = {
        defaultQuietHours: {
          enabled: true,
          start: '23:00',
          end: '07:00',
          timezone: 'America/New_York',
        },
        defaultFrequencyCap: {
          maxPerHour: 10,
          maxPerDay: 50,
        },
      }

      const store = new PreferenceStore(options)

      expect(store).toBeDefined()
    })
  })
})

// =============================================================================
// Channel Opt-Out Tests
// =============================================================================

describe('Channel Opt-Out', () => {
  let store: PreferenceStore

  beforeEach(() => {
    store = createPreferenceStore()
  })

  describe('setChannelOptOut()', () => {
    it('opts user out of email channel', async () => {
      await store.setChannelOptOut('user_1', 'email', true)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.channels.email.enabled).toBe(false)
    })

    it('opts user out of SMS channel', async () => {
      await store.setChannelOptOut('user_1', 'sms', true)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.channels.sms.enabled).toBe(false)
    })

    it('opts user out of push channel', async () => {
      await store.setChannelOptOut('user_1', 'push', true)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.channels.push.enabled).toBe(false)
    })

    it('opts user out of in-app channel', async () => {
      await store.setChannelOptOut('user_1', 'in-app', true)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.channels['in-app'].enabled).toBe(false)
    })

    it('opts user out of Slack channel', async () => {
      await store.setChannelOptOut('user_1', 'slack', true)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.channels.slack.enabled).toBe(false)
    })

    it('opts user out of webhook channel', async () => {
      await store.setChannelOptOut('user_1', 'webhook', true)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.channels.webhook.enabled).toBe(false)
    })

    it('opts user back into a channel', async () => {
      await store.setChannelOptOut('user_1', 'email', true)
      await store.setChannelOptOut('user_1', 'email', false)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.channels.email.enabled).toBe(true)
    })

    it('preserves other channel preferences when opting out of one', async () => {
      await store.setChannelOptOut('user_1', 'email', true)
      await store.setChannelOptOut('user_1', 'sms', true)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.channels.email.enabled).toBe(false)
      expect(prefs.channels.sms.enabled).toBe(false)
      // Other channels should remain enabled by default
      expect(prefs.channels.push?.enabled).not.toBe(false)
    })
  })

  describe('getChannelOptOut()', () => {
    it('returns false for non-opted-out channel', async () => {
      const isOptedOut = await store.getChannelOptOut('user_1', 'email')
      expect(isOptedOut).toBe(false)
    })

    it('returns true for opted-out channel', async () => {
      await store.setChannelOptOut('user_1', 'email', true)

      const isOptedOut = await store.getChannelOptOut('user_1', 'email')
      expect(isOptedOut).toBe(true)
    })
  })

  describe('isChannelEnabled()', () => {
    it('returns true for enabled channel', async () => {
      const isEnabled = await store.isChannelEnabled('user_1', 'email')
      expect(isEnabled).toBe(true)
    })

    it('returns false for disabled channel', async () => {
      await store.setChannelOptOut('user_1', 'email', true)

      const isEnabled = await store.isChannelEnabled('user_1', 'email')
      expect(isEnabled).toBe(false)
    })

    it('considers global unsubscribe when checking channel', async () => {
      await store.setGlobalUnsubscribe('user_1', true)

      const isEnabled = await store.isChannelEnabled('user_1', 'email')
      expect(isEnabled).toBe(false)
    })
  })
})

// =============================================================================
// Notification Type Opt-Out Tests
// =============================================================================

describe('Notification Type Opt-Out', () => {
  let store: PreferenceStore

  beforeEach(() => {
    store = createPreferenceStore()
  })

  describe('setNotificationTypeOptOut()', () => {
    it('opts user out of marketing notifications', async () => {
      await store.setNotificationTypeOptOut('user_1', 'marketing', true)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.notificationTypes.marketing.enabled).toBe(false)
    })

    it('opts user out of promotional notifications', async () => {
      await store.setNotificationTypeOptOut('user_1', 'promotional', true)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.notificationTypes.promotional.enabled).toBe(false)
    })

    it('opts user out of social notifications', async () => {
      await store.setNotificationTypeOptOut('user_1', 'social', true)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.notificationTypes.social.enabled).toBe(false)
    })

    it('cannot opt out of transactional notifications', async () => {
      await store.setNotificationTypeOptOut('user_1', 'transactional', true)

      const prefs = await store.getUserPreferences('user_1')
      // Transactional notifications should always be enabled
      expect(prefs.notificationTypes.transactional.enabled).toBe(true)
    })

    it('cannot opt out of security notifications', async () => {
      await store.setNotificationTypeOptOut('user_1', 'security', true)

      const prefs = await store.getUserPreferences('user_1')
      // Security notifications should always be enabled
      expect(prefs.notificationTypes.security.enabled).toBe(true)
    })

    it('opts user back into notification type', async () => {
      await store.setNotificationTypeOptOut('user_1', 'marketing', true)
      await store.setNotificationTypeOptOut('user_1', 'marketing', false)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.notificationTypes.marketing.enabled).toBe(true)
    })
  })

  describe('setNotificationTypeChannels()', () => {
    it('sets specific channels for a notification type', async () => {
      await store.setNotificationTypeChannels('user_1', 'marketing', ['email'])

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.notificationTypes.marketing.channels).toEqual(['email'])
    })

    it('allows multiple channels for notification type', async () => {
      await store.setNotificationTypeChannels('user_1', 'social', ['push', 'in-app'])

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.notificationTypes.social.channels).toContain('push')
      expect(prefs.notificationTypes.social.channels).toContain('in-app')
    })

    it('updates channels for notification type', async () => {
      await store.setNotificationTypeChannels('user_1', 'marketing', ['email', 'sms'])
      await store.setNotificationTypeChannels('user_1', 'marketing', ['email'])

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.notificationTypes.marketing.channels).toEqual(['email'])
    })
  })

  describe('isNotificationTypeEnabled()', () => {
    it('returns true for enabled notification type', async () => {
      const isEnabled = await store.isNotificationTypeEnabled('user_1', 'marketing')
      expect(isEnabled).toBe(true)
    })

    it('returns false for disabled notification type', async () => {
      await store.setNotificationTypeOptOut('user_1', 'marketing', true)

      const isEnabled = await store.isNotificationTypeEnabled('user_1', 'marketing')
      expect(isEnabled).toBe(false)
    })

    it('considers global unsubscribe except for mandatory types', async () => {
      await store.setGlobalUnsubscribe('user_1', true)

      const marketingEnabled = await store.isNotificationTypeEnabled('user_1', 'marketing')
      const securityEnabled = await store.isNotificationTypeEnabled('user_1', 'security')

      expect(marketingEnabled).toBe(false)
      expect(securityEnabled).toBe(true) // Security bypasses global unsubscribe
    })
  })

  describe('getEnabledChannelsForType()', () => {
    it('returns enabled channels for notification type', async () => {
      await store.setNotificationTypeChannels('user_1', 'marketing', ['email', 'push'])

      const channels = await store.getEnabledChannelsForType('user_1', 'marketing')
      expect(channels).toContain('email')
      expect(channels).toContain('push')
    })

    it('filters out globally disabled channels', async () => {
      await store.setNotificationTypeChannels('user_1', 'marketing', ['email', 'push'])
      await store.setChannelOptOut('user_1', 'email', true)

      const channels = await store.getEnabledChannelsForType('user_1', 'marketing')
      expect(channels).not.toContain('email')
      expect(channels).toContain('push')
    })
  })
})

// =============================================================================
// Channel Priority Ordering Tests
// =============================================================================

describe('Channel Priority Ordering', () => {
  let store: PreferenceStore

  beforeEach(() => {
    store = createPreferenceStore()
  })

  describe('setChannelPriority()', () => {
    it('sets channel priority order', async () => {
      await store.setChannelPriority('user_1', ['push', 'email', 'sms'])

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.channelPriority).toEqual(['push', 'email', 'sms'])
    })

    it('updates existing priority order', async () => {
      await store.setChannelPriority('user_1', ['email', 'sms', 'push'])
      await store.setChannelPriority('user_1', ['push', 'sms', 'email'])

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.channelPriority).toEqual(['push', 'sms', 'email'])
    })

    it('validates that all channels are valid', async () => {
      await expect(
        store.setChannelPriority('user_1', ['email', 'invalid_channel', 'sms'])
      ).rejects.toThrow(/invalid channel/i)
    })
  })

  describe('getChannelPriority()', () => {
    it('returns user channel priority', async () => {
      await store.setChannelPriority('user_1', ['push', 'email', 'sms'])

      const priority = await store.getChannelPriority('user_1')
      expect(priority).toEqual(['push', 'email', 'sms'])
    })

    it('returns default priority for new user', async () => {
      const priority = await store.getChannelPriority('new_user')

      // Default priority should be defined
      expect(priority).toBeDefined()
      expect(Array.isArray(priority)).toBe(true)
      expect(priority.length).toBeGreaterThan(0)
    })

    it('filters out disabled channels from priority', async () => {
      await store.setChannelPriority('user_1', ['push', 'email', 'sms'])
      await store.setChannelOptOut('user_1', 'email', true)

      const priority = await store.getEnabledChannelPriority('user_1')
      expect(priority).not.toContain('email')
      expect(priority).toEqual(['push', 'sms'])
    })
  })

  describe('getPreferredChannel()', () => {
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

    it('returns null if all channels disabled', async () => {
      await store.setChannelPriority('user_1', ['push', 'email', 'sms'])
      await store.setChannelOptOut('user_1', 'push', true)
      await store.setChannelOptOut('user_1', 'email', true)
      await store.setChannelOptOut('user_1', 'sms', true)

      const preferred = await store.getPreferredChannel('user_1')
      expect(preferred).toBeNull()
    })
  })

  describe('reorderChannel()', () => {
    it('moves channel to new position', async () => {
      await store.setChannelPriority('user_1', ['push', 'email', 'sms'])
      await store.reorderChannel('user_1', 'sms', 0)

      const priority = await store.getChannelPriority('user_1')
      expect(priority[0]).toBe('sms')
    })

    it('moves channel down in priority', async () => {
      await store.setChannelPriority('user_1', ['push', 'email', 'sms'])
      await store.reorderChannel('user_1', 'push', 2)

      const priority = await store.getChannelPriority('user_1')
      expect(priority[2]).toBe('push')
    })
  })
})

// =============================================================================
// Quiet Hours Configuration Tests
// =============================================================================

describe('Quiet Hours Configuration', () => {
  let store: PreferenceStore

  beforeEach(() => {
    store = createPreferenceStore()
  })

  describe('setQuietHours()', () => {
    it('sets quiet hours configuration', async () => {
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

    it('validates time format', async () => {
      await expect(
        store.setQuietHours('user_1', {
          enabled: true,
          start: '25:00', // Invalid
          end: '08:00',
          timezone: 'UTC',
        })
      ).rejects.toThrow(/invalid time format/i)
    })

    it('validates timezone', async () => {
      await expect(
        store.setQuietHours('user_1', {
          enabled: true,
          start: '22:00',
          end: '08:00',
          timezone: 'Invalid/Timezone',
        })
      ).rejects.toThrow(/invalid timezone/i)
    })

    it('allows disabling quiet hours', async () => {
      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'UTC',
      })

      await store.setQuietHours('user_1', {
        enabled: false,
        start: '22:00',
        end: '08:00',
        timezone: 'UTC',
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.quietHours.enabled).toBe(false)
    })
  })

  describe('setQuietHoursExceptions()', () => {
    it('sets channels that bypass quiet hours', async () => {
      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'UTC',
      })

      await store.setQuietHoursExceptions('user_1', {
        channels: ['sms'],
        notificationTypes: ['security'],
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.quietHours.exceptions.channels).toContain('sms')
      expect(prefs.quietHours.exceptions.notificationTypes).toContain('security')
    })

    it('sets notification types that bypass quiet hours', async () => {
      await store.setQuietHoursExceptions('user_1', {
        notificationTypes: ['transactional', 'security'],
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.quietHours.exceptions.notificationTypes).toContain('transactional')
      expect(prefs.quietHours.exceptions.notificationTypes).toContain('security')
    })
  })

  describe('setQuietHoursDays()', () => {
    it('sets specific days for quiet hours', async () => {
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

    it('applies quiet hours to all days when not specified', async () => {
      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'UTC',
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.quietHours.days).toBeUndefined() // All days
    })
  })

  describe('isInQuietHours()', () => {
    it('returns true when in quiet hours', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T23:00:00-05:00')) // 11 PM ET

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
      vi.setSystemTime(new Date('2024-01-15T14:00:00-05:00')) // 2 PM ET

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

    it('handles overnight quiet hours', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-16T02:00:00-05:00')) // 2 AM ET (next day)

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

    it('returns false when quiet hours disabled', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T23:00:00-05:00'))

      await store.setQuietHours('user_1', {
        enabled: false,
        start: '22:00',
        end: '08:00',
        timezone: 'America/New_York',
      })

      const inQuietHours = await store.isInQuietHours('user_1')
      expect(inQuietHours).toBe(false)

      vi.useRealTimers()
    })

    it('respects day restrictions', async () => {
      vi.useFakeTimers()
      // Monday at 11 PM
      vi.setSystemTime(new Date('2024-01-15T23:00:00-05:00'))

      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'America/New_York',
        days: ['friday', 'saturday'], // Only weekends
      })

      const inQuietHours = await store.isInQuietHours('user_1')
      expect(inQuietHours).toBe(false)

      vi.useRealTimers()
    })
  })

  describe('shouldBypassQuietHours()', () => {
    it('returns true for excepted notification types', async () => {
      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'UTC',
      })

      await store.setQuietHoursExceptions('user_1', {
        notificationTypes: ['security'],
      })

      const shouldBypass = await store.shouldBypassQuietHours('user_1', {
        notificationType: 'security',
      })

      expect(shouldBypass).toBe(true)
    })

    it('returns true for excepted channels', async () => {
      await store.setQuietHoursExceptions('user_1', {
        channels: ['sms'],
      })

      const shouldBypass = await store.shouldBypassQuietHours('user_1', {
        channel: 'sms',
      })

      expect(shouldBypass).toBe(true)
    })

    it('returns false for non-excepted notifications', async () => {
      await store.setQuietHoursExceptions('user_1', {
        notificationTypes: ['security'],
      })

      const shouldBypass = await store.shouldBypassQuietHours('user_1', {
        notificationType: 'marketing',
      })

      expect(shouldBypass).toBe(false)
    })
  })
})

// =============================================================================
// Frequency Capping Tests
// =============================================================================

describe('Frequency Capping', () => {
  let store: PreferenceStore

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
    store = createPreferenceStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('setFrequencyCap()', () => {
    it('sets max notifications per hour', async () => {
      await store.setFrequencyCap('user_1', {
        maxPerHour: 5,
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.frequencyCap.maxPerHour).toBe(5)
    })

    it('sets max notifications per day', async () => {
      await store.setFrequencyCap('user_1', {
        maxPerDay: 20,
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.frequencyCap.maxPerDay).toBe(20)
    })

    it('sets both hourly and daily limits', async () => {
      await store.setFrequencyCap('user_1', {
        maxPerHour: 5,
        maxPerDay: 20,
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.frequencyCap.maxPerHour).toBe(5)
      expect(prefs.frequencyCap.maxPerDay).toBe(20)
    })

    it('validates that daily cap >= hourly cap * 24', async () => {
      // If hourly is 10, daily should be at least 10 (but can be less to limit total)
      // Actually, it should be allowed - daily cap can be less than hourly * 24
      await expect(
        store.setFrequencyCap('user_1', {
          maxPerHour: 10,
          maxPerDay: 5, // Less than hourly which is valid
        })
      ).resolves.not.toThrow()
    })

    it('removes frequency cap when set to null', async () => {
      await store.setFrequencyCap('user_1', { maxPerHour: 5 })
      await store.setFrequencyCap('user_1', null)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.frequencyCap).toBeUndefined()
    })
  })

  describe('setChannelFrequencyCap()', () => {
    it('sets frequency cap per channel', async () => {
      await store.setChannelFrequencyCap('user_1', 'email', {
        maxPerHour: 2,
        maxPerDay: 10,
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.channels.email.frequencyCap.maxPerHour).toBe(2)
      expect(prefs.channels.email.frequencyCap.maxPerDay).toBe(10)
    })

    it('allows different caps for different channels', async () => {
      await store.setChannelFrequencyCap('user_1', 'email', { maxPerDay: 10 })
      await store.setChannelFrequencyCap('user_1', 'sms', { maxPerDay: 3 })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.channels.email.frequencyCap.maxPerDay).toBe(10)
      expect(prefs.channels.sms.frequencyCap.maxPerDay).toBe(3)
    })
  })

  describe('setNotificationTypeFrequencyCap()', () => {
    it('sets frequency cap per notification type', async () => {
      await store.setNotificationTypeFrequencyCap('user_1', 'marketing', {
        maxPerDay: 2,
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.notificationTypes.marketing.frequencyCap.maxPerDay).toBe(2)
    })
  })

  describe('recordNotification()', () => {
    it('records notification for frequency tracking', async () => {
      await store.setFrequencyCap('user_1', { maxPerHour: 5 })

      await store.recordNotification('user_1', {
        channel: 'email',
        notificationType: 'marketing',
        timestamp: new Date(),
      })

      const count = await store.getNotificationCount('user_1', { window: 'hour' })
      expect(count).toBe(1)
    })

    it('tracks notifications per channel', async () => {
      await store.recordNotification('user_1', { channel: 'email' })
      await store.recordNotification('user_1', { channel: 'email' })
      await store.recordNotification('user_1', { channel: 'sms' })

      const emailCount = await store.getNotificationCount('user_1', {
        channel: 'email',
        window: 'day',
      })
      const smsCount = await store.getNotificationCount('user_1', {
        channel: 'sms',
        window: 'day',
      })

      expect(emailCount).toBe(2)
      expect(smsCount).toBe(1)
    })
  })

  describe('isWithinFrequencyCap()', () => {
    it('returns true when under cap', async () => {
      await store.setFrequencyCap('user_1', { maxPerHour: 5 })
      await store.recordNotification('user_1', { channel: 'email' })
      await store.recordNotification('user_1', { channel: 'email' })

      const withinCap = await store.isWithinFrequencyCap('user_1')
      expect(withinCap).toBe(true)
    })

    it('returns false when at hourly cap', async () => {
      await store.setFrequencyCap('user_1', { maxPerHour: 3 })

      for (let i = 0; i < 3; i++) {
        await store.recordNotification('user_1', { channel: 'email' })
      }

      const withinCap = await store.isWithinFrequencyCap('user_1')
      expect(withinCap).toBe(false)
    })

    it('returns false when at daily cap', async () => {
      await store.setFrequencyCap('user_1', { maxPerDay: 5 })

      for (let i = 0; i < 5; i++) {
        await store.recordNotification('user_1', { channel: 'email' })
      }

      const withinCap = await store.isWithinFrequencyCap('user_1')
      expect(withinCap).toBe(false)
    })

    it('resets hourly count after hour passes', async () => {
      await store.setFrequencyCap('user_1', { maxPerHour: 3 })

      for (let i = 0; i < 3; i++) {
        await store.recordNotification('user_1', { channel: 'email' })
      }

      // Advance time by 1 hour
      vi.advanceTimersByTime(60 * 60 * 1000)

      const withinCap = await store.isWithinFrequencyCap('user_1')
      expect(withinCap).toBe(true)
    })

    it('resets daily count after day passes', async () => {
      await store.setFrequencyCap('user_1', { maxPerDay: 3 })

      for (let i = 0; i < 3; i++) {
        await store.recordNotification('user_1', { channel: 'email' })
      }

      // Advance time by 24 hours
      vi.advanceTimersByTime(24 * 60 * 60 * 1000)

      const withinCap = await store.isWithinFrequencyCap('user_1')
      expect(withinCap).toBe(true)
    })
  })

  describe('isChannelWithinFrequencyCap()', () => {
    it('checks channel-specific frequency cap', async () => {
      await store.setChannelFrequencyCap('user_1', 'sms', { maxPerDay: 2 })

      await store.recordNotification('user_1', { channel: 'sms' })
      await store.recordNotification('user_1', { channel: 'sms' })

      const smsWithinCap = await store.isChannelWithinFrequencyCap('user_1', 'sms')
      const emailWithinCap = await store.isChannelWithinFrequencyCap('user_1', 'email')

      expect(smsWithinCap).toBe(false)
      expect(emailWithinCap).toBe(true)
    })
  })

  describe('getRemainingCapacity()', () => {
    it('returns remaining notifications allowed in hour', async () => {
      await store.setFrequencyCap('user_1', { maxPerHour: 5 })
      await store.recordNotification('user_1', { channel: 'email' })
      await store.recordNotification('user_1', { channel: 'email' })

      const remaining = await store.getRemainingCapacity('user_1', 'hour')
      expect(remaining).toBe(3)
    })

    it('returns remaining notifications allowed in day', async () => {
      await store.setFrequencyCap('user_1', { maxPerDay: 10 })
      for (let i = 0; i < 4; i++) {
        await store.recordNotification('user_1', { channel: 'email' })
      }

      const remaining = await store.getRemainingCapacity('user_1', 'day')
      expect(remaining).toBe(6)
    })

    it('returns Infinity when no cap set', async () => {
      const remaining = await store.getRemainingCapacity('user_1', 'hour')
      expect(remaining).toBe(Infinity)
    })
  })
})

// =============================================================================
// Global Unsubscribe Tests
// =============================================================================

describe('Global Unsubscribe', () => {
  let store: PreferenceStore

  beforeEach(() => {
    store = createPreferenceStore()
  })

  describe('setGlobalUnsubscribe()', () => {
    it('sets global unsubscribe to true', async () => {
      await store.setGlobalUnsubscribe('user_1', true)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.globalUnsubscribe).toBe(true)
    })

    it('sets global unsubscribe to false (resubscribe)', async () => {
      await store.setGlobalUnsubscribe('user_1', true)
      await store.setGlobalUnsubscribe('user_1', false)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.globalUnsubscribe).toBe(false)
    })

    it('records reason for unsubscribe', async () => {
      await store.setGlobalUnsubscribe('user_1', true, {
        reason: 'Too many emails',
        source: 'email_footer_link',
      })

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.globalUnsubscribe).toBe(true)
      expect(prefs.unsubscribeReason).toBe('Too many emails')
      expect(prefs.unsubscribeSource).toBe('email_footer_link')
    })

    it('records timestamp of unsubscribe', async () => {
      vi.useFakeTimers()
      const now = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(now)

      await store.setGlobalUnsubscribe('user_1', true)

      const prefs = await store.getUserPreferences('user_1')
      expect(prefs.unsubscribedAt).toEqual(now)

      vi.useRealTimers()
    })
  })

  describe('isGloballyUnsubscribed()', () => {
    it('returns false for subscribed user', async () => {
      const isUnsubscribed = await store.isGloballyUnsubscribed('user_1')
      expect(isUnsubscribed).toBe(false)
    })

    it('returns true for unsubscribed user', async () => {
      await store.setGlobalUnsubscribe('user_1', true)

      const isUnsubscribed = await store.isGloballyUnsubscribed('user_1')
      expect(isUnsubscribed).toBe(true)
    })
  })

  describe('Global unsubscribe behavior', () => {
    it('blocks all non-mandatory notification types', async () => {
      await store.setGlobalUnsubscribe('user_1', true)

      const marketingEnabled = await store.isNotificationTypeEnabled('user_1', 'marketing')
      const socialEnabled = await store.isNotificationTypeEnabled('user_1', 'social')
      const promotionalEnabled = await store.isNotificationTypeEnabled('user_1', 'promotional')

      expect(marketingEnabled).toBe(false)
      expect(socialEnabled).toBe(false)
      expect(promotionalEnabled).toBe(false)
    })

    it('allows transactional notifications despite global unsubscribe', async () => {
      await store.setGlobalUnsubscribe('user_1', true)

      const transactionalEnabled = await store.isNotificationTypeEnabled('user_1', 'transactional')
      expect(transactionalEnabled).toBe(true)
    })

    it('allows security notifications despite global unsubscribe', async () => {
      await store.setGlobalUnsubscribe('user_1', true)

      const securityEnabled = await store.isNotificationTypeEnabled('user_1', 'security')
      expect(securityEnabled).toBe(true)
    })

    it('blocks all channels except for mandatory notification types', async () => {
      await store.setGlobalUnsubscribe('user_1', true)

      // Regular check should show disabled
      const emailEnabled = await store.isChannelEnabled('user_1', 'email')
      expect(emailEnabled).toBe(false)

      // But with mandatory notification type, channel should work
      const emailForSecurity = await store.isChannelEnabled('user_1', 'email', {
        notificationType: 'security',
      })
      expect(emailForSecurity).toBe(true)
    })
  })

  describe('getMandatoryNotificationTypes()', () => {
    it('returns list of mandatory notification types', async () => {
      const mandatory = await store.getMandatoryNotificationTypes()

      expect(mandatory).toContain('transactional')
      expect(mandatory).toContain('security')
      expect(mandatory).not.toContain('marketing')
    })
  })
})

// =============================================================================
// Preference Inheritance Tests (Org > Team > User)
// =============================================================================

describe('Preference Inheritance', () => {
  let store: PreferenceStore

  beforeEach(() => {
    store = createPreferenceStore()
  })

  describe('setOrgPreferences()', () => {
    it('sets organization-level preferences', async () => {
      await store.setOrgPreferences('org_1', {
        defaultQuietHours: {
          enabled: true,
          start: '22:00',
          end: '07:00',
          timezone: 'UTC',
        },
        allowedChannels: ['email', 'in-app'],
      })

      const orgPrefs = await store.getOrgPreferences('org_1')
      expect(orgPrefs.defaultQuietHours.enabled).toBe(true)
      expect(orgPrefs.allowedChannels).toEqual(['email', 'in-app'])
    })

    it('sets org-level channel restrictions', async () => {
      await store.setOrgPreferences('org_1', {
        disabledChannels: ['sms'], // Org disables SMS
      })

      const orgPrefs = await store.getOrgPreferences('org_1')
      expect(orgPrefs.disabledChannels).toContain('sms')
    })
  })

  describe('setTeamPreferences()', () => {
    it('sets team-level preferences', async () => {
      await store.setTeamPreferences('team_1', 'org_1', {
        defaultQuietHours: {
          enabled: true,
          start: '23:00',
          end: '08:00',
          timezone: 'America/Los_Angeles',
        },
      })

      const teamPrefs = await store.getTeamPreferences('team_1')
      expect(teamPrefs.defaultQuietHours.start).toBe('23:00')
    })

    it('inherits org preferences', async () => {
      await store.setOrgPreferences('org_1', {
        disabledChannels: ['sms'],
      })

      await store.setTeamPreferences('team_1', 'org_1', {
        disabledChannels: ['push'], // Team also disables push
      })

      const teamPrefs = await store.getTeamPreferences('team_1')
      // Should have both org and team disabled channels
      expect(teamPrefs.effectiveDisabledChannels).toContain('sms')
      expect(teamPrefs.effectiveDisabledChannels).toContain('push')
    })
  })

  describe('resolvePreferences()', () => {
    it('resolves user preferences with inheritance', async () => {
      // Org level
      await store.setOrgPreferences('org_1', {
        defaultQuietHours: {
          enabled: true,
          start: '22:00',
          end: '06:00',
          timezone: 'UTC',
        },
        disabledChannels: ['webhook'],
      })

      // Team level - overrides org quiet hours
      await store.setTeamPreferences('team_1', 'org_1', {
        defaultQuietHours: {
          enabled: true,
          start: '23:00',
          end: '07:00',
          timezone: 'America/New_York',
        },
      })

      // User level - inherits from team and org
      // User doesn't set quiet hours, so inherits team's

      const resolved = await store.resolvePreferences('user_1', {
        orgId: 'org_1',
        teamId: 'team_1',
      })

      // Should use team's quiet hours (team overrides org)
      expect(resolved.quietHours.start).toBe('23:00')
      expect(resolved.quietHours.timezone).toBe('America/New_York')

      // Should inherit org's disabled channels
      expect(resolved.disabledChannels).toContain('webhook')
    })

    it('user preferences override team and org', async () => {
      await store.setOrgPreferences('org_1', {
        defaultFrequencyCap: { maxPerDay: 100 },
      })

      await store.setTeamPreferences('team_1', 'org_1', {
        defaultFrequencyCap: { maxPerDay: 50 },
      })

      await store.setFrequencyCap('user_1', { maxPerDay: 20 })

      const resolved = await store.resolvePreferences('user_1', {
        orgId: 'org_1',
        teamId: 'team_1',
      })

      // User's cap should take precedence
      expect(resolved.frequencyCap.maxPerDay).toBe(20)
    })

    it('team overrides org preferences', async () => {
      await store.setOrgPreferences('org_1', {
        defaultQuietHours: {
          enabled: true,
          start: '20:00',
          end: '08:00',
          timezone: 'UTC',
        },
      })

      await store.setTeamPreferences('team_1', 'org_1', {
        defaultQuietHours: {
          enabled: false,
          start: '20:00',
          end: '08:00',
          timezone: 'UTC',
        },
      })

      // User has no quiet hours set
      const resolved = await store.resolvePreferences('user_1', {
        orgId: 'org_1',
        teamId: 'team_1',
      })

      // Team disabled quiet hours should override org
      expect(resolved.quietHours.enabled).toBe(false)
    })

    it('uses org defaults when team and user have no preferences', async () => {
      await store.setOrgPreferences('org_1', {
        defaultChannelPriority: ['push', 'email', 'sms'],
      })

      const resolved = await store.resolvePreferences('user_1', {
        orgId: 'org_1',
      })

      expect(resolved.channelPriority).toEqual(['push', 'email', 'sms'])
    })
  })

  describe('getPreferenceSource()', () => {
    it('indicates where a preference value came from', async () => {
      await store.setOrgPreferences('org_1', {
        defaultQuietHours: {
          enabled: true,
          start: '22:00',
          end: '06:00',
          timezone: 'UTC',
        },
      })

      const source = await store.getPreferenceSource('user_1', 'quietHours', {
        orgId: 'org_1',
        teamId: 'team_1',
      })

      expect(source).toBe('org')
    })

    it('returns user when user has set preference', async () => {
      await store.setQuietHours('user_1', {
        enabled: false,
        start: '23:00',
        end: '07:00',
        timezone: 'America/New_York',
      })

      const source = await store.getPreferenceSource('user_1', 'quietHours', {
        orgId: 'org_1',
      })

      expect(source).toBe('user')
    })

    it('returns team when inherited from team', async () => {
      await store.setTeamPreferences('team_1', 'org_1', {
        defaultFrequencyCap: { maxPerDay: 50 },
      })

      const source = await store.getPreferenceSource('user_1', 'frequencyCap', {
        orgId: 'org_1',
        teamId: 'team_1',
      })

      expect(source).toBe('team')
    })

    it('returns default when no preference set at any level', async () => {
      const source = await store.getPreferenceSource('new_user', 'quietHours', {})

      expect(source).toBe('default')
    })
  })

  describe('Org/Team channel restrictions', () => {
    it('org can restrict available channels', async () => {
      await store.setOrgPreferences('org_1', {
        allowedChannels: ['email', 'in-app'], // Only allow email and in-app
      })

      const canUseSms = await store.isChannelAllowed('user_1', 'sms', { orgId: 'org_1' })
      const canUseEmail = await store.isChannelAllowed('user_1', 'email', { orgId: 'org_1' })

      expect(canUseSms).toBe(false)
      expect(canUseEmail).toBe(true)
    })

    it('team cannot enable channel disabled by org', async () => {
      await store.setOrgPreferences('org_1', {
        disabledChannels: ['sms'],
      })

      // Team tries to enable SMS
      await store.setTeamPreferences('team_1', 'org_1', {
        allowedChannels: ['email', 'sms', 'push'],
      })

      const canUseSms = await store.isChannelAllowed('user_1', 'sms', {
        orgId: 'org_1',
        teamId: 'team_1',
      })

      expect(canUseSms).toBe(false) // Org restriction takes precedence
    })

    it('user cannot enable channel disabled by org or team', async () => {
      await store.setOrgPreferences('org_1', {
        disabledChannels: ['webhook'],
      })

      // User tries to enable webhook by not opting out
      const canUseWebhook = await store.isChannelAllowed('user_1', 'webhook', { orgId: 'org_1' })

      expect(canUseWebhook).toBe(false)
    })
  })
})

// =============================================================================
// Preference Storage and Retrieval Tests
// =============================================================================

describe('Preference Storage and Retrieval', () => {
  let store: PreferenceStore

  beforeEach(() => {
    store = createPreferenceStore()
  })

  describe('getUserPreferences()', () => {
    it('returns default preferences for new user', async () => {
      const prefs = await store.getUserPreferences('new_user')

      expect(prefs).toBeDefined()
      expect(prefs.globalUnsubscribe).toBe(false)
      expect(prefs.channels).toBeDefined()
    })

    it('returns stored preferences', async () => {
      await store.setChannelOptOut('user_1', 'email', true)
      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'UTC',
      })

      const prefs = await store.getUserPreferences('user_1')

      expect(prefs.channels.email.enabled).toBe(false)
      expect(prefs.quietHours.enabled).toBe(true)
    })

    it('returns complete preference object', async () => {
      const prefs = await store.getUserPreferences('user_1')

      // Should have all expected fields
      expect(prefs).toHaveProperty('globalUnsubscribe')
      expect(prefs).toHaveProperty('channels')
      expect(prefs).toHaveProperty('notificationTypes')
      expect(prefs).toHaveProperty('channelPriority')
      expect(prefs).toHaveProperty('quietHours')
      expect(prefs).toHaveProperty('frequencyCap')
    })
  })

  describe('setUserPreferences()', () => {
    it('sets complete user preferences', async () => {
      await store.setUserPreferences('user_1', {
        globalUnsubscribe: false,
        channels: {
          email: { enabled: true },
          sms: { enabled: false },
        },
        notificationTypes: {
          marketing: { enabled: false },
        },
        channelPriority: ['push', 'email', 'sms'],
        quietHours: {
          enabled: true,
          start: '23:00',
          end: '07:00',
          timezone: 'America/New_York',
        },
        frequencyCap: {
          maxPerHour: 5,
          maxPerDay: 50,
        },
      })

      const prefs = await store.getUserPreferences('user_1')

      expect(prefs.channels.sms.enabled).toBe(false)
      expect(prefs.notificationTypes.marketing.enabled).toBe(false)
      expect(prefs.channelPriority).toEqual(['push', 'email', 'sms'])
      expect(prefs.quietHours.start).toBe('23:00')
    })

    it('merges with existing preferences', async () => {
      await store.setChannelOptOut('user_1', 'email', true)

      await store.setUserPreferences('user_1', {
        quietHours: {
          enabled: true,
          start: '22:00',
          end: '08:00',
          timezone: 'UTC',
        },
      })

      const prefs = await store.getUserPreferences('user_1')

      // Email opt-out should be preserved
      expect(prefs.channels.email.enabled).toBe(false)
      expect(prefs.quietHours.enabled).toBe(true)
    })
  })

  describe('resetUserPreferences()', () => {
    it('resets all user preferences to defaults', async () => {
      await store.setChannelOptOut('user_1', 'email', true)
      await store.setGlobalUnsubscribe('user_1', true)
      await store.setFrequencyCap('user_1', { maxPerDay: 10 })

      await store.resetUserPreferences('user_1')

      const prefs = await store.getUserPreferences('user_1')

      expect(prefs.globalUnsubscribe).toBe(false)
      expect(prefs.channels.email?.enabled).not.toBe(false)
    })

    it('resets specific preference categories', async () => {
      await store.setChannelOptOut('user_1', 'email', true)
      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'UTC',
      })

      await store.resetUserPreferences('user_1', { categories: ['quietHours'] })

      const prefs = await store.getUserPreferences('user_1')

      // Channel opt-out should be preserved
      expect(prefs.channels.email.enabled).toBe(false)
      // Quiet hours should be reset
      expect(prefs.quietHours?.enabled).not.toBe(true)
    })
  })

  describe('deleteUserPreferences()', () => {
    it('deletes all user preferences', async () => {
      await store.setChannelOptOut('user_1', 'email', true)
      await store.setFrequencyCap('user_1', { maxPerDay: 10 })

      await store.deleteUserPreferences('user_1')

      const prefs = await store.getUserPreferences('user_1')

      // Should return defaults
      expect(prefs.globalUnsubscribe).toBe(false)
    })
  })

  describe('exportUserPreferences()', () => {
    it('exports user preferences as JSON', async () => {
      await store.setChannelOptOut('user_1', 'email', true)
      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'America/New_York',
      })

      const exported = await store.exportUserPreferences('user_1')

      expect(exported).toBeDefined()
      expect(typeof exported).toBe('string')

      const parsed = JSON.parse(exported)
      expect(parsed.channels.email.enabled).toBe(false)
      expect(parsed.quietHours.enabled).toBe(true)
    })
  })

  describe('importUserPreferences()', () => {
    it('imports user preferences from JSON', async () => {
      const prefsJson = JSON.stringify({
        globalUnsubscribe: false,
        channels: {
          email: { enabled: true },
          sms: { enabled: false },
        },
        quietHours: {
          enabled: true,
          start: '23:00',
          end: '07:00',
          timezone: 'UTC',
        },
      })

      await store.importUserPreferences('user_1', prefsJson)

      const prefs = await store.getUserPreferences('user_1')

      expect(prefs.channels.sms.enabled).toBe(false)
      expect(prefs.quietHours.start).toBe('23:00')
    })

    it('validates imported preferences', async () => {
      const invalidJson = JSON.stringify({
        quietHours: {
          enabled: true,
          start: 'invalid_time',
          end: '08:00',
          timezone: 'UTC',
        },
      })

      await expect(store.importUserPreferences('user_1', invalidJson)).rejects.toThrow(
        /invalid time format/i
      )
    })
  })

  describe('listUsersWithPreference()', () => {
    it('lists users with specific preference', async () => {
      await store.setGlobalUnsubscribe('user_1', true)
      await store.setGlobalUnsubscribe('user_2', true)
      // user_3 is not unsubscribed

      const unsubscribedUsers = await store.listUsersWithPreference({
        globalUnsubscribe: true,
      })

      expect(unsubscribedUsers).toContain('user_1')
      expect(unsubscribedUsers).toContain('user_2')
      expect(unsubscribedUsers).not.toContain('user_3')
    })

    it('lists users with channel opt-out', async () => {
      await store.setChannelOptOut('user_1', 'email', true)
      await store.setChannelOptOut('user_2', 'email', true)
      await store.setChannelOptOut('user_3', 'sms', true)

      const emailOptedOut = await store.listUsersWithPreference({
        channel: 'email',
        enabled: false,
      })

      expect(emailOptedOut).toContain('user_1')
      expect(emailOptedOut).toContain('user_2')
      expect(emailOptedOut).not.toContain('user_3')
    })
  })
})

// =============================================================================
// Event Emission Tests
// =============================================================================

describe('Preference Events', () => {
  let store: PreferenceStore

  beforeEach(() => {
    store = createPreferenceStore()
  })

  describe('Event handlers', () => {
    it('emits preference:changed event on preference update', async () => {
      const handler = vi.fn()
      store.on('preference:changed', handler)

      await store.setChannelOptOut('user_1', 'email', true)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user_1',
          preference: 'channels.email.enabled',
          oldValue: true,
          newValue: false,
        })
      )
    })

    it('emits preference:globalUnsubscribe event', async () => {
      const handler = vi.fn()
      store.on('preference:globalUnsubscribe', handler)

      await store.setGlobalUnsubscribe('user_1', true, { reason: 'Too many emails' })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user_1',
          unsubscribed: true,
          reason: 'Too many emails',
        })
      )
    })

    it('emits preference:quietHoursUpdated event', async () => {
      const handler = vi.fn()
      store.on('preference:quietHoursUpdated', handler)

      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'UTC',
      })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user_1',
          quietHours: expect.objectContaining({
            enabled: true,
            start: '22:00',
          }),
        })
      )
    })

    it('removes event handler with off()', async () => {
      const handler = vi.fn()
      store.on('preference:changed', handler)
      store.off('preference:changed', handler)

      await store.setChannelOptOut('user_1', 'email', true)

      expect(handler).not.toHaveBeenCalled()
    })
  })
})

// =============================================================================
// Validation Tests
// =============================================================================

describe('Preference Validation', () => {
  let store: PreferenceStore

  beforeEach(() => {
    store = createPreferenceStore()
  })

  describe('Channel validation', () => {
    it('rejects invalid channel names', async () => {
      await expect(store.setChannelOptOut('user_1', 'invalid_channel' as any, true)).rejects.toThrow(
        /invalid channel/i
      )
    })
  })

  describe('Notification type validation', () => {
    it('rejects invalid notification types', async () => {
      await expect(
        store.setNotificationTypeOptOut('user_1', 'invalid_type' as any, true)
      ).rejects.toThrow(/invalid notification type/i)
    })
  })

  describe('Quiet hours validation', () => {
    it('rejects invalid time format', async () => {
      await expect(
        store.setQuietHours('user_1', {
          enabled: true,
          start: '25:00',
          end: '08:00',
          timezone: 'UTC',
        })
      ).rejects.toThrow(/invalid time format/i)
    })

    it('rejects invalid timezone', async () => {
      await expect(
        store.setQuietHours('user_1', {
          enabled: true,
          start: '22:00',
          end: '08:00',
          timezone: 'Invalid/Timezone',
        })
      ).rejects.toThrow(/invalid timezone/i)
    })

    it('rejects invalid day names', async () => {
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

  describe('Frequency cap validation', () => {
    it('rejects negative values', async () => {
      await expect(store.setFrequencyCap('user_1', { maxPerHour: -1 })).rejects.toThrow(
        /must be positive/i
      )
    })

    it('rejects zero values', async () => {
      await expect(store.setFrequencyCap('user_1', { maxPerDay: 0 })).rejects.toThrow(
        /must be positive/i
      )
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Preference Store Integration', () => {
  describe('Complete user preference workflow', () => {
    it('handles typical user preference setup flow', async () => {
      const store = createPreferenceStore()

      // 1. Set org defaults
      await store.setOrgPreferences('org_1', {
        defaultQuietHours: {
          enabled: true,
          start: '22:00',
          end: '07:00',
          timezone: 'UTC',
        },
        defaultFrequencyCap: { maxPerDay: 100 },
      })

      // 2. Set team overrides
      await store.setTeamPreferences('team_1', 'org_1', {
        defaultQuietHours: {
          enabled: true,
          start: '23:00',
          end: '08:00',
          timezone: 'America/New_York',
        },
      })

      // 3. User customizes preferences
      await store.setChannelOptOut('user_1', 'sms', true)
      await store.setChannelPriority('user_1', ['push', 'email'])
      await store.setNotificationTypeOptOut('user_1', 'marketing', true)

      // 4. Resolve final preferences
      const resolved = await store.resolvePreferences('user_1', {
        orgId: 'org_1',
        teamId: 'team_1',
      })

      // Verify inheritance
      expect(resolved.quietHours.start).toBe('23:00') // From team
      expect(resolved.frequencyCap.maxPerDay).toBe(100) // From org
      expect(resolved.channels.sms.enabled).toBe(false) // User setting
      expect(resolved.channelPriority).toEqual(['push', 'email']) // User setting
      expect(resolved.notificationTypes.marketing.enabled).toBe(false) // User setting
    })
  })

  describe('Notification delivery decision', () => {
    it('correctly determines if notification should be sent', async () => {
      const store = createPreferenceStore()

      await store.setChannelOptOut('user_1', 'sms', true)
      await store.setNotificationTypeOptOut('user_1', 'marketing', true)
      await store.setQuietHours('user_1', {
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'UTC',
      })
      await store.setFrequencyCap('user_1', { maxPerHour: 5 })

      // Record 5 notifications
      for (let i = 0; i < 5; i++) {
        await store.recordNotification('user_1', { channel: 'email' })
      }

      // Check various scenarios
      const canSendEmailMarketing = await store.canSendNotification('user_1', {
        channel: 'email',
        notificationType: 'marketing',
      })

      const canSendEmailTransactional = await store.canSendNotification('user_1', {
        channel: 'email',
        notificationType: 'transactional',
      })

      const canSendSmsTransactional = await store.canSendNotification('user_1', {
        channel: 'sms',
        notificationType: 'transactional',
      })

      expect(canSendEmailMarketing).toBe(false) // Marketing is disabled
      expect(canSendEmailTransactional).toBe(false) // Frequency cap reached
      expect(canSendSmsTransactional).toBe(false) // SMS is disabled
    })
  })
})

// =============================================================================
// Cleanup Tests
// =============================================================================

describe('PreferenceStore Cleanup', () => {
  describe('dispose()', () => {
    it('cleans up resources', async () => {
      const store = createPreferenceStore()

      await store.setChannelOptOut('user_1', 'email', true)

      store.dispose()

      // After disposal, operations should throw or be no-ops
      await expect(store.getUserPreferences('user_1')).rejects.toThrow(/disposed/i)
    })
  })
})
