/**
 * Digest/Batching Tests - Enhanced notification aggregation
 *
 * Tests for:
 * - Daily/weekly summary generation
 * - Intelligent notification grouping by category/sender
 * - Digest scheduling preferences
 * - Summary template rendering
 *
 * @module db/primitives/notifications/tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  createNotificationRouter,
  NotificationRouter,
  hours,
  minutes,
  type DigestConfig,
  type DigestSchedule,
  type DigestGroupingConfig,
  type DigestItem,
  type DigestGroup,
  type ChannelAdapter,
} from '../index'

// ============================================================================
// Test Fixtures
// ============================================================================

function createEmailAdapter(): ChannelAdapter {
  return {
    type: 'email',
    send: vi.fn().mockResolvedValue({ messageId: 'email_msg_123' }),
    validateRecipient: vi.fn().mockResolvedValue(true),
  }
}

// ============================================================================
// Digest Scheduling Tests
// ============================================================================

describe('Digest Scheduling', () => {
  let router: NotificationRouter
  let emailAdapter: ChannelAdapter

  beforeEach(() => {
    vi.useFakeTimers()
    router = createNotificationRouter()
    emailAdapter = createEmailAdapter()
    router.registerChannel(emailAdapter)
  })

  afterEach(() => {
    router.dispose()
    vi.useRealTimers()
  })

  describe('Schedule Presets', () => {
    it('supports hourly preset', async () => {
      router.configureDigest('hourly_digest', {
        enabled: true,
        schedule: { preset: 'hourly' },
        channels: ['email'],
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Update 1', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        digest: 'hourly_digest',
      })

      // Should not send immediately
      expect(emailAdapter.send).not.toHaveBeenCalled()

      // Advance 1 hour
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

      // Should have sent the digest
      expect(emailAdapter.send).toHaveBeenCalledOnce()
    })

    it('supports daily preset', async () => {
      router.configureDigest('daily_digest', {
        enabled: true,
        schedule: { preset: 'daily' },
        channels: ['email'],
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Update 1', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        digest: 'daily_digest',
      })

      // Should not send after 12 hours
      await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000)
      expect(emailAdapter.send).not.toHaveBeenCalled()

      // Should send after 24 hours
      await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000)
      expect(emailAdapter.send).toHaveBeenCalledOnce()
    })

    it('supports weekly preset', async () => {
      router.configureDigest('weekly_digest', {
        enabled: true,
        schedule: { preset: 'weekly' },
        channels: ['email'],
        minItems: 1,
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Update 1', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        digest: 'weekly_digest',
      })

      // Should not send after 3 days
      await vi.advanceTimersByTimeAsync(3 * 24 * 60 * 60 * 1000)
      expect(emailAdapter.send).not.toHaveBeenCalled()

      // Should send after 7 days
      await vi.advanceTimersByTimeAsync(4 * 24 * 60 * 60 * 1000)
      expect(emailAdapter.send).toHaveBeenCalledOnce()
    })

    it('supports custom interval via schedule', async () => {
      router.configureDigest('custom_digest', {
        enabled: true,
        schedule: {
          preset: 'custom',
          interval: minutes(30),
        },
        channels: ['email'],
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Update', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        digest: 'custom_digest',
      })

      // Should not send after 15 minutes
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
      expect(emailAdapter.send).not.toHaveBeenCalled()

      // Should send after 30 minutes
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
      expect(emailAdapter.send).toHaveBeenCalledOnce()
    })
  })

  describe('Legacy Interval Support', () => {
    it('uses legacy interval when schedule is not provided', async () => {
      router.configureDigest('legacy_digest', {
        enabled: true,
        interval: hours(2),
        channels: ['email'],
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Update', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        digest: 'legacy_digest',
      })

      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)
      expect(emailAdapter.send).toHaveBeenCalledOnce()
    })
  })
})

// ============================================================================
// Notification Grouping Tests
// ============================================================================

describe('Notification Grouping', () => {
  let router: NotificationRouter
  let emailAdapter: ChannelAdapter

  beforeEach(() => {
    vi.useFakeTimers()
    router = createNotificationRouter()
    emailAdapter = createEmailAdapter()
    router.registerChannel(emailAdapter)
  })

  afterEach(() => {
    router.dispose()
    vi.useRealTimers()
  })

  describe('Group by Category', () => {
    it('groups notifications by category', async () => {
      router.configureDigest('categorized_digest', {
        enabled: true,
        schedule: { preset: 'daily' },
        channels: ['email'],
        grouping: {
          groupBy: 'category',
        },
      })

      // Send notifications with different categories
      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Social Update 1', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        category: 'social',
        digest: 'categorized_digest',
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Marketing Update 1', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        category: 'marketing',
        digest: 'categorized_digest',
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Social Update 2', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        category: 'social',
        digest: 'categorized_digest',
      })

      // Get summary to verify grouping
      const summary = await router.getDigestSummary('user_1', 'categorized_digest')

      expect(summary).toBeDefined()
      expect(summary!.totalItems).toBe(3)
      expect(summary!.groups).toHaveLength(2)

      const socialGroup = summary!.groups.find((g) => g.key === 'social')
      const marketingGroup = summary!.groups.find((g) => g.key === 'marketing')

      expect(socialGroup?.items).toHaveLength(2)
      expect(marketingGroup?.items).toHaveLength(1)
    })

    it('handles uncategorized notifications', async () => {
      router.configureDigest('mixed_digest', {
        enabled: true,
        schedule: { preset: 'daily' },
        channels: ['email'],
        grouping: {
          groupBy: 'category',
        },
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Categorized', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        category: 'updates',
        digest: 'mixed_digest',
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Uncategorized', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        digest: 'mixed_digest',
      })

      const summary = await router.getDigestSummary('user_1', 'mixed_digest')

      expect(summary!.groups).toHaveLength(2)
      const uncategorizedGroup = summary!.groups.find((g) => g.key === 'uncategorized')
      expect(uncategorizedGroup).toBeDefined()
      expect(uncategorizedGroup!.label).toBe('Other')
    })
  })

  describe('Group by Sender', () => {
    it('groups notifications by sender', async () => {
      router.configureDigest('sender_digest', {
        enabled: true,
        schedule: { preset: 'daily' },
        channels: ['email'],
        grouping: {
          groupBy: 'sender',
        },
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'From John', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        metadata: { sender: 'John' },
        digest: 'sender_digest',
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'From Sarah', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        metadata: { sender: 'Sarah' },
        digest: 'sender_digest',
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Another from John', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        metadata: { sender: 'John' },
        digest: 'sender_digest',
      })

      const summary = await router.getDigestSummary('user_1', 'sender_digest')

      expect(summary!.groups).toHaveLength(2)
      const johnGroup = summary!.groups.find((g) => g.key === 'John')
      expect(johnGroup?.items).toHaveLength(2)
    })
  })

  describe('Group by Category and Sender', () => {
    it('creates composite groups', async () => {
      router.configureDigest('composite_digest', {
        enabled: true,
        schedule: { preset: 'daily' },
        channels: ['email'],
        grouping: {
          groupBy: 'category_and_sender',
        },
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Social from John', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        category: 'social',
        metadata: { sender: 'John' },
        digest: 'composite_digest',
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Social from Sarah', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        category: 'social',
        metadata: { sender: 'Sarah' },
        digest: 'composite_digest',
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Marketing from John', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        category: 'marketing',
        metadata: { sender: 'John' },
        digest: 'composite_digest',
      })

      const summary = await router.getDigestSummary('user_1', 'composite_digest')

      expect(summary!.groups).toHaveLength(3)

      const socialJohnGroup = summary!.groups.find((g) => g.key === 'social:John')
      expect(socialJohnGroup).toBeDefined()
      expect(socialJohnGroup!.items).toHaveLength(1)
    })
  })

  describe('Grouping Options', () => {
    it('sorts groups by count when enabled', async () => {
      router.configureDigest('sorted_digest', {
        enabled: true,
        schedule: { preset: 'daily' },
        channels: ['email'],
        grouping: {
          groupBy: 'category',
          sortByCount: true,
        },
      })

      // Add 3 social items
      for (let i = 0; i < 3; i++) {
        await router.send({
          userId: 'user_1',
          channels: ['email'],
          content: { subject: `Social ${i}`, body: 'Content' },
          recipient: { email: 'alice@example.com' },
          category: 'social',
          digest: 'sorted_digest',
        })
      }

      // Add 1 marketing item
      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Marketing', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        category: 'marketing',
        digest: 'sorted_digest',
      })

      const summary = await router.getDigestSummary('user_1', 'sorted_digest')

      // Social should be first (3 items) then marketing (1 item)
      expect(summary!.groups[0].key).toBe('social')
      expect(summary!.groups[0].items).toHaveLength(3)
      expect(summary!.groups[1].key).toBe('marketing')
    })

    it('limits number of groups when maxGroups is set', async () => {
      router.configureDigest('limited_digest', {
        enabled: true,
        schedule: { preset: 'daily' },
        channels: ['email'],
        grouping: {
          groupBy: 'category',
          sortByCount: true,
          maxGroups: 2,
        },
      })

      // Add items in 4 different categories
      const categories = ['cat1', 'cat2', 'cat3', 'cat4']
      for (const cat of categories) {
        await router.send({
          userId: 'user_1',
          channels: ['email'],
          content: { subject: `${cat} item`, body: 'Content' },
          recipient: { email: 'alice@example.com' },
          category: cat,
          digest: 'limited_digest',
        })
      }

      const summary = await router.getDigestSummary('user_1', 'limited_digest')

      // Should only have 2 groups
      expect(summary!.groups).toHaveLength(2)
    })

    it('does not group when groupBy is none', async () => {
      router.configureDigest('ungrouped_digest', {
        enabled: true,
        schedule: { preset: 'daily' },
        channels: ['email'],
        grouping: {
          groupBy: 'none',
        },
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Item 1', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        category: 'cat1',
        digest: 'ungrouped_digest',
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Item 2', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        category: 'cat2',
        digest: 'ungrouped_digest',
      })

      const summary = await router.getDigestSummary('user_1', 'ungrouped_digest')

      // Should have single group with all items
      expect(summary!.groups).toHaveLength(1)
      expect(summary!.groups[0].key).toBe('all')
      expect(summary!.groups[0].items).toHaveLength(2)
    })
  })
})

// ============================================================================
// Summary Template Rendering Tests
// ============================================================================

describe('Summary Template Rendering', () => {
  let router: NotificationRouter
  let emailAdapter: ChannelAdapter

  beforeEach(() => {
    vi.useFakeTimers()
    router = createNotificationRouter()
    emailAdapter = createEmailAdapter()
    router.registerChannel(emailAdapter)
  })

  afterEach(() => {
    router.dispose()
    vi.useRealTimers()
  })

  describe('Default Summary Generation', () => {
    it('generates default subject with item count', async () => {
      router.configureDigest('default_digest', {
        enabled: true,
        schedule: { preset: 'hourly' },
        channels: ['email'],
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Item 1', body: 'Content 1' },
        recipient: { email: 'alice@example.com' },
        digest: 'default_digest',
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Item 2', body: 'Content 2' },
        recipient: { email: 'alice@example.com' },
        digest: 'default_digest',
      })

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

      expect(emailAdapter.send).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('2 notification'),
          isDigest: true,
        }),
        expect.anything()
      )
    })

    it('handles singular notification correctly', async () => {
      router.configureDigest('single_digest', {
        enabled: true,
        schedule: { preset: 'hourly' },
        channels: ['email'],
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Single Item', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        digest: 'single_digest',
      })

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

      expect(emailAdapter.send).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('1 notification'),
        }),
        expect.anything()
      )

      // Should not have 's' for singular
      const call = (emailAdapter.send as any).mock.calls[0]
      expect(call[0].subject).not.toContain('1 notifications')
    })
  })

  describe('Custom Subject Template', () => {
    it('uses custom subject template', async () => {
      router.configureDigest('custom_subject_digest', {
        enabled: true,
        schedule: { preset: 'hourly' },
        channels: ['email'],
        subjectTemplate: 'You have {{count}} new updates!',
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Update', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        digest: 'custom_subject_digest',
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Another Update', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        digest: 'custom_subject_digest',
      })

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

      expect(emailAdapter.send).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'You have 2 new updates!',
        }),
        expect.anything()
      )
    })
  })

  describe('Template with Groups', () => {
    it('renders template with group information', async () => {
      router.registerTemplate({
        id: 'grouped_template',
        name: 'Grouped Digest',
        subject: '{{count}} notifications in {{groupCount}} categories',
        body: '{{#each groups}}{{label}}: {{items.length}} items\n{{/each}}',
        variables: ['count', 'groupCount', 'groups'],
      })

      router.configureDigest('templated_grouped_digest', {
        enabled: true,
        schedule: { preset: 'hourly' },
        channels: ['email'],
        templateId: 'grouped_template',
        grouping: {
          groupBy: 'category',
        },
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Social 1', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        category: 'social',
        digest: 'templated_grouped_digest',
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Marketing 1', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        category: 'marketing',
        digest: 'templated_grouped_digest',
      })

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

      expect(emailAdapter.send).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: '2 notifications in 2 categories',
        }),
        expect.anything()
      )
    })
  })
})

// ============================================================================
// Digest Management Tests
// ============================================================================

describe('Digest Management', () => {
  let router: NotificationRouter
  let emailAdapter: ChannelAdapter

  beforeEach(() => {
    vi.useFakeTimers()
    router = createNotificationRouter()
    emailAdapter = createEmailAdapter()
    router.registerChannel(emailAdapter)
  })

  afterEach(() => {
    router.dispose()
    vi.useRealTimers()
  })

  describe('getDigestConfigs()', () => {
    it('returns all configured digests', () => {
      router.configureDigest('digest_1', {
        enabled: true,
        schedule: { preset: 'daily' },
        channels: ['email'],
      })

      router.configureDigest('digest_2', {
        enabled: true,
        schedule: { preset: 'weekly' },
        channels: ['email'],
      })

      const configs = router.getDigestConfigs()

      expect(configs.size).toBe(2)
      expect(configs.has('digest_1')).toBe(true)
      expect(configs.has('digest_2')).toBe(true)
    })
  })

  describe('getDigestSummary()', () => {
    it('returns summary with grouped items', async () => {
      router.configureDigest('summary_test', {
        enabled: true,
        schedule: { preset: 'daily' },
        channels: ['email'],
        grouping: {
          groupBy: 'category',
        },
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Item 1', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        category: 'updates',
        digest: 'summary_test',
      })

      const summary = await router.getDigestSummary('user_1', 'summary_test')

      expect(summary).toBeDefined()
      expect(summary!.userId).toBe('user_1')
      expect(summary!.digestId).toBe('summary_test')
      expect(summary!.totalItems).toBe(1)
      expect(summary!.groups).toHaveLength(1)
      expect(summary!.generatedAt).toBeInstanceOf(Date)
    })

    it('returns undefined for non-existent digest', async () => {
      const summary = await router.getDigestSummary('user_1', 'non_existent')
      expect(summary).toBeUndefined()
    })
  })

  describe('setDigestSchedule()', () => {
    it('updates user digest schedule preferences', async () => {
      router.configureDigest('reschedulable_digest', {
        enabled: true,
        schedule: { preset: 'daily' },
        channels: ['email'],
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Item', body: 'Content' },
        recipient: { email: 'alice@example.com' },
        digest: 'reschedulable_digest',
      })

      // Change schedule to hourly
      await router.setDigestSchedule('user_1', 'reschedulable_digest', {
        preset: 'hourly',
      })

      const prefs = await router.getPreferences('user_1')
      expect(prefs.digestPreferences?.['reschedulable_digest']?.enabled).toBe(true)
    })
  })

  describe('getPendingDigest()', () => {
    it('returns pending digest items with metadata', async () => {
      router.configureDigest('pending_test', {
        enabled: true,
        schedule: { preset: 'daily' },
        channels: ['email'],
      })

      await router.send({
        userId: 'user_1',
        channels: ['email'],
        content: { subject: 'Item 1', body: 'Body 1' },
        recipient: { email: 'alice@example.com' },
        category: 'updates',
        metadata: { sender: 'System' },
        digest: 'pending_test',
      })

      const pending = await router.getPendingDigest('user_1', 'pending_test')

      expect(pending).toHaveLength(1)
      expect(pending[0].subject).toBe('Item 1')
      expect(pending[0].category).toBe('updates')
      expect(pending[0].sender).toBe('System')
      expect(pending[0].timestamp).toBeInstanceOf(Date)
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Digest Integration', () => {
  let router: NotificationRouter
  let emailAdapter: ChannelAdapter

  beforeEach(() => {
    vi.useFakeTimers()
    router = createNotificationRouter()
    emailAdapter = createEmailAdapter()
    router.registerChannel(emailAdapter)
  })

  afterEach(() => {
    router.dispose()
    vi.useRealTimers()
  })

  describe('Daily Social Media Digest', () => {
    it('aggregates social notifications into daily summary with grouping', async () => {
      vi.setSystemTime(new Date('2024-01-15T09:00:00Z'))

      router.configureDigest('social_daily', {
        enabled: true,
        schedule: { preset: 'daily' },
        channels: ['email'],
        grouping: {
          groupBy: 'sender',
          sortByCount: true,
        },
        subjectTemplate: '{{count}} social updates today',
      })

      // Simulate social activities from different users
      const activities = [
        { sender: 'John', subject: 'John liked your post' },
        { sender: 'Sarah', subject: 'Sarah commented on your photo' },
        { sender: 'John', subject: 'John started following you' },
        { sender: 'Mike', subject: 'Mike shared your story' },
        { sender: 'John', subject: 'John sent you a message' },
      ]

      for (const activity of activities) {
        await router.send({
          userId: 'user_1',
          channels: ['email'],
          content: { subject: activity.subject, body: activity.subject },
          recipient: { email: 'alice@example.com' },
          category: 'social',
          metadata: { sender: activity.sender },
          digest: 'social_daily',
        })
      }

      // Verify pending items
      const summary = await router.getDigestSummary('user_1', 'social_daily')
      expect(summary!.totalItems).toBe(5)

      // John should be first (3 items)
      expect(summary!.groups[0].key).toBe('John')
      expect(summary!.groups[0].items).toHaveLength(3)

      // Advance 24 hours to trigger digest
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)

      expect(emailAdapter.send).toHaveBeenCalledOnce()
      expect(emailAdapter.send).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: '5 social updates today',
          isDigest: true,
        }),
        expect.anything()
      )
    })
  })

  describe('Weekly Marketing Digest', () => {
    it('creates weekly summary with category grouping', async () => {
      router.configureDigest('weekly_marketing', {
        enabled: true,
        schedule: { preset: 'weekly' },
        channels: ['email'],
        grouping: {
          groupBy: 'category',
        },
        minItems: 1,
      })

      // Send various marketing notifications over the week
      const items = [
        { category: 'promotions', subject: 'Flash Sale!' },
        { category: 'newsletter', subject: 'Weekly Newsletter' },
        { category: 'promotions', subject: '20% Off' },
        { category: 'announcements', subject: 'New Feature' },
      ]

      for (const item of items) {
        await router.send({
          userId: 'user_1',
          channels: ['email'],
          content: { subject: item.subject, body: 'Content' },
          recipient: { email: 'alice@example.com' },
          category: item.category,
          digest: 'weekly_marketing',
        })
      }

      const summary = await router.getDigestSummary('user_1', 'weekly_marketing')

      // Should have 3 category groups
      expect(summary!.groups).toHaveLength(3)

      // Promotions should have 2 items
      const promotionsGroup = summary!.groups.find((g) => g.key === 'promotions')
      expect(promotionsGroup?.items).toHaveLength(2)

      // Trigger weekly digest
      await vi.advanceTimersByTimeAsync(7 * 24 * 60 * 60 * 1000)

      expect(emailAdapter.send).toHaveBeenCalledOnce()
    })
  })
})
