import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createContext, type BenchmarkContext } from '../context'

describe('createContext', () => {
  it('should create context with target', async () => {
    const ctx = await createContext('promote.perf.do')
    expect(ctx.target).toBe('promote.perf.do')
  })

  it('should provide fetch method that targets the right host', async () => {
    const ctx = await createContext('promote.perf.do')
    expect(typeof ctx.fetch).toBe('function')

    // The fetch should be bound to the target
    // We test this by checking the URL construction
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{}', {
        headers: { 'cf-ray': '1234567890-SJC' },
      })
    )
    vi.stubGlobal('fetch', mockFetch)

    await ctx.fetch('/api/test')

    expect(mockFetch).toHaveBeenCalled()
    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('promote.perf.do')
    expect(url).toContain('/api/test')

    vi.unstubAllGlobals()
  })

  it('should extract colo from cf-ray header', async () => {
    const ctx = await createContext('promote.perf.do')

    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{}', {
        headers: { 'cf-ray': '8abc123def456-SJC' },
      })
    )
    vi.stubGlobal('fetch', mockFetch)

    await ctx.fetch('/api/test')

    expect(ctx.lastColoServed).toBe('SJC')

    vi.unstubAllGlobals()
  })

  it('should include custom headers in requests', async () => {
    const customHeaders = {
      Authorization: 'Bearer test-token',
      'X-Custom': 'value',
    }

    const ctx = await createContext('promote.perf.do', customHeaders)

    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{}', {
        headers: { 'cf-ray': '123-LAX' },
      })
    )
    vi.stubGlobal('fetch', mockFetch)

    await ctx.fetch('/api/test')

    const [, init] = mockFetch.mock.calls[0]
    expect(init.headers).toMatchObject(customHeaders)

    vi.unstubAllGlobals()
  })

  it('should merge request-specific headers with context headers', async () => {
    const ctx = await createContext('promote.perf.do', {
      Authorization: 'Bearer context-token',
    })

    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{}', {
        headers: { 'cf-ray': '123-SJC' },
      })
    )
    vi.stubGlobal('fetch', mockFetch)

    await ctx.fetch('/api/test', {
      headers: { 'X-Request-Specific': 'value' },
    })

    const [, init] = mockFetch.mock.calls[0]
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer context-token',
      'X-Request-Specific': 'value',
    })

    vi.unstubAllGlobals()
  })

  it('should provide typed DO client', async () => {
    const ctx = await createContext('promote.perf.do')
    expect(ctx.do).toBeDefined()
    expect(typeof ctx.do.get).toBe('function')
    expect(typeof ctx.do.create).toBe('function')
    expect(typeof ctx.do.list).toBe('function')
    expect(typeof ctx.do.delete).toBe('function')
  })

  it('should support colo hint header', async () => {
    const ctx = await createContext('promote.perf.do', {
      'cf-ipcolo': 'SJC',
    })

    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{}', {
        headers: { 'cf-ray': '123-SJC' },
      })
    )
    vi.stubGlobal('fetch', mockFetch)

    await ctx.fetch('/api/test')

    const [, init] = mockFetch.mock.calls[0]
    expect(init.headers['cf-ipcolo']).toBe('SJC')

    vi.unstubAllGlobals()
  })

  it('should use HTTPS by default', async () => {
    const ctx = await createContext('promote.perf.do')

    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{}', {
        headers: { 'cf-ray': '123-SJC' },
      })
    )
    vi.stubGlobal('fetch', mockFetch)

    await ctx.fetch('/api/test')

    const [url] = mockFetch.mock.calls[0]
    expect(url).toMatch(/^https:\/\//)

    vi.unstubAllGlobals()
  })

  it('should handle paths with or without leading slash', async () => {
    const ctx = await createContext('promote.perf.do')

    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{}', {
        headers: { 'cf-ray': '123-SJC' },
      })
    )
    vi.stubGlobal('fetch', mockFetch)

    await ctx.fetch('api/test')
    await ctx.fetch('/api/test')

    const urls = mockFetch.mock.calls.map(([url]) => url)
    // Both should result in same URL
    expect(urls[0]).toContain('/api/test')
    expect(urls[1]).toContain('/api/test')

    vi.unstubAllGlobals()
  })

  it('should track lastColoServed across multiple requests', async () => {
    const ctx = await createContext('promote.perf.do')

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{}', {
          headers: { 'cf-ray': '123-SJC' },
        })
      )
      .mockResolvedValueOnce(
        new Response('{}', {
          headers: { 'cf-ray': '456-LAX' },
        })
      )

    vi.stubGlobal('fetch', mockFetch)

    await ctx.fetch('/api/test1')
    expect(ctx.lastColoServed).toBe('SJC')

    await ctx.fetch('/api/test2')
    expect(ctx.lastColoServed).toBe('LAX')

    vi.unstubAllGlobals()
  })
})
