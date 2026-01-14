import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  applyPolicy,
  applyJwtPolicy,
  applyRateLimitCachePolicy,
  applyCorsPolicy,
  applyGeoBlockPolicy,
  applyBotFilterPolicy,
  type Policy,
  type ProxyContext,
} from '../proxy'

/**
 * Policy Tests (RED Phase)
 *
 * Policies are security/traffic controls applied before forwarding requests.
 *
 * Policy types:
 * - jwt: Verify RS256 JWT tokens
 * - rateLimitCache: Check for cached 429 responses
 * - cors: Handle CORS headers and preflight
 * - geoBlock: Block requests from specific countries
 * - botFilter: Filter requests based on bot score
 *
 * These tests are expected to FAIL until the proxy snippet is implemented.
 */

// ============================================================================
// Test Fixtures
// ============================================================================

// RSA key pair for testing (DO NOT use in production)
const TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu1SU1LfVLPHCozMxH2Mo
4lgOEePzNm0tRgeLezV6ffAt0gunVTLw7onLRnrq0/IzW7yWR7QkrmBL7jTKEn5u
+qKhbwKfBstIs+bMY2Zkp18gnTxKLxoS2tFczGkPLPgizskuemMghRniWaoLcyeh
kd3qqGElvW/VDL5AaWTg0nLVkjRo9z+40RQzuVaE8AkAFmxZzow3x+VJYKdjykkJ
0iT9wCS0DRTXu269V264Vf/3jvredZiKRkgwlL9xNAwxXFg0x/XFw005UWVRIkdg
cKWTjpBP2dPwVZ4WWC+9aGVd+Gyn1o0CLelf4rEjGoXbAAEgAqeGUxrcIlbjXfbc
mwIDAQAB
-----END PUBLIC KEY-----`

const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7VJTUt9Us8cKj
MzEfYyjiWA4R4/M2bS1GB4t7NXp98C3SC6dVMvDuictGeurT8jNbvJZHtCSuYEvu
NMoSfm76oqFvAp8Gy0iz5sxjZmSnXyCdPEovGhLa0VzMaQ8s+CLOyS56YyCFGeJZ
qgtzJ6GR3eqoYSW9b9UMvkBpZODSctWSNGj3P7jRFDO5VoTwCQAWbFnOjDfH5Ulg
p2PKSQnSJP3AJLQNFNE7br1XbrhV//eO+t51mIpGSDCUv3E0DDFcWDTH9cXDTTlR
ZVEiR2BwpZOOkE/Z0/BVnhZYL71oZV34bKfWjQIt6V/isSMahdsAASACp4ZTGtwi
VuNd9tybAgMBAAECggEBAKTmjaS6tkK8BlPXClTQ2vpz/N6uxDeS35mXpqasqskV
laAidgg/sWqpjvDbXWtP8N0R+4hLH5Xn3aLHY6yU8gVL1lQSMBOJV1rpJxBx4YEr
Wn9p9M+Ql4hU5VVWGshdLIFsKvjv9b1j9b6VEf8JGnXCg2P5c0+X9V3RZ7VHxYr5
r5P5dP7RnJwH5ByKn3aMVl1M5yzVl/VG3g3LtLz0Lw4MZKxo/5gKWRhqhKqiPPD3
vZ/YV7ox6b5tRj5vZ+2c5O8bH5d5cZmxEfRu7f7v3F5dXuObLyP2ljXdL6nLTW8V
vOhQKm2YTZuwh0HvXVjVDp9eCvOPfY5R3bKKvp3Q9lECgYEA4F9kJ3+Mz7M1cxCf
x0xPp5X5cYS1d5k7zHlWC+wuJZ2FzlA7d8R5mZ4VmKJjVTJMEHUH9d3UQMuAWDNq
N4T3rKzR3z8b5l9XsYpK9Dz1qtlvNH3tnFBM9F5dlrOPw5Y5Z6+RR6lC8TRSMb5M
z2kYqL5xRVrZ1A3PgQkLpJuwJ0kCgYEA1Wa7Bc+2obGLz5cDhQMM3aYz3xKqz8nh
v4Y1FmAxZ5P0dLdBJZ3c7XRnQ9y5fLIk5e+PQQL4mABk3h9g5bNNJ+oWlwv4cK4x
p8Mq2bt0B5LV1r5bPdFO3b/5lzDC0bG3k0Q5khXsP9YdMb9dNBqF8h3U3qj8sS9R
Z2B5u7BKZ5sCgYEAh/BGxOL0dFLPgAq6v8+r7RQhsPn9r0J6bLaA7e+MJOsS6sfV
Y+VCdS+HGlJ6bP0rDKOfLvR5Bz9pdM9Fb7f3DV0+l7z3R3A3FKS+u3L9cO0n5L9Y
kP5x3Q6F7bHBw5G3V5z7b5xYKvLd+M6rS1k3Y5j3bK7c7C3r3a3s3Y3m3S0CgYBJ
Y5e0zGV5PE8N5c7f5lYHGnV5QULLh5rT5cXvP5Y5f5hEHYc5o5q5W5c5g5i5R5m5
j5d5s5v5p5a5w5k5n5b5u5y5t5r5x5l5o5e5q5Z5T5U5O5P5N5M5K5J5H5G5F5D5
C5B5A595857555352515a5b5c5d5e5f5g5h5i5j5QKBgCJ5k5l5m5n5o5p5q5r5s5t5
u5v5w5x5y5z5A5B5C5D5E5F5G5H5I5J5K5L5M5N5O5P5Q5R5S5T5U5V5W5X5Y5Z5a5
b5c5d5e5f5g5h5i5j5k5l5m5n5o5p5q5r5s5t5u5v5w5x5y5z
-----END PRIVATE KEY-----`

