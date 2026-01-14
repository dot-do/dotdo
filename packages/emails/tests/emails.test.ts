/**
 * @dotdo/emails - Email Service Test Suite
 *
 * RED phase: Tests for email API compatibility layer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  EmailMessage,
  EmailStatus,
  EmailAddress,
  EmailProvider,
  EmailTemplate,
  WebhookEvent,
  WebhookEventType,
  WebhookSubscription,
  SendGridMailRequest,
  ResendEmailRequest,
} from '../src/types'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: 'msg-123',
    from: { email: 'sender@example.com', name: 'Sender' },
    to: [{ email: 'user@example.com', name: 'User' }],
    subject: 'Test Subject',
    html: '<p>Hello World</p>',
    text: 'Hello World',
    created_at: new Date(),
    status: 'queued' as EmailStatus,
    ...overrides,
  }
}

// =============================================================================
// Provider Tests
// =============================================================================

describe('Email Providers', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('InMemoryProvider', () => {
    it('should store sent emails', async () => {
      const { InMemoryProvider } = await import('../src/providers')
      const provider = new InMemoryProvider()
      const message = createTestMessage()

      const result = await provider.send(message)

      expect(result.success).toBe(true)
      expect(result.provider).toBe('memory')
      expect(provider.getSentEmails()).toHaveLength(1)
      expect(provider.getSentEmails()[0]).toEqual(message)
    })

    it('should clear sent emails', async () => {
      const { InMemoryProvider } = await import('../src/providers')
      const provider = new InMemoryProvider()

      await provider.send(createTestMessage())
      await provider.send(createTestMessage({ id: 'msg-456' }))

      expect(provider.getSentEmails()).toHaveLength(2)
      provider.clear()
      expect(provider.getSentEmails()).toHaveLength(0)
    })

    it('should validate config', async () => {
      const { InMemoryProvider } = await import('../src/providers')
      const provider = new InMemoryProvider()
      const valid = await provider.validateConfig()
      expect(valid).toBe(true)
    })
  })

  describe('MailChannelsProvider', () => {
    it('should send email successfully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 202,
        text: () => Promise.resolve(''),
      })

      const { MailChannelsProvider } = await import('../src/providers')
      const provider = new MailChannelsProvider()
      const message = createTestMessage()
      const result = await provider.send(message)

      expect(result.success).toBe(true)
      expect(result.provider).toBe('mailchannels')
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.mailchannels.net/tx/v1/send',
        expect.any(Object)
      )
    })

    it('should handle MailChannels errors', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 400,
        text: () => Promise.resolve('Bad request'),
      })

      const { MailChannelsProvider } = await import('../src/providers')
      const provider = new MailChannelsProvider()
      const result = await provider.send(createTestMessage())

      expect(result.success).toBe(false)
      expect(result.error).toContain('400')
    })

    it('should handle network errors', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const { MailChannelsProvider } = await import('../src/providers')
      const provider = new MailChannelsProvider()
      const result = await provider.send(createTestMessage())

      expect(result.success).toBe(false)
      expect(result.error).toBe('Network error')
    })
  })

  describe('ResendProvider', () => {
    it('should send email successfully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'resend-msg-123' }),
      })

      const { ResendProvider } = await import('../src/providers')
      const provider = new ResendProvider({ apiKey: 're_test' })
      const message = createTestMessage()
      const result = await provider.send(message)

      expect(result.success).toBe(true)
      expect(result.message_id).toBe('resend-msg-123')
      expect(result.provider).toBe('resend')
    })

    it('should validate API key format', async () => {
      const { ResendProvider } = await import('../src/providers')

      const validProvider = new ResendProvider({ apiKey: 're_valid' })
      expect(await validProvider.validateConfig()).toBe(true)

      const invalidProvider = new ResendProvider({ apiKey: 'invalid' })
      expect(await invalidProvider.validateConfig()).toBe(false)
    })
  })

  describe('SendGridProvider', () => {
    it('should send email successfully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 202,
        headers: new Headers({ 'x-message-id': 'sg-msg-123' }),
      })

      const { SendGridProvider } = await import('../src/providers')
      const provider = new SendGridProvider({ apiKey: 'SG.test' })
      const message = createTestMessage()
      const result = await provider.send(message)

      expect(result.success).toBe(true)
      expect(result.message_id).toBe('sg-msg-123')
      expect(result.provider).toBe('sendgrid')
    })

    it('should validate API key format', async () => {
      const { SendGridProvider } = await import('../src/providers')

      const validProvider = new SendGridProvider({ apiKey: 'SG.valid' })
      expect(await validProvider.validateConfig()).toBe(true)

      const invalidProvider = new SendGridProvider({ apiKey: 'invalid' })
      expect(await invalidProvider.validateConfig()).toBe(false)
    })
  })

  describe('ProviderRouter', () => {
    it('should use default provider', async () => {
      const { ProviderRouter, InMemoryProvider } = await import('../src/providers')

      const router = new ProviderRouter({
        providers: [
          { provider: 'memory' as EmailProvider, enabled: true, priority: 1 },
        ],
        defaultProvider: 'memory' as EmailProvider,
      })

      const result = await router.send(createTestMessage())

      expect(result.success).toBe(true)
      expect(result.provider).toBe('memory')
    })

    it('should fallback on failure when retryOnFail is true', async () => {
      const { ProviderRouter, InMemoryProvider } = await import('../src/providers')

      // Create a mock provider that always fails
      let callCount = 0
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        callCount++
        if (url.includes('mailchannels')) {
          return Promise.resolve({ status: 500, text: () => Promise.resolve('Error') })
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'msg-123' }) })
      })

      const router = new ProviderRouter({
        providers: [
          { provider: 'mailchannels', enabled: true, priority: 1 },
          { provider: 'resend', apiKey: 're_test', enabled: true, priority: 2 },
        ],
        defaultProvider: 'mailchannels',
        retryOnFail: true,
      })

      const result = await router.send(createTestMessage())

      expect(result.success).toBe(true)
      expect(result.provider).toBe('resend')
    })

    it('should list available providers', async () => {
      const { ProviderRouter } = await import('../src/providers')

      const router = new ProviderRouter({
        providers: [
          { provider: 'mailchannels', enabled: true, priority: 1 },
          { provider: 'resend', apiKey: 're_test', enabled: true, priority: 2 },
          { provider: 'sendgrid', apiKey: 'SG.test', enabled: false, priority: 3 },
        ],
      })

      const providers = router.listProviders()
      expect(providers).toContain('mailchannels')
      expect(providers).toContain('resend')
      expect(providers).not.toContain('sendgrid') // Disabled
    })
  })

  describe('createProvider', () => {
    it('should create InMemoryProvider', async () => {
      const { createProvider, InMemoryProvider } = await import('../src/providers')

      const provider = createProvider({ provider: 'memory' as EmailProvider, enabled: true })
      expect(provider).toBeInstanceOf(InMemoryProvider)
    })

    it('should create MailChannels provider', async () => {
      const { createProvider, MailChannelsProvider } = await import('../src/providers')

      const provider = createProvider({ provider: 'mailchannels', enabled: true })
      expect(provider).toBeInstanceOf(MailChannelsProvider)
    })

    it('should create Resend provider with API key', async () => {
      const { createProvider, ResendProvider } = await import('../src/providers')

      const provider = createProvider({ provider: 'resend', apiKey: 're_test', enabled: true })
      expect(provider).toBeInstanceOf(ResendProvider)
    })

    it('should return null for Resend without API key', async () => {
      const { createProvider } = await import('../src/providers')

      const provider = createProvider({ provider: 'resend', enabled: true })
      expect(provider).toBeNull()
    })
  })
})

// =============================================================================
// SendGrid Compatibility Tests
// =============================================================================

describe('SendGrid Compatibility', () => {
  describe('SendGridClient', () => {
    it('should send email using SendGrid API format', async () => {
      const { SendGridClient } = await import('../src/sendgrid')

      const client = new SendGridClient({
        testMode: true, // Use InMemoryProvider
      })

      const request: SendGridMailRequest = {
        personalizations: [{ to: [{ email: 'user@example.com' }] }],
        from: { email: 'noreply@example.com' },
        subject: 'Hello',
        content: [{ type: 'text/html', value: '<p>Hello World</p>' }],
      }

      const result = await client.send(request)

      expect(result.statusCode).toBe(202)
      expect(result.headers?.['x-message-id']).toBeDefined()
    })

    it('should validate required fields', async () => {
      const { SendGridClient } = await import('../src/sendgrid')

      const client = new SendGridClient({ testMode: true })

      // Missing from
      const result = await client.send({
        personalizations: [{ to: [{ email: 'user@example.com' }] }],
        subject: 'Hello',
        content: [{ type: 'text/html', value: '<p>Hello</p>' }],
      } as SendGridMailRequest)

      expect(result.statusCode).toBe(400)
    })

    it('should handle personalizations with substitutions', async () => {
      const { SendGridClient } = await import('../src/sendgrid')

      const client = new SendGridClient({ testMode: true })

      const request: SendGridMailRequest = {
        personalizations: [{
          to: [{ email: 'user@example.com' }],
          substitutions: { '-name-': 'John' },
        }],
        from: { email: 'noreply@example.com' },
        subject: 'Hello -name-',
        content: [{ type: 'text/html', value: '<p>Hello -name-</p>' }],
      }

      const result = await client.send(request)

      expect(result.statusCode).toBe(202)
    })
  })

  describe('validateSendGridRequest', () => {
    it('should validate valid request', async () => {
      const { validateSendGridRequest } = await import('../src/sendgrid')

      const result = validateSendGridRequest({
        personalizations: [{ to: [{ email: 'user@example.com' }] }],
        from: { email: 'sender@example.com' },
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
      })

      expect(result.valid).toBe(true)
    })

    it('should reject missing personalizations', async () => {
      const { validateSendGridRequest } = await import('../src/sendgrid')

      const result = validateSendGridRequest({
        from: { email: 'sender@example.com' },
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
      } as SendGridMailRequest)

      expect(result.valid).toBe(false)
      expect(result.errors?.errors[0].field).toBe('personalizations')
    })

    it('should reject invalid email address', async () => {
      const { validateSendGridRequest } = await import('../src/sendgrid')

      const result = validateSendGridRequest({
        personalizations: [{ to: [{ email: 'user@example.com' }] }],
        from: { email: 'invalid-email' },
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
      })

      expect(result.valid).toBe(false)
      expect(result.errors?.errors[0].field).toBe('from.email')
    })
  })
})

// =============================================================================
// Resend Compatibility Tests
// =============================================================================

describe('Resend Compatibility', () => {
  describe('Resend', () => {
    it('should send email using Resend API format', async () => {
      const { Resend } = await import('../src/resend')

      const resend = new Resend({ testMode: true })

      const result = await resend.emails.send({
        from: 'noreply@example.com',
        to: 'user@example.com',
        subject: 'Hello',
        html: '<p>Hello World</p>',
      })

      expect(result.id).toBeDefined()
    })

    it('should parse email addresses with names', async () => {
      const { Resend } = await import('../src/resend')

      const resend = new Resend({ testMode: true })

      const result = await resend.emails.send({
        from: 'Sender Name <sender@example.com>',
        to: ['User One <user1@example.com>', 'user2@example.com'],
        subject: 'Hello',
        html: '<p>Hello World</p>',
      })

      expect(result.id).toBeDefined()
    })

    it('should validate required fields', async () => {
      const { Resend, ResendAPIError } = await import('../src/resend')

      const resend = new Resend({ testMode: true })

      await expect(
        resend.emails.send({
          from: 'sender@example.com',
          to: 'user@example.com',
          subject: 'Hello',
          // Missing html/text/react
        } as ResendEmailRequest)
      ).rejects.toThrow(ResendAPIError)
    })
  })

  describe('validateResendRequest', () => {
    it('should validate valid request', async () => {
      const { validateResendRequest } = await import('../src/resend')

      const result = validateResendRequest({
        from: 'sender@example.com',
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      })

      expect(result.valid).toBe(true)
    })

    it('should reject missing subject', async () => {
      const { validateResendRequest } = await import('../src/resend')

      const result = validateResendRequest({
        from: 'sender@example.com',
        to: 'user@example.com',
        html: '<p>Hello</p>',
      } as ResendEmailRequest)

      expect(result.valid).toBe(false)
    })
  })
})

// =============================================================================
// Template Tests
// =============================================================================

describe('Templates', () => {
  describe('InMemoryTemplateStorage', () => {
    it('should store and retrieve templates', async () => {
      const { InMemoryTemplateStorage } = await import('../src/templates')

      const storage = new InMemoryTemplateStorage()
      const template: EmailTemplate = {
        id: 'welcome',
        name: 'Welcome Email',
        subject: 'Welcome {{name}}!',
        html: '<p>Hello {{name}}</p>',
        created_at: new Date(),
        updated_at: new Date(),
      }

      await storage.set(template)
      const retrieved = await storage.get('welcome')

      expect(retrieved).toEqual(template)
    })

    it('should list all templates', async () => {
      const { InMemoryTemplateStorage } = await import('../src/templates')

      const storage = new InMemoryTemplateStorage()
      await storage.set({
        id: 'welcome',
        name: 'Welcome',
        subject: 'Welcome',
        html: '<p>Welcome</p>',
        created_at: new Date(),
        updated_at: new Date(),
      })
      await storage.set({
        id: 'reset',
        name: 'Reset',
        subject: 'Reset',
        html: '<p>Reset</p>',
        created_at: new Date(),
        updated_at: new Date(),
      })

      const templates = await storage.list()

      expect(templates).toHaveLength(2)
    })

    it('should delete templates', async () => {
      const { InMemoryTemplateStorage } = await import('../src/templates')

      const storage = new InMemoryTemplateStorage()
      await storage.set({
        id: 'welcome',
        name: 'Welcome',
        subject: 'Welcome',
        html: '<p>Welcome</p>',
        created_at: new Date(),
        updated_at: new Date(),
      })

      await storage.delete('welcome')
      const retrieved = await storage.get('welcome')

      expect(retrieved).toBeNull()
    })
  })

  describe('TemplateRenderer', () => {
    it('should render simple variables', async () => {
      const { TemplateRenderer, InMemoryTemplateStorage } = await import('../src/templates')

      const storage = new InMemoryTemplateStorage()
      await storage.set({
        id: 'test',
        name: 'Test',
        subject: 'Hello {{name}}',
        html: '<p>Hello {{name}}</p>',
        created_at: new Date(),
        updated_at: new Date(),
      })

      const renderer = new TemplateRenderer(storage)
      const result = await renderer.render('test', { name: 'John' })

      expect(result?.subject).toBe('Hello John')
      expect(result?.html).toBe('<p>Hello John</p>')
    })

    it('should render conditionals', async () => {
      const { TemplateRenderer, InMemoryTemplateStorage } = await import('../src/templates')

      const storage = new InMemoryTemplateStorage()
      await storage.set({
        id: 'test',
        name: 'Test',
        subject: 'Test',
        html: '{{#if premium}}Premium{{/if}}',
        created_at: new Date(),
        updated_at: new Date(),
      })

      const renderer = new TemplateRenderer(storage)

      const withCondition = await renderer.render('test', { premium: true })
      expect(withCondition?.html).toBe('Premium')

      const withoutCondition = await renderer.render('test', { premium: false })
      expect(withoutCondition?.html).toBe('')
    })

    it('should render loops', async () => {
      const { TemplateRenderer, InMemoryTemplateStorage } = await import('../src/templates')

      const storage = new InMemoryTemplateStorage()
      await storage.set({
        id: 'test',
        name: 'Test',
        subject: 'Test',
        html: '{{#each items}}{{this}}{{/each}}',
        created_at: new Date(),
        updated_at: new Date(),
      })

      const renderer = new TemplateRenderer(storage)
      const result = await renderer.render('test', { items: ['a', 'b', 'c'] })

      expect(result?.html).toBe('abc')
    })

    it('should return null for missing template', async () => {
      const { TemplateRenderer, InMemoryTemplateStorage } = await import('../src/templates')

      const storage = new InMemoryTemplateStorage()
      const renderer = new TemplateRenderer(storage)
      const result = await renderer.render('nonexistent', {})

      expect(result).toBeNull()
    })
  })

  describe('extractVariables', () => {
    it('should extract variables from template', async () => {
      const { extractVariables } = await import('../src/templates')

      const variables = extractVariables('Hello {{name}}, your order {{order_id}} is ready')

      expect(variables).toContain('name')
      expect(variables).toContain('order_id')
    })
  })

  describe('BUILT_IN_TEMPLATES', () => {
    it('should include welcome template', async () => {
      const { BUILT_IN_TEMPLATES } = await import('../src/templates')

      const welcome = BUILT_IN_TEMPLATES.find(t => t.id === 'welcome')
      expect(welcome).toBeDefined()
      expect(welcome?.variables).toContain('name')
      expect(welcome?.variables).toContain('company_name')
    })
  })
})

// =============================================================================
// Webhook Tests
// =============================================================================

describe('Webhooks', () => {
  describe('InMemoryWebhookStorage', () => {
    it('should store and retrieve subscriptions', async () => {
      const { InMemoryWebhookStorage } = await import('../src/webhooks')

      const storage = new InMemoryWebhookStorage()
      const subscription: WebhookSubscription = {
        id: 'sub-1',
        url: 'https://example.com/webhook',
        events: ['delivered', 'bounced'],
        enabled: true,
        created_at: new Date(),
      }

      await storage.setSubscription(subscription)
      const retrieved = await storage.getSubscription('sub-1')

      expect(retrieved).toEqual(subscription)
    })

    it('should get subscriptions by event type', async () => {
      const { InMemoryWebhookStorage } = await import('../src/webhooks')

      const storage = new InMemoryWebhookStorage()
      await storage.setSubscription({
        id: 'sub-1',
        url: 'https://example.com/webhook1',
        events: ['delivered'],
        enabled: true,
        created_at: new Date(),
      })
      await storage.setSubscription({
        id: 'sub-2',
        url: 'https://example.com/webhook2',
        events: ['bounced'],
        enabled: true,
        created_at: new Date(),
      })

      const deliveredSubs = await storage.getSubscriptionsByEvent('delivered')
      expect(deliveredSubs).toHaveLength(1)
      expect(deliveredSubs[0].id).toBe('sub-1')
    })
  })

  describe('WebhookDispatcher', () => {
    let originalFetch: typeof globalThis.fetch

    beforeEach(() => {
      originalFetch = globalThis.fetch
    })

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    it('should dispatch events to subscribers', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      })

      const { WebhookDispatcher, InMemoryWebhookStorage } = await import('../src/webhooks')

      const storage = new InMemoryWebhookStorage()
      await storage.setSubscription({
        id: 'sub-1',
        url: 'https://example.com/webhook',
        events: ['delivered'],
        enabled: true,
        created_at: new Date(),
      })

      const dispatcher = new WebhookDispatcher({ storage })
      const results = await dispatcher.dispatch({
        id: 'event-1',
        type: 'delivered',
        email_id: 'msg-123',
        recipient: 'user@example.com',
        timestamp: new Date(),
      })

      expect(results).toHaveLength(1)
      expect(results[0].success).toBe(true)
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.any(Object)
      )
    })

    it('should retry on failure', async () => {
      let attempts = 0
      globalThis.fetch = vi.fn().mockImplementation(() => {
        attempts++
        if (attempts < 3) {
          return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('Error') })
        }
        return Promise.resolve({ ok: true, status: 200 })
      })

      const { WebhookDispatcher, InMemoryWebhookStorage } = await import('../src/webhooks')

      const storage = new InMemoryWebhookStorage()
      await storage.setSubscription({
        id: 'sub-1',
        url: 'https://example.com/webhook',
        events: ['delivered'],
        enabled: true,
        created_at: new Date(),
      })

      const dispatcher = new WebhookDispatcher({
        storage,
        maxRetries: 3,
        retryDelay: 10, // Fast for tests
      })

      const results = await dispatcher.dispatch({
        id: 'event-1',
        type: 'delivered',
        email_id: 'msg-123',
        recipient: 'user@example.com',
        timestamp: new Date(),
      })

      expect(results[0].success).toBe(true)
      expect(results[0].attempts).toBe(3)
    })

    it('should sign payloads with secret', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      })

      const { WebhookDispatcher, InMemoryWebhookStorage } = await import('../src/webhooks')

      const storage = new InMemoryWebhookStorage()
      await storage.setSubscription({
        id: 'sub-1',
        url: 'https://example.com/webhook',
        events: ['delivered'],
        secret: 'my-secret',
        enabled: true,
        created_at: new Date(),
      })

      const dispatcher = new WebhookDispatcher({ storage })
      await dispatcher.dispatch({
        id: 'event-1',
        type: 'delivered',
        email_id: 'msg-123',
        recipient: 'user@example.com',
        timestamp: new Date(),
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Webhook-Signature': expect.any(String),
          }),
        })
      )
    })
  })

  describe('parseSendGridWebhook', () => {
    it('should parse SendGrid webhook events', async () => {
      const { parseSendGridWebhook } = await import('../src/webhooks')

      const events = parseSendGridWebhook([
        {
          event: 'delivered',
          email: 'user@example.com',
          sg_message_id: 'msg-123',
          timestamp: 1609459200,
        },
      ])

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('delivered')
      expect(events[0].recipient).toBe('user@example.com')
    })
  })

  describe('parseResendWebhook', () => {
    it('should parse Resend webhook events', async () => {
      const { parseResendWebhook } = await import('../src/webhooks')

      const event = parseResendWebhook({
        type: 'email.delivered',
        created_at: '2021-01-01T00:00:00Z',
        data: {
          email_id: 'msg-123',
          to: ['user@example.com'],
        },
      })

      expect(event?.type).toBe('delivered')
      expect(event?.recipient).toBe('user@example.com')
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration', () => {
  describe('Email sending workflow', () => {
    it('should send email through full pipeline', async () => {
      const { SendGridClient } = await import('../src/sendgrid')
      const { InMemoryProvider } = await import('../src/providers')

      const client = new SendGridClient({ testMode: true })

      const result = await client.send({
        personalizations: [
          {
            to: [{ email: 'user@example.com', name: 'User' }],
            dynamic_template_data: { name: 'John' },
          },
        ],
        from: { email: 'sender@example.com', name: 'Sender' },
        subject: 'Welcome!',
        content: [{ type: 'text/html', value: '<p>Hello</p>' }],
      })

      expect(result.statusCode).toBe(202)
    })
  })
})
