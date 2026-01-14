/**
 * @dotdo/intercom - Intercom SDK Compatibility Layer Tests
 *
 * Tests for the Intercom API compatibility layer including:
 * - Client initialization
 * - Contacts (create, get, update, search, list, delete)
 * - Conversations (create, reply, assign, close, open, snooze)
 * - Messages (send in-app, send email)
 * - Events (track custom events)
 * - Articles (create, get, search)
 *
 * @module @dotdo/intercom/tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Client,
  IntercomError,
  IntercomLocal,
  type Contact,
  type Conversation,
  type Message,
  type Event,
  type Article,
  type ListResponse,
} from '../src'

// =============================================================================
// Test Helpers
// =============================================================================

function createMockFetch(responses: Map<string, { status: number; body: unknown }>) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const urlObj = new URL(url)
    const method = options?.method ?? 'GET'
    const key = `${method} ${urlObj.pathname}`

    const mockResponse = responses.get(key)
    if (!mockResponse) {
      return {
        ok: false,
        status: 404,
        headers: new Headers({ 'x-request-id': 'req_mock' }),
        json: async () => ({
          type: 'error.list',
          errors: [{ code: 'not_found', message: `No mock for ${key}` }],
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

function mockContact(overrides: Partial<Contact> = {}): Contact {
  return {
    type: 'contact',
    id: 'contact_123',
    workspace_id: 'workspace_abc',
    external_id: 'ext_user_123',
    role: 'user',
    email: 'user@example.com',
    name: 'John Doe',
    phone: '+1234567890',
    avatar: null,
    signed_up_at: Math.floor(Date.now() / 1000),
    last_seen_at: Math.floor(Date.now() / 1000),
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
    custom_attributes: {},
    tags: { type: 'list', data: [] },
    notes: { type: 'list', data: [] },
    companies: { type: 'list', data: [] },
    location: {},
    social_profiles: { type: 'list', data: [] },
    unsubscribed_from_emails: false,
    ...overrides,
  }
}

function mockConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    type: 'conversation',
    id: 'conv_123',
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
    title: null,
    admin_assignee_id: null,
    team_assignee_id: null,
    open: true,
    state: 'open',
    read: false,
    waiting_since: null,
    snoozed_until: null,
    source: {
      type: 'conversation',
      id: 'source_123',
      delivered_as: 'customer_initiated',
      body: 'Hello, I need help!',
      author: {
        type: 'user',
        id: 'contact_123',
        name: 'John Doe',
        email: 'user@example.com',
      },
    },
    contacts: {
      type: 'contact.list',
      contacts: [{ type: 'contact', id: 'contact_123' }],
    },
    teammates: { type: 'admin.list', admins: [] },
    conversation_parts: { type: 'conversation_part.list', conversation_parts: [], total_count: 0 },
    tags: { type: 'tag.list', tags: [] },
    first_contact_reply: null,
    priority: 'not_priority',
    sla_applied: null,
    statistics: null,
    conversation_rating: null,
    custom_attributes: {},
    ...overrides,
  }
}

function mockMessage(overrides: Partial<Message> = {}): Message {
  return {
    type: 'user_message',
    id: 'msg_123',
    created_at: Math.floor(Date.now() / 1000),
    body: 'Welcome to our service!',
    message_type: 'inapp',
    conversation_id: 'conv_123',
    ...overrides,
  }
}

function mockArticle(overrides: Partial<Article> = {}): Article {
  return {
    type: 'article',
    id: 'article_123',
    workspace_id: 'workspace_abc',
    title: 'Getting Started',
    description: 'Learn how to get started with our product.',
    body: '<p>Welcome to our getting started guide...</p>',
    author_id: 'admin_123',
    state: 'published',
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
    url: 'https://help.example.com/articles/getting-started',
    parent_id: null,
    parent_type: null,
    default_locale: 'en',
    statistics: {
      type: 'article_statistics',
      views: 100,
      conversations: 5,
      reactions: 10,
      happy_reaction_percentage: 80,
      neutral_reaction_percentage: 15,
      sad_reaction_percentage: 5,
    },
    ...overrides,
  }
}

// =============================================================================
// Client Tests
// =============================================================================

describe('@dotdo/intercom - Client', () => {
  describe('initialization', () => {
    it('should create a client with token auth', () => {
      const client = new Client({ tokenAuth: { token: 'test_token' } })
      expect(client).toBeDefined()
      expect(client.contacts).toBeDefined()
      expect(client.conversations).toBeDefined()
      expect(client.messages).toBeDefined()
      expect(client.events).toBeDefined()
      expect(client.articles).toBeDefined()
    })

    it('should throw error without authentication', () => {
      expect(() => new Client({} as any)).toThrow('Authentication is required')
    })

    it('should accept configuration options', () => {
      const client = new Client({
        tokenAuth: { token: 'test_token' },
        apiVersion: '2.11',
      })
      expect(client).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('should throw IntercomError on API errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /contacts/nonexistent',
            {
              status: 404,
              body: {
                type: 'error.list',
                request_id: 'req_123',
                errors: [
                  {
                    code: 'not_found',
                    message: 'Contact not found',
                  },
                ],
              },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })

      await expect(client.contacts.find('nonexistent')).rejects.toThrow(IntercomError)

      try {
        await client.contacts.find('nonexistent')
      } catch (error) {
        expect(error).toBeInstanceOf(IntercomError)
        const intercomError = error as IntercomError
        expect(intercomError.code).toBe('not_found')
        expect(intercomError.statusCode).toBe(404)
      }
    })
  })
})

// =============================================================================
// Contacts Tests
// =============================================================================

describe('@dotdo/intercom - Contacts', () => {
  describe('create', () => {
    it('should create a contact with role user', async () => {
      const expectedContact = mockContact()
      const mockFetch = createMockFetch(
        new Map([['POST /contacts', { status: 200, body: expectedContact }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const contact = await client.contacts.create({
        role: 'user',
        email: 'user@example.com',
        name: 'John Doe',
      })

      expect(contact.id).toBe('contact_123')
      expect(contact.email).toBe('user@example.com')
      expect(contact.role).toBe('user')
    })

    it('should create a contact with custom attributes', async () => {
      const expectedContact = mockContact({ custom_attributes: { plan: 'premium', tier: 'gold' } })
      const mockFetch = createMockFetch(
        new Map([['POST /contacts', { status: 200, body: expectedContact }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const contact = await client.contacts.create({
        role: 'user',
        email: 'user@example.com',
        custom_attributes: { plan: 'premium', tier: 'gold' },
      })

      expect(contact.custom_attributes.plan).toBe('premium')
      expect(contact.custom_attributes.tier).toBe('gold')
    })

    it('should create a lead contact', async () => {
      const expectedContact = mockContact({ role: 'lead' })
      const mockFetch = createMockFetch(
        new Map([['POST /contacts', { status: 200, body: expectedContact }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const contact = await client.contacts.create({
        role: 'lead',
        email: 'lead@example.com',
      })

      expect(contact.role).toBe('lead')
    })
  })

  describe('find', () => {
    it('should find a contact by ID', async () => {
      const expectedContact = mockContact()
      const mockFetch = createMockFetch(
        new Map([['GET /contacts/contact_123', { status: 200, body: expectedContact }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const contact = await client.contacts.find('contact_123')

      expect(contact.id).toBe('contact_123')
      expect(contact.type).toBe('contact')
    })
  })

  describe('update', () => {
    it('should update a contact', async () => {
      const updatedContact = mockContact({ name: 'Jane Doe' })
      const mockFetch = createMockFetch(
        new Map([['PUT /contacts/contact_123', { status: 200, body: updatedContact }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const contact = await client.contacts.update('contact_123', {
        name: 'Jane Doe',
      })

      expect(contact.name).toBe('Jane Doe')
    })
  })

  describe('delete', () => {
    it('should delete a contact', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'DELETE /contacts/contact_123',
            {
              status: 200,
              body: { type: 'contact', id: 'contact_123', deleted: true },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const result = await client.contacts.delete('contact_123')

      expect(result.deleted).toBe(true)
      expect(result.id).toBe('contact_123')
    })
  })

  describe('list', () => {
    it('should list contacts', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /contacts',
            {
              status: 200,
              body: {
                type: 'list',
                data: [mockContact(), mockContact({ id: 'contact_456' })],
                total_count: 2,
                pages: { type: 'pages', page: 1, per_page: 50, total_pages: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const result = await client.contacts.list()

      expect(result.type).toBe('list')
      expect(result.data).toHaveLength(2)
      expect(result.total_count).toBe(2)
    })
  })

  describe('search', () => {
    it('should search contacts by email', async () => {
      const expectedContact = mockContact()
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /contacts/search',
            {
              status: 200,
              body: {
                type: 'list',
                data: [expectedContact],
                total_count: 1,
                pages: { type: 'pages', page: 1, per_page: 50, total_pages: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const result = await client.contacts.search({
        query: {
          field: 'email',
          operator: '=',
          value: 'user@example.com',
        },
      })

      expect(result.data).toHaveLength(1)
      expect(result.data[0].email).toBe('user@example.com')
    })

    it('should search contacts with nested query', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /contacts/search',
            {
              status: 200,
              body: {
                type: 'list',
                data: [mockContact()],
                total_count: 1,
                pages: { type: 'pages', page: 1, per_page: 50, total_pages: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const result = await client.contacts.search({
        query: {
          operator: 'AND',
          value: [
            { field: 'email', operator: '=', value: 'user@example.com' },
            { field: 'custom_attributes.plan', operator: '=', value: 'premium' },
          ],
        },
      })

      expect(result.data).toHaveLength(1)
    })
  })

  describe('merge', () => {
    it('should merge two contacts', async () => {
      const mergedContact = mockContact({ id: 'contact_123' })
      const mockFetch = createMockFetch(
        new Map([['POST /contacts/merge', { status: 200, body: mergedContact }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const contact = await client.contacts.merge({
        from: 'contact_456',
        into: 'contact_123',
      })

      expect(contact.id).toBe('contact_123')
    })
  })
})

// =============================================================================
// Conversations Tests
// =============================================================================

describe('@dotdo/intercom - Conversations', () => {
  describe('create', () => {
    it('should create a conversation from a user', async () => {
      const expectedConversation = mockConversation()
      const mockFetch = createMockFetch(
        new Map([['POST /conversations', { status: 200, body: expectedConversation }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const conversation = await client.conversations.create({
        from: { type: 'user', id: 'contact_123' },
        body: 'Hello, I need help!',
      })

      expect(conversation.id).toBe('conv_123')
      expect(conversation.state).toBe('open')
    })
  })

  describe('find', () => {
    it('should find a conversation by ID', async () => {
      const expectedConversation = mockConversation()
      const mockFetch = createMockFetch(
        new Map([['GET /conversations/conv_123', { status: 200, body: expectedConversation }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const conversation = await client.conversations.find('conv_123')

      expect(conversation.id).toBe('conv_123')
      expect(conversation.type).toBe('conversation')
    })
  })

  describe('list', () => {
    it('should list conversations', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /conversations',
            {
              status: 200,
              body: {
                type: 'conversation.list',
                conversations: [mockConversation()],
                total_count: 1,
                pages: { type: 'pages', page: 1, per_page: 20, total_pages: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const result = await client.conversations.list()

      expect(result.conversations).toHaveLength(1)
      expect(result.total_count).toBe(1)
    })
  })

  describe('reply', () => {
    it('should reply as an admin', async () => {
      const expectedConversation = mockConversation()
      const mockFetch = createMockFetch(
        new Map([['POST /conversations/conv_123/reply', { status: 200, body: expectedConversation }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const conversation = await client.conversations.reply({
        id: 'conv_123',
        type: 'admin',
        admin_id: 'admin_123',
        body: 'How can I help you?',
        message_type: 'comment',
      })

      expect(conversation.id).toBe('conv_123')
    })
  })

  describe('close', () => {
    it('should close a conversation', async () => {
      const closedConversation = mockConversation({ state: 'closed', open: false })
      const mockFetch = createMockFetch(
        new Map([['POST /conversations/conv_123/parts', { status: 200, body: closedConversation }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const conversation = await client.conversations.close({
        id: 'conv_123',
        admin_id: 'admin_123',
      })

      expect(conversation.state).toBe('closed')
      expect(conversation.open).toBe(false)
    })
  })

  describe('open', () => {
    it('should reopen a conversation', async () => {
      const openedConversation = mockConversation({ state: 'open', open: true })
      const mockFetch = createMockFetch(
        new Map([['POST /conversations/conv_123/parts', { status: 200, body: openedConversation }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const conversation = await client.conversations.open({
        id: 'conv_123',
        admin_id: 'admin_123',
      })

      expect(conversation.state).toBe('open')
      expect(conversation.open).toBe(true)
    })
  })

  describe('assign', () => {
    it('should assign a conversation to an admin', async () => {
      const assignedConversation = mockConversation({ admin_assignee_id: 'admin_456' })
      const mockFetch = createMockFetch(
        new Map([['POST /conversations/conv_123/parts', { status: 200, body: assignedConversation }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const conversation = await client.conversations.assign({
        id: 'conv_123',
        admin_id: 'admin_123',
        assignee_id: 'admin_456',
        type: 'admin',
      })

      expect(conversation.admin_assignee_id).toBe('admin_456')
    })
  })

  describe('snooze', () => {
    it('should snooze a conversation', async () => {
      const snoozedUntil = Math.floor(Date.now() / 1000) + 3600
      const snoozedConversation = mockConversation({ state: 'snoozed', snoozed_until: snoozedUntil })
      const mockFetch = createMockFetch(
        new Map([['POST /conversations/conv_123/parts', { status: 200, body: snoozedConversation }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const conversation = await client.conversations.snooze({
        id: 'conv_123',
        admin_id: 'admin_123',
        snoozed_until: snoozedUntil,
      })

      expect(conversation.state).toBe('snoozed')
      expect(conversation.snoozed_until).toBe(snoozedUntil)
    })
  })
})

// =============================================================================
// Messages Tests
// =============================================================================

describe('@dotdo/intercom - Messages', () => {
  describe('create', () => {
    it('should send an in-app message', async () => {
      const expectedMessage = mockMessage({ message_type: 'inapp' })
      const mockFetch = createMockFetch(
        new Map([['POST /messages', { status: 200, body: expectedMessage }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const message = await client.messages.create({
        message_type: 'inapp',
        body: 'Welcome to our service!',
        from: { type: 'admin', id: 'admin_123' },
        to: { type: 'user', id: 'contact_123' },
      })

      expect(message.message_type).toBe('inapp')
      expect(message.body).toBe('Welcome to our service!')
    })

    it('should send an email message', async () => {
      const expectedMessage = mockMessage({ message_type: 'email' })
      const mockFetch = createMockFetch(
        new Map([['POST /messages', { status: 200, body: expectedMessage }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const message = await client.messages.create({
        message_type: 'email',
        subject: 'Welcome!',
        body: 'Thank you for signing up.',
        from: { type: 'admin', id: 'admin_123' },
        to: { type: 'user', email: 'user@example.com' },
      })

      expect(message.message_type).toBe('email')
    })
  })
})

// =============================================================================
// Events Tests
// =============================================================================

describe('@dotdo/intercom - Events', () => {
  describe('create', () => {
    it('should track an event', async () => {
      const mockFetch = createMockFetch(
        new Map([['POST /events', { status: 202, body: {} }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      await client.events.create({
        event_name: 'order-completed',
        user_id: 'contact_123',
        metadata: { order_id: '123', total: 99.99 },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/events'),
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  describe('list', () => {
    it('should list events for a user', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /events',
            {
              status: 200,
              body: {
                type: 'event.list',
                events: [{
                  type: 'event',
                  event_name: 'order-completed',
                  created_at: Math.floor(Date.now() / 1000),
                  user_id: 'contact_123',
                }],
                pages: { next: null },
              },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const result = await client.events.list({ user_id: 'contact_123', type: 'user' })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].event_name).toBe('order-completed')
    })
  })

  describe('summaries', () => {
    it('should get event summaries', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /events/summaries',
            {
              status: 200,
              body: {
                type: 'event.summary',
                events: [
                  { event_name: 'order-completed', count: 42 },
                  { event_name: 'page-viewed', count: 1000 },
                ],
              },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const result = await client.events.summaries({ user_id: 'contact_123' })

      expect(result.events).toHaveLength(2)
    })
  })
})

// =============================================================================
// Articles Tests
// =============================================================================

describe('@dotdo/intercom - Articles', () => {
  describe('create', () => {
    it('should create an article', async () => {
      const expectedArticle = mockArticle()
      const mockFetch = createMockFetch(
        new Map([['POST /articles', { status: 200, body: expectedArticle }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const article = await client.articles.create({
        title: 'Getting Started',
        author_id: 'admin_123',
        body: '<p>Welcome to our getting started guide...</p>',
        state: 'published',
      })

      expect(article.id).toBe('article_123')
      expect(article.title).toBe('Getting Started')
      expect(article.state).toBe('published')
    })
  })

  describe('find', () => {
    it('should find an article by ID', async () => {
      const expectedArticle = mockArticle()
      const mockFetch = createMockFetch(
        new Map([['GET /articles/article_123', { status: 200, body: expectedArticle }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const article = await client.articles.find('article_123')

      expect(article.id).toBe('article_123')
      expect(article.type).toBe('article')
    })
  })

  describe('update', () => {
    it('should update an article', async () => {
      const updatedArticle = mockArticle({ title: 'Updated Getting Started' })
      const mockFetch = createMockFetch(
        new Map([['PUT /articles/article_123', { status: 200, body: updatedArticle }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const article = await client.articles.update('article_123', {
        title: 'Updated Getting Started',
      })

      expect(article.title).toBe('Updated Getting Started')
    })
  })

  describe('delete', () => {
    it('should delete an article', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'DELETE /articles/article_123',
            {
              status: 200,
              body: { type: 'article', id: 'article_123', deleted: true },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const result = await client.articles.delete('article_123')

      expect(result.deleted).toBe(true)
      expect(result.id).toBe('article_123')
    })
  })

  describe('list', () => {
    it('should list articles', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /articles',
            {
              status: 200,
              body: {
                type: 'list',
                data: [mockArticle(), mockArticle({ id: 'article_456' })],
                total_count: 2,
                pages: { type: 'pages', page: 1, per_page: 50, total_pages: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const result = await client.articles.list()

      expect(result.data).toHaveLength(2)
      expect(result.total_count).toBe(2)
    })
  })

  describe('search', () => {
    it('should search articles', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /articles/search',
            {
              status: 200,
              body: {
                type: 'article.list',
                articles: {
                  type: 'list',
                  data: [mockArticle()],
                  total_count: 1,
                },
                pages: { type: 'pages', page: 1, per_page: 20, total_pages: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const result = await client.articles.search({
        phrase: 'getting started',
      })

      expect(result.articles.data).toHaveLength(1)
    })
  })
})

// =============================================================================
// IntercomLocal (In-Memory Backend) Tests
// =============================================================================

describe('@dotdo/intercom - IntercomLocal', () => {
  describe('initialization', () => {
    it('should create a local client', () => {
      const client = new IntercomLocal({ workspaceId: 'test_workspace' })
      expect(client).toBeDefined()
      expect(client.contacts).toBeDefined()
      expect(client.conversations).toBeDefined()
      expect(client.messages).toBeDefined()
      expect(client.events).toBeDefined()
      expect(client.articles).toBeDefined()
    })
  })

  describe('contacts', () => {
    it('should create and find a contact', async () => {
      const client = new IntercomLocal({ workspaceId: 'test_workspace' })

      const contact = await client.contacts.create({
        role: 'user',
        email: 'local@example.com',
        name: 'Local User',
      })

      expect(contact.email).toBe('local@example.com')
      expect(contact.name).toBe('Local User')
      expect(contact.id).toBeDefined()

      const found = await client.contacts.find(contact.id)
      expect(found.email).toBe('local@example.com')
    })

    it('should update a contact', async () => {
      const client = new IntercomLocal({ workspaceId: 'test_workspace' })

      const contact = await client.contacts.create({
        role: 'user',
        email: 'update@example.com',
      })

      const updated = await client.contacts.update(contact.id, {
        name: 'Updated Name',
      })

      expect(updated.name).toBe('Updated Name')
    })

    it('should delete a contact', async () => {
      const client = new IntercomLocal({ workspaceId: 'test_workspace' })

      const contact = await client.contacts.create({
        role: 'user',
        email: 'delete@example.com',
      })

      const result = await client.contacts.delete(contact.id)
      expect(result.deleted).toBe(true)

      await expect(client.contacts.find(contact.id)).rejects.toThrow('Contact not found')
    })

    it('should find contact by email', async () => {
      const client = new IntercomLocal({ workspaceId: 'test_workspace' })

      await client.contacts.create({
        role: 'user',
        email: 'findbyemail@example.com',
        name: 'Email User',
      })

      const found = await client.contacts.findByEmail('findbyemail@example.com')
      expect(found).not.toBeNull()
      expect(found?.email).toBe('findbyemail@example.com')
    })

    it('should list contacts', async () => {
      const client = new IntercomLocal({ workspaceId: 'test_workspace' })

      await client.contacts.create({ role: 'user', email: 'list1@example.com' })
      await client.contacts.create({ role: 'user', email: 'list2@example.com' })

      const result = await client.contacts.list()
      expect(result.data.length).toBeGreaterThanOrEqual(2)
    })

    it('should search contacts', async () => {
      const client = new IntercomLocal({ workspaceId: 'test_workspace' })

      await client.contacts.create({
        role: 'user',
        email: 'search@example.com',
        custom_attributes: { plan: 'enterprise' },
      })

      const result = await client.contacts.search({
        query: {
          field: 'custom_attributes.plan',
          operator: '=',
          value: 'enterprise',
        },
      })

      expect(result.data.length).toBeGreaterThanOrEqual(1)
    })

    it('should merge contacts', async () => {
      const client = new IntercomLocal({ workspaceId: 'test_workspace' })

      const contact1 = await client.contacts.create({
        role: 'user',
        email: 'merge1@example.com',
        custom_attributes: { field1: 'value1' },
      })

      const contact2 = await client.contacts.create({
        role: 'user',
        email: 'merge2@example.com',
        custom_attributes: { field2: 'value2' },
      })

      const merged = await client.contacts.merge({
        from: contact2.id,
        into: contact1.id,
      })

      expect(merged.id).toBe(contact1.id)
      expect(merged.custom_attributes.field1).toBe('value1')
      expect(merged.custom_attributes.field2).toBe('value2')
    })
  })

  describe('conversations', () => {
    it('should create a conversation', async () => {
      const client = new IntercomLocal({ workspaceId: 'test_workspace' })

      const contact = await client.contacts.create({
        role: 'user',
        email: 'conv@example.com',
      })

      const conversation = await client.conversations.create({
        from: { type: 'user', id: contact.id },
        body: 'Hello, I need help!',
      })

      expect(conversation.id).toBeDefined()
      expect(conversation.state).toBe('open')
    })

    it('should reply to a conversation', async () => {
      const client = new IntercomLocal({ workspaceId: 'test_workspace' })

      const contact = await client.contacts.create({
        role: 'user',
        email: 'reply@example.com',
      })

      const conversation = await client.conversations.create({
        from: { type: 'user', id: contact.id },
        body: 'Initial message',
      })

      const updated = await client.conversations.reply({
        id: conversation.id,
        type: 'admin',
        admin_id: 'admin_123',
        body: 'How can I help?',
        message_type: 'comment',
      })

      expect(updated.conversation_parts.total_count).toBeGreaterThan(1)
    })

    it('should close a conversation', async () => {
      const client = new IntercomLocal({ workspaceId: 'test_workspace' })

      const contact = await client.contacts.create({
        role: 'user',
        email: 'close@example.com',
      })

      const conversation = await client.conversations.create({
        from: { type: 'user', id: contact.id },
        body: 'Need help',
      })

      const closed = await client.conversations.close({
        id: conversation.id,
        admin_id: 'admin_123',
      })

      expect(closed.state).toBe('closed')
    })

    it('should reopen a conversation', async () => {
      const client = new IntercomLocal({ workspaceId: 'test_workspace' })

      const contact = await client.contacts.create({
        role: 'user',
        email: 'reopen@example.com',
      })

      const conversation = await client.conversations.create({
        from: { type: 'user', id: contact.id },
        body: 'Need help',
      })

      await client.conversations.close({
        id: conversation.id,
        admin_id: 'admin_123',
      })

      const reopened = await client.conversations.open({
        id: conversation.id,
        admin_id: 'admin_123',
      })

      expect(reopened.state).toBe('open')
    })
  })

  describe('events', () => {
    it('should track an event', async () => {
      const client = new IntercomLocal({ workspaceId: 'test_workspace' })

      await client.events.create({
        event_name: 'test-event',
        user_id: 'user_123',
        metadata: { key: 'value' },
      })

      const result = await client.events.list({
        type: 'user',
        user_id: 'user_123',
      })

      expect(result.events.length).toBeGreaterThanOrEqual(1)
      expect(result.events[0].event_name).toBe('test-event')
    })

    it('should get event summaries', async () => {
      const client = new IntercomLocal({ workspaceId: 'test_workspace' })

      await client.events.create({ event_name: 'summary-event', user_id: 'summary_user' })
      await client.events.create({ event_name: 'summary-event', user_id: 'summary_user' })
      await client.events.create({ event_name: 'other-event', user_id: 'summary_user' })

      const result = await client.events.summaries({ user_id: 'summary_user' })

      const summaryEvent = result.events.find(e => e.event_name === 'summary-event')
      expect(summaryEvent?.count).toBe(2)
    })
  })

  describe('articles', () => {
    it('should create and find an article', async () => {
      const client = new IntercomLocal({ workspaceId: 'test_workspace' })

      const article = await client.articles.create({
        title: 'Test Article',
        author_id: 'admin_123',
        body: '<p>Test content</p>',
        state: 'published',
      })

      expect(article.id).toBeDefined()
      expect(article.title).toBe('Test Article')

      const found = await client.articles.find(article.id)
      expect(found.title).toBe('Test Article')
    })

    it('should update an article', async () => {
      const client = new IntercomLocal({ workspaceId: 'test_workspace' })

      const article = await client.articles.create({
        title: 'Original Title',
        author_id: 'admin_123',
      })

      const updated = await client.articles.update(article.id, {
        title: 'Updated Title',
      })

      expect(updated.title).toBe('Updated Title')
    })

    it('should delete an article', async () => {
      const client = new IntercomLocal({ workspaceId: 'test_workspace' })

      const article = await client.articles.create({
        title: 'Delete Me',
        author_id: 'admin_123',
      })

      const result = await client.articles.delete(article.id)
      expect(result.deleted).toBe(true)

      await expect(client.articles.find(article.id)).rejects.toThrow('Article not found')
    })

    it('should list articles', async () => {
      const client = new IntercomLocal({ workspaceId: 'test_workspace' })

      await client.articles.create({ title: 'Article 1', author_id: 'admin_123' })
      await client.articles.create({ title: 'Article 2', author_id: 'admin_123' })

      const result = await client.articles.list()
      expect(result.data.length).toBeGreaterThanOrEqual(2)
    })

    it('should search articles by phrase', async () => {
      const client = new IntercomLocal({ workspaceId: 'test_workspace' })

      await client.articles.create({
        title: 'Getting Started Guide',
        author_id: 'admin_123',
        body: '<p>Learn how to get started with our platform.</p>',
        state: 'published',
      })

      const result = await client.articles.search({
        phrase: 'getting started',
      })

      expect(result.articles.data.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('messages', () => {
    it('should create a message', async () => {
      const client = new IntercomLocal({ workspaceId: 'test_workspace' })

      const message = await client.messages.create({
        message_type: 'inapp',
        body: 'Welcome!',
        from: { type: 'admin', id: 'admin_123' },
        to: { type: 'user', id: 'user_123' },
      })

      expect(message.id).toBeDefined()
      expect(message.body).toBe('Welcome!')
    })
  })
})
