/**
 * @dotdo/twilio/conversations - TDD Tests for Twilio Conversations API Compatibility
 *
 * Tests for multi-party messaging functionality:
 * 1. Conversation CRUD operations
 * 2. Participant management (SMS, WhatsApp, Chat)
 * 3. Message handling
 * 4. Cross-channel support
 * 5. User management
 * 6. Webhook handling
 * 7. Service management
 *
 * Issue: dotdo-qspkm
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  TwilioConversations,
  TwilioConversationsError,
  createConversationsClient,
  type TwilioConversationsConfig,
  type ConversationCreateParams,
  type ConversationUpdateParams,
  type ParticipantCreateParams,
  type ConversationMessageCreateParams,
  type ConversationUserCreateParams,
} from '../conversations'
import type {
  Conversation,
  ConversationParticipant,
  ConversationMessage,
  ConversationUser,
  ConversationService,
  ConversationWebhookPayload,
} from '../types'

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

function mockConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    sid: 'CH' + '0'.repeat(32),
    account_sid: 'AC' + '0'.repeat(32),
    chat_service_sid: 'IS' + '0'.repeat(32),
    messaging_service_sid: null,
    friendly_name: 'Test Conversation',
    unique_name: null,
    attributes: '{}',
    state: 'active',
    date_created: new Date().toISOString(),
    date_updated: new Date().toISOString(),
    timers: {},
    bindings: {},
    links: {
      participants: '/v1/Conversations/CH.../Participants',
      messages: '/v1/Conversations/CH.../Messages',
      webhooks: '/v1/Conversations/CH.../Webhooks',
    },
    url: '/v1/Conversations/CH...',
    ...overrides,
  }
}

function mockParticipant(overrides: Partial<ConversationParticipant> = {}): ConversationParticipant {
  return {
    sid: 'MB' + '0'.repeat(32),
    account_sid: 'AC' + '0'.repeat(32),
    conversation_sid: 'CH' + '0'.repeat(32),
    identity: null,
    attributes: '{}',
    messaging_binding: null,
    role_sid: null,
    date_created: new Date().toISOString(),
    date_updated: new Date().toISOString(),
    last_read_message_index: null,
    last_read_timestamp: null,
    url: '/v1/Conversations/CH.../Participants/MB...',
    ...overrides,
  }
}

function mockMessage(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    sid: 'IM' + '0'.repeat(32),
    account_sid: 'AC' + '0'.repeat(32),
    conversation_sid: 'CH' + '0'.repeat(32),
    index: 0,
    author: 'system',
    body: 'Hello World!',
    media: null,
    attributes: '{}',
    participant_sid: null,
    date_created: new Date().toISOString(),
    date_updated: new Date().toISOString(),
    delivery: null,
    content_sid: null,
    url: '/v1/Conversations/CH.../Messages/IM...',
    links: {
      delivery_receipts: '/v1/Conversations/CH.../Messages/IM.../Receipts',
    },
    ...overrides,
  }
}

function mockUser(overrides: Partial<ConversationUser> = {}): ConversationUser {
  return {
    sid: 'US' + '0'.repeat(32),
    account_sid: 'AC' + '0'.repeat(32),
    chat_service_sid: 'IS' + '0'.repeat(32),
    identity: 'test-user',
    friendly_name: 'Test User',
    role_sid: null,
    attributes: '{}',
    is_online: null,
    is_notifiable: null,
    date_created: new Date().toISOString(),
    date_updated: new Date().toISOString(),
    url: '/v1/Users/US...',
    links: {
      user_conversations: '/v1/Users/US.../Conversations',
    },
    ...overrides,
  }
}

function mockService(overrides: Partial<ConversationService> = {}): ConversationService {
  return {
    sid: 'IS' + '0'.repeat(32),
    account_sid: 'AC' + '0'.repeat(32),
    friendly_name: 'Test Service',
    date_created: new Date().toISOString(),
    date_updated: new Date().toISOString(),
    url: '/v1/Services/IS...',
    links: {
      conversations: '/v1/Services/IS.../Conversations',
      users: '/v1/Services/IS.../Users',
      roles: '/v1/Services/IS.../Roles',
      bindings: '/v1/Services/IS.../Bindings',
      configuration: '/v1/Services/IS.../Configuration',
      webhooks: '/v1/Services/IS.../Configuration/Webhooks',
    },
    ...overrides,
  }
}

function createTestClient(
  mockFetch?: ReturnType<typeof createMockFetch>,
  config?: Partial<TwilioConversationsConfig>
): TwilioConversations {
  return new TwilioConversations({
    accountSid: 'ACtest123',
    authToken: 'authtoken123',
    fetch: mockFetch ?? vi.fn(),
    ...config,
  })
}

// =============================================================================
// 1. Conversation CRUD Operations
// =============================================================================

describe('@dotdo/twilio/conversations - Conversation CRUD', () => {
  describe('create conversation', () => {
    it('should create a conversation with minimal params', async () => {
      const expectedConversation = mockConversation()
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v1/Conversations`, { status: 201, body: expectedConversation }],
        ])
      )

      const client = createTestClient(mockFetch)
      const conversation = await client.create()

      expect(conversation.sid).toMatch(/^CH/)
      expect(conversation.state).toBe('active')
    })

    it('should create a conversation with friendly name', async () => {
      const expectedConversation = mockConversation({ friendly_name: 'Support Chat' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v1/Conversations`, { status: 201, body: expectedConversation }],
        ])
      )

      const client = createTestClient(mockFetch)
      const conversation = await client.create({
        friendlyName: 'Support Chat',
      })

      expect(conversation.friendly_name).toBe('Support Chat')
    })

    it('should create a conversation with unique name', async () => {
      const expectedConversation = mockConversation({ unique_name: 'support-12345' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v1/Conversations`, { status: 201, body: expectedConversation }],
        ])
      )

      const client = createTestClient(mockFetch)
      const conversation = await client.create({
        uniqueName: 'support-12345',
      })

      expect(conversation.unique_name).toBe('support-12345')
    })

    it('should create a conversation with attributes', async () => {
      const attributes = JSON.stringify({ ticketId: '12345', priority: 'high' })
      const expectedConversation = mockConversation({ attributes })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v1/Conversations`, { status: 201, body: expectedConversation }],
        ])
      )

      const client = createTestClient(mockFetch)
      const conversation = await client.create({
        attributes,
      })

      expect(JSON.parse(conversation.attributes)).toEqual({
        ticketId: '12345',
        priority: 'high',
      })
    })

    it('should create a conversation with messaging service SID', async () => {
      const expectedConversation = mockConversation({
        messaging_service_sid: 'MG' + '0'.repeat(32),
      })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v1/Conversations`, { status: 201, body: expectedConversation }],
        ])
      )

      const client = createTestClient(mockFetch)
      const conversation = await client.create({
        messagingServiceSid: 'MG' + '0'.repeat(32),
      })

      expect(conversation.messaging_service_sid).toMatch(/^MG/)
    })

    it('should create a conversation with timers', async () => {
      const expectedConversation = mockConversation({
        timers: {
          date_inactive: 'PT24H',
          date_closed: 'PT72H',
        },
      })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v1/Conversations`, { status: 201, body: expectedConversation }],
        ])
      )

      const client = createTestClient(mockFetch)
      const conversation = await client.create({
        'timers.inactive': 'PT24H',
        'timers.closed': 'PT72H',
      })

      expect(conversation.timers.date_inactive).toBe('PT24H')
      expect(conversation.timers.date_closed).toBe('PT72H')
    })
  })

  describe('get conversation', () => {
    it('should get a conversation by SID', async () => {
      const sid = 'CH' + '0'.repeat(32)
      const expectedConversation = mockConversation({ sid })
      const mockFetch = createMockFetch(
        new Map([
          [`GET /v1/Conversations/${sid}`, { status: 200, body: expectedConversation }],
        ])
      )

      const client = createTestClient(mockFetch)
      const conversation = await client.get(sid)

      expect(conversation.sid).toBe(sid)
    })

    it('should get a conversation by unique name', async () => {
      const uniqueName = 'support-12345'
      const expectedConversation = mockConversation({ unique_name: uniqueName })
      const mockFetch = createMockFetch(
        new Map([
          [`GET /v1/Conversations/${uniqueName}`, { status: 200, body: expectedConversation }],
        ])
      )

      const client = createTestClient(mockFetch)
      const conversation = await client.get(uniqueName)

      expect(conversation.unique_name).toBe(uniqueName)
    })

    it('should throw error for non-existent conversation', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /v1/Conversations/CH${'x'.repeat(32)}`,
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

      const client = createTestClient(mockFetch)

      await expect(client.get('CH' + 'x'.repeat(32))).rejects.toThrow(TwilioConversationsError)
    })
  })

  describe('update conversation', () => {
    it('should update conversation friendly name', async () => {
      const sid = 'CH' + '0'.repeat(32)
      const expectedConversation = mockConversation({ sid, friendly_name: 'Updated Name' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v1/Conversations/${sid}`, { status: 200, body: expectedConversation }],
        ])
      )

      const client = createTestClient(mockFetch)
      const conversation = await client.update(sid, {
        friendlyName: 'Updated Name',
      })

      expect(conversation.friendly_name).toBe('Updated Name')
    })

    it('should update conversation state', async () => {
      const sid = 'CH' + '0'.repeat(32)
      const expectedConversation = mockConversation({ sid, state: 'inactive' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v1/Conversations/${sid}`, { status: 200, body: expectedConversation }],
        ])
      )

      const client = createTestClient(mockFetch)
      const conversation = await client.update(sid, {
        state: 'inactive',
      })

      expect(conversation.state).toBe('inactive')
    })

    it('should update conversation attributes', async () => {
      const sid = 'CH' + '0'.repeat(32)
      const newAttributes = JSON.stringify({ status: 'resolved' })
      const expectedConversation = mockConversation({ sid, attributes: newAttributes })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v1/Conversations/${sid}`, { status: 200, body: expectedConversation }],
        ])
      )

      const client = createTestClient(mockFetch)
      const conversation = await client.update(sid, {
        attributes: newAttributes,
      })

      expect(JSON.parse(conversation.attributes)).toEqual({ status: 'resolved' })
    })
  })

  describe('delete conversation', () => {
    it('should delete a conversation', async () => {
      const sid = 'CH' + '0'.repeat(32)
      const mockFetch = createMockFetch(
        new Map([
          [`DELETE /v1/Conversations/${sid}`, { status: 204, body: {} }],
        ])
      )

      const client = createTestClient(mockFetch)
      const result = await client.delete(sid)

      expect(result).toBe(true)
    })
  })

  describe('list conversations', () => {
    it('should list conversations', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /v1/Conversations`,
            {
              status: 200,
              body: {
                conversations: [
                  mockConversation({ sid: 'CH' + '0'.repeat(32) }),
                  mockConversation({ sid: 'CH' + '1'.repeat(32) }),
                ],
                meta: {
                  page: 0,
                  page_size: 50,
                  first_page_url: '/v1/Conversations?PageSize=50&Page=0',
                  previous_page_url: null,
                  next_page_url: null,
                  key: 'conversations',
                },
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const conversations = await client.list()

      expect(conversations).toHaveLength(2)
    })

    it('should list conversations with pagination', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /v1/Conversations`,
            {
              status: 200,
              body: {
                conversations: [mockConversation()],
                meta: {
                  page: 0,
                  page_size: 10,
                  first_page_url: '/v1/Conversations',
                  previous_page_url: null,
                  next_page_url: '/v1/Conversations?Page=1',
                  key: 'conversations',
                },
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const conversations = await client.list({ pageSize: 10 })

      expect(conversations).toHaveLength(1)
    })
  })

  describe('close and reopen conversation', () => {
    it('should close a conversation', async () => {
      const sid = 'CH' + '0'.repeat(32)
      const expectedConversation = mockConversation({ sid, state: 'closed' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v1/Conversations/${sid}`, { status: 200, body: expectedConversation }],
        ])
      )

      const client = createTestClient(mockFetch)
      const conversation = await client.close(sid)

      expect(conversation.state).toBe('closed')
    })

    it('should reopen a conversation', async () => {
      const sid = 'CH' + '0'.repeat(32)
      const expectedConversation = mockConversation({ sid, state: 'active' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v1/Conversations/${sid}`, { status: 200, body: expectedConversation }],
        ])
      )

      const client = createTestClient(mockFetch)
      const conversation = await client.reopen(sid)

      expect(conversation.state).toBe('active')
    })
  })
})

// =============================================================================
// 2. Participant Management
// =============================================================================

describe('@dotdo/twilio/conversations - Participant Management', () => {
  describe('SMS participants', () => {
    it('should add an SMS participant', async () => {
      const conversationSid = 'CH' + '0'.repeat(32)
      const expectedParticipant = mockParticipant({
        messaging_binding: {
          type: 'sms',
          address: '+15558675310',
          proxy_address: '+15017122661',
        },
      })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v1/Conversations/${conversationSid}/Participants`,
            { status: 201, body: expectedParticipant },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const participant = await client.addSmsParticipant(
        conversationSid,
        '+15558675310',
        '+15017122661'
      )

      expect(participant.messaging_binding?.type).toBe('sms')
      expect(participant.messaging_binding?.address).toBe('+15558675310')
    })

    it('should add an SMS participant with attributes', async () => {
      const conversationSid = 'CH' + '0'.repeat(32)
      const attributes = JSON.stringify({ customerId: '12345' })
      const expectedParticipant = mockParticipant({
        attributes,
        messaging_binding: {
          type: 'sms',
          address: '+15558675310',
          proxy_address: '+15017122661',
        },
      })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v1/Conversations/${conversationSid}/Participants`,
            { status: 201, body: expectedParticipant },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const participant = await client.addSmsParticipant(
        conversationSid,
        '+15558675310',
        '+15017122661',
        { attributes }
      )

      expect(JSON.parse(participant.attributes)).toEqual({ customerId: '12345' })
    })
  })

  describe('WhatsApp participants', () => {
    it('should add a WhatsApp participant', async () => {
      const conversationSid = 'CH' + '0'.repeat(32)
      const expectedParticipant = mockParticipant({
        messaging_binding: {
          type: 'whatsapp',
          address: 'whatsapp:+15558675310',
          proxy_address: 'whatsapp:+14155238886',
        },
      })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v1/Conversations/${conversationSid}/Participants`,
            { status: 201, body: expectedParticipant },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const participant = await client.addWhatsAppParticipant(
        conversationSid,
        '+15558675310',
        '+14155238886'
      )

      expect(participant.messaging_binding?.type).toBe('whatsapp')
      expect(participant.messaging_binding?.address).toBe('whatsapp:+15558675310')
    })

    it('should handle WhatsApp numbers with existing prefix', async () => {
      const conversationSid = 'CH' + '0'.repeat(32)
      const expectedParticipant = mockParticipant({
        messaging_binding: {
          type: 'whatsapp',
          address: 'whatsapp:+15558675310',
          proxy_address: 'whatsapp:+14155238886',
        },
      })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v1/Conversations/${conversationSid}/Participants`,
            { status: 201, body: expectedParticipant },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const participant = await client.addWhatsAppParticipant(
        conversationSid,
        'whatsapp:+15558675310',
        'whatsapp:+14155238886'
      )

      expect(participant.messaging_binding?.address).toBe('whatsapp:+15558675310')
    })
  })

  describe('Chat participants', () => {
    it('should add a chat participant by identity', async () => {
      const conversationSid = 'CH' + '0'.repeat(32)
      const expectedParticipant = mockParticipant({
        identity: 'agent-123',
        messaging_binding: null,
      })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v1/Conversations/${conversationSid}/Participants`,
            { status: 201, body: expectedParticipant },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const participant = await client.addChatParticipant(conversationSid, 'agent-123')

      expect(participant.identity).toBe('agent-123')
      expect(participant.messaging_binding).toBeNull()
    })
  })

  describe('participant operations', () => {
    it('should get a participant by SID', async () => {
      const conversationSid = 'CH' + '0'.repeat(32)
      const participantSid = 'MB' + '0'.repeat(32)
      const expectedParticipant = mockParticipant({ sid: participantSid })
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /v1/Conversations/${conversationSid}/Participants/${participantSid}`,
            { status: 200, body: expectedParticipant },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const participant = await client.participants.get(conversationSid, participantSid)

      expect(participant.sid).toBe(participantSid)
    })

    it('should update a participant', async () => {
      const conversationSid = 'CH' + '0'.repeat(32)
      const participantSid = 'MB' + '0'.repeat(32)
      const newAttributes = JSON.stringify({ role: 'admin' })
      const expectedParticipant = mockParticipant({
        sid: participantSid,
        attributes: newAttributes,
      })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v1/Conversations/${conversationSid}/Participants/${participantSid}`,
            { status: 200, body: expectedParticipant },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const participant = await client.participants.update(conversationSid, participantSid, {
        attributes: newAttributes,
      })

      expect(JSON.parse(participant.attributes)).toEqual({ role: 'admin' })
    })

    it('should update last read message index', async () => {
      const conversationSid = 'CH' + '0'.repeat(32)
      const participantSid = 'MB' + '0'.repeat(32)
      const expectedParticipant = mockParticipant({
        sid: participantSid,
        last_read_message_index: 10,
      })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v1/Conversations/${conversationSid}/Participants/${participantSid}`,
            { status: 200, body: expectedParticipant },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const participant = await client.participants.update(conversationSid, participantSid, {
        lastReadMessageIndex: 10,
      })

      expect(participant.last_read_message_index).toBe(10)
    })

    it('should delete a participant', async () => {
      const conversationSid = 'CH' + '0'.repeat(32)
      const participantSid = 'MB' + '0'.repeat(32)
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /v1/Conversations/${conversationSid}/Participants/${participantSid}`,
            { status: 204, body: {} },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const result = await client.participants.delete(conversationSid, participantSid)

      expect(result).toBe(true)
    })

    it('should list participants', async () => {
      const conversationSid = 'CH' + '0'.repeat(32)
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /v1/Conversations/${conversationSid}/Participants`,
            {
              status: 200,
              body: {
                participants: [
                  mockParticipant({ identity: 'user1' }),
                  mockParticipant({ identity: 'user2' }),
                ],
                meta: {
                  page: 0,
                  page_size: 50,
                  first_page_url: '/v1/Conversations/CH.../Participants',
                  previous_page_url: null,
                  next_page_url: null,
                  key: 'participants',
                },
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const participants = await client.participants.list(conversationSid)

      expect(participants).toHaveLength(2)
    })
  })
})

// =============================================================================
// 3. Message Handling
// =============================================================================

describe('@dotdo/twilio/conversations - Message Handling', () => {
  describe('create message', () => {
    it('should send a text message', async () => {
      const conversationSid = 'CH' + '0'.repeat(32)
      const expectedMessage = mockMessage({ body: 'Hello!' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v1/Conversations/${conversationSid}/Messages`,
            { status: 201, body: expectedMessage },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const message = await client.sendMessage(conversationSid, 'Hello!')

      expect(message.body).toBe('Hello!')
    })

    it('should send a message with author', async () => {
      const conversationSid = 'CH' + '0'.repeat(32)
      const expectedMessage = mockMessage({ author: 'agent-123', body: 'How can I help?' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v1/Conversations/${conversationSid}/Messages`,
            { status: 201, body: expectedMessage },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const message = await client.sendMessage(conversationSid, 'How can I help?', {
        author: 'agent-123',
      })

      expect(message.author).toBe('agent-123')
    })

    it('should send a message with attributes', async () => {
      const conversationSid = 'CH' + '0'.repeat(32)
      const attributes = JSON.stringify({ sentiment: 'positive' })
      const expectedMessage = mockMessage({ attributes })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v1/Conversations/${conversationSid}/Messages`,
            { status: 201, body: expectedMessage },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const message = await client.sendMessage(conversationSid, 'Great news!', { attributes })

      expect(JSON.parse(message.attributes)).toEqual({ sentiment: 'positive' })
    })

    it('should create message via messages manager', async () => {
      const conversationSid = 'CH' + '0'.repeat(32)
      const expectedMessage = mockMessage({ body: 'Test message' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v1/Conversations/${conversationSid}/Messages`,
            { status: 201, body: expectedMessage },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const message = await client.messages.create(conversationSid, {
        body: 'Test message',
      })

      expect(message.body).toBe('Test message')
    })
  })

  describe('message operations', () => {
    it('should get a message by SID', async () => {
      const conversationSid = 'CH' + '0'.repeat(32)
      const messageSid = 'IM' + '0'.repeat(32)
      const expectedMessage = mockMessage({ sid: messageSid })
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /v1/Conversations/${conversationSid}/Messages/${messageSid}`,
            { status: 200, body: expectedMessage },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const message = await client.messages.get(conversationSid, messageSid)

      expect(message.sid).toBe(messageSid)
    })

    it('should update a message', async () => {
      const conversationSid = 'CH' + '0'.repeat(32)
      const messageSid = 'IM' + '0'.repeat(32)
      const expectedMessage = mockMessage({ sid: messageSid, body: 'Updated message' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v1/Conversations/${conversationSid}/Messages/${messageSid}`,
            { status: 200, body: expectedMessage },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const message = await client.messages.update(conversationSid, messageSid, {
        body: 'Updated message',
      })

      expect(message.body).toBe('Updated message')
    })

    it('should delete a message', async () => {
      const conversationSid = 'CH' + '0'.repeat(32)
      const messageSid = 'IM' + '0'.repeat(32)
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /v1/Conversations/${conversationSid}/Messages/${messageSid}`,
            { status: 204, body: {} },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const result = await client.messages.delete(conversationSid, messageSid)

      expect(result).toBe(true)
    })

    it('should list messages', async () => {
      const conversationSid = 'CH' + '0'.repeat(32)
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /v1/Conversations/${conversationSid}/Messages`,
            {
              status: 200,
              body: {
                messages: [
                  mockMessage({ index: 0, body: 'First message' }),
                  mockMessage({ index: 1, body: 'Second message' }),
                ],
                meta: {
                  page: 0,
                  page_size: 50,
                  first_page_url: '/v1/Conversations/CH.../Messages',
                  previous_page_url: null,
                  next_page_url: null,
                  key: 'messages',
                },
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const messages = await client.messages.list(conversationSid)

      expect(messages).toHaveLength(2)
      expect(messages[0].index).toBe(0)
    })

    it('should list messages in descending order', async () => {
      const conversationSid = 'CH' + '0'.repeat(32)
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /v1/Conversations/${conversationSid}/Messages`,
            {
              status: 200,
              body: {
                messages: [
                  mockMessage({ index: 1, body: 'Second message' }),
                  mockMessage({ index: 0, body: 'First message' }),
                ],
                meta: {},
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const messages = await client.messages.list(conversationSid, { order: 'desc' })

      expect(messages).toHaveLength(2)
      expect(messages[0].index).toBe(1)
    })

    it('should get delivery receipts', async () => {
      const conversationSid = 'CH' + '0'.repeat(32)
      const messageSid = 'IM' + '0'.repeat(32)
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /v1/Conversations/${conversationSid}/Messages/${messageSid}/Receipts`,
            {
              status: 200,
              body: {
                delivery_receipts: [
                  {
                    sid: 'DY' + '0'.repeat(32),
                    account_sid: 'AC' + '0'.repeat(32),
                    conversation_sid: conversationSid,
                    message_sid: messageSid,
                    participant_sid: 'MB' + '0'.repeat(32),
                    status: 'delivered',
                    error_code: null,
                    date_created: new Date().toISOString(),
                    date_updated: new Date().toISOString(),
                    url: '/v1/.../Receipts/DY...',
                  },
                ],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const receipts = await client.messages.getDeliveryReceipts(conversationSid, messageSid)

      expect(receipts).toHaveLength(1)
      expect(receipts[0].status).toBe('delivered')
    })
  })
})

// =============================================================================
// 4. Cross-Channel Support
// =============================================================================

describe('@dotdo/twilio/conversations - Cross-Channel Support', () => {
  it('should support mixed SMS and WhatsApp participants', async () => {
    const conversationSid = 'CH' + '0'.repeat(32)
    const smsParticipant = mockParticipant({
      sid: 'MB' + '0'.repeat(32),
      messaging_binding: { type: 'sms', address: '+15551234567', proxy_address: '+15559876543' },
    })
    const whatsappParticipant = mockParticipant({
      sid: 'MB' + '1'.repeat(32),
      messaging_binding: {
        type: 'whatsapp',
        address: 'whatsapp:+15552345678',
        proxy_address: 'whatsapp:+14155238886',
      },
    })

    let callCount = 0
    const mockFetch = vi.fn(async () => {
      callCount++
      return {
        ok: true,
        status: 201,
        headers: new Headers(),
        json: async () => (callCount === 1 ? smsParticipant : whatsappParticipant),
      }
    })

    const client = createTestClient(mockFetch)

    const sms = await client.addSmsParticipant(conversationSid, '+15551234567', '+15559876543')
    const whatsapp = await client.addWhatsAppParticipant(
      conversationSid,
      '+15552345678',
      '+14155238886'
    )

    expect(sms.messaging_binding?.type).toBe('sms')
    expect(whatsapp.messaging_binding?.type).toBe('whatsapp')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('should support mixed chat and messaging participants', async () => {
    const conversationSid = 'CH' + '0'.repeat(32)
    const chatParticipant = mockParticipant({
      sid: 'MB' + '0'.repeat(32),
      identity: 'agent-123',
      messaging_binding: null,
    })
    const smsParticipant = mockParticipant({
      sid: 'MB' + '1'.repeat(32),
      messaging_binding: { type: 'sms', address: '+15551234567', proxy_address: '+15559876543' },
    })

    let callCount = 0
    const mockFetch = vi.fn(async () => {
      callCount++
      return {
        ok: true,
        status: 201,
        headers: new Headers(),
        json: async () => (callCount === 1 ? chatParticipant : smsParticipant),
      }
    })

    const client = createTestClient(mockFetch)

    const chat = await client.addChatParticipant(conversationSid, 'agent-123')
    const sms = await client.addSmsParticipant(conversationSid, '+15551234567', '+15559876543')

    expect(chat.identity).toBe('agent-123')
    expect(sms.messaging_binding?.type).toBe('sms')
  })
})

// =============================================================================
// 5. User Management
// =============================================================================

describe('@dotdo/twilio/conversations - User Management', () => {
  describe('user CRUD', () => {
    it('should create a user', async () => {
      const expectedUser = mockUser({ identity: 'user-123' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v1/Users`, { status: 201, body: expectedUser }],
        ])
      )

      const client = createTestClient(mockFetch)
      const user = await client.users.create({ identity: 'user-123' })

      expect(user.identity).toBe('user-123')
    })

    it('should create a user with friendly name', async () => {
      const expectedUser = mockUser({
        identity: 'user-123',
        friendly_name: 'John Doe',
      })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v1/Users`, { status: 201, body: expectedUser }],
        ])
      )

      const client = createTestClient(mockFetch)
      const user = await client.users.create({
        identity: 'user-123',
        friendlyName: 'John Doe',
      })

      expect(user.friendly_name).toBe('John Doe')
    })

    it('should get a user by SID', async () => {
      const userSid = 'US' + '0'.repeat(32)
      const expectedUser = mockUser({ sid: userSid })
      const mockFetch = createMockFetch(
        new Map([
          [`GET /v1/Users/${userSid}`, { status: 200, body: expectedUser }],
        ])
      )

      const client = createTestClient(mockFetch)
      const user = await client.users.get(userSid)

      expect(user.sid).toBe(userSid)
    })

    it('should get a user by identity', async () => {
      const identity = 'user-123'
      const expectedUser = mockUser({ identity })
      const mockFetch = createMockFetch(
        new Map([
          [`GET /v1/Users/${identity}`, { status: 200, body: expectedUser }],
        ])
      )

      const client = createTestClient(mockFetch)
      const user = await client.users.get(identity)

      expect(user.identity).toBe(identity)
    })

    it('should update a user', async () => {
      const userSid = 'US' + '0'.repeat(32)
      const expectedUser = mockUser({ sid: userSid, friendly_name: 'Updated Name' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v1/Users/${userSid}`, { status: 200, body: expectedUser }],
        ])
      )

      const client = createTestClient(mockFetch)
      const user = await client.users.update(userSid, { friendlyName: 'Updated Name' })

      expect(user.friendly_name).toBe('Updated Name')
    })

    it('should delete a user', async () => {
      const userSid = 'US' + '0'.repeat(32)
      const mockFetch = createMockFetch(
        new Map([
          [`DELETE /v1/Users/${userSid}`, { status: 204, body: {} }],
        ])
      )

      const client = createTestClient(mockFetch)
      const result = await client.users.delete(userSid)

      expect(result).toBe(true)
    })

    it('should list users', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /v1/Users`,
            {
              status: 200,
              body: {
                users: [mockUser({ identity: 'user-1' }), mockUser({ identity: 'user-2' })],
                meta: {},
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const users = await client.users.list()

      expect(users).toHaveLength(2)
    })
  })

  describe('user conversations', () => {
    it('should get conversations for a user', async () => {
      const userSid = 'US' + '0'.repeat(32)
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /v1/Users/${userSid}/Conversations`,
            {
              status: 200,
              body: {
                conversations: [
                  {
                    account_sid: 'AC...',
                    chat_service_sid: 'IS...',
                    conversation_sid: 'CH' + '0'.repeat(32),
                    user_sid: userSid,
                    participant_sid: 'MB...',
                    conversation_friendly_name: 'Support Chat',
                    conversation_state: 'active',
                    notification_level: 'default',
                    unread_messages_count: 5,
                    last_read_message_index: 10,
                    date_created: new Date().toISOString(),
                    date_updated: new Date().toISOString(),
                    url: '/v1/Users/.../Conversations/...',
                    links: {},
                  },
                ],
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const conversations = await client.users.getConversations(userSid)

      expect(conversations).toHaveLength(1)
      expect(conversations[0].unread_messages_count).toBe(5)
    })

    it('should update user conversation settings', async () => {
      const userSid = 'US' + '0'.repeat(32)
      const conversationSid = 'CH' + '0'.repeat(32)
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v1/Users/${userSid}/Conversations/${conversationSid}`,
            {
              status: 200,
              body: {
                account_sid: 'AC...',
                chat_service_sid: 'IS...',
                conversation_sid: conversationSid,
                user_sid: userSid,
                notification_level: 'muted',
                last_read_message_index: 15,
                date_created: new Date().toISOString(),
                date_updated: new Date().toISOString(),
                url: '/v1/Users/.../Conversations/...',
                links: {},
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const userConversation = await client.users.updateConversation(
        userSid,
        conversationSid,
        {
          notificationLevel: 'muted',
          lastReadMessageIndex: 15,
        }
      )

      expect(userConversation.notification_level).toBe('muted')
      expect(userConversation.last_read_message_index).toBe(15)
    })
  })
})

// =============================================================================
// 6. Webhook Handling
// =============================================================================

describe('@dotdo/twilio/conversations - Webhook Handling', () => {
  describe('event handlers', () => {
    it('should register and trigger event handlers', async () => {
      const client = createTestClient()
      let receivedPayload: ConversationWebhookPayload | null = null

      client.on('onMessageAdded', (payload) => {
        receivedPayload = payload
      })

      const testPayload: ConversationWebhookPayload = {
        AccountSid: 'AC...',
        ChatServiceSid: 'IS...',
        ConversationSid: 'CH...',
        EventType: 'onMessageAdded',
        MessageSid: 'IM...',
        MessageBody: 'Hello!',
        MessageAuthor: 'user-123',
      }

      await client.handleWebhook(testPayload)

      expect(receivedPayload).toEqual(testPayload)
    })

    it('should support wildcard handlers', async () => {
      const client = createTestClient()
      const receivedEvents: string[] = []

      client.on('*', (payload) => {
        receivedEvents.push(payload.EventType)
      })

      await client.handleWebhook({
        AccountSid: 'AC...',
        ChatServiceSid: 'IS...',
        ConversationSid: 'CH...',
        EventType: 'onMessageAdded',
      })

      await client.handleWebhook({
        AccountSid: 'AC...',
        ChatServiceSid: 'IS...',
        ConversationSid: 'CH...',
        EventType: 'onParticipantAdded',
      })

      expect(receivedEvents).toEqual(['onMessageAdded', 'onParticipantAdded'])
    })

    it('should remove event handlers', async () => {
      const client = createTestClient()
      let callCount = 0

      const handler = () => {
        callCount++
      }

      client.on('onMessageAdded', handler)
      await client.handleWebhook({
        AccountSid: 'AC...',
        ChatServiceSid: 'IS...',
        ConversationSid: 'CH...',
        EventType: 'onMessageAdded',
      })
      expect(callCount).toBe(1)

      client.off('onMessageAdded', handler)
      await client.handleWebhook({
        AccountSid: 'AC...',
        ChatServiceSid: 'IS...',
        ConversationSid: 'CH...',
        EventType: 'onMessageAdded',
      })
      expect(callCount).toBe(1)
    })
  })

  describe('webhook signature verification', () => {
    it('should verify valid webhook signature', async () => {
      const client = createTestClient(undefined, { webhookSecret: 'test_secret' })

      const url = 'https://example.com/webhook'
      const params = {
        AccountSid: 'AC12345',
        ConversationSid: 'CH12345',
        EventType: 'onMessageAdded',
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

      const isValid = await client.verifyWebhookSignature(signature, url, params)

      expect(isValid).toBe(true)
    })

    it('should reject invalid webhook signature', async () => {
      const client = createTestClient(undefined, { webhookSecret: 'test_secret' })

      const url = 'https://example.com/webhook'
      const params = {
        AccountSid: 'AC12345',
      }

      const isValid = await client.verifyWebhookSignature('invalid_signature', url, params)

      expect(isValid).toBe(false)
    })
  })

  describe('webhook handler router', () => {
    it('should create Hono webhook handler', () => {
      const client = createTestClient()
      const handler = client.createWebhookHandler()

      expect(handler).toBeDefined()
      expect(typeof handler.fetch).toBe('function')
    })

    it('should handle POST webhook', async () => {
      const client = createTestClient()
      let receivedEvent: string | null = null

      client.on('onMessageAdded', (payload) => {
        receivedEvent = payload.EventType
      })

      const handler = client.createWebhookHandler()

      const request = new Request('https://example.com/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          AccountSid: 'AC...',
          ChatServiceSid: 'IS...',
          ConversationSid: 'CH...',
          EventType: 'onMessageAdded',
        }),
      })

      const response = await handler.fetch(request)

      expect(response.status).toBe(200)
      expect(receivedEvent).toBe('onMessageAdded')
    })
  })
})

// =============================================================================
// 7. Service Management
// =============================================================================

describe('@dotdo/twilio/conversations - Service Management', () => {
  describe('service CRUD', () => {
    it('should create a service', async () => {
      const expectedService = mockService({ friendly_name: 'My Service' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v1/Services`, { status: 201, body: expectedService }],
        ])
      )

      const client = createTestClient(mockFetch)
      const service = await client.services.create({ friendlyName: 'My Service' })

      expect(service.friendly_name).toBe('My Service')
    })

    it('should get a service', async () => {
      const serviceSid = 'IS' + '0'.repeat(32)
      const expectedService = mockService({ sid: serviceSid })
      const mockFetch = createMockFetch(
        new Map([
          [`GET /v1/Services/${serviceSid}`, { status: 200, body: expectedService }],
        ])
      )

      const client = createTestClient(mockFetch)
      const service = await client.services.get(serviceSid)

      expect(service.sid).toBe(serviceSid)
    })

    it('should update a service', async () => {
      const serviceSid = 'IS' + '0'.repeat(32)
      const expectedService = mockService({ sid: serviceSid, friendly_name: 'Updated Service' })
      const mockFetch = createMockFetch(
        new Map([
          [`POST /v1/Services/${serviceSid}`, { status: 200, body: expectedService }],
        ])
      )

      const client = createTestClient(mockFetch)
      const service = await client.services.update(serviceSid, { friendlyName: 'Updated Service' })

      expect(service.friendly_name).toBe('Updated Service')
    })

    it('should delete a service', async () => {
      const serviceSid = 'IS' + '0'.repeat(32)
      const mockFetch = createMockFetch(
        new Map([
          [`DELETE /v1/Services/${serviceSid}`, { status: 204, body: {} }],
        ])
      )

      const client = createTestClient(mockFetch)
      const result = await client.services.delete(serviceSid)

      expect(result).toBe(true)
    })

    it('should list services', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /v1/Services`,
            {
              status: 200,
              body: {
                services: [
                  mockService({ friendly_name: 'Service 1' }),
                  mockService({ friendly_name: 'Service 2' }),
                ],
                meta: {},
              },
            },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const services = await client.services.list()

      expect(services).toHaveLength(2)
    })
  })

  describe('service scoping', () => {
    it('should create a scoped client for a service', async () => {
      const serviceSid = 'IS' + '0'.repeat(32)
      const expectedConversation = mockConversation()
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v1/Services/${serviceSid}/Conversations`,
            { status: 201, body: expectedConversation },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const scopedClient = client.service(serviceSid)

      const conversation = await scopedClient.create({
        friendlyName: 'Scoped Conversation',
      })

      expect(conversation.sid).toMatch(/^CH/)
    })

    it('should use scoped paths for all operations', async () => {
      const serviceSid = 'IS' + '0'.repeat(32)
      const conversationSid = 'CH' + '0'.repeat(32)
      const expectedConversation = mockConversation({ sid: conversationSid })
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /v1/Services/${serviceSid}/Conversations/${conversationSid}`,
            { status: 200, body: expectedConversation },
          ],
        ])
      )

      const client = createTestClient(mockFetch)
      const scopedClient = client.service(serviceSid)

      const conversation = await scopedClient.get(conversationSid)

      expect(conversation.sid).toBe(conversationSid)
    })

    it('should use default service SID from config', async () => {
      const serviceSid = 'IS' + '0'.repeat(32)
      const expectedConversation = mockConversation()
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /v1/Services/${serviceSid}/Conversations`,
            { status: 201, body: expectedConversation },
          ],
        ])
      )

      const client = createTestClient(mockFetch, { defaultServiceSid: serviceSid })

      const conversation = await client.create()

      expect(conversation.sid).toMatch(/^CH/)
    })
  })
})

// =============================================================================
// Error Handling
// =============================================================================

describe('@dotdo/twilio/conversations - Error Handling', () => {
  it('should throw TwilioConversationsError for API errors', async () => {
    const mockFetch = createMockFetch(
      new Map([
        [
          `POST /v1/Conversations`,
          {
            status: 400,
            body: {
              code: 50300,
              message: 'Invalid parameter',
              more_info: 'https://www.twilio.com/docs/errors/50300',
              status: 400,
            },
          },
        ],
      ])
    )

    const client = createTestClient(mockFetch)

    try {
      await client.create({ uniqueName: 'invalid' })
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(TwilioConversationsError)
      const convError = error as TwilioConversationsError
      expect(convError.code).toBe(50300)
      expect(convError.status).toBe(400)
    }
  })

  it('should handle authentication errors', async () => {
    const mockFetch = createMockFetch(
      new Map([
        [
          `POST /v1/Conversations`,
          {
            status: 401,
            body: {
              code: 20003,
              message: 'Authentication Error',
              more_info: 'https://www.twilio.com/docs/errors/20003',
              status: 401,
            },
          },
        ],
      ])
    )

    const client = createTestClient(mockFetch)

    await expect(client.create()).rejects.toThrow(TwilioConversationsError)
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
        json: async () => mockConversation(),
      }
    })

    const client = new TwilioConversations({
      accountSid: 'ACtest123',
      authToken: 'authtoken123',
      fetch: mockFetch,
      autoRetry: true,
      maxRetries: 3,
    })

    const conversation = await client.create()

    expect(conversation.sid).toBeDefined()
    expect(callCount).toBe(3)
  })
})

// =============================================================================
// Factory Function Tests
// =============================================================================

describe('@dotdo/twilio/conversations - Factory Function', () => {
  it('should create client using createConversationsClient factory', () => {
    const client = createConversationsClient('ACtest123', 'authtoken123')

    expect(client).toBeInstanceOf(TwilioConversations)
  })

  it('should create client with config options', () => {
    const client = createConversationsClient('ACtest123', 'authtoken123', {
      defaultServiceSid: 'IS' + '0'.repeat(32),
    })

    expect(client).toBeInstanceOf(TwilioConversations)
  })

  it('should throw error without accountSid', () => {
    expect(() => createConversationsClient('', 'authtoken123')).toThrow('accountSid is required')
  })

  it('should throw error without authToken', () => {
    expect(() => createConversationsClient('ACtest123', '')).toThrow('authToken is required')
  })
})

// =============================================================================
// Region/Edge Configuration Tests
// =============================================================================

describe('@dotdo/twilio/conversations - Edge/Region Configuration', () => {
  it('should use custom region in API URL', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 201,
      headers: new Headers(),
      json: async () => mockConversation(),
    }))

    const client = new TwilioConversations({
      accountSid: 'ACtest123',
      authToken: 'authtoken123',
      fetch: mockFetch,
      region: 'ie1',
    })

    await client.create()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('conversations.ie1.twilio.com'),
      expect.anything()
    )
  })

  it('should use custom edge in API URL', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 201,
      headers: new Headers(),
      json: async () => mockConversation(),
    }))

    const client = new TwilioConversations({
      accountSid: 'ACtest123',
      authToken: 'authtoken123',
      fetch: mockFetch,
      edge: 'ashburn',
    })

    await client.create()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('conversations.ashburn.twilio.com'),
      expect.anything()
    )
  })
})