function createTestContext(overrides: Partial<ProxyContext> = {}): ProxyContext {
  return {
    requestId: '550e8400-e29b-41d4-a716-446655440000',
    timestamp: 1704825600000,
    ip: '192.168.1.1',
    cf: {
      colo: 'DFW',
      country: 'US',
      city: 'Dallas',
      botScore: 95,
    },
    jwt: null,
    config: {},
    ...overrides,
  }
}

function createTestRequest(url: string, init: RequestInit = {}): Request {
  return new Request(url, init)
}

// Helper to create a valid JWT for testing
function createTestJwt(payload: Record<string, unknown>, expired = false): string {
  const header = { alg: 'RS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const fullPayload = {
    ...payload,
    iat: now - 60,
    exp: expired ? now - 1 : now + 3600, // Expired if flag is set
  }

  const headerB64 = btoa(JSON.stringify(header))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
  const payloadB64 = btoa(JSON.stringify(fullPayload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  // For test purposes, we'll create a mock signature
  // Real implementation should use crypto.subtle.sign
  const signature = 'mock-signature-for-testing'

  return `${headerB64}.${payloadB64}.${signature}`
}

function createMockCaches() {
  const store = new Map<string, Response>()
  return {
    default: {
      match: vi.fn(async (key: Request | string) => {
        const url = typeof key === 'string' ? key : key.url
        return store.get(url)?.clone()
      }),
      put: vi.fn(async (key: Request | string, response: Response) => {
        const url = typeof key === 'string' ? key : key.url
        store.set(url, response.clone())
      }),
    },
    _store: store,
  }
}

// ============================================================================
// JWT Policy Tests
// ============================================================================

describe('JWT Policy', () => {
  it('passes valid RS256 JWT', async () => {
    const context = createTestContext()
    const jwt = createTestJwt({ sub: 'user_123', email: 'user@example.com.ai' })
    const request = createTestRequest('https://example.com.ai/api/users', {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    const policy: Policy = {
      type: 'jwt',
      algorithm: 'RS256',
      publicKey: TEST_PUBLIC_KEY,
    }

    const result = await applyJwtPolicy(request, policy, context)

    expect(result.allowed).toBe(true)
    // JWT claims should be extracted to context
    expect(context.jwt).toBeDefined()
    expect(context.jwt?.sub).toBe('user_123')
  })

  it('rejects expired JWT with 401', async () => {
    const context = createTestContext()
    const jwt = createTestJwt({ sub: 'user_123' }, true) // Expired
    const request = createTestRequest('https://example.com.ai/api/users', {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    const policy: Policy = {
      type: 'jwt',
      publicKey: TEST_PUBLIC_KEY,
    }

    const result = await applyJwtPolicy(request, policy, context)

    expect(result.allowed).toBe(false)
    expect(result.response?.status).toBe(401)
  })

  it('rejects invalid signature with 401', async () => {
    const context = createTestContext()
    // Create a JWT with tampered payload
    const jwt = createTestJwt({ sub: 'user_123' })
    const [header, , signature] = jwt.split('.')
    const tamperedPayload = btoa(JSON.stringify({ sub: 'hacker' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
    const tamperedJwt = `${header}.${tamperedPayload}.${signature}`

    const request = createTestRequest('https://example.com.ai/api/users', {
      headers: { Authorization: `Bearer ${tamperedJwt}` },
    })
    const policy: Policy = {
      type: 'jwt',
      publicKey: TEST_PUBLIC_KEY,
    }

    const result = await applyJwtPolicy(request, policy, context)

    expect(result.allowed).toBe(false)
    expect(result.response?.status).toBe(401)
  })

  it('rejects missing JWT on protected route with 401', async () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com.ai/api/users')
    const policy: Policy = {
      type: 'jwt',
      publicKey: TEST_PUBLIC_KEY,
    }

    const result = await applyJwtPolicy(request, policy, context)

    expect(result.allowed).toBe(false)
    expect(result.response?.status).toBe(401)
  })

  it('extracts claims to context for variable resolution', async () => {
    const context = createTestContext()
    const jwt = createTestJwt({
      sub: 'user_123',
      email: 'user@example.com.ai',
      roles: ['admin', 'user'],
      orgId: 'org_456',
    })
    const request = createTestRequest('https://example.com.ai/api/users', {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    const policy: Policy = {
      type: 'jwt',
      publicKey: TEST_PUBLIC_KEY,
    }

    await applyJwtPolicy(request, policy, context)

    expect(context.jwt?.sub).toBe('user_123')
    expect(context.jwt?.email).toBe('user@example.com.ai')
    expect(context.jwt?.orgId).toBe('org_456')
  })

  it('supports multiple public keys (JWKS rotation)', async () => {
    const context = createTestContext()
    const jwt = createTestJwt({ sub: 'user_123' })
    const request = createTestRequest('https://example.com.ai/api/users', {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    const policy: Policy = {
      type: 'jwt',
      publicKeys: [
        '-----BEGIN PUBLIC KEY-----\nOLD_KEY_HERE\n-----END PUBLIC KEY-----',
        TEST_PUBLIC_KEY, // Current key
      ],
    }

    const result = await applyJwtPolicy(request, policy, context)

    // Should try each key until one works
    expect(result.allowed).toBe(true)
  })

  it('extracts JWT from cookie if not in header', async () => {
    const context = createTestContext()
    const jwt = createTestJwt({ sub: 'user_123' })
    const request = createTestRequest('https://example.com.ai/api/users', {
      headers: { Cookie: `__auth_token=${jwt}; other=value` },
    })
    const policy: Policy = {
      type: 'jwt',
      publicKey: TEST_PUBLIC_KEY,
    }

    const result = await applyJwtPolicy(request, policy, context)

    expect(result.allowed).toBe(true)
    expect(context.jwt?.sub).toBe('user_123')
  })
})

// ============================================================================
// Rate Limit Cache Policy Tests
// ============================================================================

describe('Rate Limit Cache Policy', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('checks cache for existing 429', async () => {
    const mockCaches = createMockCaches()
    vi.stubGlobal('caches', mockCaches)

    const context = createTestContext({
      jwt: { sub: 'rate_limited_user' },
    })
    const request = createTestRequest('https://example.com.ai/api/users')
    const policy: Policy = {
      type: 'rateLimitCache',
      keyFrom: '$jwt.sub',
    }

    // Pre-populate cache with 429 response
    const cached429 = new Response('Rate Limited', {
      status: 429,
      headers: { 'Retry-After': '60' },
    })
    mockCaches._store.set('https://rl-cache/rate_limited_user', cached429)

    const result = await applyRateLimitCachePolicy(request, policy, context)

    // Should check cache
    expect(mockCaches.default.match).toHaveBeenCalled()
    expect(result.allowed).toBe(false)
    expect(result.response?.status).toBe(429)
  })

  it('returns cached 429 without forwarding', async () => {
    const mockCaches = createMockCaches()
    vi.stubGlobal('caches', mockCaches)

    const context = createTestContext({
      jwt: { sub: 'rate_limited_user' },
    })
    const request = createTestRequest('https://example.com.ai/api/users')
    const policy: Policy = {
      type: 'rateLimitCache',
      keyFrom: '$jwt.sub',
    }

    // Pre-populate cache with 429 response
    const cached429 = new Response('Rate Limited', {
      status: 429,
      headers: { 'Retry-After': '60' },
    })
    mockCaches._store.set('https://rl-cache/rate_limited_user', cached429)

    const result = await applyRateLimitCachePolicy(request, policy, context)

    // Response should be from cache, not a new fetch
    expect(result.allowed).toBe(false)
    expect(result.response).toBeDefined()
    const body = await result.response?.text()
    expect(body).toBe('Rate Limited')
  })

  it('passes through when no cached 429', async () => {
    const mockCaches = createMockCaches()
    vi.stubGlobal('caches', mockCaches)

    const context = createTestContext({
      jwt: { sub: 'normal_user' },
    })
    const request = createTestRequest('https://example.com.ai/api/users')
    const policy: Policy = {
      type: 'rateLimitCache',
      keyFrom: '$jwt.sub',
    }

    // No cached 429
    const result = await applyRateLimitCachePolicy(request, policy, context)

    expect(result.allowed).toBe(true)
    expect(result.response).toBeUndefined()
  })

  it('generates cache key from $jwt.sub', async () => {
    const mockCaches = createMockCaches()
    vi.stubGlobal('caches', mockCaches)

    const context = createTestContext({
      jwt: { sub: 'user_abc123' },
    })
    const request = createTestRequest('https://example.com.ai/api/users')
    const policy: Policy = {
      type: 'rateLimitCache',
      keyFrom: '$jwt.sub',
    }

    await applyRateLimitCachePolicy(request, policy, context)

    // Should have checked cache with key derived from jwt.sub
    expect(mockCaches.default.match).toHaveBeenCalled()
    const callArg = mockCaches.default.match.mock.calls[0][0]
    expect(callArg.url || callArg).toContain('user_abc123')
  })

  it('generates cache key from $cf.ip when no JWT', async () => {
    const mockCaches = createMockCaches()
    vi.stubGlobal('caches', mockCaches)

    const context = createTestContext({
      ip: '203.0.113.42',
      jwt: null,
    })
    const request = createTestRequest('https://example.com.ai/api/users')
    const policy: Policy = {
      type: 'rateLimitCache',
      keyFrom: '$cf.ip',
    }

    await applyRateLimitCachePolicy(request, policy, context)

    // Should have checked cache with key derived from IP
    expect(mockCaches.default.match).toHaveBeenCalled()
    const callArg = mockCaches.default.match.mock.calls[0][0]
    expect(callArg.url || callArg).toContain('203.0.113.42')
  })
})

// ============================================================================
// CORS Policy Tests
// ============================================================================

describe('CORS Policy', () => {
  it('adds CORS headers for allowed origins', async () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com.ai/api/users', {
      headers: { Origin: 'https://app.example.com.ai' },
    })
    const policy: Policy = {
      type: 'cors',
      origins: ['https://app.example.com.ai'],
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      headers: ['Authorization', 'Content-Type'],
    }

    const result = await applyCorsPolicy(request, policy, context)

    expect(result.allowed).toBe(true)
    // CORS headers should be added to context or returned
    expect(result.corsHeaders).toBeDefined()
    expect(result.corsHeaders?.['Access-Control-Allow-Origin']).toBe('https://app.example.com.ai')
  })

  it('handles preflight OPTIONS request', async () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com.ai/api/users', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example.com.ai',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization',
      },
    })
    const policy: Policy = {
      type: 'cors',
      origins: ['https://app.example.com.ai'],
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      headers: ['Authorization', 'Content-Type'],
    }

    const result = await applyCorsPolicy(request, policy, context)

    // Preflight should return early with CORS headers
    expect(result.allowed).toBe(false) // Block to return preflight response
    expect(result.response?.status).toBe(204)
    expect(result.response?.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com.ai')
    expect(result.response?.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    expect(result.response?.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
  })

  it('rejects disallowed origins', async () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com.ai/api/users', {
      headers: { Origin: 'https://evil.com' },
    })
    const policy: Policy = {
      type: 'cors',
      origins: ['https://app.example.com.ai'],
      methods: ['GET'],
      headers: [],
    }

    const result = await applyCorsPolicy(request, policy, context)

    expect(result.allowed).toBe(false)
    expect(result.response?.status).toBe(403)
  })

  it('supports wildcard origin (*)', async () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com.ai/api/users', {
      headers: { Origin: 'https://any-origin.com' },
    })
    const policy: Policy = {
      type: 'cors',
      origins: ['*'],
      methods: ['GET'],
      headers: [],
    }

    const result = await applyCorsPolicy(request, policy, context)

    expect(result.allowed).toBe(true)
    expect(result.corsHeaders?.['Access-Control-Allow-Origin']).toBe('*')
  })

  it('handles requests without Origin header', async () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com.ai/api/users')
    const policy: Policy = {
      type: 'cors',
      origins: ['https://app.example.com.ai'],
      methods: ['GET'],
      headers: [],
    }

    // Same-origin requests don't have Origin header
    const result = await applyCorsPolicy(request, policy, context)

    expect(result.allowed).toBe(true)
  })

  it('includes credentials header when configured', async () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com.ai/api/users', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example.com.ai',
        'Access-Control-Request-Method': 'GET',
      },
    })
    const policy: Policy = {
      type: 'cors',
      origins: ['https://app.example.com.ai'],
      methods: ['GET'],
      headers: [],
      credentials: true,
    }

    const result = await applyCorsPolicy(request, policy, context)

    expect(result.response?.headers.get('Access-Control-Allow-Credentials')).toBe('true')
  })
})

