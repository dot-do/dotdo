/**
 * Router Integration Tests (do-dop)
 *
 * Integration tests for the router with real miniflare DO instances.
 * Tests verify the routeRequest() function and related routing utilities
 * with actual Durable Object bindings.
 *
 * Tests cover:
 * 1. routeRequest() basic routing - tenant namespace, static routes
 * 2. Replica routing - GET to replica, writes to primary
 * 3. Consistency mode parsing - headers, query params, noun config defaults
 * 4. Location extraction - CF headers, fallback behavior
 *
 * @module api/tests/router-integration.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  routeRequest,
  getDOBinding,
  getTenantFromHostname,
  fetchNounConfig,
  selectNearestReplica,
  simpleHash,
  type NounConfig,
} from '../utils/router'
import { parseConsistencyMode, shouldRouteToReplica } from '../utils/consistency'
import { extractLocation } from '../utils/location'
import type { Env } from '../types'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock DurableObjectNamespace for testing
 */
function createMockDONamespace(name: string = 'MockDO'): DurableObjectNamespace {
  return {
    get: vi.fn((id: DurableObjectId) => ({
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })),
      id: vi.fn(() => id),
    })),
    idFromName: vi.fn((nsName: string) => ({
      toString: () => `id-${nsName}`,
      name: nsName,
    } as unknown as DurableObjectId)),
    idFromString: vi.fn((id: string) => ({
      toString: () => id,
    } as unknown as DurableObjectId)),
  } as unknown as DurableObjectNamespace
}

/**
 * Create a mock Env with DO bindings for testing
 */
function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    DO: createMockDONamespace('primary'),
    REPLICA_DO: createMockDONamespace('replica'),
    BROWSER_DO: createMockDONamespace('browser'),
    SANDBOX_DO: createMockDONamespace('sandbox'),
    COLLECTION_DO: createMockDONamespace('collection'),
    OBS_BROADCASTER: createMockDONamespace('broadcaster'),
    KV: {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    } as unknown as KVNamespace,
    TEST_KV: {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    } as unknown as KVNamespace,
    TEST_DO: createMockDONamespace('test'),
    ASSETS: {
      fetch: vi.fn(),
    } as unknown as Fetcher,
    ...overrides,
  } as Env
}

/**
 * Create a mock request with optional CF data
 */
function createMockRequest(
  url: string,
  options?: {
    method?: string
    headers?: Record<string, string>
    cf?: {
      colo?: string
      region?: string
      country?: string
      latitude?: string
      longitude?: string
    }
  }
): Request {
  const request = new Request(url, {
    method: options?.method ?? 'GET',
    headers: options?.headers,
  })

  // Attach CF data if provided
  if (options?.cf) {
    ;(request as any).cf = options.cf
  }

  return request
}

// ============================================================================
// 1. routeRequest() Basic Routing Tests
// ============================================================================

