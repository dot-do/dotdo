/**
 * @dotdo/helpscout - Help Scout API Compatibility Layer Tests
 *
 * Tests for the Help Scout API compatibility layer including:
 * - Client initialization
 * - Conversations (create, get, update, delete, list, search)
 * - Customers (create, get, update, list)
 * - Mailboxes (list, get, folders)
 * - Users (list, get)
 * - Tags (list, create)
 * - Saved Replies (list, get)
 * - Threads (create, list)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Client,
  HelpScoutError,
  type Conversation,
  type Customer,
  type Mailbox,
  type Folder,
  type User,
  type Tag,
  type SavedReply,
  type Thread,
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
          status: 404,
          error: 'Not Found',
          message: `No mock for ${key}`,
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
    id: 1001,
    number: 123,
    threads: 2,
    type: 'email',
    folderId: 1,
    status: 'active',
    state: 'published',
    subject: 'Help needed',
    preview: 'I need help with...',
    mailboxId: 1,
    assignee: {
      id: 2001,
      email: 'agent@company.com',
      firstName: 'Support',
      lastName: 'Agent',
      type: 'user',
    },
    createdBy: {
      id: 3001,
      email: 'customer@example.com',
      firstName: 'John',
      lastName: 'Doe',
      type: 'customer',
    },
    createdAt: new Date().toISOString(),
    source: {
      type: 'email',
      via: 'customer',
    },
    tags: [],
    cc: [],
    bcc: [],
    primaryCustomer: {
      id: 3001,
      email: 'customer@example.com',
      firstName: 'John',
      lastName: 'Doe',
      type: 'customer',
    },
    customFields: [],
    _links: {
      self: { href: 'https://api.helpscout.net/v2/conversations/1001' },
    },
    ...overrides,
  }
}

function mockCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 3001,
    firstName: 'John',
    lastName: 'Doe',
    createdAt: new Date().toISOString(),
    _embedded: {
      emails: [{ type: 'work', value: 'john@example.com' }],
    },
    _links: {
      self: { href: 'https://api.helpscout.net/v2/customers/3001' },
    },
    ...overrides,
  }
}

function mockMailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    id: 1,
    name: 'Support',
    slug: 'support',
    email: 'support@company.com',
    createdAt: new Date().toISOString(),
    _links: {
      self: { href: 'https://api.helpscout.net/v2/mailboxes/1' },
    },
    ...overrides,
  }
}

function mockFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: 1,
    name: 'Unassigned',
    type: 'needsattention',
    totalCount: 10,
    activeCount: 5,
    _links: {
      self: { href: 'https://api.helpscout.net/v2/mailboxes/1/folders/1' },
    },
    ...overrides,
  }
}

function mockUser(overrides: Partial<User> = {}): User {
  return {
    id: 2001,
    firstName: 'Support',
    lastName: 'Agent',
    email: 'agent@company.com',
    role: 'user',
    timezone: 'America/New_York',
    type: 'user',
    createdAt: new Date().toISOString(),
    _links: {
      self: { href: 'https://api.helpscout.net/v2/users/2001' },
    },
    ...overrides,
  }
}

function mockTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: 4001,
    tag: 'billing',
    slug: 'billing',
    color: '#3498db',
    ticketCount: 15,
    createdAt: new Date().toISOString(),
    _links: {
      self: { href: 'https://api.helpscout.net/v2/tags/4001' },
    },
    ...overrides,
  }
}

function mockSavedReply(overrides: Partial<SavedReply> = {}): SavedReply {
  return {
    id: 5001,
    mailboxId: 1,
    name: 'Greeting',
    text: 'Thank you for contacting us!',
    createdAt: new Date().toISOString(),
    _links: {
      self: { href: 'https://api.helpscout.net/v2/mailboxes/1/saved-replies/5001' },
    },
    ...overrides,
  }
}

function mockThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 6001,
    type: 'customer',
    status: 'active',
    state: 'published',
    body: 'I need help with my order.',
    source: {
      type: 'email',
      via: 'customer',
    },
    customer: {
      id: 3001,
      email: 'customer@example.com',
      firstName: 'John',
      lastName: 'Doe',
      type: 'customer',
    },
    createdBy: {
      id: 3001,
      email: 'customer@example.com',
      firstName: 'John',
      lastName: 'Doe',
      type: 'customer',
    },
    createdAt: new Date().toISOString(),
    _links: {
      self: { href: 'https://api.helpscout.net/v2/conversations/1001/threads/6001' },
    },
    ...overrides,
  }
}

// =============================================================================
// Client Tests
// =============================================================================

describe('@dotdo/helpscout - Client', () => {
  describe('initialization', () => {
    it('should create a client with OAuth credentials', () => {
      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
      })
      expect(client).toBeDefined()
      expect(client.conversations).toBeDefined()
      expect(client.customers).toBeDefined()
      expect(client.mailboxes).toBeDefined()
      expect(client.users).toBeDefined()
      expect(client.tags).toBeDefined()
      expect(client.savedReplies).toBeDefined()
    })

    it('should throw error without OAuth credentials', () => {
      expect(() => new Client({} as any)).toThrow(
        'OAuth credentials are required'
      )
    })

    it('should throw error without access token', () => {
      expect(
        () =>
          new Client({
            oauth: {
              clientId: 'test_client_id',
              clientSecret: 'test_client_secret',
            },
          })
      ).toThrow('Access token is required')
    })
  })

  describe('error handling', () => {
    it('should throw HelpScoutError on API errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v2/conversations/999999',
            {
              status: 404,
              body: {
                status: 404,
                error: 'Not Found',
                message: 'Conversation not found',
              },
            },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      await expect(client.conversations.get(999999)).rejects.toThrow(HelpScoutError)

      try {
        await client.conversations.get(999999)
      } catch (error) {
        expect(error).toBeInstanceOf(HelpScoutError)
        const helpScoutError = error as HelpScoutError
        expect(helpScoutError.statusCode).toBe(404)
      }
    })
  })
})

// =============================================================================
// Conversations Tests
// =============================================================================

describe('@dotdo/helpscout - Conversations', () => {
  describe('create', () => {
    it('should create a conversation', async () => {
      const expectedConversation = mockConversation()
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v2/conversations',
            {
              status: 201,
              body: expectedConversation,
            },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const conversation = await client.conversations.create({
        subject: 'Help needed',
        customer: { email: 'customer@example.com' },
        mailboxId: 1,
        type: 'email',
        threads: [{ type: 'customer', text: 'I need help with...' }],
      })

      expect(conversation.id).toBe(1001)
      expect(conversation.subject).toBe('Help needed')
    })
  })

  describe('get', () => {
    it('should get a conversation by ID', async () => {
      const expectedConversation = mockConversation()
      const mockFetch = createMockFetch(
        new Map([['GET /v2/conversations/1001', { status: 200, body: expectedConversation }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const conversation = await client.conversations.get(1001)

      expect(conversation.id).toBe(1001)
      expect(conversation.subject).toBe('Help needed')
    })
  })

  describe('update', () => {
    it('should update conversation status', async () => {
      const mockFetch = createMockFetch(
        new Map([['PATCH /v2/conversations/1001', { status: 204, body: {} }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      await client.conversations.update(1001, [
        { op: 'replace', path: '/status', value: 'closed' },
      ])

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/conversations/1001'),
        expect.objectContaining({ method: 'PATCH' })
      )
    })

    it('should assign a conversation to an agent', async () => {
      const mockFetch = createMockFetch(
        new Map([['PATCH /v2/conversations/1001', { status: 204, body: {} }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      await client.conversations.update(1001, [
        { op: 'replace', path: '/assignTo', value: 2001 },
      ])

      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('delete', () => {
    it('should delete a conversation', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /v2/conversations/1001', { status: 204, body: {} }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      await client.conversations.delete(1001)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/conversations/1001'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  describe('list', () => {
    it('should list conversations', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v2/conversations',
            {
              status: 200,
              body: {
                _embedded: {
                  conversations: [mockConversation({ id: 1001 }), mockConversation({ id: 1002 })],
                },
                _links: { self: { href: 'https://api.helpscout.net/v2/conversations' } },
                page: { size: 25, totalElements: 2, totalPages: 1, number: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const result = await client.conversations.list()

      expect(result._embedded.conversations).toHaveLength(2)
      expect(result.page.totalElements).toBe(2)
    })

    it('should filter conversations by mailbox', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v2/conversations',
            {
              status: 200,
              body: {
                _embedded: { conversations: [mockConversation()] },
                _links: { self: { href: 'https://api.helpscout.net/v2/conversations' } },
                page: { size: 25, totalElements: 1, totalPages: 1, number: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const result = await client.conversations.list({ mailbox: 1 })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('mailbox=1'),
        expect.anything()
      )
    })
  })

  describe('search', () => {
    it('should search conversations by query', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v2/search/conversations',
            {
              status: 200,
              body: {
                _embedded: { conversations: [mockConversation()] },
                _links: { self: { href: 'https://api.helpscout.net/v2/search/conversations' } },
                page: { size: 25, totalElements: 1, totalPages: 1, number: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const result = await client.conversations.search({ query: 'status:active' })

      expect(result._embedded.conversations).toHaveLength(1)
    })
  })

  describe('threads', () => {
    it('should list threads for a conversation', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v2/conversations/1001/threads',
            {
              status: 200,
              body: {
                _embedded: { threads: [mockThread({ id: 6001 }), mockThread({ id: 6002 })] },
                _links: { self: { href: 'https://api.helpscout.net/v2/conversations/1001/threads' } },
                page: { size: 25, totalElements: 2, totalPages: 1, number: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const result = await client.conversations.listThreads(1001)

      expect(result._embedded.threads).toHaveLength(2)
    })

    it('should create a customer thread', async () => {
      const expectedThread = mockThread()
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v2/conversations/1001/customer',
            { status: 201, body: expectedThread },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const thread = await client.conversations.createCustomerThread(1001, {
        text: 'Follow up on my request',
        customer: { email: 'customer@example.com' },
      })

      expect(thread.type).toBe('customer')
    })

    it('should create a reply thread', async () => {
      const expectedThread = mockThread({ type: 'reply' })
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v2/conversations/1001/reply',
            { status: 201, body: expectedThread },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const thread = await client.conversations.createReply(1001, {
        text: 'Here is my reply',
        user: 2001,
      })

      expect(thread.type).toBe('reply')
    })

    it('should create a note', async () => {
      const expectedThread = mockThread({ type: 'note' })
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v2/conversations/1001/notes',
            { status: 201, body: expectedThread },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const thread = await client.conversations.createNote(1001, {
        text: 'Internal note',
        user: 2001,
      })

      expect(thread.type).toBe('note')
    })
  })
})

// =============================================================================
// Customers Tests
// =============================================================================

describe('@dotdo/helpscout - Customers', () => {
  describe('create', () => {
    it('should create a customer', async () => {
      const expectedCustomer = mockCustomer()
      const mockFetch = createMockFetch(
        new Map([['POST /v2/customers', { status: 201, body: expectedCustomer }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const customer = await client.customers.create({
        firstName: 'John',
        lastName: 'Doe',
        emails: [{ type: 'work', value: 'john@example.com' }],
      })

      expect(customer.id).toBe(3001)
      expect(customer.firstName).toBe('John')
    })
  })

  describe('get', () => {
    it('should get a customer by ID', async () => {
      const expectedCustomer = mockCustomer()
      const mockFetch = createMockFetch(
        new Map([['GET /v2/customers/3001', { status: 200, body: expectedCustomer }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const customer = await client.customers.get(3001)

      expect(customer.id).toBe(3001)
      expect(customer.firstName).toBe('John')
    })
  })

  describe('update', () => {
    it('should update a customer', async () => {
      const updatedCustomer = mockCustomer({ firstName: 'Jane' })
      const mockFetch = createMockFetch(
        new Map([['PUT /v2/customers/3001', { status: 200, body: updatedCustomer }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const customer = await client.customers.update(3001, {
        firstName: 'Jane',
      })

      expect(customer.firstName).toBe('Jane')
    })
  })

  describe('list', () => {
    it('should list customers', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v2/customers',
            {
              status: 200,
              body: {
                _embedded: { customers: [mockCustomer({ id: 3001 }), mockCustomer({ id: 3002 })] },
                _links: { self: { href: 'https://api.helpscout.net/v2/customers' } },
                page: { size: 25, totalElements: 2, totalPages: 1, number: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const result = await client.customers.list()

      expect(result._embedded.customers).toHaveLength(2)
    })
  })

  describe('delete', () => {
    it('should delete a customer', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /v2/customers/3001', { status: 204, body: {} }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      await client.customers.delete(3001)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/customers/3001'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })
})

// =============================================================================
// Mailboxes Tests
// =============================================================================

describe('@dotdo/helpscout - Mailboxes', () => {
  describe('list', () => {
    it('should list mailboxes', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v2/mailboxes',
            {
              status: 200,
              body: {
                _embedded: { mailboxes: [mockMailbox({ id: 1 }), mockMailbox({ id: 2 })] },
                _links: { self: { href: 'https://api.helpscout.net/v2/mailboxes' } },
                page: { size: 25, totalElements: 2, totalPages: 1, number: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const result = await client.mailboxes.list()

      expect(result._embedded.mailboxes).toHaveLength(2)
    })
  })

  describe('get', () => {
    it('should get a mailbox by ID', async () => {
      const expectedMailbox = mockMailbox()
      const mockFetch = createMockFetch(
        new Map([['GET /v2/mailboxes/1', { status: 200, body: expectedMailbox }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const mailbox = await client.mailboxes.get(1)

      expect(mailbox.id).toBe(1)
      expect(mailbox.name).toBe('Support')
    })
  })

  describe('folders', () => {
    it('should list folders for a mailbox', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v2/mailboxes/1/folders',
            {
              status: 200,
              body: {
                _embedded: { folders: [mockFolder({ id: 1 }), mockFolder({ id: 2 })] },
                _links: { self: { href: 'https://api.helpscout.net/v2/mailboxes/1/folders' } },
                page: { size: 25, totalElements: 2, totalPages: 1, number: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const result = await client.mailboxes.listFolders(1)

      expect(result._embedded.folders).toHaveLength(2)
    })
  })
})

// =============================================================================
// Users Tests
// =============================================================================

describe('@dotdo/helpscout - Users', () => {
  describe('list', () => {
    it('should list users', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v2/users',
            {
              status: 200,
              body: {
                _embedded: { users: [mockUser({ id: 2001 }), mockUser({ id: 2002 })] },
                _links: { self: { href: 'https://api.helpscout.net/v2/users' } },
                page: { size: 25, totalElements: 2, totalPages: 1, number: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const result = await client.users.list()

      expect(result._embedded.users).toHaveLength(2)
    })
  })

  describe('get', () => {
    it('should get a user by ID', async () => {
      const expectedUser = mockUser()
      const mockFetch = createMockFetch(
        new Map([['GET /v2/users/2001', { status: 200, body: expectedUser }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const user = await client.users.get(2001)

      expect(user.id).toBe(2001)
      expect(user.firstName).toBe('Support')
    })
  })

  describe('me', () => {
    it('should get the current user', async () => {
      const expectedUser = mockUser()
      const mockFetch = createMockFetch(
        new Map([['GET /v2/users/me', { status: 200, body: expectedUser }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const user = await client.users.me()

      expect(user.id).toBe(2001)
    })
  })
})

// =============================================================================
// Tags Tests
// =============================================================================

describe('@dotdo/helpscout - Tags', () => {
  describe('list', () => {
    it('should list tags', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v2/tags',
            {
              status: 200,
              body: {
                _embedded: { tags: [mockTag({ id: 4001 }), mockTag({ id: 4002 })] },
                _links: { self: { href: 'https://api.helpscout.net/v2/tags' } },
                page: { size: 25, totalElements: 2, totalPages: 1, number: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const result = await client.tags.list()

      expect(result._embedded.tags).toHaveLength(2)
    })
  })
})

// =============================================================================
// Saved Replies Tests
// =============================================================================

describe('@dotdo/helpscout - Saved Replies', () => {
  describe('list', () => {
    it('should list saved replies for a mailbox', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v2/mailboxes/1/saved-replies',
            {
              status: 200,
              body: {
                _embedded: {
                  'saved-replies': [mockSavedReply({ id: 5001 }), mockSavedReply({ id: 5002 })],
                },
                _links: { self: { href: 'https://api.helpscout.net/v2/mailboxes/1/saved-replies' } },
                page: { size: 25, totalElements: 2, totalPages: 1, number: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const result = await client.savedReplies.list(1)

      expect(result._embedded['saved-replies']).toHaveLength(2)
    })
  })

  describe('get', () => {
    it('should get a saved reply by ID', async () => {
      const expectedSavedReply = mockSavedReply()
      const mockFetch = createMockFetch(
        new Map([['GET /v2/mailboxes/1/saved-replies/5001', { status: 200, body: expectedSavedReply }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const savedReply = await client.savedReplies.get(1, 5001)

      expect(savedReply.id).toBe(5001)
      expect(savedReply.name).toBe('Greeting')
    })
  })

  describe('create', () => {
    it('should create a saved reply', async () => {
      const expectedSavedReply = mockSavedReply()
      const mockFetch = createMockFetch(
        new Map([['POST /v2/saved-replies', { status: 201, body: expectedSavedReply }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const savedReply = await client.savedReplies.create({
        mailboxId: 1,
        name: 'Greeting',
        text: 'Thank you for contacting us!',
      })

      expect(savedReply.id).toBe(5001)
    })
  })

  describe('update', () => {
    it('should update a saved reply', async () => {
      const updatedSavedReply = mockSavedReply({ name: 'Updated Greeting' })
      const mockFetch = createMockFetch(
        new Map([['PUT /v2/saved-replies/5001', { status: 200, body: updatedSavedReply }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const savedReply = await client.savedReplies.update(5001, {
        name: 'Updated Greeting',
      })

      expect(savedReply.name).toBe('Updated Greeting')
    })
  })

  describe('delete', () => {
    it('should delete a saved reply', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /v2/saved-replies/5001', { status: 204, body: {} }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      await client.savedReplies.delete(5001)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/saved-replies/5001'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })
})

// =============================================================================
// Additional Tags Tests
// =============================================================================

describe('@dotdo/helpscout - Tags (Extended)', () => {
  describe('create', () => {
    it('should create a tag', async () => {
      const expectedTag = mockTag()
      const mockFetch = createMockFetch(
        new Map([['POST /v2/tags', { status: 201, body: expectedTag }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const tag = await client.tags.create({
        tag: 'billing',
        color: '#3498db',
      })

      expect(tag.id).toBe(4001)
      expect(tag.tag).toBe('billing')
    })
  })

  describe('delete', () => {
    it('should delete a tag', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /v2/tags/4001', { status: 204, body: {} }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      await client.tags.delete(4001)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/tags/4001'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })
})

// =============================================================================
// Webhooks Tests
// =============================================================================

describe('@dotdo/helpscout - Webhooks', () => {
  describe('list', () => {
    it('should list webhooks', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v2/webhooks',
            {
              status: 200,
              body: {
                _embedded: {
                  webhooks: [
                    {
                      id: 7001,
                      url: 'https://example.com/webhook',
                      events: ['convo.created'],
                      state: 'enabled',
                      secret: 'secret123',
                      payloadVersion: '1.0',
                      _links: { self: { href: 'https://api.helpscout.net/v2/webhooks/7001' } },
                    },
                  ],
                },
                _links: { self: { href: 'https://api.helpscout.net/v2/webhooks' } },
                page: { size: 25, totalElements: 1, totalPages: 1, number: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const result = await client.webhooks.list()

      expect(result._embedded.webhooks).toHaveLength(1)
    })
  })

  describe('get', () => {
    it('should get a webhook by ID', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v2/webhooks/7001',
            {
              status: 200,
              body: {
                id: 7001,
                url: 'https://example.com/webhook',
                events: ['convo.created'],
                state: 'enabled',
                secret: 'secret123',
                payloadVersion: '1.0',
                _links: { self: { href: 'https://api.helpscout.net/v2/webhooks/7001' } },
              },
            },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const webhook = await client.webhooks.get(7001)

      expect(webhook.id).toBe(7001)
      expect(webhook.url).toBe('https://example.com/webhook')
    })
  })

  describe('create', () => {
    it('should create a webhook', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v2/webhooks',
            {
              status: 201,
              body: {
                id: 7001,
                url: 'https://example.com/webhook',
                events: ['convo.created'],
                state: 'enabled',
                secret: 'secret123',
                payloadVersion: '1.0',
                _links: { self: { href: 'https://api.helpscout.net/v2/webhooks/7001' } },
              },
            },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const webhook = await client.webhooks.create({
        url: 'https://example.com/webhook',
        events: ['convo.created'],
        secret: 'secret123',
      })

      expect(webhook.id).toBe(7001)
    })
  })

  describe('update', () => {
    it('should update a webhook', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'PUT /v2/webhooks/7001',
            {
              status: 200,
              body: {
                id: 7001,
                url: 'https://example.com/updated-webhook',
                events: ['convo.created', 'convo.updated'],
                state: 'enabled',
                secret: 'secret123',
                payloadVersion: '1.0',
                _links: { self: { href: 'https://api.helpscout.net/v2/webhooks/7001' } },
              },
            },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const webhook = await client.webhooks.update(7001, {
        url: 'https://example.com/updated-webhook',
        events: ['convo.created', 'convo.updated'],
        secret: 'secret123',
      })

      expect(webhook.url).toBe('https://example.com/updated-webhook')
    })
  })

  describe('delete', () => {
    it('should delete a webhook', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /v2/webhooks/7001', { status: 204, body: {} }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      await client.webhooks.delete(7001)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/webhooks/7001'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })
})

// =============================================================================
// Additional Conversations Tests
// =============================================================================

describe('@dotdo/helpscout - Conversations (Extended)', () => {
  describe('updateTags', () => {
    it('should update conversation tags', async () => {
      const mockFetch = createMockFetch(
        new Map([['PUT /v2/conversations/1001/tags', { status: 204, body: {} }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      await client.conversations.updateTags(1001, ['billing', 'urgent'])

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/conversations/1001/tags'),
        expect.objectContaining({ method: 'PUT' })
      )
    })
  })

  describe('updateCustomFields', () => {
    it('should update conversation custom fields', async () => {
      const mockFetch = createMockFetch(
        new Map([['PUT /v2/conversations/1001/fields', { status: 204, body: {} }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      await client.conversations.updateCustomFields(1001, [
        { id: 1, value: 'custom value' },
      ])

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/conversations/1001/fields'),
        expect.objectContaining({ method: 'PUT' })
      )
    })
  })

  describe('conversation statuses', () => {
    it('should create a pending conversation', async () => {
      const expectedConversation = mockConversation({ status: 'pending' })
      const mockFetch = createMockFetch(
        new Map([['POST /v2/conversations', { status: 201, body: expectedConversation }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const conversation = await client.conversations.create({
        subject: 'Pending request',
        customer: { email: 'customer@example.com' },
        mailboxId: 1,
        type: 'email',
        status: 'pending',
        threads: [{ type: 'customer', text: 'Waiting for info...' }],
      })

      expect(conversation.status).toBe('pending')
    })

    it('should create a closed conversation', async () => {
      const expectedConversation = mockConversation({ status: 'closed' })
      const mockFetch = createMockFetch(
        new Map([['POST /v2/conversations', { status: 201, body: expectedConversation }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const conversation = await client.conversations.create({
        subject: 'Resolved ticket',
        customer: { email: 'customer@example.com' },
        mailboxId: 1,
        type: 'email',
        status: 'closed',
        threads: [{ type: 'customer', text: 'Issue resolved.' }],
      })

      expect(conversation.status).toBe('closed')
    })
  })

  describe('conversation types', () => {
    it('should create a phone conversation', async () => {
      const expectedConversation = mockConversation({ type: 'phone' })
      const mockFetch = createMockFetch(
        new Map([['POST /v2/conversations', { status: 201, body: expectedConversation }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const conversation = await client.conversations.create({
        subject: 'Phone call',
        customer: { email: 'customer@example.com' },
        mailboxId: 1,
        type: 'phone',
        threads: [{ type: 'phone', text: 'Customer called about...' }],
      })

      expect(conversation.type).toBe('phone')
    })

    it('should create a chat conversation', async () => {
      const expectedConversation = mockConversation({ type: 'chat' })
      const mockFetch = createMockFetch(
        new Map([['POST /v2/conversations', { status: 201, body: expectedConversation }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const conversation = await client.conversations.create({
        subject: 'Live chat',
        customer: { email: 'customer@example.com' },
        mailboxId: 1,
        type: 'chat',
        threads: [{ type: 'customer', text: 'Hi, I need help...' }],
      })

      expect(conversation.type).toBe('chat')
    })
  })
})

// =============================================================================
// Additional Customers Tests
// =============================================================================

describe('@dotdo/helpscout - Customers (Extended)', () => {
  describe('search', () => {
    it('should search customers by query', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v2/search/customers',
            {
              status: 200,
              body: {
                _embedded: { customers: [mockCustomer()] },
                _links: { self: { href: 'https://api.helpscout.net/v2/search/customers' } },
                page: { size: 25, totalElements: 1, totalPages: 1, number: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const result = await client.customers.search({ query: 'email:john@example.com' })

      expect(result._embedded.customers).toHaveLength(1)
    })
  })

  describe('listConversations', () => {
    it('should list conversations for a customer', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v2/customers/3001/conversations',
            {
              status: 200,
              body: {
                _embedded: { conversations: [mockConversation()] },
                _links: { self: { href: 'https://api.helpscout.net/v2/customers/3001/conversations' } },
                page: { size: 25, totalElements: 1, totalPages: 1, number: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const result = await client.customers.listConversations(3001)

      expect(result._embedded.conversations).toHaveLength(1)
    })
  })

  describe('addEmail', () => {
    it('should add an email to a customer', async () => {
      const mockFetch = createMockFetch(
        new Map([['POST /v2/customers/3001/emails', { status: 204, body: {} }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      await client.customers.addEmail(3001, { type: 'work', value: 'john.work@example.com' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/customers/3001/emails'),
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  describe('deleteEmail', () => {
    it('should delete an email from a customer', async () => {
      const mockFetch = createMockFetch(
        new Map([['DELETE /v2/customers/3001/emails/8001', { status: 204, body: {} }]])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      await client.customers.deleteEmail(3001, 8001)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/customers/3001/emails/8001'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })
})

// =============================================================================
// Additional Users Tests
// =============================================================================

describe('@dotdo/helpscout - Users (Extended)', () => {
  describe('listByMailbox', () => {
    it('should list users in a mailbox', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v2/mailboxes/1/users',
            {
              status: 200,
              body: {
                _embedded: { users: [mockUser({ id: 2001 }), mockUser({ id: 2002 })] },
                _links: { self: { href: 'https://api.helpscout.net/v2/mailboxes/1/users' } },
                page: { size: 25, totalElements: 2, totalPages: 1, number: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const result = await client.users.listByMailbox(1)

      expect(result._embedded.users).toHaveLength(2)
    })
  })
})

// =============================================================================
// Additional Mailboxes Tests
// =============================================================================

describe('@dotdo/helpscout - Mailboxes (Extended)', () => {
  describe('listFields', () => {
    it('should list custom fields for a mailbox', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v2/mailboxes/1/fields',
            {
              status: 200,
              body: {
                _embedded: {
                  fields: [
                    {
                      id: 1,
                      name: 'Priority Level',
                      type: 'dropdown',
                      required: true,
                      order: 1,
                      options: [
                        { id: 1, label: 'Low', order: 1 },
                        { id: 2, label: 'High', order: 2 },
                      ],
                      _links: { self: { href: 'https://api.helpscout.net/v2/mailboxes/1/fields/1' } },
                    },
                  ],
                },
                _links: { self: { href: 'https://api.helpscout.net/v2/mailboxes/1/fields' } },
                page: { size: 25, totalElements: 1, totalPages: 1, number: 1 },
              },
            },
          ],
        ])
      )

      const client = new Client({
        oauth: {
          clientId: 'test_client_id',
          clientSecret: 'test_client_secret',
          accessToken: 'test_access_token',
        },
        fetch: mockFetch,
      })

      const result = await client.mailboxes.listFields(1)

      expect(result._embedded.fields).toHaveLength(1)
      expect(result._embedded.fields[0].name).toBe('Priority Level')
    })
  })
})
