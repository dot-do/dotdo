/**
 * NotificationRouter Tests
 *
 * RED phase: These tests define the expected behavior of NotificationRouter.
 * All tests should FAIL until implementation is complete.
 *
 * NotificationRouter provides multi-channel notification delivery:
 * - Channels: email, SMS, push, in-app, webhook
 * - Routing: user preferences, fallback chains, priority
 * - Templates: per-channel templates with variable substitution
 * - Delivery: batching, rate limiting, retry logic
 * - Tracking: delivery status, opens, clicks
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  NotificationRouter,
  createNotificationRouter,
  type NotificationRouterOptions,
  type ChannelAdapter,
  type Notification,
  type NotificationResult,
  type DeliveryStatus,
  type UserPreferences,
  type ChannelPreferences,
  type Template,
  type TemplateContent,
  type BatchResult,
} from './index'

// ============================================================================
// TEST HELPERS
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createMockEmailAdapter(): ChannelAdapter & { sent: unknown[] } {
  const sent: unknown[] = []
  return {
    name: 'email',
    sent,
    send: async (notification) => {
      sent.push(notification)
      return { success: true, messageId: `email_${Date.now()}` }
    },
  }
}

function createMockSmsAdapter(): ChannelAdapter & { sent: unknown[] } {
  const sent: unknown[] = []
  return {
    name: 'sms',
    sent,
    send: async (notification) => {
      sent.push(notification)
      return { success: true, messageId: `sms_${Date.now()}` }
    },
  }
}

function createMockPushAdapter(): ChannelAdapter & { sent: unknown[] } {
  const sent: unknown[] = []
  return {
    name: 'push',
    sent,
    send: async (notification) => {
      sent.push(notification)
      return { success: true, messageId: `push_${Date.now()}` }
    },
  }
}

function createMockInAppAdapter(): ChannelAdapter & { sent: unknown[] } {
  const sent: unknown[] = []
  return {
    name: 'in-app',
    sent,
    send: async (notification) => {
      sent.push(notification)
      return { success: true, messageId: `inapp_${Date.now()}` }
    },
  }
}

function createMockWebhookAdapter(): ChannelAdapter & { sent: unknown[] } {
  const sent: unknown[] = []
  return {
    name: 'webhook',
    sent,
    send: async (notification) => {
      sent.push(notification)
      return { success: true, messageId: `webhook_${Date.now()}` }
    },
  }
}

// ============================================================================
// NOTIFICATION ROUTER - CREATION AND CONFIGURATION
// ============================================================================

describe('NotificationRouter', () => {
  describe('creation', () => {
    it('should create with minimal options', () => {
      const router = createNotificationRouter()
      expect(router).toBeDefined()
      expect(router).toBeInstanceOf(NotificationRouter)
    })

    it('should create with all options', () => {
      const router = createNotificationRouter({
        defaultChannel: 'email',
        maxRetries: 3,
        retryDelay: 1000,
        batchSize: 100,
        batchInterval: 5000,
      })
      expect(router.options.defaultChannel).toBe('email')
      expect(router.options.maxRetries).toBe(3)
      expect(router.options.retryDelay).toBe(1000)
      expect(router.options.batchSize).toBe(100)
      expect(router.options.batchInterval).toBe(5000)
    })

    it('should use defaults for optional fields', () => {
      const router = createNotificationRouter()
      expect(router.options.maxRetries).toBe(3)
      expect(router.options.retryDelay).toBe(1000)
      expect(router.options.batchSize).toBe(50)
      expect(router.options.batchInterval).toBe(10000)
    })
  })

  describe('class instantiation', () => {
    it('should work with new keyword', () => {
      const router = new NotificationRouter()
      expect(router).toBeInstanceOf(NotificationRouter)
    })
  })
})

// ============================================================================
// CHANNEL REGISTRATION
// ============================================================================

describe('Channel Registration', () => {
  let router: NotificationRouter

  beforeEach(() => {
    router = createNotificationRouter()
  })

  afterEach(async () => {
    await router.close()
  })

  describe('registerChannel', () => {
    it('should register a channel adapter', () => {
      const emailAdapter = createMockEmailAdapter()
      router.registerChannel('email', emailAdapter)
      expect(router.hasChannel('email')).toBe(true)
    })

    it('should register multiple channel adapters', () => {
      router.registerChannel('email', createMockEmailAdapter())
      router.registerChannel('sms', createMockSmsAdapter())
      router.registerChannel('push', createMockPushAdapter())

      expect(router.hasChannel('email')).toBe(true)
      expect(router.hasChannel('sms')).toBe(true)
      expect(router.hasChannel('push')).toBe(true)
    })

    it('should override existing channel adapter', () => {
      const adapter1 = createMockEmailAdapter()
      const adapter2 = createMockEmailAdapter()

      router.registerChannel('email', adapter1)
      router.registerChannel('email', adapter2)

      expect(router.getChannel('email')).toBe(adapter2)
    })

    it('should return registered channel names', () => {
      router.registerChannel('email', createMockEmailAdapter())
      router.registerChannel('sms', createMockSmsAdapter())

      const channels = router.getChannels()
      expect(channels).toContain('email')
      expect(channels).toContain('sms')
      expect(channels).toHaveLength(2)
    })
  })

  describe('unregisterChannel', () => {
    it('should unregister a channel', () => {
      router.registerChannel('email', createMockEmailAdapter())
      expect(router.hasChannel('email')).toBe(true)

      router.unregisterChannel('email')
      expect(router.hasChannel('email')).toBe(false)
    })

    it('should not throw when unregistering non-existent channel', () => {
      expect(() => router.unregisterChannel('nonexistent')).not.toThrow()
    })
  })
})

// ============================================================================
// TEMPLATE REGISTRATION
// ============================================================================

describe('Template Registration', () => {
  let router: NotificationRouter

  beforeEach(() => {
    router = createNotificationRouter()
  })

  afterEach(async () => {
    await router.close()
  })

  describe('registerTemplate', () => {
    it('should register a template with single channel', () => {
      router.registerTemplate('welcome', {
        email: {
          subject: 'Welcome {{name}}!',
          body: 'Hello {{name}}, welcome to our platform!',
        },
      })

      expect(router.hasTemplate('welcome')).toBe(true)
    })

    it('should register a template with multiple channels', () => {
      router.registerTemplate('order_confirmation', {
        email: {
          subject: 'Order {{orderNumber}} confirmed',
          body: 'Your order {{orderNumber}} for {{total}} has been confirmed.',
        },
        sms: {
          body: 'Order {{orderNumber}} confirmed. Total: {{total}}',
        },
        push: {
          title: 'Order Confirmed',
          body: 'Order {{orderNumber}} - {{total}}',
        },
      })

      const template = router.getTemplate('order_confirmation')
      expect(template?.email).toBeDefined()
      expect(template?.sms).toBeDefined()
      expect(template?.push).toBeDefined()
    })

    it('should support HTML and plain text body', () => {
      router.registerTemplate('newsletter', {
        email: {
          subject: 'Weekly Newsletter',
          body: 'Plain text version',
          html: '<h1>Weekly Newsletter</h1><p>HTML version</p>',
        },
      })

      const template = router.getTemplate('newsletter')
      expect(template?.email?.body).toBe('Plain text version')
      expect(template?.email?.html).toContain('<h1>')
    })
  })

  describe('template variable substitution', () => {
    it('should substitute simple variables', () => {
      router.registerTemplate('greeting', {
        email: {
          subject: 'Hello {{name}}',
          body: 'Welcome, {{name}}!',
        },
      })

      const rendered = router.renderTemplate('greeting', 'email', {
        name: 'John',
      })

      expect(rendered.subject).toBe('Hello John')
      expect(rendered.body).toBe('Welcome, John!')
    })

    it('should substitute nested variables', () => {
      router.registerTemplate('order', {
        email: {
          subject: 'Order for {{customer.name}}',
          body: 'Shipping to {{customer.address.city}}, {{customer.address.country}}',
        },
      })

      const rendered = router.renderTemplate('order', 'email', {
        customer: {
          name: 'John Doe',
          address: {
            city: 'New York',
            country: 'USA',
          },
        },
      })

      expect(rendered.subject).toBe('Order for John Doe')
      expect(rendered.body).toContain('New York')
      expect(rendered.body).toContain('USA')
    })

    it('should handle missing variables gracefully', () => {
      router.registerTemplate('test', {
        email: {
          subject: 'Hello {{name}}',
          body: 'Your code is {{code}}',
        },
      })

      const rendered = router.renderTemplate('test', 'email', {
        name: 'John',
        // code is missing
      })

      expect(rendered.subject).toBe('Hello John')
      expect(rendered.body).toBe('Your code is ')
    })

    it('should support conditional blocks', () => {
      router.registerTemplate('conditional', {
        email: {
          subject: 'Status Update',
          body: '{{#if premium}}Premium features enabled{{else}}Upgrade to premium{{/if}}',
        },
      })

      const premiumRendered = router.renderTemplate('conditional', 'email', {
        premium: true,
      })
      expect(premiumRendered.body).toBe('Premium features enabled')

      const freeRendered = router.renderTemplate('conditional', 'email', {
        premium: false,
      })
      expect(freeRendered.body).toBe('Upgrade to premium')
    })

    it('should support loops', () => {
      router.registerTemplate('items', {
        email: {
          subject: 'Your Items',
          body: '{{#each items}}{{name}}: {{price}}\n{{/each}}',
        },
      })

      const rendered = router.renderTemplate('items', 'email', {
        items: [
          { name: 'Item 1', price: '$10' },
          { name: 'Item 2', price: '$20' },
        ],
      })

      expect(rendered.body).toContain('Item 1: $10')
      expect(rendered.body).toContain('Item 2: $20')
    })
  })
})

// ============================================================================
// SENDING NOTIFICATIONS
// ============================================================================

describe('Sending Notifications', () => {
  let router: NotificationRouter
  let emailAdapter: ChannelAdapter & { sent: unknown[] }
  let smsAdapter: ChannelAdapter & { sent: unknown[] }
  let pushAdapter: ChannelAdapter & { sent: unknown[] }

  beforeEach(() => {
    router = createNotificationRouter()
    emailAdapter = createMockEmailAdapter()
    smsAdapter = createMockSmsAdapter()
    pushAdapter = createMockPushAdapter()

    router.registerChannel('email', emailAdapter)
    router.registerChannel('sms', smsAdapter)
    router.registerChannel('push', pushAdapter)

    router.registerTemplate('test', {
      email: { subject: 'Test - {{title}}', body: '{{message}}' },
      sms: { body: '{{title}}: {{message}}' },
      push: { title: '{{title}}', body: '{{message}}' },
    })
  })

  afterEach(async () => {
    await router.close()
  })

  describe('send()', () => {
    it('should send notification to specified channel', async () => {
      const result = await router.send({
        userId: 'user_123',
        template: 'test',
        data: { title: 'Hello', message: 'World' },
        channels: ['email'],
      })

      expect(result.success).toBe(true)
      expect(emailAdapter.sent).toHaveLength(1)
      expect(smsAdapter.sent).toHaveLength(0)
    })

    it('should send notification to multiple channels', async () => {
      const result = await router.send({
        userId: 'user_123',
        template: 'test',
        data: { title: 'Hello', message: 'World' },
        channels: ['email', 'push'],
      })

      expect(result.success).toBe(true)
      expect(emailAdapter.sent).toHaveLength(1)
      expect(pushAdapter.sent).toHaveLength(1)
    })

    it('should use default channel when none specified', async () => {
      const router2 = createNotificationRouter({ defaultChannel: 'email' })
      router2.registerChannel('email', emailAdapter)
      router2.registerTemplate('test', {
        email: { subject: 'Test', body: 'Body' },
      })

      await router2.send({
        userId: 'user_123',
        template: 'test',
        data: {},
      })

      expect(emailAdapter.sent).toHaveLength(1)
      await router2.close()
    })

    it('should return notification ID', async () => {
      const result = await router.send({
        userId: 'user_123',
        template: 'test',
        data: { title: 'Hello', message: 'World' },
        channels: ['email'],
      })

      expect(result.notificationId).toBeDefined()
      expect(typeof result.notificationId).toBe('string')
    })

    it('should include channel results', async () => {
      const result = await router.send({
        userId: 'user_123',
        template: 'test',
        data: { title: 'Hello', message: 'World' },
        channels: ['email', 'sms'],
      })

      expect(result.channels.email?.success).toBe(true)
      expect(result.channels.email?.messageId).toBeDefined()
      expect(result.channels.sms?.success).toBe(true)
    })

    it('should throw when template not found', async () => {
      await expect(
        router.send({
          userId: 'user_123',
          template: 'nonexistent',
          data: {},
          channels: ['email'],
        })
      ).rejects.toThrow('Template not found: nonexistent')
    })

    it('should throw when channel not registered', async () => {
      await expect(
        router.send({
          userId: 'user_123',
          template: 'test',
          data: {},
          channels: ['slack'], // Not registered
        })
      ).rejects.toThrow('Channel not registered: slack')
    })

    it('should support inline content without template', async () => {
      const result = await router.send({
        userId: 'user_123',
        content: {
          email: {
            subject: 'Direct Subject',
            body: 'Direct body content',
          },
        },
        channels: ['email'],
      })

      expect(result.success).toBe(true)
      expect(emailAdapter.sent[0]).toMatchObject({
        subject: 'Direct Subject',
        body: 'Direct body content',
      })
    })
  })

  describe('priority levels', () => {
    it('should set priority on notification', async () => {
      await router.send({
        userId: 'user_123',
        template: 'test',
        data: { title: 'Urgent', message: 'Alert!' },
        channels: ['email'],
        priority: 'high',
      })

      expect(emailAdapter.sent[0]).toMatchObject({
        priority: 'high',
      })
    })

    it('should default to normal priority', async () => {
      await router.send({
        userId: 'user_123',
        template: 'test',
        data: { title: 'Normal', message: 'Message' },
        channels: ['email'],
      })

      expect(emailAdapter.sent[0]).toMatchObject({
        priority: 'normal',
      })
    })

    it('should support low, normal, high, critical priorities', async () => {
      for (const priority of ['low', 'normal', 'high', 'critical'] as const) {
        await router.send({
          userId: 'user_123',
          template: 'test',
          data: { title: 'Test', message: 'Test' },
          channels: ['email'],
          priority,
        })
      }

      expect(emailAdapter.sent).toHaveLength(4)
    })
  })
})

// ============================================================================
// USER PREFERENCES
// ============================================================================

describe('User Preferences', () => {
  let router: NotificationRouter
  let emailAdapter: ChannelAdapter & { sent: unknown[] }
  let smsAdapter: ChannelAdapter & { sent: unknown[] }
  let pushAdapter: ChannelAdapter & { sent: unknown[] }

  beforeEach(() => {
    router = createNotificationRouter()
    emailAdapter = createMockEmailAdapter()
    smsAdapter = createMockSmsAdapter()
    pushAdapter = createMockPushAdapter()

    router.registerChannel('email', emailAdapter)
    router.registerChannel('sms', smsAdapter)
    router.registerChannel('push', pushAdapter)

    router.registerTemplate('marketing', {
      email: { subject: 'Promo', body: 'Check out our deals!' },
      sms: { body: 'Promo: Check our deals!' },
    })

    router.registerTemplate('security', {
      email: { subject: 'Security Alert', body: 'Your account...' },
      sms: { body: 'Security Alert: Your account...' },
    })
  })

  afterEach(async () => {
    await router.close()
  })

  describe('setPreferences', () => {
    it('should set user preferences', async () => {
      await router.setPreferences('user_123', {
        email: { enabled: true },
        sms: { enabled: false },
        push: { enabled: true },
      })

      const prefs = router.getPreferences('user_123')
      expect(prefs?.email?.enabled).toBe(true)
      expect(prefs?.sms?.enabled).toBe(false)
      expect(prefs?.push?.enabled).toBe(true)
    })

    it('should update existing preferences', async () => {
      await router.setPreferences('user_123', {
        email: { enabled: true },
      })

      await router.setPreferences('user_123', {
        email: { enabled: false },
        sms: { enabled: true },
      })

      const prefs = router.getPreferences('user_123')
      expect(prefs?.email?.enabled).toBe(false)
      expect(prefs?.sms?.enabled).toBe(true)
    })

    it('should support digest preferences', async () => {
      await router.setPreferences('user_123', {
        email: {
          enabled: true,
          digest: 'daily',
        },
      })

      const prefs = router.getPreferences('user_123')
      expect(prefs?.email?.digest).toBe('daily')
    })

    it('should support quiet hours', async () => {
      await router.setPreferences('user_123', {
        push: {
          enabled: true,
          quietHours: {
            start: '22:00',
            end: '08:00',
            timezone: 'America/New_York',
          },
        },
      })

      const prefs = router.getPreferences('user_123')
      expect(prefs?.push?.quietHours?.start).toBe('22:00')
      expect(prefs?.push?.quietHours?.end).toBe('08:00')
    })
  })

  describe('preference enforcement', () => {
    it('should skip disabled channels', async () => {
      await router.setPreferences('user_123', {
        email: { enabled: true },
        sms: { enabled: false },
      })

      await router.send({
        userId: 'user_123',
        template: 'marketing',
        data: {},
        channels: ['email', 'sms'],
      })

      expect(emailAdapter.sent).toHaveLength(1)
      expect(smsAdapter.sent).toHaveLength(0) // Disabled
    })

    it('should respect quiet hours', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-01-15T23:00:00-05:00')) // 11 PM EST

      await router.setPreferences('user_123', {
        push: {
          enabled: true,
          quietHours: {
            start: '22:00',
            end: '08:00',
            timezone: 'America/New_York',
          },
        },
      })

      router.registerTemplate('alert', {
        push: { title: 'Alert', body: 'Test' },
      })

      const result = await router.send({
        userId: 'user_123',
        template: 'alert',
        data: {},
        channels: ['push'],
      })

      expect(result.channels.push?.skipped).toBe(true)
      expect(result.channels.push?.reason).toBe('quiet_hours')

      vi.useRealTimers()
    })

    it('should bypass quiet hours for high priority', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-01-15T23:00:00-05:00'))

      await router.setPreferences('user_123', {
        push: {
          enabled: true,
          quietHours: {
            start: '22:00',
            end: '08:00',
            timezone: 'America/New_York',
          },
        },
      })

      router.registerTemplate('urgent', {
        push: { title: 'Urgent', body: 'Critical alert!' },
      })

      await router.send({
        userId: 'user_123',
        template: 'urgent',
        data: {},
        channels: ['push'],
        priority: 'critical',
      })

      expect(pushAdapter.sent).toHaveLength(1)

      vi.useRealTimers()
    })

    it('should support category-based preferences', async () => {
      await router.setPreferences('user_123', {
        email: {
          enabled: true,
          categories: {
            marketing: false,
            security: true,
          },
        },
      })

      // Marketing should be skipped
      await router.send({
        userId: 'user_123',
        template: 'marketing',
        data: {},
        channels: ['email'],
        category: 'marketing',
      })
      expect(emailAdapter.sent).toHaveLength(0)

      // Security should be sent
      await router.send({
        userId: 'user_123',
        template: 'security',
        data: {},
        channels: ['email'],
        category: 'security',
      })
      expect(emailAdapter.sent).toHaveLength(1)
    })
  })
})

// ============================================================================
// FALLBACK CHAINS
// ============================================================================

describe('Fallback Chains', () => {
  let router: NotificationRouter
  let emailAdapter: ChannelAdapter & { sent: unknown[] }
  let smsAdapter: ChannelAdapter & { sent: unknown[] }
  let pushAdapter: ChannelAdapter & { sent: unknown[] }

  beforeEach(() => {
    router = createNotificationRouter()
    emailAdapter = createMockEmailAdapter()
    smsAdapter = createMockSmsAdapter()
    pushAdapter = createMockPushAdapter()

    router.registerTemplate('alert', {
      email: { subject: 'Alert', body: 'Important alert!' },
      sms: { body: 'Important alert!' },
      push: { title: 'Alert', body: 'Important alert!' },
    })
  })

  afterEach(async () => {
    await router.close()
  })

  it('should try fallback channel when primary fails', async () => {
    const failingEmail: ChannelAdapter = {
      name: 'email',
      send: async () => {
        throw new Error('Email service unavailable')
      },
    }

    router.registerChannel('email', failingEmail)
    router.registerChannel('sms', smsAdapter)

    const result = await router.send({
      userId: 'user_123',
      template: 'alert',
      data: {},
      channels: ['email', 'sms'], // Try email first, fallback to SMS
      fallbackOnFailure: true,
    })

    expect(result.success).toBe(true)
    expect(result.channels.email?.success).toBe(false)
    expect(result.channels.sms?.success).toBe(true)
    expect(smsAdapter.sent).toHaveLength(1)
  })

  it('should not fallback when fallbackOnFailure is false', async () => {
    const failingEmail: ChannelAdapter = {
      name: 'email',
      send: async () => {
        throw new Error('Email service unavailable')
      },
    }

    router.registerChannel('email', failingEmail)
    router.registerChannel('sms', smsAdapter)

    const result = await router.send({
      userId: 'user_123',
      template: 'alert',
      data: {},
      channels: ['email', 'sms'],
      fallbackOnFailure: false,
    })

    // Both channels attempted independently
    expect(result.channels.email?.success).toBe(false)
    expect(result.channels.sms?.success).toBe(true)
  })

  it('should stop on first successful delivery in fallback mode', async () => {
    router.registerChannel('email', emailAdapter)
    router.registerChannel('sms', smsAdapter)

    await router.send({
      userId: 'user_123',
      template: 'alert',
      data: {},
      channels: ['email', 'sms'],
      fallbackOnFailure: true,
    })

    // Email succeeded, so SMS not attempted
    expect(emailAdapter.sent).toHaveLength(1)
    expect(smsAdapter.sent).toHaveLength(0)
  })
})

// ============================================================================
// BATCH SENDING
// ============================================================================

describe('Batch Sending', () => {
  let router: NotificationRouter
  let emailAdapter: ChannelAdapter & { sent: unknown[] }

  beforeEach(() => {
    router = createNotificationRouter({
      batchSize: 10,
      batchInterval: 1000,
    })
    emailAdapter = createMockEmailAdapter()
    router.registerChannel('email', emailAdapter)
    router.registerTemplate('digest', {
      email: { subject: 'Weekly Digest', body: 'Your weekly update' },
    })
  })

  afterEach(async () => {
    await router.close()
  })

  describe('sendBatch()', () => {
    it('should send to multiple users', async () => {
      const results = await router.sendBatch([
        { userId: 'user_1', template: 'digest', data: {}, channels: ['email'] },
        { userId: 'user_2', template: 'digest', data: {}, channels: ['email'] },
        { userId: 'user_3', template: 'digest', data: {}, channels: ['email'] },
      ])

      expect(results.success).toBe(true)
      expect(results.sent).toBe(3)
      expect(results.failed).toBe(0)
      expect(emailAdapter.sent).toHaveLength(3)
    })

    it('should include per-notification results', async () => {
      const results = await router.sendBatch([
        { userId: 'user_1', template: 'digest', data: {}, channels: ['email'] },
        { userId: 'user_2', template: 'digest', data: {}, channels: ['email'] },
      ])

      expect(results.results).toHaveLength(2)
      expect(results.results[0].success).toBe(true)
      expect(results.results[1].success).toBe(true)
    })

    it('should continue on individual failures', async () => {
      // User 2 will fail
      await router.setPreferences('user_2', {
        email: { enabled: false },
      })

      const results = await router.sendBatch([
        { userId: 'user_1', template: 'digest', data: {}, channels: ['email'] },
        { userId: 'user_2', template: 'digest', data: {}, channels: ['email'] },
        { userId: 'user_3', template: 'digest', data: {}, channels: ['email'] },
      ])

      expect(results.sent).toBe(2)
      expect(results.failed).toBe(0) // Skipped due to prefs, not failed
      expect(results.skipped).toBe(1)
    })

    it('should respect rate limits', async () => {
      const router2 = createNotificationRouter({
        rateLimit: {
          email: { maxPerSecond: 2 },
        },
      })
      router2.registerChannel('email', emailAdapter)
      router2.registerTemplate('test', {
        email: { subject: 'Test', body: 'Test' },
      })

      const startTime = Date.now()
      await router2.sendBatch([
        { userId: 'user_1', template: 'test', data: {}, channels: ['email'] },
        { userId: 'user_2', template: 'test', data: {}, channels: ['email'] },
        { userId: 'user_3', template: 'test', data: {}, channels: ['email'] },
        { userId: 'user_4', template: 'test', data: {}, channels: ['email'] },
      ])
      const elapsed = Date.now() - startTime

      // Should take at least 1 second for 4 notifications at 2/sec
      expect(elapsed).toBeGreaterThanOrEqual(1000)
      await router2.close()
    })
  })
})

// ============================================================================
// DELIVERY TRACKING
// ============================================================================

describe('Delivery Tracking', () => {
  let router: NotificationRouter
  let emailAdapter: ChannelAdapter & { sent: unknown[] }

  beforeEach(() => {
    router = createNotificationRouter()
    emailAdapter = createMockEmailAdapter()
    router.registerChannel('email', emailAdapter)
    router.registerTemplate('test', {
      email: { subject: 'Test', body: 'Test body' },
    })
  })

  afterEach(async () => {
    await router.close()
  })

  describe('getDeliveryStatus()', () => {
    it('should return delivery status', async () => {
      const result = await router.send({
        userId: 'user_123',
        template: 'test',
        data: {},
        channels: ['email'],
      })

      const status = await router.getDeliveryStatus(result.notificationId)

      expect(status).toBeDefined()
      expect(status?.notificationId).toBe(result.notificationId)
      expect(status?.userId).toBe('user_123')
      expect(status?.template).toBe('test')
    })

    it('should track per-channel delivery status', async () => {
      const result = await router.send({
        userId: 'user_123',
        template: 'test',
        data: {},
        channels: ['email'],
      })

      const status = await router.getDeliveryStatus(result.notificationId)

      expect(status?.channels.email).toMatchObject({
        status: 'delivered',
        messageId: expect.any(String),
        deliveredAt: expect.any(Date),
      })
    })

    it('should track failed deliveries', async () => {
      const failingAdapter: ChannelAdapter = {
        name: 'email',
        send: async () => {
          throw new Error('Delivery failed')
        },
      }
      router.registerChannel('email', failingAdapter)

      const result = await router.send({
        userId: 'user_123',
        template: 'test',
        data: {},
        channels: ['email'],
      })

      const status = await router.getDeliveryStatus(result.notificationId)

      expect(status?.channels.email).toMatchObject({
        status: 'failed',
        error: 'Delivery failed',
        attempts: expect.any(Number),
      })
    })

    it('should return undefined for non-existent notification', async () => {
      const status = await router.getDeliveryStatus('nonexistent_id')
      expect(status).toBeUndefined()
    })
  })

  describe('tracking events', () => {
    it('should track opens', async () => {
      const result = await router.send({
        userId: 'user_123',
        template: 'test',
        data: {},
        channels: ['email'],
      })

      await router.trackOpen(result.notificationId, 'email')

      const status = await router.getDeliveryStatus(result.notificationId)
      expect(status?.channels.email?.opens).toBe(1)
      expect(status?.channels.email?.openedAt).toBeInstanceOf(Date)
    })

    it('should track clicks', async () => {
      const result = await router.send({
        userId: 'user_123',
        template: 'test',
        data: {},
        channels: ['email'],
      })

      await router.trackClick(result.notificationId, 'email', 'https://example.com/link')

      const status = await router.getDeliveryStatus(result.notificationId)
      expect(status?.channels.email?.clicks).toBe(1)
      expect(status?.channels.email?.clickedLinks).toContain('https://example.com/link')
    })

    it('should increment counts on multiple interactions', async () => {
      const result = await router.send({
        userId: 'user_123',
        template: 'test',
        data: {},
        channels: ['email'],
      })

      await router.trackOpen(result.notificationId, 'email')
      await router.trackOpen(result.notificationId, 'email')
      await router.trackClick(result.notificationId, 'email', 'link1')
      await router.trackClick(result.notificationId, 'email', 'link2')

      const status = await router.getDeliveryStatus(result.notificationId)
      expect(status?.channels.email?.opens).toBe(2)
      expect(status?.channels.email?.clicks).toBe(2)
    })
  })

  describe('getDeliveryHistory()', () => {
    it('should return notifications for a user', async () => {
      await router.send({
        userId: 'user_123',
        template: 'test',
        data: {},
        channels: ['email'],
      })
      await router.send({
        userId: 'user_123',
        template: 'test',
        data: {},
        channels: ['email'],
      })

      const history = await router.getDeliveryHistory('user_123')

      expect(history).toHaveLength(2)
    })

    it('should support pagination', async () => {
      for (let i = 0; i < 25; i++) {
        await router.send({
          userId: 'user_123',
          template: 'test',
          data: {},
          channels: ['email'],
        })
      }

      const page1 = await router.getDeliveryHistory('user_123', { limit: 10, offset: 0 })
      const page2 = await router.getDeliveryHistory('user_123', { limit: 10, offset: 10 })

      expect(page1).toHaveLength(10)
      expect(page2).toHaveLength(10)
    })

    it('should filter by channel', async () => {
      router.registerChannel('push', createMockPushAdapter())
      router.registerTemplate('multi', {
        email: { subject: 'Test', body: 'Test' },
        push: { title: 'Test', body: 'Test' },
      })

      await router.send({
        userId: 'user_123',
        template: 'multi',
        data: {},
        channels: ['email'],
      })
      await router.send({
        userId: 'user_123',
        template: 'multi',
        data: {},
        channels: ['push'],
      })

      const emailOnly = await router.getDeliveryHistory('user_123', { channel: 'email' })

      expect(emailOnly).toHaveLength(1)
      expect(Object.keys(emailOnly[0].channels)).toContain('email')
    })
  })
})

// ============================================================================
// RETRY LOGIC
// ============================================================================

describe('Retry Logic', () => {
  let router: NotificationRouter

  beforeEach(() => {
    router = createNotificationRouter({
      maxRetries: 3,
      retryDelay: 10,
    })
    router.registerTemplate('test', {
      email: { subject: 'Test', body: 'Test' },
    })
  })

  afterEach(async () => {
    await router.close()
  })

  it('should retry on failure', async () => {
    let attempts = 0
    const flakeyAdapter: ChannelAdapter = {
      name: 'email',
      send: async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('Temporary failure')
        }
        return { success: true, messageId: 'msg_123' }
      },
    }

    router.registerChannel('email', flakeyAdapter)

    const result = await router.send({
      userId: 'user_123',
      template: 'test',
      data: {},
      channels: ['email'],
    })

    expect(result.success).toBe(true)
    expect(attempts).toBe(3)
  })

  it('should fail after max retries', async () => {
    const failingAdapter: ChannelAdapter = {
      name: 'email',
      send: async () => {
        throw new Error('Permanent failure')
      },
    }

    router.registerChannel('email', failingAdapter)

    const result = await router.send({
      userId: 'user_123',
      template: 'test',
      data: {},
      channels: ['email'],
    })

    expect(result.success).toBe(false)
    expect(result.channels.email?.attempts).toBe(4) // 1 initial + 3 retries
  })

  it('should use exponential backoff', async () => {
    const delays: number[] = []
    let lastTime = Date.now()

    const failingAdapter: ChannelAdapter = {
      name: 'email',
      send: async () => {
        const now = Date.now()
        delays.push(now - lastTime)
        lastTime = now
        throw new Error('Failure')
      },
    }

    const router2 = createNotificationRouter({
      maxRetries: 3,
      retryDelay: 50,
      retryBackoff: 'exponential',
    })
    router2.registerChannel('email', failingAdapter)
    router2.registerTemplate('test', {
      email: { subject: 'Test', body: 'Test' },
    })

    await router2.send({
      userId: 'user_123',
      template: 'test',
      data: {},
      channels: ['email'],
    })

    // First call immediate, then 50ms, 100ms, 200ms
    expect(delays[1]).toBeGreaterThanOrEqual(45)
    expect(delays[2]).toBeGreaterThanOrEqual(90)
    expect(delays[3]).toBeGreaterThanOrEqual(180)

    await router2.close()
  })
})

// ============================================================================
// RATE LIMITING
// ============================================================================

describe('Rate Limiting', () => {
  let router: NotificationRouter
  let emailAdapter: ChannelAdapter & { sent: unknown[] }

  beforeEach(() => {
    emailAdapter = createMockEmailAdapter()
  })

  afterEach(async () => {
    await router?.close()
  })

  it('should enforce per-channel rate limits', async () => {
    router = createNotificationRouter({
      rateLimit: {
        email: { maxPerSecond: 5 },
      },
    })
    router.registerChannel('email', emailAdapter)
    router.registerTemplate('test', {
      email: { subject: 'Test', body: 'Test' },
    })

    const startTime = Date.now()
    const promises = []
    for (let i = 0; i < 10; i++) {
      promises.push(
        router.send({
          userId: `user_${i}`,
          template: 'test',
          data: {},
          channels: ['email'],
        })
      )
    }
    await Promise.all(promises)
    const elapsed = Date.now() - startTime

    // 10 notifications at 5/sec should take ~2 seconds
    expect(elapsed).toBeGreaterThanOrEqual(1000)
    expect(emailAdapter.sent).toHaveLength(10)
  })

  it('should track rate limit status', async () => {
    router = createNotificationRouter({
      rateLimit: {
        email: { maxPerSecond: 100 },
      },
    })
    router.registerChannel('email', emailAdapter)

    const status = router.getRateLimitStatus('email')
    expect(status).toMatchObject({
      maxPerSecond: 100,
      currentRate: expect.any(Number),
      available: expect.any(Number),
    })
  })
})

// ============================================================================
// CALLBACKS AND EVENTS
// ============================================================================

describe('Callbacks and Events', () => {
  let router: NotificationRouter
  let emailAdapter: ChannelAdapter & { sent: unknown[] }

  beforeEach(() => {
    emailAdapter = createMockEmailAdapter()
  })

  afterEach(async () => {
    await router?.close()
  })

  it('should call onSend callback', async () => {
    const sent: unknown[] = []
    router = createNotificationRouter({
      onSend: (notification) => sent.push(notification),
    })
    router.registerChannel('email', emailAdapter)
    router.registerTemplate('test', {
      email: { subject: 'Test', body: 'Test' },
    })

    await router.send({
      userId: 'user_123',
      template: 'test',
      data: {},
      channels: ['email'],
    })

    expect(sent).toHaveLength(1)
  })

  it('should call onDelivery callback', async () => {
    const deliveries: unknown[] = []
    router = createNotificationRouter({
      onDelivery: (result) => deliveries.push(result),
    })
    router.registerChannel('email', emailAdapter)
    router.registerTemplate('test', {
      email: { subject: 'Test', body: 'Test' },
    })

    await router.send({
      userId: 'user_123',
      template: 'test',
      data: {},
      channels: ['email'],
    })

    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]).toMatchObject({
      success: true,
      channel: 'email',
    })
  })

  it('should call onError callback', async () => {
    const errors: Error[] = []
    const failingAdapter: ChannelAdapter = {
      name: 'email',
      send: async () => {
        throw new Error('Send failed')
      },
    }

    router = createNotificationRouter({
      maxRetries: 0,
      onError: (error) => errors.push(error),
    })
    router.registerChannel('email', failingAdapter)
    router.registerTemplate('test', {
      email: { subject: 'Test', body: 'Test' },
    })

    await router.send({
      userId: 'user_123',
      template: 'test',
      data: {},
      channels: ['email'],
    })

    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('Send failed')
  })
})

// ============================================================================
// WEBHOOK CHANNEL
// ============================================================================

describe('Webhook Channel', () => {
  let router: NotificationRouter
  let webhookAdapter: ChannelAdapter & { sent: unknown[] }

  beforeEach(() => {
    router = createNotificationRouter()
    webhookAdapter = createMockWebhookAdapter()
    router.registerChannel('webhook', webhookAdapter)
  })

  afterEach(async () => {
    await router.close()
  })

  it('should send webhook with payload', async () => {
    router.registerTemplate('event', {
      webhook: {
        body: '{"event": "{{eventType}}", "data": {{data}}}',
      },
    })

    await router.send({
      userId: 'user_123',
      template: 'event',
      data: {
        eventType: 'order.created',
        data: JSON.stringify({ orderId: '123' }),
      },
      channels: ['webhook'],
      webhookUrl: 'https://example.com/webhook',
    })

    expect(webhookAdapter.sent).toHaveLength(1)
    expect(webhookAdapter.sent[0]).toMatchObject({
      url: 'https://example.com/webhook',
    })
  })
})

// ============================================================================
// IN-APP NOTIFICATIONS
// ============================================================================

describe('In-App Notifications', () => {
  let router: NotificationRouter
  let inAppAdapter: ChannelAdapter & { sent: unknown[] }

  beforeEach(() => {
    router = createNotificationRouter()
    inAppAdapter = createMockInAppAdapter()
    router.registerChannel('in-app', inAppAdapter)
    router.registerTemplate('update', {
      'in-app': {
        title: 'New Update',
        body: '{{message}}',
        icon: 'info',
        action: {
          type: 'link',
          url: '{{actionUrl}}',
        },
      },
    })
  })

  afterEach(async () => {
    await router.close()
  })

  it('should send in-app notification with action', async () => {
    await router.send({
      userId: 'user_123',
      template: 'update',
      data: {
        message: 'New feature available!',
        actionUrl: '/features/new',
      },
      channels: ['in-app'],
    })

    expect(inAppAdapter.sent).toHaveLength(1)
    expect(inAppAdapter.sent[0]).toMatchObject({
      title: 'New Update',
      body: 'New feature available!',
      action: {
        type: 'link',
        url: '/features/new',
      },
    })
  })

  it('should track unread in-app notifications', async () => {
    await router.send({
      userId: 'user_123',
      template: 'update',
      data: { message: 'Update 1', actionUrl: '/1' },
      channels: ['in-app'],
    })
    await router.send({
      userId: 'user_123',
      template: 'update',
      data: { message: 'Update 2', actionUrl: '/2' },
      channels: ['in-app'],
    })

    const unread = await router.getUnreadCount('user_123', 'in-app')
    expect(unread).toBe(2)
  })

  it('should mark in-app notification as read', async () => {
    const result = await router.send({
      userId: 'user_123',
      template: 'update',
      data: { message: 'Update', actionUrl: '/test' },
      channels: ['in-app'],
    })

    await router.markAsRead(result.notificationId, 'in-app')

    const unread = await router.getUnreadCount('user_123', 'in-app')
    expect(unread).toBe(0)
  })
})

// ============================================================================
// CLOSE AND CLEANUP
// ============================================================================

describe('Close and Cleanup', () => {
  it('should flush pending notifications on close', async () => {
    const emailAdapter = createMockEmailAdapter()
    const router = createNotificationRouter({
      batchSize: 100,
      batchInterval: 60000,
    })
    router.registerChannel('email', emailAdapter)
    router.registerTemplate('test', {
      email: { subject: 'Test', body: 'Test' },
    })

    // Queue some notifications
    router.queue({
      userId: 'user_1',
      template: 'test',
      data: {},
      channels: ['email'],
    })
    router.queue({
      userId: 'user_2',
      template: 'test',
      data: {},
      channels: ['email'],
    })

    await router.close()

    expect(emailAdapter.sent).toHaveLength(2)
  })

  it('should reject new notifications after close', async () => {
    const router = createNotificationRouter()
    await router.close()

    await expect(
      router.send({
        userId: 'user_123',
        template: 'test',
        data: {},
        channels: ['email'],
      })
    ).rejects.toThrow('Router is closed')
  })
})