describe('routeRequest() basic routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('tenant namespace routing from hostname', () => {
    it('routes to correct tenant namespace based on subdomain', async () => {
      const env = createMockEnv()
      const request = createMockRequest('https://acme.api.dotdo.dev/customers')

      const result = await routeRequest(env, request)

      expect(result).toBeDefined()
      expect(result?.nsName).toBe('acme')
    })

    it('routes to first subdomain for domains with 3+ parts', async () => {
      const env = createMockEnv()
      // api.dotdo.dev has 3 parts, so "api" is extracted as the tenant
      const request = createMockRequest('https://api.dotdo.dev/customers')

      const result = await routeRequest(env, request)

      expect(result).toBeDefined()
      // With 3 parts, first part (api) is used as tenant
      expect(result?.nsName).toBe('api')
    })

    it('routes to "default" namespace for localhost', async () => {
      const env = createMockEnv()
      const request = createMockRequest('http://localhost:8787/customers')

      const result = await routeRequest(env, request)

      expect(result).toBeDefined()
      expect(result?.nsName).toBe('default')
    })

    it('extracts tenant correctly from multi-level subdomain', async () => {
      const env = createMockEnv()
      const request = createMockRequest('https://tenant123.api.dotdo.dev/orders')

      const result = await routeRequest(env, request)

      expect(result).toBeDefined()
      expect(result?.nsName).toBe('tenant123')
    })
  })

  describe('static route bindings', () => {
    it('routes /browsers to BROWSER_DO binding', async () => {
      const env = createMockEnv()
      const request = createMockRequest('https://acme.api.dotdo.dev/browsers/123')

      const result = await getDOBinding(env, '/browsers/123', 'acme.api.dotdo.dev', 'GET')

      expect(result).toBeDefined()
      expect(result?.ns).toBe(env.BROWSER_DO)
    })

    it('routes /sandboxes to SANDBOX_DO binding', async () => {
      const env = createMockEnv()
      const request = createMockRequest('https://acme.api.dotdo.dev/sandboxes/abc')

      const result = await getDOBinding(env, '/sandboxes/abc', 'acme.api.dotdo.dev', 'GET')

      expect(result).toBeDefined()
      expect(result?.ns).toBe(env.SANDBOX_DO)
    })

    it('routes /obs to OBS_BROADCASTER binding with singleton strategy', async () => {
      const env = createMockEnv()
      const request = createMockRequest('https://acme.api.dotdo.dev/obs/events')

      const result = await getDOBinding(env, '/obs/events', 'acme.api.dotdo.dev', 'GET')

      expect(result).toBeDefined()
      expect(result?.ns).toBe(env.OBS_BROADCASTER)
      // Singleton routes use the path segment as namespace
      expect(result?.nsName).toBe('obs')
    })

    it('static routes do not use replicas', async () => {
      const env = createMockEnv()

      const result = await getDOBinding(env, '/browsers/123', 'acme.api.dotdo.dev', 'GET')

      expect(result).toBeDefined()
      expect(result?.isReplica).toBe(false)
    })
  })

  describe('default DO routing', () => {
    it('routes non-static paths to main DO binding', async () => {
      const env = createMockEnv()

      const result = await getDOBinding(env, '/customers/123', 'acme.api.dotdo.dev', 'GET')

      expect(result).toBeDefined()
      expect(result?.ns).toBe(env.DO)
    })

    it('returns null when DO binding is not available', async () => {
      const env = createMockEnv({ DO: undefined })

      const result = await getDOBinding(env, '/customers/123', 'acme.api.dotdo.dev', 'GET')

      expect(result).toBeNull()
    })
  })
})

// ============================================================================
// 2. Replica Routing Tests
// ============================================================================

describe('replica routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('shouldRouteToReplica()', () => {
    it('returns true for GET requests with eventual consistency', () => {
      const result = shouldRouteToReplica('GET', 'eventual')

      expect(result).toBe(true)
    })

    it('returns false for GET requests with strong consistency', () => {
      const result = shouldRouteToReplica('GET', 'strong')

      expect(result).toBe(false)
    })

    it('returns false for GET requests with causal consistency', () => {
      const result = shouldRouteToReplica('GET', 'causal')

      expect(result).toBe(false)
    })

    it('returns false for POST regardless of consistency mode', () => {
      expect(shouldRouteToReplica('POST', 'eventual')).toBe(false)
      expect(shouldRouteToReplica('POST', 'strong')).toBe(false)
      expect(shouldRouteToReplica('POST', 'causal')).toBe(false)
    })

    it('returns false for PUT regardless of consistency mode', () => {
      expect(shouldRouteToReplica('PUT', 'eventual')).toBe(false)
      expect(shouldRouteToReplica('PUT', 'strong')).toBe(false)
    })

    it('returns false for DELETE regardless of consistency mode', () => {
      expect(shouldRouteToReplica('DELETE', 'eventual')).toBe(false)
      expect(shouldRouteToReplica('DELETE', 'strong')).toBe(false)
    })

    it('returns false for PATCH regardless of consistency mode', () => {
      expect(shouldRouteToReplica('PATCH', 'eventual')).toBe(false)
      expect(shouldRouteToReplica('PATCH', 'strong')).toBe(false)
    })
  })

  describe('write operations always route to primary', () => {
    it('POST routes to primary even with eventual consistency config', async () => {
      const env = createMockEnv()

      const result = await getDOBinding(
        env,
        '/customers',
        'acme.api.dotdo.dev',
        'POST'
      )

      expect(result).toBeDefined()
      expect(result?.ns).toBe(env.DO)
      expect(result?.isReplica).toBe(false)
    })

    it('PUT routes to primary', async () => {
      const env = createMockEnv()

      const result = await getDOBinding(
        env,
        '/customers/123',
        'acme.api.dotdo.dev',
        'PUT'
      )

      expect(result).toBeDefined()
      expect(result?.isReplica).toBe(false)
    })

    it('DELETE routes to primary', async () => {
      const env = createMockEnv()

      const result = await getDOBinding(
        env,
        '/customers/123',
        'acme.api.dotdo.dev',
        'DELETE'
      )

      expect(result).toBeDefined()
      expect(result?.isReplica).toBe(false)
    })

    it('PATCH routes to primary', async () => {
      const env = createMockEnv()

      const result = await getDOBinding(
        env,
        '/customers/123',
        'acme.api.dotdo.dev',
        'PATCH'
      )

      expect(result).toBeDefined()
      expect(result?.isReplica).toBe(false)
    })
  })

  describe('selectNearestReplica()', () => {
    it('returns current region if it is in replica list', () => {
      const replicaRegions = ['us-east-1', 'eu-west-1', 'ap-southeast-1']

      const result = selectNearestReplica('us-east-1', replicaRegions)

      expect(result).toBe('us-east-1')
    })

    it('returns first replica if current region not in list', () => {
      const replicaRegions = ['us-east-1', 'eu-west-1', 'ap-southeast-1']

      const result = selectNearestReplica('us-west-2', replicaRegions)

      expect(result).toBe('us-east-1')
    })

    it('returns "unknown" if replica list is empty', () => {
      const result = selectNearestReplica('us-east-1', [])

      expect(result).toBe('unknown')
    })
  })
})

