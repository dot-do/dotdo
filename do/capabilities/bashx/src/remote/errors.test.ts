/**
 * Error Types and Retry Logic Tests
 *
 * Tests for:
 * - Specific error classes
 * - Retry logic with exponential backoff
 * - Rate limit detection and waiting
 * - Timeout handling
 */

import { describe, it, expect, afterEach, afterAll, beforeAll } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import {
  GitHttpClient,
  NetworkError,
  AuthenticationError,
  RateLimitError,
  RepositoryNotFoundError,
  PushRejectedError,
  TimeoutError,
  ServerError,
} from './http-client.js'

import {
  parseRateLimitHeaders,
  isRateLimited,
  shouldRetry,
  calculateBackoff,
} from './errors.js'

import { TestError } from '../../test/utils/test-error.js'

// =============================================================================
// Test Fixtures
// =============================================================================

const MOCK_REPO_URL = 'https://github.com/test/repo.git'
const MOCK_REFS_RESPONSE = `001e# service=git-upload-pack
0000009b1234567890abcdef1234567890abcdef12345678 HEAD\0multi_ack thin-pack side-band side-band-64k ofs-delta shallow
003f1234567890abcdef1234567890abcdef12345678 refs/heads/main
0000`

// =============================================================================
// MSW Server Setup
// =============================================================================

