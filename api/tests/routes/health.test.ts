import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Health Endpoint Integration Tests
 *
 * These tests verify the /health and /api/health endpoints.
 * They use the Hono app's request() method for testing.
 *
 * Note: These tests require the Node environment to mock cloudflare:workers.
 * Unit tests for the health utility are in api/tests/health.test.ts.
 */

// Import the actual app (cloudflare:workers is mocked in node environment)
import { app } from '../../index'
import { clearNounConfigCache } from '../../utils/router'
import type { HealthStatus } from '../../utils/health'
import type { Env } from '../../types'

// ============================================================================
// MOCK ENVIRONMENT FACTORIES
// ============================================================================

function createFullEnv(): Env {
  return {
    DO: createMockDO(),
    BROWSER_DO: createMockDO(),
    SANDBOX_DO: createMockDO(),
    OBS_BROADCASTER: createMockDO(),
    COLLECTION_DO: createMockDO(),
    REPLICA_DO: createMockDO(),
    KV: createMockKV(),
    R2: createMockR2(),
    AI: createMockAI(),
    TEST_KV: createMockKV(),
    TEST_DO: createMockDO(),
    ASSETS: createMockFetcher(),
  } as Env
}

function createBrokenEnv(): Env {
  return {
    KV: createMockKV(),
    R2: createMockR2(),
  } as Env
}

function createDegradedEnv(): Env {
  return {
    DO: createMockDO(),
  } as Env
}

function createMockDO(): DurableObjectNamespace {
  return {
    idFromName: vi.fn().mockReturnValue({ toString: () => 'test-id' }),
    get: vi.fn().mockReturnValue({
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items: [] }),
      }),
    }),
  } as unknown as DurableObjectNamespace
}

function createMockKV(): KVNamespace {
  return {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  } as unknown as KVNamespace
}

function createMockR2(): R2Bucket {
  return {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    head: vi.fn(),
  } as unknown as R2Bucket
}

function createMockAI(): Ai {
  return {
    run: vi.fn(),
  } as unknown as Ai
}

function createMockFetcher(): Fetcher {
  return {
    fetch: vi.fn(),
  } as unknown as Fetcher
}

// ============================================================================
// TESTS
// ============================================================================

describe('GET /api/health', () => {
  beforeEach(() => {
    clearNounConfigCache()
    vi.clearAllMocks()
  })

  it('returns 200 for healthy system', async () => {
    const env = createFullEnv()
    const res = await app.request('/api/health', {
      method: 'GET',
    }, env)

    expect(res.status).toBe(200)
  })

  it('returns JSON content type', async () => {
    const env = createFullEnv()
    const res = await app.request('/api/health', {
      method: 'GET',
    }, env)

    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('returns proper health status structure', async () => {
    const env = createFullEnv()
    const res = await app.request('/api/health', {
      method: 'GET',
    }, env)

    const body = await res.json() as HealthStatus

    expect(body).toHaveProperty('status')
    expect(body).toHaveProperty('timestamp')
    expect(body).toHaveProperty('checks')
    expect(body.checks).toHaveProperty('cache')
    expect(body.checks).toHaveProperty('bindings')
  })

  it('includes version in response', async () => {
    const env = createFullEnv()
    const res = await app.request('/api/health', {
      method: 'GET',
    }, env)

    const body = await res.json() as HealthStatus

    expect(body.version).toBe('0.1.0')
  })

  it('returns 503 for unhealthy system', async () => {
    const env = createBrokenEnv()
    const res = await app.request('/api/health', {
      method: 'GET',
    }, env)

    expect(res.status).toBe(503)

    const body = await res.json() as HealthStatus
    expect(body.status).toBe('unhealthy')
  })

  it('returns 200 for degraded system', async () => {
    const env = createDegradedEnv()
    const res = await app.request('/api/health', {
      method: 'GET',
    }, env)

    expect(res.status).toBe(200)

    const body = await res.json() as HealthStatus
    expect(body.status).toBe('degraded')
  })

  it('reports cache statistics', async () => {
    const env = createFullEnv()
    const res = await app.request('/api/health', {
      method: 'GET',
    }, env)

    const body = await res.json() as HealthStatus

    expect(body.checks.cache).toHaveProperty('size')
    expect(body.checks.cache).toHaveProperty('maxSize')
    expect(body.checks.cache).toHaveProperty('ttlMs')
    expect(body.checks.cache).toHaveProperty('utilizationPercent')
  })

  it('reports binding availability', async () => {
    const env = createFullEnv()
    const res = await app.request('/api/health', {
      method: 'GET',
    }, env)

    const body = await res.json() as HealthStatus

    expect(body.checks.bindings).toHaveProperty('DO')
    expect(body.checks.bindings).toHaveProperty('BROWSER_DO')
    expect(body.checks.bindings).toHaveProperty('SANDBOX_DO')
    expect(body.checks.bindings).toHaveProperty('OBS_BROADCASTER')
  })
})

describe('GET /health', () => {
  beforeEach(() => {
    clearNounConfigCache()
    vi.clearAllMocks()
  })

  it('returns same response as /api/health', async () => {
    const env = createFullEnv()

    const res1 = await app.request('/health', { method: 'GET' }, env)
    const res2 = await app.request('/api/health', { method: 'GET' }, env)

    const body1 = await res1.json() as HealthStatus
    const body2 = await res2.json() as HealthStatus

    expect(body1.status).toBe(body2.status)
    expect(body1.version).toBe(body2.version)
    expect(body1.checks.bindings).toEqual(body2.checks.bindings)
  })

  it('returns 200 for healthy system', async () => {
    const env = createFullEnv()
    const res = await app.request('/health', {
      method: 'GET',
    }, env)

    expect(res.status).toBe(200)
  })
})

describe('Health Endpoint Method Handling', () => {
  beforeEach(() => {
    clearNounConfigCache()
    vi.clearAllMocks()
  })

  it('returns 405 for POST on /api/health', async () => {
    const env = createFullEnv()
    const res = await app.request('/api/health', {
      method: 'POST',
    }, env)

    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('GET')
  })

  it('returns 405 for PUT on /api/health', async () => {
    const env = createFullEnv()
    const res = await app.request('/api/health', {
      method: 'PUT',
    }, env)

    expect(res.status).toBe(405)
  })

  it('returns 405 for DELETE on /api/health', async () => {
    const env = createFullEnv()
    const res = await app.request('/api/health', {
      method: 'DELETE',
    }, env)

    expect(res.status).toBe(405)
  })

  it('returns 405 for POST on /health', async () => {
    const env = createFullEnv()
    const res = await app.request('/health', {
      method: 'POST',
    }, env)

    expect(res.status).toBe(405)
  })
})

describe('Health Endpoint No Auth Required', () => {
  beforeEach(() => {
    clearNounConfigCache()
    vi.clearAllMocks()
  })

  it('responds without Authorization header', async () => {
    const env = createFullEnv()
    const res = await app.request('/api/health', {
      method: 'GET',
      // No Authorization header
    }, env)

    expect(res.status).toBe(200)
  })

  it('ignores invalid Authorization header', async () => {
    const env = createFullEnv()
    const res = await app.request('/api/health', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer invalid-token',
      },
    }, env)

    // Health endpoint should still work
    expect(res.status).toBe(200)
  })
})