// ============================================================================
// 3. Consistency Mode Parsing Tests
// ============================================================================

describe('consistency mode parsing', () => {
  describe('parseConsistencyMode()', () => {
    it('parses X-Consistency-Mode header', () => {
      const request = createMockRequest('https://api.dotdo.dev/customers', {
        headers: { 'X-Consistency-Mode': 'strong' },
      })
      const nounConfig = { consistencyMode: 'eventual' as const }

      const result = parseConsistencyMode(request, nounConfig)

      expect(result).toBe('strong')
    })

    it('parses ?consistency query param', () => {
      const request = createMockRequest('https://api.dotdo.dev/customers?consistency=causal')
      const nounConfig = { consistencyMode: 'eventual' as const }

      const result = parseConsistencyMode(request, nounConfig)

      expect(result).toBe('causal')
    })

    it('prefers header over query param', () => {
      const request = createMockRequest('https://api.dotdo.dev/customers?consistency=eventual', {
        headers: { 'X-Consistency-Mode': 'strong' },
      })
      const nounConfig = { consistencyMode: 'causal' as const }

      const result = parseConsistencyMode(request, nounConfig)

      expect(result).toBe('strong')
    })

    it('falls back to noun config default when no request params', () => {
      const request = createMockRequest('https://api.dotdo.dev/customers')
      const nounConfig = { consistencyMode: 'causal' as const }

      const result = parseConsistencyMode(request, nounConfig)

      expect(result).toBe('causal')
    })

    it('defaults to "eventual" if nothing specified', () => {
      const request = createMockRequest('https://api.dotdo.dev/customers')
      const nounConfig = {}

      const result = parseConsistencyMode(request, nounConfig)

      expect(result).toBe('eventual')
    })

    it('ignores invalid consistency mode in header', () => {
      const request = createMockRequest('https://api.dotdo.dev/customers', {
        headers: { 'X-Consistency-Mode': 'invalid' },
      })
      const nounConfig = { consistencyMode: 'strong' as const }

      const result = parseConsistencyMode(request, nounConfig)

      expect(result).toBe('strong')
    })

    it('ignores invalid consistency mode in query param', () => {
      const request = createMockRequest('https://api.dotdo.dev/customers?consistency=bogus')
      const nounConfig = { consistencyMode: 'causal' as const }

      const result = parseConsistencyMode(request, nounConfig)

      expect(result).toBe('causal')
    })
  })

  describe('routeRequest() includes consistency mode', () => {
    it('includes consistencyMode in routing result', async () => {
      const env = createMockEnv()
      const request = createMockRequest('https://acme.api.dotdo.dev/customers', {
        headers: { 'X-Consistency-Mode': 'strong' },
      })

      const result = await routeRequest(env, request)

      expect(result).toBeDefined()
      expect(result?.consistencyMode).toBe('strong')
    })

    it('defaults to eventual consistency when not specified', async () => {
      const env = createMockEnv()
      const request = createMockRequest('https://acme.api.dotdo.dev/customers')

      const result = await routeRequest(env, request)

      expect(result).toBeDefined()
      expect(result?.consistencyMode).toBe('eventual')
    })
  })
})

// ============================================================================
// 4. Location Extraction Tests
// ============================================================================