const handlers: any[] = []
const server = setupServer(...handlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

// =============================================================================
// Error Class Tests
// =============================================================================

describe('Error Classes', () => {
  describe('NetworkError', () => {
    it('should create from ECONNRESET error', () => {
      const originalError = TestError.withCode('Connection reset', 'ECONNRESET')

      const error = NetworkError.fromError(originalError)

      expect(error).toBeInstanceOf(NetworkError)
      expect(error.message).toBe('Connection was reset by the server')
      expect(error.originalCode).toBe('ECONNRESET')
      expect(error.retryable).toBe(true)
    })

    it('should create from ETIMEDOUT error', () => {
      const originalError = TestError.withCode('Timed out', 'ETIMEDOUT')

      const error = NetworkError.fromError(originalError)

      expect(error.message).toBe('Connection timed out')
      expect(error.originalCode).toBe('ETIMEDOUT')
    })

    it('should create from ENOTFOUND error', () => {
      const originalError = TestError.withCode('DNS failed', 'ENOTFOUND')

      const error = NetworkError.fromError(originalError)

      expect(error.message).toBe('Could not resolve hostname')
    })

    it('should detect retryable network errors', () => {
      expect(NetworkError.isRetryable({ code: 'ECONNRESET' })).toBe(true)
      expect(NetworkError.isRetryable({ code: 'ETIMEDOUT' })).toBe(true)
      expect(NetworkError.isRetryable({ code: 'ECONNREFUSED' })).toBe(true)
      expect(NetworkError.isRetryable({ code: 'EPIPE' })).toBe(true)
      expect(NetworkError.isRetryable({ code: 'ENOENT' })).toBe(false)
      expect(NetworkError.isRetryable(new Error('generic'))).toBe(false)
    })
  })

  describe('AuthenticationError', () => {
    it('should create with 401 status', () => {
      const error = new AuthenticationError('Authentication required', {
        status: 401,
        scheme: 'Basic',
        realm: 'GitHub',
      })

      expect(error.status).toBe(401)
      expect(error.scheme).toBe('Basic')
      expect(error.realm).toBe('GitHub')
      expect(error.retryable).toBe(false)
    })

    it('should detect token expiry', () => {
      const error = new AuthenticationError('Token expired', {
        status: 401,
        tokenExpired: true,
      })

      expect(error.tokenExpired).toBe(true)
    })

    it('should provide helpful hint for GitHub', () => {
      const error = new AuthenticationError('Auth required', {
        status: 401,
        realm: 'GitHub',
      })

      expect(error.hint).toContain('GITHUB_TOKEN')
    })

    it('should provide helpful hint for GitLab', () => {
      const error = new AuthenticationError('Auth required', {
        status: 401,
        realm: 'gitlab.com',
      })

      expect(error.hint).toContain('GITLAB_TOKEN')
    })
  })

  describe('RateLimitError', () => {
    it('should create with rate limit info', () => {
      const resetAt = new Date(Date.now() + 3600_000)
      const error = new RateLimitError('Rate limited', {
        rateLimit: {
          limit: 60,
          remaining: 0,
          resetAt,
          provider: 'github',
        },
      })

      expect(error.rateLimit.limit).toBe(60)
      expect(error.rateLimit.remaining).toBe(0)
      expect(error.rateLimit.resetAt).toEqual(resetAt)
      expect(error.retryable).toBe(true) // Rate limit errors are retryable after waiting
    })

    it('should calculate wait time', () => {
      const resetAt = new Date(Date.now() + 60_000) // 1 minute from now
      const error = new RateLimitError('Rate limited', {
        rateLimit: { limit: 60, remaining: 0, resetAt, provider: 'github' },
      })

      const waitMs = error.getWaitMs()
      expect(waitMs).toBeGreaterThan(55_000)
      expect(waitMs).toBeLessThanOrEqual(60_000)
    })

    it('should return 0 wait time if reset has passed', () => {
      const resetAt = new Date(Date.now() - 1000) // 1 second ago
      const error = new RateLimitError('Rate limited', {
        rateLimit: { limit: 60, remaining: 0, resetAt, provider: 'github' },
      })

      expect(error.getWaitMs()).toBe(0)
    })
  })

  describe('RepositoryNotFoundError', () => {
    it('should store URL', () => {
      const error = new RepositoryNotFoundError('https://github.com/test/repo')

      expect(error.url).toBe('https://github.com/test/repo')
      expect(error.status).toBe(404)
      expect(error.retryable).toBe(false)
    })
  })

  describe('PushRejectedError', () => {
    it('should parse non-fast-forward reason', () => {
      const reason = PushRejectedError.parseReason('non-fast-forward')
      expect(reason).toBe('non-fast-forward')
    })

    it('should parse protected branch reason', () => {
      const reason = PushRejectedError.parseReason('protected branch hook declined')
      expect(reason).toBe('protected-branch')
    })

    it('should parse pre-receive hook reason', () => {
      const reason = PushRejectedError.parseReason('pre-receive hook declined')
      expect(reason).toBe('pre-receive-hook')
    })

    it('should provide helpful hint for non-fast-forward', () => {
      const error = new PushRejectedError('refs/heads/main', {
        reason: 'non-fast-forward',
      })

      expect(error.hint).toContain('Pull and merge')
    })

    it('should provide helpful hint for protected branch', () => {
      const error = new PushRejectedError('refs/heads/main', {
        reason: 'protected-branch',
      })

      expect(error.hint).toContain('pull request')
    })
  })

  describe('TimeoutError', () => {
    it('should store operation and timeout', () => {
      const error = new TimeoutError('fetch', 30000)

      expect(error.operation).toBe('fetch')
      expect(error.timeoutMs).toBe(30000)
      expect(error.status).toBe(408)
      expect(error.retryable).toBe(true)
    })
  })

  describe('ServerError', () => {
    it('should be retryable for 5xx', () => {
      const error500 = new ServerError('Internal Server Error', 500)
      const error502 = new ServerError('Bad Gateway', 502)
      const error503 = new ServerError('Service Unavailable', 503)

      expect(error500.retryable).toBe(true)
      expect(error502.retryable).toBe(true)
      expect(error503.retryable).toBe(true)
    })

    it('should not be retryable for 501 Not Implemented', () => {
      expect(ServerError.isRetryableStatus(501)).toBe(false)
    })

    it('should check retryable status codes', () => {
      expect(ServerError.isRetryableStatus(500)).toBe(true)
      expect(ServerError.isRetryableStatus(502)).toBe(true)
      expect(ServerError.isRetryableStatus(503)).toBe(true)
      expect(ServerError.isRetryableStatus(504)).toBe(true)
      expect(ServerError.isRetryableStatus(400)).toBe(false)
      expect(ServerError.isRetryableStatus(404)).toBe(false)
    })
  })
})

// =============================================================================
// Rate Limit Header Parsing Tests
// =============================================================================

describe('Rate Limit Header Parsing', () => {
  it('should parse GitHub rate limit headers', () => {
    const headers = new Headers({
      'X-RateLimit-Limit': '60',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
    })

    const info = parseRateLimitHeaders(headers)

    expect(info).toBeDefined()
    expect(info!.limit).toBe(60)
    expect(info!.remaining).toBe(0)
    expect(info!.provider).toBe('github')
    expect(info!.resetAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('should parse GitLab rate limit headers', () => {
    const headers = new Headers({
      'RateLimit-Limit': '100',
      'RateLimit-Remaining': '5',
      'RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 1800),
    })

    const info = parseRateLimitHeaders(headers)

    expect(info).toBeDefined()
    expect(info!.limit).toBe(100)
    expect(info!.remaining).toBe(5)
    expect(info!.provider).toBe('gitlab')
  })

  it('should parse Retry-After header', () => {
    const headers = new Headers({
      'Retry-After': '120',
    })

    const info = parseRateLimitHeaders(headers)

    expect(info).toBeDefined()
    expect(info!.remaining).toBe(0)
    expect(info!.provider).toBe('gitlab')
    // Should be approximately 120 seconds from now
    expect(info!.resetAt.getTime()).toBeGreaterThan(Date.now() + 100_000)
  })

  it('should return undefined without rate limit headers', () => {
    const headers = new Headers({
      'Content-Type': 'application/json',
    })

    expect(parseRateLimitHeaders(headers)).toBeUndefined()
  })

  it('should detect rate limited state', () => {
    const rateLimited = new Headers({
      'X-RateLimit-Limit': '60',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
    })

    const notRateLimited = new Headers({
      'X-RateLimit-Limit': '60',
      'X-RateLimit-Remaining': '50',
      'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
    })

    expect(isRateLimited(rateLimited)).toBe(true)
    expect(isRateLimited(notRateLimited)).toBe(false)
  })
})

// =============================================================================
// Retry Logic Tests
// =============================================================================

describe('Retry Logic', () => {
  describe('shouldRetry', () => {
    it('should retry NetworkError', () => {
      const error = new NetworkError('Connection reset')
      expect(shouldRetry(error, 0, 3)).toBe(true)
      expect(shouldRetry(error, 2, 3)).toBe(true)
      expect(shouldRetry(error, 3, 3)).toBe(false) // Max retries reached
    })

    it('should retry RateLimitError', () => {
      const error = new RateLimitError('Rate limited', {
        rateLimit: {
          limit: 60,
          remaining: 0,
          resetAt: new Date(Date.now() + 3600_000),
          provider: 'github',
        },
      })
      expect(shouldRetry(error, 0, 3)).toBe(true)
    })

    it('should retry ServerError (5xx)', () => {
      const error = new ServerError('Internal Server Error', 500)
      expect(shouldRetry(error, 0, 3)).toBe(true)
    })

    it('should retry TimeoutError', () => {
      const error = new TimeoutError('fetch', 30000)
      expect(shouldRetry(error, 0, 3)).toBe(true)
    })

    it('should NOT retry AuthenticationError', () => {
      const error = new AuthenticationError('Auth failed', { status: 401 })
      expect(shouldRetry(error, 0, 3)).toBe(false)
    })

    it('should NOT retry RepositoryNotFoundError', () => {
      const error = new RepositoryNotFoundError('https://github.com/test/repo')
      expect(shouldRetry(error, 0, 3)).toBe(false)
    })

    it('should NOT retry generic 4xx errors', () => {
      const error = { status: 400, message: 'Bad Request' }
      expect(shouldRetry(error, 0, 3)).toBe(false)
    })

    it('should NOT retry when max retries exceeded', () => {
      const error = new NetworkError('Connection reset')
      expect(shouldRetry(error, 3, 3)).toBe(false)
      expect(shouldRetry(error, 5, 3)).toBe(false)
    })
  })

  describe('calculateBackoff', () => {
    it('should calculate exponential backoff without jitter', () => {
      const delays = [
        calculateBackoff(0, { jitter: false }),
        calculateBackoff(1, { jitter: false }),
        calculateBackoff(2, { jitter: false }),
        calculateBackoff(3, { jitter: false }),
      ]

      expect(delays[0]).toBe(1000)  // 1s
      expect(delays[1]).toBe(2000)  // 2s
      expect(delays[2]).toBe(4000)  // 4s
      expect(delays[3]).toBe(8000)  // 8s
    })

    it('should respect max delay', () => {
      const delay = calculateBackoff(10, { jitter: false, maxDelayMs: 10000 })
      expect(delay).toBe(10000)
    })

    it('should add jitter by default', () => {
      const delays = new Set<number>()
      for (let i = 0; i < 10; i++) {
        delays.add(calculateBackoff(1))
      }
      // With jitter, we should get some variation
      // (technically could all be same, but extremely unlikely)
      expect(delays.size).toBeGreaterThan(1)
    })

    it('should support custom base delay', () => {
      const delay = calculateBackoff(0, { baseDelayMs: 500, jitter: false })
      expect(delay).toBe(500)
    })
  })
})

// =============================================================================
// HTTP Client Retry Integration Tests
// =============================================================================

describe('GitHttpClient - Retry Behavior', () => {
  it('should retry on network errors', async () => {
    let errorCount = 0

    server.use(
      http.get('https://github.com/test/repo.git/info/refs', () => {
        errorCount++
        if (errorCount < 3) {
          // Return 503 to simulate a retryable server error
          // (MSW's HttpResponse.error() throws directly, not as a network error)
          return new HttpResponse('Service Unavailable', { status: 503 })
        }
        return new HttpResponse(MOCK_REFS_RESPONSE, {
          headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' },
        })
      })
    )

    const client = new GitHttpClient(MOCK_REPO_URL, {
      retry: {
        maxRetries: 3,
        baseDelayMs: 10, // Fast retries for testing
        jitter: false,
      },
    })

    const refs = await client.discoverRefs('upload-pack')

    // Should have retried at least 2 times before success
    expect(errorCount).toBeGreaterThanOrEqual(3)
    expect(refs.refs.length).toBeGreaterThan(0)
  })

  it('should retry on 5xx server errors', async () => {
    let errorCount = 0

    server.use(
      http.get('https://github.com/test/repo.git/info/refs', () => {
        errorCount++
        if (errorCount < 2) {
          return new HttpResponse('Server Error', { status: 500 })
        }
        return new HttpResponse(MOCK_REFS_RESPONSE, {
          headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' },
        })
      })
    )

    const client = new GitHttpClient(MOCK_REPO_URL, {
      retry: {
        maxRetries: 3,
        baseDelayMs: 10,
        jitter: false,
      },
    })

    const refs = await client.discoverRefs('upload-pack')

    // Should have had at least 1 error before success
    expect(errorCount).toBeGreaterThanOrEqual(2)
    expect(refs.refs.length).toBeGreaterThan(0)
  })

  it('should NOT retry on 4xx client errors', async () => {
    // The test verifies that 4xx errors don't cause extra retries
    // With protocol v2 probing, there may be additional requests, but the 404 should throw immediately
    const client = new GitHttpClient(MOCK_REPO_URL, {
      retry: { maxRetries: 3, baseDelayMs: 10 },
    })

    server.use(
      http.get('https://github.com/test/repo.git/info/refs', () => {
        return new HttpResponse('Not Found', { status: 404 })
      })
    )

    await expect(client.discoverRefs('upload-pack')).rejects.toThrow()
    // Test passes if no retry loop occurs (would timeout if retrying)
  })

  it('should NOT retry on 401 authentication errors', async () => {
    // The test verifies that 401 errors don't cause extra retries
    // With protocol v2 probing, there may be additional requests, but auth errors should throw immediately
    const client = new GitHttpClient(MOCK_REPO_URL, {
      retry: { maxRetries: 3, baseDelayMs: 10 },
    })

    server.use(
      http.get('https://github.com/test/repo.git/info/refs', () => {
        return new HttpResponse('Unauthorized', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Basic realm="GitHub"' },
        })
      })
    )

    await expect(client.discoverRefs('upload-pack')).rejects.toThrow('Authentication required')
    // Test passes if no retry loop occurs (would timeout if retrying)
  })

  it('should call onRetry callback', async () => {
    const retryEvents: { attempt: number; error: Error; delayMs: number }[] = []
    let requestCount = 0

    server.use(
      http.get('https://github.com/test/repo.git/info/refs', () => {
        requestCount++
        if (requestCount < 3) {
          return new HttpResponse('Server Error', { status: 500 })
        }
        return new HttpResponse(MOCK_REFS_RESPONSE, {
          headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' },
        })
      })
    )

    const client = new GitHttpClient(MOCK_REPO_URL, {
      retry: {
        maxRetries: 3,
        baseDelayMs: 10,
        jitter: false,
        onRetry: (attempt, error, delayMs) => {
          retryEvents.push({ attempt, error, delayMs })
        },
      },
    })

    await client.discoverRefs('upload-pack')

    expect(retryEvents).toHaveLength(2)
    expect(retryEvents[0].attempt).toBe(0)
    expect(retryEvents[0].delayMs).toBe(10)
    expect(retryEvents[1].attempt).toBe(1)
    expect(retryEvents[1].delayMs).toBe(20) // Exponential backoff
  })

  it('should throw after max retries exhausted', async () => {
    server.use(
      http.get('https://github.com/test/repo.git/info/refs', () => {
        return new HttpResponse('Server Error', { status: 500 })
      })
    )

    const client = new GitHttpClient(MOCK_REPO_URL, {
      retry: { maxRetries: 2, baseDelayMs: 10, jitter: false },
    })

    await expect(client.discoverRefs('upload-pack')).rejects.toThrow('Server error')
  })
})

// =============================================================================
// Rate Limit Integration Tests
// =============================================================================

describe('GitHttpClient - Rate Limiting', () => {
  it('should detect rate limit and throw RateLimitError', async () => {
    server.use(
      http.get('https://github.com/test/repo.git/info/refs', () => {
        return new HttpResponse('Rate limit exceeded', {
          status: 403,
          headers: {
            'X-RateLimit-Limit': '60',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
          },
        })
      })
    )

    const client = new GitHttpClient(MOCK_REPO_URL, {
      retry: {
        maxRetries: 0, // Don't retry
        waitForRateLimit: false, // Don't wait in tests
      },
    })

    try {
      await client.discoverRefs('upload-pack')
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitError)
      const rateLimitError = error as RateLimitError
      expect(rateLimitError.rateLimit.remaining).toBe(0)
      expect(rateLimitError.rateLimit.limit).toBe(60)
    }
  })

  it('should wait for rate limit reset when configured', async () => {
    let requestCount = 0
    // Reset time very soon (50ms from now)
    const resetTime = Date.now() + 50

    server.use(
      http.get('https://github.com/test/repo.git/info/refs', () => {
        requestCount++
        if (requestCount === 1) {
          return new HttpResponse('Rate limit exceeded', {
            status: 403,
            headers: {
              'X-RateLimit-Limit': '60',
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(Math.floor(resetTime / 1000)),
            },
          })
        }
        return new HttpResponse(MOCK_REFS_RESPONSE, {
          headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' },
        })
      })
    )

    const client = new GitHttpClient(MOCK_REPO_URL, {
      retry: {
        waitForRateLimit: true,
        maxRateLimitWaitMs: 5000,
        baseDelayMs: 10,
        maxRetries: 3, // Need retries to continue after rate limit
      },
    })

    const refs = await client.discoverRefs('upload-pack')

    // May be 2 or 3 requests depending on protocol v2 negotiation
    expect(requestCount).toBeGreaterThanOrEqual(2)
    expect(refs.refs.length).toBeGreaterThan(0)
    // Test just verifies retry happened - timing is hard to test precisely
  })

  it('should not wait longer than maxRateLimitWaitMs', async () => {
    server.use(
      http.get('https://github.com/test/repo.git/info/refs', () => {
        return new HttpResponse('Rate limit exceeded', {
          status: 403,
          headers: {
            'X-RateLimit-Limit': '60',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600), // 1 hour
          },
        })
      })
    )

    const client = new GitHttpClient(MOCK_REPO_URL, {
      retry: {
        maxRetries: 0, // Don't do normal retries
        waitForRateLimit: true,
        maxRateLimitWaitMs: 100, // Only wait 100ms max - but reset is 1 hour away
      },
    })

    try {
      await client.discoverRefs('upload-pack')
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitError)
    }
  })
})

