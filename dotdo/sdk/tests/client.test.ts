/**
 * Tests for DotdoClient
 *
 * Tests the programmatic SDK client for type-safety, error handling,
 * and correct API interaction patterns.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DotdoClient,
  createDotdoClient,
  DotdoSDKError,
  NotFoundError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  ServerError,
  NetworkError,
} from '../client'

describe('DotdoClient', () => {
  describe('constructor', () => {
    it('should create a client with baseUrl', () => {
      const client = new DotdoClient({
        baseUrl: 'https://test.api.dotdo.dev',
      })

      expect(client).toBeDefined()
      expect(client.things).toBeDefined()
      expect(client.events).toBeDefined()
      expect(client.relationships).toBeDefined()
    })

    it('should throw if baseUrl is missing', () => {
      expect(() => new DotdoClient({ baseUrl: '' })).toThrow('baseUrl is required')
    })

    it('should remove trailing slash from baseUrl', () => {
      const client = new DotdoClient({
        baseUrl: 'https://test.api.dotdo.dev/',
      })

      // Client should work without double slashes
      expect(client).toBeDefined()
    })

    it('should accept apiKey', () => {
      const client = new DotdoClient({
        baseUrl: 'https://test.api.dotdo.dev',
        apiKey: 'sk_test_xxx',
      })

      expect(client).toBeDefined()
    })

    it('should accept custom headers', () => {
      const client = new DotdoClient({
        baseUrl: 'https://test.api.dotdo.dev',
        headers: {
          'X-Custom-Header': 'value',
        },
      })

      expect(client).toBeDefined()
    })

    it('should accept timeout option', () => {
      const client = new DotdoClient({
        baseUrl: 'https://test.api.dotdo.dev',
        timeout: 5000,
      })

      expect(client).toBeDefined()
    })

    it('should accept retry options', () => {
      const client = new DotdoClient({
        baseUrl: 'https://test.api.dotdo.dev',
        retry: {
          maxAttempts: 5,
          initialDelay: 500,
        },
      })

      expect(client).toBeDefined()
    })
  })

  describe('createDotdoClient factory', () => {
    it('should create a client', () => {
      const client = createDotdoClient({
        baseUrl: 'https://test.api.dotdo.dev',
      })

      expect(client).toBeInstanceOf(DotdoClient)
    })
  })

  describe('things resource', () => {
    let client: DotdoClient
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn()
      client = new DotdoClient({
        baseUrl: 'https://test.api.dotdo.dev',
        fetch: mockFetch as typeof fetch,
      })
    })

    it('should list things', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: [
              { $id: 'thing_1', $type: 'Customer', name: 'Alice' },
              { $id: 'thing_2', $type: 'Customer', name: 'Bob' },
            ],
            hasMore: false,
          }),
      })

      const result = await client.things.list()

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.api.dotdo.dev/things',
        expect.objectContaining({
          method: 'GET',
        })
      )
      expect(result.data).toHaveLength(2)
      expect(result.hasMore).toBe(false)
    })

    it('should list things with filters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: [{ $id: 'thing_1', $type: 'Customer', name: 'Alice' }],
            hasMore: false,
          }),
      })

      await client.things.list({ $type: 'Customer', limit: 10 })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.api.dotdo.dev/things?%24type=Customer&limit=10',
        expect.any(Object)
      )
    })

    it('should get a thing by ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ $id: 'thing_1', $type: 'Customer', name: 'Alice' }),
      })

      const result = await client.things.get('thing_1')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.api.dotdo.dev/things/thing_1',
        expect.objectContaining({
          method: 'GET',
        })
      )
      expect(result.$id).toBe('thing_1')
    })

    it('should create a thing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () =>
          Promise.resolve({
            $id: 'thing_new',
            $type: 'Customer',
            name: 'Charlie',
            $createdAt: '2024-01-01T00:00:00Z',
          }),
      })

      const result = await client.things.create({
        $type: 'Customer',
        name: 'Charlie',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.api.dotdo.dev/things',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ $type: 'Customer', name: 'Charlie' }),
        })
      )
      expect(result.$id).toBe('thing_new')
    })

    it('should update a thing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            $id: 'thing_1',
            $type: 'Customer',
            name: 'Alice Updated',
            $updatedAt: '2024-01-02T00:00:00Z',
          }),
      })

      const result = await client.things.update('thing_1', {
        name: 'Alice Updated',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.api.dotdo.dev/things/thing_1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ name: 'Alice Updated' }),
        })
      )
      expect(result.name).toBe('Alice Updated')
    })

    it('should delete a thing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: () => Promise.reject('No content'),
      })

      await client.things.delete('thing_1')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.api.dotdo.dev/things/thing_1',
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })
  })

  describe('events resource', () => {
    let client: DotdoClient
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn()
      client = new DotdoClient({
        baseUrl: 'https://test.api.dotdo.dev',
        fetch: mockFetch as typeof fetch,
      })
    })

    it('should emit an event', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () =>
          Promise.resolve({
            $id: 'evt_1',
            type: 'Customer.signup',
            payload: { customerId: 'cust_1' },
            $timestamp: '2024-01-01T00:00:00Z',
          }),
      })

      const result = await client.events.emit({
        type: 'Customer.signup',
        payload: { customerId: 'cust_1' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.api.dotdo.dev/events',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            type: 'Customer.signup',
            payload: { customerId: 'cust_1' },
          }),
        })
      )
      expect(result.type).toBe('Customer.signup')
    })

    it('should list events', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: [{ $id: 'evt_1', type: 'Customer.signup' }],
            hasMore: false,
          }),
      })

      const result = await client.events.list()

      expect(result.data).toHaveLength(1)
    })
  })

  describe('relationships resource', () => {
    let client: DotdoClient
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn()
      client = new DotdoClient({
        baseUrl: 'https://test.api.dotdo.dev',
        fetch: mockFetch as typeof fetch,
      })
    })

    it('should add a relationship', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () =>
          Promise.resolve({
            $id: 'rel_1',
            subject: 'cust_1',
            predicate: 'hasOrder',
            object: 'order_1',
          }),
      })

      const result = await client.relationships.add({
        subject: 'cust_1',
        predicate: 'hasOrder',
        object: 'order_1',
      })

      expect(result.predicate).toBe('hasOrder')
    })

    it('should find relationships', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: [
              { $id: 'rel_1', subject: 'cust_1', predicate: 'hasOrder', object: 'order_1' },
              { $id: 'rel_2', subject: 'cust_1', predicate: 'hasOrder', object: 'order_2' },
            ],
          }),
      })

      const result = await client.relationships.find({
        subject: 'cust_1',
        predicate: 'hasOrder',
      })

      expect(result).toHaveLength(2)
    })
  })

  describe('RPC', () => {
    let client: DotdoClient
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn()
      client = new DotdoClient({
        baseUrl: 'https://test.api.dotdo.dev',
        fetch: mockFetch as typeof fetch,
      })
    })

    it('should make RPC calls', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ result: 42 }),
      })

      const result = await client.rpc<{ result: number }>('calculate', [1, 2])

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.api.dotdo.dev/rpc',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ method: 'calculate', args: [1, 2] }),
        })
      )
      expect(result.result).toBe(42)
    })
  })

  describe('error handling', () => {
    let client: DotdoClient
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn()
      client = new DotdoClient({
        baseUrl: 'https://test.api.dotdo.dev',
        fetch: mockFetch as typeof fetch,
      })
    })

    it('should throw NotFoundError for 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ error: 'Thing not found' }),
      })

      await expect(client.things.get('nonexistent')).rejects.toThrow(NotFoundError)
    })

    it('should throw ValidationError for 400', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () =>
          Promise.resolve({
            error: 'Validation failed',
            errors: [{ field: 'name', message: 'Required' }],
          }),
      })

      await expect(
        client.things.create({ $type: 'Customer' })
      ).rejects.toThrow(ValidationError)
    })

    it('should throw AuthenticationError for 401', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ error: 'Invalid API key' }),
      })

      await expect(client.things.list()).rejects.toThrow(AuthenticationError)
    })

    it('should throw AuthorizationError for 403', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: () => Promise.resolve({ error: 'Access denied' }),
      })

      await expect(client.things.list()).rejects.toThrow(AuthorizationError)
    })

    it('should throw RateLimitError for 429', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: {
          get: (name: string) => (name === 'Retry-After' ? '60' : null),
        },
        json: () => Promise.resolve({ error: 'Rate limit exceeded' }),
      })

      await expect(client.things.list()).rejects.toThrow(RateLimitError)
    })

    it('should throw ServerError for 500', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ error: 'Something went wrong' }),
      })

      await expect(client.things.list()).rejects.toThrow(ServerError)
    })

    it('should throw NetworkError for network failures', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'))

      await expect(client.things.list()).rejects.toThrow(NetworkError)
    })
  })

  describe('authentication', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
      })
    })

    it('should include Bearer token from apiKey', async () => {
      const client = new DotdoClient({
        baseUrl: 'https://test.api.dotdo.dev',
        apiKey: 'sk_test_xxx',
        fetch: mockFetch as typeof fetch,
      })

      await client.things.list()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sk_test_xxx',
          }),
        })
      )
    })

    it('should include Bearer token from token option', async () => {
      const client = new DotdoClient({
        baseUrl: 'https://test.api.dotdo.dev',
        token: 'jwt_token_xxx',
        fetch: mockFetch as typeof fetch,
      })

      await client.things.list()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer jwt_token_xxx',
          }),
        })
      )
    })

    it('should include custom headers', async () => {
      const client = new DotdoClient({
        baseUrl: 'https://test.api.dotdo.dev',
        headers: {
          'X-Tenant-ID': 'tenant_123',
        },
        fetch: mockFetch as typeof fetch,
      })

      await client.things.list()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Tenant-ID': 'tenant_123',
          }),
        })
      )
    })
  })

  describe('health and discovery', () => {
    let client: DotdoClient
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn()
      client = new DotdoClient({
        baseUrl: 'https://test.api.dotdo.dev',
        fetch: mockFetch as typeof fetch,
      })
    })

    it('should check health', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 'ok', uptime: 12345 }),
      })

      const result = await client.health()

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.api.dotdo.dev/health',
        expect.any(Object)
      )
      expect(result.status).toBe('ok')
    })

    it('should get root with HATEOAS links', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            name: 'dotdo',
            version: '1.0.0',
            _links: {
              self: { href: '/' },
              things: { href: '/things' },
            },
          }),
      })

      const result = await client.root()

      expect(result.name).toBe('dotdo')
      expect(result._links).toBeDefined()
    })
  })
})

describe('Error classes', () => {
  it('DotdoSDKError should have status and code', () => {
    const error = new DotdoSDKError('Test error', 400, 'TEST_ERROR')

    expect(error.message).toBe('Test error')
    expect(error.status).toBe(400)
    expect(error.code).toBe('TEST_ERROR')
    expect(error.name).toBe('DotdoSDKError')
  })

  it('NotFoundError should have status 404', () => {
    const error = new NotFoundError('Not found')

    expect(error.status).toBe(404)
    expect(error.code).toBe('NOT_FOUND')
  })

  it('ValidationError should include field errors', () => {
    const error = new ValidationError('Validation failed', [
      { field: 'name', message: 'Required' },
      { field: 'email', message: 'Invalid format' },
    ])

    expect(error.status).toBe(400)
    expect(error.errors).toHaveLength(2)
  })

  it('RateLimitError should include retryAfter', () => {
    const error = new RateLimitError('Rate limit exceeded', 60)

    expect(error.status).toBe(429)
    expect(error.retryAfter).toBe(60)
  })
})
