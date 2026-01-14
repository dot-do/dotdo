/**
 * @dotdo/zendesk - Zendesk API Compatibility Layer Tests
 *
 * Tests for the Zendesk API compatibility layer including:
 * - Client initialization
 * - Tickets (create, get, update, delete, list, search)
 * - Users (create, get, update, search, merge)
 * - Organizations (create, get, update, list)
 * - Comments (add, list)
 * - Attachments (upload, get)
 * - Triggers/Automations (list, create)
 * - Local/in-memory backend (ZendeskLocal)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Client,
  ZendeskError,
  ZendeskLocal,
  type Ticket,
  type User,
  type Organization,
  type Comment,
  type Attachment,
  type Trigger,
  type Automation,
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
          error: 'RecordNotFound',
          description: `No mock for ${key}`,
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

function mockTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 123,
    url: 'https://mycompany.zendesk.com/api/v2/tickets/123.json',
    external_id: null,
    type: 'incident',
    subject: 'Help needed',
    raw_subject: 'Help needed',
    description: 'I need help with...',
    priority: 'high',
    status: 'open',
    recipient: null,
    requester_id: 456,
    submitter_id: 456,
    assignee_id: null,
    organization_id: null,
    group_id: null,
    collaborator_ids: [],
    follower_ids: [],
    email_cc_ids: [],
    forum_topic_id: null,
    problem_id: null,
    has_incidents: false,
    is_public: true,
    due_at: null,
    tags: [],
    custom_fields: [],
    satisfaction_rating: null,
    sharing_agreement_ids: [],
    fields: [],
    followup_ids: [],
    brand_id: null,
    allow_channelback: false,
    allow_attachments: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function mockUser(overrides: Partial<User> = {}): User {
  return {
    id: 456,
    url: 'https://mycompany.zendesk.com/api/v2/users/456.json',
    name: 'John Doe',
    email: 'john@example.com',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    time_zone: 'America/New_York',
    iana_time_zone: 'America/New_York',
    phone: null,
    shared_phone_number: null,
    photo: null,
    locale_id: 1,
    locale: 'en-US',
    organization_id: null,
    role: 'end-user',
    verified: true,
    external_id: null,
    tags: [],
    alias: null,
    active: true,
    shared: false,
    shared_agent: false,
    last_login_at: null,
    two_factor_auth_enabled: null,
    signature: null,
    details: null,
    notes: null,
    role_type: null,
    custom_role_id: null,
    moderator: false,
    ticket_restriction: 'requested',
    only_private_comments: false,
    restricted_agent: false,
    suspended: false,
    default_group_id: null,
    report_csv: false,
    user_fields: {},
    ...overrides,
  }
}

function mockOrganization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 789,
    url: 'https://mycompany.zendesk.com/api/v2/organizations/789.json',
    name: 'Acme Inc',
    shared_tickets: false,
    shared_comments: false,
    external_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    domain_names: ['acme.com'],
    details: null,
    notes: null,
    group_id: null,
    tags: [],
    organization_fields: {},
    ...overrides,
  }
}

function mockComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 1001,
    type: 'Comment',
    body: 'Here is an update...',
    html_body: '<p>Here is an update...</p>',
    plain_body: 'Here is an update...',
    public: true,
    author_id: 456,
    attachments: [],
    audit_id: 12345,
    via: {
      channel: 'api',
      source: {
        from: {},
        to: {},
        rel: null,
      },
    },
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function mockAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 2001,
    url: 'https://mycompany.zendesk.com/api/v2/attachments/2001.json',
    file_name: 'screenshot.png',
    content_url: 'https://mycompany.zendesk.com/attachments/token/xxx/screenshot.png',
    content_type: 'image/png',
    size: 12345,
    thumbnails: [],
    inline: false,
    ...overrides,
  }
}

function mockTrigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: 3001,
    url: 'https://mycompany.zendesk.com/api/v2/triggers/3001.json',
    title: 'Auto-assign urgent tickets',
    active: true,
    position: 1,
    conditions: {
      all: [{ field: 'priority', operator: 'is', value: 'urgent' }],
      any: [],
    },
    actions: [{ field: 'assignee_id', value: '456' }],
    description: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function mockAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 4001,
    url: 'https://mycompany.zendesk.com/api/v2/automations/4001.json',
    title: 'Close stale tickets',
    active: true,
    position: 1,
    conditions: {
      all: [{ field: 'status', operator: 'is', value: 'pending' }],
      any: [],
    },
    actions: [{ field: 'status', value: 'closed' }],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

// =============================================================================
// Client Tests
// =============================================================================

describe('@dotdo/zendesk - Client', () => {
  describe('initialization', () => {
    it('should create a client with subdomain and token auth', () => {
      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
      })
      expect(client).toBeDefined()
      expect(client.tickets).toBeDefined()
      expect(client.users).toBeDefined()
      expect(client.organizations).toBeDefined()
      expect(client.attachments).toBeDefined()
      expect(client.triggers).toBeDefined()
      expect(client.automations).toBeDefined()
    })

    it('should throw error without subdomain', () => {
      expect(() => new Client({ email: 'admin@example.com', token: 'api_token' } as any)).toThrow(
        'Subdomain is required'
      )
    })

    it('should throw error without authentication', () => {
      expect(() => new Client({ subdomain: 'mycompany' } as any)).toThrow(
        'Authentication is required'
      )
    })

    it('should accept password authentication', () => {
      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        password: 'secret123',
      })
      expect(client).toBeDefined()
    })

    it('should accept OAuth token authentication', () => {
      const client = new Client({
        subdomain: 'mycompany',
        oauthToken: 'oauth_token_123',
      })
      expect(client).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('should throw ZendeskError on API errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/tickets/nonexistent',
            {
              status: 404,
              body: {
                error: 'RecordNotFound',
                description: 'Ticket not found',
              },
            },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      await expect(client.tickets.get(999999)).rejects.toThrow(ZendeskError)

      try {
        await client.tickets.get(999999)
      } catch (error) {
        expect(error).toBeInstanceOf(ZendeskError)
        const zendeskError = error as ZendeskError
        expect(zendeskError.error).toBe('RecordNotFound')
        expect(zendeskError.statusCode).toBe(404)
      }
    })
  })
})

// =============================================================================
// Tickets Tests
// =============================================================================

describe('@dotdo/zendesk - Tickets', () => {
  describe('create', () => {
    it('should create a ticket', async () => {
      const expectedTicket = mockTicket()
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/tickets', { status: 201, body: { ticket: expectedTicket } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const ticket = await client.tickets.create({
        subject: 'Help needed',
        description: 'I need help with...',
        priority: 'high',
        type: 'incident',
        requester: { email: 'user@example.com' },
      })

      expect(ticket.id).toBe(123)
      expect(ticket.subject).toBe('Help needed')
      expect(ticket.priority).toBe('high')
    })

    it('should create a ticket with custom fields', async () => {
      const expectedTicket = mockTicket({
        custom_fields: [{ id: 1234, value: 'custom_value' }],
      })
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/tickets', { status: 201, body: { ticket: expectedTicket } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const ticket = await client.tickets.create({
        subject: 'Help needed',
        description: 'I need help',
        custom_fields: [{ id: 1234, value: 'custom_value' }],
      })

      expect(ticket.custom_fields).toHaveLength(1)
      expect(ticket.custom_fields[0].value).toBe('custom_value')
    })

    it('should create a ticket with tags', async () => {
      const expectedTicket = mockTicket({ tags: ['urgent', 'billing'] })
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/tickets', { status: 201, body: { ticket: expectedTicket } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const ticket = await client.tickets.create({
        subject: 'Billing issue',
        description: 'Problem with billing',
        tags: ['urgent', 'billing'],
      })

      expect(ticket.tags).toContain('urgent')
      expect(ticket.tags).toContain('billing')
    })
  })

  describe('get', () => {
    it('should get a ticket by id', async () => {
      const expectedTicket = mockTicket()
      const mockFetch = createMockFetch(
        new Map([['GET /api/v2/tickets/123', { status: 200, body: { ticket: expectedTicket } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const ticket = await client.tickets.get(123)
      expect(ticket.id).toBe(123)
      expect(ticket.subject).toBe('Help needed')
    })
  })

  describe('update', () => {
    it('should update a ticket', async () => {
      const expectedTicket = mockTicket({ status: 'solved', priority: 'low' })
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/tickets/123', { status: 200, body: { ticket: expectedTicket } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const ticket = await client.tickets.update(123, {
        status: 'solved',
        priority: 'low',
      })

      expect(ticket.status).toBe('solved')
      expect(ticket.priority).toBe('low')
    })
  })

  describe('delete', () => {
    it('should delete a ticket', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /api/v2/tickets/123', { status: 204, body: {} }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      await expect(client.tickets.delete(123)).resolves.toBeUndefined()
    })
  })

  describe('list', () => {
    it('should list tickets', async () => {
      const tickets = [mockTicket({ id: 1 }), mockTicket({ id: 2 })]
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/tickets',
            {
              status: 200,
              body: { tickets, count: 2, next_page: null, previous_page: null },
            },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const response = await client.tickets.list()
      expect(response.tickets).toHaveLength(2)
      expect(response.count).toBe(2)
    })
  })

  describe('search', () => {
    it('should search tickets', async () => {
      const tickets = [mockTicket({ priority: 'urgent' })]
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/search',
            {
              status: 200,
              body: { results: tickets, count: 1, next_page: null, previous_page: null, facets: null },
            },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const response = await client.tickets.search('priority:urgent')
      expect(response.results).toHaveLength(1)
      expect(response.results[0].priority).toBe('urgent')
    })
  })

  describe('comments', () => {
    it('should create a comment on a ticket', async () => {
      const expectedTicket = mockTicket()
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/tickets/123', { status: 200, body: { ticket: expectedTicket } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const ticket = await client.tickets.createComment(123, {
        body: 'Here is an update...',
        public: true,
      })

      expect(ticket.id).toBe(123)
    })

    it('should list comments for a ticket', async () => {
      const comments = [mockComment()]
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/tickets/123/comments',
            {
              status: 200,
              body: { comments, count: 1, next_page: null, previous_page: null },
            },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const response = await client.tickets.listComments(123)
      expect(response.comments).toHaveLength(1)
      expect(response.comments[0].body).toBe('Here is an update...')
    })
  })
})

// =============================================================================
// Users Tests
// =============================================================================

describe('@dotdo/zendesk - Users', () => {
  describe('create', () => {
    it('should create a user', async () => {
      const expectedUser = mockUser()
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/users', { status: 201, body: { user: expectedUser } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const user = await client.users.create({
        name: 'John Doe',
        email: 'john@example.com',
        role: 'end-user',
      })

      expect(user.id).toBe(456)
      expect(user.name).toBe('John Doe')
      expect(user.email).toBe('john@example.com')
    })
  })

  describe('get', () => {
    it('should get a user by id', async () => {
      const expectedUser = mockUser()
      const mockFetch = createMockFetch(
        new Map([['GET /api/v2/users/456', { status: 200, body: { user: expectedUser } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const user = await client.users.get(456)
      expect(user.id).toBe(456)
      expect(user.name).toBe('John Doe')
    })
  })

  describe('update', () => {
    it('should update a user', async () => {
      const expectedUser = mockUser({ name: 'Jane Doe' })
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/users/456', { status: 200, body: { user: expectedUser } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const user = await client.users.update(456, { name: 'Jane Doe' })
      expect(user.name).toBe('Jane Doe')
    })
  })

  describe('delete', () => {
    it('should delete a user', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /api/v2/users/456', { status: 204, body: {} }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      await expect(client.users.delete(456)).resolves.toBeUndefined()
    })
  })

  describe('list', () => {
    it('should list users', async () => {
      const users = [mockUser({ id: 1 }), mockUser({ id: 2 })]
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/users',
            {
              status: 200,
              body: { users, count: 2, next_page: null, previous_page: null },
            },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const response = await client.users.list()
      expect(response.users).toHaveLength(2)
      expect(response.count).toBe(2)
    })
  })

  describe('search', () => {
    it('should search users', async () => {
      const users = [mockUser()]
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/users/search',
            {
              status: 200,
              body: { users, count: 1, next_page: null, previous_page: null },
            },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const response = await client.users.search({ query: 'john@example.com' })
      expect(response.users).toHaveLength(1)
      expect(response.users[0].email).toBe('john@example.com')
    })
  })

  describe('merge', () => {
    it('should merge two users', async () => {
      const expectedUser = mockUser()
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/users/456/merge', { status: 200, body: { user: expectedUser } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const user = await client.users.merge(456, 789)
      expect(user.id).toBe(456)
    })
  })
})

// =============================================================================
// Organizations Tests
// =============================================================================

describe('@dotdo/zendesk - Organizations', () => {
  describe('create', () => {
    it('should create an organization', async () => {
      const expectedOrg = mockOrganization()
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/organizations', { status: 201, body: { organization: expectedOrg } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const org = await client.organizations.create({
        name: 'Acme Inc',
        domain_names: ['acme.com'],
      })

      expect(org.id).toBe(789)
      expect(org.name).toBe('Acme Inc')
      expect(org.domain_names).toContain('acme.com')
    })
  })

  describe('get', () => {
    it('should get an organization by id', async () => {
      const expectedOrg = mockOrganization()
      const mockFetch = createMockFetch(
        new Map([['GET /api/v2/organizations/789', { status: 200, body: { organization: expectedOrg } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const org = await client.organizations.get(789)
      expect(org.id).toBe(789)
      expect(org.name).toBe('Acme Inc')
    })
  })

  describe('update', () => {
    it('should update an organization', async () => {
      const expectedOrg = mockOrganization({ name: 'Acme Corp' })
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/organizations/789', { status: 200, body: { organization: expectedOrg } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const org = await client.organizations.update(789, { name: 'Acme Corp' })
      expect(org.name).toBe('Acme Corp')
    })
  })

  describe('delete', () => {
    it('should delete an organization', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /api/v2/organizations/789', { status: 204, body: {} }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      await expect(client.organizations.delete(789)).resolves.toBeUndefined()
    })
  })

  describe('list', () => {
    it('should list organizations', async () => {
      const organizations = [mockOrganization({ id: 1 }), mockOrganization({ id: 2 })]
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/organizations',
            {
              status: 200,
              body: { organizations, count: 2, next_page: null, previous_page: null },
            },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const response = await client.organizations.list()
      expect(response.organizations).toHaveLength(2)
      expect(response.count).toBe(2)
    })
  })
})

// =============================================================================
// Attachments Tests
// =============================================================================

describe('@dotdo/zendesk - Attachments', () => {
  describe('upload', () => {
    it('should upload an attachment', async () => {
      const expectedAttachment = mockAttachment()
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /api/v2/uploads',
            {
              status: 201,
              body: { upload: { token: 'upload_token', attachment: expectedAttachment } },
            },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const response = await client.attachments.upload({
        filename: 'screenshot.png',
        contentType: 'image/png',
        data: new Uint8Array([1, 2, 3]),
      })

      expect(response.token).toBe('upload_token')
      expect(response.attachment.file_name).toBe('screenshot.png')
    })
  })

  describe('get', () => {
    it('should get an attachment by id', async () => {
      const expectedAttachment = mockAttachment()
      const mockFetch = createMockFetch(
        new Map([['GET /api/v2/attachments/2001', { status: 200, body: { attachment: expectedAttachment } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const attachment = await client.attachments.get(2001)
      expect(attachment.id).toBe(2001)
      expect(attachment.file_name).toBe('screenshot.png')
    })
  })
})

// =============================================================================
// Triggers Tests
// =============================================================================

describe('@dotdo/zendesk - Triggers', () => {
  describe('list', () => {
    it('should list triggers', async () => {
      const triggers = [mockTrigger()]
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/triggers',
            {
              status: 200,
              body: { triggers, count: 1, next_page: null, previous_page: null },
            },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const response = await client.triggers.list()
      expect(response.triggers).toHaveLength(1)
      expect(response.triggers[0].title).toBe('Auto-assign urgent tickets')
    })
  })

  describe('create', () => {
    it('should create a trigger', async () => {
      const expectedTrigger = mockTrigger()
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/triggers', { status: 201, body: { trigger: expectedTrigger } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const trigger = await client.triggers.create({
        title: 'Auto-assign urgent tickets',
        conditions: {
          all: [{ field: 'priority', operator: 'is', value: 'urgent' }],
          any: [],
        },
        actions: [{ field: 'assignee_id', value: '456' }],
      })

      expect(trigger.id).toBe(3001)
      expect(trigger.title).toBe('Auto-assign urgent tickets')
    })
  })
})

// =============================================================================
// Automations Tests
// =============================================================================

describe('@dotdo/zendesk - Automations', () => {
  describe('list', () => {
    it('should list automations', async () => {
      const automations = [mockAutomation()]
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/automations',
            {
              status: 200,
              body: { automations, count: 1, next_page: null, previous_page: null },
            },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const response = await client.automations.list()
      expect(response.automations).toHaveLength(1)
      expect(response.automations[0].title).toBe('Close stale tickets')
    })
  })
})

// =============================================================================
// ZendeskLocal Tests (In-Memory Backend)
// =============================================================================

describe('@dotdo/zendesk - ZendeskLocal', () => {
  let client: ZendeskLocal

  beforeEach(() => {
    client = new ZendeskLocal({ subdomain: 'test-company' })
  })

  describe('tickets', () => {
    it('should create a ticket', async () => {
      const ticket = await client.tickets.create({
        subject: 'Test ticket',
        description: 'Test description',
        priority: 'high',
      })

      expect(ticket.id).toBeDefined()
      expect(ticket.subject).toBe('Test ticket')
      expect(ticket.description).toBe('Test description')
      expect(ticket.priority).toBe('high')
      expect(ticket.status).toBe('new')
    })

    it('should get a ticket by id', async () => {
      const created = await client.tickets.create({
        subject: 'Test ticket',
        description: 'Test description',
      })

      const ticket = await client.tickets.get(created.id)
      expect(ticket.id).toBe(created.id)
      expect(ticket.subject).toBe('Test ticket')
    })

    it('should update a ticket', async () => {
      const created = await client.tickets.create({
        subject: 'Test ticket',
        description: 'Test description',
      })

      const updated = await client.tickets.update(created.id, {
        status: 'open',
        priority: 'urgent',
      })

      expect(updated.status).toBe('open')
      expect(updated.priority).toBe('urgent')
    })

    it('should delete a ticket', async () => {
      const created = await client.tickets.create({
        subject: 'Test ticket',
        description: 'Test description',
      })

      await client.tickets.delete(created.id)

      await expect(client.tickets.get(created.id)).rejects.toThrow()
    })

    it('should list tickets', async () => {
      await client.tickets.create({ subject: 'Ticket 1', description: 'Desc 1' })
      await client.tickets.create({ subject: 'Ticket 2', description: 'Desc 2' })

      const response = await client.tickets.list()
      expect(response.tickets.length).toBeGreaterThanOrEqual(2)
    })

    it('should search tickets', async () => {
      await client.tickets.create({
        subject: 'Urgent billing issue',
        description: 'Billing problem',
        priority: 'urgent',
      })
      await client.tickets.create({
        subject: 'Normal support',
        description: 'Support request',
        priority: 'normal',
      })

      const response = await client.tickets.search('priority:urgent')
      expect(response.results.every((t) => t.priority === 'urgent')).toBe(true)
    })

    it('should add comments to tickets', async () => {
      const ticket = await client.tickets.create({
        subject: 'Test ticket',
        description: 'Test description',
      })

      const comment = await client.tickets.addComment(ticket.id, {
        body: 'This is a comment',
        public: true,
      })

      expect(comment.body).toBe('This is a comment')
      expect(comment.public).toBe(true)
    })

    it('should list comments for a ticket', async () => {
      const ticket = await client.tickets.create({
        subject: 'Test ticket',
        description: 'Test description',
      })

      await client.tickets.addComment(ticket.id, { body: 'Comment 1' })
      await client.tickets.addComment(ticket.id, { body: 'Comment 2' })

      const response = await client.tickets.listComments(ticket.id)
      expect(response.comments.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('users', () => {
    it('should create a user', async () => {
      const user = await client.users.create({
        name: 'John Doe',
        email: 'john@example.com',
        role: 'end-user',
      })

      expect(user.id).toBeDefined()
      expect(user.name).toBe('John Doe')
      expect(user.email).toBe('john@example.com')
    })

    it('should get a user by id', async () => {
      const created = await client.users.create({
        name: 'Jane Doe',
        email: 'jane@example.com',
      })

      const user = await client.users.get(created.id)
      expect(user.id).toBe(created.id)
      expect(user.name).toBe('Jane Doe')
    })

    it('should update a user', async () => {
      const created = await client.users.create({
        name: 'John Doe',
        email: 'john@example.com',
      })

      const updated = await client.users.update(created.id, {
        name: 'John Smith',
      })

      expect(updated.name).toBe('John Smith')
    })

    it('should delete a user', async () => {
      const created = await client.users.create({
        name: 'To Delete',
        email: 'delete@example.com',
      })

      await client.users.delete(created.id)

      await expect(client.users.get(created.id)).rejects.toThrow()
    })

    it('should search users', async () => {
      await client.users.create({ name: 'Search Test', email: 'search@example.com' })

      const response = await client.users.search({ query: 'search@example.com' })
      expect(response.users.some((u) => u.email === 'search@example.com')).toBe(true)
    })

    it('should merge users', async () => {
      const user1 = await client.users.create({
        name: 'User One',
        email: 'user1@example.com',
        tags: ['tag1'],
      })
      const user2 = await client.users.create({
        name: 'User Two',
        email: 'user2@example.com',
        tags: ['tag2'],
      })

      const merged = await client.users.merge(user1.id, user2.id)
      expect(merged.id).toBe(user1.id)
      expect(merged.tags).toContain('tag1')
      expect(merged.tags).toContain('tag2')
    })
  })

  describe('organizations', () => {
    it('should create an organization', async () => {
      const org = await client.organizations.create({
        name: 'Acme Inc',
        domain_names: ['acme.com'],
      })

      expect(org.id).toBeDefined()
      expect(org.name).toBe('Acme Inc')
      expect(org.domain_names).toContain('acme.com')
    })

    it('should get an organization by id', async () => {
      const created = await client.organizations.create({
        name: 'Test Corp',
      })

      const org = await client.organizations.get(created.id)
      expect(org.id).toBe(created.id)
      expect(org.name).toBe('Test Corp')
    })

    it('should update an organization', async () => {
      const created = await client.organizations.create({
        name: 'Old Name',
      })

      const updated = await client.organizations.update(created.id, {
        name: 'New Name',
      })

      expect(updated.name).toBe('New Name')
    })

    it('should delete an organization', async () => {
      const created = await client.organizations.create({
        name: 'To Delete Org',
      })

      await client.organizations.delete(created.id)

      await expect(client.organizations.get(created.id)).rejects.toThrow()
    })

    it('should list organizations', async () => {
      await client.organizations.create({ name: 'Org 1' })
      await client.organizations.create({ name: 'Org 2' })

      const response = await client.organizations.list()
      expect(response.organizations.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('triggers', () => {
    it('should create a trigger', async () => {
      const trigger = await client.triggers.create({
        title: 'Auto-assign urgent',
        conditions: {
          all: [{ field: 'priority', operator: 'is', value: 'urgent' }],
          any: [],
        },
        actions: [{ field: 'assignee_id', value: '123' }],
      })

      expect(trigger.id).toBeDefined()
      expect(trigger.title).toBe('Auto-assign urgent')
      expect(trigger.active).toBe(true)
    })

    it('should list triggers', async () => {
      await client.triggers.create({
        title: 'Trigger 1',
        conditions: { all: [], any: [] },
        actions: [],
      })

      const response = await client.triggers.list()
      expect(response.triggers.length).toBeGreaterThanOrEqual(1)
    })

    it('should filter active triggers', async () => {
      await client.triggers.create({
        title: 'Active Trigger',
        conditions: { all: [], any: [] },
        actions: [],
        active: true,
      })
      await client.triggers.create({
        title: 'Inactive Trigger',
        conditions: { all: [], any: [] },
        actions: [],
        active: false,
      })

      const response = await client.triggers.listActive()
      expect(response.triggers.every((t) => t.active)).toBe(true)
    })
  })

  describe('attachments', () => {
    it('should upload an attachment', async () => {
      const response = await client.attachments.upload({
        filename: 'test.txt',
        contentType: 'text/plain',
        data: new TextEncoder().encode('test content'),
      })

      expect(response.token).toBeDefined()
      expect(response.attachment.file_name).toBe('test.txt')
    })

    it('should get an attachment by id', async () => {
      const uploaded = await client.attachments.upload({
        filename: 'test.txt',
        contentType: 'text/plain',
        data: new TextEncoder().encode('test content'),
      })

      const attachment = await client.attachments.get(uploaded.attachment.id)
      expect(attachment.id).toBe(uploaded.attachment.id)
      expect(attachment.file_name).toBe('test.txt')
    })
  })

  describe('groups', () => {
    it('should create a group', async () => {
      const group = await client.groups.create({
        name: 'Support Team',
        description: 'First-line support',
      })

      expect(group.id).toBeDefined()
      expect(group.name).toBe('Support Team')
    })

    it('should list groups', async () => {
      await client.groups.create({ name: 'Group 1' })

      const response = await client.groups.list()
      expect(response.groups.length).toBeGreaterThanOrEqual(1)
    })

    it('should add member to group', async () => {
      const group = await client.groups.create({ name: 'Test Group' })
      const user = await client.users.create({ name: 'Test User', email: 'test-group@example.com' })

      const membership = await client.groups.addMember(group.id, user.id)
      expect(membership.group_id).toBe(group.id)
      expect(membership.user_id).toBe(user.id)
    })
  })

  describe('views', () => {
    it('should create a view', async () => {
      const view = await client.views.create({
        title: 'Open Tickets',
        conditions: {
          all: [{ field: 'status', operator: 'is', value: 'open' }],
          any: [],
        },
      })

      expect(view.id).toBeDefined()
      expect(view.title).toBe('Open Tickets')
    })

    it('should get tickets from a view', async () => {
      // Create some tickets
      await client.tickets.create({
        subject: 'Open ticket',
        description: 'Test',
        status: 'open',
      })

      const view = await client.views.create({
        title: 'Open Tickets View',
        conditions: {
          all: [{ field: 'status', operator: 'is', value: 'open' }],
          any: [],
        },
      })

      const response = await client.views.tickets(view.id)
      expect(response.tickets.every((t) => t.status === 'open')).toBe(true)
    })
  })

  describe('macros', () => {
    it('should create a macro', async () => {
      const macro = await client.macros.create({
        title: 'Close as resolved',
        actions: [
          { field: 'status', value: 'solved' },
          { field: 'comment_value', value: 'Closing as resolved' },
        ],
      })

      expect(macro.id).toBeDefined()
      expect(macro.title).toBe('Close as resolved')
    })

    it('should search macros', async () => {
      await client.macros.create({
        title: 'Urgent Response',
        actions: [{ field: 'priority', value: 'urgent' }],
      })

      const response = await client.macros.search('Urgent')
      expect(response.macros.some((m) => m.title.includes('Urgent'))).toBe(true)
    })
  })
})
