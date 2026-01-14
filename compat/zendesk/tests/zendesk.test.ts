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
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Client,
  ZendeskError,
  type Ticket,
  type User,
  type Organization,
  type Comment,
  type Attachment,
  type Trigger,
  type Automation,
  type ListResponse,
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
    it('should get a ticket by ID', async () => {
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
      const updatedTicket = mockTicket({ status: 'pending' })
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/tickets/123', { status: 200, body: { ticket: updatedTicket } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const ticket = await client.tickets.update(123, {
        status: 'pending',
      })

      expect(ticket.status).toBe('pending')
    })

    it('should update ticket priority', async () => {
      const updatedTicket = mockTicket({ priority: 'urgent' })
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/tickets/123', { status: 200, body: { ticket: updatedTicket } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const ticket = await client.tickets.update(123, {
        priority: 'urgent',
      })

      expect(ticket.priority).toBe('urgent')
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

      await client.tickets.delete(123)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/tickets/123'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  describe('list', () => {
    it('should list tickets', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/tickets',
            {
              status: 200,
              body: {
                tickets: [mockTicket(), mockTicket({ id: 124 })],
                count: 2,
                next_page: null,
                previous_page: null,
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

      const result = await client.tickets.list()

      expect(result.tickets).toHaveLength(2)
      expect(result.count).toBe(2)
    })

    it('should list tickets with status filter', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/tickets',
            {
              status: 200,
              body: {
                tickets: [mockTicket({ status: 'open' })],
                count: 1,
                next_page: null,
                previous_page: null,
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

      const result = await client.tickets.list({ status: 'open' })

      expect(result.tickets).toHaveLength(1)
      expect(result.tickets[0].status).toBe('open')
    })

    it('should support pagination', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/tickets',
            {
              status: 200,
              body: {
                tickets: [mockTicket()],
                count: 100,
                next_page: 'https://mycompany.zendesk.com/api/v2/tickets?page=2',
                previous_page: null,
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

      const result = await client.tickets.list({ per_page: 25 })

      expect(result.count).toBe(100)
      expect(result.next_page).toBeDefined()
    })
  })

  describe('search', () => {
    it('should search tickets by query', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/search',
            {
              status: 200,
              body: {
                results: [mockTicket()],
                count: 1,
                next_page: null,
                previous_page: null,
                facets: null,
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

      const result = await client.tickets.search('status:open priority:high')

      expect(result.results).toHaveLength(1)
      expect(result.count).toBe(1)
    })

    it('should search tickets with type filter', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/search',
            {
              status: 200,
              body: {
                results: [mockTicket({ type: 'incident' })],
                count: 1,
                next_page: null,
                previous_page: null,
                facets: null,
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

      const result = await client.tickets.search('type:incident')

      expect(result.results).toHaveLength(1)
      expect(result.results[0].type).toBe('incident')
    })
  })

  describe('createComment', () => {
    it('should add a public comment to a ticket', async () => {
      const updatedTicket = mockTicket()
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/tickets/123', { status: 200, body: { ticket: updatedTicket } }]])
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
      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('comment'),
        })
      )
    })

    it('should add a private comment to a ticket', async () => {
      const updatedTicket = mockTicket()
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/tickets/123', { status: 200, body: { ticket: updatedTicket } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const ticket = await client.tickets.createComment(123, {
        body: 'Internal note',
        public: false,
      })

      expect(ticket.id).toBe(123)
    })
  })

  describe('listComments', () => {
    it('should list comments for a ticket', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/tickets/123/comments',
            {
              status: 200,
              body: {
                comments: [mockComment(), mockComment({ id: 1002 })],
                count: 2,
                next_page: null,
                previous_page: null,
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

      const result = await client.tickets.listComments(123)

      expect(result.comments).toHaveLength(2)
      expect(result.count).toBe(2)
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

    it('should create an agent user', async () => {
      const expectedUser = mockUser({ role: 'agent' })
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
        name: 'Agent Smith',
        email: 'agent@example.com',
        role: 'agent',
      })

      expect(user.role).toBe('agent')
    })
  })

  describe('get', () => {
    it('should get a user by ID', async () => {
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
      const updatedUser = mockUser({ name: 'Jane Doe' })
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/users/456', { status: 200, body: { user: updatedUser } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const user = await client.users.update(456, {
        name: 'Jane Doe',
      })

      expect(user.name).toBe('Jane Doe')
    })

    it('should update user fields', async () => {
      const updatedUser = mockUser({ user_fields: { department: 'Engineering' } })
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/users/456', { status: 200, body: { user: updatedUser } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const user = await client.users.update(456, {
        user_fields: { department: 'Engineering' },
      })

      expect(user.user_fields.department).toBe('Engineering')
    })
  })

  describe('search', () => {
    it('should search users by query', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/users/search',
            {
              status: 200,
              body: {
                users: [mockUser()],
                count: 1,
                next_page: null,
                previous_page: null,
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

      const result = await client.users.search({ query: 'john@example.com' })

      expect(result.users).toHaveLength(1)
      expect(result.users[0].email).toBe('john@example.com')
    })

    it('should search users by external_id', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/users/search',
            {
              status: 200,
              body: {
                users: [mockUser({ external_id: 'ext_123' })],
                count: 1,
                next_page: null,
                previous_page: null,
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

      const result = await client.users.search({ external_id: 'ext_123' })

      expect(result.users).toHaveLength(1)
      expect(result.users[0].external_id).toBe('ext_123')
    })
  })

  describe('merge', () => {
    it('should merge two users', async () => {
      const mergedUser = mockUser({ id: 456 })
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/users/456/merge', { status: 200, body: { user: mergedUser } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const user = await client.users.merge(456, 457)

      expect(user.id).toBe(456)
    })
  })

  describe('list', () => {
    it('should list users', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/users',
            {
              status: 200,
              body: {
                users: [mockUser(), mockUser({ id: 457 })],
                count: 2,
                next_page: null,
                previous_page: null,
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

      const result = await client.users.list()

      expect(result.users).toHaveLength(2)
      expect(result.count).toBe(2)
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
        new Map([
          ['POST /api/v2/organizations', { status: 201, body: { organization: expectedOrg } }],
        ])
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
    it('should get an organization by ID', async () => {
      const expectedOrg = mockOrganization()
      const mockFetch = createMockFetch(
        new Map([
          ['GET /api/v2/organizations/789', { status: 200, body: { organization: expectedOrg } }],
        ])
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
      const updatedOrg = mockOrganization({ name: 'Acme Corporation' })
      const mockFetch = createMockFetch(
        new Map([
          ['PUT /api/v2/organizations/789', { status: 200, body: { organization: updatedOrg } }],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const org = await client.organizations.update(789, {
        name: 'Acme Corporation',
      })

      expect(org.name).toBe('Acme Corporation')
    })
  })

  describe('list', () => {
    it('should list organizations', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/organizations',
            {
              status: 200,
              body: {
                organizations: [mockOrganization(), mockOrganization({ id: 790 })],
                count: 2,
                next_page: null,
                previous_page: null,
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

      const result = await client.organizations.list()

      expect(result.organizations).toHaveLength(2)
      expect(result.count).toBe(2)
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

      await client.organizations.delete(789)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/organizations/789'),
        expect.objectContaining({ method: 'DELETE' })
      )
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
              body: {
                upload: {
                  token: 'upload_token_123',
                  attachment: expectedAttachment,
                },
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

      const result = await client.attachments.upload({
        filename: 'screenshot.png',
        contentType: 'image/png',
        data: new Uint8Array([1, 2, 3]),
      })

      expect(result.token).toBe('upload_token_123')
      expect(result.attachment.file_name).toBe('screenshot.png')
    })
  })

  describe('get', () => {
    it('should get an attachment by ID', async () => {
      const expectedAttachment = mockAttachment()
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/attachments/2001',
            { status: 200, body: { attachment: expectedAttachment } },
          ],
        ])
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
      expect(attachment.content_type).toBe('image/png')
    })
  })

  describe('delete', () => {
    it('should delete an attachment', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /api/v2/attachments/2001', { status: 204, body: {} }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      await client.attachments.delete(2001)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/attachments/2001'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })
})

// =============================================================================
// Triggers Tests
// =============================================================================

describe('@dotdo/zendesk - Triggers', () => {
  describe('list', () => {
    it('should list triggers', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/triggers',
            {
              status: 200,
              body: {
                triggers: [mockTrigger(), mockTrigger({ id: 3002 })],
                count: 2,
                next_page: null,
                previous_page: null,
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

      const result = await client.triggers.list()

      expect(result.triggers).toHaveLength(2)
      expect(result.count).toBe(2)
    })

    it('should list active triggers only', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/triggers/active',
            {
              status: 200,
              body: {
                triggers: [mockTrigger({ active: true })],
                count: 1,
                next_page: null,
                previous_page: null,
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

      const result = await client.triggers.listActive()

      expect(result.triggers).toHaveLength(1)
      expect(result.triggers[0].active).toBe(true)
    })
  })

  describe('get', () => {
    it('should get a trigger by ID', async () => {
      const expectedTrigger = mockTrigger()
      const mockFetch = createMockFetch(
        new Map([
          ['GET /api/v2/triggers/3001', { status: 200, body: { trigger: expectedTrigger } }],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const trigger = await client.triggers.get(3001)

      expect(trigger.id).toBe(3001)
      expect(trigger.title).toBe('Auto-assign urgent tickets')
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

  describe('update', () => {
    it('should update a trigger', async () => {
      const updatedTrigger = mockTrigger({ active: false })
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/triggers/3001', { status: 200, body: { trigger: updatedTrigger } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const trigger = await client.triggers.update(3001, {
        active: false,
      })

      expect(trigger.active).toBe(false)
    })
  })

  describe('delete', () => {
    it('should delete a trigger', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /api/v2/triggers/3001', { status: 204, body: {} }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      await client.triggers.delete(3001)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/triggers/3001'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })
})

// =============================================================================
// Automations Tests
// =============================================================================

describe('@dotdo/zendesk - Automations', () => {
  describe('list', () => {
    it('should list automations', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/automations',
            {
              status: 200,
              body: {
                automations: [mockAutomation(), mockAutomation({ id: 4002 })],
                count: 2,
                next_page: null,
                previous_page: null,
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

      const result = await client.automations.list()

      expect(result.automations).toHaveLength(2)
      expect(result.count).toBe(2)
    })
  })

  describe('get', () => {
    it('should get an automation by ID', async () => {
      const expectedAutomation = mockAutomation()
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/automations/4001',
            { status: 200, body: { automation: expectedAutomation } },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const automation = await client.automations.get(4001)

      expect(automation.id).toBe(4001)
      expect(automation.title).toBe('Close stale tickets')
    })
  })

  describe('create', () => {
    it('should create an automation', async () => {
      const expectedAutomation = mockAutomation()
      const mockFetch = createMockFetch(
        new Map([
          ['POST /api/v2/automations', { status: 201, body: { automation: expectedAutomation } }],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const automation = await client.automations.create({
        title: 'Close stale tickets',
        conditions: {
          all: [{ field: 'status', operator: 'is', value: 'pending' }],
          any: [],
        },
        actions: [{ field: 'status', value: 'closed' }],
      })

      expect(automation.id).toBe(4001)
      expect(automation.title).toBe('Close stale tickets')
    })
  })

  describe('update', () => {
    it('should update an automation', async () => {
      const updatedAutomation = mockAutomation({ active: false })
      const mockFetch = createMockFetch(
        new Map([
          [
            'PUT /api/v2/automations/4001',
            { status: 200, body: { automation: updatedAutomation } },
          ],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const automation = await client.automations.update(4001, {
        active: false,
      })

      expect(automation.active).toBe(false)
    })
  })

  describe('delete', () => {
    it('should delete an automation', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /api/v2/automations/4001', { status: 204, body: {} }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      await client.automations.delete(4001)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/automations/4001'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })
})

// =============================================================================
// Request Options Tests
// =============================================================================

describe('@dotdo/zendesk - Request Options', () => {
  it('should pass correct authorization header for token auth', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ ticket: mockTicket() }),
    })

    const client = new Client({
      subdomain: 'mycompany',
      email: 'admin@example.com',
      token: 'api_token',
      fetch: mockFetch,
    })

    await client.tickets.get(123)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringContaining('Basic'),
          'Content-Type': 'application/json',
        }),
      })
    )
  })

  it('should pass correct authorization header for OAuth', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ ticket: mockTicket() }),
    })

    const client = new Client({
      subdomain: 'mycompany',
      oauthToken: 'oauth_token_123',
      fetch: mockFetch,
    })

    await client.tickets.get(123)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer oauth_token_123',
        }),
      })
    )
  })

  it('should construct correct base URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ ticket: mockTicket() }),
    })

    const client = new Client({
      subdomain: 'mycompany',
      email: 'admin@example.com',
      token: 'api_token',
      fetch: mockFetch,
    })

    await client.tickets.get(123)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://mycompany.zendesk.com/api/v2/tickets/123',
      expect.anything()
    )
  })
})