// ============================================================================
// Geo Block Policy Tests
// ============================================================================

describe('Geo Block Policy', () => {
  it('blocks requests from blocked countries', async () => {
    const context = createTestContext({
      cf: { country: 'CN', colo: 'HKG' },
    })
    const request = createTestRequest('https://example.com.ai/api/users')
    const policy: Policy = {
      type: 'geoBlock',
      blockedCountries: ['CN', 'RU', 'KP'],
    }

    const result = await applyGeoBlockPolicy(request, policy, context)

    expect(result.allowed).toBe(false)
    expect(result.response?.status).toBe(403)
  })

  it('passes requests from allowed countries', async () => {
    const context = createTestContext({
      cf: { country: 'US', colo: 'DFW' },
    })
    const request = createTestRequest('https://example.com.ai/api/users')
    const policy: Policy = {
      type: 'geoBlock',
      blockedCountries: ['CN', 'RU', 'KP'],
    }

    const result = await applyGeoBlockPolicy(request, policy, context)

    expect(result.allowed).toBe(true)
  })

  it('supports allowedCountries (whitelist mode)', async () => {
    const context = createTestContext({
      cf: { country: 'US', colo: 'DFW' },
    })
    const request = createTestRequest('https://example.com.ai/api/users')
    const policy: Policy = {
      type: 'geoBlock',
      allowedCountries: ['US', 'CA', 'GB'],
    }

    const result = await applyGeoBlockPolicy(request, policy, context)

    expect(result.allowed).toBe(true)
  })

  it('blocks countries not in whitelist', async () => {
    const context = createTestContext({
      cf: { country: 'FR', colo: 'CDG' },
    })
    const request = createTestRequest('https://example.com.ai/api/users')
    const policy: Policy = {
      type: 'geoBlock',
      allowedCountries: ['US', 'CA', 'GB'],
    }

    const result = await applyGeoBlockPolicy(request, policy, context)

    expect(result.allowed).toBe(false)
  })

  it('handles missing country gracefully', async () => {
    const context = createTestContext({
      cf: {}, // No country
    })
    const request = createTestRequest('https://example.com.ai/api/users')
    const policy: Policy = {
      type: 'geoBlock',
      blockedCountries: ['CN'],
    }

    // Should pass through or have default behavior
    const result = await applyGeoBlockPolicy(request, policy, context)

    // Default: allow when country unknown, or block based on config
    expect(result).toBeDefined()
  })
})