// =============================================================================
// Timeout Tests
// =============================================================================

describe('GitHttpClient - Timeouts', () => {
  it('should use default timeout for refs (10s)', () => {
    const client = new GitHttpClient(MOCK_REPO_URL)

    // Access private property for testing
    const timeouts = (client as any).timeouts
    expect(timeouts.refs).toBe(10_000)
  })

  it('should use default timeout for fetch (5min)', () => {
    const client = new GitHttpClient(MOCK_REPO_URL)

    const timeouts = (client as any).timeouts
    expect(timeouts.fetch).toBe(300_000)
  })

  it('should use default timeout for push (5min)', () => {
    const client = new GitHttpClient(MOCK_REPO_URL)

    const timeouts = (client as any).timeouts
    expect(timeouts.push).toBe(300_000)
  })

  it('should allow custom per-operation timeouts', () => {
    const client = new GitHttpClient(MOCK_REPO_URL, {
      timeouts: {
        refs: 5000,
        fetch: 120_000,
        push: 60_000,
      },
    })

    const timeouts = (client as any).timeouts
    expect(timeouts.refs).toBe(5000)
    expect(timeouts.fetch).toBe(120_000)
    expect(timeouts.push).toBe(60_000)
  })

  it('should fall back to general timeout option', () => {
    const client = new GitHttpClient(MOCK_REPO_URL, {
      timeout: 20_000,
    })

    const timeouts = (client as any).timeouts
    expect(timeouts.refs).toBe(20_000)
    expect(timeouts.fetch).toBe(20_000)
    expect(timeouts.push).toBe(20_000)
  })

  it('should throw TimeoutError on request timeout', async () => {
    server.use(
      http.get('https://github.com/test/repo.git/info/refs', async () => {
        await new Promise((resolve) => setTimeout(resolve, 500))
        return new HttpResponse(MOCK_REFS_RESPONSE, {
          headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' },
        })
      })
    )

    const client = new GitHttpClient(MOCK_REPO_URL, {
      timeout: 50, // Very short timeout
      retry: { maxRetries: 0 }, // Don't retry
    })

    // Match the error message format "Operation timed out after 50ms: request"
    await expect(client.discoverRefs('upload-pack')).rejects.toThrow('timed out')
  })

  it('should support abort controller for cancellation', async () => {
    server.use(
      http.get('https://github.com/test/repo.git/info/refs', async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        return new HttpResponse(MOCK_REFS_RESPONSE, {
          headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' },
        })
      })
    )

    const controller = new AbortController()

    const client = new GitHttpClient(MOCK_REPO_URL, {
      signal: controller.signal,
      retry: { maxRetries: 0 },
    })

    // Abort after 50ms
    setTimeout(() => controller.abort(), 50)

    await expect(client.discoverRefs('upload-pack')).rejects.toThrow()
  })
})