// =============================================================================
// Ticket Field Helper
// =============================================================================

import type { TicketField, TicketForm, View, Macro, Group, GroupMembership, Webhook, Target } from '../index'

function mockTicketField(overrides: Partial<TicketField> = {}): TicketField {
  return {
    id: 5001,
    url: 'https://mycompany.zendesk.com/api/v2/ticket_fields/5001.json',
    type: 'text',
    title: 'Custom Text Field',
    raw_title: 'Custom Text Field',
    description: 'A custom text field',
    raw_description: 'A custom text field',
    position: 1,
    active: true,
    required: false,
    collapsed_for_agents: false,
    regexp_for_validation: null,
    title_in_portal: 'Custom Field',
    raw_title_in_portal: 'Custom Field',
    visible_in_portal: true,
    editable_in_portal: true,
    required_in_portal: false,
    tag: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    removable: true,
    agent_description: null,
    ...overrides,
  }
}

function mockTicketForm(overrides: Partial<TicketForm> = {}): TicketForm {
  return {
    id: 6001,
    url: 'https://mycompany.zendesk.com/api/v2/ticket_forms/6001.json',
    name: 'Default Form',
    raw_name: 'Default Form',
    display_name: 'Default Form',
    raw_display_name: 'Default Form',
    end_user_visible: true,
    position: 1,
    ticket_field_ids: [5001, 5002],
    active: true,
    default: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    in_all_brands: true,
    restricted_brand_ids: [],
    agent_conditions: [],
    end_user_conditions: [],
    ...overrides,
  }
}