// ============================================================================
// Bot Filter Policy Tests
// ============================================================================

describe('Bot Filter Policy', () => {
  it('blocks requests with low bot score', async () => {
    const context = createTestContext({
      cf: { botScore: 10 }, // Low score = likely bot
    })
    const request = createTestRequest('https://example.com.ai/api/users')
    const policy: Policy = {
      type: 'botFilter',
      minScore: 30,
    }

    const result = await applyBotFilterPolicy(request, policy, context)

    expect(result.allowed).toBe(false)
    expect(result.response?.status).toBe(403)
  })

  it('passes requests with high bot score', async () => {
    const context = createTestContext({
      cf: { botScore: 95 }, // High score = likely human
    })
    const request = createTestRequest('https://example.com.ai/api/users')
    const policy: Policy = {
      type: 'botFilter',
      minScore: 30,
    }

    const result = await applyBotFilterPolicy(request, policy, context)

    expect(result.allowed).toBe(true)
  })

  it('uses threshold exactly at minScore', async () => {
    const context = createTestContext({
      cf: { botScore: 30 },
    })
    const request = createTestRequest('https://example.com.ai/api/users')
    const policy: Policy = {
      type: 'botFilter',
      minScore: 30,
    }

    const result = await applyBotFilterPolicy(request, policy, context)

    // Score exactly at threshold should pass
    expect(result.allowed).toBe(true)
  })

  it('handles missing bot score gracefully', async () => {
    const context = createTestContext({
      cf: {}, // No botScore
    })
    const request = createTestRequest('https://example.com.ai/api/users')
    const policy: Policy = {
      type: 'botFilter',
      minScore: 30,
    }

    // Should have default behavior (allow or block)
    const result = await applyBotFilterPolicy(request, policy, context)

    expect(result).toBeDefined()
  })

  it('supports action on block', async () => {
    const context = createTestContext({
      cf: { botScore: 10 },
    })
    const request = createTestRequest('https://example.com.ai/api/users')
    const policy: Policy = {
      type: 'botFilter',
      minScore: 30,
      action: 'challenge', // Return challenge page instead of block
    }

    const result = await applyBotFilterPolicy(request, policy, context)

    expect(result.allowed).toBe(false)
    // Could return a challenge page with specific status
    expect([403, 429, 503]).toContain(result.response?.status)
  })
})

