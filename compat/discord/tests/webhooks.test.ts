/**
 * @dotdo/discord - Webhooks Module Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  WebhookClient,
  WebhookPayloadBuilder,
  WebhookManager,
  parseWebhookUrl,
  createWebhookFromUrl,
  sendWebhookMessage,
  sendWebhookEmbed,
} from '../webhooks'

describe('WebhookClient', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('construction', () => {
    it('should create webhook client', () => {
      const webhook = new WebhookClient({
        id: '123456789',
        token: 'webhook-token'
      })
      expect(webhook).toBeDefined()
    })

    it('should have correct URL', () => {
      const webhook = new WebhookClient({
        id: '123456789',
        token: 'webhook-token'
      })
      expect(webhook.url).toBe('https://discord.com/api/webhooks/123456789/webhook-token')
    })
  })

  describe('send', () => {
    it('should send simple message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({})
      })

      const webhook = new WebhookClient({ id: '123', token: 'token' })
      await webhook.send('Hello!')

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toContain('/webhooks/123/token')
      expect(JSON.parse(fetchCall[1].body).content).toBe('Hello!')
    })

    it('should send message with payload object', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({})
      })

      const webhook = new WebhookClient({ id: '123', token: 'token' })
      await webhook.send({
        content: 'Hello!',
        username: 'Custom Bot',
        avatar_url: 'https://example.com/avatar.png'
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.content).toBe('Hello!')
      expect(body.username).toBe('Custom Bot')
      expect(body.avatar_url).toBe('https://example.com/avatar.png')
    })

    it('should return message when wait=true', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '789',
          content: 'Hello!'
        })
      })

      const webhook = new WebhookClient({ id: '123', token: 'token' })
      const message = await webhook.send('Hello!', { wait: true })

      expect(message?.id).toBe('789')
      expect(message?.content).toBe('Hello!')
    })

    it('should send to thread', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({})
      })

      const webhook = new WebhookClient({ id: '123', token: 'token' })
      await webhook.send('Thread message', { threadId: 'thread123' })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toContain('thread_id=thread123')
    })
  })

  describe('sendAndWait', () => {
    it('should send and return message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '789',
          content: 'Test'
        })
      })

      const webhook = new WebhookClient({ id: '123', token: 'token' })
      const message = await webhook.sendAndWait('Test')

      expect(message.id).toBe('789')
    })
  })

  describe('editMessage', () => {
    it('should edit webhook message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '789',
          content: 'Updated!'
        })
      })

      const webhook = new WebhookClient({ id: '123', token: 'token' })
      const message = await webhook.editMessage('789', 'Updated!')

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toContain('/messages/789')
      expect(fetchCall[1].method).toBe('PATCH')
      expect(message.content).toBe('Updated!')
    })

    it('should edit with payload object', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: '789' })
      })

      const webhook = new WebhookClient({ id: '123', token: 'token' })
      await webhook.editMessage('789', {
        content: 'Updated!',
        embeds: [{ title: 'New embed' }]
      })

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.embeds).toHaveLength(1)
    })
  })

  describe('deleteMessage', () => {
    it('should delete webhook message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({})
      })

      const webhook = new WebhookClient({ id: '123', token: 'token' })
      await webhook.deleteMessage('789')

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[0]).toContain('/messages/789')
      expect(fetchCall[1].method).toBe('DELETE')
    })
  })

  describe('fetchWebhook', () => {
    it('should fetch webhook info', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '123',
          name: 'My Webhook',
          token: 'token'
        })
      })

      const webhook = new WebhookClient({ id: '123', token: 'token' })
      const info = await webhook.fetchWebhook()

      expect(info.name).toBe('My Webhook')
    })
  })

  describe('edit', () => {
    it('should edit webhook', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '123',
          name: 'New Name'
        })
      })

      const webhook = new WebhookClient({ id: '123', token: 'token' })
      const updated = await webhook.edit({ name: 'New Name' })

      expect(updated.name).toBe('New Name')
    })
  })

  describe('delete', () => {
    it('should delete webhook', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({})
      })

      const webhook = new WebhookClient({ id: '123', token: 'token' })
      await webhook.delete()

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[1].method).toBe('DELETE')
    })
  })
})

describe('WebhookPayloadBuilder', () => {
  it('should build basic payload', () => {
    const payload = new WebhookPayloadBuilder()
      .setContent('Hello!')

    const json = payload.toJSON()
    expect(json.content).toBe('Hello!')
  })

  it('should set username override', () => {
    const payload = new WebhookPayloadBuilder()
      .setUsername('Custom Bot')

    const json = payload.toJSON()
    expect(json.username).toBe('Custom Bot')
  })

  it('should set avatar URL override', () => {
    const payload = new WebhookPayloadBuilder()
      .setAvatarURL('https://example.com/avatar.png')

    const json = payload.toJSON()
    expect(json.avatar_url).toBe('https://example.com/avatar.png')
  })

  it('should set TTS', () => {
    const payload = new WebhookPayloadBuilder()
      .setTTS(true)

    const json = payload.toJSON()
    expect(json.tts).toBe(true)
  })

  it('should set embeds', () => {
    const payload = new WebhookPayloadBuilder()
      .setEmbeds([{ title: 'Test' }])

    const json = payload.toJSON()
    expect(json.embeds).toHaveLength(1)
  })

  it('should add embeds', () => {
    const payload = new WebhookPayloadBuilder()
      .addEmbeds({ title: 'First' })
      .addEmbeds({ title: 'Second' })

    const json = payload.toJSON()
    expect(json.embeds).toHaveLength(2)
  })

  it('should set components', () => {
    const payload = new WebhookPayloadBuilder()
      .setComponents([{ type: 1, components: [] }])

    const json = payload.toJSON()
    expect(json.components).toHaveLength(1)
  })

  it('should add components', () => {
    const payload = new WebhookPayloadBuilder()
      .addComponents({ type: 1, components: [] })
      .addComponents({ type: 1, components: [] })

    const json = payload.toJSON()
    expect(json.components).toHaveLength(2)
  })

  it('should set allowed mentions', () => {
    const payload = new WebhookPayloadBuilder()
      .setAllowedMentions({ parse: [] })

    const json = payload.toJSON()
    expect(json.allowed_mentions?.parse).toEqual([])
  })

  it('should set flags', () => {
    const payload = new WebhookPayloadBuilder()
      .setFlags(4)

    const json = payload.toJSON()
    expect(json.flags).toBe(4)
  })

  it('should suppress embeds', () => {
    const payload = new WebhookPayloadBuilder()
      .setSuppressEmbeds()

    const json = payload.toJSON()
    expect(json.flags! & 4).toBe(4)
  })

  it('should set thread name', () => {
    const payload = new WebhookPayloadBuilder()
      .setThreadName('New Thread')

    const json = payload.toJSON()
    expect(json.thread_name).toBe('New Thread')
  })
})

describe('parseWebhookUrl', () => {
  it('should parse valid webhook URL', () => {
    const { id, token } = parseWebhookUrl(
      'https://discord.com/api/webhooks/123456789/abcdef123456'
    )
    expect(id).toBe('123456789')
    expect(token).toBe('abcdef123456')
  })

  it('should parse URL with additional path', () => {
    const { id, token } = parseWebhookUrl(
      'https://discord.com/api/webhooks/123/token?wait=true'
    )
    expect(id).toBe('123')
    expect(token).toBe('token')
  })

  it('should throw for invalid URL', () => {
    expect(() => parseWebhookUrl('https://example.com')).toThrow('Invalid webhook URL')
    expect(() => parseWebhookUrl('not a url')).toThrow('Invalid webhook URL')
  })
})

describe('createWebhookFromUrl', () => {
  it('should create webhook client from URL', () => {
    const webhook = createWebhookFromUrl(
      'https://discord.com/api/webhooks/123456789/token123'
    )
    expect(webhook).toBeInstanceOf(WebhookClient)
    expect(webhook.url).toContain('123456789')
    expect(webhook.url).toContain('token123')
  })
})

describe('Helper Functions', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => ({})
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('sendWebhookMessage', () => {
    it('should send simple message', async () => {
      await sendWebhookMessage(
        'https://discord.com/api/webhooks/123/token',
        'Hello!'
      )

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(JSON.parse(fetchCall[1].body).content).toBe('Hello!')
    })

    it('should send payload object', async () => {
      await sendWebhookMessage(
        'https://discord.com/api/webhooks/123/token',
        { content: 'Hello!', username: 'Bot' }
      )

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.username).toBe('Bot')
    })
  })

  describe('sendWebhookEmbed', () => {
    it('should send embeds', async () => {
      await sendWebhookEmbed(
        'https://discord.com/api/webhooks/123/token',
        [{ title: 'Test' }]
      )

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.embeds).toHaveLength(1)
    })

    it('should send embeds with options', async () => {
      await sendWebhookEmbed(
        'https://discord.com/api/webhooks/123/token',
        [{ title: 'Test' }],
        { username: 'Custom' }
      )

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)
      expect(body.username).toBe('Custom')
    })
  })
})

describe('WebhookManager', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('create', () => {
    it('should create webhook', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: '123',
          name: 'Test Hook',
          token: 'token'
        })
      })

      const manager = new WebhookManager('bot-token')
      const webhook = await manager.create('channel123', { name: 'Test Hook' })

      expect(webhook.name).toBe('Test Hook')
      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[1].headers.Authorization).toBe('Bot bot-token')
    })
  })

  describe('getChannelWebhooks', () => {
    it('should get channel webhooks', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ([
          { id: '1', name: 'Hook 1' },
          { id: '2', name: 'Hook 2' }
        ])
      })

      const manager = new WebhookManager('bot-token')
      const webhooks = await manager.getChannelWebhooks('channel123')

      expect(webhooks).toHaveLength(2)
    })
  })

  describe('get', () => {
    it('should get webhook by ID', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: '123', name: 'Hook' })
      })

      const manager = new WebhookManager('bot-token')
      const webhook = await manager.get('123')

      expect(webhook.id).toBe('123')
    })
  })

  describe('modify', () => {
    it('should modify webhook', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: '123', name: 'New Name' })
      })

      const manager = new WebhookManager('bot-token')
      const webhook = await manager.modify('123', { name: 'New Name' })

      expect(webhook.name).toBe('New Name')
    })
  })

  describe('delete', () => {
    it('should delete webhook', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({})
      })

      const manager = new WebhookManager('bot-token')
      await manager.delete('123')

      const fetchCall = (globalThis.fetch as any).mock.calls[0]
      expect(fetchCall[1].method).toBe('DELETE')
    })
  })
})