function mockView(overrides: Partial<View> = {}): View {
  return {
    id: 7001,
    url: 'https://mycompany.zendesk.com/api/v2/views/7001.json',
    title: 'Open Tickets',
    active: true,
    position: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    restriction: null,
    execution: {
      group_by: null,
      group_order: 'desc',
      sort_by: 'updated_at',
      sort_order: 'desc',
    },
    conditions: {
      all: [{ field: 'status', operator: 'is', value: 'open' }],
      any: [],
    },
    output: {
      columns: ['subject', 'requester', 'status'],
      group_by: null,
      group_order: 'desc',
      sort_by: 'updated_at',
      sort_order: 'desc',
    },
    ...overrides,
  }
}

function mockMacro(overrides: Partial<Macro> = {}): Macro {
  return {
    id: 8001,
    url: 'https://mycompany.zendesk.com/api/v2/macros/8001.json',
    title: 'Mark as Solved',
    active: true,
    position: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    description: 'Marks a ticket as solved',
    actions: [{ field: 'status', value: 'solved' }],
    restriction: null,
    ...overrides,
  }
}

function mockGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: 9001,
    url: 'https://mycompany.zendesk.com/api/v2/groups/9001.json',
    name: 'Support Team',
    description: 'Main support team',
    default: false,
    deleted: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function mockGroupMembership(overrides: Partial<GroupMembership> = {}): GroupMembership {
  return {
    id: 10001,
    url: 'https://mycompany.zendesk.com/api/v2/group_memberships/10001.json',
    user_id: 456,
    group_id: 9001,
    default: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function mockWebhook(overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: 'webhook_123',
    name: 'Notify Slack',
    status: 'active',
    endpoint: 'https://hooks.slack.com/services/xxx',
    http_method: 'POST',
    request_format: 'json',
    subscriptions: ['conditional_ticket_events'],
    created_at: new Date().toISOString(),
    created_by: 'admin@example.com',
    updated_at: new Date().toISOString(),
    updated_by: 'admin@example.com',
    ...overrides,
  }
}

function mockTarget(overrides: Partial<Target> = {}): Target {
  return {
    id: 11001,
    url: 'https://mycompany.zendesk.com/api/v2/targets/11001.json',
    title: 'HTTP Target',
    type: 'http_target',
    active: true,
    created_at: new Date().toISOString(),
    target_url: 'https://example.com/webhook',
    method: 'post',
    content_type: 'application/json',
    ...overrides,
  }
}

// =============================================================================
// Ticket Fields Tests
// =============================================================================

describe('@dotdo/zendesk - Ticket Fields', () => {
  describe('create', () => {
    it('should create a ticket field', async () => {
      const expectedField = mockTicketField()
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/ticket_fields', { status: 201, body: { ticket_field: expectedField } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const field = await client.ticketFields.create({
        type: 'text',
        title: 'Custom Text Field',
      })

      expect(field.id).toBe(5001)
      expect(field.title).toBe('Custom Text Field')
      expect(field.type).toBe('text')
    })

    it('should create a dropdown field with options', async () => {
      const expectedField = mockTicketField({
        type: 'tagger',
        custom_field_options: [
          { id: 1, name: 'Option 1', raw_name: 'Option 1', value: 'option_1' },
          { id: 2, name: 'Option 2', raw_name: 'Option 2', value: 'option_2' },
        ],
      })
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/ticket_fields', { status: 201, body: { ticket_field: expectedField } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const field = await client.ticketFields.create({
        type: 'tagger',
        title: 'Category',
        custom_field_options: [
          { name: 'Option 1', value: 'option_1' },
          { name: 'Option 2', value: 'option_2' },
        ],
      })

      expect(field.type).toBe('tagger')
      expect(field.custom_field_options).toHaveLength(2)
    })
  })

  describe('get', () => {
    it('should get a ticket field by ID', async () => {
      const expectedField = mockTicketField()
      const mockFetch = createMockFetch(
        new Map([['GET /api/v2/ticket_fields/5001', { status: 200, body: { ticket_field: expectedField } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const field = await client.ticketFields.get(5001)

      expect(field.id).toBe(5001)
    })
  })

  describe('update', () => {
    it('should update a ticket field', async () => {
      const updatedField = mockTicketField({ title: 'Updated Title' })
      const mockFetch = createMockFetch(
        new Map([['PUT /api/v2/ticket_fields/5001', { status: 200, body: { ticket_field: updatedField } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const field = await client.ticketFields.update(5001, { title: 'Updated Title' })

      expect(field.title).toBe('Updated Title')
    })
  })

  describe('list', () => {
    it('should list all ticket fields', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/ticket_fields',
            {
              status: 200,
              body: {
                ticket_fields: [mockTicketField(), mockTicketField({ id: 5002 })],
                count: 2,
                next_page: null,
                previous_page: null,
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

      const result = await client.ticketFields.list()

      expect(result.ticket_fields).toHaveLength(2)
      expect(result.count).toBe(2)
    })
  })

  describe('delete', () => {
    it('should delete a ticket field', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /api/v2/ticket_fields/5001', { status: 204, body: {} }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      await client.ticketFields.delete(5001)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/ticket_fields/5001'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })
})

// =============================================================================
// Ticket Forms Tests
// =============================================================================

describe('@dotdo/zendesk - Ticket Forms', () => {
  describe('create', () => {
    it('should create a ticket form', async () => {
      const expectedForm = mockTicketForm()
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/ticket_forms', { status: 201, body: { ticket_form: expectedForm } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const form = await client.ticketForms.create({
        name: 'Default Form',
        ticket_field_ids: [5001, 5002],
      })

      expect(form.id).toBe(6001)
      expect(form.name).toBe('Default Form')
    })
  })

  describe('get', () => {
    it('should get a ticket form by ID', async () => {
      const expectedForm = mockTicketForm()
      const mockFetch = createMockFetch(
        new Map([['GET /api/v2/ticket_forms/6001', { status: 200, body: { ticket_form: expectedForm } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const form = await client.ticketForms.get(6001)

      expect(form.id).toBe(6001)
    })
  })

  describe('list', () => {
    it('should list all ticket forms', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/ticket_forms',
            {
              status: 200,
              body: {
                ticket_forms: [mockTicketForm(), mockTicketForm({ id: 6002 })],
                count: 2,
                next_page: null,
                previous_page: null,
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

      const result = await client.ticketForms.list()

      expect(result.ticket_forms).toHaveLength(2)
    })
  })

  describe('clone', () => {
    it('should clone a ticket form', async () => {
      const clonedForm = mockTicketForm({ id: 6002, name: 'Default Form (copy)' })
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/ticket_forms/6001/clone', { status: 201, body: { ticket_form: clonedForm } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const form = await client.ticketForms.clone(6001)

      expect(form.id).toBe(6002)
      expect(form.name).toBe('Default Form (copy)')
    })
  })
})

// =============================================================================
// Views Tests
// =============================================================================

describe('@dotdo/zendesk - Views', () => {
  describe('create', () => {
    it('should create a view', async () => {
      const expectedView = mockView()
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/views', { status: 201, body: { view: expectedView } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const view = await client.views.create({
        title: 'Open Tickets',
        conditions: {
          all: [{ field: 'status', operator: 'is', value: 'open' }],
          any: [],
        },
      })

      expect(view.id).toBe(7001)
      expect(view.title).toBe('Open Tickets')
    })
  })

  describe('get', () => {
    it('should get a view by ID', async () => {
      const expectedView = mockView()
      const mockFetch = createMockFetch(
        new Map([['GET /api/v2/views/7001', { status: 200, body: { view: expectedView } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const view = await client.views.get(7001)

      expect(view.id).toBe(7001)
    })
  })

  describe('list', () => {
    it('should list all views', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/views',
            {
              status: 200,
              body: {
                views: [mockView(), mockView({ id: 7002, title: 'Pending Tickets' })],
                count: 2,
                next_page: null,
                previous_page: null,
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

      const result = await client.views.list()

      expect(result.views).toHaveLength(2)
    })
  })

  describe('listActive', () => {
    it('should list active views only', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/views/active',
            {
              status: 200,
              body: {
                views: [mockView({ active: true })],
                count: 1,
                next_page: null,
                previous_page: null,
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

      const result = await client.views.listActive()

      expect(result.views).toHaveLength(1)
      expect(result.views[0].active).toBe(true)
    })
  })

  describe('count', () => {
    it('should get ticket count for a view', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/views/7001/count',
            {
              status: 200,
              body: {
                view_count: {
                  view_id: 7001,
                  url: 'https://mycompany.zendesk.com/api/v2/views/7001/count.json',
                  value: 42,
                  pretty: '42',
                  fresh: true,
                },
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

      const result = await client.views.count(7001)

      expect(result.view_count.value).toBe(42)
    })
  })

  describe('tickets', () => {
    it('should get tickets from a view', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/views/7001/tickets',
            {
              status: 200,
              body: {
                tickets: [mockTicket()],
                count: 1,
                next_page: null,
                previous_page: null,
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

      const result = await client.views.tickets(7001)

      expect(result.tickets).toHaveLength(1)
    })
  })
})

// =============================================================================
// Macros Tests
// =============================================================================

describe('@dotdo/zendesk - Macros', () => {
  describe('create', () => {
    it('should create a macro', async () => {
      const expectedMacro = mockMacro()
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/macros', { status: 201, body: { macro: expectedMacro } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const macro = await client.macros.create({
        title: 'Mark as Solved',
        actions: [{ field: 'status', value: 'solved' }],
      })

      expect(macro.id).toBe(8001)
      expect(macro.title).toBe('Mark as Solved')
    })
  })

  describe('get', () => {
    it('should get a macro by ID', async () => {
      const expectedMacro = mockMacro()
      const mockFetch = createMockFetch(
        new Map([['GET /api/v2/macros/8001', { status: 200, body: { macro: expectedMacro } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const macro = await client.macros.get(8001)

      expect(macro.id).toBe(8001)
    })
  })

  describe('list', () => {
    it('should list all macros', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/macros',
            {
              status: 200,
              body: {
                macros: [mockMacro(), mockMacro({ id: 8002, title: 'Escalate' })],
                count: 2,
                next_page: null,
                previous_page: null,
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

      const result = await client.macros.list()

      expect(result.macros).toHaveLength(2)
    })
  })

  describe('apply', () => {
    it('should preview applying a macro to a ticket', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/tickets/123/macros/8001/apply',
            {
              status: 200,
              body: {
                result: {
                  ticket: { status: 'solved' },
                },
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

      const result = await client.macros.apply(8001, 123)

      expect(result.result.ticket.status).toBe('solved')
    })
  })

  describe('search', () => {
    it('should search macros by query', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/macros/search',
            {
              status: 200,
              body: {
                macros: [mockMacro()],
                count: 1,
                next_page: null,
                previous_page: null,
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

      const result = await client.macros.search('solved')

      expect(result.macros).toHaveLength(1)
    })
  })
})

// =============================================================================
// Groups Tests
// =============================================================================

describe('@dotdo/zendesk - Groups', () => {
  describe('create', () => {
    it('should create a group', async () => {
      const expectedGroup = mockGroup()
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/groups', { status: 201, body: { group: expectedGroup } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const group = await client.groups.create({
        name: 'Support Team',
        description: 'Main support team',
      })

      expect(group.id).toBe(9001)
      expect(group.name).toBe('Support Team')
    })
  })

  describe('get', () => {
    it('should get a group by ID', async () => {
      const expectedGroup = mockGroup()
      const mockFetch = createMockFetch(
        new Map([['GET /api/v2/groups/9001', { status: 200, body: { group: expectedGroup } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const group = await client.groups.get(9001)

      expect(group.id).toBe(9001)
    })
  })

  describe('list', () => {
    it('should list all groups', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/groups',
            {
              status: 200,
              body: {
                groups: [mockGroup(), mockGroup({ id: 9002, name: 'Engineering Team' })],
                count: 2,
                next_page: null,
                previous_page: null,
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

      const result = await client.groups.list()

      expect(result.groups).toHaveLength(2)
    })
  })

  describe('listAssignable', () => {
    it('should list assignable groups', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/groups/assignable',
            {
              status: 200,
              body: {
                groups: [mockGroup()],
                count: 1,
                next_page: null,
                previous_page: null,
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

      const result = await client.groups.listAssignable()

      expect(result.groups).toHaveLength(1)
    })
  })

  describe('memberships', () => {
    it('should get group memberships', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/groups/9001/memberships',
            {
              status: 200,
              body: {
                group_memberships: [mockGroupMembership()],
                count: 1,
                next_page: null,
                previous_page: null,
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

      const result = await client.groups.memberships(9001)

      expect(result.group_memberships).toHaveLength(1)
    })
  })

  describe('addMember', () => {
    it('should add a user to a group', async () => {
      const expectedMembership = mockGroupMembership()
      const mockFetch = createMockFetch(
        new Map([
          ['POST /api/v2/group_memberships', { status: 201, body: { group_membership: expectedMembership } }],
        ])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const membership = await client.groups.addMember(9001, 456)

      expect(membership.user_id).toBe(456)
      expect(membership.group_id).toBe(9001)
    })
  })
})

// =============================================================================
// Webhooks Tests
// =============================================================================

describe('@dotdo/zendesk - Webhooks', () => {
  describe('create', () => {
    it('should create a webhook', async () => {
      const expectedWebhook = mockWebhook()
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/webhooks', { status: 201, body: { webhook: expectedWebhook } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const webhook = await client.webhooks.create({
        name: 'Notify Slack',
        endpoint: 'https://hooks.slack.com/services/xxx',
        http_method: 'POST',
        request_format: 'json',
      })

      expect(webhook.id).toBe('webhook_123')
      expect(webhook.name).toBe('Notify Slack')
    })
  })

  describe('get', () => {
    it('should get a webhook by ID', async () => {
      const expectedWebhook = mockWebhook()
      const mockFetch = createMockFetch(
        new Map([['GET /api/v2/webhooks/webhook_123', { status: 200, body: { webhook: expectedWebhook } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const webhook = await client.webhooks.get('webhook_123')

      expect(webhook.id).toBe('webhook_123')
    })
  })

  describe('list', () => {
    it('should list all webhooks', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/webhooks',
            {
              status: 200,
              body: {
                webhooks: [mockWebhook(), mockWebhook({ id: 'webhook_456' })],
                meta: { has_more: false, after_cursor: null, before_cursor: null },
                links: { prev: null, next: null },
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

      const result = await client.webhooks.list()

      expect(result.webhooks).toHaveLength(2)
    })
  })

  describe('test', () => {
    it('should test a webhook', async () => {
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/webhooks/webhook_123/test', { status: 200, body: { status: 'success' } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const result = await client.webhooks.test('webhook_123')

      expect(result.status).toBe('success')
    })
  })

  describe('getSigningSecret', () => {
    it('should get signing secret for a webhook', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/webhooks/webhook_123/signing_secret',
            {
              status: 200,
              body: {
                signing_secret: { algorithm: 'SHA256', secret: 'secret_xxx' },
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

      const result = await client.webhooks.getSigningSecret('webhook_123')

      expect(result.signing_secret.algorithm).toBe('SHA256')
    })
  })
})

// =============================================================================
// Targets Tests (Legacy)
// =============================================================================

describe('@dotdo/zendesk - Targets', () => {
  describe('create', () => {
    it('should create a target', async () => {
      const expectedTarget = mockTarget()
      const mockFetch = createMockFetch(
        new Map([['POST /api/v2/targets', { status: 201, body: { target: expectedTarget } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const target = await client.targets.create({
        title: 'HTTP Target',
        type: 'http_target',
        target_url: 'https://example.com/webhook',
        method: 'post',
      })

      expect(target.id).toBe(11001)
      expect(target.title).toBe('HTTP Target')
    })
  })

  describe('get', () => {
    it('should get a target by ID', async () => {
      const expectedTarget = mockTarget()
      const mockFetch = createMockFetch(
        new Map([['GET /api/v2/targets/11001', { status: 200, body: { target: expectedTarget } }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      const target = await client.targets.get(11001)

      expect(target.id).toBe(11001)
    })
  })

  describe('list', () => {
    it('should list all targets', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /api/v2/targets',
            {
              status: 200,
              body: {
                targets: [mockTarget(), mockTarget({ id: 11002 })],
                count: 2,
                next_page: null,
                previous_page: null,
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

      const result = await client.targets.list()

      expect(result.targets).toHaveLength(2)
    })
  })

  describe('delete', () => {
    it('should delete a target', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /api/v2/targets/11001', { status: 204, body: {} }]])
      )

      const client = new Client({
        subdomain: 'mycompany',
        email: 'admin@example.com',
        token: 'api_token',
        fetch: mockFetch,
      })

      await client.targets.delete(11001)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/targets/11001'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })
})

// =============================================================================
// Additional Client Tests
// =============================================================================

describe('@dotdo/zendesk - Client Resources', () => {
  it('should have all resources initialized', () => {
    const client = new Client({
      subdomain: 'mycompany',
      email: 'admin@example.com',
      token: 'api_token',
    })

    expect(client.tickets).toBeDefined()
    expect(client.users).toBeDefined()
    expect(client.organizations).toBeDefined()
    expect(client.attachments).toBeDefined()
    expect(client.triggers).toBeDefined()
    expect(client.automations).toBeDefined()
    expect(client.ticketFields).toBeDefined()
    expect(client.ticketForms).toBeDefined()
    expect(client.views).toBeDefined()
    expect(client.macros).toBeDefined()
    expect(client.groups).toBeDefined()
    expect(client.webhooks).toBeDefined()
    expect(client.targets).toBeDefined()
  })
})

// =============================================================================
// ZendeskLocal Tests - Local/Edge Implementation
// =============================================================================

import { ZendeskLocal } from '../index'

describe('@dotdo/zendesk - ZendeskLocal', () => {
  describe('initialization', () => {
    it('should create a local client', () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      expect(client).toBeDefined()
      expect(client.tickets).toBeDefined()
      expect(client.users).toBeDefined()
      expect(client.organizations).toBeDefined()
      expect(client.attachments).toBeDefined()
      expect(client.triggers).toBeDefined()
      expect(client.automations).toBeDefined()
      expect(client.views).toBeDefined()
      expect(client.macros).toBeDefined()
      expect(client.groups).toBeDefined()
    })
  })

  describe('tickets', () => {
    it('should create a ticket', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
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

    it('should get a ticket by ID', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const created = await client.tickets.create({
        subject: 'Test ticket',
        description: 'Test description',
      })

      const ticket = await client.tickets.get(created.id)
      expect(ticket.id).toBe(created.id)
      expect(ticket.subject).toBe('Test ticket')
    })

    it('should update a ticket', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const created = await client.tickets.create({
        subject: 'Test ticket',
        description: 'Test description',
        status: 'new',
      })

      const updated = await client.tickets.update(created.id, {
        status: 'open',
        priority: 'urgent',
      })

      expect(updated.status).toBe('open')
      expect(updated.priority).toBe('urgent')
    })

    it('should delete a ticket', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const created = await client.tickets.create({
        subject: 'Test ticket',
        description: 'Test description',
      })

      await client.tickets.delete(created.id)

      await expect(client.tickets.get(created.id)).rejects.toThrow('Ticket not found')
    })

    it('should list tickets', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      await client.tickets.create({ subject: 'Ticket 1', description: 'Desc 1' })
      await client.tickets.create({ subject: 'Ticket 2', description: 'Desc 2' })

      const result = await client.tickets.list()
      expect(result.tickets.length).toBeGreaterThanOrEqual(2)
    })

    it('should list tickets filtered by status', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      await client.tickets.create({ subject: 'Open ticket', description: 'Desc', status: 'open' })
      await client.tickets.create({ subject: 'Pending ticket', description: 'Desc', status: 'pending' })

      const result = await client.tickets.list({ status: 'open' })
      expect(result.tickets.every((t) => t.status === 'open')).toBe(true)
    })

    it('should search tickets by query', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      await client.tickets.create({ subject: 'Urgent billing issue', description: 'Billing problem', priority: 'urgent' })
      await client.tickets.create({ subject: 'General question', description: 'Question', priority: 'low' })

      const result = await client.tickets.search('priority:urgent')
      expect(result.results.every((t) => t.priority === 'urgent')).toBe(true)
    })

    it('should search tickets by text', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      await client.tickets.create({ subject: 'Password reset help', description: 'Cannot reset password' })
      await client.tickets.create({ subject: 'Other issue', description: 'Some other problem' })

      const result = await client.tickets.search('password')
      expect(result.results.some((t) => t.subject.toLowerCase().includes('password'))).toBe(true)
    })

    it('should add and list comments', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const ticket = await client.tickets.create({ subject: 'Test', description: 'Initial description' })

      await client.tickets.addComment(ticket.id, { body: 'First comment', public: true })
      await client.tickets.addComment(ticket.id, { body: 'Second comment', public: false })

      const result = await client.tickets.listComments(ticket.id)
      // Initial description + 2 comments
      expect(result.comments.length).toBeGreaterThanOrEqual(2)
    })

    it('should create ticket with requester and resolve user', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const ticket = await client.tickets.create({
        subject: 'Test with requester',
        description: 'Description',
        requester: { email: 'requester@example.com', name: 'Test Requester' },
      })

      expect(ticket.requester_id).toBeDefined()
      const user = await client.users.get(ticket.requester_id)
      expect(user.email).toBe('requester@example.com')
    })

    it('should handle tag operations', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const ticket = await client.tickets.create({
        subject: 'Test with tags',
        description: 'Description',
        tags: ['initial', 'tag'],
      })

      expect(ticket.tags).toContain('initial')

      const updated = await client.tickets.update(ticket.id, {
        additional_tags: ['new_tag'],
        remove_tags: ['initial'],
      })

      expect(updated.tags).toContain('new_tag')
      expect(updated.tags).not.toContain('initial')
    })
  })

  describe('users', () => {
    it('should create a user', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const user = await client.users.create({
        name: 'John Doe',
        email: 'john@example.com',
        role: 'end-user',
      })

      expect(user.id).toBeDefined()
      expect(user.name).toBe('John Doe')
      expect(user.email).toBe('john@example.com')
      expect(user.role).toBe('end-user')
    })

    it('should get a user by ID', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const created = await client.users.create({
        name: 'Jane Doe',
        email: 'jane@example.com',
      })

      const user = await client.users.get(created.id)
      expect(user.id).toBe(created.id)
      expect(user.name).toBe('Jane Doe')
    })

    it('should find user by email', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      await client.users.create({
        name: 'Find Me',
        email: 'findme@example.com',
      })

      const user = await client.users.findByEmail('findme@example.com')
      expect(user).not.toBeNull()
      expect(user!.email).toBe('findme@example.com')
    })

    it('should update a user', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const created = await client.users.create({
        name: 'Original Name',
        email: 'original@example.com',
      })

      const updated = await client.users.update(created.id, {
        name: 'Updated Name',
      })

      expect(updated.name).toBe('Updated Name')
    })

    it('should delete a user', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const created = await client.users.create({
        name: 'To Delete',
        email: 'delete@example.com',
      })

      await client.users.delete(created.id)
      await expect(client.users.get(created.id)).rejects.toThrow('User not found')
    })

    it('should list users', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      await client.users.create({ name: 'User 1', email: 'user1@example.com' })
      await client.users.create({ name: 'User 2', email: 'user2@example.com' })

      const result = await client.users.list()
      expect(result.users.length).toBeGreaterThanOrEqual(2)
    })

    it('should search users', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      await client.users.create({ name: 'Search Target', email: 'searchable@example.com' })

      const result = await client.users.search({ query: 'searchable' })
      expect(result.users.some((u) => u.email.includes('searchable'))).toBe(true)
    })

    it('should merge users', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const target = await client.users.create({
        name: 'Target User',
        email: 'target@example.com',
        tags: ['target_tag'],
      })
      const source = await client.users.create({
        name: 'Source User',
        email: 'source@example.com',
        tags: ['source_tag'],
      })

      const merged = await client.users.merge(target.id, source.id)

      expect(merged.id).toBe(target.id)
      expect(merged.tags).toContain('target_tag')
      expect(merged.tags).toContain('source_tag')

      // Source should be deleted
      await expect(client.users.get(source.id)).rejects.toThrow('User not found')
    })
  })

  describe('organizations', () => {
    it('should create an organization', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const org = await client.organizations.create({
        name: 'Acme Inc',
        domain_names: ['acme.com'],
      })

      expect(org.id).toBeDefined()
      expect(org.name).toBe('Acme Inc')
      expect(org.domain_names).toContain('acme.com')
    })

    it('should get an organization by ID', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const created = await client.organizations.create({ name: 'Test Org' })

      const org = await client.organizations.get(created.id)
      expect(org.id).toBe(created.id)
    })

    it('should update an organization', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const created = await client.organizations.create({ name: 'Original Org' })

      const updated = await client.organizations.update(created.id, {
        name: 'Updated Org',
      })

      expect(updated.name).toBe('Updated Org')
    })

    it('should delete an organization', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const created = await client.organizations.create({ name: 'To Delete Org' })

      await client.organizations.delete(created.id)
      await expect(client.organizations.get(created.id)).rejects.toThrow('Organization not found')
    })

    it('should list organizations', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      await client.organizations.create({ name: 'Org 1' })
      await client.organizations.create({ name: 'Org 2' })

      const result = await client.organizations.list()
      expect(result.organizations.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('attachments', () => {
    it('should upload an attachment', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const result = await client.attachments.upload({
        filename: 'test.txt',
        contentType: 'text/plain',
        data: 'Hello World',
      })

      expect(result.token).toBeDefined()
      expect(result.attachment.file_name).toBe('test.txt')
    })

    it('should get an attachment by ID', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const uploaded = await client.attachments.upload({
        filename: 'test.png',
        contentType: 'image/png',
        data: new Uint8Array([1, 2, 3]),
      })

      const attachment = await client.attachments.get(uploaded.attachment.id)
      expect(attachment.file_name).toBe('test.png')
    })

    it('should delete an attachment', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const uploaded = await client.attachments.upload({
        filename: 'delete.txt',
        contentType: 'text/plain',
        data: 'Delete me',
      })

      await client.attachments.delete(uploaded.attachment.id)
      await expect(client.attachments.get(uploaded.attachment.id)).rejects.toThrow('Attachment not found')
    })
  })

  describe('triggers', () => {
    it('should create a trigger', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
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

    it('should get a trigger by ID', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const created = await client.triggers.create({
        title: 'Test Trigger',
        conditions: { all: [], any: [] },
        actions: [],
      })

      const trigger = await client.triggers.get(created.id)
      expect(trigger.id).toBe(created.id)
    })

    it('should update a trigger', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const created = await client.triggers.create({
        title: 'Original Trigger',
        conditions: { all: [], any: [] },
        actions: [],
      })

      const updated = await client.triggers.update(created.id, {
        active: false,
      })

      expect(updated.active).toBe(false)
    })

    it('should list triggers', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      await client.triggers.create({
        title: 'Trigger 1',
        conditions: { all: [], any: [] },
        actions: [],
      })
      await client.triggers.create({
        title: 'Trigger 2',
        conditions: { all: [], any: [] },
        actions: [],
        active: false,
      })

      const result = await client.triggers.list()
      expect(result.triggers.length).toBeGreaterThanOrEqual(2)
    })

    it('should list active triggers only', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
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

      const result = await client.triggers.listActive()
      expect(result.triggers.every((t) => t.active)).toBe(true)
    })

    it('should execute trigger on ticket create', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      await client.triggers.create({
        title: 'Set priority for urgent keyword',
        conditions: {
          all: [{ field: 'status', operator: 'is', value: 'new' }],
          any: [],
        },
        actions: [{ field: 'priority', value: 'high' }],
      })

      const ticket = await client.tickets.create({
        subject: 'Urgent issue',
        description: 'This is urgent',
        status: 'new',
      })

      // Trigger should have set priority to high
      expect(ticket.priority).toBe('high')
    })
  })

  describe('automations', () => {
    it('should create an automation', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const automation = await client.automations.create({
        title: 'Close stale tickets',
        conditions: {
          all: [{ field: 'status', operator: 'is', value: 'pending' }],
          any: [],
        },
        actions: [{ field: 'status', value: 'closed' }],
      })

      expect(automation.id).toBeDefined()
      expect(automation.title).toBe('Close stale tickets')
    })

    it('should list automations', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      await client.automations.create({
        title: 'Automation 1',
        conditions: { all: [], any: [] },
        actions: [],
      })

      const result = await client.automations.list()
      expect(result.automations.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('views', () => {
    it('should create a view', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
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

    it('should list views', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      await client.views.create({
        title: 'View 1',
        conditions: { all: [], any: [] },
      })

      const result = await client.views.list()
      expect(result.views.length).toBeGreaterThanOrEqual(1)
    })

    it('should get view ticket count', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const view = await client.views.create({
        title: 'All Open',
        conditions: {
          all: [{ field: 'status', operator: 'is', value: 'open' }],
          any: [],
        },
      })

      await client.tickets.create({ subject: 'Open 1', description: 'Desc', status: 'open' })
      await client.tickets.create({ subject: 'Open 2', description: 'Desc', status: 'open' })

      const result = await client.views.count(view.id)
      expect(result.view_count.value).toBeGreaterThanOrEqual(2)
    })

    it('should get tickets from a view', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const view = await client.views.create({
        title: 'High Priority',
        conditions: {
          all: [{ field: 'priority', operator: 'is', value: 'high' }],
          any: [],
        },
      })

      await client.tickets.create({ subject: 'High 1', description: 'Desc', priority: 'high' })
      await client.tickets.create({ subject: 'Low 1', description: 'Desc', priority: 'low' })

      const result = await client.views.tickets(view.id)
      expect(result.tickets.every((t) => t.priority === 'high')).toBe(true)
    })

    it('should preview view conditions', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      await client.tickets.create({ subject: 'Pending 1', description: 'Desc', status: 'pending' })

      const result = await client.views.preview({
        title: 'Preview',
        conditions: {
          all: [{ field: 'status', operator: 'is', value: 'pending' }],
          any: [],
        },
      })

      expect(result.tickets.every((t) => t.status === 'pending')).toBe(true)
    })
  })

  describe('macros', () => {
    it('should create a macro', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const macro = await client.macros.create({
        title: 'Mark as Solved',
        actions: [{ field: 'status', value: 'solved' }],
      })

      expect(macro.id).toBeDefined()
      expect(macro.title).toBe('Mark as Solved')
    })

    it('should list macros', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      await client.macros.create({
        title: 'Macro 1',
        actions: [],
      })

      const result = await client.macros.list()
      expect(result.macros.length).toBeGreaterThanOrEqual(1)
    })

    it('should apply a macro to get ticket changes', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const ticket = await client.tickets.create({
        subject: 'Test',
        description: 'Desc',
        status: 'new',
      })

      const macro = await client.macros.create({
        title: 'Close ticket',
        actions: [
          { field: 'status', value: 'solved' },
          { field: 'comment_value', value: 'This ticket has been resolved.' },
        ],
      })

      const result = await client.macros.apply(macro.id, ticket.id)
      expect(result.result.ticket.status).toBe('solved')
      expect(result.result.comment?.body).toBe('This ticket has been resolved.')
    })

    it('should search macros', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      await client.macros.create({
        title: 'Escalate to Support',
        actions: [],
      })

      const result = await client.macros.search('escalate')
      expect(result.macros.some((m) => m.title.toLowerCase().includes('escalate'))).toBe(true)
    })
  })

  describe('groups', () => {
    it('should create a group', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const group = await client.groups.create({
        name: 'Support Team',
        description: 'Main support team',
      })

      expect(group.id).toBeDefined()
      expect(group.name).toBe('Support Team')
    })

    it('should list groups', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      await client.groups.create({ name: 'Group 1' })

      const result = await client.groups.list()
      expect(result.groups.length).toBeGreaterThanOrEqual(1)
    })

    it('should add a member to a group', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const group = await client.groups.create({ name: 'Test Group' })
      const user = await client.users.create({ name: 'Agent', email: 'agent@example.com', role: 'agent' })

      const membership = await client.groups.addMember(group.id, user.id)

      expect(membership.group_id).toBe(group.id)
      expect(membership.user_id).toBe(user.id)
    })

    it('should get group memberships', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const group = await client.groups.create({ name: 'Test Group 2' })
      const user = await client.users.create({ name: 'Agent 2', email: 'agent2@example.com', role: 'agent' })
      await client.groups.addMember(group.id, user.id)

      const result = await client.groups.memberships(group.id)

      expect(result.group_memberships.length).toBeGreaterThanOrEqual(1)
      expect(result.group_memberships.some((m) => m.user_id === user.id)).toBe(true)
    })

    it('should remove a member from a group', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const group = await client.groups.create({ name: 'Test Group 3' })
      const user = await client.users.create({ name: 'Agent 3', email: 'agent3@example.com', role: 'agent' })
      const membership = await client.groups.addMember(group.id, user.id)

      await client.groups.removeMember(membership.id)

      const result = await client.groups.memberships(group.id)
      expect(result.group_memberships.some((m) => m.id === membership.id)).toBe(false)
    })

    it('should set default group for user', async () => {
      const client = new ZendeskLocal({ subdomain: 'test' })
      const group1 = await client.groups.create({ name: 'Group A' })
      const group2 = await client.groups.create({ name: 'Group B' })
      const user = await client.users.create({ name: 'Multi-group Agent', email: 'multiagent@example.com', role: 'agent' })

      const m1 = await client.groups.addMember(group1.id, user.id)
      const m2 = await client.groups.addMember(group2.id, user.id)

      const memberships = await client.groups.setDefaultForUser(user.id, m2.id)

      const defaultMembership = memberships.find((m) => m.default)
      expect(defaultMembership?.id).toBe(m2.id)
    })
  })
})
