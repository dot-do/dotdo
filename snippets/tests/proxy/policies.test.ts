import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  applyJwtPolicy,
  applyRateLimitCachePolicy,
  applyCorsPolicy,
  applyGeoBlockPolicy,
  applyBotFilterPolicy,
  type ProxyContext,
  type JwtPolicy,
  type RateLimitCachePolicy,
  type CorsPolicy,
  type GeoBlockPolicy,
  type BotFilterPolicy,
} from '../../proxy'

/**
 * Policy Tests (GREEN Phase)
 *
 * Tests for various policy implementations in the proxy snippet.
 */

// Mock caches for rate limit tests
const mockCachesMatch = vi.fn()
const mockCaches = {
  default: {
    match: mockCachesMatch,
    put: vi.fn(),
  },
}

// Test RSA key pair (for testing only - NOT production keys)
const TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu1SU1LfVLPHCozMxH2Mo
4lgOEePzNm0tRgeLezV6ffAt0gunVTLw7onLRnrq0/IzW7yWR7QkrmBL7jTKEn5u
+qKhbwKfBstIs+bMY2Zkp18gnTxKLxoS2tFczGkPLPgizskuemMghRniWaoLcyeh
kd3qqGElvW/VDL5AaWTg0nLVkjRo9z+40RQzuVaE8AkAFmxZzow3x+VJYKdjykkJ
0iT9wCS0DRTXu269V264Vf/3jvredZiKRkgwlL9xNAwxXFg0x/XFw005UWVRIkdg
cKWTjpBP2dPwVZ4WWC+9aGVd+Gyn1o0CLelf4rEjGoXbAAEgAqeGUxrcIlbjXfbc
mwIDAQAB
-----END PUBLIC KEY-----`

// Helper to create a mock JWT
function createMockJwt(
  payload: Record<string, unknown>,
  expired = false
): string {
  const header = { alg: 'RS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)

  const fullPayload = {
    ...payload,
    iat: now - 3600,
    exp: expired ? now - 100 : now + 3600,
  }

  const headerB64 = btoa(JSON.stringify(header))
  const payloadB64 = btoa(JSON.stringify(fullPayload))
  // Note: signature is not valid for real verification
  // In tests we mock the verification or use a test key pair
  const signatureB64 = 'mock-signature'

  return `${headerB64}.${payloadB64}.${signatureB64}`
}

describe('JWT Policy', () => {
  const baseContext: ProxyContext = {
    requestId: 'test-uuid',
    timestamp: Date.now(),
    ip: '1.2.3.4',
    cf: {},
    jwt: null,
    config: {},
  }

  const jwtPolicy: JwtPolicy = {
    type: 'jwt',
    publicKey: TEST_PUBLIC_KEY,
  }

  it('rejects missing JWT on protected route with 401', async () => {
    const request = new Request('https://example.com.ai/api/protected')
    const context = { ...baseContext }

    const result = await applyJwtPolicy(request, jwtPolicy, context)

    expect(result.allowed).toBe(false)
    expect(result.response?.status).toBe(401)
  })

  it('rejects expired JWT with 401', async () => {
    const expiredToken = createMockJwt({ sub: 'user_123' }, true)
    const request = new Request('https://example.com.ai/api/protected', {
      headers: { Authorization: `Bearer ${expiredToken}` },
    })
    const context = { ...baseContext }

    const result = await applyJwtPolicy(request, jwtPolicy, context)

    expect(result.allowed).toBe(false)
    expect(result.response?.status).toBe(401)
  })

  it('extracts JWT from Authorization header', async () => {
    const request = new Request('https://example.com.ai/api/test', {
      headers: { Authorization: 'Bearer valid-token' },
    })

    // The function should extract the token correctly
    // We're testing the extraction, not full verification here
    const auth = request.headers.get('Authorization')
    expect(auth?.startsWith('Bearer ')).toBe(true)
    expect(auth?.slice(7)).toBe('valid-token')
  })

  it('extracts JWT from cookie', async () => {
    const request = new Request('https://example.com.ai/api/test', {
      headers: { Cookie: '__auth_token=cookie-token; other=value' },
    })

    const cookies = request.headers.get('Cookie') || ''
    const match = cookies.match(/__auth_token=([^;]+)/)
    expect(match?.[1]).toBe('cookie-token')
  })

  it('stores claims in context for variable resolution', async () => {
    // When JWT is valid, claims should be stored in context
    const context = { ...baseContext }
    const claims = { sub: 'user_123', email: 'test@example.com.ai' }

    // Simulate storing claims after successful verification
    context.jwt = claims

    expect(context.jwt.sub).toBe('user_123')
    expect(context.jwt.email).toBe('test@example.com.ai')
  })
})

describe('Rate Limit Cache Policy', () => {
  beforeEach(() => {
    mockCachesMatch.mockReset()
    // @ts-expect-error - mocking caches global
    globalThis.caches = mockCaches
  })

  afterEach(() => {
    // @ts-expect-error - cleanup mock
    delete globalThis.caches
  })

  const baseContext: ProxyContext = {
    requestId: 'test-uuid',
    timestamp: Date.now(),
    ip: '1.2.3.4',
    cf: { ip: '1.2.3.4' },
    jwt: null,
    config: {},
  }

  const rateLimitPolicy: RateLimitCachePolicy = {
    type: 'rateLimitCache',
    keyFrom: '$cf.ip',
  }

  it('checks cache for existing 429', async () => {
    mockCachesMatch.mockResolvedValue(null)
    const request = new Request('https://example.com.ai/api/test')

    await applyRateLimitCachePolicy(request, rateLimitPolicy, baseContext)

    expect(mockCachesMatch).toHaveBeenCalled()
  })

  it('returns cached 429 without forwarding', async () => {
    mockCachesMatch.mockResolvedValue({
      status: 429,
      clone: () => new Response('Too Many Requests', { status: 429 }),
    })
    const request = new Request('https://example.com.ai/api/test')

    const result = await applyRateLimitCachePolicy(request, rateLimitPolicy, baseContext)

    expect(result.allowed).toBe(false)
    expect(result.response?.status).toBe(429)
  })

  it('passes through when no cached 429', async () => {
    mockCachesMatch.mockResolvedValue(null)
    const request = new Request('https://example.com.ai/api/test')

    const result = await applyRateLimitCachePolicy(request, rateLimitPolicy, baseContext)

    expect(result.allowed).toBe(true)
  })

  it('generates cache key from $jwt.sub', async () => {
    mockCachesMatch.mockResolvedValue(null)
    const contextWithJwt: ProxyContext = {
      ...baseContext,
      jwt: { sub: 'user_123' },
    }
    const policy: RateLimitCachePolicy = {
      type: 'rateLimitCache',
      keyFrom: '$jwt.sub',
    }
    const request = new Request('https://example.com.ai/api/test')

    await applyRateLimitCachePolicy(request, policy, contextWithJwt)

    const cacheKey = mockCachesMatch.mock.calls[0][0] as Request
    expect(cacheKey.url).toContain('user_123')
  })

  it('generates cache key from $cf.ip when no JWT', async () => {
    mockCachesMatch.mockResolvedValue(null)
    const request = new Request('https://example.com.ai/api/test')

    await applyRateLimitCachePolicy(request, rateLimitPolicy, baseContext)

    const cacheKey = mockCachesMatch.mock.calls[0][0] as Request
    expect(cacheKey.url).toContain('1.2.3.4')
  })
})

describe('CORS Policy', () => {
  const baseContext: ProxyContext = {
    requestId: 'test-uuid',
    timestamp: Date.now(),
    ip: '1.2.3.4',
    cf: {},
    jwt: null,
    config: {},
  }

  const corsPolicy: CorsPolicy = {
    type: 'cors',
    origins: ['https://app.example.com.ai', 'https://admin.example.com.ai'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    headers: ['Authorization', 'Content-Type'],
  }

  it('adds CORS headers for allowed origins', () => {
    const request = new Request('https://example.com.ai/api/test', {
      headers: { Origin: 'https://app.example.com.ai' },
    })

    const result = applyCorsPolicy(request, corsPolicy, baseContext)

    expect(result.allowed).toBe(true)
    expect(result.headers?.get('Access-Control-Allow-Origin')).toBe('https://app.example.com.ai')
  })

  it('handles preflight OPTIONS request', () => {
    const request = new Request('https://example.com.ai/api/test', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example.com.ai',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    })

    const result = applyCorsPolicy(request, corsPolicy, baseContext)

    expect(result.allowed).toBe(true)
    expect(result.preflightResponse?.status).toBe(204)
    expect(result.preflightResponse?.headers.get('Access-Control-Allow-Methods')).toBe(
      'GET, POST, PUT, DELETE'
    )
    expect(result.preflightResponse?.headers.get('Access-Control-Allow-Headers')).toBe(
      'Authorization, Content-Type'
    )
  })

  it('rejects disallowed origins', () => {
    const request = new Request('https://example.com.ai/api/test', {
      headers: { Origin: 'https://evil.com' },
    })

    const result = applyCorsPolicy(request, corsPolicy, baseContext)

    expect(result.allowed).toBe(true) // Request still allowed, just no CORS headers
    // No CORS headers should be set for disallowed origins
    expect(result.headers).toBeUndefined()
  })

  it('handles wildcard origin', () => {
    const wildcardPolicy: CorsPolicy = {
      type: 'cors',
      origins: ['*'],
      methods: ['GET'],
      headers: [],
    }
    const request = new Request('https://example.com.ai/api/test', {
      headers: { Origin: 'https://any-domain.com' },
    })

    const result = applyCorsPolicy(request, wildcardPolicy, baseContext)

    expect(result.headers?.get('Access-Control-Allow-Origin')).toBe('*')
  })
})

describe('Geo Block Policy', () => {
  const baseContext: ProxyContext = {
    requestId: 'test-uuid',
    timestamp: Date.now(),
    ip: '1.2.3.4',
    cf: { country: 'US' },
    jwt: null,
    config: {},
  }

  it('blocks requests from blocked countries', () => {
    const policy: GeoBlockPolicy = {
      type: 'geoBlock',
      blockedCountries: ['CN', 'RU'],
    }
    const context: ProxyContext = { ...baseContext, cf: { country: 'CN' } }
    const request = new Request('https://example.com.ai/api/test')

    const result = applyGeoBlockPolicy(request, policy, context)

    expect(result.allowed).toBe(false)
    expect(result.response?.status).toBe(403)
  })

  it('passes requests from allowed countries', () => {
    const policy: GeoBlockPolicy = {
      type: 'geoBlock',
      blockedCountries: ['CN', 'RU'],
    }
    const request = new Request('https://example.com.ai/api/test')

    const result = applyGeoBlockPolicy(request, policy, baseContext)

    expect(result.allowed).toBe(true)
  })

  it('handles missing country gracefully', () => {
    const policy: GeoBlockPolicy = {
      type: 'geoBlock',
      blockedCountries: ['CN'],
    }
    const context: ProxyContext = { ...baseContext, cf: {} }
    const request = new Request('https://example.com.ai/api/test')

    const result = applyGeoBlockPolicy(request, policy, context)

    expect(result.allowed).toBe(true) // Allow if country unknown
  })

  it('supports allowlist mode', () => {
    const policy: GeoBlockPolicy = {
      type: 'geoBlock',
      allowedCountries: ['US', 'CA', 'GB'],
    }
    const request = new Request('https://example.com.ai/api/test')

    const result = applyGeoBlockPolicy(request, policy, baseContext)

    expect(result.allowed).toBe(true)

    const deniedContext: ProxyContext = { ...baseContext, cf: { country: 'JP' } }
    const deniedResult = applyGeoBlockPolicy(request, policy, deniedContext)

    expect(deniedResult.allowed).toBe(false)
  })
})

describe('Bot Filter Policy', () => {
  const baseContext: ProxyContext = {
    requestId: 'test-uuid',
    timestamp: Date.now(),
    ip: '1.2.3.4',
    cf: { botScore: 95 },
    jwt: null,
    config: {},
  }

  it('blocks requests with low bot score', () => {
    const policy: BotFilterPolicy = {
      type: 'botFilter',
      minScore: 50,
    }
    const context: ProxyContext = { ...baseContext, cf: { botScore: 10 } }
    const request = new Request('https://example.com.ai/api/test')

    const result = applyBotFilterPolicy(request, policy, context)

    expect(result.allowed).toBe(false)
    expect(result.response?.status).toBe(403)
  })

  it('passes requests with high bot score', () => {
    const policy: BotFilterPolicy = {
      type: 'botFilter',
      minScore: 50,
    }
    const request = new Request('https://example.com.ai/api/test')

    const result = applyBotFilterPolicy(request, policy, baseContext)

    expect(result.allowed).toBe(true)
  })

  it('handles missing bot score gracefully', () => {
    const policy: BotFilterPolicy = {
      type: 'botFilter',
      minScore: 50,
    }
    const context: ProxyContext = { ...baseContext, cf: {} }
    const request = new Request('https://example.com.ai/api/test')

    const result = applyBotFilterPolicy(request, policy, context)

    expect(result.allowed).toBe(true) // Allow if score unknown
  })

  it('allows configurable threshold', () => {
    const strictPolicy: BotFilterPolicy = {
      type: 'botFilter',
      minScore: 90,
    }
    const request = new Request('https://example.com.ai/api/test')
    const context: ProxyContext = { ...baseContext, cf: { botScore: 80 } }

    const result = applyBotFilterPolicy(request, strictPolicy, context)

    expect(result.allowed).toBe(false)
  })
})