// ============================================================================
// Generic Policy Application Tests
// ============================================================================

describe('Policy Application', () => {
  it('calls correct policy handler based on type', async () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com.ai/api/users')

    // JWT policy
    const jwtPolicy: Policy = { type: 'jwt', publicKey: TEST_PUBLIC_KEY }
    const jwtResult = await applyPolicy(request, jwtPolicy, context)
    expect(jwtResult).toBeDefined()

    // Rate limit policy
    vi.stubGlobal('caches', createMockCaches())
    const rlPolicy: Policy = { type: 'rateLimitCache', keyFrom: '$cf.ip' }
    const rlResult = await applyPolicy(request, rlPolicy, context)
    expect(rlResult).toBeDefined()
  })

  it('handles unknown policy type gracefully', async () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com.ai/api/users')
    const unknownPolicy = { type: 'unknownType' } as Policy

    // Should allow through or return error, not crash
    const result = await applyPolicy(request, unknownPolicy, context)
    expect(result.allowed).toBe(true) // Default: allow if unknown
  })

  it('returns policy result with allowed flag', async () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com.ai/api/users')
    const policy: Policy = {
      type: 'geoBlock',
      allowedCountries: ['US'],
    }

    const result = await applyPolicy(request, policy, context)

    expect(typeof result.allowed).toBe('boolean')
    if (!result.allowed) {
      expect(result.response).toBeDefined()
    }
  })
})

