/**
 * @dotdo/intercom - Intercom Compatibility Layer Tests
 *
 * Tests for the Intercom API compatibility layer including:
 * - Client initialization
 * - Contacts (create, get, update, search, list)
 * - Conversations (create, reply, assign, close, open)
 * - Messages (send in-app, send email)
 * - Events (track custom events)
 * - Articles (create, get, search)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Client,
  IntercomError,
  type Contact,
  type Conversation,
  type Message,
  type Event,
  type Article,
  type ListResponse,
  type SearchResponse,
} from '../index'

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

function mockEvent(overrides: Partial<Event> = {}): Event {
  return {
    type: 'event',
    event_name: 'order-completed',
    created_at: Math.floor(Date.now() / 1000),
    user_id: 'contact_123',
    id: 'event_123',
    intercom_user_id: 'contact_123',
    email: 'user@example.com',
    metadata: { order_id: '123', total: 99.99 },
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

    it('should update custom attributes', async () => {
      const updatedContact = mockContact({ custom_attributes: { plan: 'enterprise' } })
      const mockFetch = createMockFetch(
        new Map([['PUT /contacts/contact_123', { status: 200, body: updatedContact }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const contact = await client.contacts.update('contact_123', {
        custom_attributes: { plan: 'enterprise' },
      })

      expect(contact.custom_attributes.plan).toBe('enterprise')
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

    it('should support pagination', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /contacts',
            {
              status: 200,
              body: {
                type: 'list',
                data: [mockContact()],
                total_count: 100,
                pages: {
                  type: 'pages',
                  page: 1,
                  per_page: 50,
                  total_pages: 2,
                  next: { page: 2, starting_after: 'contact_123' },
                },
              },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const result = await client.contacts.list({ per_page: 50 })

      expect(result.pages.total_pages).toBe(2)
      expect(result.pages.next).toBeDefined()
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

  describe('archive', () => {
    it('should archive a contact', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /contacts/contact_123/archive',
            {
              status: 200,
              body: { type: 'contact', id: 'contact_123', archived: true },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const result = await client.contacts.archive('contact_123')

      expect(result.archived).toBe(true)
      expect(result.id).toBe('contact_123')
    })
  })

  describe('unarchive', () => {
    it('should unarchive a contact', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /contacts/contact_123/unarchive',
            {
              status: 200,
              body: { type: 'contact', id: 'contact_123', archived: false },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const result = await client.contacts.unarchive('contact_123')

      expect(result.archived).toBe(false)
      expect(result.id).toBe('contact_123')
    })
  })

  describe('findByEmail', () => {
    it('should find a contact by email', async () => {
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
      const contact = await client.contacts.findByEmail('user@example.com')

      expect(contact?.email).toBe('user@example.com')
    })

    it('should return null when not found', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /contacts/search',
            {
              status: 200,
              body: {
                type: 'list',
                data: [],
                total_count: 0,
                pages: { type: 'pages', page: 1, per_page: 50, total_pages: 0 },
              },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const contact = await client.contacts.findByEmail('notfound@example.com')

      expect(contact).toBeNull()
    })
  })

  describe('findByExternalId', () => {
    it('should find a contact by external ID', async () => {
      const expectedContact = mockContact({ external_id: 'ext_user_123' })
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
      const contact = await client.contacts.findByExternalId('ext_user_123')

      expect(contact?.external_id).toBe('ext_user_123')
    })
  })

  describe('convertToUser', () => {
    it('should convert a lead to a user', async () => {
      const convertedContact = mockContact({ role: 'user' })
      const mockFetch = createMockFetch(
        new Map([['POST /contacts/lead_123/convert', { status: 200, body: convertedContact }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const contact = await client.contacts.convertToUser('lead_123', {})

      expect(contact.role).toBe('user')
    })

    it('should convert a lead and merge with existing user', async () => {
      const mergedContact = mockContact({ id: 'user_456', role: 'user' })
      const mockFetch = createMockFetch(
        new Map([['POST /contacts/lead_123/convert', { status: 200, body: mergedContact }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const contact = await client.contacts.convertToUser('lead_123', {
        user: { id: 'user_456' },
      })

      expect(contact.id).toBe('user_456')
    })
  })

  describe('tags', () => {
    it('should add a tag to a contact', async () => {
      const mockTag = { type: 'tag' as const, id: 'tag_123', name: 'VIP' }
      const mockFetch = createMockFetch(
        new Map([['POST /contacts/contact_123/tags', { status: 200, body: mockTag }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const tag = await client.contacts.tags.add('contact_123', { id: 'tag_123' })

      expect(tag.id).toBe('tag_123')
      expect(tag.name).toBe('VIP')
    })

    it('should remove a tag from a contact', async () => {
      const mockTag = { type: 'tag' as const, id: 'tag_123', name: 'VIP' }
      const mockFetch = createMockFetch(
        new Map([['DELETE /contacts/contact_123/tags/tag_123', { status: 200, body: mockTag }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const tag = await client.contacts.tags.remove('contact_123', 'tag_123')

      expect(tag.id).toBe('tag_123')
    })

    it('should list tags on a contact', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /contacts/contact_123/tags',
            {
              status: 200,
              body: {
                type: 'list',
                data: [
                  { type: 'tag', id: 'tag_123', name: 'VIP' },
                  { type: 'tag', id: 'tag_456', name: 'Enterprise' },
                ],
                total_count: 2,
                pages: { type: 'pages', page: 1, per_page: 50, total_pages: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const result = await client.contacts.tags.list('contact_123')

      expect(result.data).toHaveLength(2)
      expect(result.data[0].name).toBe('VIP')
    })
  })

  describe('companies', () => {
    it('should attach a contact to a company', async () => {
      const mockCompany = {
        type: 'company' as const,
        id: 'company_123',
        company_id: 'acme',
        name: 'Acme Inc',
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
        remote_created_at: null,
        size: 50,
        website: 'https://acme.com',
        industry: 'Technology',
        monthly_spend: 5000,
        session_count: 100,
        user_count: 10,
        custom_attributes: {},
        tags: { type: 'list' as const, data: [] },
        segments: { type: 'list' as const, data: [] },
      }
      const mockFetch = createMockFetch(
        new Map([['POST /contacts/contact_123/companies', { status: 200, body: mockCompany }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const company = await client.contacts.companies.attach('contact_123', { id: 'company_123' })

      expect(company.id).toBe('company_123')
      expect(company.name).toBe('Acme Inc')
    })

    it('should detach a contact from a company', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'DELETE /contacts/contact_123/companies/company_123',
            {
              status: 200,
              body: { type: 'company', id: 'company_123', deleted: true },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const result = await client.contacts.companies.detach('contact_123', 'company_123')

      expect(result.deleted).toBe(true)
      expect(result.id).toBe('company_123')
    })

    it('should list companies for a contact', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /contacts/contact_123/companies',
            {
              status: 200,
              body: {
                type: 'list',
                data: [
                  { type: 'company', id: 'company_123', name: 'Acme Inc' },
                  { type: 'company', id: 'company_456', name: 'Beta Corp' },
                ],
                total_count: 2,
                pages: { type: 'pages', page: 1, per_page: 50, total_pages: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const result = await client.contacts.companies.list('contact_123')

      expect(result.data).toHaveLength(2)
      expect(result.data[0].name).toBe('Acme Inc')
    })
  })

  describe('notes', () => {
    it('should create a note on a contact', async () => {
      const mockNote = {
        type: 'note' as const,
        id: 'note_123',
        created_at: Math.floor(Date.now() / 1000),
        body: 'VIP customer - handle with care',
        author: {
          type: 'admin' as const,
          id: 'admin_123',
          name: 'Support Agent',
        },
      }
      const mockFetch = createMockFetch(
        new Map([['POST /contacts/contact_123/notes', { status: 200, body: mockNote }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const note = await client.contacts.notes.create('contact_123', {
        body: 'VIP customer - handle with care',
        admin_id: 'admin_123',
      })

      expect(note.id).toBe('note_123')
      expect(note.body).toBe('VIP customer - handle with care')
    })

    it('should list notes on a contact', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /contacts/contact_123/notes',
            {
              status: 200,
              body: {
                type: 'list',
                data: [
                  { type: 'note', id: 'note_123', body: 'First note', created_at: 1000, author: { type: 'admin', id: 'admin_123' } },
                  { type: 'note', id: 'note_456', body: 'Second note', created_at: 2000, author: { type: 'admin', id: 'admin_123' } },
                ],
                total_count: 2,
                pages: { type: 'pages', page: 1, per_page: 50, total_pages: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const result = await client.contacts.notes.list('contact_123')

      expect(result.data).toHaveLength(2)
      expect(result.data[0].body).toBe('First note')
    })
  })

  describe('segments', () => {
    it('should list segments for a contact', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /contacts/contact_123/segments',
            {
              status: 200,
              body: {
                type: 'list',
                data: [
                  { type: 'segment', id: 'segment_123', name: 'Active Users', created_at: 1000, updated_at: 2000, person_type: 'user' },
                  { type: 'segment', id: 'segment_456', name: 'Premium', created_at: 1000, updated_at: 2000, person_type: 'user' },
                ],
                total_count: 2,
                pages: { type: 'pages', page: 1, per_page: 50, total_pages: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const result = await client.contacts.segments.list('contact_123')

      expect(result.data).toHaveLength(2)
      expect(result.data[0].name).toBe('Active Users')
    })
  })

  describe('subscriptions', () => {
    it('should list subscriptions for a contact', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /contacts/contact_123/subscriptions',
            {
              status: 200,
              body: {
                type: 'list',
                data: [
                  { id: 'sub_123', consent_type: 'opt_in', status: 'subscribed' },
                  { id: 'sub_456', consent_type: 'opt_out', status: 'unsubscribed' },
                ],
                total_count: 2,
                pages: { type: 'pages', page: 1, per_page: 50, total_pages: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const result = await client.contacts.subscriptions.list('contact_123')

      expect(result.data).toHaveLength(2)
      expect(result.data[0].status).toBe('subscribed')
    })

    it('should update subscription for a contact', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'PUT /contacts/contact_123/subscriptions/sub_123',
            {
              status: 200,
              body: { id: 'sub_123', consent_type: 'opt_out', status: 'unsubscribed' },
            },
          ],
        ])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const result = await client.contacts.subscriptions.update('contact_123', 'sub_123', {
        consent_type: 'opt_out',
      })

      expect(result.consent_type).toBe('opt_out')
      expect(result.status).toBe('unsubscribed')
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

    it('should reply as a user', async () => {
      const expectedConversation = mockConversation()
      const mockFetch = createMockFetch(
        new Map([['POST /conversations/conv_123/reply', { status: 200, body: expectedConversation }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const conversation = await client.conversations.reply({
        id: 'conv_123',
        type: 'user',
        intercom_user_id: 'contact_123',
        body: 'Thanks for the help!',
      })

      expect(conversation.id).toBe('conv_123')
    })

    it('should add a note to a conversation', async () => {
      const expectedConversation = mockConversation()
      const mockFetch = createMockFetch(
        new Map([['POST /conversations/conv_123/reply', { status: 200, body: expectedConversation }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const conversation = await client.conversations.reply({
        id: 'conv_123',
        type: 'admin',
        admin_id: 'admin_123',
        body: 'Internal note: VIP customer',
        message_type: 'note',
      })

      expect(conversation.id).toBe('conv_123')
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

    it('should assign a conversation to a team', async () => {
      const assignedConversation = mockConversation({ team_assignee_id: 'team_123' })
      const mockFetch = createMockFetch(
        new Map([['POST /conversations/conv_123/parts', { status: 200, body: assignedConversation }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const conversation = await client.conversations.assign({
        id: 'conv_123',
        admin_id: 'admin_123',
        assignee_id: 'team_123',
        type: 'team',
      })

      expect(conversation.team_assignee_id).toBe('team_123')
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

  describe('search', () => {
    it('should search conversations', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /conversations/search',
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
      const result = await client.conversations.search({
        query: {
          field: 'state',
          operator: '=',
          value: 'open',
        },
      })

      expect(result.conversations).toHaveLength(1)
    })
  })

  describe('addTag', () => {
    it('should add a tag to a conversation', async () => {
      const mockTag = { type: 'tag' as const, id: 'tag_456', name: 'VIP' }
      const mockFetch = createMockFetch(
        new Map([['POST /conversations/conv_123/tags', { status: 200, body: mockTag }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const tag = await client.conversations.addTag({
        id: 'conv_123',
        admin_id: 'admin_123',
        tag_id: 'tag_456',
      })

      expect(tag.id).toBe('tag_456')
      expect(tag.type).toBe('tag')
    })
  })

  describe('removeTag', () => {
    it('should remove a tag from a conversation', async () => {
      const mockTag = { type: 'tag' as const, id: 'tag_456', name: 'VIP' }
      const mockFetch = createMockFetch(
        new Map([['DELETE /conversations/conv_123/tags/tag_456', { status: 200, body: mockTag }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const tag = await client.conversations.removeTag({
        id: 'conv_123',
        admin_id: 'admin_123',
        tag_id: 'tag_456',
      })

      expect(tag.id).toBe('tag_456')
    })
  })

  describe('addNote', () => {
    it('should add an internal note to a conversation', async () => {
      const expectedConversation = mockConversation()
      const mockFetch = createMockFetch(
        new Map([['POST /conversations/conv_123/reply', { status: 200, body: expectedConversation }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const conversation = await client.conversations.addNote({
        id: 'conv_123',
        admin_id: 'admin_123',
        body: 'VIP customer - handle with care',
      })

      expect(conversation.id).toBe('conv_123')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/conversations/conv_123/reply'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"message_type":"note"'),
        })
      )
    })
  })

  describe('setPriority', () => {
    it('should set a conversation as priority', async () => {
      const priorityConversation = mockConversation({ priority: 'priority' })
      const mockFetch = createMockFetch(
        new Map([['PUT /conversations/conv_123', { status: 200, body: priorityConversation }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const conversation = await client.conversations.setPriority({
        id: 'conv_123',
        admin_id: 'admin_123',
        priority: 'priority',
      })

      expect(conversation.priority).toBe('priority')
    })

    it('should remove priority from a conversation', async () => {
      const notPriorityConversation = mockConversation({ priority: 'not_priority' })
      const mockFetch = createMockFetch(
        new Map([['PUT /conversations/conv_123', { status: 200, body: notPriorityConversation }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const conversation = await client.conversations.setPriority({
        id: 'conv_123',
        admin_id: 'admin_123',
        priority: 'not_priority',
      })

      expect(conversation.priority).toBe('not_priority')
    })
  })

  describe('redact', () => {
    it('should redact a conversation part', async () => {
      const expectedConversation = mockConversation()
      const mockFetch = createMockFetch(
        new Map([['POST /conversations/redact', { status: 200, body: expectedConversation }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const conversation = await client.conversations.redact({
        type: 'conversation_part',
        conversation_id: 'conv_123',
        conversation_part_id: 'part_456',
      })

      expect(conversation.id).toBe('conv_123')
    })
  })

  describe('runAssignmentRules', () => {
    it('should run assignment rules on a conversation', async () => {
      const expectedConversation = mockConversation({ admin_assignee_id: 'admin_auto' })
      const mockFetch = createMockFetch(
        new Map([['POST /conversations/conv_123/run_assignment_rules', { status: 200, body: expectedConversation }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const conversation = await client.conversations.runAssignmentRules('conv_123')

      expect(conversation.admin_assignee_id).toBe('admin_auto')
    })
  })

  describe('attachContact', () => {
    it('should attach a contact to a conversation', async () => {
      const expectedConversation = mockConversation()
      const mockFetch = createMockFetch(
        new Map([['POST /conversations/conv_123/customers', { status: 200, body: expectedConversation }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const conversation = await client.conversations.attachContact({
        id: 'conv_123',
        admin_id: 'admin_123',
        customer: { intercom_user_id: 'contact_456' },
      })

      expect(conversation.id).toBe('conv_123')
    })
  })

  describe('detachContact', () => {
    it('should detach a contact from a conversation', async () => {
      const expectedConversation = mockConversation()
      const mockFetch = createMockFetch(
        new Map([['DELETE /conversations/conv_123/customers/contact_456', { status: 200, body: expectedConversation }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const conversation = await client.conversations.detachContact({
        id: 'conv_123',
        admin_id: 'admin_123',
        contact_id: 'contact_456',
      })

      expect(conversation.id).toBe('conv_123')
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

    it('should send a message with template', async () => {
      const expectedMessage = mockMessage()
      const mockFetch = createMockFetch(
        new Map([['POST /messages', { status: 200, body: expectedMessage }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const message = await client.messages.create({
        message_type: 'inapp',
        template: 'personal',
        body: 'Hi {{name}}, welcome!',
        from: { type: 'admin', id: 'admin_123' },
        to: { type: 'user', id: 'contact_123' },
      })

      expect(message.id).toBe('msg_123')
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

    it('should track an event with email', async () => {
      const mockFetch = createMockFetch(
        new Map([['POST /events', { status: 202, body: {} }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      await client.events.create({
        event_name: 'page-viewed',
        email: 'user@example.com',
        metadata: { page: '/pricing' },
      })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('should track an event with created_at', async () => {
      const mockFetch = createMockFetch(
        new Map([['POST /events', { status: 202, body: {} }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const createdAt = Math.floor(Date.now() / 1000) - 3600
      await client.events.create({
        event_name: 'signup',
        user_id: 'contact_123',
        created_at: createdAt,
      })

      expect(mockFetch).toHaveBeenCalled()
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
                events: [mockEvent()],
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

    it('should create a draft article', async () => {
      const expectedArticle = mockArticle({ state: 'draft' })
      const mockFetch = createMockFetch(
        new Map([['POST /articles', { status: 200, body: expectedArticle }]])
      )

      const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
      const article = await client.articles.create({
        title: 'Work in Progress',
        author_id: 'admin_123',
        body: '<p>Draft content...</p>',
        state: 'draft',
      })

      expect(article.state).toBe('draft')
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

    it('should search articles in specific help center', async () => {
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
        phrase: 'guide',
        help_center_id: 'hc_123',
      })

      expect(result.articles.data).toHaveLength(1)
    })
  })
})

// =============================================================================
// Request Options Tests
// =============================================================================

describe('@dotdo/intercom - Request Options', () => {
  it('should pass custom headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => mockContact(),
    })

    const client = new Client({ tokenAuth: { token: 'test' }, fetch: mockFetch })
    await client.contacts.find('contact_123')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        }),
      })
    )
  })

  it('should include API version header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => mockContact(),
    })

    const client = new Client({
      tokenAuth: { token: 'test' },
      apiVersion: '2.11',
      fetch: mockFetch,
    })
    await client.contacts.find('contact_123')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Intercom-Version': '2.11',
        }),
      })
    )
  })
})