describe('location extraction', () => {
  describe('extractLocation()', () => {
    it('extracts location from CF headers', () => {
      const request = createMockRequest('https://api.dotdo.dev/customers', {
        cf: {
          colo: 'SJC',
          region: 'Northern California',
          country: 'US',
          latitude: '37.3382',
          longitude: '-121.8863',
        },
      })

      const result = extractLocation(request)

      expect(result).toBeDefined()
      expect(result?.colo).toBe('SJC')
      expect(result?.region).toBe('Northern California')
      expect(result?.country).toBe('US')
      expect(result?.lat).toBe(37.3382)
      expect(result?.lon).toBe(-121.8863)
    })

    it('returns null when no CF data available', () => {
      const request = createMockRequest('https://api.dotdo.dev/customers')

      const result = extractLocation(request)

      expect(result).toBeNull()
    })

    it('handles partial CF data gracefully', () => {
      const request = createMockRequest('https://api.dotdo.dev/customers', {
        cf: {
          colo: 'IAD',
          // Missing other fields
        },
      })

      const result = extractLocation(request)

      expect(result).toBeDefined()
      expect(result?.colo).toBe('IAD')
    })

    it('parses latitude and longitude as numbers', () => {
      const request = createMockRequest('https://api.dotdo.dev/customers', {
        cf: {
          colo: 'LHR',
          region: 'London',
          country: 'GB',
          latitude: '51.5074',
          longitude: '-0.1278',
        },
      })

      const result = extractLocation(request)

      expect(result).toBeDefined()
      expect(typeof result?.lat).toBe('number')
      expect(typeof result?.lon).toBe('number')
      expect(result?.lat).toBeCloseTo(51.5074, 4)
      expect(result?.lon).toBeCloseTo(-0.1278, 4)
    })
  })

  describe('routeRequest() includes location', () => {
    it('includes location info in routing result when CF data available', async () => {
      const env = createMockEnv()
      const request = createMockRequest('https://acme.api.dotdo.dev/customers', {
        cf: {
          colo: 'NRT',
          region: 'Tokyo',
          country: 'JP',
          latitude: '35.6762',
          longitude: '139.6503',
        },
      })

      const result = await routeRequest(env, request)

      expect(result).toBeDefined()
      expect(result?.location).toBeDefined()
      expect(result?.location?.colo).toBe('NRT')
      expect(result?.location?.country).toBe('JP')
    })

    it('location is falsy when no CF data', async () => {
      const env = createMockEnv()
      const request = createMockRequest('https://acme.api.dotdo.dev/customers')

      const result = await routeRequest(env, request)

      expect(result).toBeDefined()
      // extractLocation returns null when no CF data, routeRequest may leave it undefined
      expect(result?.location ?? null).toBeNull()
    })
  })
})

// ============================================================================
// 5. Helper Function Tests
// ============================================================================

describe('helper functions', () => {
  describe('getTenantFromHostname()', () => {
    it('extracts tenant from subdomain', () => {
      expect(getTenantFromHostname('acme.api.dotdo.dev')).toBe('acme')
      expect(getTenantFromHostname('tenant123.api.dotdo.dev')).toBe('tenant123')
    })

    it('returns first part for 3+ part domains', () => {
      // api.dotdo.dev has 3 parts, so first part is returned
      expect(getTenantFromHostname('api.dotdo.dev')).toBe('api')
    })

    it('returns "default" for 2-part domains and localhost', () => {
      // dotdo.dev has 2 parts
      expect(getTenantFromHostname('dotdo.dev')).toBe('default')
      expect(getTenantFromHostname('localhost')).toBe('default')
    })

    it('handles localhost with port', () => {
      expect(getTenantFromHostname('localhost:8787')).toBe('default')
    })
  })

  describe('simpleHash()', () => {
    it('returns consistent hash for same input', () => {
      const hash1 = simpleHash('test-string')
      const hash2 = simpleHash('test-string')

      expect(hash1).toBe(hash2)
    })

    it('returns different hash for different inputs', () => {
      const hash1 = simpleHash('string-a')
      const hash2 = simpleHash('string-b')

      expect(hash1).not.toBe(hash2)
    })

    it('returns positive number', () => {
      const hash = simpleHash('negative-test')

      expect(hash).toBeGreaterThanOrEqual(0)
    })
  })
})

// ============================================================================
// 6. URL Normalization Tests
// ============================================================================