// ============================================================================
// API Key Policy Tests
// ============================================================================

describe('API Key Policy', () => {
  it('validates API key format', async () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com.ai/api/users', {
      headers: { 'X-API-Key': 'sk_live_abc123def456' },
    })
    const policy: Policy = {
      type: 'apiKey',
      header: 'X-API-Key',
      prefix: 'sk_live_',
    }

    // Just format validation, not actual key lookup
    const result = await applyPolicy(request, policy, context)

    expect(result.allowed).toBe(true)
  })

  it('rejects invalid API key format', async () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com.ai/api/users', {
      headers: { 'X-API-Key': 'invalid-key' },
    })
    const policy: Policy = {
      type: 'apiKey',
      header: 'X-API-Key',
      prefix: 'sk_live_',
    }

    const result = await applyPolicy(request, policy, context)

    expect(result.allowed).toBe(false)
    expect(result.response?.status).toBe(401)
  })

  it('rejects missing API key', async () => {
    const context = createTestContext()
    const request = createTestRequest('https://example.com.ai/api/users')
    const policy: Policy = {
      type: 'apiKey',
      header: 'X-API-Key',
      prefix: 'sk_live_',
    }

    const result = await applyPolicy(request, policy, context)

    expect(result.allowed).toBe(false)
    expect(result.response?.status).toBe(401)
  })
})
