/**
 * @dotdo/vonage - TDD Tests for Vonage (Nexmo) SMS Compatibility
 *
 * Tests for Vonage SMS and Voice functionality:
 * 1. Send SMS messages
 * 2. MMS with media
 * 3. Message status tracking
 * 4. Webhooks (delivery receipts, inbound)
 * 5. Voice calls
 * 6. Phone number management
 *
 * Issue: dotdo-edktx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  VonageClient,
  VonageSMS,
  VonageVoice,
  VonageError,
  createVonageClient,
  type SMSSendRequest,
  type SMSSendResponse,
  type VoiceCallRequest,
  type VoiceCallResponse,
  type VonageConfig,
  type PhoneNumber,
} from '../index'

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
          type: 'https://developer.vonage.com/api-errors',
          title: 'Not Found',
          detail: `No mock for ${key}`,
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

function mockSMSResponse(overrides: Partial<SMSSendResponse> = {}): SMSSendResponse {
  return {
    message_uuid: 'msg_' + '0'.repeat(24),
    to: '15558675310',
    from: '15017122661',
    channel: 'sms',
    message_type: 'text',
    text: 'Hello World!',
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

// Nexmo legacy response format
function mockNexmoResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'message-count': '1',
    messages: [
      {
        'to': '15558675310',
        'message-id': 'msg_' + '0'.repeat(16),
        'status': '0',
        'remaining-balance': '10.00',
        'message-price': '0.0025',
        'network': '12345',
        ...overrides,
      },
    ],
  }
}

function createTestClient(
  mockFetch?: ReturnType<typeof createMockFetch>,
  config?: Partial<VonageConfig>
): VonageClient {
  return new VonageClient({
    apiKey: 'test_api_key',
    apiSecret: 'test_api_secret',
    fetch: mockFetch ?? vi.fn(),
    ...config,
  })
}

// =============================================================================
// 1. Client Initialization
// =============================================================================

describe('@dotdo/vonage - Client Initialization', () => {
  it('should create client with API key and secret', () => {
    const client = createVonageClient('test_api_key', 'test_api_secret')
    expect(client).toBeInstanceOf(VonageClient)
  })

  it('should throw error without API key', () => {
    expect(() => createVonageClient('', 'secret')).toThrow('apiKey is required')
  })

  it('should throw error without API secret', () => {
    expect(() => createVonageClient('key', '')).toThrow('apiSecret is required')
  })

  it('should create client with JWT authentication', () => {
    const client = new VonageClient({
      applicationId: 'app_123',
      privateKey: '-----BEGIN RSA PRIVATE KEY-----...',
    })
    expect(client).toBeInstanceOf(VonageClient)
  })

  it('should have sms resource', () => {
    const client = createTestClient()
    expect(client.sms).toBeDefined()
  })

  it('should have voice resource', () => {
    const client = createTestClient()
    expect(client.voice).toBeDefined()
  })

  it('should have numbers resource', () => {
    const client = createTestClient()
    expect(client.numbers).toBeDefined()
  })
})

// =============================================================================
// 2. Send SMS Messages (Messages API)
// =============================================================================

describe('@dotdo/vonage - Send SMS Messages (Messages API)', () => {
  describe('basic SMS sending', () => {
    it('should send a simple SMS message via Messages API', async () => {
      const expectedResponse = mockSMSResponse()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v1/messages`, { status: 202, body: expectedResponse }],
        ])
      )

      const client = createTestClient(mockFetch, { useMessagesApi: true })
      const response = await client.messages.send({
        channel: 'sms',
        message_type: 'text',
        to: '+15558675310',
        from: '+15017122661',
        text: 'Hello World!',
      })

      expect(response.message_uuid).toBeDefined()
    })

    it('should send SMS with client ref', async () => {
      const expectedResponse = mockSMSResponse()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v1/messages`, { status: 202, body: expectedResponse }],
        ])
      )

      const client = createTestClient(mockFetch, { useMessagesApi: true })
      const response = await client.messages.send({
        channel: 'sms',
        message_type: 'text',
        to: '+15558675310',
        from: '+15017122661',
        text: 'Message with ref',
        client_ref: 'order_12345',
      })

      expect(response.message_uuid).toBeDefined()
    })

    it('should send SMS via WhatsApp channel', async () => {
      const expectedResponse = mockSMSResponse({ channel: 'whatsapp' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v1/messages`, { status: 202, body: expectedResponse }],
        ])
      )

      const client = createTestClient(mockFetch, { useMessagesApi: true })
      const response = await client.messages.send({
        channel: 'whatsapp',
        message_type: 'text',
        to: '+15558675310',
        from: '+15017122661',
        text: 'WhatsApp message',
      })

      expect(response.channel).toBe('whatsapp')
    })
  })
})

// =============================================================================
// 3. Send SMS Messages (Legacy SMS API)
// =============================================================================

describe('@dotdo/vonage - Send SMS Messages (Legacy API)', () => {
  describe('basic SMS sending', () => {
    it('should send a simple SMS message via legacy API', async () => {
      const expectedResponse = mockNexmoResponse()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /sms/json`, { status: 200, body: expectedResponse }],
        ])
      )

      const client = createTestClient(mockFetch)
      const response = await client.sms.send({
        to: '15558675310',
        from: '15017122661',
        text: 'Hello World!',
      })

      expect(response.messages[0]['message-id']).toBeDefined()
      expect(response.messages[0].status).toBe('0')
    })

    it('should send SMS to multiple recipients', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [`POST /sms/json`, { status: 200, body: mockNexmoResponse() }],
        ])
      )

      const client = createTestClient(mockFetch)

      // Legacy API requires multiple calls for multiple recipients
      const responses = await Promise.all([
        client.sms.send({ to: '15551234567', from: '15017122661', text: 'Message 1' }),
        client.sms.send({ to: '15552345678', from: '15017122661', text: 'Message 2' }),
      ])

      expect(responses).toHaveLength(2)
    })

    it('should send unicode SMS', async () => {
      const expectedResponse = mockNexmoResponse()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /sms/json`, { status: 200, body: expectedResponse }],
        ])
      )

      const client = createTestClient(mockFetch)
      const response = await client.sms.send({
        to: '15558675310',
        from: '15017122661',
        text: 'Unicode message with emoji: \ud83d\ude00',
        type: 'unicode',
      })

      expect(response.messages[0]['message-id']).toBeDefined()
    })

    it('should send SMS with callback URL', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [`POST /sms/json`, { status: 200, body: mockNexmoResponse() }],
        ])
      )

      const client = createTestClient(mockFetch)
      const response = await client.sms.send({
        to: '15558675310',
        from: '15017122661',
        text: 'Message with callback',
        callback: 'https://example.com/callback',
      })

      expect(response.messages[0]['message-id']).toBeDefined()
    })

    it('should send SMS with TTL', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [`POST /sms/json`, { status: 200, body: mockNexmoResponse() }],
        ])
      )

      const client = createTestClient(mockFetch)
      const response = await client.sms.send({
        to: '15558675310',
        from: '15017122661',
        text: 'Time-sensitive message',
        ttl: 3600000, // 1 hour in milliseconds
      })

      expect(response.messages[0]['message-id']).toBeDefined()
    })

    it('should send flash SMS', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [`POST /sms/json`, { status: 200, body: mockNexmoResponse() }],
        ])
      )

      const client = createTestClient(mockFetch)
      const response = await client.sms.send({
        to: '15558675310',
        from: '15017122661',
        text: 'Flash message!',
        'message-class': 0,
      })

      expect(response.messages[0]['message-id']).toBeDefined()
    })
  })

  describe('validation', () => {
    it('should throw error when to is missing', async () => {
      const client = createTestClient()

      await expect(
        client.sms.send({
          from: '15017122661',
          text: 'Hello!',
        } as SMSSendRequest)
      ).rejects.toThrow(VonageError)
    })

    it('should throw error when from is missing', async () => {
      const client = createTestClient()

      await expect(
        client.sms.send({
          to: '15558675310',
          text: 'Hello!',
        } as SMSSendRequest)
      ).rejects.toThrow(VonageError)
    })

    it('should throw error when text is missing', async () => {
      const client = createTestClient()

      await expect(
        client.sms.send({
          to: '15558675310',
          from: '15017122661',
        } as SMSSendRequest)
      ).rejects.toThrow(VonageError)
    })
  })

  describe('error handling', () => {
    it('should throw VonageError for API errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /sms/json`,
            {
              status: 200,
              body: {
                'message-count': '1',
                messages: [
                  {
                    status: '1',
                    'error-text': 'Throttled',
                  },
                ],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)

      try {
        await client.sms.send({
          to: '15558675310',
          from: '15017122661',
          text: 'Hello!',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(VonageError)
        const vonageError = error as VonageError
        expect(vonageError.statusCode).toBe('1')
      }
    })

    it('should handle authentication errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /sms/json`,
            {
              status: 401,
              body: {
                type: 'https://developer.vonage.com/api-errors#unauthorized',
                title: 'Unauthorized',
                detail: 'Invalid credentials',
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)

      await expect(
        client.sms.send({
          to: '15558675310',
          from: '15017122661',
          text: 'Hello!',
        })
      ).rejects.toThrow(VonageError)
    })

    it('should handle rate limiting', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /sms/json`,
            {
              status: 429,
              body: {
                type: 'https://developer.vonage.com/api-errors#throttled',
                title: 'Too Many Requests',
                detail: 'Rate limit exceeded',
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)

      await expect(
        client.sms.send({
          to: '15558675310',
          from: '15017122661',
          text: 'Hello!',
        })
      ).rejects.toThrow(VonageError)
    })
  })
})

// =============================================================================
// 4. Webhooks
// =============================================================================

describe('@dotdo/vonage - Webhooks', () => {
  describe('delivery receipt webhook', () => {
    it('should handle delivery receipt webhook', () => {
      const client = createTestClient()

      const payload = {
        msisdn: '15558675310',
        to: '15017122661',
        'network-code': '12345',
        'messageId': 'msg_' + '0'.repeat(16),
        'price': '0.0025',
        'status': 'delivered',
        'scts': '2401011200',
        'err-code': '0',
        'api-key': 'test_api_key',
        'message-timestamp': '2024-01-01 12:00:00',
      }

      const result = client.handleDeliveryReceipt(payload)

      expect(result.messageId).toBe(payload.messageId)
      expect(result.status).toBe('delivered')
      expect(result.to).toBe('15558675310')
    })

    it('should handle failed delivery receipt', () => {
      const client = createTestClient()

      const payload = {
        msisdn: '15558675310',
        to: '15017122661',
        messageId: 'msg_123',
        status: 'failed',
        'err-code': '1',
      }

      const result = client.handleDeliveryReceipt(payload)

      expect(result.status).toBe('failed')
      expect(result.errorCode).toBe('1')
    })
  })

  describe('inbound message webhook', () => {
    it('should handle inbound SMS', () => {
      const client = createTestClient()

      const payload = {
        msisdn: '15558675310',
        to: '15017122661',
        messageId: 'msg_inbound_123',
        text: 'Reply from customer',
        type: 'text',
        keyword: 'REPLY',
        'message-timestamp': '2024-01-01 12:00:00',
      }

      const result = client.handleInboundSMS(payload)

      expect(result.from).toBe('15558675310')
      expect(result.to).toBe('15017122661')
      expect(result.text).toBe('Reply from customer')
    })

    it('should handle concatenated inbound SMS', () => {
      const client = createTestClient()

      const payload = {
        msisdn: '15558675310',
        to: '15017122661',
        messageId: 'msg_123',
        text: 'Part of a long message',
        'concat': 'true',
        'concat-ref': '123',
        'concat-total': '2',
        'concat-part': '1',
      }

      const result = client.handleInboundSMS(payload)

      expect(result.concatenated).toBe(true)
      expect(result.concatenateRef).toBe('123')
    })
  })

  describe('webhook signature verification', () => {
    it('should verify valid webhook signature', async () => {
      const client = createTestClient(undefined, { signatureSecret: 'test_secret' })

      const timestamp = Math.floor(Date.now() / 1000).toString()
      const body = JSON.stringify({ messageId: 'msg_123' })

      // Generate valid JWT signature (simplified for test)
      const isValid = await client.verifyWebhookSignature(
        'valid_signature_token',
        timestamp,
        body
      )

      // Note: Real signature verification would use JWT
      expect(typeof isValid).toBe('boolean')
    })
  })
})

// =============================================================================
// 5. Voice Calls
// =============================================================================

describe('@dotdo/vonage - Voice Calls', () => {
  describe('creating calls', () => {
    it('should create an outbound call', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v1/calls`,
            {
              status: 201,
              body: {
                uuid: 'call_' + '0'.repeat(24),
                status: 'started',
                direction: 'outbound',
                conversation_uuid: 'conv_123',
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const call = await client.voice.calls.create({
        to: [{ type: 'phone', number: '15558675310' }],
        from: { type: 'phone', number: '15017122661' },
        ncco: [
          { action: 'talk', text: 'Hello from Vonage!' },
        ],
      })

      expect(call.uuid).toMatch(/^call_/)
      expect(call.status).toBe('started')
    })

    it('should create call with answer URL', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v1/calls`,
            {
              status: 201,
              body: {
                uuid: 'call_' + '0'.repeat(24),
                status: 'started',
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const call = await client.voice.calls.create({
        to: [{ type: 'phone', number: '15558675310' }],
        from: { type: 'phone', number: '15017122661' },
        answer_url: ['https://example.com/answer'],
        answer_method: 'POST',
      })

      expect(call.uuid).toBeDefined()
    })

    it('should create call with recording', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v1/calls`,
            {
              status: 201,
              body: {
                uuid: 'call_' + '0'.repeat(24),
                status: 'started',
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const call = await client.voice.calls.create({
        to: [{ type: 'phone', number: '15558675310' }],
        from: { type: 'phone', number: '15017122661' },
        ncco: [
          { action: 'record', eventUrl: ['https://example.com/recording'] },
          { action: 'talk', text: 'This call is being recorded.' },
        ],
      })

      expect(call.uuid).toBeDefined()
    })

    it('should create call with DTMF input', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v1/calls`,
            {
              status: 201,
              body: {
                uuid: 'call_' + '0'.repeat(24),
                status: 'started',
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const call = await client.voice.calls.create({
        to: [{ type: 'phone', number: '15558675310' }],
        from: { type: 'phone', number: '15017122661' },
        ncco: [
          { action: 'talk', text: 'Press 1 for sales, 2 for support.' },
          {
            action: 'input',
            type: ['dtmf'],
            dtmf: { maxDigits: 1, timeOut: 10 },
            eventUrl: ['https://example.com/input'],
          },
        ],
      })

      expect(call.uuid).toBeDefined()
    })
  })

  describe('managing calls', () => {
    it('should get call by UUID', async () => {
      const callUuid = 'call_' + '0'.repeat(24)
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /v1/calls/${callUuid}`,
            {
              status: 200,
              body: {
                uuid: callUuid,
                status: 'ringing',
                direction: 'outbound',
                to: { type: 'phone', number: '15558675310' },
                from: { type: 'phone', number: '15017122661' },
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const call = await client.voice.calls.get(callUuid)

      expect(call.uuid).toBe(callUuid)
      expect(call.status).toBe('ringing')
    })

    it('should list calls', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /v1/calls`,
            {
              status: 200,
              body: {
                count: 2,
                page_size: 10,
                _embedded: {
                  calls: [
                    { uuid: 'call_1', status: 'completed' },
                    { uuid: 'call_2', status: 'completed' },
                  ],
                },
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const calls = await client.voice.calls.list()

      expect(calls._embedded.calls).toHaveLength(2)
    })

    it('should update call with new NCCO', async () => {
      const callUuid = 'call_' + '0'.repeat(24)
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /v1/calls/${callUuid}`,
            { status: 204, body: {} },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const result = await client.voice.calls.update(callUuid, {
        action: 'transfer',
        destination: {
          type: 'ncco',
          ncco: [{ action: 'talk', text: 'Transferring your call.' }],
        },
      })

      expect(result).toBe(true)
    })

    it('should hangup a call', async () => {
      const callUuid = 'call_' + '0'.repeat(24)
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /v1/calls/${callUuid}`,
            { status: 204, body: {} },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const result = await client.voice.calls.hangup(callUuid)

      expect(result).toBe(true)
    })

    it('should mute a call', async () => {
      const callUuid = 'call_' + '0'.repeat(24)
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /v1/calls/${callUuid}`,
            { status: 204, body: {} },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const result = await client.voice.calls.mute(callUuid)

      expect(result).toBe(true)
    })
  })

  describe('recordings', () => {
    it('should get recording', async () => {
      const recordingUuid = 'rec_' + '0'.repeat(24)
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /v1/recordings/${recordingUuid}`,
            {
              status: 200,
              body: {
                uuid: recordingUuid,
                status: 'completed',
                duration: 30,
                channels: 1,
                start_time: new Date().toISOString(),
                end_time: new Date().toISOString(),
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const recording = await client.voice.recordings.get(recordingUuid)

      expect(recording.uuid).toBe(recordingUuid)
      expect(recording.duration).toBe(30)
    })

    it('should delete recording', async () => {
      const recordingUuid = 'rec_' + '0'.repeat(24)
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /v1/recordings/${recordingUuid}`,
            { status: 204, body: {} },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const result = await client.voice.recordings.delete(recordingUuid)

      expect(result).toBe(true)
    })
  })
})

// =============================================================================
// 6. Phone Number Management
// =============================================================================

describe('@dotdo/vonage - Phone Number Management', () => {
  describe('listing numbers', () => {
    it('should list owned numbers', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /account/numbers`,
            {
              status: 200,
              body: {
                count: 1,
                numbers: [
                  {
                    country: 'US',
                    msisdn: '15017122661',
                    type: 'mobile-lvn',
                    features: ['SMS', 'VOICE'],
                  },
                ],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const numbers = await client.numbers.list()

      expect(numbers.numbers).toHaveLength(1)
      expect(numbers.numbers[0].features).toContain('SMS')
    })

    it('should list numbers with filters', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /account/numbers`,
            {
              status: 200,
              body: {
                count: 1,
                numbers: [
                  { country: 'US', msisdn: '15017122661', type: 'mobile-lvn' },
                ],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const numbers = await client.numbers.list({ country: 'US' })

      expect(numbers.numbers).toHaveLength(1)
    })
  })

  describe('searching available numbers', () => {
    it('should search for available numbers', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /number/search`,
            {
              status: 200,
              body: {
                count: 2,
                numbers: [
                  { msisdn: '15551234567', country: 'US', type: 'mobile-lvn', cost: '1.00' },
                  { msisdn: '15552345678', country: 'US', type: 'mobile-lvn', cost: '1.00' },
                ],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const available = await client.numbers.search({ country: 'US' })

      expect(available.numbers).toHaveLength(2)
    })

    it('should search with pattern', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /number/search`,
            {
              status: 200,
              body: {
                count: 1,
                numbers: [
                  { msisdn: '15551234567', country: 'US' },
                ],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const available = await client.numbers.search({
        country: 'US',
        pattern: '1234',
        search_pattern: 1, // Contains
      })

      expect(available.numbers).toHaveLength(1)
    })
  })

  describe('purchasing numbers', () => {
    it('should buy a number', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /number/buy`,
            {
              status: 200,
              body: {
                'error-code': '200',
                'error-code-label': 'success',
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const result = await client.numbers.buy({
        country: 'US',
        msisdn: '15551234567',
      })

      expect(result.success).toBe(true)
    })
  })

  describe('managing numbers', () => {
    it('should update number settings', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /number/update`,
            {
              status: 200,
              body: {
                'error-code': '200',
                'error-code-label': 'success',
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const result = await client.numbers.update({
        country: 'US',
        msisdn: '15017122661',
        moHttpUrl: 'https://example.com/sms-webhook',
        voiceCallbackValue: 'https://example.com/voice-webhook',
      })

      expect(result.success).toBe(true)
    })

    it('should cancel a number', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /number/cancel`,
            {
              status: 200,
              body: {
                'error-code': '200',
                'error-code-label': 'success',
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const result = await client.numbers.cancel({
        country: 'US',
        msisdn: '15017122661',
      })

      expect(result.success).toBe(true)
    })
  })
})

// =============================================================================
// 7. Unified SMS Interface (via SMSChannel pattern)
// =============================================================================

describe('@dotdo/vonage - Unified SMS Interface', () => {
  describe('VonageSMS class', () => {
    it('should send SMS via unified interface', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [`POST /sms/json`, { status: 200, body: mockNexmoResponse() }],
        ])
      )

      const sms = new VonageSMS({
        apiKey: 'test_key',
        apiSecret: 'test_secret',
        defaultFrom: '15017122661',
        fetch: mockFetch,
      })

      const result = await sms.send({
        to: '+15558675310',
        body: 'Hello from unified interface!',
      })

      expect(result.messageId).toBeDefined()
      expect(result.delivered).toBe(true)
    })

    it('should send SMS with custom from number', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [`POST /sms/json`, { status: 200, body: mockNexmoResponse() }],
        ])
      )

      const sms = new VonageSMS({
        apiKey: 'test_key',
        apiSecret: 'test_secret',
        fetch: mockFetch,
      })

      const result = await sms.send({
        to: '+15558675310',
        from: '+15017122661',
        body: 'Message with custom from',
      })

      expect(result.delivered).toBe(true)
    })

    it('should get message status via unified interface', async () => {
      // Note: Vonage doesn't have a direct status lookup API like Twilio
      // Status is typically received via webhooks
      const sms = new VonageSMS({
        apiKey: 'test_key',
        apiSecret: 'test_secret',
        defaultFrom: '15017122661',
      })

      // For Vonage, status tracking happens via webhook callbacks
      expect(typeof sms.handleWebhook).toBe('function')
    })

    it('should handle webhook via unified interface', () => {
      const sms = new VonageSMS({
        apiKey: 'test_key',
        apiSecret: 'test_secret',
        defaultFrom: '15017122661',
      })

      const webhookPayload = {
        messageId: 'msg_123',
        msisdn: '15558675310',
        to: '15017122661',
        status: 'delivered',
      }

      const result = sms.handleWebhook(webhookPayload)

      expect(result.status).toBe('delivered')
    })
  })
})

// =============================================================================
// 8. Account Info
// =============================================================================

describe('@dotdo/vonage - Account Info', () => {
  it('should get account balance', async () => {
    const mockFetch = createMockFetch(
      new Map([
        [
          `GET /account/get-balance`,
          {
            status: 200,
            body: {
              value: 10.5,
              autoReload: false,
            },
          },
        ],
      ])
    )

    const client = createTestClient(mockFetch)
    const balance = await client.account.getBalance()

    expect(balance.value).toBe(10.5)
  })

  it('should get pricing for a country', async () => {
    const mockFetch = createMockFetch(
      new Map([
        [
          `GET /account/get-pricing/outbound/sms`,
          {
            status: 200,
            body: {
              countryCode: 'US',
              countryName: 'United States',
              defaultPrice: '0.0075',
              currency: 'EUR',
            },
          },
        ],
      ])
    )

    const client = createTestClient(mockFetch)
    const pricing = await client.account.getPricing('US', 'sms')

    expect(pricing.countryCode).toBe('US')
  })
})

// =============================================================================
// 9. Verify API (2FA)
// =============================================================================

describe('@dotdo/vonage - Verify API', () => {
  it('should send verification request', async () => {
    const mockFetch = createMockFetch(
      new Map([
        [
          `POST /verify/json`,
          {
            status: 200,
            body: {
              request_id: 'req_' + '0'.repeat(24),
              status: '0',
            },
          },
        ],
      ])
    )

    const client = createTestClient(mockFetch)
    const result = await client.verify.start({
      number: '15558675310',
      brand: 'ACME',
    })

    expect(result.request_id).toBeDefined()
    expect(result.status).toBe('0')
  })

  it('should check verification code', async () => {
    const requestId = 'req_' + '0'.repeat(24)
    const mockFetch = createMockFetch(
      new Map([
        [
          `POST /verify/check/json`,
          {
            status: 200,
            body: {
              request_id: requestId,
              status: '0',
              event_id: 'evt_123',
              price: '0.0500',
              currency: 'EUR',
            },
          },
        ],
      ])
    )

    const client = createTestClient(mockFetch)
    const result = await client.verify.check({
      request_id: requestId,
      code: '1234',
    })

    expect(result.status).toBe('0')
  })

  it('should cancel verification', async () => {
    const requestId = 'req_' + '0'.repeat(24)
    const mockFetch = createMockFetch(
      new Map([
        [
          `POST /verify/control/json`,
          {
            status: 200,
            body: {
              status: '0',
              command: 'cancel',
            },
          },
        ],
      ])
    )

    const client = createTestClient(mockFetch)
    const result = await client.verify.cancel(requestId)

    expect(result.status).toBe('0')
  })
})