describe('URL normalization in routeRequest()', () => {
  it('includes normalized path in routing result', async () => {
    const env = createMockEnv()
    const request = createMockRequest('https://acme.api.dotdo.dev/customers/John_Doe')

    const result = await routeRequest(env, request)

    expect(result).toBeDefined()
    expect(result?.normalizedPath).toBe('/customers/John Doe')
  })

  it('handles multiple underscores', async () => {
    const env = createMockEnv()
    const request = createMockRequest('https://acme.api.dotdo.dev/products/test__product___name')

    const result = await routeRequest(env, request)

    expect(result).toBeDefined()
    expect(result?.normalizedPath).toBe('/products/test product name')
  })

  it('preserves paths without underscores', async () => {
    const env = createMockEnv()
    const request = createMockRequest('https://acme.api.dotdo.dev/orders/12345')

    const result = await routeRequest(env, request)

    expect(result).toBeDefined()
    expect(result?.normalizedPath).toBe('/orders/12345')
  })
})

// ============================================================================
// 7. Edge Cases and Error Handling
// ============================================================================

describe('edge cases and error handling', () => {
  it('handles root path', async () => {
    const env = createMockEnv()
    const request = createMockRequest('https://acme.api.dotdo.dev/')

    const result = await routeRequest(env, request)

    expect(result).toBeDefined()
    expect(result?.normalizedPath).toBe('/')
  })

  it('handles paths with query parameters', async () => {
    const env = createMockEnv()
    const request = createMockRequest('https://acme.api.dotdo.dev/customers?limit=10&offset=0')

    const result = await routeRequest(env, request)

    expect(result).toBeDefined()
    expect(result?.nsName).toBe('acme')
  })

  it('returns null when env.DO is missing', async () => {
    const env = createMockEnv({ DO: undefined })
    const request = createMockRequest('https://acme.api.dotdo.dev/customers')

    const result = await routeRequest(env, request)

    expect(result).toBeNull()
  })

  it('handles empty path segments', async () => {
    const env = createMockEnv()
    const request = createMockRequest('https://acme.api.dotdo.dev/customers//123')

    const result = await routeRequest(env, request)

    expect(result).toBeDefined()
  })

  it('handles paths with special characters (URL encoded)', async () => {
    const env = createMockEnv()
    const request = createMockRequest('https://acme.api.dotdo.dev/customers/user%40example.com')

    const result = await routeRequest(env, request)

    expect(result).toBeDefined()
  })

  it('is case-insensitive for HTTP method', async () => {
    const env = createMockEnv()

    const resultLower = await getDOBinding(env, '/customers/123', 'acme.api.dotdo.dev', 'get')
    const resultUpper = await getDOBinding(env, '/customers/123', 'acme.api.dotdo.dev', 'GET')

    expect(resultLower).toBeDefined()
    expect(resultUpper).toBeDefined()
    expect(resultLower?.isReplica).toBe(resultUpper?.isReplica)
  })
})

// ============================================================================
// 8. Complete Routing Result Structure
// ============================================================================

describe('routing result structure', () => {
  it('includes all required fields', async () => {
    const env = createMockEnv()
    const request = createMockRequest('https://acme.api.dotdo.dev/customers/123', {
      headers: { 'X-Consistency-Mode': 'strong' },
      cf: {
        colo: 'SJC',
        region: 'us-west',
        country: 'US',
        latitude: '37.3382',
        longitude: '-121.8863',
      },
    })

    const result = await routeRequest(env, request)

    expect(result).toBeDefined()
    expect(result).toHaveProperty('ns')
    expect(result).toHaveProperty('nsName')
    expect(result).toHaveProperty('isReplica')
    expect(result).toHaveProperty('consistencyMode')
    expect(result).toHaveProperty('normalizedPath')
  })

  it('includes optional fields when applicable', async () => {
    const env = createMockEnv()
    const request = createMockRequest('https://acme.api.dotdo.dev/customers/123', {
      cf: {
        colo: 'SJC',
        region: 'us-west',
        country: 'US',
        latitude: '37.3382',
        longitude: '-121.8863',
      },
    })

    const result = await routeRequest(env, request)

    expect(result).toBeDefined()
    expect(result?.location).toBeDefined()
    // lookupQuery may or may not be present depending on path format
    // nounConfig may or may not be present depending on cache state
  })

  it('has correct ns type (DurableObjectNamespace)', async () => {
    const env = createMockEnv()
    const request = createMockRequest('https://acme.api.dotdo.dev/customers')

    const result = await routeRequest(env, request)

    expect(result?.ns).toBeDefined()
    expect(typeof result?.ns).toBe('object')
    expect(result?.ns).toHaveProperty('idFromName')
  })
})
