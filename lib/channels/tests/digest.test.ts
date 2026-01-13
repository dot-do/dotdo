/**
 * Tests for Notification Digest/Batching System
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  NotificationDigest,
  createDigestCollector,
  createDefaultPreferences,
  InMemoryDigestStorage,
  type DigestNotification,
  type DigestPreferences,
  type DigestStorage,
  type DigestSchedule,
} from '../digest'

describe('NotificationDigest', () => {
  let digest: NotificationDigest

  beforeEach(() => {
    digest = createDigestCollector()
  })

  describe('notification collection', () => {
    it('adds a single notification', async () => {
      await digest.add({
        userId: 'user-1',
        category: 'comments',
        title: 'New comment',
        message: 'Alice commented on your post',
      })

      const pending = await digest.getPending('user-1')
      expect(pending).toHaveLength(1)
      expect(pending[0]).toMatchObject({
        userId: 'user-1',
        category: 'comments',
        title: 'New comment',
        message: 'Alice commented on your post',
      })
    })

    it('adds multiple notifications for the same user', async () => {
      await digest.add({
        userId: 'user-1',
        category: 'comments',
        title: 'Comment 1',
        message: 'First comment',
      })

      await digest.add({
        userId: 'user-1',
        category: 'mentions',
        title: 'Mention',
        message: 'You were mentioned',
      })

      const pending = await digest.getPending('user-1')
      expect(pending).toHaveLength(2)
    })

    it('separates notifications by user', async () => {
      await digest.add({
        userId: 'user-1',
        category: 'comments',
        title: 'Comment for user 1',
        message: 'Message',
      })

      await digest.add({
        userId: 'user-2',
        category: 'comments',
        title: 'Comment for user 2',
        message: 'Message',
      })

      expect(await digest.getPending('user-1')).toHaveLength(1)
      expect(await digest.getPending('user-2')).toHaveLength(1)
    })

    it('adds batch of notifications', async () => {
      await digest.addBatch([
        { userId: 'user-1', category: 'a', title: 'A', message: 'msg' },
        { userId: 'user-1', category: 'b', title: 'B', message: 'msg' },
        { userId: 'user-1', category: 'c', title: 'C', message: 'msg' },
      ])

      expect(await digest.getPendingCount('user-1')).toBe(3)
    })

    it('generates unique IDs for notifications without ID', async () => {
      await digest.add({
        userId: 'user-1',
        category: 'test',
        title: 'Test',
        message: 'Message',
      })

      const pending = await digest.getPending('user-1')
      expect(pending[0].id).toBeDefined()
      expect(pending[0].id).toMatch(/^notif_/)
    })

    it('preserves provided notification IDs', async () => {
      await digest.add({
        id: 'custom-id-123',
        userId: 'user-1',
        category: 'test',
        title: 'Test',
        message: 'Message',
      })

      const pending = await digest.getPending('user-1')
      expect(pending[0].id).toBe('custom-id-123')
    })

    it('adds timestamp if not provided', async () => {
      const before = new Date()
      await digest.add({
        userId: 'user-1',
        category: 'test',
        title: 'Test',
        message: 'Message',
      })
      const after = new Date()

      const pending = await digest.getPending('user-1')
      expect(pending[0].timestamp).toBeDefined()
      expect(pending[0].timestamp!.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(pending[0].timestamp!.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('clears pending notifications for a user', async () => {
      await digest.add({
        userId: 'user-1',
        category: 'test',
        title: 'Test',
        message: 'Message',
      })

      await digest.clearPending('user-1')

      expect(await digest.getPending('user-1')).toHaveLength(0)
    })

    it('respects max batch size', async () => {
      const smallDigest = createDigestCollector({ maxBatchSize: 3 })

      await smallDigest.addBatch([
        { userId: 'user-1', category: 'a', title: 'A1', message: 'oldest' },
        { userId: 'user-1', category: 'a', title: 'A2', message: 'msg' },
        { userId: 'user-1', category: 'a', title: 'A3', message: 'msg' },
        { userId: 'user-1', category: 'a', title: 'A4', message: 'newest' },
      ])

      const pending = await smallDigest.getPending('user-1')
      expect(pending).toHaveLength(3)
      // Oldest should be removed
      expect(pending.find(n => n.title === 'A1')).toBeUndefined()
      expect(pending.find(n => n.title === 'A4')).toBeDefined()
    })
  })

  describe('preference management', () => {
    it('returns default preferences for new user', async () => {
      const prefs = await digest.getPreferences('new-user')

      expect(prefs.enabled).toBe(true)
      expect(prefs.schedule).toBe('daily')
      expect(prefs.format).toBe('html')
      expect(prefs.groupBy).toContain('category')
    })

    it('saves and loads user preferences', async () => {
      await digest.setPreferences('user-1', {
        schedule: 'weekly',
        deliveryHour: 14,
        weeklyDay: 'friday',
        format: 'markdown',
      })

      const prefs = await digest.getPreferences('user-1')
      expect(prefs.schedule).toBe('weekly')
      expect(prefs.deliveryHour).toBe(14)
      expect(prefs.weeklyDay).toBe('friday')
      expect(prefs.format).toBe('markdown')
    })

    it('enables/disables digests for user', async () => {
      await digest.setEnabled('user-1', false)
      let prefs = await digest.getPreferences('user-1')
      expect(prefs.enabled).toBe(false)

      await digest.setEnabled('user-1', true)
      prefs = await digest.getPreferences('user-1')
      expect(prefs.enabled).toBe(true)
    })

    it('sets digest schedule', async () => {
      await digest.setSchedule('user-1', 'weekly', {
        deliveryHour: 10,
        weeklyDay: 'monday',
      })

      const prefs = await digest.getPreferences('user-1')
      expect(prefs.schedule).toBe('weekly')
      expect(prefs.deliveryHour).toBe(10)
      expect(prefs.weeklyDay).toBe('monday')
    })

    it('uses custom default preferences', async () => {
      const customDigest = createDigestCollector({
        defaultSchedule: 'weekly',
        defaultDeliveryHour: 18,
        defaultGroupBy: ['sender', 'priority'],
      })

      const prefs = await customDigest.getPreferences('new-user')
      expect(prefs.schedule).toBe('weekly')
      expect(prefs.deliveryHour).toBe(18)
      expect(prefs.groupBy).toEqual(['sender', 'priority'])
    })
  })

  describe('digest generation', () => {
    beforeEach(async () => {
      // Add sample notifications
      await digest.addBatch([
        {
          userId: 'user-1',
          category: 'comments',
          title: 'Comment from Alice',
          message: 'Great post!',
          sender: 'Alice',
          priority: 'normal',
        },
        {
          userId: 'user-1',
          category: 'comments',
          title: 'Comment from Bob',
          message: 'I agree with this.',
          sender: 'Bob',
          priority: 'normal',
        },
        {
          userId: 'user-1',
          category: 'mentions',
          title: 'Mentioned in project',
          message: 'You were mentioned by Charlie',
          sender: 'Charlie',
          priority: 'high',
        },
        {
          userId: 'user-1',
          category: 'updates',
          title: 'System update',
          message: 'New features available',
          priority: 'low',
        },
      ])
    })

    it('generates digest with correct structure', async () => {
      const output = await digest.generateDigest('user-1')

      expect(output.userId).toBe('user-1')
      expect(output.totalCount).toBe(4)
      expect(output.groups.length).toBeGreaterThan(0)
      expect(output.html).toBeDefined()
      expect(output.text).toBeDefined()
      expect(output.markdown).toBeDefined()
      expect(output.json).toBeDefined()
      expect(output.subject).toBeDefined()
    })

    it('groups notifications by category', async () => {
      const output = await digest.generateDigest('user-1')

      // Should have groups for comments, mentions, updates
      expect(output.groups.length).toBe(3)

      const commentsGroup = output.groups.find(g => g.key === 'comments')
      expect(commentsGroup).toBeDefined()
      expect(commentsGroup!.count).toBe(2)
    })

    it('groups notifications by sender when configured', async () => {
      await digest.setPreferences('user-1', { groupBy: ['sender'] })

      const output = await digest.generateDigest('user-1')

      const aliceGroup = output.groups.find(g => g.key === 'Alice')
      const bobGroup = output.groups.find(g => g.key === 'Bob')
      expect(aliceGroup).toBeDefined()
      expect(bobGroup).toBeDefined()
    })

    it('sorts groups by count descending', async () => {
      const output = await digest.generateDigest('user-1')

      for (let i = 1; i < output.groups.length; i++) {
        expect(output.groups[i - 1].count).toBeGreaterThanOrEqual(output.groups[i].count)
      }
    })

    it('sorts notifications by priority within groups', async () => {
      const output = await digest.generateDigest('user-1')

      const mentionsGroup = output.groups.find(g => g.key === 'mentions')
      if (mentionsGroup && mentionsGroup.notifications.length > 1) {
        // High priority should come before normal
        const priorities = mentionsGroup.notifications.map(n => n.priority || 'normal')
        expect(priorities[0]).toBe('high')
      }
    })

    it('filters by included categories', async () => {
      await digest.setPreferences('user-1', {
        includedCategories: ['comments'],
      })

      const output = await digest.generateDigest('user-1')

      expect(output.totalCount).toBe(2)
      expect(output.groups).toHaveLength(1)
      expect(output.groups[0].key).toBe('comments')
    })

    it('filters by excluded categories', async () => {
      await digest.setPreferences('user-1', {
        excludedCategories: ['updates'],
      })

      const output = await digest.generateDigest('user-1')

      expect(output.totalCount).toBe(3)
      const updateGroup = output.groups.find(g => g.key === 'updates')
      expect(updateGroup).toBeUndefined()
    })

    it('filters by minimum priority', async () => {
      await digest.setPreferences('user-1', {
        minimumPriority: 'high',
      })

      const output = await digest.generateDigest('user-1')

      // Only urgent and high priority should be included
      expect(output.totalCount).toBe(1)
      expect(output.groups[0].notifications[0].priority).toBe('high')
    })

    it('applies max notifications limit', async () => {
      await digest.setPreferences('user-1', {
        maxNotifications: 2,
      })

      const output = await digest.generateDigest('user-1')

      expect(output.totalCount).toBe(2)
    })

    it('generates empty digest when no notifications', async () => {
      const output = await digest.generateDigest('user-with-no-notifications')

      expect(output.totalCount).toBe(0)
      expect(output.groups).toHaveLength(0)
      expect(output.html).toContain('No new notifications')
      expect(output.text).toContain('No new notifications')
    })

    it('generates appropriate subject line', async () => {
      const output = await digest.generateDigest('user-1')

      expect(output.subject).toContain('4 notifications')
    })

    it('generates single notification subject correctly', async () => {
      await digest.clearPending('user-1')
      await digest.add({
        userId: 'user-1',
        category: 'test',
        title: 'Single',
        message: 'Only one',
      })

      const output = await digest.generateDigest('user-1')
      expect(output.subject).toContain('1 notification')
      expect(output.subject).not.toContain('notifications')
    })
  })

  describe('HTML output', () => {
    it('generates valid HTML structure', async () => {
      await digest.add({
        userId: 'user-1',
        category: 'test',
        title: 'Test Notification',
        message: 'Test message content',
      })

      const output = await digest.generateDigest('user-1')

      expect(output.html).toContain('<!DOCTYPE html>')
      expect(output.html).toContain('<html>')
      expect(output.html).toContain('</html>')
      expect(output.html).toContain('Test Notification')
      expect(output.html).toContain('Test message content')
    })

    it('escapes HTML in notification content', async () => {
      await digest.add({
        userId: 'user-1',
        category: 'test',
        title: '<script>alert("xss")</script>',
        message: 'Message with <b>HTML</b>',
      })

      const output = await digest.generateDigest('user-1')

      expect(output.html).not.toContain('<script>')
      expect(output.html).toContain('&lt;script&gt;')
      expect(output.html).toContain('&lt;b&gt;')
    })

    it('includes links when provided', async () => {
      await digest.add({
        userId: 'user-1',
        category: 'test',
        title: 'Linked notification',
        message: 'Click to view',
        link: 'https://example.com/item/123',
      })

      const output = await digest.generateDigest('user-1')

      expect(output.html).toContain('href="https://example.com/item/123"')
    })

    it('shows priority badges for urgent/high', async () => {
      await digest.addBatch([
        {
          userId: 'user-1',
          category: 'test',
          title: 'Urgent',
          message: 'msg',
          priority: 'urgent',
        },
        {
          userId: 'user-1',
          category: 'test',
          title: 'High',
          message: 'msg',
          priority: 'high',
        },
      ])

      const output = await digest.generateDigest('user-1')

      expect(output.html).toContain('[URGENT]')
      expect(output.html).toContain('[High Priority]')
    })

    it('includes sender information when provided', async () => {
      await digest.add({
        userId: 'user-1',
        category: 'test',
        title: 'From sender',
        message: 'Message',
        sender: 'John Doe',
      })

      const output = await digest.generateDigest('user-1')

      expect(output.html).toContain('From John Doe')
    })

    it('includes icon when provided', async () => {
      await digest.add({
        userId: 'user-1',
        category: 'test',
        title: 'With icon',
        message: 'Message',
        iconUrl: 'https://example.com/avatar.png',
      })

      const output = await digest.generateDigest('user-1')

      expect(output.html).toContain('src="https://example.com/avatar.png"')
    })
  })

  describe('text output', () => {
    it('generates readable plain text', async () => {
      await digest.add({
        userId: 'user-1',
        category: 'comments',
        title: 'New Comment',
        message: 'This is the comment content',
        sender: 'Alice',
      })

      const output = await digest.generateDigest('user-1')

      expect(output.text).toContain('NOTIFICATION DIGEST')
      expect(output.text).toContain('COMMENTS')
      expect(output.text).toContain('New Comment')
      expect(output.text).toContain('This is the comment content')
      expect(output.text).toContain('From Alice')
    })

    it('truncates long messages', async () => {
      const longMessage = 'A'.repeat(200)
      await digest.add({
        userId: 'user-1',
        category: 'test',
        title: 'Long message',
        message: longMessage,
      })

      const output = await digest.generateDigest('user-1')

      expect(output.text).toContain('...')
      expect(output.text.length).toBeLessThan(output.text.indexOf(longMessage.substring(0, 50)) + 200)
    })
  })

  describe('markdown output', () => {
    it('generates valid markdown', async () => {
      await digest.add({
        userId: 'user-1',
        category: 'test',
        title: 'Test Title',
        message: 'Test message',
        sender: 'Alice',
        link: 'https://example.com',
      })

      const output = await digest.generateDigest('user-1')

      expect(output.markdown).toContain('# Your Notification Digest')
      expect(output.markdown).toContain('## Test (1)')
      expect(output.markdown).toContain('[Test Title](https://example.com)')
      expect(output.markdown).toContain('From **Alice**')
    })

    it('marks urgent items with bold', async () => {
      await digest.add({
        userId: 'user-1',
        category: 'test',
        title: 'Urgent item',
        message: 'msg',
        priority: 'urgent',
      })

      const output = await digest.generateDigest('user-1')

      expect(output.markdown).toContain('**[URGENT]**')
    })
  })

  describe('JSON output', () => {
    it('generates structured JSON data', async () => {
      await digest.add({
        userId: 'user-1',
        category: 'test',
        title: 'Test',
        message: 'Message',
        sender: 'Alice',
        priority: 'high',
      })

      const output = await digest.generateDigest('user-1')

      expect(output.json.userId).toBe('user-1')
      expect(output.json.totalCount).toBe(1)
      expect(output.json.groups).toHaveLength(1)
      expect(output.json.groups[0].notifications[0]).toMatchObject({
        title: 'Test',
        message: 'Message',
        sender: 'Alice',
        priority: 'high',
      })
      expect(output.json.periodStart).toBeDefined()
      expect(output.json.periodEnd).toBeDefined()
    })
  })

  describe('schedule management', () => {
    it('checks if user is due for digest', async () => {
      // First time should be due if past delivery hour
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))

      const isDue = await digest.isDueForDigest('user-1')
      expect(isDue).toBe(true)

      vi.useRealTimers()
    })

    it('respects enabled preference', async () => {
      await digest.setEnabled('user-1', false)

      const isDue = await digest.isDueForDigest('user-1')
      expect(isDue).toBe(false)
    })

    it('records and checks last digest sent time', async () => {
      const storage = new InMemoryDigestStorage()
      const digestWithStorage = createDigestCollector({ storage })

      await storage.savePreferences('user-1', createDefaultPreferences())

      // Record digest sent
      await digestWithStorage.recordDigestSent('user-1')

      // Check last sent
      const lastSent = await storage.getLastDigestSent('user-1')
      expect(lastSent).toBeDefined()
      expect(lastSent!.getTime()).toBeLessThanOrEqual(Date.now())
    })

    it('calculates period start for daily schedule', async () => {
      await digest.setPreferences('user-1', { schedule: 'daily' })

      const now = new Date('2024-01-15T10:00:00Z')
      const output = await digest.generateDigest('user-1', { until: now })

      const expectedStart = new Date('2024-01-14T10:00:00Z')
      expect(output.periodStart.getTime()).toBe(expectedStart.getTime())
    })

    it('calculates period start for weekly schedule', async () => {
      await digest.setPreferences('user-1', { schedule: 'weekly' })

      const now = new Date('2024-01-15T10:00:00Z')
      const output = await digest.generateDigest('user-1', { until: now })

      const expectedStart = new Date('2024-01-08T10:00:00Z')
      expect(output.periodStart.getTime()).toBe(expectedStart.getTime())
    })
  })

  describe('storage integration', () => {
    it('persists notifications to storage', async () => {
      const storage = new InMemoryDigestStorage()
      const digestWithStorage = createDigestCollector({ storage })

      await digestWithStorage.add({
        userId: 'user-1',
        category: 'test',
        title: 'Test',
        message: 'Message',
      })

      await digestWithStorage.persist()

      const persisted = await storage.loadNotifications('user-1')
      expect(persisted).toHaveLength(1)
    })

    it('combines in-memory and persisted notifications', async () => {
      const storage = new InMemoryDigestStorage()

      // Pre-persist some notifications
      await storage.saveNotifications('user-1', [
        {
          id: 'old-1',
          userId: 'user-1',
          category: 'test',
          title: 'Old',
          message: 'From storage',
          timestamp: new Date(),
        },
      ])

      const digestWithStorage = createDigestCollector({ storage })

      // Add new notification in-memory
      await digestWithStorage.add({
        userId: 'user-1',
        category: 'test',
        title: 'New',
        message: 'In memory',
      })

      const pending = await digestWithStorage.getPending('user-1')
      expect(pending).toHaveLength(2)
    })

    it('clears both in-memory and persisted notifications', async () => {
      const storage = new InMemoryDigestStorage()

      await storage.saveNotifications('user-1', [
        {
          id: 'old-1',
          userId: 'user-1',
          category: 'test',
          title: 'Old',
          message: 'msg',
          timestamp: new Date(),
        },
      ])

      const digestWithStorage = createDigestCollector({ storage })

      await digestWithStorage.add({
        userId: 'user-1',
        category: 'test',
        title: 'New',
        message: 'msg',
      })

      await digestWithStorage.clearPending('user-1')

      expect(await digestWithStorage.getPending('user-1')).toHaveLength(0)
    })

    it('gets users with pending notifications', async () => {
      const storage = new InMemoryDigestStorage()
      const digestWithStorage = createDigestCollector({ storage })

      await digestWithStorage.add({
        userId: 'user-1',
        category: 'test',
        title: 'Test',
        message: 'msg',
      })

      await digestWithStorage.add({
        userId: 'user-2',
        category: 'test',
        title: 'Test',
        message: 'msg',
      })

      // Persist to make visible to storage.getUsersWithPendingNotifications
      await digestWithStorage.persist()

      const users = await storage.getUsersWithPendingNotifications()
      expect(users).toContain('user-1')
      expect(users).toContain('user-2')
    })
  })

  describe('statistics', () => {
    it('tracks batched notification stats', async () => {
      await digest.addBatch([
        { userId: 'user-1', category: 'a', title: 'A', message: 'msg' },
        { userId: 'user-1', category: 'b', title: 'B', message: 'msg' },
        { userId: 'user-2', category: 'a', title: 'A', message: 'msg' },
      ])

      const stats = digest.getStats()

      expect(stats.totalBatched).toBe(3)
      expect(stats.byUser['user-1']).toBe(2)
      expect(stats.byUser['user-2']).toBe(1)
      expect(stats.byCategory['a']).toBe(2)
      expect(stats.byCategory['b']).toBe(1)
    })

    it('tracks generated digest stats', async () => {
      await digest.add({
        userId: 'user-1',
        category: 'test',
        title: 'Test',
        message: 'msg',
      })

      await digest.generateDigest('user-1')
      await digest.generateDigest('user-1')

      const stats = digest.getStats()
      expect(stats.digestsGenerated).toBe(2)
    })

    it('resets statistics', async () => {
      await digest.add({
        userId: 'user-1',
        category: 'test',
        title: 'Test',
        message: 'msg',
      })

      digest.resetStats()

      const stats = digest.getStats()
      expect(stats.totalBatched).toBe(0)
      expect(stats.digestsGenerated).toBe(0)
    })
  })

  describe('edge cases', () => {
    it('handles notifications with all optional fields', async () => {
      await digest.add({
        id: 'custom-id',
        userId: 'user-1',
        category: 'complete',
        title: 'Complete notification',
        message: 'Full message content',
        sender: 'Test Sender',
        entity: 'Project X',
        entityType: 'project',
        link: 'https://example.com/project/x',
        timestamp: new Date('2024-01-15T10:00:00Z'),
        priority: 'urgent',
        metadata: { custom: 'data' },
        iconUrl: 'https://example.com/icon.png',
      })

      const output = await digest.generateDigest('user-1')

      expect(output.html).toContain('Complete notification')
      expect(output.html).toContain('[URGENT]')
      expect(output.html).toContain('Test Sender')
      expect(output.html).toContain('https://example.com/project/x')
    })

    it('handles empty groupBy configuration', async () => {
      await digest.setPreferences('user-1', { groupBy: [] })
      await digest.add({
        userId: 'user-1',
        category: 'test',
        title: 'Test',
        message: 'msg',
      })

      const output = await digest.generateDigest('user-1')

      expect(output.groups).toHaveLength(1)
      expect(output.groups[0].label).toBe('All Notifications')
    })

    it('handles category labels with underscores and dashes', async () => {
      await digest.add({
        userId: 'user-1',
        category: 'user_comments',
        title: 'Test',
        message: 'msg',
      })

      await digest.add({
        userId: 'user-1',
        category: 'system-updates',
        title: 'Test2',
        message: 'msg',
      })

      const output = await digest.generateDigest('user-1')

      const labels = output.groups.map(g => g.label)
      expect(labels).toContain('User Comments')
      expect(labels).toContain('System Updates')
    })

    it('handles unknown sender/entity values', async () => {
      await digest.setPreferences('user-1', { groupBy: ['sender'] })
      await digest.add({
        userId: 'user-1',
        category: 'test',
        title: 'Test',
        message: 'msg',
        // No sender
      })

      const output = await digest.generateDigest('user-1')

      expect(output.groups[0].label).toBe('Others')
    })
  })
})

describe('InMemoryDigestStorage', () => {
  let storage: InMemoryDigestStorage

  beforeEach(() => {
    storage = new InMemoryDigestStorage()
  })

  it('saves and loads notifications', async () => {
    const notifications: DigestNotification[] = [
      {
        id: '1',
        userId: 'user-1',
        category: 'test',
        title: 'Test',
        message: 'msg',
        timestamp: new Date(),
      },
    ]

    await storage.saveNotifications('user-1', notifications)
    const loaded = await storage.loadNotifications('user-1')

    expect(loaded).toEqual(notifications)
  })

  it('returns empty array for non-existent user', async () => {
    const loaded = await storage.loadNotifications('non-existent')
    expect(loaded).toEqual([])
  })

  it('clears notifications', async () => {
    await storage.saveNotifications('user-1', [
      {
        id: '1',
        userId: 'user-1',
        category: 'test',
        title: 'Test',
        message: 'msg',
        timestamp: new Date(),
      },
    ])

    await storage.clearNotifications('user-1')

    const loaded = await storage.loadNotifications('user-1')
    expect(loaded).toEqual([])
  })

  it('saves and loads preferences', async () => {
    const prefs: DigestPreferences = {
      enabled: true,
      schedule: 'weekly',
      deliveryHour: 14,
      weeklyDay: 'friday',
      format: 'markdown',
      includedCategories: ['a', 'b'],
      excludedCategories: [],
      groupBy: ['sender'],
    }

    await storage.savePreferences('user-1', prefs)
    const loaded = await storage.loadPreferences('user-1')

    expect(loaded).toEqual(prefs)
  })

  it('returns null for non-existent preferences', async () => {
    const loaded = await storage.loadPreferences('non-existent')
    expect(loaded).toBeNull()
  })

  it('tracks users with pending notifications', async () => {
    await storage.saveNotifications('user-1', [
      { id: '1', userId: 'user-1', category: 'a', title: 'A', message: 'm', timestamp: new Date() },
    ])
    await storage.saveNotifications('user-2', [
      { id: '2', userId: 'user-2', category: 'b', title: 'B', message: 'm', timestamp: new Date() },
    ])
    await storage.saveNotifications('user-3', [])

    const users = await storage.getUsersWithPendingNotifications()

    expect(users).toContain('user-1')
    expect(users).toContain('user-2')
    expect(users).not.toContain('user-3')
  })

  it('records and retrieves last digest sent time', async () => {
    const timestamp = new Date('2024-01-15T10:00:00Z')
    await storage.recordDigestSent('user-1', timestamp)

    const lastSent = await storage.getLastDigestSent('user-1')
    expect(lastSent).toEqual(timestamp)
  })

  it('returns null for never-sent digest', async () => {
    const lastSent = await storage.getLastDigestSent('new-user')
    expect(lastSent).toBeNull()
  })

  it('clears all data', () => {
    storage.saveNotifications('user-1', [
      { id: '1', userId: 'user-1', category: 'a', title: 'A', message: 'm', timestamp: new Date() },
    ])
    storage.savePreferences('user-1', createDefaultPreferences())
    storage.recordDigestSent('user-1', new Date())

    storage.clear()

    expect(storage.loadNotifications('user-1')).resolves.toEqual([])
    expect(storage.loadPreferences('user-1')).resolves.toBeNull()
    expect(storage.getLastDigestSent('user-1')).resolves.toBeNull()
  })
})

describe('createDefaultPreferences', () => {
  it('returns default preferences', () => {
    const prefs = createDefaultPreferences()

    expect(prefs.enabled).toBe(true)
    expect(prefs.schedule).toBe('daily')
    expect(prefs.deliveryHour).toBe(9)
    expect(prefs.format).toBe('html')
    expect(prefs.groupBy).toContain('category')
  })

  it('allows overrides', () => {
    const prefs = createDefaultPreferences({
      schedule: 'weekly',
      deliveryHour: 18,
      weeklyDay: 'friday',
    })

    expect(prefs.schedule).toBe('weekly')
    expect(prefs.deliveryHour).toBe(18)
    expect(prefs.weeklyDay).toBe('friday')
    expect(prefs.enabled).toBe(true) // Default preserved
  })
})
