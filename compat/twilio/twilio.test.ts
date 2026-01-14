/**
 * @dotdo/twilio - Twilio Compatibility Layer Tests
 *
 * TDD tests for Twilio API compatibility including:
 * - SMS messaging
 * - Voice calls
 * - WhatsApp messaging
 * - Verify (OTP) service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  twilio,
  Twilio,
  TwilioClient,
  TwilioAPIError,
  Webhooks,
  type Message,
  type Call,
  type Verification,
  type VerificationCheck,
  type ListResponse,
} from './index'

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

function mockCall(overrides: Partial<Call> = {}): Call {
  return {
    sid: 'CA' + '0'.repeat(32),
    account_sid: 'AC' + '0'.repeat(32),
    api_version: '2010-04-01',
    answered_by: null,
    caller_name: null,
    date_created: new Date().toISOString(),
    date_updated: new Date().toISOString(),
    direction: 'outbound-api',
    duration: null,
    end_time: null,
    forwarded_from: null,
    from: '+15017122661',
    from_formatted: '(501) 712-2661',
    group_sid: null,
    parent_call_sid: null,
    phone_number_sid: 'PN' + '0'.repeat(32),
    price: null,
    price_unit: 'USD',
    queue_time: '0',
    start_time: null,
    status: 'queued',
    to: '+15558675310',
    to_formatted: '(555) 867-5310',
    trunk_sid: null,
    uri: `/2010-04-01/Accounts/AC${'0'.repeat(32)}/Calls/CA${'0'.repeat(32)}.json`,
    ...overrides,
  }
}

function mockVerification(overrides: Partial<Verification> = {}): Verification {
  return {
    sid: 'VE' + '0'.repeat(32),
    service_sid: 'VA' + '0'.repeat(32),
    account_sid: 'AC' + '0'.repeat(32),
    to: '+15558675310',
    channel: 'sms',
    status: 'pending',
    valid: false,
    lookup: {},
    amount: null,
    payee: null,
    send_code_attempts: [
      {
        time: new Date().toISOString(),
        channel: 'sms',
        attempt_sid: 'VL' + '0'.repeat(32),
      },
    ],
    date_created: new Date().toISOString(),
    date_updated: new Date().toISOString(),
    sna: null,
    url: `https://verify.twilio.com/v2/Services/VA${'0'.repeat(32)}/Verifications/VE${'0'.repeat(32)}`,
    ...overrides,
  }
}

function mockVerificationCheck(overrides: Partial<VerificationCheck> = {}): VerificationCheck {
  return {
    sid: 'VE' + '0'.repeat(32),
    service_sid: 'VA' + '0'.repeat(32),
    account_sid: 'AC' + '0'.repeat(32),
    to: '+15558675310',
    channel: 'sms',
    status: 'approved',
    valid: true,
    amount: null,
    payee: null,
    date_created: new Date().toISOString(),
    date_updated: new Date().toISOString(),
    ...overrides,
  }
}

// =============================================================================
// Twilio Client Initialization Tests
// =============================================================================

describe('@dotdo/twilio - Client Initialization', () => {
  describe('factory function', () => {
    it('should create a client using twilio(accountSid, authToken)', () => {
      const client = twilio('ACtest123', 'authtoken123')
      expect(client).toBeInstanceOf(TwilioClient)
    })

    it('should throw error without accountSid', () => {
      expect(() => twilio('', 'authtoken123')).toThrow('accountSid is required')
    })

    it('should throw error without authToken', () => {
      expect(() => twilio('ACtest123', '')).toThrow('authToken is required')
    })
  })

  describe('Twilio class', () => {
    it('should create a client with new Twilio(accountSid, authToken)', () => {
      const client = new Twilio('ACtest123', 'authtoken123')
      expect(client).toBeInstanceOf(TwilioClient)
    })

    it('should expose messages resource', () => {
      const client = new Twilio('ACtest123', 'authtoken123')
      expect(client.messages).toBeDefined()
    })

    it('should expose calls resource', () => {
      const client = new Twilio('ACtest123', 'authtoken123')
      expect(client.calls).toBeDefined()
    })

    it('should expose verify resource', () => {
      const client = new Twilio('ACtest123', 'authtoken123')
      expect(client.verify).toBeDefined()
    })
  })

  describe('configuration options', () => {
    it('should accept custom region', () => {
      const client = new Twilio('ACtest123', 'authtoken123', {
        region: 'ie1',
      })
      expect(client).toBeDefined()
    })

    it('should accept custom edge', () => {
      const client = new Twilio('ACtest123', 'authtoken123', {
        edge: 'ashburn',
      })
      expect(client).toBeDefined()
    })

    it('should accept custom logger', () => {
      const logger = {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }
      const client = new Twilio('ACtest123', 'authtoken123', {
        logLevel: 'debug',
        logger,
      })
      expect(client).toBeDefined()
    })
  })
})

// =============================================================================
// SMS Messages Tests
// =============================================================================

describe('@dotdo/twilio - SMS Messages', () => {
  describe('messages.create()', () => {
    it('should send an SMS message', async () => {
      const expectedMessage = mockMessage()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const message = await client.messages.create({
        body: 'Hello!',
        from: '+15017122661',
        to: '+15558675310',
      })

      expect(message.sid).toMatch(/^SM/)
      expect(message.body).toBe('Hello World!')
      expect(message.status).toBe('queued')
    })

    it('should send an SMS with messaging service SID', async () => {
      const expectedMessage = mockMessage({ messaging_service_sid: 'MG' + '0'.repeat(32) })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const message = await client.messages.create({
        body: 'Hello!',
        messagingServiceSid: 'MG' + '0'.repeat(32),
        to: '+15558675310',
      })

      expect(message.messaging_service_sid).toBe('MG' + '0'.repeat(32))
    })

    it('should throw error without body', async () => {
      const client = new Twilio('ACtest123', 'authtoken123')

      await expect(
        client.messages.create({
          from: '+15017122661',
          to: '+15558675310',
        } as any)
      ).rejects.toThrow()
    })

    it('should throw error without to', async () => {
      const client = new Twilio('ACtest123', 'authtoken123')

      await expect(
        client.messages.create({
          body: 'Hello!',
          from: '+15017122661',
        } as any)
      ).rejects.toThrow()
    })

    it('should throw error without from or messagingServiceSid', async () => {
      const client = new Twilio('ACtest123', 'authtoken123')

      await expect(
        client.messages.create({
          body: 'Hello!',
          to: '+15558675310',
        } as any)
      ).rejects.toThrow()
    })

    it('should send MMS with media URL', async () => {
      const expectedMessage = mockMessage({ num_media: '1' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const message = await client.messages.create({
        body: 'Check out this image!',
        from: '+15017122661',
        to: '+15558675310',
        mediaUrl: ['https://example.com/image.jpg'],
      })

      expect(message.num_media).toBe('1')
    })

    it('should include status callback URL', async () => {
      const expectedMessage = mockMessage()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const message = await client.messages.create({
        body: 'Hello!',
        from: '+15017122661',
        to: '+15558675310',
        statusCallback: 'https://example.com/status',
      })

      expect(message.sid).toBeDefined()
    })
  })

  describe('messages.get()', () => {
    it('should retrieve a message by SID', async () => {
      const sid = 'SM' + '0'.repeat(32)
      const expectedMessage = mockMessage({ sid })
      const mockFetch = createMockFetch(
        new Map([
          [`GET /2010-04-01/Accounts/ACtest123/Messages/${sid}.json`, { status: 200, body: expectedMessage }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const message = await client.messages(sid).fetch()

      expect(message.sid).toBe(sid)
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
                message: `The requested resource /2010-04-01/Accounts/ACtest123/Messages/${sid}.json was not found`,
                more_info: 'https://www.twilio.com/docs/errors/20404',
                status: 404,
              },
            },
          ],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      await expect(client.messages(sid).fetch()).rejects.toThrow(TwilioAPIError)
    })
  })

  describe('messages.list()', () => {
    it('should list messages', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /2010-04-01/Accounts/ACtest123/Messages.json`,
            {
              status: 200,
              body: {
                messages: [mockMessage(), mockMessage({ sid: 'SM' + '1'.repeat(32) })],
                end: 1,
                first_page_uri: '/2010-04-01/Accounts/ACtest123/Messages.json?Page=0&PageSize=50',
                next_page_uri: null,
                page: 0,
                page_size: 50,
                previous_page_uri: null,
                start: 0,
                uri: '/2010-04-01/Accounts/ACtest123/Messages.json',
              },
            },
          ],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const result = await client.messages.list()

      expect(result).toHaveLength(2)
    })

    it('should filter messages by date', async () => {
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

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const result = await client.messages.list({
        dateSentAfter: new Date('2024-01-01'),
        dateSentBefore: new Date('2024-12-31'),
      })

      expect(result).toHaveLength(1)
    })

    it('should filter messages by to number', async () => {
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

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const result = await client.messages.list({
        to: '+15558675310',
      })

      expect(result).toHaveLength(1)
    })
  })

  describe('messages.update()', () => {
    it('should cancel a queued message', async () => {
      const sid = 'SM' + '0'.repeat(32)
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /2010-04-01/Accounts/ACtest123/Messages/${sid}.json`,
            { status: 200, body: mockMessage({ sid, status: 'canceled' }) },
          ],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const message = await client.messages(sid).update({ status: 'canceled' })

      expect(message.status).toBe('canceled')
    })
  })

  describe('messages.delete()', () => {
    it('should delete a message', async () => {
      const sid = 'SM' + '0'.repeat(32)
      const mockFetch = createMockFetch(
        new Map([
          [`DELETE /2010-04-01/Accounts/ACtest123/Messages/${sid}.json`, { status: 204, body: {} }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const result = await client.messages(sid).remove()

      expect(result).toBe(true)
    })
  })

  describe('delivery status', () => {
    it('should track message status progression', async () => {
      // queued -> sending -> sent -> delivered
      const statuses = ['queued', 'sending', 'sent', 'delivered'] as const

      for (const status of statuses) {
        const message = mockMessage({ status })
        expect(['queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed']).toContain(message.status)
      }
    })

    it('should handle failed message', async () => {
      const message = mockMessage({
        status: 'failed',
        error_code: 30003,
        error_message: 'Unreachable destination handset',
      })

      expect(message.status).toBe('failed')
      expect(message.error_code).toBe(30003)
      expect(message.error_message).toBe('Unreachable destination handset')
    })
  })
})

// =============================================================================
// Voice Calls Tests
// =============================================================================

describe('@dotdo/twilio - Voice Calls', () => {
  describe('calls.create()', () => {
    it('should make an outbound call with URL', async () => {
      const expectedCall = mockCall()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Calls.json`, { status: 201, body: expectedCall }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const call = await client.calls.create({
        url: 'https://example.com/twiml',
        to: '+15558675310',
        from: '+15017122661',
      })

      expect(call.sid).toMatch(/^CA/)
      expect(call.status).toBe('queued')
    })

    it('should make a call with inline TwiML', async () => {
      const expectedCall = mockCall()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Calls.json`, { status: 201, body: expectedCall }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const call = await client.calls.create({
        twiml: '<Response><Say>Hello World!</Say></Response>',
        to: '+15558675310',
        from: '+15017122661',
      })

      expect(call.sid).toBeDefined()
    })

    it('should throw error without url or twiml', async () => {
      const client = new Twilio('ACtest123', 'authtoken123')

      await expect(
        client.calls.create({
          to: '+15558675310',
          from: '+15017122661',
        } as any)
      ).rejects.toThrow()
    })

    it('should support status callback', async () => {
      const expectedCall = mockCall()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Calls.json`, { status: 201, body: expectedCall }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const call = await client.calls.create({
        url: 'https://example.com/twiml',
        to: '+15558675310',
        from: '+15017122661',
        statusCallback: 'https://example.com/status',
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      })

      expect(call.sid).toBeDefined()
    })

    it('should support machine detection', async () => {
      const expectedCall = mockCall()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Calls.json`, { status: 201, body: expectedCall }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const call = await client.calls.create({
        url: 'https://example.com/twiml',
        to: '+15558675310',
        from: '+15017122661',
        machineDetection: 'Enable',
        asyncAmd: true,
      })

      expect(call.sid).toBeDefined()
    })

    it('should support call recording', async () => {
      const expectedCall = mockCall()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Calls.json`, { status: 201, body: expectedCall }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const call = await client.calls.create({
        url: 'https://example.com/twiml',
        to: '+15558675310',
        from: '+15017122661',
        record: true,
        recordingChannels: 'dual',
      })

      expect(call.sid).toBeDefined()
    })
  })

  describe('calls.get()', () => {
    it('should retrieve a call by SID', async () => {
      const sid = 'CA' + '0'.repeat(32)
      const expectedCall = mockCall({ sid })
      const mockFetch = createMockFetch(
        new Map([
          [`GET /2010-04-01/Accounts/ACtest123/Calls/${sid}.json`, { status: 200, body: expectedCall }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const call = await client.calls(sid).fetch()

      expect(call.sid).toBe(sid)
    })
  })

  describe('calls.update()', () => {
    it('should update call with new TwiML URL', async () => {
      const sid = 'CA' + '0'.repeat(32)
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Calls/${sid}.json`, { status: 200, body: mockCall({ sid }) }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const call = await client.calls(sid).update({
        url: 'https://example.com/new-twiml',
      })

      expect(call.sid).toBe(sid)
    })

    it('should cancel a call', async () => {
      const sid = 'CA' + '0'.repeat(32)
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Calls/${sid}.json`, { status: 200, body: mockCall({ sid, status: 'canceled' }) }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const call = await client.calls(sid).update({
        status: 'canceled',
      })

      expect(call.status).toBe('canceled')
    })

    it('should complete a call', async () => {
      const sid = 'CA' + '0'.repeat(32)
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Calls/${sid}.json`, { status: 200, body: mockCall({ sid, status: 'completed' }) }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const call = await client.calls(sid).update({
        status: 'completed',
      })

      expect(call.status).toBe('completed')
    })
  })

  describe('calls.list()', () => {
    it('should list calls', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /2010-04-01/Accounts/ACtest123/Calls.json`,
            {
              status: 200,
              body: {
                calls: [mockCall(), mockCall({ sid: 'CA' + '1'.repeat(32) })],
                page: 0,
                page_size: 50,
              },
            },
          ],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const result = await client.calls.list()

      expect(result).toHaveLength(2)
    })

    it('should filter calls by status', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /2010-04-01/Accounts/ACtest123/Calls.json`,
            {
              status: 200,
              body: {
                calls: [mockCall({ status: 'completed' })],
                page: 0,
                page_size: 50,
              },
            },
          ],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const result = await client.calls.list({ status: 'completed' })

      expect(result).toHaveLength(1)
      expect(result[0].status).toBe('completed')
    })
  })

  describe('call status', () => {
    it('should track call status progression', async () => {
      // queued -> ringing -> in-progress -> completed
      const statuses = ['queued', 'ringing', 'in-progress', 'completed'] as const

      for (const status of statuses) {
        const call = mockCall({ status })
        expect([
          'queued', 'ringing', 'in-progress', 'completed',
          'busy', 'failed', 'no-answer', 'canceled',
        ]).toContain(call.status)
      }
    })
  })
})

// =============================================================================
// WhatsApp Messages Tests
// =============================================================================

describe('@dotdo/twilio - WhatsApp', () => {
  describe('sending WhatsApp messages', () => {
    it('should send a WhatsApp message', async () => {
      const expectedMessage = mockMessage({
        from: 'whatsapp:+14155238886',
        to: 'whatsapp:+15558675310',
      })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const message = await client.messages.create({
        body: 'Hello from WhatsApp!',
        from: 'whatsapp:+14155238886',
        to: 'whatsapp:+15558675310',
      })

      expect(message.from).toBe('whatsapp:+14155238886')
      expect(message.to).toBe('whatsapp:+15558675310')
    })

    it('should send a WhatsApp template message', async () => {
      const expectedMessage = mockMessage({
        from: 'whatsapp:+14155238886',
        to: 'whatsapp:+15558675310',
      })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const message = await client.messages.create({
        from: 'whatsapp:+14155238886',
        to: 'whatsapp:+15558675310',
        contentSid: 'HX' + '0'.repeat(32),
        contentVariables: JSON.stringify({ '1': 'John', '2': '12:00 PM' }),
      })

      expect(message.sid).toBeDefined()
    })

    it('should send WhatsApp media message', async () => {
      const expectedMessage = mockMessage({
        from: 'whatsapp:+14155238886',
        to: 'whatsapp:+15558675310',
        num_media: '1',
      })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /2010-04-01/Accounts/ACtest123/Messages.json`, { status: 201, body: expectedMessage }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const message = await client.messages.create({
        body: 'Check out this image!',
        from: 'whatsapp:+14155238886',
        to: 'whatsapp:+15558675310',
        mediaUrl: ['https://example.com/image.jpg'],
      })

      expect(message.num_media).toBe('1')
    })
  })

  describe('WhatsApp session vs template', () => {
    it('should identify session message (24h window)', async () => {
      // Session messages can be sent within 24 hours of last inbound message
      const message = mockMessage({
        from: 'whatsapp:+14155238886',
        to: 'whatsapp:+15558675310',
      })

      expect(message.from.startsWith('whatsapp:')).toBe(true)
    })

    it('should require template for outbound outside session window', async () => {
      // Templates are required when initiating conversation or outside 24h window
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /2010-04-01/Accounts/ACtest123/Messages.json`,
            {
              status: 400,
              body: {
                code: 63016,
                message: 'Freeform messages are not allowed when the session has expired. Use a template to send the message.',
                more_info: 'https://www.twilio.com/docs/errors/63016',
                status: 400,
              },
            },
          ],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })

      await expect(
        client.messages.create({
          body: 'Hello!', // Freeform without template
          from: 'whatsapp:+14155238886',
          to: 'whatsapp:+15558675310',
        })
      ).rejects.toThrow(TwilioAPIError)
    })
  })
})

// =============================================================================
// Verify (OTP) Tests
// =============================================================================

describe('@dotdo/twilio - Verify', () => {
  const serviceSid = 'VA' + '0'.repeat(32)

  describe('verifications.create()', () => {
    it('should create an SMS verification', async () => {
      const expectedVerification = mockVerification()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v2/Services/${serviceSid}/Verifications`, { status: 201, body: expectedVerification }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const verification = await client.verify.v2
        .services(serviceSid)
        .verifications.create({
          to: '+15558675310',
          channel: 'sms',
        })

      expect(verification.sid).toMatch(/^VE/)
      expect(verification.status).toBe('pending')
      expect(verification.channel).toBe('sms')
    })

    it('should create a call verification', async () => {
      const expectedVerification = mockVerification({ channel: 'call' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v2/Services/${serviceSid}/Verifications`, { status: 201, body: expectedVerification }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const verification = await client.verify.v2
        .services(serviceSid)
        .verifications.create({
          to: '+15558675310',
          channel: 'call',
        })

      expect(verification.channel).toBe('call')
    })

    it('should create an email verification', async () => {
      const expectedVerification = mockVerification({ channel: 'email', to: 'user@example.com' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v2/Services/${serviceSid}/Verifications`, { status: 201, body: expectedVerification }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const verification = await client.verify.v2
        .services(serviceSid)
        .verifications.create({
          to: 'user@example.com',
          channel: 'email',
        })

      expect(verification.channel).toBe('email')
      expect(verification.to).toBe('user@example.com')
    })

    it('should create a WhatsApp verification', async () => {
      const expectedVerification = mockVerification({ channel: 'whatsapp' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v2/Services/${serviceSid}/Verifications`, { status: 201, body: expectedVerification }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const verification = await client.verify.v2
        .services(serviceSid)
        .verifications.create({
          to: '+15558675310',
          channel: 'whatsapp',
        })

      expect(verification.channel).toBe('whatsapp')
    })

    it('should support custom code length', async () => {
      const expectedVerification = mockVerification()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v2/Services/${serviceSid}/Verifications`, { status: 201, body: expectedVerification }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const verification = await client.verify.v2
        .services(serviceSid)
        .verifications.create({
          to: '+15558675310',
          channel: 'sms',
          codeLength: 6,
        })

      expect(verification.sid).toBeDefined()
    })

    it('should support custom message locale', async () => {
      const expectedVerification = mockVerification()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v2/Services/${serviceSid}/Verifications`, { status: 201, body: expectedVerification }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const verification = await client.verify.v2
        .services(serviceSid)
        .verifications.create({
          to: '+15558675310',
          channel: 'sms',
          locale: 'es',
        })

      expect(verification.sid).toBeDefined()
    })

    it('should handle rate limiting', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v2/Services/${serviceSid}/Verifications`,
            {
              status: 429,
              body: {
                code: 60203,
                message: 'Max send attempts reached',
                more_info: 'https://www.twilio.com/docs/errors/60203',
                status: 429,
              },
            },
          ],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })

      await expect(
        client.verify.v2.services(serviceSid).verifications.create({
          to: '+15558675310',
          channel: 'sms',
        })
      ).rejects.toThrow(TwilioAPIError)
    })
  })

  describe('verificationChecks.create()', () => {
    it('should verify a code successfully', async () => {
      const expectedCheck = mockVerificationCheck({ valid: true, status: 'approved' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v2/Services/${serviceSid}/VerificationCheck`, { status: 200, body: expectedCheck }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const check = await client.verify.v2
        .services(serviceSid)
        .verificationChecks.create({
          to: '+15558675310',
          code: '123456',
        })

      expect(check.valid).toBe(true)
      expect(check.status).toBe('approved')
    })

    it('should reject invalid code', async () => {
      const expectedCheck = mockVerificationCheck({ valid: false, status: 'pending' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v2/Services/${serviceSid}/VerificationCheck`, { status: 200, body: expectedCheck }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const check = await client.verify.v2
        .services(serviceSid)
        .verificationChecks.create({
          to: '+15558675310',
          code: '000000',
        })

      expect(check.valid).toBe(false)
      expect(check.status).toBe('pending')
    })

    it('should verify using verification SID', async () => {
      const verificationSid = 'VE' + '0'.repeat(32)
      const expectedCheck = mockVerificationCheck({ sid: verificationSid, valid: true })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v2/Services/${serviceSid}/VerificationCheck`, { status: 200, body: expectedCheck }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const check = await client.verify.v2
        .services(serviceSid)
        .verificationChecks.create({
          verificationSid,
          code: '123456',
        })

      expect(check.sid).toBe(verificationSid)
      expect(check.valid).toBe(true)
    })

    it('should handle expired verification', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v2/Services/${serviceSid}/VerificationCheck`,
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

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })

      await expect(
        client.verify.v2.services(serviceSid).verificationChecks.create({
          to: '+15558675310',
          code: '123456',
        })
      ).rejects.toThrow(TwilioAPIError)
    })

    it('should handle max check attempts', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v2/Services/${serviceSid}/VerificationCheck`,
            {
              status: 429,
              body: {
                code: 60202,
                message: 'Max check attempts reached',
                more_info: 'https://www.twilio.com/docs/errors/60202',
                status: 429,
              },
            },
          ],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })

      await expect(
        client.verify.v2.services(serviceSid).verificationChecks.create({
          to: '+15558675310',
          code: '123456',
        })
      ).rejects.toThrow(TwilioAPIError)
    })
  })

  describe('verifications.get()', () => {
    it('should retrieve a verification by SID', async () => {
      const verificationSid = 'VE' + '0'.repeat(32)
      const expectedVerification = mockVerification({ sid: verificationSid })
      const mockFetch = createMockFetch(
        new Map([
          [`GET /v2/Services/${serviceSid}/Verifications/${verificationSid}`, { status: 200, body: expectedVerification }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const verification = await client.verify.v2
        .services(serviceSid)
        .verifications(verificationSid)
        .fetch()

      expect(verification.sid).toBe(verificationSid)
    })
  })

  describe('verifications.update()', () => {
    it('should cancel a verification', async () => {
      const verificationSid = 'VE' + '0'.repeat(32)
      const expectedVerification = mockVerification({ sid: verificationSid, status: 'canceled' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v2/Services/${serviceSid}/Verifications/${verificationSid}`, { status: 200, body: expectedVerification }],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
      const verification = await client.verify.v2
        .services(serviceSid)
        .verifications(verificationSid)
        .update({ status: 'canceled' })

      expect(verification.status).toBe('canceled')
    })
  })
})

// =============================================================================
// Webhook Signature Verification Tests
// =============================================================================

describe('@dotdo/twilio - Webhooks', () => {
  const authToken = 'test_auth_token'
  const url = 'https://mycompany.com/myapp'
  const params = {
    CallSid: 'CA1234567890ABCDE',
    Caller: '+14155551234',
    Digits: '1234',
    From: '+14155551234',
    To: '+18005551212',
  }

  describe('validateRequest', () => {
    it('should validate a correct signature', async () => {
      // This would require generating a proper signature
      const signature = await Webhooks.getExpectedTwilioSignature(authToken, url, params)

      const isValid = await Webhooks.validateRequest(authToken, signature, url, params)
      expect(isValid).toBe(true)
    })

    it('should reject an incorrect signature', async () => {
      const signature = 'invalid_signature'

      const isValid = await Webhooks.validateRequest(authToken, signature, url, params)
      expect(isValid).toBe(false)
    })

    it('should validate empty body with URL', async () => {
      const emptyParams = {}
      const signature = await Webhooks.getExpectedTwilioSignature(authToken, url, emptyParams)

      const isValid = await Webhooks.validateRequest(authToken, signature, url, emptyParams)
      expect(isValid).toBe(true)
    })
  })

  describe('validateRequestWithBody', () => {
    it('should validate signature with raw body', async () => {
      const body = JSON.stringify({ test: 'data' })
      const bodyHash = await Webhooks.getBodyHash(body)
      const urlWithHash = `${url}?bodySHA256=${bodyHash}`
      const signature = await Webhooks.getExpectedTwilioSignature(authToken, urlWithHash, {})

      const isValid = await Webhooks.validateRequestWithBody(authToken, signature, url, body)
      expect(isValid).toBe(true)
    })
  })

  describe('getExpectedTwilioSignature', () => {
    it('should generate consistent signature', async () => {
      const sig1 = await Webhooks.getExpectedTwilioSignature(authToken, url, params)
      const sig2 = await Webhooks.getExpectedTwilioSignature(authToken, url, params)

      expect(sig1).toBe(sig2)
    })

    it('should generate different signatures for different params', async () => {
      const sig1 = await Webhooks.getExpectedTwilioSignature(authToken, url, params)
      const sig2 = await Webhooks.getExpectedTwilioSignature(authToken, url, { ...params, Digits: '5678' })

      expect(sig1).not.toBe(sig2)
    })

    it('should generate different signatures for different URLs', async () => {
      const sig1 = await Webhooks.getExpectedTwilioSignature(authToken, url, params)
      const sig2 = await Webhooks.getExpectedTwilioSignature(authToken, url + '/different', params)

      expect(sig1).not.toBe(sig2)
    })
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('@dotdo/twilio - Error Handling', () => {
  describe('TwilioAPIError', () => {
    it('should include error code', async () => {
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

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })

      try {
        await client.messages.create({
          body: 'Hello!',
          from: '+15017122661',
          to: 'invalid',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(TwilioAPIError)
        const twilioError = error as TwilioAPIError
        expect(twilioError.code).toBe(21211)
        expect(twilioError.status).toBe(400)
        expect(twilioError.moreInfo).toBe('https://www.twilio.com/docs/errors/21211')
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

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })

      try {
        await client.messages.create({
          body: 'Hello!',
          from: '+15017122661',
          to: '+15558675310',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(TwilioAPIError)
        const twilioError = error as TwilioAPIError
        expect(twilioError.code).toBe(20003)
        expect(twilioError.status).toBe(401)
      }
    })

    it('should handle rate limiting', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /2010-04-01/Accounts/ACtest123/Messages.json`,
            {
              status: 429,
              body: {
                code: 20429,
                message: 'Too many requests',
                more_info: 'https://www.twilio.com/docs/errors/20429',
                status: 429,
              },
            },
          ],
        ])
      )

      const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })

      try {
        await client.messages.create({
          body: 'Hello!',
          from: '+15017122661',
          to: '+15558675310',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(TwilioAPIError)
        const twilioError = error as TwilioAPIError
        expect(twilioError.code).toBe(20429)
        expect(twilioError.status).toBe(429)
      }
    })
  })
})

// =============================================================================
// Request Options Tests
// =============================================================================

describe('@dotdo/twilio - Request Options', () => {
  it('should support timeout option', async () => {
    const client = new Twilio('ACtest123', 'authtoken123', {
      timeout: 5000,
    })
    expect(client).toBeDefined()
  })

  it('should support retry configuration', async () => {
    const client = new Twilio('ACtest123', 'authtoken123', {
      autoRetry: true,
      maxRetries: 3,
    })
    expect(client).toBeDefined()
  })

  it('should use Basic Auth header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers(),
      json: async () => mockMessage(),
    })

    const client = new Twilio('ACtest123', 'authtoken123', { fetch: mockFetch })
    await client.messages.create({
      body: 'Hello!',
      from: '+15017122661',
      to: '+15558675310',
    })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Basic /),
        }),
      })
    )
  })
})
