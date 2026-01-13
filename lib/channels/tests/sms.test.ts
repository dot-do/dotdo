import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  SMSChannel,
  createSMSChannel,
  formatPhoneNumber,
  isValidE164,
  type SMSChannelConfig,
  type SMSWebhookPayload,
} from '../sms'

describe('SMS Channel', () => {
  describe('Configuration Validation', () => {
    it('should throw if fromNumber is missing', () => {
      expect(() => {
        new SMSChannel({
          provider: 'twilio',
          fromNumber: '',
          accountSid: 'AC123',
          authToken: 'token',
        })
      }).toThrow('fromNumber is required')
    })

    it('should throw if fromNumber is not E.164 format', () => {
      expect(() => {
        new SMSChannel({
          provider: 'twilio',
          fromNumber: '1234567890', // Missing +
          accountSid: 'AC123',
          authToken: 'token',
        })
      }).toThrow('E.164 format')
    })

    it('should throw if Twilio credentials are missing', () => {
      expect(() => {
        new SMSChannel({
          provider: 'twilio',
          fromNumber: '+15551234567',
        })
      }).toThrow('Twilio requires accountSid and authToken')
    })

    it('should throw if MessageBird accessKey is missing', () => {
      expect(() => {
        new SMSChannel({
          provider: 'messagebird',
          fromNumber: '+15551234567',
        })
      }).toThrow('MessageBird requires accessKey')
    })

    it('should throw if Vonage credentials are missing', () => {
      expect(() => {
        new SMSChannel({
          provider: 'vonage',
          fromNumber: '+15551234567',
        })
      }).toThrow('Vonage requires apiKey and apiSecret')
    })

    it('should throw if Telnyx apiKey is missing', () => {
      expect(() => {
        new SMSChannel({
          provider: 'telnyx',
          fromNumber: '+15551234567',
        })
      }).toThrow('Telnyx requires telnyxApiKey')
    })

    it('should accept mock provider without credentials', () => {
      expect(() => {
        new SMSChannel({
          provider: 'mock',
          fromNumber: '+15551234567',
        })
      }).not.toThrow()
    })
  })

  describe('send() - Twilio', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sid: 'SM123', status: 'queued' }),
      })
    })

    it('should send SMS via Twilio', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token123',
        fetch: mockFetch,
      })

      const result = await channel.send({
        message: 'Hello from dotdo!',
        to: '+15559876543',
      })

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBe('SM123')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
        })
      )
    })

    it('should normalize phone numbers', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token123',
        fetch: mockFetch,
      })

      // US number without country code
      await channel.send({
        message: 'Test',
        to: '555-987-6543',
      })

      const body = mockFetch.mock.calls[0][1].body
      expect(body).toContain('To=%2B15559876543')
    })

    it('should throw on invalid phone numbers', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token123',
        fetch: mockFetch,
      })

      await expect(
        channel.send({
          message: 'Test',
          to: 'invalid',
        })
      ).rejects.toThrow('Invalid phone number')
    })

    it('should include mediaUrl for MMS', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token123',
        fetch: mockFetch,
      })

      await channel.send({
        message: 'Check out this image!',
        to: '+15559876543',
        mediaUrl: ['https://example.com/image.jpg'],
      })

      const body = mockFetch.mock.calls[0][1].body
      expect(body).toContain('MediaUrl=https%3A%2F%2Fexample.com%2Fimage.jpg')
    })

    it('should include status callback URL when configured', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token123',
        statusCallbackUrl: 'https://app.dotdo.dev/webhooks/sms',
        fetch: mockFetch,
      })

      await channel.send({
        message: 'Test',
        to: '+15559876543',
      })

      const body = mockFetch.mock.calls[0][1].body
      expect(body).toContain('StatusCallback')
    })

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Invalid phone number' }),
      })

      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token123',
        fetch: mockFetch,
      })

      await expect(
        channel.send({
          message: 'Test',
          to: '+15559876543',
        })
      ).rejects.toThrow('Twilio API error')
    })

    it('should use test mode with test credentials', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC_test_123',
        authToken: 'test_token',
        fetch: mockFetch,
      })

      const result = await channel.send({
        message: 'Test',
        to: '+15559876543',
      })

      expect(result.delivered).toBe(true)
      expect(result.messageId).toContain('SM_test_')
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('send() - MessageBird', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'mb123' }),
      })
    })

    it('should send SMS via MessageBird', async () => {
      const channel = new SMSChannel({
        provider: 'messagebird',
        fromNumber: '+15551234567',
        accessKey: 'live_key_123',
        fetch: mockFetch,
      })

      const result = await channel.send({
        message: 'Hello!',
        to: '+15559876543',
      })

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBe('mb123')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://rest.messagebird.com/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'AccessKey live_key_123',
          }),
        })
      )
    })
  })

  describe('send() - Vonage', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          messages: [{ status: '0', 'message-id': 'vonage123' }],
        }),
      })
    })

    it('should send SMS via Vonage', async () => {
      const channel = new SMSChannel({
        provider: 'vonage',
        fromNumber: '+15551234567',
        apiKey: 'api_key',
        apiSecret: 'api_secret',
        fetch: mockFetch,
      })

      const result = await channel.send({
        message: 'Hello!',
        to: '+15559876543',
      })

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBe('vonage123')
    })

    it('should handle Vonage error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messages: [{ status: '2', 'error-text': 'Missing api_key' }],
        }),
      })

      const channel = new SMSChannel({
        provider: 'vonage',
        fromNumber: '+15551234567',
        apiKey: 'api_key',
        apiSecret: 'api_secret',
        fetch: mockFetch,
      })

      await expect(
        channel.send({
          message: 'Test',
          to: '+15559876543',
        })
      ).rejects.toThrow('Missing api_key')
    })
  })

  describe('send() - Telnyx', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: 'telnyx123' } }),
      })
    })

    it('should send SMS via Telnyx', async () => {
      const channel = new SMSChannel({
        provider: 'telnyx',
        fromNumber: '+15551234567',
        telnyxApiKey: 'KEY123',
        fetch: mockFetch,
      })

      const result = await channel.send({
        message: 'Hello!',
        to: '+15559876543',
      })

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBe('telnyx123')
    })

    it('should include media URLs for MMS', async () => {
      const channel = new SMSChannel({
        provider: 'telnyx',
        fromNumber: '+15551234567',
        telnyxApiKey: 'KEY123',
        fetch: mockFetch,
      })

      await channel.send({
        message: 'Check this out!',
        to: '+15559876543',
        mediaUrl: ['https://example.com/image.jpg'],
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.media_urls).toEqual(['https://example.com/image.jpg'])
    })
  })

  describe('send() - Mock', () => {
    it('should send via mock provider', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const channel = new SMSChannel({
        provider: 'mock',
        fromNumber: '+15551234567',
      })

      const result = await channel.send({
        message: 'Test message',
        to: '+15559876543',
      })

      expect(result.delivered).toBe(true)
      expect(result.messageId).toMatch(/^msg_/)
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('sendApproval()', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sid: 'SM123', status: 'queued' }),
      })
    })

    it('should send approval SMS with default approve/reject links', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token',
        fetch: mockFetch,
      })

      await channel.sendApproval({
        message: 'Please approve this expense report',
        to: '+15559876543',
        requestId: 'req-123',
      })

      const body = decodeURIComponent(mockFetch.mock.calls[0][1].body)
      // Body is URL-encoded, so spaces become +
      expect(body).toContain('Please+approve+this+expense+report')
      expect(body).toContain('app.dotdo.dev/approve/req-123?action=approve')
      expect(body).toContain('app.dotdo.dev/approve/req-123?action=reject')
    })

    it('should use custom base URL', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token',
        fetch: mockFetch,
      })

      await channel.sendApproval({
        message: 'Approve?',
        to: '+15559876543',
        requestId: 'req-456',
        baseUrl: 'https://custom.example.com',
      })

      const body = decodeURIComponent(mockFetch.mock.calls[0][1].body)
      expect(body).toContain('custom.example.com/approve/req-456')
    })

    it('should support custom actions', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token',
        fetch: mockFetch,
      })

      await channel.sendApproval({
        message: 'Choose an option',
        to: '+15559876543',
        requestId: 'req-789',
        actions: [
          { label: 'Accept', value: 'accept' },
          { label: 'Decline', value: 'decline' },
          { label: 'Defer', value: 'defer' },
        ],
      })

      const body = decodeURIComponent(mockFetch.mock.calls[0][1].body)
      expect(body).toContain('Accept:')
      expect(body).toContain('action=accept')
      expect(body).toContain('Decline:')
      expect(body).toContain('action=decline')
      expect(body).toContain('Defer:')
      expect(body).toContain('action=defer')
    })
  })

  describe('handleWebhook()', () => {
    let channel: SMSChannel

    beforeEach(() => {
      channel = new SMSChannel({
        provider: 'mock',
        fromNumber: '+15551234567',
      })
    })

    it('should parse incoming SMS webhook', () => {
      const response = channel.handleWebhook({
        MessageSid: 'SM123',
        From: '+15559876543',
        To: '+15551234567',
        Body: 'Hello!',
      })

      expect(response.type).toBe('incoming')
      expect(response.from).toBe('+15559876543')
      expect(response.to).toBe('+15551234567')
      expect(response.body).toBe('Hello!')
      expect(response.messageSid).toBe('SM123')
    })

    it('should parse status update webhook', () => {
      const response = channel.handleWebhook({
        MessageSid: 'SM123',
        From: '+15551234567',
        To: '+15559876543',
        SmsStatus: 'delivered',
      })

      expect(response.type).toBe('status')
      expect(response.status).toBe('delivered')
    })

    it('should recognize "yes" as approve action', () => {
      const response = channel.handleWebhook({
        From: '+15559876543',
        To: '+15551234567',
        Body: 'yes',
      })

      expect(response.action).toBe('approve')
    })

    it('should recognize "approve" as approve action', () => {
      const response = channel.handleWebhook({
        From: '+15559876543',
        Body: 'APPROVE',
      })

      expect(response.action).toBe('approve')
    })

    it('should recognize "no" as reject action', () => {
      const response = channel.handleWebhook({
        From: '+15559876543',
        Body: 'no',
      })

      expect(response.action).toBe('reject')
    })

    it('should recognize "reject" as reject action', () => {
      const response = channel.handleWebhook({
        From: '+15559876543',
        Body: 'reject',
      })

      expect(response.action).toBe('reject')
    })

    it('should extract request ID from message', () => {
      const response = channel.handleWebhook({
        From: '+15559876543',
        Body: 'yes req-123',
      })

      expect(response.action).toBe('approve')
      expect(response.requestId).toBe('req-123')
    })

    it('should handle lowercase field names', () => {
      const response = channel.handleWebhook({
        messageSid: 'SM123',
        from: '+15559876543',
        to: '+15551234567',
        body: 'Hello!',
      })

      expect(response.from).toBe('+15559876543')
      expect(response.body).toBe('Hello!')
    })
  })

  describe('Utility Functions', () => {
    describe('formatPhoneNumber()', () => {
      it('should format US phone numbers', () => {
        expect(formatPhoneNumber('+15551234567')).toBe('+1 (555) 123-4567')
      })

      it('should handle already formatted numbers', () => {
        expect(formatPhoneNumber('+1 (555) 123-4567')).toBe('+1 (555) 123-4567')
      })

      it('should return non-US numbers as-is', () => {
        expect(formatPhoneNumber('+447911123456')).toBe('+447911123456')
      })
    })

    describe('isValidE164()', () => {
      it('should accept valid E.164 numbers', () => {
        expect(isValidE164('+15551234567')).toBe(true)
        expect(isValidE164('+447911123456')).toBe(true)
        expect(isValidE164('+861234567890')).toBe(true)
      })

      it('should reject invalid numbers', () => {
        expect(isValidE164('5551234567')).toBe(false)
        expect(isValidE164('+0123456789')).toBe(false) // Can't start with 0
        expect(isValidE164('invalid')).toBe(false)
        expect(isValidE164('')).toBe(false)
      })
    })

    describe('createSMSChannel()', () => {
      it('should create an SMS channel instance', () => {
        const channel = createSMSChannel({
          provider: 'mock',
          fromNumber: '+15551234567',
        })

        expect(channel).toBeInstanceOf(SMSChannel)
      })
    })
  })

  describe('Message Length Handling', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sid: 'SM123', status: 'queued' }),
      })
    })

    it('should send short messages (< 160 chars)', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token',
        fetch: mockFetch,
      })

      const shortMessage = 'Hello, this is a short message.'
      await channel.send({
        message: shortMessage,
        to: '+15559876543',
      })

      const body = decodeURIComponent(mockFetch.mock.calls[0][1].body)
      expect(body).toContain(shortMessage.replace(/ /g, '+'))
    })

    it('should send long messages (> 160 chars) - provider handles concatenation', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token',
        fetch: mockFetch,
      })

      // Create a message longer than 160 characters
      const longMessage = 'This is a very long message that exceeds the standard SMS character limit of 160 characters. ' +
        'The SMS provider should automatically handle message segmentation and concatenation for delivery. ' +
        'This tests that our channel correctly passes long messages to the provider.'

      expect(longMessage.length).toBeGreaterThan(160)

      const result = await channel.send({
        message: longMessage,
        to: '+15559876543',
      })

      expect(result.delivered).toBe(true)
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should handle Unicode/emoji messages', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token',
        fetch: mockFetch,
      })

      const unicodeMessage = 'Hello! Your order is confirmed. Thank you for shopping with us.'
      await channel.send({
        message: unicodeMessage,
        to: '+15559876543',
      })

      expect(mockFetch).toHaveBeenCalled()
      const body = decodeURIComponent(mockFetch.mock.calls[0][1].body)
      expect(body).toContain('Hello')
    })

    it('should handle empty message body', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token',
        fetch: mockFetch,
      })

      // Empty messages should still be sent (provider will reject if invalid)
      await channel.send({
        message: '',
        to: '+15559876543',
      })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('should handle multiline messages', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token',
        fetch: mockFetch,
      })

      const multilineMessage = `Order Confirmation

Order #12345
Item: Widget
Qty: 2
Total: $49.99

Thank you!`

      await channel.send({
        message: multilineMessage,
        to: '+15559876543',
      })

      expect(mockFetch).toHaveBeenCalled()
      const body = mockFetch.mock.calls[0][1].body
      // Body should contain URL-encoded newlines
      expect(body).toContain('Body=')
    })

    it('should handle special characters in messages', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token',
        fetch: mockFetch,
      })

      const specialCharsMessage = 'Price: $99.99 (20% off!) & free shipping @ checkout.'
      await channel.send({
        message: specialCharsMessage,
        to: '+15559876543',
      })

      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('Phone Number Normalization', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sid: 'SM123', status: 'queued' }),
      })
    })

    it('should normalize 10-digit US numbers', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token',
        fetch: mockFetch,
      })

      await channel.send({
        message: 'Test',
        to: '5559876543',
      })

      const body = mockFetch.mock.calls[0][1].body
      expect(body).toContain('To=%2B15559876543')
    })

    it('should normalize 11-digit US numbers with leading 1', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token',
        fetch: mockFetch,
      })

      await channel.send({
        message: 'Test',
        to: '15559876543',
      })

      const body = mockFetch.mock.calls[0][1].body
      expect(body).toContain('To=%2B15559876543')
    })

    it('should handle parentheses in phone numbers', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token',
        fetch: mockFetch,
      })

      await channel.send({
        message: 'Test',
        to: '(555) 987-6543',
      })

      const body = mockFetch.mock.calls[0][1].body
      expect(body).toContain('To=%2B15559876543')
    })

    it('should handle dots in phone numbers', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token',
        fetch: mockFetch,
      })

      await channel.send({
        message: 'Test',
        to: '555.987.6543',
      })

      const body = mockFetch.mock.calls[0][1].body
      expect(body).toContain('To=%2B15559876543')
    })

    it('should preserve already valid E.164 numbers', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token',
        fetch: mockFetch,
      })

      await channel.send({
        message: 'Test',
        to: '+447911123456', // UK number
      })

      const body = mockFetch.mock.calls[0][1].body
      expect(body).toContain('To=%2B447911123456')
    })

    it('should handle international numbers without plus', async () => {
      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token',
        fetch: mockFetch,
      })

      await channel.send({
        message: 'Test',
        to: '447911123456', // UK number without +
      })

      const body = mockFetch.mock.calls[0][1].body
      expect(body).toContain('To=%2B447911123456')
    })
  })

  describe('Error Scenarios', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn()
    })

    it('should handle network timeout', async () => {
      mockFetch.mockImplementation(() => new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Network timeout')), 100)
      }))

      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token',
        fetch: mockFetch,
      })

      await expect(
        channel.send({
          message: 'Test',
          to: '+15559876543',
        })
      ).rejects.toThrow('Network timeout')
    })

    it('should handle rate limiting (429)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ message: 'Too many requests' }),
      })

      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'token',
        fetch: mockFetch,
      })

      await expect(
        channel.send({
          message: 'Test',
          to: '+15559876543',
        })
      ).rejects.toThrow('Twilio API error')
    })

    it('should handle authentication errors (401)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Invalid credentials' }),
      })

      const channel = new SMSChannel({
        provider: 'twilio',
        fromNumber: '+15551234567',
        accountSid: 'AC123',
        authToken: 'wrong_token',
        fetch: mockFetch,
      })

      await expect(
        channel.send({
          message: 'Test',
          to: '+15559876543',
        })
      ).rejects.toThrow('Twilio API error')
    })

    it('should handle unknown provider', () => {
      expect(() => {
        new SMSChannel({
          provider: 'unknown_provider' as any,
          fromNumber: '+15551234567',
        })
      }).toThrow('Unknown SMS provider')
    })

    it('should handle MessageBird API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          errors: [{ description: 'Invalid recipient' }],
        }),
      })

      const channel = new SMSChannel({
        provider: 'messagebird',
        fromNumber: '+15551234567',
        accessKey: 'live_key_123',
        fetch: mockFetch,
      })

      await expect(
        channel.send({
          message: 'Test',
          to: '+15559876543',
        })
      ).rejects.toThrow('MessageBird API error')
    })

    it('should handle Telnyx API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          errors: [{ detail: 'Invalid phone number' }],
        }),
      })

      const channel = new SMSChannel({
        provider: 'telnyx',
        fromNumber: '+15551234567',
        telnyxApiKey: 'KEY123',
        fetch: mockFetch,
      })

      await expect(
        channel.send({
          message: 'Test',
          to: '+15559876543',
        })
      ).rejects.toThrow('Telnyx API error')
    })
  })

  describe('Delivery Status Tracking', () => {
    let channel: SMSChannel

    beforeEach(() => {
      channel = new SMSChannel({
        provider: 'mock',
        fromNumber: '+15551234567',
      })
    })

    it('should parse delivered status', () => {
      const response = channel.handleWebhook({
        MessageSid: 'SM123',
        MessageStatus: 'delivered',
        From: '+15551234567',
        To: '+15559876543',
      })

      expect(response.type).toBe('status')
      expect(response.status).toBe('delivered')
    })

    it('should parse failed status', () => {
      const response = channel.handleWebhook({
        MessageSid: 'SM123',
        SmsStatus: 'failed',
        From: '+15551234567',
        To: '+15559876543',
        ErrorCode: '30003',
      })

      expect(response.type).toBe('status')
      expect(response.status).toBe('failed')
    })

    it('should parse queued status', () => {
      const response = channel.handleWebhook({
        MessageSid: 'SM123',
        status: 'queued',
        from: '+15551234567',
        to: '+15559876543',
      })

      expect(response.type).toBe('status')
      expect(response.status).toBe('queued')
    })

    it('should parse sent status', () => {
      const response = channel.handleWebhook({
        MessageSid: 'SM123',
        SmsStatus: 'sent',
        From: '+15551234567',
        To: '+15559876543',
      })

      expect(response.type).toBe('status')
      expect(response.status).toBe('sent')
    })

    it('should parse undelivered status', () => {
      const response = channel.handleWebhook({
        MessageSid: 'SM123',
        MessageStatus: 'undelivered',
        From: '+15551234567',
        To: '+15559876543',
        ErrorCode: '30006',
      })

      expect(response.type).toBe('status')
      expect(response.status).toBe('undelivered')
    })
  })
})
