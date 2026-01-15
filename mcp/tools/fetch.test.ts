/**
 * MCP Fetch Tool Tests
 *
 * Tests for the fetch MCP tool covering:
 * - URL parsing (external, DO, resource)
 * - Response transformations
 * - Caching behavior
 * - Timeout handling
 * - Retry logic
 *
 * @module mcp/tools/fetch.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  fetchTool,
  parseUrl,
  generateCacheKey,
  transformResponse,
  fetchToolSchema,
  type FetchInput,
  type FetchContext,
  type FetchEnv,
} from './fetch'

// ============================================================================
// URL PARSING TESTS
// ============================================================================

describe('URL Parsing', () => {
  describe('parseUrl', () => {
    it('parses external URLs', () => {
      const result = parseUrl('https://api.example.com/data')

      expect(result.type).toBe('external')
      expect(result.externalUrl).toBe('https://api.example.com/data')
      expect(result.original).toBe('https://api.example.com/data')
    })

    it('parses external URLs with paths and query params', () => {
      const result = parseUrl('https://api.example.com/users/123?format=json')

      expect(result.type).toBe('external')
      expect(result.externalUrl).toBe('https://api.example.com/users/123?format=json')
    })

    it('parses DO references', () => {
      const result = parseUrl('do://Customer/cust-123')

      expect(result.type).toBe('do')
      expect(result.noun).toBe('Customer')
      expect(result.id).toBe('cust-123')
    })

    it('parses DO references with complex IDs', () => {
      const result = parseUrl('do://Order/ord-2026-01-15-abc123')

      expect(result.type).toBe('do')
      expect(result.noun).toBe('Order')
      expect(result.id).toBe('ord-2026-01-15-abc123')
    })

    it('parses resource paths with /things/ prefix', () => {
      const result = parseUrl('/things/Customer/cust-123')

      expect(result.type).toBe('resource')
      expect(result.resourceType).toBe('Customer')
      expect(result.id).toBe('cust-123')
    })

    it('parses resource paths shorthand', () => {
      const result = parseUrl('/Customer/cust-123')

      expect(result.type).toBe('resource')
      expect(result.resourceType).toBe('Customer')
      expect(result.id).toBe('cust-123')
    })

    it('throws on invalid DO reference format', () => {
      expect(() => parseUrl('do://InvalidFormat')).toThrow('Invalid DO reference format')
    })

    it('throws on invalid resource path format', () => {
      expect(() => parseUrl('/invalid')).toThrow('Invalid resource path format')
    })

    it('throws on invalid URL format', () => {
      expect(() => parseUrl('not a url at all')).toThrow('Invalid URL format')
    })
  })
})

// ============================================================================
// CACHE KEY GENERATION TESTS
// ============================================================================

describe('Cache Key Generation', () => {
  describe('generateCacheKey', () => {
    it('uses custom key when provided', () => {
      const params: FetchInput = {
        url: 'https://example.com',
        cache: { key: 'my-custom-key' },
      }

      const key = generateCacheKey(params)

      expect(key).toBe('fetch:my-custom-key')
    })

    it('generates consistent keys for same URL and method', () => {
      const params: FetchInput = {
        url: 'https://api.example.com/data',
        method: 'GET',
      }

      const key1 = generateCacheKey(params)
      const key2 = generateCacheKey(params)

      expect(key1).toBe(key2)
    })

    it('generates different keys for different URLs', () => {
      const params1: FetchInput = { url: 'https://example.com/a' }
      const params2: FetchInput = { url: 'https://example.com/b' }

      const key1 = generateCacheKey(params1)
      const key2 = generateCacheKey(params2)

      expect(key1).not.toBe(key2)
    })

    it('generates different keys for different methods', () => {
      const params1: FetchInput = { url: 'https://example.com', method: 'GET' }
      const params2: FetchInput = { url: 'https://example.com', method: 'POST' }

      const key1 = generateCacheKey(params1)
      const key2 = generateCacheKey(params2)

      expect(key1).not.toBe(key2)
    })

    it('includes body in cache key for POST requests', () => {
      const params1: FetchInput = {
        url: 'https://example.com',
        method: 'POST',
        body: { foo: 'bar' },
      }
      const params2: FetchInput = {
        url: 'https://example.com',
        method: 'POST',
        body: { foo: 'baz' },
      }

      const key1 = generateCacheKey(params1)
      const key2 = generateCacheKey(params2)

      expect(key1).not.toBe(key2)
    })
  })
})

// ============================================================================
// TRANSFORMATION TESTS
// ============================================================================

describe('Response Transformations', () => {
  const mockContext: FetchContext = {
    permissions: ['fetch'],
    env: {},
  }

  describe('transformResponse', () => {
    it('transforms JSON response', async () => {
      const mockResponse = new Response(JSON.stringify({ name: 'Alice' }), {
        headers: { 'Content-Type': 'application/json' },
      })

      const result = await transformResponse(mockResponse, 'json', mockContext)

      expect(result).toEqual({ name: 'Alice' })
    })

    it('transforms text response', async () => {
      const mockResponse = new Response('Hello, World!')

      const result = await transformResponse(mockResponse, 'text', mockContext)

      expect(result).toBe('Hello, World!')
    })

    it('transforms HTML to parsed content', async () => {
      const html = `
        <html>
          <head><title>Test Page</title></head>
          <body>
            <p>Hello</p>
            <a href="/link1">Link 1</a>
            <a href="/link2">Link 2</a>
          </body>
        </html>
      `
      const mockResponse = new Response(html)

      const result = (await transformResponse(mockResponse, 'html', mockContext)) as {
        title: string
        content: string
        links: string[]
      }

      expect(result.title).toBe('Test Page')
      expect(result.content).toContain('Hello')
      expect(result.links).toContain('/link1')
      expect(result.links).toContain('/link2')
    })

    it('transforms HTML to markdown', async () => {
      const html = `
        <h1>Title</h1>
        <p>Paragraph text</p>
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
        </ul>
        <a href="https://example.com">Link</a>
      `
      const mockResponse = new Response(html)

      const result = await transformResponse(mockResponse, 'markdown', mockContext)

      expect(result).toContain('# Title')
      expect(result).toContain('Paragraph text')
      expect(result).toContain('- Item 1')
      expect(result).toContain('[Link](https://example.com)')
    })

    it('throws when extract transform used without aiExtract', async () => {
      const mockResponse = new Response('Some content')

      await expect(transformResponse(mockResponse, 'extract', mockContext)).rejects.toThrow(
        'AI extraction not available',
      )
    })

    it('calls aiExtract for extract transform', async () => {
      const aiExtract = vi.fn().mockResolvedValue({ extracted: 'data' })
      const contextWithAI: FetchContext = {
        ...mockContext,
        aiExtract,
      }

      const mockResponse = new Response('Content to extract from')

      const result = await transformResponse(mockResponse, 'extract', contextWithAI)

      expect(aiExtract).toHaveBeenCalledWith('Content to extract from')
      expect(result).toEqual({ extracted: 'data' })
    })
  })
})

// ============================================================================
// FETCH TOOL TESTS
// ============================================================================

describe('fetchTool', () => {
  let mockEnv: FetchEnv

  beforeEach(() => {
    mockEnv = {}
    // Reset fetch mock
    vi.restoreAllMocks()
  })

  describe('permission checking', () => {
    it('throws when fetch permission not granted', async () => {
      const context: FetchContext = {
        permissions: [], // No permissions
        env: mockEnv,
      }

      await expect(
        fetchTool({ url: 'https://example.com' }, context),
      ).rejects.toThrow('Permission denied: fetch')
    })

    it('succeeds when fetch permission granted', async () => {
      const mockResponse = new Response(JSON.stringify({ data: 'test' }))
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

      const context: FetchContext = {
        permissions: ['fetch'],
        env: mockEnv,
      }

      const result = await fetchTool({ url: 'https://example.com' }, context)

      expect(result.status).toBe(200)
    })
  })

  describe('external URL fetching', () => {
    it('fetches external URL successfully', async () => {
      const mockResponse = new Response(JSON.stringify({ id: 1, name: 'Test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

      const context: FetchContext = {
        permissions: ['fetch'],
        env: mockEnv,
      }

      const result = await fetchTool({ url: 'https://api.example.com/data' }, context)

      expect(result.status).toBe(200)
      expect(result.source).toBe('external')
      expect(result.data).toEqual({ id: 1, name: 'Test' })
      expect(result.cached).toBe(false)
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })

    it('passes custom headers', async () => {
      const mockResponse = new Response('{}')
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

      const context: FetchContext = {
        permissions: ['fetch'],
        env: mockEnv,
      }

      await fetchTool(
        {
          url: 'https://api.example.com/data',
          headers: { Authorization: 'Bearer token123' },
        },
        context,
      )

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({
          headers: { Authorization: 'Bearer token123' },
        }),
      )
    })

    it('sends body for POST requests', async () => {
      const mockResponse = new Response('{}')
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

      const context: FetchContext = {
        permissions: ['fetch'],
        env: mockEnv,
      }

      await fetchTool(
        {
          url: 'https://api.example.com/data',
          method: 'POST',
          body: { name: 'Alice' },
        },
        context,
      )

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Alice' }),
        }),
      )
    })
  })

  describe('timeout handling', () => {
    it('throws on timeout', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 100)
          }),
      )

      const context: FetchContext = {
        permissions: ['fetch'],
        env: mockEnv,
      }

      await expect(
        fetchTool(
          {
            url: 'https://slow.example.com',
            timeout: 50,
          },
          context,
        ),
      ).rejects.toThrow(/timeout/i)
    })
  })

  describe('caching behavior', () => {
    it('returns cached response when available', async () => {
      const cachedResult = {
        status: 200,
        headers: {},
        data: { cached: true },
        cached: false,
        duration: 100,
        source: 'external' as const,
      }

      const mockKV = {
        get: vi.fn().mockResolvedValue(cachedResult),
        put: vi.fn(),
      }

      // No fetch mock needed - should return from cache without calling fetch
      const context: FetchContext = {
        permissions: ['fetch'],
        env: { CACHE: mockKV as unknown as KVNamespace },
      }

      const result = await fetchTool(
        {
          url: 'https://example.com',
          method: 'GET', // Explicitly set to GET for caching
          cache: { ttl: 300 },
          timeout: 5000,
        },
        context,
      )

      expect(result.cached).toBe(true)
      expect(result.data).toEqual({ cached: true })
      expect(mockKV.get).toHaveBeenCalled()
    })

    it('stores response in cache', async () => {
      const mockResponse = new Response(JSON.stringify({ fresh: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

      const mockKV = {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      }

      const context: FetchContext = {
        permissions: ['fetch'],
        env: { CACHE: mockKV as unknown as KVNamespace },
      }

      await fetchTool(
        {
          url: 'https://example.com',
          method: 'GET',
          cache: { ttl: 300 },
          timeout: 5000,
        },
        context,
      )

      expect(mockKV.put).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"fresh":true'),
        { expirationTtl: 300 },
      )
    })

    it('does not cache non-GET requests', async () => {
      const mockResponse = new Response('{}')
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

      const mockKV = {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn(),
      }

      const context: FetchContext = {
        permissions: ['fetch'],
        env: { CACHE: mockKV as unknown as KVNamespace },
      }

      await fetchTool(
        {
          url: 'https://example.com',
          method: 'POST',
          cache: { ttl: 300 },
        },
        context,
      )

      expect(mockKV.put).not.toHaveBeenCalled()
    })

    it('does not cache error responses', async () => {
      const mockResponse = new Response('Not Found', { status: 404 })
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

      const mockKV = {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn(),
      }

      const context: FetchContext = {
        permissions: ['fetch'],
        env: { CACHE: mockKV as unknown as KVNamespace },
      }

      await fetchTool(
        {
          url: 'https://example.com',
          transform: 'text',
          cache: { ttl: 300 },
        },
        context,
      )

      expect(mockKV.put).not.toHaveBeenCalled()
    })
  })

  describe('retry logic', () => {
    it('retries on 5xx errors', async () => {
      // Each call needs a fresh Response since body can only be read once
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementationOnce(() =>
          Promise.resolve(new Response(JSON.stringify({ error: 'fail' }), { status: 500 })),
        )
        .mockImplementationOnce(() =>
          Promise.resolve(new Response(JSON.stringify({ error: 'fail' }), { status: 503 })),
        )
        .mockImplementationOnce(() =>
          Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })),
        )

      const context: FetchContext = {
        permissions: ['fetch'],
        env: mockEnv,
      }

      const result = await fetchTool(
        {
          url: 'https://flaky.example.com',
          retries: 3,
          retryDelay: 10, // Fast for tests
          timeout: 5000,
        },
        context,
      )

      expect(fetchSpy).toHaveBeenCalledTimes(3)
      expect(result.status).toBe(200)
    })

    it('gives up after max retries', async () => {
      // Return fresh Response for each call
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        Promise.resolve(new Response('Server Error', { status: 500 })),
      )

      const context: FetchContext = {
        permissions: ['fetch'],
        env: mockEnv,
      }

      const result = await fetchTool(
        {
          url: 'https://broken.example.com',
          retries: 2,
          retryDelay: 10,
          transform: 'text',
          timeout: 5000,
        },
        context,
      )

      expect(result.status).toBe(500)
    })
  })

  describe('DO reference fetching', () => {
    it('routes to correct DO namespace', async () => {
      const mockStub = {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ id: 'cust-123', name: 'Alice' })),
        ),
      }

      const mockNamespace = {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'id-123' }),
        get: vi.fn().mockReturnValue(mockStub),
      }

      const context: FetchContext = {
        permissions: ['fetch'],
        env: { Customer: mockNamespace as unknown as DurableObjectNamespace },
      }

      const result = await fetchTool({ url: 'do://Customer/cust-123' }, context)

      expect(mockNamespace.idFromName).toHaveBeenCalledWith('cust-123')
      expect(mockNamespace.get).toHaveBeenCalled()
      expect(result.source).toBe('do')
      expect(result.data).toEqual({ id: 'cust-123', name: 'Alice' })
    })

    it('throws when DO namespace not bound', async () => {
      const context: FetchContext = {
        permissions: ['fetch'],
        env: {}, // No Customer namespace
      }

      await expect(fetchTool({ url: 'do://Customer/cust-123' }, context)).rejects.toThrow(
        'DO namespace not found: Customer',
      )
    })
  })

  describe('resource path fetching', () => {
    it('fetches resource via DO', async () => {
      const mockStub = {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ $id: 'cust-123', $type: 'Customer', name: 'Bob' })),
        ),
      }

      const mockNamespace = {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'id-123' }),
        get: vi.fn().mockReturnValue(mockStub),
      }

      const context: FetchContext = {
        permissions: ['fetch'],
        env: { Customer: mockNamespace as unknown as DurableObjectNamespace },
      }

      const result = await fetchTool({ url: '/things/Customer/cust-123' }, context)

      expect(result.source).toBe('resource')
      expect(result.data).toHaveProperty('$type', 'Customer')
    })

    it('throws when resource type namespace not bound', async () => {
      const context: FetchContext = {
        permissions: ['fetch'],
        env: {},
      }

      await expect(fetchTool({ url: '/things/Order/ord-123' }, context)).rejects.toThrow(
        'Resource type not found: Order',
      )
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Fetch Tool Integration', () => {
  it('full flow: external URL with JSON transform and caching', async () => {
    const mockResponse = new Response(
      JSON.stringify({
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    )
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    const mockKV = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn(),
    }

    const context: FetchContext = {
      permissions: ['fetch'],
      env: { CACHE: mockKV as unknown as KVNamespace },
    }

    const result = await fetchTool(
      {
        url: 'https://api.example.com/users',
        method: 'GET',
        transform: 'json',
        cache: { ttl: 600 },
        timeout: 5000,
      },
      context,
    )

    expect(result.status).toBe(200)
    expect(result.source).toBe('external')
    expect(result.cached).toBe(false)
    expect(result.data).toEqual({
      users: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    })
    expect(mockKV.put).toHaveBeenCalled()
  })

  it('full flow: HTML to markdown transform', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Blog Post</title></head>
        <body>
          <h1>Welcome to My Blog</h1>
          <p>This is the <strong>first</strong> paragraph.</p>
          <h2>Section 1</h2>
          <p>More content here with a <a href="https://example.com">link</a>.</p>
        </body>
      </html>
    `
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(html))

    const context: FetchContext = {
      permissions: ['fetch'],
      env: {},
    }

    const result = await fetchTool(
      {
        url: 'https://blog.example.com/post',
        transform: 'markdown',
      },
      context,
    )

    const markdown = result.data as string
    expect(markdown).toContain('# Welcome to My Blog')
    expect(markdown).toContain('**first**')
    expect(markdown).toContain('## Section 1')
    expect(markdown).toContain('[link](https://example.com)')
  })

  it('full flow: AI extraction transform', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('The price is $29.99 and stock is 150 units.'),
    )

    const aiExtract = vi.fn().mockResolvedValue({
      price: 29.99,
      stock: 150,
      currency: 'USD',
    })

    const context: FetchContext = {
      permissions: ['fetch'],
      env: {},
      aiExtract,
    }

    const result = await fetchTool(
      {
        url: 'https://shop.example.com/product',
        transform: 'extract',
      },
      context,
    )

    expect(aiExtract).toHaveBeenCalled()
    expect(result.data).toEqual({
      price: 29.99,
      stock: 150,
      currency: 'USD',
    })
  })
})
