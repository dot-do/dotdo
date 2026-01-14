/**
 * @dotdo/twilio/sms - TDD RED Tests for Twilio SMS Compatibility
 *
 * Failing tests for SMS functionality:
 * 1. Send SMS messages
 * 2. MMS with media
 * 3. Message status tracking
 * 4. Webhooks (delivery receipts, inbound)
 * 5. Rate limiting
 * 6. Batch sending
 *
 * Issue: dotdo-xmwit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  TwilioSMS,
  TwilioSMSError,
  RateLimitError,
  createTwilioSMS,
  type SMSSendRequest,
  type SMSSendResponse,
  type SMSStatusEntry,
  type RateLimitConfig,
  type TwilioSMSConfig,
} from '../src/sms'
import type { Message, MessageStatus, MessageWebhookPayload } from '../src/types'

// =============================================================================
// Test Helpers
// =============================================================================

function createMockFetch(responses: Map<string, { status: number; body: unknown }>) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const urlObj = new URL(url)
    const key = `${options?.method ?? 'GET'} ${urlObj.pathname}`

    const mockResponse = responses.get(key)
    if (!mockResponse) {
      return {
        ok: false,
        status: 404,
        headers: new Headers({ 'x-request-id': 'req_mock' }),
        json: async () => ({
          code: 20404,
          message: `No mock for ${key}`,
          more_info: 'https://www.twilio.com/docs/errors/20404',
          status: 404,
        }),
      }
    }

    return {
      ok: mockResponse.status >= 200 && mockResponse.status < 300,
      status: mockResponse.status,
      headers: new Headers({ 'x-request-id': 'req_mock' }),
      json: async () => mockResponse.body,
    }
  })
}

function mockMessage(overrides: Partial<Message> = {}): Message {
  return {
    sid: 'SM' + '0'.repeat(32),
    account_sid: 'AC' + '0'.repeat(32),
    api_version: '2010-04-01',
    body: 'Hello World!',
    date_created: new Date().toISOString(),
    date_sent: new Date().toISOString(),
    date_updated: new Date().toISOString(),
    direction: 'outbound-api',
    error_code: null,
    error_message: null,
    from: '+15017122661',
    messaging_service_sid: null,
    num_media: '0',
    num_segments: '1',
    price: '-0.0075',
    price_unit: 'USD',
    status: 'queued',
    to: '+15558675310',
    uri: `/2010-04-01/Accounts/AC${'0'.repeat(32)}/Messages/SM${'0'.repeat(32)}.json`,
    ...overrides,
  }
}

function createTestClient(
  mockFetch?: ReturnType<typeof createMockFetch>,
  config?: Partial<TwilioSMSConfig>
): TwilioSMS {
  return new TwilioSMS({
    accountSid: 'ACtest123',
    authToken: 'authtoken123',
    fetch: mockFetch ?? vi.fn(),
    ...config,
  })
}

// =============================================================================
// 1. Send SMS Messages
// =============================================================================

describe('@dotdo/twilio/sms - Send SMS Messages', () => {
  describe('basic SMS sending', () => {
    it('should send a simple SMS message', async () => {
      const expectedMessage = mockMessage()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const response = await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: 'Hello World!',
      })

      expect(response.sid).toMatch(/^SM/)
      expect(response.status).toBe('queued')
      expect(response.to).toBe('+15558675310')
      expect(response.from).toBe('+15017122661')
      expect(response.body).toBe('Hello World!')
    })

    it('should send SMS with messaging service SID instead of from number', async () => {
      const expectedMessage = mockMessage({ messaging_service_sid: 'MG' + '0'.repeat(32) })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const response = await sms.send({
        to: '+15558675310',
        messagingServiceSid: 'MG' + '0'.repeat(32),
        body: 'Hello from messaging service!',
      })

      expect(response.sid).toBeDefined()
    })

    it('should use default from number from config', async () => {
      const expectedMessage = mockMessage()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch, { defaultFrom: '+15017122661' })
      const response = await sms.send({
        to: '+15558675310',
        body: 'Using default from!',
      })

      expect(response.sid).toBeDefined()
    })

    it('should use default messaging service SID from config', async () => {
      const expectedMessage = mockMessage({ messaging_service_sid: 'MG' + '0'.repeat(32) })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch, {
        defaultMessagingServiceSid: 'MG' + '0'.repeat(32),
      })
      const response = await sms.send({
        to: '+15558675310',
        body: 'Using default messaging service!',
      })

      expect(response.sid).toBeDefined()
    })

    it('should send SMS with status callback URL', async () => {
      const expectedMessage = mockMessage()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const response = await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: 'Message with callback',
        statusCallback: 'https://example.com/status',
      })

      expect(response.sid).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          body: expect.stringContaining('StatusCallback'),
        })
      )
    })

    it('should send scheduled SMS for future delivery', async () => {
      const sendAt = new Date(Date.now() + 3600000) // 1 hour from now
      const expectedMessage = mockMessage({ status: 'scheduled' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const response = await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: 'Scheduled message',
        sendAt,
      })

      expect(response.status).toBe('scheduled')
    })

    it('should send SMS with validity period', async () => {
      const expectedMessage = mockMessage()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const response = await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: 'Message with expiry',
        validityPeriod: 3600, // 1 hour
      })

      expect(response.sid).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          body: expect.stringContaining('ValidityPeriod'),
        })
      )
    })

    it('should send SMS with shortened URLs', async () => {
      const expectedMessage = mockMessage()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const response = await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: 'Check out https://example.com/very/long/url',
        shortenUrls: true,
      })

      expect(response.sid).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          body: expect.stringContaining('ShortenUrls'),
        })
      )
    })
  })

  describe('validation', () => {
    it('should throw error when to number is missing', async () => {
      const sms = createTestClient()

      await expect(
        sms.send({
          from: '+15017122661',
          body: 'Hello!',
        } as SMSSendRequest)
      ).rejects.toThrow(TwilioSMSError)
    })

    it('should throw error when body is missing', async () => {
      const sms = createTestClient()

      await expect(
        sms.send({
          to: '+15558675310',
          from: '+15017122661',
        } as SMSSendRequest)
      ).rejects.toThrow(TwilioSMSError)
    })

    it('should throw error when neither from nor messagingServiceSid is provided', async () => {
      const sms = createTestClient()

      await expect(
        sms.send({
          to: '+15558675310',
          body: 'Hello!',
        })
      ).rejects.toThrow(TwilioSMSError)
    })

    it('should throw error for invalid E.164 to number', async () => {
      const sms = createTestClient()

      await expect(
        sms.send({
          to: 'invalid-number',
          from: '+15017122661',
          body: 'Hello!',
        })
      ).rejects.toThrow(TwilioSMSError)
    })

    it('should throw error for invalid E.164 from number', async () => {
      const sms = createTestClient()

      await expect(
        sms.send({
          to: '+15558675310',
          from: 'invalid-number',
          body: 'Hello!',
        })
      ).rejects.toThrow(TwilioSMSError)
    })

    it('should accept WhatsApp format phone numbers', async () => {
      const expectedMessage = mockMessage({
        from: 'whatsapp:+14155238886',
        to: 'whatsapp:+15558675310',
      })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const response = await sms.send({
        to: 'whatsapp:+15558675310',
        from: 'whatsapp:+14155238886',
        body: 'WhatsApp message via SMS client',
      })

      expect(response.from).toBe('whatsapp:+14155238886')
    })
  })

  describe('error handling', () => {
    it('should throw TwilioSMSError for API errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /2010-04-01/Accounts/ACtest123/Messages.json`,
            {
              status: 400,
              body: {
                code: 21211,
                message: "The 'To' number is not a valid phone number.",
                more_info: 'https://www.twilio.com/docs/errors/21211',
                status: 400,
              },
            },
          ],
        ])
      )

      const sms = createTestClient(mockFetch)

      try {
        await sms.send({
          to: '+15558675310',
          from: '+15017122661',
          body: 'Hello!',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(TwilioSMSError)
        const smsError = error as TwilioSMSError
        expect(smsError.code).toBe(21211)
        expect(smsError.status).toBe(400)
        expect(smsError.moreInfo).toBe('https://www.twilio.com/docs/errors/21211')
      }
    })

    it('should handle authentication errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /2010-04-01/Accounts/ACtest123/Messages.json`,
            {
              status: 401,
              body: {
                code: 20003,
                message: 'Authentication Error - No credentials provided',
                more_info: 'https://www.twilio.com/docs/errors/20003',
                status: 401,
              },
            },
          ],
        ])
      )

      const sms = createTestClient(mockFetch)

      await expect(
        sms.send({
          to: '+15558675310',
          from: '+15017122661',
          body: 'Hello!',
        })
      ).rejects.toThrow(TwilioSMSError)
    })

    it('should retry on 5xx errors when autoRetry is enabled', async () => {
      let callCount = 0
      const mockFetch = vi.fn(async () => {
        callCount++
        if (callCount < 3) {
          return {
            ok: false,
            status: 500,
            headers: new Headers(),
            json: async () => ({
              code: 20500,
              message: 'Internal Server Error',
              more_info: 'https://www.twilio.com/docs/errors/20500',
              status: 500,
            }),
          }
        }
        return {
          ok: true,
          status: 201,
          headers: new Headers(),
          json: async () => mockMessage(),
        }
      })

      const sms = new TwilioSMS({
        accountSid: 'ACtest123',
        authToken: 'authtoken123',
        fetch: mockFetch,
        autoRetry: true,
        maxRetries: 3,
      })

      const response = await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: 'Hello!',
      })

      expect(response.sid).toBeDefined()
      expect(callCount).toBe(3)
    })

    it('should not retry on 4xx errors', async () => {
      let callCount = 0
      const mockFetch = vi.fn(async () => {
        callCount++
        return {
          ok: false,
          status: 400,
          headers: new Headers(),
          json: async () => ({
            code: 21211,
            message: "Invalid 'To' number",
            more_info: 'https://www.twilio.com/docs/errors/21211',
            status: 400,
          }),
        }
      })

      const sms = new TwilioSMS({
        accountSid: 'ACtest123',
        authToken: 'authtoken123',
        fetch: mockFetch,
        autoRetry: true,
        maxRetries: 3,
      })

      await expect(
        sms.send({
          to: '+15558675310',
          from: '+15017122661',
          body: 'Hello!',
        })
      ).rejects.toThrow(TwilioSMSError)

      expect(callCount).toBe(1)
    })
  })
})

// =============================================================================
// 2. MMS with Media
// =============================================================================

describe('@dotdo/twilio/sms - MMS with Media', () => {
  describe('sending MMS', () => {
    it('should send MMS with single media URL', async () => {
      const expectedMessage = mockMessage({ num_media: '1' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const response = await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: 'Check out this image!',
        mediaUrl: ['https://example.com/image.jpg'],
      })

      expect(response.sid).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          body: expect.stringContaining('MediaUrl'),
        })
      )
    })

    it('should send MMS with multiple media URLs', async () => {
      const expectedMessage = mockMessage({ num_media: '3' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const response = await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: 'Multiple images!',
        mediaUrl: [
          'https://example.com/image1.jpg',
          'https://example.com/image2.png',
          'https://example.com/image3.gif',
        ],
      })

      expect(response.sid).toBeDefined()
    })

    it('should send MMS without body (media only)', async () => {
      const expectedMessage = mockMessage({ body: '', num_media: '1' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const response = await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: '', // Empty body is allowed when media is present
        mediaUrl: ['https://example.com/image.jpg'],
      })

      expect(response.sid).toBeDefined()
    })

    it('should force SMS to MMS when sendAsMms is true', async () => {
      const expectedMessage = mockMessage({ num_media: '0' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const response = await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: 'This should be sent as MMS',
        sendAsMms: true,
      })

      expect(response.sid).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          body: expect.stringContaining('SendAsMms'),
        })
      )
    })
  })

  describe('media types', () => {
    it('should support image/jpeg media', async () => {
      const expectedMessage = mockMessage({ num_media: '1' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const response = await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: 'JPEG image',
        mediaUrl: ['https://example.com/photo.jpeg'],
      })

      expect(response.sid).toBeDefined()
    })

    it('should support image/png media', async () => {
      const expectedMessage = mockMessage({ num_media: '1' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const response = await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: 'PNG image',
        mediaUrl: ['https://example.com/graphic.png'],
      })

      expect(response.sid).toBeDefined()
    })

    it('should support image/gif media', async () => {
      const expectedMessage = mockMessage({ num_media: '1' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const response = await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: 'GIF animation',
        mediaUrl: ['https://example.com/animation.gif'],
      })

      expect(response.sid).toBeDefined()
    })

    it('should support video/mp4 media', async () => {
      const expectedMessage = mockMessage({ num_media: '1' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const response = await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: 'Video message',
        mediaUrl: ['https://example.com/video.mp4'],
      })

      expect(response.sid).toBeDefined()
    })

    it('should support audio/mpeg media', async () => {
      const expectedMessage = mockMessage({ num_media: '1' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const response = await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: 'Audio message',
        mediaUrl: ['https://example.com/audio.mp3'],
      })

      expect(response.sid).toBeDefined()
    })

    it('should support PDF documents', async () => {
      const expectedMessage = mockMessage({ num_media: '1' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const response = await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: 'PDF document',
        mediaUrl: ['https://example.com/document.pdf'],
      })

      expect(response.sid).toBeDefined()
    })
  })
})

// =============================================================================
// 3. Message Status Tracking
// =============================================================================

describe('@dotdo/twilio/sms - Message Status Tracking', () => {
  describe('fetching status from API', () => {
    it('should get message status by SID', async () => {
      const sid = 'SM' + '0'.repeat(32)
      const expectedMessage = mockMessage({ sid, status: 'delivered' })
      const mockFetch = createMockFetch(
        new Map([
          [`GET /2010-04-01/Accounts/ACtest123/Messages/${sid}.json`, { status: 200, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const status = await sms.getStatus(sid)

      expect(status.sid).toBe(sid)
      expect(status.status).toBe('delivered')
    })

    it('should return error info for failed messages', async () => {
      const sid = 'SM' + '0'.repeat(32)
      const expectedMessage = mockMessage({
        sid,
        status: 'failed',
        error_code: 30003,
        error_message: 'Unreachable destination handset',
      })
      const mockFetch = createMockFetch(
        new Map([
          [`GET /2010-04-01/Accounts/ACtest123/Messages/${sid}.json`, { status: 200, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const status = await sms.getStatus(sid)

      expect(status.status).toBe('failed')
      expect(status.errorCode).toBe(30003)
      expect(status.errorMessage).toBe('Unreachable destination handset')
    })

    it('should throw error for non-existent message', async () => {
      const sid = 'SM' + 'x'.repeat(32)
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /2010-04-01/Accounts/ACtest123/Messages/${sid}.json`,
            {
              status: 404,
              body: {
                code: 20404,
                message: 'The requested resource was not found',
                more_info: 'https://www.twilio.com/docs/errors/20404',
                status: 404,
              },
            },
          ],
        ])
      )

      const sms = createTestClient(mockFetch)

      await expect(sms.getStatus(sid)).rejects.toThrow(TwilioSMSError)
    })
  })

  describe('local status tracking', () => {
    it('should track message status after sending', async () => {
      const sid = 'SM' + '0'.repeat(32)
      const expectedMessage = mockMessage({ sid, status: 'queued' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: 'Hello!',
      })

      const trackedStatus = sms.getTrackedStatus(sid)
      expect(trackedStatus).toBeDefined()
      expect(trackedStatus?.status).toBe('queued')
    })

    it('should update tracked status after fetching from API', async () => {
      const sid = 'SM' + '0'.repeat(32)
      const sentMessage = mockMessage({ sid, status: 'queued' })
      const deliveredMessage = mockMessage({ sid, status: 'delivered' })

      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: sentMessage }],
          [`GET /2010-04-01/Accounts/ACtest123/Messages/${sid}.json`, { status: 200, body: deliveredMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)

      // Send message
      await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: 'Hello!',
      })

      // Fetch updated status
      await sms.getStatus(sid)

      const trackedStatus = sms.getTrackedStatus(sid)
      expect(trackedStatus?.status).toBe('delivered')
    })

    it('should clear all tracked statuses', async () => {
      const sid = 'SM' + '0'.repeat(32)
      const expectedMessage = mockMessage({ sid, status: 'queued' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: 'Hello!',
      })

      expect(sms.getTrackedStatus(sid)).toBeDefined()

      sms.clearTrackedStatuses()

      expect(sms.getTrackedStatus(sid)).toBeNull()
    })
  })

  describe('status progression', () => {
    const statuses: MessageStatus[] = ['queued', 'sending', 'sent', 'delivered']

    for (const status of statuses) {
      it(`should handle ${status} status`, async () => {
        const sid = 'SM' + '0'.repeat(32)
        const expectedMessage = mockMessage({ sid, status })
        const mockFetch = createMockFetch(
          new Map([
            [`GET /2010-04-01/Accounts/ACtest123/Messages/${sid}.json`, { status: 200, body: expectedMessage }],
          ])
        )

        const sms = createTestClient(mockFetch)
        const result = await sms.getStatus(sid)

        expect(result.status).toBe(status)
      })
    }

    it('should handle undelivered status with error info', async () => {
      const sid = 'SM' + '0'.repeat(32)
      const expectedMessage = mockMessage({
        sid,
        status: 'undelivered',
        error_code: 30005,
        error_message: 'Unknown destination handset',
      })
      const mockFetch = createMockFetch(
        new Map([
          [`GET /2010-04-01/Accounts/ACtest123/Messages/${sid}.json`, { status: 200, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const result = await sms.getStatus(sid)

      expect(result.status).toBe('undelivered')
      expect(result.errorCode).toBe(30005)
    })
  })

  describe('message operations', () => {
    it('should cancel a scheduled message', async () => {
      const sid = 'SM' + '0'.repeat(32)
      const expectedMessage = mockMessage({ sid, status: 'canceled' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages/${sid}.json`, { status: 200, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const status = await sms.cancel(sid)

      expect(status.status).toBe('canceled')
    })

    it('should delete a message', async () => {
      const sid = 'SM' + '0'.repeat(32)
      const mockFetch = createMockFetch(
        new Map([
          [`DELETE /2010-04-01/Accounts/ACtest123/Messages/${sid}.json`, { status: 204, body: {} }],
        ])
      )

      const sms = createTestClient(mockFetch)
      const result = await sms.delete(sid)

      expect(result).toBe(true)
    })

    it('should list messages', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /2010-04-01/Accounts/ACtest123/Messages.json`,
            {
              status: 200,
              body: {
                messages: [
                  mockMessage({ sid: 'SM' + '0'.repeat(32) }),
                  mockMessage({ sid: 'SM' + '1'.repeat(32) }),
                ],
                page: 0,
                page_size: 50,
              },
            },
          ],
        ])
      )

      const sms = createTestClient(mockFetch)
      const messages = await sms.list()

      expect(messages).toHaveLength(2)
    })

    it('should list messages with filters', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /2010-04-01/Accounts/ACtest123/Messages.json`,
            {
              status: 200,
              body: {
                messages: [mockMessage()],
                page: 0,
                page_size: 50,
              },
            },
          ],
        ])
      )

      const sms = createTestClient(mockFetch)
      const messages = await sms.list({
        to: '+15558675310',
        dateSentAfter: new Date('2024-01-01'),
      })

      expect(messages).toHaveLength(1)
    })
  })
})

// =============================================================================
// 4. Webhooks (Delivery Receipts, Inbound)
// =============================================================================

describe('@dotdo/twilio/sms - Webhooks', () => {
  describe('handleWebhook', () => {
    it('should handle delivery status webhook', () => {
      const sms = createTestClient()

      const payload: MessageWebhookPayload = {
        MessageSid: 'SM' + '0'.repeat(32),
        AccountSid: 'AC' + '0'.repeat(32),
        From: '+15017122661',
        To: '+15558675310',
        Body: 'Hello!',
        NumMedia: '0',
        SmsStatus: 'delivered',
        ApiVersion: '2010-04-01',
      }

      const result = sms.handleWebhook(payload)

      expect(result.sid).toBe(payload.MessageSid)
      expect(result.status).toBe('delivered')
    })

    it('should update tracked status on webhook', () => {
      const sid = 'SM' + '0'.repeat(32)
      const sms = createTestClient()

      // Simulate webhook for queued status
      sms.handleWebhook({
        MessageSid: sid,
        AccountSid: 'AC' + '0'.repeat(32),
        From: '+15017122661',
        To: '+15558675310',
        Body: 'Hello!',
        NumMedia: '0',
        SmsStatus: 'queued',
        ApiVersion: '2010-04-01',
      })

      expect(sms.getTrackedStatus(sid)?.status).toBe('queued')

      // Simulate webhook for delivered status
      sms.handleWebhook({
        MessageSid: sid,
        AccountSid: 'AC' + '0'.repeat(32),
        From: '+15017122661',
        To: '+15558675310',
        Body: 'Hello!',
        NumMedia: '0',
        SmsStatus: 'delivered',
        ApiVersion: '2010-04-01',
      })

      expect(sms.getTrackedStatus(sid)?.status).toBe('delivered')
    })

    it('should handle failed status webhook', () => {
      const sms = createTestClient()

      const payload: MessageWebhookPayload = {
        MessageSid: 'SM' + '0'.repeat(32),
        AccountSid: 'AC' + '0'.repeat(32),
        From: '+15017122661',
        To: '+15558675310',
        Body: 'Hello!',
        NumMedia: '0',
        SmsStatus: 'failed',
        ApiVersion: '2010-04-01',
      }

      const result = sms.handleWebhook(payload)

      expect(result.status).toBe('failed')
    })

    it('should handle inbound message webhook', () => {
      const sms = createTestClient()

      const payload: MessageWebhookPayload = {
        MessageSid: 'SM' + '0'.repeat(32),
        AccountSid: 'AC' + '0'.repeat(32),
        From: '+15558675310', // Customer's number
        To: '+15017122661', // Your Twilio number
        Body: 'Reply from customer',
        NumMedia: '0',
        SmsStatus: 'received',
        ApiVersion: '2010-04-01',
      }

      const result = sms.handleWebhook(payload)

      expect(result.status).toBe('received')
    })

    it('should handle webhook with media', () => {
      const sms = createTestClient()

      const payload: MessageWebhookPayload = {
        MessageSid: 'SM' + '0'.repeat(32),
        AccountSid: 'AC' + '0'.repeat(32),
        From: '+15558675310',
        To: '+15017122661',
        Body: 'Photo attached',
        NumMedia: '1',
        SmsStatus: 'received',
        ApiVersion: '2010-04-01',
        MediaContentType0: 'image/jpeg',
        MediaUrl0: 'https://api.twilio.com/2010-04-01/Accounts/AC.../Messages/MM.../Media/ME...',
      }

      const result = sms.handleWebhook(payload)

      expect(result.sid).toBe(payload.MessageSid)
    })
  })

  describe('webhook signature verification', () => {
    it('should verify valid webhook signature', async () => {
      const sms = createTestClient(undefined, { webhookSecret: 'test_secret' })

      const url = 'https://example.com/webhook'
      const params = {
        MessageSid: 'SM12345',
        AccountSid: 'AC12345',
        Body: 'Hello',
      }

      // Generate valid signature
      const sortedKeys = Object.keys(params).sort()
      let data = url
      for (const key of sortedKeys) {
        data += key + params[key as keyof typeof params]
      }

      const encoder = new TextEncoder()
      const keyData = encoder.encode('test_secret')
      const messageData = encoder.encode(data)

      const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
      )

      const signatureBuffer = await crypto.subtle.sign('HMAC', key, messageData)
      const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))

      const isValid = await sms.verifyWebhookSignature(signature, url, params)

      expect(isValid).toBe(true)
    })

    it('should reject invalid webhook signature', async () => {
      const sms = createTestClient(undefined, { webhookSecret: 'test_secret' })

      const url = 'https://example.com/webhook'
      const params = {
        MessageSid: 'SM12345',
        AccountSid: 'AC12345',
        Body: 'Hello',
      }

      const isValid = await sms.verifyWebhookSignature('invalid_signature', url, params)

      expect(isValid).toBe(false)
    })

    it('should use authToken when webhookSecret is not configured', async () => {
      const sms = new TwilioSMS({
        accountSid: 'ACtest123',
        authToken: 'authtoken123',
        fetch: vi.fn(),
      })

      const url = 'https://example.com/webhook'
      const params = { MessageSid: 'SM12345' }

      // Generate signature with authToken
      const encoder = new TextEncoder()
      const keyData = encoder.encode('authtoken123')
      const messageData = encoder.encode(url + 'MessageSid' + 'SM12345')

      const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
      )

      const signatureBuffer = await crypto.subtle.sign('HMAC', key, messageData)
      const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))

      const isValid = await sms.verifyWebhookSignature(signature, url, params)

      expect(isValid).toBe(true)
    })
  })

  describe('webhook handler', () => {
    it('should create Hono webhook handler', () => {
      const sms = createTestClient()
      const handler = sms.createWebhookHandler()

      expect(handler).toBeDefined()
      expect(typeof handler.fetch).toBe('function')
    })

    it('should handle POST /status webhook', async () => {
      const sms = createTestClient()
      const handler = sms.createWebhookHandler()

      const formData = new URLSearchParams({
        MessageSid: 'SM' + '0'.repeat(32),
        AccountSid: 'AC' + '0'.repeat(32),
        From: '+15017122661',
        To: '+15558675310',
        Body: 'Hello!',
        NumMedia: '0',
        SmsStatus: 'delivered',
        ApiVersion: '2010-04-01',
      })

      const request = new Request('https://example.com/status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      })

      const response = await handler.fetch(request)

      expect(response.status).toBe(204)
    })

    it('should handle POST /inbound webhook', async () => {
      const sms = createTestClient()
      const handler = sms.createWebhookHandler()

      const formData = new URLSearchParams({
        MessageSid: 'SM' + '0'.repeat(32),
        AccountSid: 'AC' + '0'.repeat(32),
        From: '+15558675310',
        To: '+15017122661',
        Body: 'Customer reply',
        NumMedia: '0',
        SmsStatus: 'received',
        ApiVersion: '2010-04-01',
      })

      const request = new Request('https://example.com/inbound', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      })

      const response = await handler.fetch(request)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/xml')
      const text = await response.text()
      expect(text).toContain('<Response>')
    })

    it('should reject webhook with invalid signature when secret is configured', async () => {
      const sms = createTestClient(undefined, { webhookSecret: 'test_secret' })
      const handler = sms.createWebhookHandler()

      const formData = new URLSearchParams({
        MessageSid: 'SM' + '0'.repeat(32),
        SmsStatus: 'delivered',
      })

      const request = new Request('https://example.com/status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': 'invalid_signature',
        },
        body: formData.toString(),
      })

      const response = await handler.fetch(request)

      expect(response.status).toBe(403)
    })
  })
})

// =============================================================================
// 5. Rate Limiting
// =============================================================================

describe('@dotdo/twilio/sms - Rate Limiting', () => {
  describe('basic rate limiting', () => {
    it('should allow requests within rate limit', async () => {
      const expectedMessage = mockMessage()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch, {
        rateLimit: {
          maxRequests: 10,
          windowMs: 1000,
        },
      })

      // Should succeed
      const response = await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: 'Hello!',
      })

      expect(response.sid).toBeDefined()
    })

    it('should throw RateLimitError when limit exceeded', async () => {
      const expectedMessage = mockMessage()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const sms = createTestClient(mockFetch, {
        rateLimit: {
          maxRequests: 2,
          windowMs: 60000, // 1 minute
        },
      })

      // First two should succeed
      await sms.send({ to: '+15558675310', from: '+15017122661', body: 'Message 1' })
      await sms.send({ to: '+15558675310', from: '+15017122661', body: 'Message 2' })

      // Third should be rate limited
      await expect(
        sms.send({ to: '+15558675310', from: '+15017122661', body: 'Message 3' })
      ).rejects.toThrow(RateLimitError)
    })

    it('should include retryAfter in RateLimitError', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: mockMessage() }],
        ])
      )

      const sms = createTestClient(mockFetch, {
        rateLimit: {
          maxRequests: 1,
          windowMs: 1000,
        },
      })

      await sms.send({ to: '+15558675310', from: '+15017122661', body: 'Message 1' })

      try {
        await sms.send({ to: '+15558675310', from: '+15017122661', body: 'Message 2' })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitError)
        const rateLimitError = error as RateLimitError
        expect(rateLimitError.retryAfter).toBeGreaterThan(0)
      }
    })
  })

  describe('rate limit configuration', () => {
    it('should use custom key function for rate limiting', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: mockMessage() }],
        ])
      )

      const sms = createTestClient(mockFetch, {
        rateLimit: {
          maxRequests: 1,
          windowMs: 60000,
          keyFn: (request) => request.to, // Rate limit per recipient
        },
      })

      // Same recipient - should be rate limited after first
      await sms.send({ to: '+15558675310', from: '+15017122661', body: 'Message 1' })
      await expect(
        sms.send({ to: '+15558675310', from: '+15017122661', body: 'Message 2' })
      ).rejects.toThrow(RateLimitError)

      // Different recipient - should succeed
      const response = await sms.send({ to: '+15551234567', from: '+15017122661', body: 'Message to different recipient' })
      expect(response.sid).toBeDefined()
    })

    it('should allow requests after window expires', async () => {
      vi.useFakeTimers()

      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: mockMessage() }],
        ])
      )

      const sms = createTestClient(mockFetch, {
        rateLimit: {
          maxRequests: 1,
          windowMs: 1000,
        },
      })

      // Use up the limit
      await sms.send({ to: '+15558675310', from: '+15017122661', body: 'Message 1' })

      // Should be rate limited
      await expect(
        sms.send({ to: '+15558675310', from: '+15017122661', body: 'Message 2' })
      ).rejects.toThrow(RateLimitError)

      // Advance time past the window
      vi.advanceTimersByTime(1100)

      // Should succeed now
      const response = await sms.send({ to: '+15558675310', from: '+15017122661', body: 'Message 3' })
      expect(response.sid).toBeDefined()

      vi.useRealTimers()
    })
  })

  describe('rate limit status', () => {
    it('should report rate limit status', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: mockMessage() }],
        ])
      )

      const sms = createTestClient(mockFetch, {
        rateLimit: {
          maxRequests: 10,
          windowMs: 1000,
        },
      })

      const initialStatus = sms.getRateLimitStatus()
      expect(initialStatus?.remaining).toBe(10)

      await sms.send({ to: '+15558675310', from: '+15017122661', body: 'Message 1' })

      const afterSendStatus = sms.getRateLimitStatus()
      expect(afterSendStatus?.remaining).toBe(9)
    })

    it('should return null when rate limiting is not configured', () => {
      const sms = createTestClient()

      const status = sms.getRateLimitStatus()

      expect(status).toBeNull()
    })
  })

  describe('rate limit does not retry', () => {
    it('should not retry when rate limited', async () => {
      let callCount = 0
      const mockFetch = vi.fn(async () => {
        callCount++
        return {
          ok: true,
          status: 201,
          headers: new Headers(),
          json: async () => mockMessage(),
        }
      })

      const sms = new TwilioSMS({
        accountSid: 'ACtest123',
        authToken: 'authtoken123',
        fetch: mockFetch,
        autoRetry: true,
        maxRetries: 3,
        rateLimit: {
          maxRequests: 1,
          windowMs: 60000,
        },
      })

      await sms.send({ to: '+15558675310', from: '+15017122661', body: 'Message 1' })

      try {
        await sms.send({ to: '+15558675310', from: '+15017122661', body: 'Message 2' })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitError)
      }

      // Should only have made one API call (the first message)
      expect(callCount).toBe(1)
    })
  })
})

// =============================================================================
// 6. Batch Sending
// =============================================================================

describe('@dotdo/twilio/sms - Batch Sending', () => {
  describe('sendBatch', () => {
    it('should send multiple messages in batch', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: mockMessage() }],
        ])
      )

      const sms = createTestClient(mockFetch)

      const requests: SMSSendRequest[] = [
        { to: '+15551234567', from: '+15017122661', body: 'Message 1' },
        { to: '+15552345678', from: '+15017122661', body: 'Message 2' },
        { to: '+15553456789', from: '+15017122661', body: 'Message 3' },
      ]

      const results = await sms.sendBatch(requests)

      expect(results).toHaveLength(3)
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('should return successful results even when some fail', async () => {
      let callCount = 0
      const mockFetch = vi.fn(async () => {
        callCount++
        if (callCount === 2) {
          return {
            ok: false,
            status: 400,
            headers: new Headers(),
            json: async () => ({
              code: 21211,
              message: 'Invalid phone number',
              more_info: 'https://www.twilio.com/docs/errors/21211',
              status: 400,
            }),
          }
        }
        return {
          ok: true,
          status: 201,
          headers: new Headers(),
          json: async () => mockMessage({ sid: 'SM' + callCount.toString().repeat(32) }),
        }
      })

      const sms = createTestClient(mockFetch)

      const requests: SMSSendRequest[] = [
        { to: '+15551234567', from: '+15017122661', body: 'Message 1' },
        { to: 'invalid', from: '+15017122661', body: 'Message 2' }, // This will fail
        { to: '+15553456789', from: '+15017122661', body: 'Message 3' },
      ]

      const results = await sms.sendBatch(requests)

      // Should return the successful ones
      expect(results.length).toBeLessThan(3)
    })

    it('should handle empty batch', async () => {
      const mockFetch = createMockFetch(new Map())
      const sms = createTestClient(mockFetch)

      const results = await sms.sendBatch([])

      expect(results).toHaveLength(0)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should respect rate limits in batch', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: mockMessage() }],
        ])
      )

      const sms = createTestClient(mockFetch, {
        rateLimit: {
          maxRequests: 2,
          windowMs: 60000,
        },
      })

      const requests: SMSSendRequest[] = [
        { to: '+15551234567', from: '+15017122661', body: 'Message 1' },
        { to: '+15552345678', from: '+15017122661', body: 'Message 2' },
        { to: '+15553456789', from: '+15017122661', body: 'Message 3' },
      ]

      const results = await sms.sendBatch(requests)

      // Only first 2 should succeed due to rate limit
      expect(results).toHaveLength(2)
    })

    it('should process batch sequentially', async () => {
      const callOrder: number[] = []
      let callCount = 0

      const mockFetch = vi.fn(async (url: string, options?: RequestInit) => {
        callCount++
        const currentCall = callCount
        callOrder.push(currentCall)

        // Simulate varying response times
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10))

        return {
          ok: true,
          status: 201,
          headers: new Headers(),
          json: async () => mockMessage({ sid: 'SM' + currentCall.toString().padStart(32, '0') }),
        }
      })

      const sms = createTestClient(mockFetch)

      const requests: SMSSendRequest[] = [
        { to: '+15551234567', from: '+15017122661', body: 'Message 1' },
        { to: '+15552345678', from: '+15017122661', body: 'Message 2' },
        { to: '+15553456789', from: '+15017122661', body: 'Message 3' },
      ]

      await sms.sendBatch(requests)

      // Verify sequential processing
      expect(callOrder).toEqual([1, 2, 3])
    })
  })

  describe('batch with different configurations', () => {
    it('should send batch with mixed from numbers', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: mockMessage() }],
        ])
      )

      const sms = createTestClient(mockFetch)

      const requests: SMSSendRequest[] = [
        { to: '+15551234567', from: '+15017122661', body: 'From number 1' },
        { to: '+15552345678', from: '+15018233772', body: 'From number 2' },
        { to: '+15553456789', messagingServiceSid: 'MG' + '0'.repeat(32), body: 'From messaging service' },
      ]

      const results = await sms.sendBatch(requests)

      expect(results).toHaveLength(3)
    })

    it('should send batch with media attachments', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: mockMessage({ num_media: '1' }) }],
        ])
      )

      const sms = createTestClient(mockFetch)

      const requests: SMSSendRequest[] = [
        {
          to: '+15551234567',
          from: '+15017122661',
          body: 'Image 1',
          mediaUrl: ['https://example.com/image1.jpg'],
        },
        {
          to: '+15552345678',
          from: '+15017122661',
          body: 'Image 2',
          mediaUrl: ['https://example.com/image2.jpg'],
        },
      ]

      const results = await sms.sendBatch(requests)

      expect(results).toHaveLength(2)
    })

    it('should send batch to same recipient with different messages', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: mockMessage() }],
        ])
      )

      const sms = createTestClient(mockFetch)

      const recipient = '+15558675310'
      const requests: SMSSendRequest[] = [
        { to: recipient, from: '+15017122661', body: 'Part 1 of 3' },
        { to: recipient, from: '+15017122661', body: 'Part 2 of 3' },
        { to: recipient, from: '+15017122661', body: 'Part 3 of 3' },
      ]

      const results = await sms.sendBatch(requests)

      expect(results).toHaveLength(3)
    })
  })

  describe('batch error handling', () => {
    it('should continue batch after individual failures', async () => {
      let callCount = 0
      const mockFetch = vi.fn(async () => {
        callCount++
        if (callCount === 1) {
          return {
            ok: false,
            status: 400,
            headers: new Headers(),
            json: async () => ({
              code: 21211,
              message: 'Invalid phone number',
              more_info: 'https://www.twilio.com/docs/errors/21211',
              status: 400,
            }),
          }
        }
        return {
          ok: true,
          status: 201,
          headers: new Headers(),
          json: async () => mockMessage(),
        }
      })

      const sms = createTestClient(mockFetch)

      const requests: SMSSendRequest[] = [
        { to: '+15551234567', from: '+15017122661', body: 'Message 1' },
        { to: '+15552345678', from: '+15017122661', body: 'Message 2' },
      ]

      const results = await sms.sendBatch(requests)

      // Should have tried both despite first failing
      expect(mockFetch).toHaveBeenCalledTimes(2)
      // Only second should succeed
      expect(results).toHaveLength(1)
    })

    it('should handle all failures in batch gracefully', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: false,
        status: 400,
        headers: new Headers(),
        json: async () => ({
          code: 21211,
          message: 'Invalid phone number',
          more_info: 'https://www.twilio.com/docs/errors/21211',
          status: 400,
        }),
      }))

      const sms = createTestClient(mockFetch)

      const requests: SMSSendRequest[] = [
        { to: '+15551234567', from: '+15017122661', body: 'Message 1' },
        { to: '+15552345678', from: '+15017122661', body: 'Message 2' },
      ]

      const results = await sms.sendBatch(requests)

      expect(results).toHaveLength(0)
    })
  })
})

// =============================================================================
// Factory Function Tests
// =============================================================================

describe('@dotdo/twilio/sms - Factory Function', () => {
  it('should create client using createTwilioSMS factory', () => {
    const sms = createTwilioSMS('ACtest123', 'authtoken123')

    expect(sms).toBeInstanceOf(TwilioSMS)
  })

  it('should create client with config options', () => {
    const sms = createTwilioSMS('ACtest123', 'authtoken123', {
      defaultFrom: '+15017122661',
      rateLimit: {
        maxRequests: 100,
        windowMs: 1000,
      },
    })

    expect(sms).toBeInstanceOf(TwilioSMS)
  })

  it('should throw error without accountSid', () => {
    expect(() => createTwilioSMS('', 'authtoken123')).toThrow('accountSid is required')
  })

  it('should throw error without authToken', () => {
    expect(() => createTwilioSMS('ACtest123', '')).toThrow('authToken is required')
  })
})

// =============================================================================
// Edge Region Configuration Tests
// =============================================================================

describe('@dotdo/twilio/sms - Edge/Region Configuration', () => {
  it('should use custom region in API URL', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 201,
      headers: new Headers(),
      json: async () => mockMessage(),
    }))

    const sms = new TwilioSMS({
      accountSid: 'ACtest123',
      authToken: 'authtoken123',
      fetch: mockFetch,
      region: 'ie1',
    })

    await sms.send({
      to: '+15558675310',
      from: '+15017122661',
      body: 'Hello from Ireland!',
    })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api.ie1.twilio.com'),
      expect.anything()
    )
  })

  it('should use custom edge in API URL', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 201,
      headers: new Headers(),
      json: async () => mockMessage(),
    }))

    const sms = new TwilioSMS({
      accountSid: 'ACtest123',
      authToken: 'authtoken123',
      fetch: mockFetch,
      edge: 'ashburn',
    })

    await sms.send({
      to: '+15558675310',
      from: '+15017122661',
      body: 'Hello from Ashburn!',
    })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api.ashburn.twilio.com'),
      expect.anything()
    )
  })
})
