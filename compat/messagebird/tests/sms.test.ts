/**
 * @dotdo/messagebird - TDD Tests for MessageBird SMS Compatibility
 *
 * Tests for MessageBird SMS functionality:
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
  MessageBirdClient,
  MessageBirdSMS,
  MessageBirdVoice,
  MessageBirdError,
  createMessageBirdClient,
  type SMSSendRequest,
  type SMSSendResponse,
  type VoiceCallRequest,
  type VoiceCallResponse,
  type MessageBirdConfig,
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
          errors: [{ code: 404, description: `No mock for ${key}` }],
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
    id: 'msg_' + '0'.repeat(24),
    href: 'https://rest.messagebird.com/messages/msg_' + '0'.repeat(24),
    direction: 'mt',
    type: 'sms',
    originator: '+15017122661',
    body: 'Hello World!',
    reference: null,
    validity: null,
    gateway: 10,
    typeDetails: {},
    datacoding: 'plain',
    mclass: 1,
    scheduledDatetime: null,
    createdDatetime: new Date().toISOString(),
    recipients: {
      totalCount: 1,
      totalSentCount: 1,
      totalDeliveredCount: 0,
      totalDeliveryFailedCount: 0,
      items: [
        {
          recipient: 15558675310,
          status: 'sent',
          statusDatetime: new Date().toISOString(),
        },
      ],
    },
    ...overrides,
  }
}

function createTestClient(
  mockFetch?: ReturnType<typeof createMockFetch>,
  config?: Partial<MessageBirdConfig>
): MessageBirdClient {
  return new MessageBirdClient({
    accessKey: 'test_access_key_123',
    fetch: mockFetch ?? vi.fn(),
    ...config,
  })
}

// =============================================================================
// 1. Client Initialization
// =============================================================================

describe('@dotdo/messagebird - Client Initialization', () => {
  it('should create client with access key', () => {
    const client = createMessageBirdClient('test_access_key_123')
    expect(client).toBeInstanceOf(MessageBirdClient)
  })

  it('should throw error without access key', () => {
    expect(() => createMessageBirdClient('')).toThrow('accessKey is required')
  })

  it('should have messages resource', () => {
    const client = createTestClient()
    expect(client.messages).toBeDefined()
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
// 2. Send SMS Messages
// =============================================================================

describe('@dotdo/messagebird - Send SMS Messages', () => {
  describe('basic SMS sending', () => {
    it('should send a simple SMS message', async () => {
      const expectedResponse = mockSMSResponse()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /messages`, { status: 201, body: expectedResponse }],
        ])
      )

      const client = createTestClient(mockFetch)
      const response = await client.messages.create({
        originator: '+15017122661',
        recipients: ['+15558675310'],
        body: 'Hello World!',
      })

      expect(response.id).toMatch(/^msg_/)
      expect(response.recipients.totalSentCount).toBe(1)
    })

    it('should send SMS to multiple recipients', async () => {
      const expectedResponse = mockSMSResponse({
        recipients: {
          totalCount: 3,
          totalSentCount: 3,
          totalDeliveredCount: 0,
          totalDeliveryFailedCount: 0,
          items: [
            { recipient: 15551234567, status: 'sent', statusDatetime: new Date().toISOString() },
            { recipient: 15552345678, status: 'sent', statusDatetime: new Date().toISOString() },
            { recipient: 15553456789, status: 'sent', statusDatetime: new Date().toISOString() },
          ],
        },
      })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /messages`, { status: 201, body: expectedResponse }],
        ])
      )

      const client = createTestClient(mockFetch)
      const response = await client.messages.create({
        originator: '+15017122661',
        recipients: ['+15551234567', '+15552345678', '+15553456789'],
        body: 'Broadcast message',
      })

      expect(response.recipients.totalCount).toBe(3)
      expect(response.recipients.items).toHaveLength(3)
    })

    it('should send SMS with alphanumeric originator', async () => {
      const expectedResponse = mockSMSResponse({ originator: 'ACME' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /messages`, { status: 201, body: expectedResponse }],
        ])
      )

      const client = createTestClient(mockFetch)
      const response = await client.messages.create({
        originator: 'ACME',
        recipients: ['+15558675310'],
        body: 'Message from ACME',
      })

      expect(response.originator).toBe('ACME')
    })

    it('should send SMS with reference for tracking', async () => {
      const expectedResponse = mockSMSResponse({ reference: 'order_12345' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /messages`, { status: 201, body: expectedResponse }],
        ])
      )

      const client = createTestClient(mockFetch)
      const response = await client.messages.create({
        originator: '+15017122661',
        recipients: ['+15558675310'],
        body: 'Your order has shipped',
        reference: 'order_12345',
      })

      expect(response.reference).toBe('order_12345')
    })

    it('should send scheduled SMS', async () => {
      const scheduledTime = new Date(Date.now() + 3600000).toISOString()
      const expectedResponse = mockSMSResponse({ scheduledDatetime: scheduledTime })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /messages`, { status: 201, body: expectedResponse }],
        ])
      )

      const client = createTestClient(mockFetch)
      const response = await client.messages.create({
        originator: '+15017122661',
        recipients: ['+15558675310'],
        body: 'Scheduled message',
        scheduledDatetime: new Date(Date.now() + 3600000),
      })

      expect(response.scheduledDatetime).toBeDefined()
    })

    it('should send SMS with validity period', async () => {
      const expectedResponse = mockSMSResponse({ validity: 3600 })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /messages`, { status: 201, body: expectedResponse }],
        ])
      )

      const client = createTestClient(mockFetch)
      const response = await client.messages.create({
        originator: '+15017122661',
        recipients: ['+15558675310'],
        body: 'Time-sensitive message',
        validity: 3600,
      })

      expect(response.validity).toBe(3600)
    })

    it('should send flash SMS', async () => {
      const expectedResponse = mockSMSResponse({ mclass: 0 })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /messages`, { status: 201, body: expectedResponse }],
        ])
      )

      const client = createTestClient(mockFetch)
      const response = await client.messages.create({
        originator: '+15017122661',
        recipients: ['+15558675310'],
        body: 'Flash message!',
        type: 'flash',
      })

      expect(response.mclass).toBe(0)
    })
  })

  describe('validation', () => {
    it('should throw error when originator is missing', async () => {
      const client = createTestClient()

      await expect(
        client.messages.create({
          recipients: ['+15558675310'],
          body: 'Hello!',
        } as SMSSendRequest)
      ).rejects.toThrow(MessageBirdError)
    })

    it('should throw error when recipients is empty', async () => {
      const client = createTestClient()

      await expect(
        client.messages.create({
          originator: '+15017122661',
          recipients: [],
          body: 'Hello!',
        })
      ).rejects.toThrow(MessageBirdError)
    })

    it('should throw error when body is missing', async () => {
      const client = createTestClient()

      await expect(
        client.messages.create({
          originator: '+15017122661',
          recipients: ['+15558675310'],
        } as SMSSendRequest)
      ).rejects.toThrow(MessageBirdError)
    })
  })

  describe('error handling', () => {
    it('should throw MessageBirdError for API errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /messages`,
            {
              status: 422,
              body: {
                errors: [
                  {
                    code: 9,
                    description: 'no (correct) recipients found',
                    parameter: 'recipients',
                  },
                ],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)

      try {
        await client.messages.create({
          originator: '+15017122661',
          recipients: ['invalid'],
          body: 'Hello!',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(MessageBirdError)
        const mbError = error as MessageBirdError
        expect(mbError.code).toBe(9)
        expect(mbError.parameter).toBe('recipients')
      }
    })

    it('should handle authentication errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /messages`,
            {
              status: 401,
              body: {
                errors: [
                  {
                    code: 2,
                    description: 'Request not allowed (incorrect access_key)',
                  },
                ],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)

      await expect(
        client.messages.create({
          originator: '+15017122661',
          recipients: ['+15558675310'],
          body: 'Hello!',
        })
      ).rejects.toThrow(MessageBirdError)
    })

    it('should handle rate limiting', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /messages`,
            {
              status: 429,
              body: {
                errors: [
                  {
                    code: 13,
                    description: 'Request limit exceeded',
                  },
                ],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)

      await expect(
        client.messages.create({
          originator: '+15017122661',
          recipients: ['+15558675310'],
          body: 'Hello!',
        })
      ).rejects.toThrow(MessageBirdError)
    })
  })
})

// =============================================================================
// 3. Message Status Tracking
// =============================================================================

describe('@dotdo/messagebird - Message Status Tracking', () => {
  describe('fetching message status', () => {
    it('should get message by ID', async () => {
      const messageId = 'msg_' + '0'.repeat(24)
      const expectedResponse = mockSMSResponse({ id: messageId })
      const mockFetch = createMockFetch(
        new Map([
          [`GET /messages/${messageId}`, { status: 200, body: expectedResponse }],
        ])
      )

      const client = createTestClient(mockFetch)
      const message = await client.messages.read(messageId)

      expect(message.id).toBe(messageId)
    })

    it('should list messages', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /messages`,
            {
              status: 200,
              body: {
                offset: 0,
                limit: 20,
                count: 2,
                totalCount: 2,
                items: [mockSMSResponse(), mockSMSResponse()],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const messages = await client.messages.list()

      expect(messages.items).toHaveLength(2)
    })

    it('should list messages with filters', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /messages`,
            {
              status: 200,
              body: {
                offset: 0,
                limit: 10,
                count: 1,
                totalCount: 1,
                items: [mockSMSResponse()],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const messages = await client.messages.list({
        originator: '+15017122661',
        limit: 10,
      })

      expect(messages.items).toHaveLength(1)
    })

    it('should handle delivery status updates', async () => {
      const messageId = 'msg_' + '0'.repeat(24)
      const expectedResponse = mockSMSResponse({
        id: messageId,
        recipients: {
          totalCount: 1,
          totalSentCount: 0,
          totalDeliveredCount: 1,
          totalDeliveryFailedCount: 0,
          items: [
            { recipient: 15558675310, status: 'delivered', statusDatetime: new Date().toISOString() },
          ],
        },
      })
      const mockFetch = createMockFetch(
        new Map([
          [`GET /messages/${messageId}`, { status: 200, body: expectedResponse }],
        ])
      )

      const client = createTestClient(mockFetch)
      const message = await client.messages.read(messageId)

      expect(message.recipients.totalDeliveredCount).toBe(1)
    })
  })

  describe('message deletion', () => {
    it('should delete a scheduled message', async () => {
      const messageId = 'msg_' + '0'.repeat(24)
      const mockFetch = createMockFetch(
        new Map([
          [`DELETE /messages/${messageId}`, { status: 204, body: {} }],
        ])
      )

      const client = createTestClient(mockFetch)
      const result = await client.messages.delete(messageId)

      expect(result).toBe(true)
    })
  })
})

// =============================================================================
// 4. Webhooks
// =============================================================================

describe('@dotdo/messagebird - Webhooks', () => {
  describe('status webhook handling', () => {
    it('should handle delivery status webhook', () => {
      const client = createTestClient()

      const payload = {
        id: 'msg_' + '0'.repeat(24),
        reference: 'order_123',
        recipient: '+15558675310',
        status: 'delivered',
        statusDatetime: new Date().toISOString(),
      }

      const result = client.handleWebhook(payload)

      expect(result.messageId).toBe(payload.id)
      expect(result.status).toBe('delivered')
    })

    it('should handle failed status webhook', () => {
      const client = createTestClient()

      const payload = {
        id: 'msg_' + '0'.repeat(24),
        recipient: '+15558675310',
        status: 'delivery_failed',
        statusDatetime: new Date().toISOString(),
        statusErrorCode: 1,
      }

      const result = client.handleWebhook(payload)

      expect(result.status).toBe('delivery_failed')
      expect(result.errorCode).toBe(1)
    })
  })

  describe('inbound message webhook', () => {
    it('should handle inbound SMS', () => {
      const client = createTestClient()

      const payload = {
        id: 'msg_inbound_' + '0'.repeat(20),
        originator: '+15558675310',
        recipient: '+15017122661',
        body: 'Reply from customer',
        createdDatetime: new Date().toISOString(),
      }

      const result = client.handleInboundWebhook(payload)

      expect(result.from).toBe('+15558675310')
      expect(result.to).toBe('+15017122661')
      expect(result.body).toBe('Reply from customer')
    })
  })

  describe('webhook signature verification', () => {
    it('should verify valid webhook signature', async () => {
      const client = createTestClient(undefined, { signingKey: 'test_signing_key' })

      const timestamp = Math.floor(Date.now() / 1000).toString()
      const body = JSON.stringify({ id: 'msg_123' })

      // Generate valid signature
      const encoder = new TextEncoder()
      const data = encoder.encode(timestamp + body)
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode('test_signing_key'),
        { name: 'HMAC', hash: 'SHA-256' },
      false,
        ['sign']
      )
      const signature = await crypto.subtle.sign('HMAC', key, data)
      const signatureHex = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const isValid = await client.verifyWebhookSignature(signatureHex, timestamp, body)

      expect(isValid).toBe(true)
    })

    it('should reject invalid webhook signature', async () => {
      const client = createTestClient(undefined, { signingKey: 'test_signing_key' })

      const isValid = await client.verifyWebhookSignature('invalid', '12345', '{}')

      expect(isValid).toBe(false)
    })
  })
})

// =============================================================================
// 5. Voice Calls
// =============================================================================

describe('@dotdo/messagebird - Voice Calls', () => {
  describe('creating calls', () => {
    it('should initiate an outbound call', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /calls`,
            {
              status: 201,
              body: {
                data: [{
                  id: 'call_' + '0'.repeat(24),
                  status: 'queued',
                  source: '+15017122661',
                  destination: '+15558675310',
                  createdAt: new Date().toISOString(),
                }],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const call = await client.voice.calls.create({
        source: '+15017122661',
        destination: '+15558675310',
        callFlow: {
          steps: [
            {
              action: 'say',
              options: { payload: 'Hello from MessageBird!', voice: 'male', language: 'en-US' },
            },
          ],
        },
      })

      expect(call.id).toMatch(/^call_/)
      expect(call.status).toBe('queued')
    })

    it('should create call with recording', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /calls`,
            {
              status: 201,
              body: {
                data: [{
                  id: 'call_' + '0'.repeat(24),
                  status: 'queued',
                  source: '+15017122661',
                  destination: '+15558675310',
                }],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const call = await client.voice.calls.create({
        source: '+15017122661',
        destination: '+15558675310',
        callFlow: {
          record: true,
          steps: [{ action: 'say', options: { payload: 'This call is being recorded.' } }],
        },
      })

      expect(call.id).toBeDefined()
    })

    it('should create call with gather input', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /calls`,
            {
              status: 201,
              body: {
                data: [{
                  id: 'call_' + '0'.repeat(24),
                  status: 'queued',
                }],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const call = await client.voice.calls.create({
        source: '+15017122661',
        destination: '+15558675310',
        callFlow: {
          steps: [
            {
              action: 'say',
              options: { payload: 'Press 1 for sales, 2 for support.' },
            },
            {
              action: 'gather',
              options: {
                numDigits: 1,
                timeout: 10,
                finishOnKey: '#',
                onFinish: 'https://example.com/handle-input',
              },
            },
          ],
        },
      })

      expect(call.id).toBeDefined()
    })
  })

  describe('managing calls', () => {
    it('should get call by ID', async () => {
      const callId = 'call_' + '0'.repeat(24)
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /calls/${callId}`,
            {
              status: 200,
              body: {
                data: [{
                  id: callId,
                  status: 'in-progress',
                  source: '+15017122661',
                  destination: '+15558675310',
                }],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const call = await client.voice.calls.read(callId)

      expect(call.id).toBe(callId)
      expect(call.status).toBe('in-progress')
    })

    it('should list calls', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /calls`,
            {
              status: 200,
              body: {
                data: [
                  { id: 'call_1', status: 'ended' },
                  { id: 'call_2', status: 'ended' },
                ],
                pagination: { totalCount: 2 },
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const calls = await client.voice.calls.list()

      expect(calls.data).toHaveLength(2)
    })

    it('should update call with new flow', async () => {
      const callId = 'call_' + '0'.repeat(24)
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /calls/${callId}`,
            {
              status: 200,
              body: {
                data: [{
                  id: callId,
                  status: 'in-progress',
                }],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const call = await client.voice.calls.update(callId, {
        callFlow: {
          steps: [{ action: 'hangup' }],
        },
      })

      expect(call.id).toBe(callId)
    })

    it('should end a call', async () => {
      const callId = 'call_' + '0'.repeat(24)
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /calls/${callId}`,
            { status: 204, body: {} },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const result = await client.voice.calls.delete(callId)

      expect(result).toBe(true)
    })
  })

  describe('recordings', () => {
    it('should list recordings for a call', async () => {
      const callId = 'call_' + '0'.repeat(24)
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /calls/${callId}/recordings`,
            {
              status: 200,
              body: {
                data: [
                  {
                    id: 'rec_123',
                    callId,
                    duration: 30,
                    format: 'wav',
                    links: { file: 'https://recordings.messagebird.com/rec_123.wav' },
                  },
                ],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const recordings = await client.voice.recordings.list(callId)

      expect(recordings.data).toHaveLength(1)
      expect(recordings.data[0].duration).toBe(30)
    })

    it('should download recording', async () => {
      const callId = 'call_' + '0'.repeat(24)
      const recordingId = 'rec_123'
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /calls/${callId}/recordings/${recordingId}`,
            {
              status: 200,
              body: {
                data: [{
                  id: recordingId,
                  links: { file: 'https://recordings.messagebird.com/rec_123.wav' },
                }],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const recording = await client.voice.recordings.read(callId, recordingId)

      expect(recording.links.file).toContain('rec_123.wav')
    })

    it('should delete recording', async () => {
      const callId = 'call_' + '0'.repeat(24)
      const recordingId = 'rec_123'
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /calls/${callId}/recordings/${recordingId}`,
            { status: 204, body: {} },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const result = await client.voice.recordings.delete(callId, recordingId)

      expect(result).toBe(true)
    })
  })

  describe('transcriptions', () => {
    it('should create transcription for recording', async () => {
      const callId = 'call_' + '0'.repeat(24)
      const recordingId = 'rec_123'
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /calls/${callId}/recordings/${recordingId}/transcriptions`,
            {
              status: 201,
              body: {
                data: [{
                  id: 'trans_123',
                  recordingId,
                  status: 'pending',
                  language: 'en-US',
                }],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const transcription = await client.voice.transcriptions.create(callId, recordingId, {
        language: 'en-US',
      })

      expect(transcription.status).toBe('pending')
    })

    it('should get transcription result', async () => {
      const callId = 'call_' + '0'.repeat(24)
      const recordingId = 'rec_123'
      const transcriptionId = 'trans_123'
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /calls/${callId}/recordings/${recordingId}/transcriptions/${transcriptionId}`,
            {
              status: 200,
              body: {
                data: [{
                  id: transcriptionId,
                  status: 'done',
                  text: 'Hello, this is a transcription test.',
                }],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const transcription = await client.voice.transcriptions.read(callId, recordingId, transcriptionId)

      expect(transcription.status).toBe('done')
      expect(transcription.text).toContain('transcription test')
    })
  })
})

// =============================================================================
// 6. Phone Number Management
// =============================================================================

describe('@dotdo/messagebird - Phone Number Management', () => {
  describe('listing numbers', () => {
    it('should list available numbers', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /phone-numbers`,
            {
              status: 200,
              body: {
                data: [
                  {
                    id: 'num_123',
                    number: '+15017122661',
                    country: 'US',
                    type: 'local',
                    features: ['sms', 'voice'],
                    status: 'active',
                  },
                ],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const numbers = await client.numbers.list()

      expect(numbers.data).toHaveLength(1)
      expect(numbers.data[0].features).toContain('sms')
    })

    it('should filter numbers by country', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /phone-numbers`,
            {
              status: 200,
              body: {
                data: [
                  { id: 'num_123', number: '+15017122661', country: 'US' },
                ],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const numbers = await client.numbers.list({ country: 'US' })

      expect(numbers.data).toHaveLength(1)
    })
  })

  describe('searching available numbers', () => {
    it('should search for available numbers', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /available-phone-numbers/US`,
            {
              status: 200,
              body: {
                data: [
                  { number: '+15551234567', type: 'local', features: ['sms', 'voice'] },
                  { number: '+15552345678', type: 'local', features: ['sms'] },
                ],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const available = await client.numbers.searchAvailable('US')

      expect(available.data).toHaveLength(2)
    })

    it('should search with specific features', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /available-phone-numbers/US`,
            {
              status: 200,
              body: {
                data: [
                  { number: '+15551234567', type: 'local', features: ['sms', 'voice', 'mms'] },
                ],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const available = await client.numbers.searchAvailable('US', { features: ['mms'] })

      expect(available.data).toHaveLength(1)
      expect(available.data[0].features).toContain('mms')
    })
  })

  describe('purchasing numbers', () => {
    it('should purchase a number', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /phone-numbers`,
            {
              status: 201,
              body: {
                data: [{
                  id: 'num_new_123',
                  number: '+15551234567',
                  country: 'US',
                  type: 'local',
                  status: 'active',
                }],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const number = await client.numbers.purchase({
        number: '+15551234567',
        country: 'US',
      })

      expect(number.status).toBe('active')
    })
  })

  describe('managing numbers', () => {
    it('should get number details', async () => {
      const numberId = 'num_123'
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /phone-numbers/${numberId}`,
            {
              status: 200,
              body: {
                data: [{
                  id: numberId,
                  number: '+15017122661',
                  country: 'US',
                  features: ['sms', 'voice'],
                }],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const number = await client.numbers.read(numberId)

      expect(number.id).toBe(numberId)
    })

    it('should update number settings', async () => {
      const numberId = 'num_123'
      const mockFetch = createMockFetch(
        new Map([
          [
            `PATCH /phone-numbers/${numberId}`,
            {
              status: 200,
              body: {
                data: [{
                  id: numberId,
                  smsWebhook: 'https://example.com/sms-webhook',
                  voiceWebhook: 'https://example.com/voice-webhook',
                }],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const number = await client.numbers.update(numberId, {
        smsWebhook: 'https://example.com/sms-webhook',
        voiceWebhook: 'https://example.com/voice-webhook',
      })

      expect(number.smsWebhook).toBe('https://example.com/sms-webhook')
    })

    it('should cancel a number', async () => {
      const numberId = 'num_123'
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /phone-numbers/${numberId}`,
            { status: 204, body: {} },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const result = await client.numbers.cancel(numberId)

      expect(result).toBe(true)
    })
  })
})

// =============================================================================
// 7. Unified SMS Interface (via SMSChannel pattern)
// =============================================================================

describe('@dotdo/messagebird - Unified SMS Interface', () => {
  describe('MessageBirdSMS class', () => {
    it('should send SMS via unified interface', async () => {
      const expectedResponse = mockSMSResponse()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /messages`, { status: 201, body: expectedResponse }],
        ])
      )

      const sms = new MessageBirdSMS({
        accessKey: 'test_key',
        defaultOriginator: '+15017122661',
        fetch: mockFetch,
      })

      const result = await sms.send({
        to: '+15558675310',
        body: 'Hello from unified interface!',
      })

      expect(result.messageId).toBeDefined()
      expect(result.delivered).toBe(true)
    })

    it('should send SMS with status callback', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [`POST /messages`, { status: 201, body: mockSMSResponse() }],
        ])
      )

      const sms = new MessageBirdSMS({
        accessKey: 'test_key',
        defaultOriginator: '+15017122661',
        statusCallbackUrl: 'https://example.com/status',
        fetch: mockFetch,
      })

      const result = await sms.send({
        to: '+15558675310',
        body: 'Message with callback',
      })

      expect(result.delivered).toBe(true)
    })

    it('should get message status via unified interface', async () => {
      const messageId = 'msg_' + '0'.repeat(24)
      const mockFetch = createMockFetch(
        new Map([
          [`GET /messages/${messageId}`, { status: 200, body: mockSMSResponse({ id: messageId }) }],
        ])
      )

      const sms = new MessageBirdSMS({
        accessKey: 'test_key',
        defaultOriginator: '+15017122661',
        fetch: mockFetch,
      })

      const status = await sms.getStatus(messageId)

      expect(status.messageId).toBe(messageId)
    })

    it('should handle webhook via unified interface', () => {
      const sms = new MessageBirdSMS({
        accessKey: 'test_key',
        defaultOriginator: '+15017122661',
      })

      const webhookPayload = {
        id: 'msg_123',
        recipient: '+15558675310',
        status: 'delivered',
        statusDatetime: new Date().toISOString(),
      }

      const result = sms.handleWebhook(webhookPayload)

      expect(result.status).toBe('delivered')
    })
  })
})

// =============================================================================
// 8. MMS Support
// =============================================================================

describe('@dotdo/messagebird - MMS Support', () => {
  it('should send MMS with media', async () => {
    const expectedResponse = mockSMSResponse({ type: 'mms' })
    const mockFetch = createMockFetch(
      new Map([
        [`POST /mms`, { status: 201, body: expectedResponse }],
      ])
    )

    const client = createTestClient(mockFetch)
    const response = await client.mms.create({
      originator: '+15017122661',
      recipients: ['+15558675310'],
      body: 'Check out this image!',
      mediaUrls: ['https://example.com/image.jpg'],
    })

    expect(response.type).toBe('mms')
  })

  it('should send MMS with multiple media items', async () => {
    const expectedResponse = mockSMSResponse({ type: 'mms' })
    const mockFetch = createMockFetch(
      new Map([
        [`POST /mms`, { status: 201, body: expectedResponse }],
      ])
    )

    const client = createTestClient(mockFetch)
    const response = await client.mms.create({
      originator: '+15017122661',
      recipients: ['+15558675310'],
      body: 'Multiple images',
      mediaUrls: [
        'https://example.com/image1.jpg',
        'https://example.com/image2.png',
      ],
    })

    expect(response.type).toBe('mms')
  })

  it('should send MMS via unified SMS interface', async () => {
    const mockFetch = createMockFetch(
      new Map([
        [`POST /mms`, { status: 201, body: mockSMSResponse({ type: 'mms' }) }],
      ])
    )

    const sms = new MessageBirdSMS({
      accessKey: 'test_key',
      defaultOriginator: '+15017122661',
      fetch: mockFetch,
    })

    const result = await sms.send({
      to: '+15558675310',
      body: 'MMS via unified interface',
      mediaUrl: ['https://example.com/image.jpg'],
    })

    expect(result.delivered).toBe(true)
  })
})

// =============================================================================
// 9. Balance and Account Info
// =============================================================================

describe('@dotdo/messagebird - Account Info', () => {
  it('should get account balance', async () => {
    const mockFetch = createMockFetch(
      new Map([
        [
          `GET /balance`,
          {
            status: 200,
            body: {
              payment: 'prepaid',
              type: 'credits',
              amount: 100.5,
            },
          },
        ],
      ])
    )

    const client = createTestClient(mockFetch)
    const balance = await client.balance.read()

    expect(balance.amount).toBe(100.5)
  })
})
