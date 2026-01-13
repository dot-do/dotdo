import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ChatChannel,
  createChatChannel,
  type ChatChannelConfig,
  type ChatWebhookPayload,
} from '../chat'

describe('Chat Channel', () => {
  describe('Configuration Validation', () => {
    it('should throw if webhook provider missing webhookUrl', () => {
      expect(() => {
        new ChatChannel({
          provider: 'webhook',
        })
      }).toThrow('webhookUrl')
    })

    it('should throw if WhatsApp config is incomplete', () => {
      expect(() => {
        new ChatChannel({
          provider: 'whatsapp',
        })
      }).toThrow('phoneNumberId and accessToken')
    })

    it('should throw if Telegram botToken is missing', () => {
      expect(() => {
        new ChatChannel({
          provider: 'telegram',
        })
      }).toThrow('botToken')
    })

    it('should throw if Intercom accessToken is missing', () => {
      expect(() => {
        new ChatChannel({
          provider: 'intercom',
        })
      }).toThrow('accessToken')
    })

    it('should accept mock provider without config', () => {
      expect(() => {
        new ChatChannel({ provider: 'mock' })
      }).not.toThrow()
    })

    it('should accept valid webhook config', () => {
      expect(() => {
        new ChatChannel({
          provider: 'webhook',
          webhookUrl: 'https://chat.example.com/api/send',
        })
      }).not.toThrow()
    })
  })

  describe('send() - Webhook', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messageId: 'msg_123' }),
      })
    })

    it('should send message via webhook', async () => {
      const channel = new ChatChannel({
        provider: 'webhook',
        webhookUrl: 'https://chat.example.com/api/send',
        fetch: mockFetch,
      })

      const result = await channel.send({
        message: 'Hello!',
        conversationId: 'conv-123',
      })

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBe('msg_123')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://chat.example.com/api/send',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      )
    })

    it('should include bearer auth header', async () => {
      const channel = new ChatChannel({
        provider: 'webhook',
        webhookUrl: 'https://chat.example.com/api/send',
        webhookAuth: { type: 'bearer', token: 'secret123' },
        fetch: mockFetch,
      })

      await channel.send({ message: 'Test' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer secret123',
          }),
        })
      )
    })

    it('should include basic auth header', async () => {
      const channel = new ChatChannel({
        provider: 'webhook',
        webhookUrl: 'https://chat.example.com/api/send',
        webhookAuth: { type: 'basic', username: 'user', password: 'pass' },
        fetch: mockFetch,
      })

      await channel.send({ message: 'Test' })

      const expectedAuth = `Basic ${btoa('user:pass')}`
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expectedAuth,
          }),
        })
      )
    })

    it('should include API key header', async () => {
      const channel = new ChatChannel({
        provider: 'webhook',
        webhookUrl: 'https://chat.example.com/api/send',
        webhookAuth: { type: 'api_key', key: 'apikey123', header: 'X-Custom-Key' },
        fetch: mockFetch,
      })

      await channel.send({ message: 'Test' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Custom-Key': 'apikey123',
          }),
        })
      )
    })

    it('should include custom headers', async () => {
      const channel = new ChatChannel({
        provider: 'webhook',
        webhookUrl: 'https://chat.example.com/api/send',
        customHeaders: { 'X-Tenant-Id': 'tenant-123' },
        fetch: mockFetch,
      })

      await channel.send({ message: 'Test' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Tenant-Id': 'tenant-123',
          }),
        })
      )
    })

    it('should handle webhook errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Server error' }),
      })

      const channel = new ChatChannel({
        provider: 'webhook',
        webhookUrl: 'https://chat.example.com/api/send',
        fetch: mockFetch,
      })

      await expect(channel.send({ message: 'Test' })).rejects.toThrow('Webhook error')
    })

    it('should use test mode for test URLs', async () => {
      const channel = new ChatChannel({
        provider: 'webhook',
        webhookUrl: 'https://test.example.com/api/send',
        fetch: mockFetch,
      })

      const result = await channel.send({ message: 'Test' })

      expect(result.delivered).toBe(true)
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('send() - WhatsApp', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [{ id: 'wa_msg_123' }] }),
      })
    })

    it('should send message via WhatsApp', async () => {
      const channel = new ChatChannel({
        provider: 'whatsapp',
        whatsapp: {
          phoneNumberId: '123456789',
          accessToken: 'live_token',
        },
        fetch: mockFetch,
      })

      const result = await channel.send({
        message: 'Hello!',
        userId: '+15551234567',
      })

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBe('wa_msg_123')
      expect(result.provider).toBe('whatsapp')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://graph.facebook.com/v17.0/123456789/messages',
        expect.anything()
      )
    })

    it('should use test mode with test credentials', async () => {
      const channel = new ChatChannel({
        provider: 'whatsapp',
        whatsapp: {
          phoneNumberId: '123456789',
          accessToken: 'test_token',
        },
        fetch: mockFetch,
      })

      const result = await channel.send({
        message: 'Test',
        userId: '+15551234567',
      })

      expect(result.delivered).toBe(true)
      expect(result.messageId).toContain('wa_test_')
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('send() - Telegram', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: { message_id: 12345 } }),
      })
    })

    it('should send message via Telegram', async () => {
      const channel = new ChatChannel({
        provider: 'telegram',
        telegram: { botToken: 'bot123:ABC' },
        fetch: mockFetch,
      })

      const result = await channel.send({
        message: 'Hello!',
        conversationId: '987654321',
      })

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBe('12345')
      expect(result.provider).toBe('telegram')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.telegram.org/botbot123:ABC/sendMessage',
        expect.anything()
      )
    })

    it('should use configured chatId if not provided', async () => {
      const channel = new ChatChannel({
        provider: 'telegram',
        telegram: { botToken: 'bot123:ABC', chatId: '111222333' },
        fetch: mockFetch,
      })

      await channel.send({ message: 'Test' })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.chat_id).toBe('111222333')
    })

    it('should throw if no chat ID available', async () => {
      const channel = new ChatChannel({
        provider: 'telegram',
        telegram: { botToken: 'bot123:ABC' },
        fetch: mockFetch,
      })

      await expect(channel.send({ message: 'Test' })).rejects.toThrow(
        'conversationId, userId, or configured chatId'
      )
    })
  })

  describe('send() - Intercom', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'ic_msg_123' }),
      })
    })

    it('should send message via Intercom', async () => {
      const channel = new ChatChannel({
        provider: 'intercom',
        intercom: { accessToken: 'live_token', adminId: 'admin_123' },
        fetch: mockFetch,
      })

      const result = await channel.send({
        message: 'Hello!',
        conversationId: 'conv-456',
      })

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBe('ic_msg_123')
      expect(result.provider).toBe('intercom')
    })
  })

  describe('send() - Mock', () => {
    it('should send via mock provider', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const channel = new ChatChannel({ provider: 'mock' })

      const result = await channel.send({
        message: 'Test message',
        conversationId: 'conv-123',
      })

      expect(result.delivered).toBe(true)
      expect(result.messageId).toMatch(/^msg_/)
      expect(result.provider).toBe('mock')
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('sendWithActions()', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messageId: 'msg_123' }),
      })
    })

    it('should send message with actions via webhook', async () => {
      const channel = new ChatChannel({
        provider: 'webhook',
        webhookUrl: 'https://chat.example.com/api/send',
        fetch: mockFetch,
      })

      const result = await channel.sendWithActions({
        message: 'Would you like to proceed?',
        conversationId: 'conv-123',
        actions: [
          { label: 'Yes', value: 'confirm', style: 'primary' },
          { label: 'No', value: 'cancel', style: 'danger' },
        ],
        requestId: 'req-456',
      })

      expect(result.delivered).toBe(true)

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.type).toBe('rich')
      expect(body.metadata.actions).toHaveLength(2)
      expect(body.metadata.requestId).toBe('req-456')
    })

    it('should send Telegram message with inline keyboard', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ result: { message_id: 12345 } }),
      })

      const channel = new ChatChannel({
        provider: 'telegram',
        telegram: { botToken: 'bot123:ABC', chatId: '111' },
        fetch: mockFetch,
      })

      await channel.sendWithActions({
        message: 'Choose an option',
        actions: [
          { label: 'Option A', value: 'a' },
          { label: 'Option B', value: 'b' },
        ],
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.reply_markup).toBeDefined()
      expect(body.reply_markup.inline_keyboard).toBeDefined()
    })

    it('should limit WhatsApp to 3 buttons', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [{ id: 'wa_msg' }] }),
      })

      const channel = new ChatChannel({
        provider: 'whatsapp',
        whatsapp: { phoneNumberId: '123', accessToken: 'live_token' },
        fetch: mockFetch,
      })

      await channel.sendWithActions({
        message: 'Choose',
        userId: '+15551234567',
        actions: [
          { label: 'One', value: '1' },
          { label: 'Two', value: '2' },
          { label: 'Three', value: '3' },
          { label: 'Four', value: '4' }, // Should be excluded
        ],
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.interactive.action.buttons).toHaveLength(3)
    })
  })

  describe('sendForm()', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messageId: 'msg_123' }),
      })
    })

    it('should send form request', async () => {
      const channel = new ChatChannel({
        provider: 'webhook',
        webhookUrl: 'https://chat.example.com/api/send',
        fetch: mockFetch,
      })

      await channel.sendForm({
        message: 'Please fill out this form',
        conversationId: 'conv-123',
        fields: [
          { name: 'email', label: 'Email', type: 'email', required: true },
          { name: 'phone', label: 'Phone', type: 'phone' },
        ],
        submitLabel: 'Submit Request',
        requestId: 'req-789',
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.type).toBe('rich')
      expect(body.metadata.form.fields).toHaveLength(2)
      expect(body.metadata.form.submitLabel).toBe('Submit Request')
      expect(body.metadata.requestId).toBe('req-789')
    })
  })

  describe('handleWebhook()', () => {
    let channel: ChatChannel

    beforeEach(() => {
      channel = new ChatChannel({ provider: 'mock' })
    })

    it('should parse incoming message webhook', () => {
      const response = channel.handleWebhook({
        messageId: 'msg_123',
        conversationId: 'conv-456',
        userId: 'user_789',
        message: 'Hello!',
      })

      expect(response.type).toBe('message')
      expect(response.messageId).toBe('msg_123')
      expect(response.conversationId).toBe('conv-456')
      expect(response.userId).toBe('user_789')
      expect(response.content).toBe('Hello!')
    })

    it('should parse action webhook', () => {
      const response = channel.handleWebhook({
        conversationId: 'conv-456',
        userId: 'user_789',
        action: 'confirm',
        requestId: 'req-123',
      })

      expect(response.type).toBe('action')
      expect(response.action).toBe('confirm')
      expect(response.requestId).toBe('req-123')
    })

    it('should parse form submission webhook', () => {
      const response = channel.handleWebhook({
        conversationId: 'conv-456',
        userId: 'user_789',
        requestId: 'req-123',
        formData: { email: 'test@example.com', phone: '+15551234567' },
      })

      expect(response.type).toBe('form')
      expect(response.formData).toEqual({
        email: 'test@example.com',
        phone: '+15551234567',
      })
    })

    it('should handle different content field names', () => {
      expect(channel.handleWebhook({ message: 'Test 1' }).content).toBe('Test 1')
      expect(channel.handleWebhook({ content: 'Test 2' }).content).toBe('Test 2')
      expect(channel.handleWebhook({ text: 'Test 3' }).content).toBe('Test 3')
      expect(channel.handleWebhook({ body: 'Test 4' }).content).toBe('Test 4')
    })

    it('should handle actionValue alias', () => {
      const response = channel.handleWebhook({
        actionValue: 'approve',
      })

      expect(response.type).toBe('action')
      expect(response.action).toBe('approve')
    })

    it('should parse timestamp', () => {
      const now = Date.now()
      const response = channel.handleWebhook({
        message: 'Test',
        timestamp: now,
      })

      expect(response.timestamp.getTime()).toBe(now)
    })
  })

  describe('createChatChannel()', () => {
    it('should create a chat channel instance', () => {
      const channel = createChatChannel({
        provider: 'mock',
      })

      expect(channel).toBeInstanceOf(ChatChannel)
    })
  })
})
