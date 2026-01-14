import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  MailChannelsProvider,
  ResendProvider,
  SendGridProvider,
  ProviderRouter,
  createProvider,
} from '../providers'
import type { EmailMessage, EmailStatus } from '../types'

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

describe('Email Providers', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('MailChannelsProvider', () => {
    it('should send email successfully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 202,
        text: () => Promise.resolve(''),
      })

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

      const provider = new MailChannelsProvider()
      const result = await provider.send(createTestMessage())

      expect(result.success).toBe(false)
      expect(result.error).toContain('400')
    })

    it('should handle network errors', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const provider = new MailChannelsProvider()
      const result = await provider.send(createTestMessage())

      expect(result.success).toBe(false)
      expect(result.error).toBe('Network error')
    })

    it('should validate config', async () => {
      const provider = new MailChannelsProvider()
      const valid = await provider.validateConfig()
      expect(valid).toBe(true) // MailChannels doesn't require API keys
    })

    it('should include DKIM when configured', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 202,
        text: () => Promise.resolve(''),
      })

      const provider = new MailChannelsProvider({
        dkim: {
          domain: 'example.com',
          selector: 'selector1',
          private_key: 'private-key',
        },
      })

      await provider.send(createTestMessage())

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('dkim_domain'),
        })
      )
    })
  })

  describe('ResendProvider', () => {
    it('should send email successfully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'resend-msg-123' }),
      })

      const provider = new ResendProvider({ apiKey: 're_test' })
      const message = createTestMessage()
      const result = await provider.send(message)

      expect(result.success).toBe(true)
      expect(result.message_id).toBe('resend-msg-123')
      expect(result.provider).toBe('resend')
    })

    it('should handle Resend errors', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ message: 'Invalid email' }),
      })

      const provider = new ResendProvider({ apiKey: 're_test' })
      const result = await provider.send(createTestMessage())

      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid email')
    })

    it('should validate API key format', async () => {
      const validProvider = new ResendProvider({ apiKey: 're_valid' })
      expect(await validProvider.validateConfig()).toBe(true)

      const invalidProvider = new ResendProvider({ apiKey: 'invalid' })
      expect(await invalidProvider.validateConfig()).toBe(false)
    })

    it('should format email addresses correctly', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'msg-123' }),
      })

      const provider = new ResendProvider({ apiKey: 're_test' })
      await provider.send(createTestMessage())

      const callBody = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
      expect(callBody.from).toBe('Sender <sender@example.com>')
      expect(callBody.to).toEqual(['User <user@example.com>'])
    })
  })

  describe('SendGridProvider', () => {
    it('should send email successfully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 202,
        headers: new Headers({ 'x-message-id': 'sg-msg-123' }),
      })

      const provider = new SendGridProvider({ apiKey: 'SG.test' })
      const message = createTestMessage()
      const result = await provider.send(message)

      expect(result.success).toBe(true)
      expect(result.message_id).toBe('sg-msg-123')
      expect(result.provider).toBe('sendgrid')
    })

    it('should handle SendGrid errors', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 400,
        text: () => Promise.resolve('Bad request'),
      })

      const provider = new SendGridProvider({ apiKey: 'SG.test' })
      const result = await provider.send(createTestMessage())

      expect(result.success).toBe(false)
      expect(result.error).toContain('400')
    })

    it('should validate API key format', async () => {
      const validProvider = new SendGridProvider({ apiKey: 'SG.valid' })
      expect(await validProvider.validateConfig()).toBe(true)

      const invalidProvider = new SendGridProvider({ apiKey: 'invalid' })
      expect(await invalidProvider.validateConfig()).toBe(false)
    })
  })

  describe('ProviderRouter', () => {
    it('should use default provider', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 202,
        text: () => Promise.resolve(''),
      })

      const router = new ProviderRouter({
        providers: [
          { provider: 'mailchannels', enabled: true, priority: 1 },
        ],
        defaultProvider: 'mailchannels',
      })

      const result = await router.send(createTestMessage())

      expect(result.success).toBe(true)
      expect(result.provider).toBe('mailchannels')
    })

    it('should fallback on failure when retryOnFail is true', async () => {
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

    it('should not fallback when retryOnFail is false', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 500,
        text: () => Promise.resolve('Error'),
      })

      const router = new ProviderRouter({
        providers: [
          { provider: 'mailchannels', enabled: true, priority: 1 },
          { provider: 'resend', apiKey: 're_test', enabled: true, priority: 2 },
        ],
        defaultProvider: 'mailchannels',
        retryOnFail: false,
      })

      const result = await router.send(createTestMessage())

      expect(result.success).toBe(false)
      expect(result.provider).toBe('mailchannels')
    })

    it('should respect provider priority order', async () => {
      const fetchCalls: string[] = []
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        fetchCalls.push(url)
        return Promise.resolve({ status: 500, text: () => Promise.resolve('Error') })
      })

      const router = new ProviderRouter({
        providers: [
          { provider: 'sendgrid', apiKey: 'SG.test', enabled: true, priority: 3 },
          { provider: 'mailchannels', enabled: true, priority: 1 },
          { provider: 'resend', apiKey: 're_test', enabled: true, priority: 2 },
        ],
        retryOnFail: true,
      })

      await router.send(createTestMessage())

      expect(fetchCalls[0]).toContain('mailchannels')
      expect(fetchCalls[1]).toContain('resend')
      expect(fetchCalls[2]).toContain('sendgrid')
    })

    it('should skip disabled providers', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'msg-123' }),
      })

      const router = new ProviderRouter({
        providers: [
          { provider: 'mailchannels', enabled: false, priority: 1 },
          { provider: 'resend', apiKey: 're_test', enabled: true, priority: 2 },
        ],
        retryOnFail: true,
      })

      const result = await router.send(createTestMessage())

      expect(result.provider).toBe('resend')
    })

    it('should use message-specified provider', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'msg-123' }),
      })

      const router = new ProviderRouter({
        providers: [
          { provider: 'mailchannels', enabled: true, priority: 1 },
          { provider: 'resend', apiKey: 're_test', enabled: true, priority: 2 },
        ],
        defaultProvider: 'mailchannels',
      })

      const message = createTestMessage({ provider: 'resend' })
      const result = await router.send(message)

      expect(result.provider).toBe('resend')
    })

    it('should list available providers', () => {
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
    it('should create MailChannels provider', () => {
      const provider = createProvider({ provider: 'mailchannels', enabled: true })
      expect(provider).toBeInstanceOf(MailChannelsProvider)
    })

    it('should create Resend provider with API key', () => {
      const provider = createProvider({ provider: 'resend', apiKey: 're_test', enabled: true })
      expect(provider).toBeInstanceOf(ResendProvider)
    })

    it('should return null for Resend without API key', () => {
      const provider = createProvider({ provider: 'resend', enabled: true })
      expect(provider).toBeNull()
    })

    it('should create SendGrid provider with API key', () => {
      const provider = createProvider({ provider: 'sendgrid', apiKey: 'SG.test', enabled: true })
      expect(provider).toBeInstanceOf(SendGridProvider)
    })

    it('should return null for SendGrid without API key', () => {
      const provider = createProvider({ provider: 'sendgrid', enabled: true })
      expect(provider).toBeNull()
    })
  })
})
